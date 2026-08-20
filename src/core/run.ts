import { cpus } from 'node:os'
import { engineForJob } from '../engines/registry.js'
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

export async function runJobs(
  jobs: Job[],
  opts: { concurrency?: number; onEvent?: (event: RunEvent) => void },
): Promise<RunSummary> {
  const emit = opts.onEvent ?? (() => {})
  // A caller-supplied concurrency that is not a finite number (NaN from a bad
  // parse, Infinity, ...) must never be allowed to collapse the worker count
  // to zero — that would silently convert nothing while still resolving.
  const requested = Number.isFinite(opts.concurrency) ? opts.concurrency : undefined
  const limit = Math.max(1, requested ?? defaultConcurrency())
  const total = jobs.length

  const results: Result[] = []
  const failures: InputFailure[] = []
  let completed = 0
  let cursor = 0

  async function worker(): Promise<void> {
    while (cursor < total) {
      const index = cursor++
      const job = jobs[index]
      if (!job) return

      emit({ type: 'job:start', job, index, total })

      const engine = engineForJob(job)
      if (!engine) {
        completed++
        const path = job.sources[0].path
        const failure: InputFailure = {
          path,
          error: conversionFailed(path, new Error(`no engine runs ${job.op}`)),
        }
        failures.push(failure)
        emit({ type: 'job:error', job, failure, completed, total })
        continue
      }

      try {
        const result = await engine.run(job, (progress) =>
          emit({ type: 'job:phase', job, progress }),
        )
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
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, total) }, worker))

  const summary: RunSummary = {
    results,
    failures,
    inputBytes: results.reduce((n, r) => n + r.job.sources[0].bytes, 0),
    outputBytes: results.reduce((n, r) => n + r.outputBytes, 0),
  }
  emit({ type: 'batch:done', summary })
  return summary
}
