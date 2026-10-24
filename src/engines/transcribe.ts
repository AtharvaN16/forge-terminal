/**
 * The transcribe helpers (spec 2026-10-17-transcribe-design §4.1). On a Mac
 * that has Apple's speech recogniser (macOS 26, Apple silicon) it is
 * `forge-transcribe`, a Swift program built into dist/helpers: Apple's
 * recogniser writes the transcript and Apple's on-device model the notes.
 * Everywhere else (Windows, Linux, an Intel Mac or one before macOS 26) it is
 * `forge-transcribe-whisper.mjs`, which speaks the same lines over whisper.cpp
 * and ffmpeg (no notes). This file only picks the helper, runs it, and turns
 * its JSON lines into data and `ForgeError`s.
 */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'
import {
  conversionFailed,
  languageUnsupported,
  noSound,
  transcribeUnavailable,
  untranscribable,
} from '../core/errors.js'
import { DEFAULT_DETAIL, type Detail } from '../core/transcribe/detail.js'
import type { Transcription } from '../core/transcribe/markdown.js'
import { installed } from '../extensions/paths.js'
import { findFfmpeg } from './ffmpeg.js'

/** What the whisper helper can lack: whisper.cpp's whisper-cli, or ffmpeg. */
export type TranscribeMissing = 'whisper' | 'ffmpeg'

export interface TranscribeStatus {
  speech: boolean
  /** The system's language as the recogniser names it, or null when it has none for it. */
  locale: string | null
  notes: 'available' | 'off' | 'unsupported'
  /** Without speech, what the whisper helper is missing: what to install. */
  missing?: TranscribeMissing[]
}

export type TranscribeEvent =
  | { kind: 'model'; fraction: number }
  | { kind: 'heard'; seconds: number; of: number }
  | { kind: 'notes'; part: number; of: number }

/** A helper and which one it is: Apple's (a binary) or whisper's (a script for Forge's Node). */
export interface Helper {
  path: string
  kind: 'apple' | 'whisper'
}

const APPLE_NAME = 'forge-transcribe'
const WHISPER_NAME = 'forge-transcribe-whisper.mjs'
const PLATFORMS: readonly NodeJS.Platform[] = ['darwin', 'win32', 'linux']

/**
 * Why transcribe is not offered here: what to install, in this OS's words.
 * The whisper helper says the same when run without them (its `needs`).
 */
export function transcribeNeeds(
  platform: NodeJS.Platform = process.platform,
  missing: readonly TranscribeMissing[] = ['whisper'],
): string {
  // Nothing named still means whisper: it is what every one of these OSes is told to get.
  const whisper = missing.includes('whisper') || !missing.includes('ffmpeg')
  const ffmpeg = missing.includes('ffmpeg')
  if (platform === 'darwin') {
    const what = [whisper && 'whisper.cpp', ffmpeg && 'ffmpeg'].filter(Boolean).join(' and ')
    const brew = [whisper && 'whisper-cpp', ffmpeg && 'ffmpeg'].filter(Boolean).join(' ')
    return `Transcribe on this Mac needs ${what}: brew install ${brew}.`
  }
  if (platform === 'win32') {
    const parts = [
      whisper && 'the whisper extension (forge extensions add whisper, or /extensions)',
      ffmpeg && 'ffmpeg (winget install ffmpeg)',
    ]
    return `Transcribe on Windows needs ${parts.filter(Boolean).join(' and ')}.`
  }
  if (platform === 'linux') {
    const parts = [
      whisper && 'whisper.cpp (forge extensions add whisper, or whisper-cli on your PATH)',
      ffmpeg && 'ffmpeg on your PATH',
    ]
    return `Transcribe on Linux needs ${parts.filter(Boolean).join(' and ')}.`
  }
  return 'Transcribe needs macOS, Windows or Linux.'
}

/**
 * Why notes are not written here: Apple Intelligence is off, or this machine
 * has none (Windows, Linux, a Mac without Apple's recogniser). Notes are the
 * one part that stays Apple's.
 */
export function notesNeed(
  platform: NodeJS.Platform = process.platform,
  notes: TranscribeStatus['notes'] = platform === 'darwin' ? 'off' : 'unsupported',
): string {
  if (notes === 'off') return 'Summary and notes need Apple Intelligence, and it is off.'
  const machine = platform === 'darwin' ? 'Mac' : 'computer'
  return `Summary and notes need Apple Intelligence, which this ${machine} does not have.`
}

/**
 * Where each helper may be, from the folder this module runs in: beside the
 * bundle in dist/helpers (published; the bundle is dist/index.js or a chunk in
 * dist/chunks), or the repo's own when run from source (src/engines).
 */
