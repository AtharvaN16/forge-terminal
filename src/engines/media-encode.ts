import { FORMATS } from '../core/formats.js'
import type { ConvertOptions, FormatId, MediaFacts } from '../core/types.js'
import { planSize } from './media-size.js'

/**
 * What ffmpeg is asked to do for one video or sound job (video spec §3).
 * Pure: the job in, the ffmpeg command lines out, so every decision — copy
 * or encode, which encoder, which filters, one pass or two — is tested
 * without ffmpeg.
 */

export interface EncodeInput {
  input: string
  /** The temp file beside the output; the engine renames it into place. */
  output: string
  target: FormatId
  facts: MediaFacts
  options: ConvertOptions
  platform: NodeJS.Platform
  /** Where a two-pass encode keeps its first pass's notes. */
  passlog: string
  /**
   * The encoders and filters this ffmpeg was built with. Absent: assume
   * everything (Homebrew's has it all); a lean build is planned around.
   */
  has?: ReadonlySet<string>
}

export interface EncodeStep {
  args: string[]
  /** One of two passes, for Working's label. */
  pass?: { at: 1 | 2; of: 2 }
  /**
   * This step only measures: its stderr carries loudnorm's JSON, which fills
   * `LOUDNORM_MEASURED` in the next step, or astats' quietest stretch, which
   * fills `NOISE_FLOOR` (`noiseFloorOf`).
   */
  measures?: 'loudness' | 'noise'
}

export interface EncodePlan {
  steps: EncodeStep[]
  /** Seconds the output will have: the cut, at the speed. Working's true total. */
  duration: number
  /** Whether each stream is copied as it is rather than encoded. */
  copies: { video: boolean; audio: boolean }
  /** The picture a size target settled on, for Done to say. */
  fitted?: { width: number; height: number; fps: number }
}

/** Replaced by the engine with the noise floor `noiseFloorOf` read from the noise pass. */
export const NOISE_FLOOR = '%NOISE_FLOOR%'

/**
 * Clean up audio (design 2026-10-23 §2.2): the low rumble off, then a gentle
 * FFT denoise, 12 dB at most. Conservative on purpose — a mild result beats a
 * watery one. Runs before the loudness is evened. afftdn needs to be told
 * where the noise sits (its own tracking did nothing in measurement), so the
 * file's quietest stretch is measured first.
 */
const CLEANUP_FILTERS = ['highpass=f=80', `afftdn=nr=12:nf=${NOISE_FLOOR}`] as const

/** What measures the quietest stretch: the rumble filter first, as the clean-up has it. */
const NOISE_MEASURE = 'highpass=f=80,astats=measure_perchannel=none:measure_overall=RMS_trough'

/**
 * afftdn's `nf` from the noise pass's report: 8 dB above the quietest stretch
 * (measured on speech with pauses: noise is cut by all `nr` allows from there,
 * and the speech moves by 0.2 dB or less), held within -70…-30. With no quiet
 * stretch to read (digital silence, no report) afftdn's own -50.
 */
export function noiseFloorOf(report: string): number {
  const found = /RMS trough dB:\s*(-?[\d.]+|-?inf)/i.exec(report)?.[1]
  const trough = found === undefined ? Number.NaN : Number(found)
  if (!Number.isFinite(trough)) return -50
  return Math.min(-30, Math.max(-70, Math.round(trough + 8)))
}

/** Replaced by the engine with what the loudness pass measured. */
export const LOUDNORM_MEASURED = '%LOUDNORM_MEASURED%'

const MUXER: Partial<Record<FormatId, string>> = {
  mp4: 'mp4',
  hevc: 'mp4',
  mov: 'mov',
  webm: 'webm',
  mkv: 'matroska',
  avi: 'avi',
  gif: 'gif',
  mp3: 'mp3',
  m4a: 'ipod',
  opus: 'opus',
  flac: 'flac',
  wav: 'wav',
  aiff: 'aiff',
  ogg: 'ogg',
}

/** The video codecs a container takes as they are. */
const VIDEO_FITS: Partial<Record<FormatId, readonly string[]>> = {
  mp4: ['h264', 'hevc', 'mpeg4', 'av1'],
  mov: ['h264', 'hevc', 'mpeg4', 'prores', 'av1'],
  mkv: ['h264', 'hevc', 'mpeg4', 'vp8', 'vp9', 'av1'],
  hevc: ['hevc'],
  webm: ['vp8', 'vp9', 'av1'],
  avi: ['mpeg4', 'h264', 'mjpeg', 'msmpeg4v3'],
}

