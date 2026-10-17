import { resolve } from 'node:path'
import { targetIdsFor } from './capabilities.js'
import { unsupportedTarget } from './errors.js'
import { resolveOutputPath, suffixedImagePath } from './output-path.js'
import type { InputFailure, ResolvedInput } from './resolve.js'
import type { ConvertOptions, FormatId, Job } from './types.js'

export interface PlanRequest {
  resolved: ResolvedInput
  target: FormatId
  output?: string
  options: ConvertOptions
  /**
   * Retained because callers pass it through alongside the rest of the
   * request; write safety itself is `runPlan`'s job now, not this module's.
   */
  force: boolean
}

export interface Plan {
  jobs: Job[]
  failures: InputFailure[]
}

/**
 * Turns resolved inputs into one convert job per source.
 *
 * Planning only. Write safety used to live here too, which meant a conversion
 * run that planned on two paths at once — a document rasterising through
 * `convertAction.plan()`, everything else through here — needed a
 * `deferWriteSafety` flag so the caller could run one pass over the union.
 * `runPlan` now checks every job whatever planned it, so the flag and the
 * condition it patched are both gone.
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

    const where = {
      sourcePath: source.path,
      target: req.target,
      output: req.output,
      sourceRoot: req.resolved.roots.get(source.path),
    }
    let output = resolveOutputPath(where)
    // HEVC is written into an .mp4: an MP4 source would be its own output.
    if (resolve(output) === resolve(source.path) && req.target !== source.format) {
      output = suffixedImagePath({ ...where, suffix: req.target })
    }

    jobs.push({
      op: 'convert',
      sources: [source],
      outputs: [output],
      target: req.target,
      options: req.options,
    })
  }

  return { jobs, failures }
}