export function helperPaths(here: string): { apple: string[]; whisper: string[] } {
  return {
    apple: [
      join(here, 'helpers', APPLE_NAME),
      join(here, '..', 'helpers', APPLE_NAME),
      join(here, '..', '..', 'dist', 'helpers', APPLE_NAME),
    ],
    whisper: [
      join(here, 'helpers', WHISPER_NAME),
      join(here, '..', 'helpers', WHISPER_NAME),
      join(here, '..', '..', 'helpers', 'transcribe', WHISPER_NAME),
    ],
  }
}

/**
 * Which helper runs here. Windows and Linux: whisper's. A Mac: Apple's when
 * it is there and says it can hear (`appleSpeaks`), so Apple's recogniser
 * stays first wherever it works; otherwise (Intel, before macOS 26, a build
 * without it) whisper's. Undefined on any other OS.
 */
export async function chooseHelper(opts: {
  platform: NodeJS.Platform
  apple: string | undefined
  whisper: string | undefined
  appleSpeaks: (path: string) => Promise<boolean>
}): Promise<Helper | undefined> {
  if (!PLATFORMS.includes(opts.platform)) return undefined
  if (opts.platform === 'darwin' && opts.apple !== undefined) {
    const speaks = await opts.appleSpeaks(opts.apple).catch(() => false)
    if (speaks) return { path: opts.apple, kind: 'apple' }
  }
  return opts.whisper === undefined ? undefined : { path: opts.whisper, kind: 'whisper' }
}

/** Whether Apple's helper runs here and hears: an Intel Mac cannot start it, an older macOS fails it. */
function appleSpeaks(path: string): Promise<boolean> {
  return exec({ path, kind: 'apple' }, ['status'], '').then(
    (r) => r.speech === true,
    () => false,
  )
}

let chosen: Promise<Helper | undefined> | undefined

/**
 * The helper for this machine: FORGE_TRANSCRIBE_HELPER (tests; a .mjs is
 * whisper's), else `chooseHelper` over the files that are there. Chosen once
 * per process: the answer depends on the Mac, not on anything that changes.
 */
export function transcribeHelper(): Promise<Helper | undefined> {
  const pinned = process.env.FORGE_TRANSCRIBE_HELPER
  if (pinned !== undefined) {
    if (!existsSync(pinned)) return Promise.resolve(undefined)
    return Promise.resolve({ path: pinned, kind: pinned.endsWith('.mjs') ? 'whisper' : 'apple' })
  }
  if (chosen === undefined) {
    const paths = helperPaths(dirname(fileURLToPath(import.meta.url)))
    chosen = chooseHelper({
      platform: process.platform,
      apple: paths.apple.find((p) => existsSync(p)),
      whisper: paths.whisper.find((p) => existsSync(p)),
      appleSpeaks,
    })
  }
  return chosen
}

/**
 * What whisper's helper is handed: the ffmpeg the rest of Forge uses (PATH,
 * Homebrew, the video extension) and the whisper extension's whisper-cli,
 * unless the user named their own. And a stdin to close to stop it: on
 * Windows a kill could not reach its ffmpeg and whisper-cli.
 */
async function whisperEnv(): Promise<NodeJS.ProcessEnv> {
  const env: NodeJS.ProcessEnv = { ...process.env, FORGE_HELPER_STOP_ON_EOF: '1' }
  if (!env.FORGE_FFMPEG) {
    const tools = await findFfmpeg().catch(() => undefined)
    if (tools) env.FORGE_FFMPEG = tools.ffmpeg
  }
  if (!env.FORGE_WHISPER_CLI) {
    const ext = await installed('whisper')
    if (ext) env.FORGE_WHISPER_CLI = ext.entry
  }
  return env
}

type Line = Record<string, unknown>

/** Run the helper; every JSON line but the result goes to `onLine`; resolves with the result. */
async function call(
  args: string[],
  path: string,
  opts: { signal?: AbortSignal | undefined; onLine?: (line: Line) => void } = {},
): Promise<Line> {
  const helper = await transcribeHelper()
  if (helper === undefined) throw transcribeUnavailable(transcribeNeeds())
  return exec(helper, args, path, opts)
}

/** Grace for whisper's helper to stop its tools after its stdin closes, before it is killed. */
const STOP_GRACE_MS = 5000

