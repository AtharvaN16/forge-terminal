import { execFile, spawn } from 'node:child_process'
import { access, constants } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type { MediaFacts } from '../core/types.js'
import { readProbe } from './media-probe.js'

const execFileAsync = promisify(execFile)

export interface Ffmpeg {
  ffmpeg: string
  ffprobe: string
}

/**
 * The folders to look in for ffmpeg, in order (video spec §3.7): PATH first,
 * so a user's own choice wins, then Homebrew's two prefixes on a Mac, which a
 * shell launched from Finder may leave off PATH.
 */
export function ffmpegCandidates(
  platform: NodeJS.Platform,
  env: Record<string, string | undefined>,
): string[] {
  const path = env.PATH ?? env.Path ?? ''
  const sep = platform === 'win32' ? ';' : ':'
  const dirs = path.split(sep).filter(Boolean)
  if (platform === 'darwin') dirs.push('/opt/homebrew/bin', '/usr/local/bin')
  return [...new Set(dirs)]
}

const exe = (name: string) => (process.platform === 'win32' ? `${name}.exe` : name)

async function runnable(path: string): Promise<boolean> {
  try {
    await access(path, constants.X_OK)
    return true
  } catch {
    return false
  }
}

async function resolveFfmpeg(): Promise<Ffmpeg | undefined> {
  for (const dir of ffmpegCandidates(process.platform, process.env)) {
    const ffmpeg = join(dir, exe('ffmpeg'))
    const ffprobe = join(dir, exe('ffprobe'))
    if (!(await runnable(ffmpeg)) || !(await runnable(ffprobe))) continue
    try {
      await execFileAsync(ffmpeg, ['-hide_banner', '-version'], { timeout: 5000 })
      return { ffmpeg, ffprobe }
    } catch {
      // Present but broken (a half-removed install): look further.
    }
  }
  return undefined
}

let found: Promise<Ffmpeg | undefined> | undefined
let forced: { value: Ffmpeg | undefined } | null = null

/**
 * Where ffmpeg and ffprobe are, or undefined when this machine has neither.
 * Cached for the process, as `libreOfficeAvailable` is: installing ffmpeg and
 * running Forge again picks it up.
 */
export function findFfmpeg(): Promise<Ffmpeg | undefined> {
  if (forced) return Promise.resolve(forced.value)
  found ??= resolveFfmpeg()
  return found
}

/** Only for tests: pretend ffmpeg is at `value` (undefined: absent); `null` restores real detection. */
export function forceFfmpegForTests(value: Ffmpeg | undefined | null): void {
  forced = value === null ? null : { value }
  found = undefined
}

/** The facts of a video or sound file, read by ffprobe. Throws when ffprobe cannot read it. */
export async function probeMedia(path: string, tools?: Ffmpeg): Promise<MediaFacts> {
  const t = tools ?? (await findFfmpeg())
  if (!t) throw new Error('ffmpeg is not installed')
  const { stdout } = await execFileAsync(
    t.ffprobe,
    ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', path],
    { timeout: 30_000, maxBuffer: 16 * 1024 * 1024 },
  )
  return readProbe(JSON.parse(stdout))
}

/**
 * The time of the keyframe at or before `at`, where a copied cut can start.
 * Reads only the keyframes of the 15 s before it.
 */
export async function keyframeAtOrBefore(
  path: string,
  at: number,
  tools?: Ffmpeg,
): Promise<number | undefined> {
  const t = tools ?? (await findFfmpeg())
  if (!t) return undefined
  const from = Math.max(0, at - 15)
  const { stdout } = await execFileAsync(
    t.ffprobe,
    [
      ...['-v', 'error', '-select_streams', 'v:0', '-skip_frame', 'nokey'],
      ...['-show_entries', 'frame=pts_time', '-of', 'csv=p=0'],
      ...['-read_intervals', `${from}%${at + 0.01}`, path],
    ],
    { timeout: 30_000, maxBuffer: 4 * 1024 * 1024 },
  )
  const times = stdout
    .split('\n')
    .map((l) => Number.parseFloat(l))
    .filter((n) => Number.isFinite(n) && n <= at + 0.001)
  return times.length ? Math.max(...times) : undefined
}

/** Samples a second the levels are read at: enough for a peak per column, little to decode. */
const LEVEL_RATE = 4000

/**
 * The sound's loudness across the file, one level (0–1, the loudest 1) per
 * column, for Trim's peaks. Null when there is no sound. Decodes the sound
 * alone, mono and slow, streamed: an hour is a few seconds' work.
 */
