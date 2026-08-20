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
 * A job whose own `outputs` list names the same path twice — two of its own
 * parts would silently alias one file, the last write winning and the rest
 * simply vanishing. Checked before anything else: `claimed` only learns
 * about a job's outputs once the whole job has already cleared every check
 * (see the loop in `checkWriteSafety`), and nothing has been written yet at
 * check time either, so neither the cross-job collision check nor
 * `existsSync` can see this — a job can only collide with itself here.
 *
 * Not reachable through the shipped CLI today (every action's `plan()`
 * structurally guarantees unique outputs within one job — `splitOutputPaths`,
 * `extractOutputPaths` fed by `parseRanges`'s deduped `Set`), but
 * `extractAction`'s `selectedPages` also accepts a raw `values.pages` array
 * for a future caller — the shell's page grid — that would bypass that
 * dedup, so this module, built to be shared with exactly that caller, checks
 * for it regardless of who is calling today.
 *
 * Never overridable by `--force`: unlike a stale file on disk or an output
 * that happens to equal an input, this is not a choice between two outcomes
 * the user might genuinely want — it is the job's own plan asking to write
 * two different things to one path, which can only be a bug in whatever
 * produced the job, not a preference `--force` could sensibly express.
 */
function firstSelfCollision(job: Job): { output: string; error: ForgeError } | undefined {
  const reportPath = job.sources[0]?.path ?? job.outputs[0] ?? ''
  const seen = new Set<string>()

  for (const output of job.outputs) {
    const key = resolve(output)
    if (seen.has(key)) {
      return { output, error: outputCollision([reportPath, reportPath], output) }
    }
    seen.add(key)
  }

  return undefined
}

/**
 * The first of a job's outputs that fails a write-safety rule, or undefined
 * if every output clears all four. Checked in the same order `buildPlan`
 * checks its three (`core/plan.ts`): output-is-input, then collision, then
 * output-exists — so the two share not just the rules but the priority
 * between them when more than one applies to the same path. Self-collision
 * (a job's own outputs duplicating a path) is checked ahead of all three,
 * since it needs neither `claimed` nor the filesystem to detect and a job
 * that fails it is unsafe regardless of what else is true about it.
 */
function firstUnsafeOutput(
  job: Job,
  claimed: ReadonlyMap<string, Job>,
  force: boolean,
): { output: string; error: ForgeError } | undefined {
  const selfCollision = firstSelfCollision(job)
  if (selfCollision) return selfCollision

  const sourcePaths = new Set(job.sources.map((s) => resolve(s.path)))
  const reportPath = job.sources[0]?.path ?? job.outputs[0] ?? ''

  for (const output of job.outputs) {
    const key = resolve(output)

    if (sourcePaths.has(key) && !force) {
      return { output, error: outputIsInput(output, job.op) }
    }

    const owner = claimed.get(key)
    if (owner) {
      const ownerPath = owner.sources[0]?.path ?? owner.outputs[0] ?? ''
      return { output, error: outputCollision([ownerPath, reportPath], output) }
    }

    if (existsSync(key) && !force) {
      return { output, error: outputExists(output, job.op) }
    }
  }

  return undefined
}

/**
 * Applies the three write-safety rules `buildPlan` enforces for conversions
 * — never write over an input, never replace an existing file without
 * `--force`, never let two writes collide on one path — to any `Job`,
 * whatever its arity, plus one rule `buildPlan` never needed: never let a
 * single job's own outputs collide with each other (`firstSelfCollision`),
 * which only exists once a job can have more than one output at all.
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
 * Both refusals are told which operation raised them, because their hints
 * differ: only a conversion can be sent somewhere else with `--output` (see
 * `takesOutputFlag` in `core/errors.ts`), so a page operation is offered a
 * way out it can actually take.
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
