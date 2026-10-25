import { cpus } from 'node:os'
import { engineForJob } from '../engines/registry.js'
import type { Engine } from '../engines/types.js'
import { conversionFailed, isForgeError } from './errors.js'
import type { InputFailure } from './resolve.js'
import type { Job, Progress, Result } from './types.js'

export type RunEvent =
  | { type: 'job:start'; job: Job; index: number; total: number }
  | { type: 'job:phase'; job: Job; progress: Progress }
  | { type: 'job:done'; job: Job; result: Result; completed: number; total: number }
  | { type: 'job:error'; job: Job; failure: InputFailure; completed: number; total: number }
  | { type: 'batch:done'; summary: RunSummary }

export interface RunSummary {
  results: Result[]
  failures: InputFailure[]
  inputBytes: number
  outputBytes: number
}

/** Sharp dispatches into libuv's threadpool; unbounded dispatch thrashes it. */
export function defaultConcurrency(): number {
  return Math.max(1, Math.min(cpus().length, 4))
}

/**
 * A worker count from what the caller asked for. A value that is not a
 * finite number (NaN from a bad parse, Infinity, ...) must never collapse the
 * pool to zero, which would silently do nothing while still resolving.
 */
export function resolveConcurrency(requested?: number): number {
  const finite = requested !== undefined && Number.isFinite(requested) ? requested : undefined
  return Math.max(1, finite ?? defaultConcurrency())
}

/**
 * Runs `task` once per item, at most `limit` at a time, starting them in
 * order. The one concurrency pool in Forge: conversions (`runJobs`) and
 * target-size searches (`runPlan`) both go through it, so a search cannot
 * oversubscribe the libuv threadpool that Sharp already shares with them.
 *
 * Items `alone` picks also run one at a time among themselves, still counted
 * against `limit`. One waiting its turn does not hold a worker: the next item
 * that may start does, so pictures keep the pool full around a video encode.
 *
 * `task` must not throw. A rejection would leave the other workers running
 * with nobody waiting for them.
 */
export async function pool<T>(
  items: readonly T[],
  limit: number,
  task: (item: T, index: number) => Promise<void>,
  alone?: (item: T) => boolean,
): Promise<void> {
  // Two queues of indexes, each in item order; the lower head starts first.
  const shared: number[] = []
  const single: number[] = []
  for (const [index, item] of items.entries()) (alone?.(item) ? single : shared).push(index)
  let nextShared = 0
  let nextSingle = 0
  let running: Promise<void> | undefined

  const worker = async (): Promise<void> => {
    for (;;) {
      const a = shared[nextShared]
      const b = running ? undefined : single[nextSingle]
      if (a !== undefined && (b === undefined || a < b)) {
        nextShared++
        await task(items[a] as T, a)
      } else if (b !== undefined) {
        nextSingle++
        // Cleared before anyone waiting on it wakes, so they see it free.
        running = task(items[b] as T, b).finally(() => {
          running = undefined
        })
        await running
      } else if (running) {
        // Only items that must wait for the one running are left.
        await running
      } else {
        return
      }
    }
  }
  const workers = Math.min(resolveConcurrency(limit), items.length)
  await Promise.all(Array.from({ length: workers }, worker))
}

export async function runJobs(
  jobs: Job[],
  opts: {
    concurrency?: number
    onEvent?: (event: RunEvent) => void
    /**
     * Resolves the engine for a job. Defaults to the registry; `runPlan`
     * threads its own through so a test can drive the whole pipeline against a
     * stub engine without reaching the real encoders.
     */
    engineFor?: (job: Job) => Engine | undefined
    /** Handed to each engine; an aborted job lands in `failures`. */
    signal?: AbortSignal
  },
): Promise<RunSummary> {
  const emit = opts.onEvent ?? (() => {})
  const resolveEngine = opts.engineFor ?? engineForJob
  const limit = resolveConcurrency(opts.concurrency)
  const total = jobs.length

  // Slotted by job index and compacted at the end, so results and failures
  // are reported in the order the jobs were given, not the order they finished.
  const resultAt: (Result | undefined)[] = []
  const failureAt: (InputFailure | undefined)[] = []
  let completed = 0

  const alone = (job: Job) => resolveEngine(job)?.alone === true
  await pool(
    jobs,
    limit,
    async (job, index) => {
      // Stopped: the jobs already running finish; no new one starts.
      if (opts.signal?.aborted) return
      emit({ type: 'job:start', job, index, total })

      const engine = resolveEngine(job)
      if (!engine) {
        completed++
        const path = job.sources[0].path
        const failure: InputFailure = {
          path,
          error: conversionFailed(path, new Error(`no engine runs ${job.op}`)),
        }
        failureAt[index] = failure
        emit({ type: 'job:error', job, failure, completed, total })
        return
      }

      try {
        const result = await engine.run(
          job,
          (progress) => emit({ type: 'job:phase', job, progress }),
          opts.signal,
        )
        resultAt[index] = result
        completed++
        emit({ type: 'job:done', job, result, completed, total })
      } catch (e) {
        completed++
        const path = job.sources[0].path
        const error = isForgeError(e) ? e : conversionFailed(path, e)
        const failure: InputFailure = { path, error }
        failureAt[index] = failure
        emit({ type: 'job:error', job, failure, completed, total })
      }
    },
    alone,
  )

  const results = resultAt.filter((r): r is Result => r !== undefined)
  const failures = failureAt.filter((f): f is InputFailure => f !== undefined)
  const summary: RunSummary = {
    results,
    failures,
    inputBytes: results.reduce((n, r) => n + r.job.sources[0].bytes, 0),
    outputBytes: results.reduce((n, r) => n + r.outputBytes, 0),
  }
  emit({ type: 'batch:done', summary })
  return summary
}
