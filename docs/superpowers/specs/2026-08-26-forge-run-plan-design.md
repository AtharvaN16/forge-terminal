# Forge — `runPlan` design

**Date:** 2026-08-26
**Status:** approved, ready for implementation plan
**Origin:** candidate 1 of the 2026-08-26 architecture review

---

## 1. Why

The sequence *plan → write-safety → run → report* is spelled out five times
across `src/cli/execute.ts` and `src/shell/App.tsx`, and every copy implements
a different subset of the rules. Four bugs follow directly from the
duplication:

1. **The shell silently drops a PDF target size.** `compressAction.appliesTo`
   accepts a PDF with compressible images, so the shell offers
   `/compress` → "To a target size" → `500kb`. `values.targetBytes` is read at
   exactly one place, `App.tsx:1242`, inside `convert()` — but
   `confirmDestination` (`App.tsx:1027`) routes every `kind === 'document'`
   source to `confirmDocumentConversion` → `handlePdfDone` instead, which never
   reads it. The job reaches `engines/pdf.ts:402` as
   `quality ?? 60, dpi ?? 150`. The user asked for 500 kB and got a fixed
   re-encode with no search and no refusal.

2. **The shell drops every warning a page or document job produces.**
   `runPdfJobs` (`App.tsx:1360`) pushes only
   `{kind:'note', text: describePdfResult(result)}` and never reads
   `result.warnings`. `compressDocument` builds exactly the warning the design
   doc calls load-bearing — *"Images reduced from 300 to 150 dpi. Pass --dpi
   300 to keep them."* (`engines/pdf.ts:431`). The CLI prints it
   (`report.ts:45`). The shell discards it.

3. **`describePdfResult` has no `convert` case** (`App.tsx:156-176`), so a
   20-page rasterisation reports `✓ done — doc-01.jpg`, naming one of twenty
   files. `reportSingle` handles this shape correctly — in the CLI.

4. **The CLI compress path runs no write-safety at all.** `checkWriteSafety`
   is called from `buildPlan`, the CLI's page-op path (`execute.ts:269`), the
   CLI's convert path (`execute.ts:469`) and the shell's PDF path
   (`App.tsx:1403`) — but not from the compress branch (`execute.ts:290-419`).
   `runJobs` does not check either. `forge compress photo.jpg` twice silently
   overwrites the previous output, with no `--force` and no cross-batch
   collision check.

Design doc §12 already states the intent this restores: *"`run.ts` emits
`job:start`, `job:phase`, `job:done`, `job:error`, `batch:done`. Both front
ends subscribe to the same stream."* The shell grew a parallel pipeline
afterwards.

A fifth item is dead code rather than a bug: `execute.ts:381-388` awaits
`buildPlan` with empty sources, assigns to `compressPlan`, and never reads it
(three references, all writes). It holds the only hardcoded `target: 'jpeg'`
outside the engines, so it reads as an invariant-2 violation to anyone
auditing.

---

## 2. Approach

One deep module that owns composition, so composing the pipeline stops being a
per-caller decision. Two alternatives were rejected:

- **Named steps the caller composes** — more honest that quality resolution
  mutates jobs before they run, but reinstates the failure mode that produced
  all four bugs: if composition is the caller's job, two callers will
  eventually compose differently and nothing catches it.
- **Share the innards only** — fixes today's bugs, leaves the mechanism that
  generates them fully intact.

The accepted cost: `runPlan` becomes the most important function in `core/`,
and a bug in it breaks both front ends at once. That is one place to get wrong
instead of five to keep in sync. `core/write-safety.ts` already works this way
and is the soundest module in the codebase.

---

## 3. Module interface

`src/core/execute-jobs.ts`:

