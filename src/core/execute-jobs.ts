import { engineForJob } from '../engines/registry.js'
import type { Engine } from '../engines/types.js'
import { findQuality } from './compress.js'
import { type ForgeError, targetUnreachable, unsupportedCompress } from './errors.js'
import type { InputFailure } from './resolve.js'
import { type RunEvent, runJobs } from './run.js'
import type { ConvertOptions, Job, Result } from './types.js'
import { checkWriteSafety } from './write-safety.js'

export type PlanEvent =
  | RunEvent
  | {
      type: 'search:attempt'
      job: Job
      /** 1-based, within this rung. */
      attempt: number
      /**
       * `maxAttempts()` for this rung — a real bound, never invented.
       *
       * Per rung, never across: how many rungs a search needs is not knowable
       * before it needs them, so a cross-rung total would be a fabricated
       * denominator, which invariant 7 forbids.
       */
      of: number
      /** `{}` for an image, `{ dpi: 120 }` for a document. */
      rung: Partial<ConvertOptions>
    }

export interface RunPolicy {
  /** Replaces existing outputs. Overrides two write-safety rules, never collision. */
  force: boolean
  concurrency?: number
  /**
   * When set, each convert job's quality — and, for a document, its dpi — is
   * resolved by search before the job runs. Unset, the job's own options stand.
   */
  targetBytes?: number
  onEvent?: (event: PlanEvent) => void
  /** Test seam. Defaults to the registry's `engineForJob`. */
  engineFor?: (job: Job) => Engine | undefined
}

export interface UnreachableTarget {
  job: Job
  /** Smallest byte size any rung achieved. */
  smallest: number
  /**
   * What "use it anyway" would apply — a ladder rung plus the quality the
   * search settled on. The shell needs these to offer the choice; the numbers
   * cannot be recovered from `error`, which bakes them into prose.
   */
  settings: Partial<ConvertOptions> & { quality: number }
  /** Pre-built, for callers that only report. */
  error: ForgeError
}

export interface RunOutcome {
  results: Result[]
  /**
   * Never ran. Either write-safety refused — retryable with `force` — or
   * `targetBytes` was set for a job whose engine cannot be searched.
   */
  refusals: InputFailure[]
  /** Never ran: no rung reached the target. Retryable with relaxed settings. */
  unreachable: UnreachableTarget[]
  /** Ran and threw. Not retryable. */
  failures: InputFailure[]
  inputBytes: number
  outputBytes: number
}

/**
 * Runs a set of jobs: refuse what is unsafe, resolve what needs searching, run
 * the rest.
 *
 * Composition lives here rather than in each caller. It used to live in five
 * places — three in `cli/execute.ts`, two in `shell/App.tsx` — and the five
 * disagreed in four separate ways: the shell never reached the target-size
 * search for a document, discarded every warning a page job produced,
 * mislabelled a multi-output convert, and the CLI's compress path ran no
 * write-safety at all. Each was a caller composing the same steps differently,
 * which is what a single seam removes.
 *
 * Three refusal channels rather than one because callers act on them
 * differently: `refusals` may be retried with `force`, `unreachable` with
 * relaxed settings, `failures` not at all.
 *
 * Nothing here asks the user anything. Refusals come back as data and the
 * caller decides — the CLI reports them, the shell turns `output-exists` into
 * its overwrite step and calls again with `force`. That keeps this a plain
 * async function rather than something holding a promise across React
 * re-renders.
 */
export async function runPlan(jobs: Job[], policy: RunPolicy): Promise<RunOutcome> {
  const emit = policy.onEvent ?? (() => {})
  const resolveEngine = policy.engineFor ?? engineForJob

  /**
   * Write safety first. It is a few `existsSync` calls; the search below is up
   * to thirty-two encodes. Checking first means a job that will be refused is
   * never searched for half a minute. Safe to reorder because resolution
   * changes `options`, never `outputs`, so the answer cannot depend on it.
   */
  const safe = checkWriteSafety(jobs, { force: policy.force })
  const refusals: InputFailure[] = [...safe.failures]
  const unreachable: UnreachableTarget[] = []
  const ready: Job[] = []

  for (const job of safe.jobs) {
    // Only `convert` carries `ConvertOptions`; a page operation has no quality
    // dial, so a target size is simply not applicable to one.
    if (policy.targetBytes === undefined || job.op !== 'convert') {
      ready.push(job)
      continue
    }

    const measurer = await resolveEngine(job)?.measurer?.(job)
    if (!measurer) {
      refusals.push({ path: job.sources[0].path, error: unsupportedCompress(job.sources[0]) })
      continue
    }

    const targetBytes = policy.targetBytes
    let smallest = Number.POSITIVE_INFINITY
    let closest: (Partial<ConvertOptions> & { quality: number }) | undefined
    let settled = false

    for (const rung of measurer.ladder) {
      const found = await findQuality({
        encode: (quality) => measurer.measure({ ...job.options, ...rung, quality }),
        targetBytes,
        onAttempt: (attempt, of) => emit({ type: 'search:attempt', job, attempt, of, rung }),
      })

      if (found.bytes < smallest) {
        smallest = found.bytes
        closest = { ...rung, quality: found.quality }
      }

      if (!found.missed) {
        Object.assign(job.options, rung, { quality: found.quality })
        ready.push(job)
        settled = true
        break
      }
    }

    if (!settled && closest) {
      unreachable.push({
        job,
        smallest,
        settings: closest,
        error: targetUnreachable(job.sources[0], targetBytes, smallest),
      })
    }
  }

  const done = await runJobs(ready, {
    ...(policy.concurrency === undefined ? {} : { concurrency: policy.concurrency }),
    ...(policy.engineFor === undefined ? {} : { engineFor: policy.engineFor }),
    onEvent: emit,
  })

  return {
    results: done.results,
    refusals,
    unreachable,
    failures: done.failures,
    inputBytes: done.inputBytes,
    outputBytes: done.outputBytes,
  }
}
