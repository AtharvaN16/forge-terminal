import { engineForJob } from '../engines/registry.js'
import type { Engine, Measurer } from '../engines/types.js'
import { findQuality } from './compress.js'
import {
  conversionFailed,
  type ForgeError,
  isForgeError,
  targetUnreachable,
  unsupportedCompress,
} from './errors.js'
import type { InputFailure } from './resolve.js'
import { pool, type RunEvent, resolveConcurrency, runJobs } from './run.js'
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
  | {
      type: 'search:settled'
      job: Job
      /** Searches finished so far, this one included. */
      completed: number
      /**
       * How many jobs this run searches. Known before the first starts, so it
       * is a real denominator (invariant 7). Several searches run at once, so
       * this, not one job's attempt counter, is what a batch reports.
       */
      total: number
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
  /**
   * Stops a target-size search between encodes — the shell's esc key. Once a
   * job is settled and handed to `runJobs`, a write is either atomic or has not
   * started, so only an extension job (a child process) is interrupted there:
   * it is killed, nothing is written, and the outcome is `cancelled`.
   */
  signal?: AbortSignal
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
  /**
   * The search was cancelled before it settled, so nothing ran. Distinct from
   * `unreachable`: that is an answer the user must choose between, this is the
   * user having already chosen to stop being asked.
   */
  cancelled?: boolean
  inputBytes: number
  outputBytes: number
}

/** What one job's search came to. */
type Searched =
  | { kind: 'ready' }
  | { kind: 'refused'; failure: InputFailure }
  | { kind: 'unreachable'; entry: UnreachableTarget }
  | { kind: 'failed'; failure: InputFailure }
  | { kind: 'cancelled' }

/**
 * Resolves one convert job's settings by search, walking the engine's ladder
 * coarsest lever first.
 *
 * Never throws. A measurer or an encode that fails becomes this job's
 * failure, so one bad file in a batch neither rejects the whole run nor
 * leaves the other searches running with nobody waiting for them.
 */