export async function soundLevels(
  path: string,
  duration: number,
  columns: number,
  opts: { signal?: AbortSignal; tools?: Ffmpeg } = {},
): Promise<number[] | null> {
  const t = opts.tools ?? (await findFfmpeg())
  if (!t) return null
  const total = Math.max(1, Math.round(duration * LEVEL_RATE))
  const per = Math.max(1, Math.ceil(total / columns))
  const peaks = new Array<number>(columns).fill(0)
  let n = 0
  let carry: Buffer = Buffer.alloc(0)
  const ok = await new Promise<boolean>((resolve, reject) => {
    const child = spawn(
      t.ffmpeg,
      [
        ...['-hide_banner', '-nostdin', '-loglevel', 'error', '-i', path],
        ...['-map', '0:a:0', '-ac', '1', '-ar', String(LEVEL_RATE), '-f', 's16le', '-'],
      ],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    )
    const onAbort = () => child.kill('SIGKILL')
    opts.signal?.addEventListener('abort', onAbort, { once: true })
    child.stdout.on('data', (chunk: Buffer) => {
      const b = carry.length ? Buffer.concat([carry, chunk]) : chunk
      const whole = b.length - (b.length % 2)
      for (let i = 0; i < whole; i += 2) {
        const v = Math.abs(b.readInt16LE(i))
        const col = Math.min(columns - 1, Math.floor(n / per))
        if (v > (peaks[col] ?? 0)) peaks[col] = v
        n++
      }
      carry = b.subarray(whole)
    })
    child.stderr.resume()
    child.on('error', reject)
    child.on('close', (code) => {
      opts.signal?.removeEventListener('abort', onAbort)
      if (opts.signal?.aborted) reject(opts.signal.reason ?? new Error('aborted'))
      // No sound stream to map: ffmpeg refuses, which is the answer.
      else resolve(code === 0 && n > 0)
    })
  })
  if (!ok) return null
  const loudest = Math.max(1, ...peaks)
  // A square root, as the ear hears: quiet speech still shows.
  return peaks.map((v) => Math.sqrt(v / loudest))
}

/** One frame at `seconds`, upright, written to `out` as a PNG: Crop to shape's preview. */
export async function frameAt(
  path: string,
  seconds: number,
  out: string,
  tools?: Ffmpeg,
): Promise<void> {
  await runFfmpeg(['-ss', String(Math.max(0, seconds)), '-i', path, '-frames:v', '1', '-y', out], {
    tools,
  })
}

/** The seconds encoded, from the last `out_time_us=` in a chunk of ffmpeg's `-progress` lines. */
export function readProgress(chunk: string): number | undefined {
  let last: number | undefined
  for (const m of chunk.matchAll(/out_time_us=(\d+)/g)) last = Number(m[1]) / 1e6
  return last
}

export interface RunOptions {
  signal?: AbortSignal | undefined
  /** Seconds of the output encoded so far, as ffmpeg reports them. */
  onTime?: ((seconds: number) => void) | undefined
  tools?: Ffmpeg | undefined
  /** ffmpeg's own report wanted (loudnorm's measurement): log at info, and resolve with it. */
  report?: boolean
}

/** ffmpeg's stderr kept for an error: the last lines say why it failed. */
const STDERR_KEEP = 4000

/**
 * Runs ffmpeg once with `args` (input and output included). Streams: nothing
 * is held in memory but its last words, which it resolves with. Rejects with the signal's reason when
 * aborted (the child is killed), or with an Error carrying the tail of
 * ffmpeg's stderr when it fails. No timeout: a long video takes long.
 */
export async function runFfmpeg(args: string[], opts: RunOptions = {}): Promise<string> {
  const { signal, onTime } = opts
  if (signal?.aborted) throw signal.reason ?? new Error('aborted')
  const t = opts.tools ?? (await findFfmpeg())
  if (!t) throw new Error('ffmpeg is not installed')
  const level = opts.report ? 'info' : 'error'
  const full = [
    '-hide_banner',
    '-nostdin',
    '-loglevel',
    level,
    '-progress',
    'pipe:1',
    '-nostats',
    ...args,
  ]
  return new Promise<string>((resolve, reject) => {
    const child = spawn(t.ffmpeg, full, { stdio: ['ignore', 'pipe', 'pipe'] })
    let stderr = ''
    const onAbort = () => child.kill('SIGKILL')
    signal?.addEventListener('abort', onAbort, { once: true })
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      const s = readProgress(chunk)
      if (s !== undefined) onTime?.(s)
    })
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk: string) => {
      stderr = (stderr + chunk).slice(-STDERR_KEEP)
    })
    child.on('error', (e) => {
      signal?.removeEventListener('abort', onAbort)
      reject(e)
    })
    child.on('close', (code) => {
      signal?.removeEventListener('abort', onAbort)
      if (signal?.aborted) reject(signal.reason ?? new Error('aborted'))
      else if (code === 0) resolve(stderr)
      else reject(new Error(stderr.trim() || `ffmpeg exited with ${code}`))
    })
  })
}
