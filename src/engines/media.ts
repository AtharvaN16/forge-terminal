import { randomBytes } from 'node:crypto'
import { open, rm, stat } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { prepareOutputDir, renameAtomic } from '../core/atomic.js'
import { conversionFailed, corruptSource, ffmpegMissing, isForgeError } from '../core/errors.js'
import { FORMATS } from '../core/formats.js'
import { timeOf } from '../core/timecode.js'
import type {
  FormatId,
  Job,
  MediaFacts,
  MediaInfo,
  Progress,
  Result,
  SourceInfo,
  Warning,
} from '../core/types.js'
import { type Ffmpeg, findFfmpeg, keyframeAtOrBefore, probeMedia, runFfmpeg } from './ffmpeg.js'
import { type EncodePlan, LOUDNORM_MEASURED, planEncode } from './media-encode.js'
import { floorBytes } from './media-size.js'
import { type MediaFormat, SNIFF_BYTES, sniffMedia } from './media-sniff.js'
import type { Engine } from './types.js'

/**
 * Video and sound, through ffmpeg (video spec). Two engines over one core so
 * `targetsFor` stays capability-driven (invariant 2): the video engine reads
 * videos and writes video and sound formats; the sound engine reads and
 * writes sound formats only. Both are routed only for `convert`: compress,
 * Trim, Mute, Resize and Crop are all conversions with options, as for images.
 */

const VIDEO_READS: FormatId[] = ['mp4', 'mov', 'webm', 'mkv', 'avi', 'gif']
const VIDEO_WRITES: FormatId[] = [
  'mp4',
  'mov',
  'hevc',
  'webm',
  'mkv',
  'avi',
  'gif',
  'mp3',
  'm4a',
  'wav',
]
const SOUND_READS: FormatId[] = ['mp3', 'm4a', 'wav', 'aiff', 'flac', 'opus', 'ogg']
const SOUND_WRITES: FormatId[] = ['mp3', 'm4a', 'opus', 'flac', 'aiff', 'wav']

async function head(path: string): Promise<Buffer> {
  const handle = await open(path, 'r')
  try {
    const b = Buffer.alloc(SNIFF_BYTES)
    const { bytesRead } = await handle.read(b, 0, b.length, 0)
    return b.subarray(0, bytesRead)
  } finally {
    await handle.close()
  }
}

/** A sound file carried in an ISO box with no picture in it reads as M4A. */
function formatOf(sniffed: MediaFormat, facts: MediaFacts | undefined): FormatId {
  if (facts && !facts.video && (sniffed === 'mp4' || sniffed === 'mov')) return 'm4a'
  return sniffed
}

/**
 * Probes by content (invariant 3). Declines anything that is not `want` from
 * its first bytes, cheaply, so a picture never pays for ffprobe and a video
 * never falls through to the PDF engine's whole-file read.
 */
async function probeAs(path: string, want: 'video' | 'sound'): Promise<MediaInfo> {
  const sniffed = sniffMedia(await head(path))
  if (!sniffed) throw new Error('not video or sound')
  const bytes = (await stat(path)).size
  const tools = await findFfmpeg()
  let facts: MediaFacts | undefined
  if (tools) {
    try {
      facts = await probeMedia(path, tools)
    } catch (e) {
      throw corruptSource(path, e)
    }
    if (facts.duration <= 0 || (!facts.video && !facts.audio)) throw corruptSource(path, facts)
  }
  const format = formatOf(sniffed, facts)
  if (FORMATS[format].media !== want) throw new Error(`not ${want}`)
  return { kind: 'media', path, format, bytes, ...(facts ? { facts } : {}) }
}

/** The facts of a job's source: as probed, or read now (a GIF probed by the image engine). */
async function factsOf(source: SourceInfo, tools: Ffmpeg): Promise<MediaFacts> {
  if (source.kind === 'media' && source.facts) return source.facts
  try {
    return await probeMedia(source.path, tools)
  } catch (e) {
    throw corruptSource(source.path, e)
  }
}

/** The seconds a job's output will have: its cut, at its speed. */
function outputSeconds(job: Extract<Job, { op: 'convert' }>, duration: number): number {
  const m = job.options.media ?? {}
  const start = m.cut?.start ?? 0
  const end = Math.min(m.cut?.end ?? duration, duration)
  return Math.max(0, end - start) / (m.speed ?? 1)
}

function sizeTo(job: Job, targetBytes: number): { floor: number } | undefined {
  if (job.op !== 'convert') return undefined
  const source = job.sources[0]
  const facts = source.kind === 'media' ? source.facts : undefined
  if (!facts) return undefined
  const duration = outputSeconds(job, facts.duration)
  const soundOut = FORMATS[job.target].media === 'sound'
  const m = job.options.media ?? {}
  const audio = facts.audio !== undefined && !m.mute && job.target !== 'gif'
  const floor =
    facts.video && !soundOut
      ? floorBytes({
          duration,
          width: facts.video.width,
          height: facts.video.height,
          fps: facts.video.fps,
          hasAudio: audio,
        })
      : Math.ceil(((32 * 1000) / 8 / 0.98) * duration)
  return targetBytes < floor ? { floor } : undefined
}

/** loudnorm's measurement, from its JSON at the end of ffmpeg's report. */
function measured(report: string): string {
  const json = report.slice(report.lastIndexOf('{'), report.lastIndexOf('}') + 1)
  const m = JSON.parse(json) as Record<string, string>
  return [
    `measured_I=${m.input_i}`,
    `measured_TP=${m.input_tp}`,
    `measured_LRA=${m.input_lra}`,
    `measured_thresh=${m.input_thresh}`,
    `offset=${m.target_offset}`,
  ].join(':')
}

