import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { type ForgeError, outputCollision, outputExists, outputIsInput } from './errors.js'
import type { InputFailure } from './resolve.js'
import type { Job } from './types.js'

export interface WriteSafetyResult {
  jobs: Job[]
  failures: InputFailure[]
}

/**
 * The first of a job's outputs that fails a write-safety rule, or undefined
 * if every output clears all three. Checked in the same order `buildPlan`
 * checks them (`core/plan.ts`): output-is-input, then collision, then
 * output-exists — so the two share not just the rules but the priority
 * between them when more than one applies to the same path.
 */
function firstUnsafeOutput(
  job: Job,
  claimed: ReadonlyMap<string, Job>,
  force: boolean,
): { output: string; error: ForgeError } | undefined {
  const sourcePaths = new Set(job.sources.map((s) => resolve(s.path)))
  const reportPath = job.sources[0]?.path ?? job.outputs[0] ?? ''

  for (const output of job.outputs) {
    const key = resolve(output)

    if (sourcePaths.has(key) && !force) {
      return { output, error: outputIsInput(output) }
    }

    const owner = claimed.get(key)
    if (owner) {
      const ownerPath = owner.sources[0]?.path ?? owner.outputs[0] ?? ''
      return { output, error: outputCollision([ownerPath, reportPath], output) }
    }

    if (existsSync(key) && !force) {
      return { output, error: outputExists(output) }
    }
  }

  return undefined
}

/**
 * Applies the three write-safety rules `buildPlan` enforces for conversions
 * — never write over an input, never replace an existing file without
 * `--force`, never let two writes collide on one path — to any `Job`,
 * whatever its arity.
 *
 * Page operations (merge, split, extract, delete, rotate) call
 * `Action.plan()` directly rather than `buildPlan`: `buildPlan` is shaped
 * around one-source-one-target conversions (`core/plan.ts`'s `PlanRequest`
 * takes a single `target` format and builds one job per source), which does
 * not fit an operation with several sources feeding one output (merge) or
 * one source feeding several outputs (split, a separated extract). This is
 * the one place both the CLI's page-operation path and, later, the shell's
 * carry the same rule rather than reimplementing it twice and letting the
 * two drift.
 *
 * Checked per job, all-or-nothing: if any one of a job's outputs fails any
 * rule, the whole job is refused — not just that output — before any of its
 * outputs are claimed. A split that wrote 3 of 4 files and then discovered
 * the 4th collides would break the same atomicity `writeAtomic` (Task 10)
 * already guarantees one job at a time; this is what guarantees it across
 * jobs too, before a single byte is written.
 *
 * Collision is checked regardless of `--force` — two writes racing onto one
 * path is a bug, not a preference, exactly as `buildPlan` treats it. `--force`
 * only overrides an existing file already on disk and an output that is also
 * the job's own input.
 */
export function checkWriteSafety(jobs: Job[], opts: { force: boolean }): WriteSafetyResult {
  const kept: Job[] = []
  const failures: InputFailure[] = []
  const claimed = new Map<string, Job>()

  for (const job of jobs) {
    const unsafe = firstUnsafeOutput(job, claimed, opts.force)
    if (unsafe) {
      const path = job.sources[0]?.path ?? unsafe.output
      failures.push({ path, error: unsafe.error })
      continue
    }

    for (const output of job.outputs) claimed.set(resolve(output), job)
    kept.push(job)
  }

  return { jobs: kept, failures }
}
