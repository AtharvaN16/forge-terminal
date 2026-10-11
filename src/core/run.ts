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
 * `task` must not throw. A rejection would leave the other workers running
 * with nobody waiting for them.
 */
export async function pool<T>(
  items: readonly T[],
  limit: number,
  task: (item: T, index: number) => Promise<void>,
): Promise<void> {
  let cursor = 0
  const worker = async (): Promise<void> => {
    while (cursor < items.length) {
      const index = cursor++
      await task(items[index] as T, index)
    }
  }
  await Promise.all(Array.from({ length: Math.min(Math.max(1, limit), items.length) }, worker))
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
  },
): Promise<RunSummary> {
  const emit = opts.onEvent ?? (() => {})
  const resolveEngine = opts.engineFor ?? engineForJob
  const limit = resolveConcurrency(opts.concurrency)
  const total = jobs.length

  const results: Result[] = []
  const failures: InputFailure[] = []
  let completed = 0

  await pool(jobs, limit, async (job, index) => {
    emit({ type: 'job:start', job, index, total })

    const engine = resolveEngine(job)
    if (!engine) {
      completed++
      const path = job.sources[0].path
      const failure: InputFailure = {
        path,
        error: conversionFailed(path, new Error(`no engine runs ${job.op}`)),
      }
      failures.push(failure)
      emit({ type: 'job:error', job, failure, completed, total })
      return
    }

    try {
      const result = await engine.run(job, (progress) => emit({ type: 'job:phase', job, progress }))
      results.push(result)
      completed++
      emit({ type: 'job:done', job, result, completed, total })
    } catch (e) {
      completed++
      const path = job.sources[0].path
      const error = isForgeError(e) ? e : conversionFailed(path, e)
      const failure: InputFailure = { path, error }
      failures.push(failure)
      emit({ type: 'job:error', job, failure, completed, total })
    }
  })

  const summary: RunSummary = {
    results,
    failures,
    inputBytes: results.reduce((n, r) => n + r.job.sources[0].bytes, 0),
    outputBytes: results.reduce((n, r) => n + r.outputBytes, 0),
  }
  emit({ type: 'batch:done', summary })
  return summary
}