async function exec(
  helper: Helper,
  args: string[],
  path: string,
  opts: { signal?: AbortSignal | undefined; onLine?: (line: Line) => void } = {},
): Promise<Line> {
  const { signal } = opts
  if (signal?.aborted) throw signal.reason ?? new Error('aborted')
  const whisper = helper.kind === 'whisper'
  const env = whisper ? await whisperEnv() : process.env
  if (signal?.aborted) throw signal.reason ?? new Error('aborted')
  return new Promise((resolve, reject) => {
    // Whisper's helper is a script for the Node Forge runs on; Apple's is a binary.
    const [cmd, argv] = whisper ? [process.execPath, [helper.path, ...args]] : [helper.path, args]
    const child = spawn(cmd, argv, {
      stdio: [whisper ? 'pipe' : 'ignore', 'pipe', 'ignore'],
      env,
      windowsHide: true,
    })
    // Closed early when the helper is gone; nothing to say about that.
    child.stdin?.on('error', () => {})
    let result: Line | undefined
    let settled = false
    const done = (f: () => void) => {
      if (settled) return
      settled = true
      signal?.removeEventListener('abort', onAbort)
      f()
    }
    const onAbort = () => {
      if (whisper && child.stdin) {
        // Its stdin closing is whisper's helper's cue to stop its tools and go.
        child.stdin.end()
        setTimeout(() => child.kill('SIGKILL'), STOP_GRACE_MS).unref()
      } else child.kill('SIGKILL')
      done(() => reject(signal?.reason ?? new Error('aborted')))
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    // Always a pipe (stdio above); its type cannot say so when stdin is chosen at run time.
    createInterface({ input: child.stdout as NodeJS.ReadableStream }).on('line', (text) => {
      let line: Line
      try {
        line = JSON.parse(text) as Line
      } catch {
        return
      }
      if ('ok' in line) result = line
      else opts.onLine?.(line)
    })
    child.on('error', (e) => done(() => reject(conversionFailed(path, e))))
    child.on('close', () =>
      done(() => {
        if (result === undefined)
          return reject(conversionFailed(path, new Error(`${APPLE_NAME} gave no result`)))
        if (result.ok === true) return resolve(result)
        reject(failure(String(result.code ?? ''), String(result.message ?? ''), path, args))
      }),
    )
  })
}

function failure(code: string, message: string, path: string, args: string[]): Error {
  if (code === 'no-sound') return noSound(path)
  if (code === 'unreadable') return untranscribable(path)
  if (code === 'locale') {
    const i = args.indexOf('--locale')
    return languageUnsupported(i >= 0 ? (args[i + 1] ?? 'this language') : "this Mac's language")
  }
  // unsupported: a tool is missing; runtime: whisper-cli is there but cannot start.
  if (code === 'unsupported' || code === 'runtime') return transcribeUnavailable(message)
  return conversionFailed(path, new Error(`${code}: ${message}`))
}

const MISSING: readonly TranscribeMissing[] = ['whisper', 'ffmpeg']

/** What this machine can do, or undefined when there is no helper at all. */
export async function transcribeStatus(
  opts: { locale?: string } = {},
): Promise<TranscribeStatus | undefined> {
  if ((await transcribeHelper()) === undefined) return undefined
  const args = ['status', ...(opts.locale ? ['--locale', opts.locale] : [])]
  const r = await call(args, '')
  const missing = Array.isArray(r.missing)
    ? MISSING.filter((m) => (r.missing as unknown[]).includes(m))
    : []
  return {
    speech: r.speech === true,
    locale: typeof r.locale === 'string' ? r.locale : null,
    notes: r.notes === 'available' || r.notes === 'off' ? r.notes : 'unsupported',
    ...(missing.length > 0 ? { missing } : {}),
  }
}

/** The sound's length; refuses a file with no sound or one the recogniser cannot read. */
export async function probeSound(path: string): Promise<{ seconds: number }> {
  const r = await call(['probe', path], path)
  return { seconds: Number(r.seconds) }
}

export async function runTranscribe(
  path: string,
  opts: {
    notes: boolean
    /** How much the notes say; the helper's own default (standard) when left out. */
    detail?: Detail | undefined
    locale?: string | undefined
    signal?: AbortSignal | undefined
    onEvent?: (e: TranscribeEvent) => void
  },
): Promise<Transcription & { locale: string }> {
  const args = [
    'run',
    path,
    ...(opts.locale ? ['--locale', opts.locale] : []),
    ...(opts.notes ? ['--notes'] : []),
    ...(opts.notes && opts.detail && opts.detail !== DEFAULT_DETAIL
      ? ['--detail', opts.detail]
      : []),
  ]
  const r = await call(args, path, {
    signal: opts.signal,
    onLine: (line) => {
      const e = eventOf(line)
      if (e) opts.onEvent?.(e)
    },
  })
  return {
    locale: String(r.locale),
    seconds: Number(r.seconds),
    segments: r.segments as Transcription['segments'],
    ...(r.notes ? { notes: r.notes as NonNullable<Transcription['notes']> } : {}),
  }
}

function eventOf(line: Line): TranscribeEvent | undefined {
  if (line.event === 'model') return { kind: 'model', fraction: Number(line.fraction) }
  if (line.event === 'heard')
    return { kind: 'heard', seconds: Number(line.seconds), of: Number(line.of) }
  if (line.event === 'notes') return { kind: 'notes', part: Number(line.part), of: Number(line.of) }
  return undefined
}