```ts
export interface RunPolicy {
  /** Replaces existing outputs. Overrides two write-safety rules, never collision. */
  force: boolean
  concurrency?: number
  /**
   * When set, each job's quality — and, for a document, its dpi — is resolved
   * by search before the job runs. Unset, the job's own options stand.
   */
  targetBytes?: number
  onEvent?: (event: PlanEvent) => void
}

export interface UnreachableTarget {
  job: Job
  /** Smallest byte size any rung achieved. */
  smallest: number
  /**
   * The settings that produced `smallest` — what "use it anyway" applies.
   * Same shape as a ladder rung plus the resolved quality.
   */
  settings: Partial<ConvertOptions> & { quality: number }
  /** Pre-built, for callers that only report. */
  error: ForgeError
}

export interface RunOutcome {
  results: Result[]
  /**
   * Never ran. Either write-safety refused (retryable with `force`), or
   * `targetBytes` was set for a job whose engine has no `measurer`.
   */
  refusals: InputFailure[]
  /** Never ran — no rung reached the target. May be retried with relaxed settings. */
  unreachable: UnreachableTarget[]
  /** Ran and threw. Cannot be retried. */
  failures: InputFailure[]
  inputBytes: number
  outputBytes: number
}

export async function runPlan(jobs: Job[], policy: RunPolicy): Promise<RunOutcome>
```

Three refusal-ish channels rather than one, because callers genuinely treat
them differently. Collapsing them pushes that discrimination back into every
caller, which is the thing being removed.

`UnreachableTarget` carries both structured data and a pre-built error:
`ForgeError` holds only `{code, title, detail, hint}` with numbers baked into
`detail` as prose (`errors.ts:205`), so the shell cannot recover the smallest
achievable size from an error alone.

### Order of operations

```
checkWriteSafety  →  resolveQuality  →  runJobs
   cheap             up to 32 encodes    the work
```

Write-safety first so a job that will be refused is never searched for thirty
seconds. Safe because quality resolution changes `job.options`, never
`job.outputs`, so write-safety's answer cannot depend on it.

### Call sites after the change

| Caller | Today | After |
| --- | --- | --- |
| CLI page-op | `plan → checkWriteSafety → runJobs → reportPageOp` | `action.plan → runPlan` |
| CLI compress | `plan → dpi ladder → dead buildPlan → runJobs` | `compressAction.plan → runPlan` |
| CLI convert | `buildRasterJob + buildPlan(defer) → checkWriteSafety → runJobs` | `buildPlan → runPlan` |
| Shell convert | `action.plan → findQuality → buildPlan → runJobs` | `action.plan → runPlan` |
| Shell PDF ops | `checkWriteSafety → runJobs` (warnings dropped) | `action.plan → runPlan` |
| Shell compress | **never reaches the search** | `action.plan → runPlan` |

Bug 1 dies structurally: `confirmDestination`'s `source?.kind === 'document'`
branch stops existing, because both kinds take one path. No route remains that
*can* skip the search.

`buildPlan` survives only for the CLI's multi-source convert, turning
`ResolvedInput` into jobs. It loses its write-safety half and the
`deferWriteSafety` flag entirely — that flag exists only because a conversion
run can plan on two paths at once, which stops being true.

---

## 4. Quality resolution

The ladder currently lives at `execute.ts:326-367` and branches on source kind
twice: to pick the encoder (`compressPdf` vs `encodeToBuffer`) and to pick the
rungs (`[dpi ?? 150, 120, 96, 72]` vs `[undefined]`). Both are engine
knowledge sitting in the CLI.

The engine declares how it can be searched. `src/engines/types.ts` gains one
optional method:

```ts
interface Engine {
  /** Present only on engines that can be searched toward a byte target. */
  measurer?(job: Job): Promise<{
    /** Settings to try, coarsest lever first. Image engines return one rung. */
    ladder: Array<Partial<ConvertOptions>>
    /** Encodes in memory at these settings and resolves the byte length. */
    measure: (options: ConvertOptions) => Promise<number>
  }>
}
```

`resolveQuality` then knows nothing about PDFs or images:

```ts
const m = await engineForJob(job)?.measurer?.(job)
for (const rung of m.ladder) {
  const found = await findQuality({
    encode: (q) => m.measure({ ...job.options, ...rung, quality: q }),
    targetBytes,
    onAttempt: (attempt, of) => emit({ type: 'search:attempt', job, attempt, of, rung }),
  })
  if (!found.missed) return { ...rung, quality: found.quality }
}
```

