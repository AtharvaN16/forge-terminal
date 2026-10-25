import { spawn } from 'node:child_process'
import { boostTooLarge, conversionFailed, type ForgeError, noSubject } from '../core/errors.js'
import { withExtensionLock } from './lock.js'

/** Structural subset of `Installed` (paths.ts) — all the runner needs. */
export interface RunnableExtension {
  /** The catalogue id. With it, the job holds the tool's lock (lock.ts) while it runs. */
  id?: string
  entry: string
  kind: 'node' | 'exec'
}

export interface ExtensionJobResult {
  width: number
  height: number
  ms: number
  /** Only from jobs that report it (the heic runner's `--info`). */
  hasAlpha?: boolean
}

type RunOpts = {
  signal?: AbortSignal
  /** The user's file, for error wording — the args only name Forge's temp copy. */
  subject?: string
  /**
   * The boost factor Forge already worked out the source can take. Used if the
   * child still refuses a size; the runner's own refusal names no factor, and
   * the requested one would be wrong.
   */
  maxScale?: number
  /** What this job is, as a sentence, for another forge's manage screen ("Boost resolution 4× is running on photo.jpg"). */
  what?: string
  /** Another forge holds the tool: this job is waiting for it. */
  onWait?: () => void
  /** The tool is this job's and the child is about to start. */
  onStart?: () => void
  /**
   * A child that counts its work says so as `{"progress":12,"of":48}` lines
   * before its result: tiles done, of the tiles the job was cut into.
   */
  onProgress?: (done: number, of: number) => void
  /** Which queue the job joins (see `tails`). */
  platform?: NodeJS.Platform
}

/**
 * Jobs run one at a time per process on macOS — both extensions there are
 * heavy. On Windows one queue per tool instead: the HEIC extension's probe
 * and decode are quick, and must not wait behind a Boost that takes minutes
 * on the CPU fallback, which looks like a hang.
 */
const tails = new Map<string | undefined, Promise<unknown>>()

/**
 * Runs one job, after any this process already has queued. Across processes
 * the tool's lock does the same: a second forge's job waits for the first
 * (up to `WAIT_MS`, then `extension-in-use`) rather than failing at once —
 * two of these at the same time would only fight for the same memory — and
 * `removeExtension` refuses while the lock is held.
 */
export function runExtension(
  ext: RunnableExtension,
  args: string[],
  opts: RunOpts = {},
): Promise<ExtensionJobResult> {
  const one = () => {
    opts.onStart?.()
    return runOne(ext, args, opts)
  }
  const queue = (opts.platform ?? process.platform) === 'darwin' ? undefined : ext.id
  const tail = tails.get(queue) ?? Promise.resolve()
  const job = tail.then(() =>
    ext.id === undefined
      ? one()
      : withExtensionLock(ext.id, one, {
          ...(opts.what !== undefined ? { what: opts.what } : {}),
          ...(opts.signal !== undefined ? { signal: opts.signal } : {}),
          ...(opts.onWait !== undefined ? { onWait: opts.onWait } : {}),
        }),
  )
  tails.set(
    queue,
    job.catch(() => undefined),
  )
  return job
}

/** The path the failing job concerned, for error wording: the value after `--in`, else the first argument. */
function subjectPath(args: string[]): string {
  const i = args.indexOf('--in')
  return (i >= 0 ? args[i + 1] : args[0]) ?? ''
}

/** A child's count line, or nothing: any other line is a library talking. */
function progressOf(line: string): { done: number; of: number } | undefined {
  if (!line.startsWith('{"progress"')) return undefined
  try {
    const r = JSON.parse(line) as { progress?: unknown; of?: unknown }
    if (typeof r.progress !== 'number' || typeof r.of !== 'number' || r.of <= 0) return undefined
    return { done: r.progress, of: r.of }
  } catch {
    return undefined
  }
}

function mapFailure(code: string, message: string, path: string, opts: RunOpts): ForgeError {
  if (code === 'no-subject') return noSubject(path)
  if (code === 'boost-too-large') return boostTooLarge(path, opts.maxScale ?? 0)
  return conversionFailed(path, new Error(message))
}

function runOne(
  ext: RunnableExtension,
  args: string[],
  opts: RunOpts,
): Promise<ExtensionJobResult> {
  const { signal } = opts
  const path = opts.subject ?? subjectPath(args)
  if (signal?.aborted) return Promise.reject(signal.reason ?? new Error('aborted'))

  return new Promise((resolve, reject) => {
    const [cmd, argv] =
      ext.kind === 'node' ? [process.execPath, [ext.entry, ...args]] : [ext.entry, args]
    const child = spawn(cmd, argv, { stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    let err = ''
    let settled = false
    const done = (fn: () => void) => {
      if (settled) return
      settled = true
      signal?.removeEventListener('abort', onAbort)
      fn()
    }
    // Settled once the child has exited, not here: the caller removes the
    // child's temp dir next, and a child still writing there leaves debris.
    const onAbort = () => child.kill('SIGKILL')
    child.on('exit', () => {
      if (signal?.aborted) done(() => reject(signal.reason ?? new Error('aborted')))
    })
    signal?.addEventListener('abort', onAbort, { once: true })

    let pending = ''
    child.stdout.setEncoding('utf8').on('data', (d: string) => {
      out += d
      if (!opts.onProgress) return
      // A chunk can end mid-line: only whole lines are read.
      const lines = (pending + d).split('\n')
      pending = lines.pop() ?? ''
      for (const line of lines) {
        const count = progressOf(line)
        if (count) opts.onProgress(count.done, count.of)
      }
    })
    child.stderr.setEncoding('utf8').on('data', (d: string) => {
      err += d
    })
    child.on('error', (e) => done(() => reject(conversionFailed(path, e))))
    child.on('close', (status) =>
      done(() => {
        // The result is the last JSON line: anything a library printed earlier is noise.
        const line = out
          .split('\n')
          .filter((l) => l.trim().startsWith('{'))
          .at(-1)
        let parsed: unknown
        try {
          parsed = line ? JSON.parse(line) : undefined
        } catch {
          parsed = undefined
        }
        const r = parsed as
          | {
              ok?: boolean
              width?: number
              height?: number
              ms?: number
              hasAlpha?: boolean
              code?: string
              message?: string
            }
          | undefined
        if (r && r.ok === true && status === 0) {
          return resolve({
            width: Number(r.width),
            height: Number(r.height),
            ms: Number(r.ms),
            ...(typeof r.hasAlpha === 'boolean' ? { hasAlpha: r.hasAlpha } : {}),
          })
        }
        if (r && r.ok === false) {
          return reject(mapFailure(String(r.code ?? ''), String(r.message ?? ''), path, opts))
        }
        reject(
          conversionFailed(
            path,
            new Error(
              `extension exited ${status} without a result: ${(err || out).trim().slice(-500)}`,
            ),
          ),
        )
      }),
    )
  })
}
