import { readFile } from 'node:fs/promises'
import { basename, dirname, resolve } from 'node:path'
import { ACTIONS, compressAction, convertAction, unavailableReason } from '../core/actions/index.js'
import { everyNCuts, everyPageCuts } from '../core/actions/split.js'
import { formatMatrix, rasterises } from '../core/capabilities.js'
import {
  encryptedSource,
  type ForgeError,
  invalidArguments,
  invalidPageRange,
  isForgeError,
  unsupportedCompress,
  unsupportedOperation,
} from '../core/errors.js'
import { type PlanEvent, runPlan } from '../core/execute-jobs.js'
import { looksLikeDirectory, resolveOutputPath } from '../core/output-path.js'
import { buildPlan } from '../core/plan.js'
import { configJson, errorJson, formatsJson, runJson } from '../core/report-data.js'
import { type InputFailure, resolveInputs } from '../core/resolve.js'
import type { RunSummary } from '../core/run.js'
import type { ConvertOptions, DocumentInfo, FormatId, Job, SourceInfo } from '../core/types.js'
import { openPdf } from '../engines/pdfium.js'
import { VERSION } from '../shell/theme.js'
import type { CompressIntent, ConvertIntent, Intent, PageOpIntent } from './args.js'
import type { ConfigIntent } from './config-command.js'
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
   * `150 dpi · attempt 3 of 8`, or `3 of 50 searched` for a batch.
   *
   * A status string rather than a spinner, so this file stays ignorant of how
   * — or whether — anything is drawn; `src/index.ts` owns that and gates it on
   * a real terminal. Every number in the string is a real index in a bounded
   * sequence, never an invented percentage (invariant 7).
   */
  onSearch?: (status: string) => void
  /**
   * Render as one JSON document on stdout instead of text (spec §3.2). Under
   * --json, stdout carries exactly that document and stderr carries nothing.
   */
  json?: boolean
}

/** The intents that convert, compress or edit files: everything `runIntent` accepts. */
export type RunnableIntent = ConvertIntent | CompressIntent | PageOpIntent

/**
 * What a run did, as data. `renderRun` turns it into text or JSON, and
 * `src/mcp/tools.ts` into an MCP result. It is one object so the three cannot
 * drift. `failures` holds every refusal and failure, in the order the text
 * reporter prints them.
 */
export interface RunReport extends RunSummary {
  kind: RunnableIntent['kind']
}

/**
 * The exit-code contract (spec §3.4). If the same flags could succeed on a
 * different file, it is 1. If the command itself is wrong, it is 2. The only
 * failure that is the command's own fault is `invalid-arguments`.
 */