/** The sound codecs a container takes as they are. */
const AUDIO_FITS: Partial<Record<FormatId, readonly string[]>> = {
  mp4: ['aac', 'alac', 'mp3'],
  hevc: ['aac', 'alac', 'mp3'],
  mov: ['aac', 'alac', 'mp3', 'pcm_s16le', 'pcm_s16be', 'pcm_s24le'],
  m4a: ['aac', 'alac'],
  mkv: ['aac', 'mp3', 'opus', 'vorbis', 'flac', 'ac3', 'eac3'],
  webm: ['opus', 'vorbis'],
  opus: ['opus'],
  mp3: ['mp3'],
  flac: ['flac'],
  wav: ['pcm_s16le'],
  aiff: ['pcm_s16be'],
  ogg: ['vorbis', 'opus', 'flac'],
  avi: ['mp3', 'ac3', 'aac', 'pcm_s16le'],
}

/** The sound encoder for a container, and its bitrate when lossy. */
function audioEncoder(
  target: FormatId,
  platform: NodeJS.Platform,
  can: (name: string) => boolean,
): { encoder: string; kbps?: number } {
  switch (target) {
    case 'webm':
    case 'opus':
      return { encoder: 'libopus', kbps: 96 }
    case 'mp3':
      return { encoder: 'libmp3lame', kbps: 128 }
    case 'flac':
      return { encoder: 'flac' }
    case 'wav':
      return { encoder: 'pcm_s16le' }
    case 'aiff':
      return { encoder: 'pcm_s16be' }
    case 'ogg':
      return { encoder: 'libvorbis', kbps: 128 }
    default:
      return { encoder: platform === 'darwin' && can('aac_at') ? 'aac_at' : 'aac', kbps: 128 }
  }
}

const even = (n: number) => Math.max(2, Math.floor(n / 2) * 2)
const secs = (n: number) => String(Math.round(n * 1000) / 1000)
/** A start, rounded up: rounded down, it can land before its keyframe and seek one earlier. */
const secsUp = (n: number) => String(Math.ceil(n * 1000) / 1000)

/** Quality 1–100 as x264's constant rate factor: 100 → 18, 1 → 38. */
export const crfOf = (quality: number) => Math.round(38 - ((quality - 1) * 20) / 99)
/** The same for VP9, whose scale runs further: 100 → 20, 1 → 50. */
const vp9CrfOf = (quality: number) => Math.round(50 - ((quality - 1) * 30) / 99)
/** And for x265: 100 → 22, 1 → 40. */
const x265CrfOf = (quality: number) => Math.round(40 - ((quality - 1) * 18) / 99)

/** HDR to normal range, for a format that can't carry it. */
const TONEMAP =
  'zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,tonemap=tonemap=hable:desat=0,zscale=t=bt709:m=bt709:r=tv,format=yuv420p'

/** atempo takes 0.5–2 at a time; a bigger change is a chain. */
function atempo(speed: number): string[] {
  const out: string[] = []
  let left = speed
  while (left > 2) {
    out.push('atempo=2')
    left /= 2
  }
  while (left < 0.5) {
    out.push('atempo=0.5')
    left /= 0.5
  }
  out.push(`atempo=${Math.round(left * 1000) / 1000}`)
  return out
}

const GIF_WIDTH = 800
const GIF_FPS = 15
const SOUND_FLOOR_KBPS = 32

