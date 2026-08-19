import { buildPlan } from '../core/plan.js'
import { resolveInputs } from '../core/resolve.js'
import { runJobs } from '../core/run.js'
import type { Intent } from './args.js'
import { reportBatch, reportFailures, reportFormats, reportSingle } from './report.js'

export interface ExecuteResult {
  exitCode: 0 | 1 | 2
  stdout: string[]
  stderr: string[]
}

export interface BatchProgress {
  /** 0 on the first call, marking the batch's start. */
  completed: number
  total: number
}

export interface ExecuteOptions {
  /**
   * Called only for a batch (more than one job) and only driven by real
   * job:done / job:error events — never a fabricated percentage. execute()
   * itself never prints; this callback is how src/index.ts, the only layer
   * allowed to write to a stream, gets the data to do so.
   */
  onProgress?: (progress: BatchProgress) => void
}

export async function execute(intent: Intent, opts: ExecuteOptions = {}): Promise<ExecuteResult> {
  // Routed here rather than in src/index.ts so there is exactly one place
  // that turns an Intent into an ExecuteResult. The import is lazy because a
  // plain conversion has no reason to touch the config layer at all.
  if (intent.kind === 'config') {
    const { runConfig } = await import('./config-command.js')
    const result = await runConfig(intent)
    return { exitCode: result.exitCode as 0 | 1 | 2, stdout: result.stdout, stderr: [] }
  }

  if (intent.kind === 'formats') {
    return { exitCode: 0, stdout: reportFormats(), stderr: [] }
  }

  if (intent.kind === 'shell') {
    return { exitCode: 0, stdout: [], stderr: [] }
  }

  const resolved = await resolveInputs(intent.inputs, { recursive: intent.recursive })

  const planRequest = {
    resolved,
    target: intent.target,
    options: intent.options,
    force: intent.force,
    ...(intent.output === undefined ? {} : { output: intent.output }),
  }
  const plan = await buildPlan(planRequest)

  const isBatch = plan.jobs.length > 1
  if (isBatch) opts.onProgress?.({ completed: 0, total: plan.jobs.length })

  const summary = await runJobs(plan.jobs, {
    ...(intent.concurrency === undefined ? {} : { concurrency: intent.concurrency }),
    ...(isBatch && opts.onProgress
      ? {
          onEvent: (event) => {
            if (event.type === 'job:done' || event.type === 'job:error') {
              opts.onProgress?.({ completed: event.completed, total: event.total })
            }
          },
        }
      : {}),
  })

  const failures = [...plan.failures, ...summary.failures]

  const stdout =
    summary.results.length === 0
      ? []
      : summary.results.length === 1
        ? reportSingle(summary)
        : reportBatch(summary, intent.output)

  const stderr = reportFailures(failures, { debug: intent.debug })

  return { exitCode: failures.length > 0 ? 1 : 0, stdout, stderr }
}
