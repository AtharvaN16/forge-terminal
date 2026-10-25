import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process'
import {
  boostTooLarge,
  boostTooSlow,
  conversionFailed,
  type ForgeError,
  noSubject,
} from '../core/errors.js'
import { withExtensionLock } from './lock.js'

/** Structural subset of `Installed` (paths.ts) — all the runner needs. */
export interface RunnableExtension {
  /** The catalogue id. With it, the job holds the tool's lock (lock.ts) while it runs. */
  id?: string
  entry: string
  kind: 'node' | 'exec'
  /**
   * The runner takes many jobs in one process (`--serve`, extensions/boost/
   * runner.ts): a batch then starts it, and opens its model, once. Only for an
   * installed version that has it (`boostServes`); every other runs one
   * process a job, as all of them always have.
   */
  serve?: boolean
}

export interface ExtensionJobResult {
  width: number
  height: number
  ms: number
  /** Only from jobs that report it (the heic runner's `--info`). */
  hasAlpha?: boolean
  /** Only from the read-text runner: each page's blocks, as the Mac helper's `read` gives them. */
  pages?: unknown[]
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
  /** Each JSON line before the result, as it comes (the read-text runner's page events). */
  onLine?: (line: Record<string, unknown>) => void
  /** A serving runner: how long it is kept for a next job after this one (`IDLE_MS`; tests shorten it). */
  idleMs?: number
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
    return ext.serve ? serveOne(ext, args, opts) : runOne(ext, args, opts)
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

function mapFailure(
  code: string,
  message: string,
  path: string,
  opts: RunOpts,
  args: string[],
  seconds?: number,
): ForgeError {
  if (code === 'no-subject') return noSubject(path)
  if (code === 'boost-too-large') return boostTooLarge(path, opts.maxScale ?? 0)
  if (code === 'boost-too-slow')
    return boostTooSlow(path, seconds ?? 0, Number(args[args.indexOf('--scale') + 1]))
  return conversionFailed(path, new Error(message))
}

/** A child's result line, as the contract has it. */
type Reply = {
  ok?: boolean
  width?: number
  height?: number
  ms?: number
  hasAlpha?: boolean
  pages?: unknown[]
  code?: string
  message?: string
  /** `boost-too-slow`: the runner's projected total. */
  seconds?: number
}

function resultOf(r: Reply): ExtensionJobResult {
  return {
    width: Number(r.width),
    height: Number(r.height),
    ms: Number(r.ms),
    ...(typeof r.hasAlpha === 'boolean' ? { hasAlpha: r.hasAlpha } : {}),
    ...(Array.isArray(r.pages) ? { pages: r.pages } : {}),
  }
}

function failureOf(r: Reply, path: string, opts: RunOpts, args: string[]): ForgeError {
  return mapFailure(
    String(r.code ?? ''),
    String(r.message ?? ''),
    path,
    opts,
    args,
    typeof r.seconds === 'number' ? r.seconds : undefined,
  )
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
      if (!opts.onProgress && !opts.onLine) return
      // A chunk can end mid-line: only whole lines are read.
      const lines = (pending + d).split('\n')
      pending = lines.pop() ?? ''
      for (const l of lines) {
        const count = progressOf(l)
        if (count) {
          opts.onProgress?.(count.done, count.of)
          continue
        }
        if (!opts.onLine || !l.trim().startsWith('{')) continue
        try {
          const parsed = JSON.parse(l) as Record<string, unknown>
          if (!('ok' in parsed)) opts.onLine(parsed)
        } catch {
          // Not a line of ours: a library's noise.
        }
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
        const r = parsed as Reply | undefined
        if (r && r.ok === true && status === 0) return resolve(resultOf(r))
        if (r && r.ok === false) return reject(failureOf(r, path, opts, args))
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

/**
 * How long a serving runner waits, its model open, for the next job. A batch
 * hands it the next file as the last is answered (the pool decodes ahead), so
 * this only has to outlast the gap between two files; then the process goes,
 * and with it the memory the model holds.
 */
const IDLE_MS = 5_000

/** What a job running on a server hears from it. */
interface Listener {
  line(line: string): void
  /** The process has exited (its output may still be draining). */
  exit(): void
  /** Its output has closed too: there will be no result. */
  close(status: string): void
  error(err: Error): void
}

/** Pipes and the process itself can be let go of so that they do not keep Forge running. */
type Holdable = { ref?(): void; unref?(): void }

/**
 * One `--serve` runner. While a job runs it keeps Forge's process alive, as a
 * one-job child does; between jobs it does not, so a forge that is done exits,
 * and the runner, its stdin closed with it, exits too. It is let go after
 * `IDLE_MS` with no job, or when its tool is removed or updated.
 */
class Server {
  readonly child: ChildProcessWithoutNullStreams
  listener: Listener | undefined
  exited = false
  /** What the runner said on stderr since the current job began, for a failure's wording. */
  said = ''
  private idle: NodeJS.Timeout | undefined

  constructor(readonly ext: RunnableExtension) {
    const [cmd, argv] =
      ext.kind === 'node' ? [process.execPath, [ext.entry, '--serve']] : [ext.entry, ['--serve']]
    this.child = spawn(cmd, argv, { stdio: ['pipe', 'pipe', 'pipe'] })
    let pending = ''
    this.child.stdout.setEncoding('utf8').on('data', (d: string) => {
      // A chunk can end mid-line: only whole lines are read.
      const lines = (pending + d).split('\n')
      pending = lines.pop() ?? ''
      for (const l of lines) this.listener?.line(l)
    })
    this.child.stderr.setEncoding('utf8').on('data', (d: string) => {
      this.said = (this.said + d).slice(-2000)
    })
    // A runner that died is reported by its exit, not by the write that found it gone.
    this.child.stdin.on('error', () => {})
    this.child.on('error', (err) => {
      this.gone()
      this.listener?.error(err)
    })
    this.child.on('exit', () => {
      this.gone()
      this.listener?.exit()
    })
    this.child.on('close', (code, signal) => this.listener?.close(signal ?? `exit ${code}`))
  }

  private gone(): void {
    this.exited = true
    clearTimeout(this.idle)
    if (servers.get(this.ext.entry) === this) servers.delete(this.ext.entry)
  }

  private holdAll(how: 'ref' | 'unref'): void {
    for (const h of [this.child, this.child.stdin, this.child.stdout, this.child.stderr])
      (h as Holdable)[how]?.()
  }

  /** A job starts: Forge stays up for it. */
  hold(listener: Listener): void {
    clearTimeout(this.idle)
    this.said = ''
    this.listener = listener
    this.holdAll('ref')
  }

  /** The job is answered: wait for the next one, without keeping Forge up. */
  rest(idleMs: number): void {
    this.listener = undefined
    this.holdAll('unref')
    this.idle = setTimeout(() => void this.close(), idleMs)
    this.idle.unref()
  }

  /** Closes its stdin, which the runner takes as the end; killed if it has not gone in 3 s. */
  close(): Promise<void> {
    return new Promise((resolve) => {
      if (this.exited) return resolve()
      this.gone()
      const timer = setTimeout(() => this.child.kill('SIGKILL'), 3000)
      timer.unref()
      this.child.once('exit', () => {
        clearTimeout(timer)
        resolve()
      })
      this.child.stdin.end()
    })
  }
}

/** The serving runners this forge has, by entry: one per installed version of a tool. */
const servers = new Map<string, Server>()

function serverFor(ext: RunnableExtension): Server {
  // An update moved the tool to a new entry: the old version's runner is let go.
  for (const s of [...servers.values()])
    if (ext.id !== undefined && s.ext.id === ext.id && s.ext.entry !== ext.entry && !s.listener)
      void s.close()
  const have = servers.get(ext.entry)
  if (have && !have.exited && !have.listener) return have
  const fresh = new Server(ext)
  servers.set(ext.entry, fresh)
  return fresh
}

/**
 * Lets go of the serving runners of `id` (of every tool without one) that are
 * waiting for a job, and resolves once they have exited: before a tool's files
 * are removed or replaced, which Windows refuses while a process has them open.
 * One running a job is left: that job holds the tool's lock, so the removal
 * is refused anyway.
 */
export async function closeExtensionServers(id?: string): Promise<void> {
  await Promise.all(
    [...servers.values()]
      .filter((s) => (id === undefined || s.ext.id === id) && !s.listener)
      .map((s) => s.close()),
  )
}

/**
 * One job on a serving runner: the same arguments as a one-job child, sent
 * as a line, and the same lines back: counts, then one result. A job aborted
 * kills the runner, as it kills a one-job child (the next job starts a new
 * one); a runner that dies fails the job it was on, and only that one.
 */
function serveOne(
  ext: RunnableExtension,
  args: string[],
  opts: RunOpts,
): Promise<ExtensionJobResult> {
  const { signal } = opts
  const path = opts.subject ?? subjectPath(args)
  if (signal?.aborted) return Promise.reject(signal.reason ?? new Error('aborted'))
  const server = serverFor(ext)

  return new Promise((resolve, reject) => {
    let settled = false
    const done = (fn: () => void) => {
      if (settled) return
      settled = true
      signal?.removeEventListener('abort', onAbort)
      fn()
    }
    // Settled once the runner has exited, as with a one-job child: the caller
    // removes the job's temp dir next.
    const onAbort = () => server.child.kill('SIGKILL')
    signal?.addEventListener('abort', onAbort, { once: true })

    server.hold({
      line(l) {
        const count = progressOf(l)
        if (count) return opts.onProgress?.(count.done, count.of)
        if (!l.trim().startsWith('{')) return
        let r: Reply & Record<string, unknown>
        try {
          r = JSON.parse(l) as Reply & Record<string, unknown>
        } catch {
          return // Not a line of ours: a library's noise.
        }
        if (!('ok' in r)) return opts.onLine?.(r)
        done(() => {
          server.rest(opts.idleMs ?? IDLE_MS)
          if (r.ok === true) resolve(resultOf(r))
          else reject(failureOf(r, path, opts, args))
        })
      },
      exit() {
        if (signal?.aborted) done(() => reject(signal.reason ?? new Error('aborted')))
      },
      close(status) {
        done(() =>
          reject(
            conversionFailed(
              path,
              new Error(
                `extension exited ${status} without a result: ${server.said.trim().slice(-500)}`,
              ),
            ),
          ),
        )
      },
      error(e) {
        done(() => reject(conversionFailed(path, e)))
      },
    })
    server.child.stdin.write(`${JSON.stringify({ args })}\n`)
  })
}