export function exitCodeFor(failures: InputFailure[]): 0 | 1 | 2 {
  if (failures.length === 0) return 0
  return failures.some((f) => f.error.code === 'invalid-arguments') ? 2 : 1
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
    // No --password-stdin and no terminal to ask on. Refuse now rather than
    // wait for input that cannot come. The hint names --password-stdin,
    // which is exactly what is missing.
    if (password === undefined) {
      return { failure: { path: source.path, error: encryptedSource(source.path) } }
    }
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
      return {
        failure: { path: source.path, error: encryptedSource(source.path, { attempted: true }) },
      }
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

/**
 * Turns `runPlan`'s events into the two callbacks `src/index.ts` draws from.
 * Shared by the compress and convert paths, so a target-size search reports
 * the same way whichever flag asked for it. The rung is named as well as the
 * attempt: without it a search that drops from 150 to 120 dpi looks like the
 * counter restarting for no reason.
 */
function reportEvents(opts: ExecuteOptions, batch: boolean): (event: PlanEvent) => void {
  return (event) => {
    if (event.type === 'search:attempt') {
      // A single file's search reports its real position. In a batch several
      // searches run at once (spec §4.4), and their attempt counters would
      // interleave into one number jumping about, so a batch reports finished
      // files instead (below).
      if (!batch) {
        opts.onSearch?.(
          event.rung.dpi === undefined
            ? `attempt ${event.attempt} of ${event.of}`
            : `${event.rung.dpi} dpi · attempt ${event.attempt} of ${event.of}`,
        )
      }
      return
    }
    if (event.type === 'search:settled') {
      if (batch) opts.onSearch?.(`${event.completed} of ${event.total} searched`)
      return
    }
    if (batch && (event.type === 'job:done' || event.type === 'job:error')) {
      opts.onProgress?.({ completed: event.completed, total: event.total })
    }
  }
}

const nothingRan = (kind: RunReport['kind'], failures: InputFailure[]): RunReport => ({
  kind,
  results: [],
  failures,
  inputBytes: 0,
  outputBytes: 0,
})

/**
 * A page operation is never a batch of separate conversions — it is one
 * `Action` (Task 10) turning a fixed set of sources into a `Job`, the same
 * way the shell hub does. Resolved and probed like every other path, so a
 * missing file or an unreadable PDF is reported the same way.
 */
async function runPageOp(intent: PageOpIntent): Promise<RunReport> {
  const resolved = await resolveInputs(intent.inputs, { recursive: false })
  if (resolved.sources.length === 0) return nothingRan('pageop', resolved.failures)

  const action = ACTIONS.find((a) => a.id === intent.action)
  if (!action) throw new Error(`no action registered for "${intent.action}"`)

  /**
   * Some refusals are about *these files*: a JPEG handed to --merge, a split
   * point past the last page, a range that selects nothing. Those are failures
   * (exit 1), not usage errors, because the same flags would succeed on a
   * different file (spec §3.4).
   */
  const first = resolved.sources[0]?.path ?? ''
  if (!action.appliesTo(resolved.sources)) {
    const reason = unavailableReason(action, resolved.sources) ?? 'not available for these files'
    return nothingRan('pageop', [
      ...resolved.failures,
      { path: first, error: unsupportedOperation(intent.action, reason) },
    ])
  }

  let planned: Job[]
  try {
    planned = action.plan(resolved.sources, pageOpValues(intent, resolved.sources))
  } catch (e) {
    if (!isForgeError(e)) throw e
    return nothingRan('pageop', [...resolved.failures, { path: first, error: e }])
  }

  // `action.plan()` bypasses `buildPlan` — its one-source-one-target shape
  // does not fit merge's several sources or split's several outputs — but
  // `runPlan` is arity-agnostic, so the write-safety rules arrive for free
  // rather than having to be applied here by hand.
  const outcome = await runPlan(planned, { force: intent.force })
  return {
    kind: 'pageop',
    results: outcome.results,
    failures: [...resolved.failures, ...outcome.refusals, ...outcome.failures],
    inputBytes: outcome.inputBytes,
    outputBytes: outcome.outputBytes,
  }
}

/**
 * Compression keeps each file's own format, so there is no single target
 * for the whole batch — every source is its own. Planned per file and run
 * through the same `runPlan` every other path uses, so write safety, the
 * target-size search, concurrency and atomic writes are shared rather than
 * reimplemented.
 */
async function runCompress(intent: CompressIntent, opts: ExecuteOptions): Promise<RunReport> {
  const resolved = await resolveInputs(intent.inputs, { recursive: intent.recursive })

  const jobs: Job[] = []
  const refusals: InputFailure[] = []
  for (const source of resolved.sources) {
    if (!compressAction.appliesTo([source])) {
      refusals.push({ path: source.path, error: unsupportedCompress(source) })
      continue
    }
    /**
     * `--output` reads the way it does for a conversion. A directory gets
     * the action's own `-small` name, nested under `--recursive` exactly as
     * `resolveOutputPath` nests a conversion; anything else is the file to
     * write. Several sources aimed at one file collide in `runPlan`'s
     * write-safety pass, which already says so plainly.
     */
    const explicitFile =
      intent.output !== undefined && !looksLikeDirectory(intent.output)
        ? resolve(intent.output)
        : undefined
    const destination =
      intent.output === undefined || explicitFile !== undefined
        ? dirname(source.path)
        : dirname(
            resolveOutputPath({
              sourcePath: source.path,
              target: source.format,
              output: intent.output,
              sourceRoot: resolved.roots.get(source.path),
            }),
          )
    const [planned] = compressAction.plan([source], {
      mode: intent.maxBytes === undefined ? 'quality' : 'size',
      ...(intent.quality === undefined ? {} : { quality: intent.quality }),
      destination,
    })
    if (planned?.op !== 'convert') continue
    if (explicitFile !== undefined) planned.outputs = [explicitFile]
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
    onEvent: reportEvents(opts, batch),
  })

  return {
    kind: 'compress',
    results: outcome.results,
    // `resolved.failures` first, as the conversion path orders them.
    failures: [
      ...resolved.failures,
      ...refusals,
      ...outcome.refusals,
      ...outcome.unreachable.map((u) => ({ path: u.job.sources[0].path, error: u.error })),
      ...outcome.failures,
    ],
    inputBytes: outcome.inputBytes,
    outputBytes: outcome.outputBytes,
  }
}

