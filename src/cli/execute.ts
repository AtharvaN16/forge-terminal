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

export async function execute(intent: Intent): Promise<ExecuteResult> {
  if (intent.kind === 'formats') {
    return { exitCode: 0, stdout: reportFormats(), stderr: [] }
  }

  if (intent.kind === 'shell') {
    return {
      exitCode: 2,
      stdout: [],
      stderr: ['The interactive shell is not built yet. Use --to for now, or --help.'],
    }
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

  const summary = await runJobs(
    plan.jobs,
    intent.concurrency === undefined ? {} : { concurrency: intent.concurrency },
  )

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
