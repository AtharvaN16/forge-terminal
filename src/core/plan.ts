import { targetIdsFor } from './capabilities.js'
import { unsupportedTarget } from './errors.js'
import { resolveOutputPath } from './output-path.js'
import type { InputFailure, ResolvedInput } from './resolve.js'
import type { ConvertOptions, FormatId, Job } from './types.js'
import { checkWriteSafety } from './write-safety.js'

export interface PlanRequest {
  resolved: ResolvedInput
  target: FormatId
  output?: string
  options: ConvertOptions
  force: boolean
  /**
   * Hand back every planned job unchecked, leaving write safety to the
   * caller. Only `src/cli/execute.ts` sets it, and only because a conversion
   * run can plan jobs on two paths at once: a document source rasterising
   * through `convertAction.plan()` (one source, many outputs — a shape
   * `buildPlan` cannot express) and everything else through here. Two
   * independent `checkWriteSafety` passes cannot see a collision *between*
   * the two sets, so the caller runs one pass over the union instead. Left
   * off, `buildPlan` checks its own jobs exactly as it always has.
   */
  deferWriteSafety?: boolean
}

export interface Plan {
  jobs: Job[]
  failures: InputFailure[]
}

/**
 * Pure with respect to conversion — it decides what will happen and what will
 * not, so every refusal surfaces before a single byte is written.
 */
export async function buildPlan(req: PlanRequest): Promise<Plan> {
  const jobs: Job[] = []
  const failures: InputFailure[] = [...req.resolved.failures]

  for (const source of req.resolved.sources) {
    const available = targetIdsFor(source)
    if (!available.includes(req.target)) {
      failures.push({
        path: source.path,
        error: unsupportedTarget(source, req.target, available),
      })
      continue
    }

    const output = resolveOutputPath({
      sourcePath: source.path,
      target: req.target,
      output: req.output,
      sourceRoot: req.resolved.roots.get(source.path),
    })

    jobs.push({
      op: 'convert',
      sources: [source],
      outputs: [output],
      target: req.target,
      options: req.options,
    })
  }

  if (req.deferWriteSafety) return { jobs, failures }

  // The write-safety rules live in exactly one module (`core/write-safety.ts`),
  // not once here and once there: two copies of "never overwrite an input,
  // never collide, never replace without --force" are two chances for the
  // page-operation path and the conversion path to drift apart on what is
  // refused and in what order.
  const safe = checkWriteSafety(jobs, { force: req.force })
  return { jobs: safe.jobs, failures: [...failures, ...safe.failures] }
}