Rationale:

- Deletes a hardcoded branch on source kind — the shape invariant 2 forbids.
- Puts the dpi rungs in the PDF engine, the only module that knows why
  150→120→96→72 and not some other sequence.
- The two-phase `measurer()` preserves the read-once optimisation
  `execute.ts:326` gets by hoisting `original` out of the loop: the engine
  reads the scan once inside `measurer()`, and the returned closure runs
  against bytes already in memory for up to 32 calls. Keeping that with a
  kind-branch in core would mean threading a buffer through core.
- Follows the precedent `findQuality` set deliberately — it takes `encode` as
  a parameter *specifically* so core stays free of Sharp, and its comment says
  the design was "so the same search will serve a PDF encoder later without
  knowing anything about it." This is that sentence one level up.

`measurer` is optional; an engine that cannot be searched produces a refusal
via the existing `unsupportedCompress`, not a crash.

**Only `op: 'convert'` jobs carry `options`** (`core/types.ts:101-119`) — merge,
split, extract, delete and rotate have no `ConvertOptions` at all. Quality
resolution therefore applies to convert jobs only; a `targetBytes` policy is
silently irrelevant to page operations rather than an error, since no caller
can produce that combination through any action's `plan()`.

---

## 5. Event stream

```ts
export type PlanEvent =
  | RunEvent                        // job:start · job:phase · job:done · job:error · batch:done
  | {
      type: 'search:attempt'
      job: Job
      attempt: number               // 1-based, within this rung
      of: number                    // maxAttempts() for this rung — a real bound
      rung: Partial<ConvertOptions> // {} for images, { dpi: 120 } for a document
    }
```

`runPlan` passes `onEvent` through to `runJobs` and emits `search:attempt`
itself, so callers subscribe once.

**No global attempt counter across rungs.** `attempt N of M` is per-rung,
because `maxAttempts()` is only knowable per rung — how many rungs a search
needs is not known until it needs them. A cross-rung total would be invented,
which invariant 7 and `compress.ts:26-34` both forbid. Carrying `rung` on
every attempt is what makes the counter restarting legible rather than
baffling (`execute.ts:352-354` learned this).

**No formatted strings.** `rung` travels as data; each front end formats:

```ts
// cli — output unchanged
rung.dpi === undefined
  ? `attempt ${e.attempt} of ${e.of}`
  : `${rung.dpi} dpi · attempt ${e.attempt} of ${e.of}`

// shell
setAttempt({ n: e.attempt, of: e.of, dpi: rung.dpi })
```

The shell gains the dpi rung in its progress display, which it has never
shown, because it never ran the ladder. `execute`'s `onSearch` and
`onProgress` collapse into one `onEvent`.

---

## 6. Result description

`src/core/describe.ts`:

```ts
export interface FileRef { path: string; bytes: number }

export interface ResultView {
  /** Past tense, one word: 'converted' | 'compressed' | 'split' | 'merged' | … */
  verb: string
  sources: FileRef[]
  /**
   * Every path written — 20 entries for a 20-page render, not just the first.
   * Paths only: `Result` carries a single `outputBytes` total and no per-file
   * breakdown, so a `FileRef[]` here would be inventing numbers.
   */
  outputs: string[]
  outputBytes: number
  /** Only when one source became one output, so a ratio means something. */
  size?: { from: number; to: number }
  warnings: Warning[]
}

export function describeResult(result: Result): ResultView
```

The load-bearing property is **where the switch on `op` lives**. Today there
are two — `report.ts` handles every op, `App.tsx:156-176` handles all but
`convert` — and the divergence is bug 3. After this there is one switch, in
`describeResult`, with a `never` exhaustiveness check. A new op then fails to
compile in core rather than silently mislabelling in one front end.

That deletes `blocks.tsx:116-118`'s
`throw new Error('HistoryEntry cannot render a "${job.op}" result yet')` — not
by handling the case but by making it unreachable.