async function sweep(paths: string[]): Promise<void> {
  await Promise.all(paths.map((p) => rm(p, { force: true }).catch(() => {})))
}

async function run(
  job: Job,
  onPhase: (progress: Progress) => void,
  signal?: AbortSignal,
): Promise<Result> {
  if (job.op !== 'convert') throw new Error(`media engines only convert, not ${job.op}`)
  if (signal?.aborted) throw signal.reason ?? new Error('aborted')
  const source = job.sources[0]
  const output = job.outputs[0]
  const tools = await findFfmpeg()
  if (!tools) throw ffmpegMissing(source.path)
  const facts = await factsOf(source, tools)
  await prepareOutputDir(output)

  const tag = randomBytes(6).toString('hex')
  const temp = join(dirname(output), `.${basename(output)}.${tag}.tmp`)
  const passlog = join(dirname(output), `.forge-pass-${tag}`)
  const leftovers = [temp, `${passlog}-0.log`, `${passlog}-0.log.mbtree`, `${passlog}-0.log.temp`]
  const warnings: Warning[] = []

  const planFor = (platform: NodeJS.Platform, options = job.options): EncodePlan =>
    planEncode({
      input: source.path,
      output: temp,
      target: job.target,
      facts,
      options,
      platform,
      passlog,
    })
  let options = job.options
  let plan = planFor(process.platform)

  // A copied cut can only start on a keyframe: start on the one at or before
  // the asked start, keep the asked end, and say where it landed.
  const cut = options.media?.cut
  if (plan.copies.video && cut && cut.start > 0) {
    const key = await keyframeAtOrBefore(source.path, cut.start, tools)
    if (key !== undefined && cut.start - key > 0.05) {
      options = { ...options, media: { ...options.media, cut: { ...cut, start: key } } }
      plan = planFor(process.platform, options)
      warnings.push({
        code: 'media-cut-keyframe',
        message: `It starts at ${timeOf(key)}, the keyframe just before ${timeOf(cut.start)}.`,
      })
    }
  }

  const steps = async (p: EncodePlan) => {
    let loudness = ''
    for (const step of p.steps) {
      const args = step.args.map((a) => a.replace(LOUDNORM_MEASURED, loudness))
      const report = await runFfmpeg(args, {
        tools,
        signal,
        report: step.measures === 'loudness',
        onTime: (s) =>
          onPhase({
            phase: 'time',
            done: Math.min(s, p.duration),
            total: p.duration,
            ...(step.pass ? { pass: step.pass } : {}),
          }),
      })
      if (step.measures === 'loudness') loudness = measured(report)
    }
  }

  try {
    try {
      await steps(plan)
    } catch (e) {
      // Apple's hardware encoder can refuse (an Intel Mac, a size it won't
      // take): the same job in software.
      if (signal?.aborted) throw e
      if (!plan.steps.some((s) => s.args.some((a) => a.endsWith('_videotoolbox')))) throw e
      plan = planFor('linux', options)
      await steps(plan)
    }
    // Two passes land within a percent or so; a near miss gets another try
    // aimed lower, so a size asked for is a size kept (never over it).
    const asked = options.media?.targetBytes
    for (const k of [0.95, 0.9]) {
      if (asked === undefined || (await stat(temp)).size <= asked) break
      options = { ...options, media: { ...options.media, targetBytes: Math.floor(asked * k) } }
      plan = planFor(
        plan.steps.some((s) => s.args.includes('libx264')) ? 'linux' : process.platform,
        options,
      )
      await steps(plan)
    }
    await renameAtomic(temp, output)
  } catch (e) {
    await sweep(leftovers)
    if (signal?.aborted || isForgeError(e)) throw e
    throw conversionFailed(source.path, e)
  }
  await sweep(leftovers.slice(1))

  const v = facts.video
  if (plan.fitted && v && (plan.fitted.width !== v.width || plan.fitted.fps < v.fps)) {
    const bytes = job.options.media?.targetBytes ?? 0
    const size =
      bytes >= 1e6 ? `${Math.round(bytes / 1e5) / 10} MB` : `${Math.round(bytes / 1e3)} KB`
    warnings.push({
      code: 'media-fitted',
      message: `To fit ${size} it is now ${plan.fitted.width}×${plan.fitted.height} at ${plan.fitted.fps} fps.`,
    })
  }
  return { job, outputBytes: (await stat(output)).size, warnings }
}

const set = (ids: FormatId[]) => new Set<FormatId>(ids)

/** What a video can become: no sound formats without sound, no HEVC for an HEVC. */
function videoWritesFor(source: SourceInfo): ReadonlySet<FormatId> {
  const facts = source.kind === 'media' ? source.facts : undefined
  const silent = source.kind === 'image' || (facts !== undefined && facts.audio === undefined)
  return set(
    VIDEO_WRITES.filter((id) => {
      if (silent && FORMATS[id].media === 'sound') return false
      if (id === 'hevc' && facts?.video?.codec === 'hevc') return false
      return true
    }),
  )
}

export const videoEngine: Engine = {
  id: 'video',
  reads: set(VIDEO_READS),
  writes: set(VIDEO_WRITES),
  ops: new Set(['convert']),
  probe: (path) => probeAs(path, 'video'),
  run,
  sizeTo,
  writesFor: videoWritesFor,
}

export const soundEngine: Engine = {
  id: 'sound',
  reads: set(SOUND_READS),
  writes: set(SOUND_WRITES),
  ops: new Set(['convert']),
  probe: (path) => probeAs(path, 'sound'),
  run,
  sizeTo,
}