export function planEncode(job: EncodeInput): EncodePlan {
  const { facts, options, target, platform } = job
  const m = options.media ?? {}
  const v = facts.video
  const a = facts.audio
  const soundOut = FORMATS[target].media === 'sound'
  const gif = target === 'gif'
  const compress = options.compress !== undefined
  const darwin = platform === 'darwin'
  const can = (name: string) => job.has === undefined || job.has.has(name)

  const start = m.cut?.start ?? 0
  const end = Math.min(m.cut?.end ?? facts.duration, facts.duration)
  const span = Math.max(0, end - start)
  const speed = m.speed ?? 1
  const duration = span / speed

  const wantVideo = v !== undefined && !soundOut
  const wantAudio = a !== undefined && !m.mute && !gif

  // A size: the picture's settings by arithmetic, before anything is encoded.
  let fitted: EncodePlan['fitted']
  let sizedAudioKbps: number | undefined
  let videoKbps: number | undefined
  let soundKbps: number | undefined
  if (m.targetBytes !== undefined && duration > 0) {
    if (wantVideo && v) {
      const p = planSize({
        duration,
        width: v.width,
        height: v.height,
        fps: v.fps,
        hasAudio: wantAudio,
        targetBytes: m.targetBytes,
      })
      // Under the floor is refused before this is ever called; the floor is the best there is.
      if ('videoKbps' in p) {
        fitted = { width: p.width, height: p.height, fps: p.fps }
        videoKbps = p.videoKbps
        sizedAudioKbps = p.audioKbps
      }
    } else if (wantAudio) {
      const kbps = Math.floor(((m.targetBytes * 8) / duration / 1000) * 0.98)
      soundKbps = Math.max(SOUND_FLOOR_KBPS, Math.min(320, kbps))
    }
  }

  // ---- the picture
  const vf: string[] = []
  if (wantVideo && v) {
    // Tone-mapping needs zscale; a build without it writes HDR's colours as they are.
    if (v.hdr && target !== 'hevc' && can('zscale')) vf.push(TONEMAP)
    if (options.crop?.box) {
      const b = options.crop.box
      vf.push(`crop=${even(b.width)}:${even(b.height)}:${b.left}:${b.top}`)
    }
    if (fitted) vf.push(`scale=${fitted.width}:${fitted.height}`)
    else if (options.resize) {
      const r = options.resize
      // Never bigger than the video is: a side asked over its own is its own.
      if ('width' in r) vf.push(`scale=trunc(min(${even(r.width)}\\,iw)/2)*2:-2`)
      else if ('height' in r) vf.push(`scale=-2:trunc(min(${even(r.height)}\\,ih)/2)*2`)
      else vf.push(`scale=trunc(iw*${r.percent / 100}/2)*2:-2`)
    }
    if (speed !== 1) vf.push(`setpts=PTS/${speed}`)
    if (gif) {
      const w = Math.min(GIF_WIDTH, even(v.width))
      vf.push(
        `fps=${Math.min(GIF_FPS, v.fps)},scale=${w}:-2:flags=lanczos,split[s0][s1];[s0]palettegen=stats_mode=diff[p];[s1][p]paletteuse=dither=bayer:bayer_scale=4`,
      )
    }
  }
  const fps = fitted?.fps ?? m.fps
  const copyVideo =
    wantVideo &&
    v !== undefined &&
    vf.length === 0 &&
    fps === undefined &&
    !compress &&
    m.targetBytes === undefined &&
    (VIDEO_FITS[target] ?? []).includes(v.codec)

  const videoArgs: string[] = []
  if (!wantVideo) videoArgs.push('-vn')
  else if (copyVideo) videoArgs.push('-c:v', 'copy')
  else {
    if (vf.length) videoArgs.push('-vf', vf.join(','))
    if (gif) videoArgs.push('-c:v', 'gif', '-loop', '0')
    else if (target === 'webm') {
      videoArgs.push('-c:v', 'libvpx-vp9', '-row-mt', '1', '-deadline', 'good', '-cpu-used', '4')
      if (videoKbps !== undefined) videoArgs.push('-b:v', `${videoKbps}k`)
      else {
        const crf = compress ? vp9CrfOf(options.quality ?? 60) : 33
        videoArgs.push('-crf', String(crf), '-b:v', '0')
      }
    } else if (target === 'hevc') {
      const x265 = can('libx265') || !darwin
      if (videoKbps !== undefined) {
        // HEVC is not run in two passes: one pass at the bitrate, and the
        // engine's check after it holds the size.
        if (x265) videoArgs.push('-c:v', 'libx265', '-preset', 'fast', '-b:v', `${videoKbps}k`)
        else videoArgs.push('-c:v', 'hevc_videotoolbox', '-b:v', `${videoKbps}k`)
      } else if (darwin && (!compress || !x265)) {
        // Apple's encoder: its own quality scale, 1–100.
        const q = compress ? Math.round(20 + ((options.quality ?? 60) * 60) / 100) : 60
        videoArgs.push('-c:v', 'hevc_videotoolbox', '-q:v', String(q))
      } else {
        const crf = compress ? x265CrfOf(options.quality ?? 60) : 26
        videoArgs.push('-c:v', 'libx265', '-crf', String(crf), '-preset', 'fast')
      }
      videoArgs.push('-tag:v', 'hvc1', '-pix_fmt', v?.hdr ? 'p010le' : 'yuv420p')
    } else {
      if (videoKbps !== undefined) {
        videoArgs.push('-c:v', 'libx264', '-preset', 'medium', '-b:v', `${videoKbps}k`)
      } else if (compress) {
        videoArgs.push(
          '-c:v',
          'libx264',
          '-preset',
          'medium',
          '-crf',
          String(crfOf(options.quality ?? 60)),
        )
      } else if (darwin) videoArgs.push('-c:v', 'h264_videotoolbox', '-q:v', '65')
      else videoArgs.push('-c:v', 'libx264', '-preset', 'veryfast', '-crf', '21')
      videoArgs.push('-pix_fmt', 'yuv420p')
    }
    if (fps !== undefined) videoArgs.push('-r', String(fps))
    else if (!gif) videoArgs.push('-fps_mode', 'passthrough')
  }

  // ---- the sound
  const cleanup: string[] = m.cleanup ? [...CLEANUP_FILTERS] : []
  const af: string[] = [...cleanup, ...(speed !== 1 ? atempo(speed) : [])]
  const loudness = m.loudness
  if (loudness !== undefined) {
    af.push(`loudnorm=I=${loudness}:TP=-1.5:LRA=11:${LOUDNORM_MEASURED}:linear=true`)
  }
  const kbps = m.bitrate ?? sizedAudioKbps ?? soundKbps
  const copyAudio =
    wantAudio &&
    a !== undefined &&
    af.length === 0 &&
    kbps === undefined &&
    !(compress && soundOut) &&
    (AUDIO_FITS[target] ?? []).includes(a.codec)

  const audioArgs: string[] = []
  if (!wantAudio) audioArgs.push('-an')
  else if (copyAudio) audioArgs.push('-c:a', 'copy')
  else {
    if (af.length) audioArgs.push('-af', af.join(','))
    const enc = audioEncoder(target, platform, can)
    audioArgs.push('-c:a', enc.encoder)
    const rate = kbps ?? enc.kbps
    if (rate !== undefined && enc.kbps !== undefined) audioArgs.push('-b:a', `${rate}k`)
    if (sizedAudioKbps !== undefined && sizedAudioKbps <= SOUND_FLOOR_KBPS)
      audioArgs.push('-ac', '1')
    // loudnorm works at 192 kHz and would write it: keep the file's own rate.
    if (loudness !== undefined && a) audioArgs.push('-ar', String(a.sampleRate))
  }

  // ---- around them
  const pre: string[] = []
  if (start > 0) pre.push('-ss', secsUp(start))
  // On the input, so it is the source's seconds, before any speed change.
  if (m.cut) pre.push('-t', secs(span))
  const input = [...pre, '-i', job.input]
  const cut: string[] = []
  const maps = [...(wantVideo ? ['-map', '0:v:0'] : []), ...(wantAudio ? ['-map', '0:a:0'] : [])]
  const meta = options.keepMetadata ? [] : ['-map_metadata', '-1']
  const muxer = MUXER[target] ?? target
  const fast = ['mp4', 'hevc', 'mov', 'm4a'].includes(target) ? ['-movflags', '+faststart'] : []
  const out = ['-f', muxer, '-y', job.output]
  const nul = platform === 'win32' ? 'NUL' : '/dev/null'

  const steps: EncodeStep[] = []
  if (m.cleanup) {
    steps.push({
      args: [...input, ...cut, '-vn', '-af', NOISE_MEASURE, '-f', 'null', nul],
      measures: 'noise',
    })
  }
  if (loudness !== undefined) {
    steps.push({
      args: [
        ...input,
        ...cut,
        '-vn',
        '-af',
        `${[...cleanup, ...(speed !== 1 ? atempo(speed) : [])].map((f) => `${f},`).join('')}loudnorm=I=${loudness}:TP=-1.5:LRA=11:print_format=json`,
        '-f',
        'null',
        nul,
      ],
      measures: 'loudness',
      pass: { at: 1, of: 2 },
    })
  }
  const twoPass = videoKbps !== undefined && target !== 'hevc' && !gif
  if (twoPass) {
    steps.push({
      args: [
        ...input,
        ...cut,
        ...maps.slice(0, 2),
        ...videoArgs,
        '-pass',
        '1',
        '-passlogfile',
        job.passlog,
        '-an',
        '-f',
        'null',
        nul,
      ],
      pass: { at: 1, of: 2 },
    })
    steps.push({
      args: [
        ...input,
        ...cut,
        ...maps,
        ...videoArgs,
        '-pass',
        '2',
        '-passlogfile',
        job.passlog,
        ...audioArgs,
        ...meta,
        ...fast,
        ...out,
      ],
      pass: { at: 2, of: 2 },
    })
  } else {
    steps.push({
      args: [...input, ...cut, ...maps, ...videoArgs, ...audioArgs, ...meta, ...fast, ...out],
      // After loudness was measured: the second of two passes, with its own bar.
      ...(loudness !== undefined ? { pass: { at: 2 as const, of: 2 as const } } : {}),
    })
  }

  return {
    steps,
    duration,
    copies: { video: copyVideo, audio: copyAudio },
    ...(fitted ? { fitted } : {}),
  }
}
