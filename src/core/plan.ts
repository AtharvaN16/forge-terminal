import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { targetIdsFor } from './capabilities.js'
import { outputExists, outputIsInput, unsupportedTarget } from './errors.js'
import { resolveOutputPath } from './output-path.js'
import type { InputFailure, ResolvedInput } from './resolve.js'
import type { ConvertOptions, FormatId, Job } from './types.js'

export interface PlanRequest {
  resolved: ResolvedInput
  target: FormatId
  output?: string
  options: ConvertOptions
  force: boolean
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

    if (resolve(output) === resolve(source.path) && !req.force) {
      failures.push({ path: source.path, error: outputIsInput(output) })
      continue
    }

    if (existsSync(output) && !req.force) {
      failures.push({ path: source.path, error: outputExists(output) })
      continue
    }

    jobs.push({ source, target: req.target, output, options: req.options })
  }

  return { jobs, failures }
}
