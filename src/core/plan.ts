import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { targetIdsFor } from './capabilities.js'
import { outputCollision, outputExists, outputIsInput, unsupportedTarget } from './errors.js'
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
  // Tracks which of *this run's own* sources has already claimed an output
  // path. existsSync only sees the disk as it was before the run started, so
  // it can never catch two of our own jobs racing to write the same file —
  // this map is what catches that, and it is checked regardless of --force.
  const claimed = new Map<string, Job>()

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

    const key = resolve(output)
    const owner = claimed.get(key)
    if (owner) {
      failures.push({
        path: source.path,
        error: outputCollision([owner.sources[0].path, source.path], output),
      })
      continue
    }

    if (existsSync(output) && !req.force) {
      failures.push({ path: source.path, error: outputExists(output) })
      continue
    }

    const job: Job = {
      op: 'convert',
      sources: [source],
      outputs: [output],
      target: req.target,
      options: req.options,
    }
    jobs.push(job)
    claimed.set(key, job)
  }

  return { jobs, failures }
}