async function searchJob(
  job: Extract<Job, { op: 'convert' }>,
  targetBytes: number,
  resolveEngine: (job: Job) => Engine | undefined,
  emit: (event: PlanEvent) => void,
  signal: AbortSignal | undefined,
): Promise<Searched> {
  const path = job.sources[0].path
  const failed = (e: unknown): Searched => ({
    kind: 'failed',
    failure: { path, error: isForgeError(e) ? e : conversionFailed(path, e) },
  })

  let measurer: Measurer | undefined
  try {
    measurer = await resolveEngine(job)?.measurer?.(job)
  } catch (e) {
    return failed(e)
  }
  if (!measurer || measurer.ladder.length === 0) {
    return {
      kind: 'refused',
      failure: { path, error: unsupportedCompress(job.sources[0], job.target) },
    }
  }
  const m = measurer
  // The measurer may have done async I/O (reading, decoding a HEIC). An abort
  // during that window must not still start a full-quality encode.
  if (signal?.aborted) return { kind: 'cancelled' }

  let smallest = Number.POSITIVE_INFINITY
  let closest: (Partial<ConvertOptions> & { quality: number }) | undefined
  try {
    for (const rung of m.ladder) {
      const found = await findQuality({
        encode: (quality) => m.measure({ ...job.options, ...rung, quality }),
        targetBytes,
        onAttempt: (attempt, of) => emit({ type: 'search:attempt', job, attempt, of, rung }),
        ...(signal === undefined ? {} : { signal }),
      })

      // A cancelled search has no answer: not a settled quality, and not a
      // measured floor to offer as "use it anyway" either, since the ladder
      // was abandoned partway. So this job neither runs nor becomes a
      // question. It simply stops.
      if (found.cancelled) return { kind: 'cancelled' }

      if (found.bytes < smallest) {
        smallest = found.bytes
        closest = { ...rung, quality: found.quality }
      }

      if (!found.missed) {
        // A fresh object, never a mutation: `buildPlan` hands every job the
        // same `options`, so with searches overlapping, the last one to
        // finish would otherwise decide everyone's quality.
        job.options = { ...job.options, ...rung, quality: found.quality }
        return { kind: 'ready' }
      }
    }
  } catch (e) {
    return failed(e)
  }

  const settings = closest ?? { quality: 1 }
  return {
    kind: 'unreachable',
    entry: {
      job,
      smallest,
      settings,
      error: targetUnreachable(job.sources[0], targetBytes, smallest),
    },
  }
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
 *
 * Searches run through the same pool as conversions, so a batch's quality
 * searches overlap instead of queueing. A cancel stops every in-flight search
 * at its next encode boundary and starts no new one.
 */
export async function runPlan(jobs: Job[], policy: RunPolicy): Promise<RunOutcome> {
  const emit = policy.onEvent ?? (() => {})
  const resolveEngine = policy.engineFor ?? engineForJob
  const targetBytes = policy.targetBytes

  /**
   * Write safety first. It is a few `existsSync` calls; the search below is up
   * to thirty-two encodes. Checking first means a job that will be refused is
   * never searched for half a minute. Safe to reorder because resolution
   * changes `options`, never `outputs`, so the answer cannot depend on it.
   */
  const safe = checkWriteSafety(jobs, { force: policy.force })

  /**
   * Searches run through the same pool as conversions (spec §4.4): one file's
   * eight encodes no longer wait for the previous file's. Each search's outcome
   * is slotted by index, so the jobs that run, and the order they are reported
   * in, are the same as if the searches had run one at a time.
   */
  const searching =
    targetBytes === undefined ? 0 : safe.jobs.filter((job) => job.op === 'convert').length
  const searched: Searched[] = []
  let settled = 0

  await pool(safe.jobs, resolveConcurrency(policy.concurrency), async (job, index) => {
    // Only `convert` carries `ConvertOptions`; a page operation has no quality
    // dial, so a target size is simply not applicable to one.
    if (targetBytes === undefined || job.op !== 'convert') {
      searched[index] = { kind: 'ready' }
      return
    }
    // Checked before starting: after a cancel, no new search begins.
    if (policy.signal?.aborted) {
      searched[index] = { kind: 'cancelled' }
      return
    }
    const outcome = await searchJob(job, targetBytes, resolveEngine, emit, policy.signal)
    searched[index] = outcome
    if (outcome.kind !== 'cancelled') {
      settled += 1
      emit({ type: 'search:settled', job, completed: settled, total: searching })
    }
  })

  const refusals: InputFailure[] = [...safe.failures]
  const unreachable: UnreachableTarget[] = []
  const searchFailures: InputFailure[] = []
  const ready: Job[] = []
  let cancelled = false

  for (const [index, job] of safe.jobs.entries()) {
    const outcome: Searched = searched[index] ?? { kind: 'ready' }
    if (outcome.kind === 'ready') ready.push(job)
    else if (outcome.kind === 'refused') refusals.push(outcome.failure)
    else if (outcome.kind === 'failed') searchFailures.push(outcome.failure)
    else if (outcome.kind === 'unreachable') unreachable.push(outcome.entry)
    else cancelled = true
  }

  if (cancelled) {
    return {
      results: [],
      refusals,
      unreachable: [],
      failures: [],
      inputBytes: 0,
      outputBytes: 0,
      cancelled: true,
    }
  }

  // Failures that happened before any cancel are real answers, kept even if
  // the batch is cancelled later.
  const failedBeforeCancel = new Set<InputFailure>()
  const done = await runJobs(ready, {
    ...(policy.concurrency === undefined ? {} : { concurrency: policy.concurrency }),
    ...(policy.engineFor === undefined ? {} : { engineFor: policy.engineFor }),
    ...(policy.signal === undefined ? {} : { signal: policy.signal }),
    onEvent: (event) => {
      if (event.type === 'job:error' && !policy.signal?.aborted)
        failedBeforeCancel.add(event.failure)
      emit(event)
    },
  })

  // Aborted mid-run: the killed jobs wrote nothing, and their "failure" is the
  // user's own cancel, not an answer to report.
  if (policy.signal?.aborted && done.failures.length > 0) {
    const real = done.failures.filter((f) => failedBeforeCancel.has(f))
    return {
      ...done,
      refusals,
      unreachable,
      failures: [...searchFailures, ...real],
      cancelled: true,
    }
  }

  return {
    results: done.results,
    refusals,
    unreachable,
    failures: [...searchFailures, ...done.failures],
    inputBytes: done.inputBytes,
    outputBytes: done.outputBytes,
  }
}