async function runConvert(intent: ConvertIntent, opts: ExecuteOptions): Promise<RunReport> {
  const resolved = await resolveInputs(intent.inputs, { recursive: intent.recursive })

  /**
   * A document source only takes this rasterising path when the target is
   * one `pdfiumEngine` actually writes — `--to pdf` (embedding, not
   * rasterising) stays on `buildPlan`'s existing one-output-per-source path.
   * `buildPlan` never sees these sources at all: it cannot express "many
   * outputs from one source", which is exactly what a multi-page render is.
   *
   * `format === 'pdf'` matters as much as `wantsRaster` does: pdfium only
   * ever reads `pdf`, so a docx/doc source can never actually be rasterised
   * regardless of the target. Without this, `forge report.docx --to jpeg`
   * was routed into `buildRasterJob` anyway and crashed instead of getting
   * the clean `unsupported-target` refusal `buildPlan` produces for it.
   */
  const isDocument = (s: SourceInfo): s is DocumentInfo =>
    s.kind === 'document' && s.format === 'pdf'
  const wantsRaster = rasterises(intent.target)
  const documentSources = wantsRaster ? resolved.sources.filter(isDocument) : []
  const otherSources = wantsRaster
    ? resolved.sources.filter((s) => !isDocument(s))
    : resolved.sources

  const documentJobs: Job[] = []
  const documentFailures: InputFailure[] = []
  for (const source of documentSources) {
    const built = await buildRasterJob(source, intent, resolved.roots.get(source.path))
    if ('failure' in built) documentFailures.push(built.failure)
    else documentJobs.push(built.job)
  }
  const plan = await buildPlan({
    resolved: { sources: otherSources, failures: [], roots: resolved.roots },
    target: intent.target,
    options: intent.options,
    force: intent.force,
    ...(intent.output === undefined ? {} : { output: intent.output }),
  })

  /**
   * One write-safety pass over every job this run plans, whatever path
   * planned it — `runPlan` does it, over the union. Two independent passes
   * would each see only half the outputs, so a `doc.pdf` rasterising to
   * `doc-1.jpg` and a `doc-1.png` converting to the same name would collide
   * in neither (invariants 6 and 7). Document jobs go last so an ordinary
   * one-source-one-output conversion keeps the name it would have had alone.
   */
  const allJobs = [...plan.jobs, ...documentJobs]
  const isBatch = allJobs.length > 1
  if (isBatch) opts.onProgress?.({ completed: 0, total: allJobs.length })

  const outcome = await runPlan(allJobs, {
    force: intent.force,
    ...(intent.concurrency === undefined ? {} : { concurrency: intent.concurrency }),
    ...(intent.maxBytes === undefined ? {} : { targetBytes: intent.maxBytes }),
    onEvent: reportEvents(opts, isBatch),
  })

  return {
    kind: 'convert',
    results: outcome.results,
    failures: [
      ...resolved.failures,
      ...documentFailures,
      ...plan.failures,
      ...outcome.refusals,
      ...outcome.unreachable.map((u) => ({ path: u.job.sources[0].path, error: u.error })),
      ...outcome.failures,
    ],
    inputBytes: outcome.inputBytes,
    outputBytes: outcome.outputBytes,
  }
}

