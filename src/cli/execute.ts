import { readFile } from 'node:fs/promises'
import { basename, dirname } from 'node:path'
import { ACTIONS, convertAction, unavailableReason } from '../core/actions/index.js'
import { everyNCuts, everyPageCuts } from '../core/actions/split.js'
import {
  encryptedSource,
  type ForgeError,
  invalidArguments,
  invalidPageRange,
  isForgeError,
  unsupportedCompress,
} from '../core/errors.js'
import { runPlan } from '../core/execute-jobs.js'
import { buildPlan } from '../core/plan.js'
import { type InputFailure, resolveInputs } from '../core/resolve.js'
import type { ConvertOptions, DocumentInfo, FormatId, Job, SourceInfo } from '../core/types.js'
import { openPdf, pdfiumEngine } from '../engines/pdfium.js'
import type { Intent, PageOpIntent } from './args.js'
import { reportBatch, reportFailures, reportFormats, reportPageOp, reportSingle } from './report.js'
import { readPassword } from './stdin.js'

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
  /**
   * Called during a target-size search with a human-readable position, e.g.
   * `150 dpi · attempt 3 of 8`.
   *
   * A status string rather than a spinner, so this file stays ignorant of how
   * — or whether — anything is drawn; `src/index.ts` owns that and gates it on
   * a real terminal. Every number in the string is a real index in a bounded
   * sequence, never an invented percentage (invariant 7).
   */
  onSearch?: (status: string) => void
}

/**
 * Turns a `PageOpIntent` into the `values` shape each action's `plan()`
 * expects (see `core/actions/*.ts`). This is the one place both of the
 * CLI's page-boundary conversions happen: `--split at=` is 1-based cut
 * points as the user typed them, `cuts` is 0-based as `Job` holds them;
 * `--separate` is a boolean flag, but `extractAction.plan` reads the string
 * 'many' (it was designed for the shell's select option, whose choices are
 * string values).
 */
function pageOpValues(intent: PageOpIntent, sources: SourceInfo[]): Record<string, unknown> {
  if (intent.action === 'merge') return {}
  if (intent.action === 'rotate') return { degrees: intent.rotate }
  if (intent.action === 'extract') {
    return { pages: intent.pages, separate: intent.separate ? 'many' : 'one' }
  }
  if (intent.action === 'delete') return { pages: intent.pages }

  // action === 'split'
  const doc = sources.find((s): s is DocumentInfo => s.kind === 'document')
  const pageCount = doc?.pages ?? 0
  const spec = intent.split
  if (!spec) {
    throw invalidArguments('--split needs a mode: every-page, every=N or at=N,N.')
  }
  if (spec.mode === 'every-page') return { cuts: everyPageCuts(pageCount) }
  if (spec.mode === 'every-n') return { cuts: everyNCuts(pageCount, spec.n) }

  // spec.mode === 'points' — validated here, the same way parseRanges
  // validates ranges: out of bounds is an error naming the page count, never
  // a silent clamp (cutsToRanges, downstream, would otherwise just drop it).
  const last = Math.max(pageCount - 1, 0)
  for (const n of spec.after) {
    if (!Number.isInteger(n) || n < 1 || n > last) {
      throw invalidPageRange(
        String(n),
        `"${n}" is outside 1 and ${last} — ${doc ? basename(doc.path) : 'the document'} has ${pageCount} pages.`,
        pageCount,
      )
    }
  }
  return { cuts: spec.after.map((n) => n - 1) }
}

/**
 * Whether a document source's `convert` job belongs to `pdfiumEngine` at all.
 * Read from the engine's own declared `writes`, not a hardcoded `['jpeg',
 * 'png']` — invariant 2. A document source targeting something pdfium does
 * not write (`--to pdf`, say) is left for `buildPlan`'s existing path, which
 * already reports `unsupportedTarget` or routes to whatever engine applies —
 * unchanged by this phase.
 */
function rasterises(target: FormatId): boolean {
  return pdfiumEngine.writes.has(target)
}