- **`verb` is display text in core, deliberately.** The alternative returns
  `op` and lets each front end map it to a word, which is a two-place switch
  again. Safe here in a way `hint` is not: both front ends say "converted",
  whereas only one has a `--force` flag. The rule: universal wording may live
  in core, front-end-specific wording may not.
- **`verb` cannot come from `op` alone.** `compressAction.plan()` produces
  `op: 'convert'` jobs (`execute.ts:308` asserts exactly this), so compress and
  convert are the same op. They are told apart by whether the target format
  equals the source format — a compress re-encodes to its own format, a convert
  does not. `/convert jpeg → jpeg` at a lower quality reads as "compressed",
  which is accurate rather than a bug.
- **`outputs` carries all of them.** Bug 3 was never about abbreviation; it was
  the shell not knowing 20 files existed. Core hands over the full list, each
  front end abbreviates for its own width — legitimately different, since the
  CLI has no width constraint and the shell has three bands.
- **`warnings` flow by construction.** Dropping them now requires actively
  ignoring a field rather than not thinking of one.

`report.ts` keeps `reportSingle`/`reportBatch` as renderers over
`ResultView[]`; tallies and byte arithmetic stay put.

---

## 7. Error handling

| Channel | Cause | CLI | Shell |
| --- | --- | --- | --- |
| `refusals` | write-safety | stderr, exit 1 | `output-exists` → overwrite step; else history |
| `unreachable` | no rung reached target | stderr, exit 1 | `size-unreachable` step |
| `failures` | engine threw | stderr, exit 1 | history |
| `refusals` | `targetBytes` set, engine has no `measurer` | stderr, exit 1 | history |

`runPlan` never asks anything. It returns refusals as data and the caller
decides — the CLI turns them into failures, the shell turns `output-exists`
into its overwrite step and re-invokes with `force: true`. This matches the
shell's existing return-and-restart shape (`App.tsx:1161-1164` sets state,
calls `setStep('overwrite')`, and returns), so no promise is held across React
re-renders and `runPlan` stays a plain async function.

**Unreachable PDF targets reuse the shell's existing `size-unreachable`
step**, which today only images reach: report the smallest achievable size and
offer to take it or back out. One behaviour for both source kinds. The step
needs to name the dpi rung as well as the quality.

---

## 8. Testing

Test-driven, per CLAUDE.md. The first test written is the failing regression
test for bug 1.

- `tests/core/execute-jobs.test.ts`
  - **A document job with `targetBytes` descends the ladder.** Against a stub
    engine whose `measurer` returns known sizes, so it is arithmetic rather
    than a 20-second PDF encode. This is the test that would have caught bug 1;
    write it first and watch it fail.
  - Write-safety refuses before any `measure` is called — asserts the ordering
    and covers bug 4.
  - An engine without `measurer` plus `targetBytes` produces a refusal, not a
    throw.
  - Unreachable returns `smallest` and `settings` matching the best rung.
- `tests/core/describe.test.ts` — every `Job['op']` produces a `ResultView`;
  warnings survive; a 20-output convert reports 20 outputs.
- One integration test per front end using the existing `makeScannedPdf`
  helper in `tests/helpers/fixtures.ts`, currently used only by CLI tests.

The 915 existing tests are the regression net. None are expected to assert the
buggy behaviour — the shell's PDF compress path has zero coverage today, which
is why bug 1 survived.

---

## 9. Out of scope

Stated explicitly so the plan does not drift into them:

- **Candidate 3** (unifying `buildPlan` and `Action.plan`) beyond what falls
  out naturally. The shell stops calling `buildPlan`; the CLI's multi-source
  path keeps it. Candidate 3 becomes smaller as a result.
- **`suggestFormat`** (`App.tsx:1187`) stays shell-only. The CLI has no
  equivalent and does not need one.
- **Candidate 6** — `targetUnreachable`'s hint tells CLI users to
  "`/convert` to a smaller format", which is shell wording in core. Real, but a
  separate change.
- **`ModeHeader`**, imported by `flows/pdf.tsx` but never rendered. Unrelated
  loose end.