/**
 * Runs a conversion, compression or page operation and returns what happened
 * as data. It never prints and never throws a ForgeError: one that escapes is
 * reported as a command-level failure. The CLI renders the result (`renderRun`)
 * and the MCP server returns it (`src/mcp/tools.ts`).
 */
export async function runIntent(
  intent: RunnableIntent,
  opts: ExecuteOptions = {},
): Promise<RunReport> {
  try {
    if (intent.kind === 'pageop') return await runPageOp(intent)
    if (intent.kind === 'compress') return await runCompress(intent, opts)
    return await runConvert(intent, opts)
  } catch (e) {
    if (!isForgeError(e)) throw e
    return nothingRan(intent.kind, [{ path: '', error: e }])
  }
}

/** One report, rendered as text or as the §3.2 JSON document. */
export function renderRun(
  report: RunReport,
  opts: { json: boolean; debug: boolean },
): ExecuteResult {
  const exitCode = exitCodeFor(report.failures)
  if (opts.json) {
    return { exitCode, stdout: [JSON.stringify(runJson(VERSION, report))], stderr: [] }
  }
  const stdout =
    report.results.length === 0
      ? []
      : report.kind === 'pageop'
        ? reportPageOp(report)
        : report.results.length === 1
          ? reportSingle(report)
          : reportBatch(report)
  return { exitCode, stdout, stderr: reportFailures(report.failures, { debug: opts.debug }) }
}

function renderCommandFailure(
  error: ForgeError,
  opts: { json: boolean; debug: boolean },
): ExecuteResult {
  const failures = [{ path: '', error }]
  const exitCode = exitCodeFor(failures)
  if (opts.json) {
    return { exitCode, stdout: [JSON.stringify(errorJson(VERSION, error))], stderr: [] }
  }
  return { exitCode, stdout: [], stderr: reportFailures(failures, { debug: opts.debug }) }
}

async function runConfigCommand(intent: ConfigIntent, json: boolean): Promise<ExecuteResult> {
  // Lazy: a plain conversion has no reason to touch the config layer at all.
  const { runConfig } = await import('./config-command.js')
  const result = await runConfig(intent)
  if (json) {
    return {
      exitCode: 0,
      stdout: [JSON.stringify(configJson(VERSION, result.config, result.warnings))],
      stderr: [],
    }
  }
  return { exitCode: 0, stdout: result.stdout, stderr: [] }
}

/**
 * Turns an Intent into an ExecuteResult: the one place that does. It never
 * prints, and never throws a ForgeError — one that escapes (a refused config
 * value, say) is reported and given an exit code by the §3.4 rule.
 * src/index.ts writes what it returns.
 */
export async function execute(intent: Intent, opts: ExecuteOptions = {}): Promise<ExecuteResult> {
  const json = opts.json ?? false
  const debug = 'debug' in intent ? intent.debug : false
  try {
    if (intent.kind === 'config') return await runConfigCommand(intent, json)
    if (intent.kind === 'formats') {
      return json
        ? {
            exitCode: 0,
            stdout: [JSON.stringify(formatsJson(VERSION, formatMatrix()))],
            stderr: [],
          }
        : { exitCode: 0, stdout: reportFormats(), stderr: [] }
    }
    if (intent.kind === 'shell') return { exitCode: 0, stdout: [], stderr: [] }
    return renderRun(await runIntent(intent, opts), { json, debug })
  } catch (e) {
    if (!isForgeError(e)) throw e
    return renderCommandFailure(e, { json, debug })
  }
}