/**
 * Builds one rasterisation job for one encrypted-or-not document source:
 * prompts for a password only when the source is actually encrypted
 * (invariant 8 — never for a file that is not), then hands the actual
 * planning — page selection, resolution, and the per-page zero-padded
 * output names — to `convertAction.plan()`, the one place that logic lives
 * (`core/actions/convert.ts`, shared with the shell's own page/resolution
 * steps). This function's own job is the CLI-specific part `plan()` cannot
 * do itself: reading a password from the terminal or stdin, which `core/`
 * must never do (invariant 1), and folding the result into `options` —
 * `plan()` has no password field by design (there is no `--password` flag
 * to source one from, and the shell has none either, spec §8).
 *
 * Returns a failure instead of throwing for anything a user could cause
 * (a bad password, an out-of-range page): `execute()` collects these the
 * same way `resolveInputs` and `buildPlan` already report theirs, so one bad
 * PDF in a batch does not abort the rest.
 */
async function buildRasterJob(
  source: DocumentInfo,
  intent: {
    target: FormatId
    output?: string
    dpi?: number
    pages?: string
    passwordStdin?: boolean
    /**
     * Carries every `ConvertOptions` field the user set — `--background`,
     * `--quality`, `--keep-metadata`. Each one is forwarded into `plan()`
     * below; a field left out here is a flag that works for an image source
     * and silently does nothing for a document, which is exactly the defect
     * `--background` had before this.
     */
    options: ConvertOptions
  },
  /**
   * The root this source was scanned under, when `--recursive` found it
   * inside one. Threaded through so `rasterOutputPaths` recreates the source
   * tree under `--output` the same way `buildPlan` already does for an image.
   */
  sourceRoot?: string,
): Promise<{ job: Job } | { failure: { path: string; error: ForgeError } }> {
  let password: string | undefined
  if (source.encrypted) {
    // Never for an unencrypted file — asking would be a prompt nobody
    // expected and, worse, a password nothing is actually locked with.
    password = await readPassword({ stdin: intent.passwordStdin ?? false })
    let doc: Awaited<ReturnType<typeof openPdf>>
    try {
      doc = await openPdf(await readFile(source.path), password)
    } catch {
      // Any failure here becomes "wrong password", not just PDFium's own
      // PASSWORD error code — deliberately: gating this whole block on
      // `source.encrypted` already means a wrong password is overwhelmingly
      // the real cause, and the alternative (a genuinely malformed encrypted
      // PDF failing for some other reason) still gets a sensible message
      // rather than a raw parse error. Also discards whatever pdfium threw
      // rather than attaching it as `cause`: invariant 8 forbids the
      // attempted password from surfacing, and re-wrapping a message that
      // might echo caller input is a needless way to risk that. The existing
      // encrypted-source error already says what to do differently.
      return { failure: { path: source.path, error: encryptedSource(source.path) } }
    }
    // Outside the catch above, deliberately: this document only exists to
    // check the password, not to render anything, and the engine opens its
    // own copy below — so it is freed immediately (skipping it leaks a wasm
    // page buffer per encrypted file, which adds up on a long scan). A
    // failure *here* is not a wrong password, and reporting it as one would
    // send the user to re-type a password that was in fact correct.
    doc.destroy()
  }

  let planned: Job[]
  try {
    // `intent.pages` is the raw --pages text (or absent, meaning "all") —
    // exactly the shape `convertAction`'s own `resolvePages` already parses
    // for a typed range, so it is passed through unparsed rather than
    // reparsed here. `destination` is a bare directory, matching what the
    // shell's own path picker always hands `plan()`; the CLI's `--output`
    // can also name an exact file, but that has no meaning for a job that
    // writes more than one page, so it is used as a folder here too.
    planned = convertAction.plan([source], {
      target: intent.target,
      background: intent.options.background,
      keepMetadata: intent.options.keepMetadata,
      dpi: String(intent.dpi ?? 150),
      ...(intent.options.quality === undefined ? {} : { quality: intent.options.quality }),
      ...(intent.pages === undefined ? {} : { pages: intent.pages }),
      ...(intent.output === undefined ? {} : { destination: intent.output }),
      ...(sourceRoot === undefined ? {} : { sourceRoot }),
    })
  } catch (e) {
    if (!isForgeError(e)) throw e
    return { failure: { path: source.path, error: e } }
  }

  const job = planned[0]
  if (job?.op !== 'convert') {
    // A programmer error, not a user error: convertAction.plan() is
    // documented to return exactly one convert job for one document source.
    throw new Error(`convertAction.plan() did not return a convert job for ${source.path}`)
  }
  // plan() has no password field to fill in (see the note above) — this is
  // the one field this function adds on top of what it returned.
  if (password !== undefined) job.options.password = password
  return { job }
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

  /**
   * A page operation is never a batch of separate conversions — it is one
   * `Action` (Task 10) turning a fixed set of sources into a `Job`, the same
   * way the shell hub does. Resolved and probed like every other path, so a
   * missing file or an unreadable PDF is reported the same way.
   */
  if (intent.kind === 'pageop') {
    const resolved = await resolveInputs(intent.inputs, { recursive: false })

    if (resolved.sources.length === 0) {
      return {
        exitCode: 1,
        stdout: [],
        stderr: reportFailures(resolved.failures, { debug: intent.debug }),
      }
    }

    const action = ACTIONS.find((a) => a.id === intent.action)
    if (!action) throw new Error(`no action registered for "${intent.action}"`)

    if (!action.appliesTo(resolved.sources)) {
      const reason = unavailableReason(action, resolved.sources) ?? 'not available for these files'
      throw invalidArguments(`Cannot ${intent.action}: ${reason}.`)
    }

    const values = pageOpValues(intent, resolved.sources)
    const planned = action.plan(resolved.sources, values)

    // `action.plan()` bypasses `buildPlan` — its one-source-one-target shape
    // does not fit merge's several sources or split's several outputs — but
    // `runPlan` is arity-agnostic, so the write-safety rules arrive for free
    // rather than having to be applied here by hand.
    const outcome = await runPlan(planned, { force: intent.force })

    const failures = [...resolved.failures, ...outcome.refusals, ...outcome.failures]
    const stdout = outcome.results.length === 0 ? [] : reportPageOp(outcome)

    return {
      exitCode: failures.length > 0 ? 1 : 0,
      stdout,
      stderr: reportFailures(failures, { debug: intent.debug }),
    }
  }

  const resolved = await resolveInputs(intent.inputs, { recursive: intent.recursive })

  /**
   * Compression keeps each file's own format, so there is no single target
   * for the whole batch — every source is its own. Planned per file and run
   * through the same `runPlan` every other path uses, so write safety, the
   * target-size search, concurrency and atomic writes are shared rather than
   * reimplemented — this path used to reimplement the search and skip write
   * safety entirely.
   */
  if (intent.kind === 'compress') {
    const { compressAction } = await import('../core/actions/index.js')

    const jobs: Job[] = []
    const refusals: InputFailure[] = []
    for (const source of resolved.sources) {
      if (!compressAction.appliesTo([source])) {
        refusals.push({ path: source.path, error: unsupportedCompress(source) })
        continue
      }
      const [planned] = compressAction.plan([source], {
        mode: intent.maxBytes === undefined ? 'quality' : 'size',
        ...(intent.quality === undefined ? {} : { quality: intent.quality }),
        destination: dirname(source.path),
      })
      if (planned?.op !== 'convert') continue
      // A typed `--dpi` applies to both modes. It was originally threaded
      // only into the target-size search, so quality mode silently kept the
      // engine default and produced the same bytes whatever was passed.
      if (intent.dpi !== undefined) planned.options.dpi = intent.dpi
      jobs.push(planned)
    }

    const batch = jobs.length > 1
    if (batch) opts.onProgress?.({ completed: 0, total: jobs.length })

    const outcome = await runPlan(jobs, {
      force: intent.force,
      ...(intent.concurrency === undefined ? {} : { concurrency: intent.concurrency }),
      ...(intent.maxBytes === undefined ? {} : { targetBytes: intent.maxBytes }),
      onEvent: (event) => {
        if (event.type === 'search:attempt') {
          // The rung is named as well as the attempt: without it a search that
          // drops from 150 to 120 dpi looks like the counter simply restarting
          // for no reason.
          opts.onSearch?.(
            event.rung.dpi === undefined
              ? `attempt ${event.attempt} of ${event.of}`
              : `${event.rung.dpi} dpi · attempt ${event.attempt} of ${event.of}`,
          )
          return
        }
        if (batch && (event.type === 'job:done' || event.type === 'job:error')) {
          opts.onProgress?.({ completed: event.completed, total: event.total })
        }
      },
    })

    const failures = [
      ...refusals,
      ...outcome.refusals,
      ...outcome.unreachable.map((u) => ({ path: u.job.sources[0].path, error: u.error })),
      ...outcome.failures,
    ]
    const stdout =
      outcome.results.length === 0
        ? []
        : outcome.results.length === 1
          ? reportSingle(outcome)
          : reportBatch(outcome)

    return {
      exitCode: failures.length > 0 ? 1 : 0,
      stdout,
      stderr: reportFailures(failures, { debug: intent.debug }),
    }
  }

  /**
   * A document source only takes this rasterising path when the target is
   * one `pdfiumEngine` actually writes — `--to pdf` (embedding, not
   * rasterising) stays on `buildPlan`'s existing one-output-per-source path,
   * unchanged by this phase. `buildPlan` never sees these sources at all: it
   * cannot express "many outputs from one source", which is exactly what a
   * multi-page render is (see `Job`'s `convert` variant in `core/types.ts`).
   */
  const isDocument = (s: SourceInfo): s is DocumentInfo => s.kind === 'document'
  const wantsRaster = rasterises(intent.target)
  const documentSources = wantsRaster ? resolved.sources.filter(isDocument) : []
  const otherSources = wantsRaster
    ? resolved.sources.filter((s) => !isDocument(s))
    : resolved.sources

  const documentJobs: Job[] = []
  const documentFailures: { path: string; error: ForgeError }[] = []
  for (const source of documentSources) {
    const built = await buildRasterJob(source, intent, resolved.roots.get(source.path))
    if ('failure' in built) documentFailures.push(built.failure)
    else documentJobs.push(built.job)
  }
  const planRequest = {
    resolved: { sources: otherSources, failures: [], roots: resolved.roots },
    target: intent.target,
    options: intent.options,
    force: intent.force,
    ...(intent.output === undefined ? {} : { output: intent.output }),
  }
  const plan = await buildPlan(planRequest)

  /**
   * One write-safety pass over every job this run plans, whatever path
   * planned it — `runPlan` does it, over the union.
   *
   * Two independent passes — one over the raster jobs, one over the rest —
   * would each see only half the outputs, so a `doc.pdf` rasterising to
   * `doc-1.jpg` and a `doc-1.png` converting to the same name would collide
   * in neither. That is `outputCollision`'s exact case, and it is the one
   * refusal `--force` must never suppress: silently writing one file and
   * reporting two converted breaks invariant 6 (a multi-output job is
   * all-or-nothing) and invariant 7 (the summary never asserts something
   * untrue).
   *
   * Document jobs go last so an ordinary one-source-one-output conversion
   * keeps the name it would have had on its own, and the multi-output
   * rasterisation is the side told to go elsewhere.
   */
  const allJobs = [...plan.jobs, ...documentJobs]
  const isBatch = allJobs.length > 1
  if (isBatch) opts.onProgress?.({ completed: 0, total: allJobs.length })

  const outcome = await runPlan(allJobs, {
    force: intent.force,
    ...(intent.concurrency === undefined ? {} : { concurrency: intent.concurrency }),
    onEvent: (event) => {
      if (isBatch && (event.type === 'job:done' || event.type === 'job:error')) {
        opts.onProgress?.({ completed: event.completed, total: event.total })
      }
    },
  })

  const failures = [
    ...resolved.failures,
    ...documentFailures,
    ...plan.failures,
    ...outcome.refusals,
    ...outcome.failures,
  ]

  const stdout =
    outcome.results.length === 0
      ? []
      : outcome.results.length === 1
        ? reportSingle(outcome)
        : reportBatch(outcome, intent.output)

  const stderr = reportFailures(failures, { debug: intent.debug })

  return { exitCode: failures.length > 0 ? 1 : 0, stdout, stderr }
}
