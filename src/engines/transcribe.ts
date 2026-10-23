/**
 * The transcribe helper, `forge-transcribe` (spec 2026-10-17-transcribe-design
 * §4.1): a Swift program built into dist/helpers on macOS. Apple's speech
 * recogniser writes the transcript and Apple's on-device model the notes;
 * this file only finds the helper, runs it, and turns its JSON lines into
 * data and `ForgeError`s. On Linux the helper is `forge-transcribe-linux.mjs`,
 * which speaks the same lines over whisper.cpp and ffmpeg (no notes).
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

export interface TranscribeStatus {
  speech: boolean
  /** The Mac's language as the recogniser names it, or null when it has none for it. */
  locale: string | null
  notes: 'available' | 'off' | 'unsupported'
}

export type TranscribeEvent =
  | { kind: 'model'; fraction: number }
  | { kind: 'heard'; seconds: number; of: number }
  | { kind: 'notes'; part: number; of: number }

const NAME = 'forge-transcribe'
const LINUX_NAME = 'forge-transcribe-linux.mjs'

/** Why transcribe is not offered here, in the user's words for this OS. */
export function transcribeNeeds(platform: NodeJS.Platform = process.platform): string {
  return platform === 'linux'
    ? 'Transcribe on Linux needs ffmpeg and whisper.cpp (whisper-cli) on your PATH.'
    : 'Transcribe needs macOS 26 or later on Apple silicon.'
}

/** Why notes are not written here: Apple Intelligence is off, or (Linux) there is none. */
export function notesNeed(platform: NodeJS.Platform = process.platform): string {
  return platform === 'linux'
    ? 'Summary and notes need Apple Intelligence, which Linux does not have.'
    : 'Summary and notes need Apple Intelligence, and it is off.'
}

/**
 * Where the helper is: FORGE_TRANSCRIBE_HELPER (tests), beside the bundle in
 * dist/helpers (published), or the repo's dist/helpers when run from source.
 */
export function transcribeHelper(): string | undefined {
  const pinned = process.env.FORGE_TRANSCRIBE_HELPER
  if (pinned !== undefined) return existsSync(pinned) ? pinned : undefined
  if (process.platform !== 'darwin' && process.platform !== 'linux') return undefined
  const here = dirname(fileURLToPath(import.meta.url))
  // The bundle is dist/index.js or a chunk in dist/chunks; from source this is src/engines.
  if (process.platform === 'linux') {
    return [
      join(here, 'helpers', LINUX_NAME),
      join(here, '..', 'helpers', LINUX_NAME),
      join(here, '..', '..', 'helpers', 'transcribe', LINUX_NAME),
    ].find((p) => existsSync(p))
  }
  return [
    join(here, 'helpers', NAME),
    join(here, '..', 'helpers', NAME),
    join(here, '..', '..', 'dist', 'helpers', NAME),
  ].find((p) => existsSync(p))
}

type Line = Record<string, unknown>

/** Run the helper; every JSON line but the result goes to `onLine`; resolves with the result. */
function call(
  args: string[],
  path: string,
  opts: { signal?: AbortSignal | undefined; onLine?: (line: Line) => void } = {},
): Promise<Line> {
  const helper = transcribeHelper()
  if (helper === undefined) return Promise.reject(transcribeUnavailable(transcribeNeeds()))
  const { signal } = opts
  if (signal?.aborted) return Promise.reject(signal.reason ?? new Error('aborted'))
  return new Promise((resolve, reject) => {
    // The Linux helper is a script for the Node Forge runs on; the Swift one is a binary.
    const [cmd, argv] = helper.endsWith('.mjs')
      ? [process.execPath, [helper, ...args]]
      : [helper, args]
    const child = spawn(cmd, argv, { stdio: ['ignore', 'pipe', 'ignore'] })
    let result: Line | undefined
    let settled = false
    const done = (f: () => void) => {
      if (settled) return
      settled = true
      signal?.removeEventListener('abort', onAbort)
      f()
    }
    const onAbort = () => {
      child.kill('SIGKILL')
      done(() => reject(signal?.reason ?? new Error('aborted')))
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    createInterface({ input: child.stdout }).on('line', (text) => {
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
          return reject(conversionFailed(path, new Error(`${NAME} gave no result`)))
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
  if (code === 'unsupported') return transcribeUnavailable(message)
  return conversionFailed(path, new Error(`${code}: ${message}`))
}

/** What this Mac can do, or undefined when there is no helper at all. */
export async function transcribeStatus(
  opts: { locale?: string } = {},
): Promise<TranscribeStatus | undefined> {
  if (transcribeHelper() === undefined) return undefined
  const args = ['status', ...(opts.locale ? ['--locale', opts.locale] : [])]
  const r = await call(args, '')
  return {
    speech: r.speech === true,
    locale: typeof r.locale === 'string' ? r.locale : null,
    notes: r.notes === 'available' || r.notes === 'off' ? r.notes : 'unsupported',
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
