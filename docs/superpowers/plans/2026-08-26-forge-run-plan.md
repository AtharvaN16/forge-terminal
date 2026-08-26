# runPlan Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace five hand-written copies of *plan → write-safety → run → report* with one `runPlan` module both front ends call, fixing four bugs that follow from the duplication.

**Architecture:** A new `core/execute-jobs.ts` owns composition — `checkWriteSafety` → `resolveQuality` → `runJobs` — and emits one event stream. A new `core/describe.ts` turns a `Result` into a data-only `ResultView` that `cli/report.ts` renders as lines and `shell/blocks.tsx` renders as React. Engines declare how they can be searched toward a byte target via one new optional `measurer()` method, so core never branches on source kind.

**Tech Stack:** TypeScript (ESM, `.js` import specifiers), Node ≥20, Vitest, Sharp, pdf-lib, @hyzyla/pdfium, React 19 + Ink 7, Biome.

**Spec:** `docs/superpowers/specs/2026-08-26-forge-run-plan-design.md`

## How to read this plan

Tasks 1–4 build new modules and carry complete implementations, because there
is no surrounding code to respect. Tasks 5–10 migrate existing call sites and
give exact file/line targets, the interface to call, and the behaviour to
preserve — but not full replacement bodies for every hunk. That is deliberate:
`App.tsx` is 2032 lines and `execute.ts` is 506, and a plausible-looking
replacement written without the surrounding lines in view is worse than none.
**Read the target range before editing it.**

Each task's test comes first and must be seen to fail before implementation.

## Global Constraints

- `core/` and `engines/` import no React, no Ink, no Chalk, and never write to stdout. Everything they return is data. (Invariant 1)
- No hardcoded list of output formats anywhere. Targets come from `targetsFor(source)`. (Invariant 2)
- Sources are probed by content, never by file extension. (Invariant 3)
- `.rotate()` runs before any other Sharp operation. (Invariant 4)
- Alpha is flattened when the target format cannot carry it. (Invariant 5)
- Writes are atomic — temp file, then rename. (Invariant 6)
- Progress is never fabricated. Single-file conversion has no percentage. (Invariant 7)
- A password is never logged, never returned, never attached to an error. (Invariant 8)
- All work happens on branch `dev`. Never commit to `main`.
- Import specifiers end in `.js` even for `.ts` sources (ESM + `"type": "module"`).
- Only `op: 'convert'` jobs carry `options: ConvertOptions`. Page ops have none.
- Verify with `npm test` (915 tests today), `npm run typecheck`, `npm run lint`.

---

### Task 1: `ResultView` and `describeResult`

Pure addition — no existing caller changes, so the suite stays green.

**Files:**
- Create: `src/core/describe.ts`
- Test: `tests/core/describe.test.ts`

**Interfaces:**
- Consumes: `Result`, `Job`, `Warning`, `SourceInfo` from `src/core/types.js`
- Produces: `ResultView`, `FileRef`, `describeResult(result: Result): ResultView`

- [ ] **Step 1: Write the failing test**

```ts
// tests/core/describe.test.ts
import { describe, expect, it } from 'vitest'
import { describeResult } from '../../src/core/describe.js'
import type { Job, Result, SourceInfo } from '../../src/core/types.js'

const source = (path: string, format: string, bytes: number): SourceInfo =>
  ({ kind: 'image', path, format, bytes, width: 10, height: 10, hasAlpha: false }) as SourceInfo

const convertJob = (from: string, to: string, outputs: [string, ...string[]]): Job => ({
  op: 'convert',
  sources: [source(`/in.${from}`, from, 1000)],
  outputs,
  target: to as never,
  options: { background: '#fff', keepMetadata: false },
})

describe('describeResult', () => {
  it('calls a format change a conversion', () => {
    const result: Result = { job: convertJob('jpeg', 'webp', ['/out.webp']), outputBytes: 400, warnings: [] }
    const view = describeResult(result)
    expect(view.verb).toBe('converted')
    expect(view.size).toEqual({ from: 1000, to: 400 })
  })

  it('calls a same-format re-encode a compression', () => {
    const result: Result = { job: convertJob('jpeg', 'jpeg', ['/out.jpg']), outputBytes: 400, warnings: [] }
    expect(describeResult(result).verb).toBe('compressed')
  })

  it('reports every output of a multi-page render, not just the first', () => {
    const outputs = Array.from({ length: 20 }, (_, i) => `/doc-${i + 1}.jpg`) as [string, ...string[]]
    const view = describeResult({ job: convertJob('pdf', 'jpeg', outputs), outputBytes: 900, warnings: [] })
    expect(view.outputs).toHaveLength(20)
    expect(view.size).toBeUndefined() // one source, twenty outputs — no meaningful ratio
  })

  it('carries warnings through', () => {
    const warnings = [{ code: 'pdf-downsampled' as const, message: 'Images reduced from 300 to 150 dpi.' }]
    expect(describeResult({ job: convertJob('pdf', 'pdf', ['/o.pdf']), outputBytes: 5, warnings }).warnings).toEqual(warnings)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/core/describe.test.ts`
Expected: FAIL — `Failed to resolve import "../../src/core/describe.js"`

- [ ] **Step 3: Write minimal implementation**

```ts
// src/core/describe.ts
import type { Job, Result, Warning } from './types.js'

export interface FileRef {
  path: string
  bytes: number
}

export interface ResultView {
  /** Past tense, one word. Universal wording — both front ends say the same. */
  verb: string
  sources: FileRef[]
  /**
   * Every path written. Paths only: `Result` carries a single `outputBytes`
   * total and no per-file breakdown, so a `FileRef[]` would invent numbers.
   */
  outputs: string[]
  outputBytes: number
  /** Only when one source became one output, so a ratio means something. */
  size?: { from: number; to: number }
  warnings: Warning[]
}

/**
 * `compressAction.plan()` produces `op: 'convert'` jobs, so compress and
 * convert are the same op and cannot be told apart by `op` alone. A compress
 * re-encodes to its own format; a convert does not.
 */
function verbFor(job: Job): string {
  switch (job.op) {
    case 'convert':
      return job.target === job.sources[0].format ? 'compressed' : 'converted'
    case 'merge':
      return 'merged'
    case 'split':
      return 'split'
    case 'extract':
      return 'extracted'
    case 'delete':
      return 'deleted from'
    case 'rotate':
      return 'rotated'
    default: {
      // Exhaustiveness: a new op fails to compile HERE, in one place, rather
      // than silently mislabelling in one front end (the bug this replaces).
      const never: never = job
      throw new Error(`describeResult has no verb for ${JSON.stringify(never)}`)
    }
  }
}

export function describeResult(result: Result): ResultView {
  const { job } = result
  const sources = job.sources.map((s) => ({ path: s.path, bytes: s.bytes }))
  const single = sources.length === 1 && job.outputs.length === 1

  return {
    verb: verbFor(job),
    sources,
    outputs: [...job.outputs],
    outputBytes: result.outputBytes,
    ...(single ? { size: { from: sources[0].bytes, to: result.outputBytes } } : {}),
    warnings: result.warnings,
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/core/describe.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Verify nothing regressed, then commit**

```bash
npm run typecheck && npm run lint
git add src/core/describe.ts tests/core/describe.test.ts
git commit -m "feat(core): add describeResult, one exhaustive switch over Job['op']"
```

---

### Task 2: `Engine.measurer` on the interface, and the image engine

**Files:**
- Modify: `src/engines/types.ts:7-15`
- Modify: `src/engines/image.ts` (add `measurer` to the exported engine object)
- Test: `tests/engines/image-measurer.test.ts`

**Interfaces:**
- Consumes: `Job`, `ConvertOptions` from `src/core/types.js`; `encodeToBuffer` from `src/engines/image.js`
- Produces: `Engine.measurer?(job: Job): Promise<Measurer | undefined>` where
  `interface Measurer { ladder: Array<Partial<ConvertOptions>>; measure(options: ConvertOptions): Promise<number> }`

- [ ] **Step 1: Write the failing test**

```ts
// tests/engines/image-measurer.test.ts
import { describe, expect, it } from 'vitest'
import { imageEngine } from '../../src/engines/image.js'
import { makeJpeg } from '../helpers/fixtures.js'
import { probe } from '../../src/engines/registry.js'

describe('imageEngine.measurer', () => {
  it('offers exactly one rung — an image has one lever', async () => {
    const path = await makeJpeg(200, 200)
    const source = await probe(path)
    const job = {
      op: 'convert' as const,
      sources: [source] as [typeof source],
      outputs: ['/unused.jpg'] as [string],
      target: 'jpeg' as const,
      options: { background: '#fff', keepMetadata: false },
    }
    const m = await imageEngine.measurer?.(job)
    expect(m?.ladder).toEqual([{}])
  })

  it('measures without writing a file, and lower quality is smaller', async () => {
    const path = await makeJpeg(200, 200)
    const source = await probe(path)
    const job = {
      op: 'convert' as const,
      sources: [source] as [typeof source],
      outputs: ['/unused.jpg'] as [string],
      target: 'jpeg' as const,
      options: { background: '#fff', keepMetadata: false },
    }
    const m = await imageEngine.measurer?.(job)
    const big = await m!.measure({ background: '#fff', keepMetadata: false, quality: 95 })
    const small = await m!.measure({ background: '#fff', keepMetadata: false, quality: 10 })
    expect(small).toBeLessThan(big)
  })
})
```

> If `tests/helpers/fixtures.ts` exposes a differently-named JPEG helper, use that name — check the file's exports first. Fixtures are generated by Sharp at test time, never committed (design doc §14).

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/engines/image-measurer.test.ts`
Expected: FAIL — `m` is `undefined`, so `expect(m?.ladder)` receives `undefined`

- [ ] **Step 3: Add the interface method**

```ts
// src/engines/types.ts — add above `export interface Engine`
import type { ConvertOptions, FormatId, Job, Progress, Result, SourceInfo } from '../core/types.js'

/**
 * How an engine can be searched toward a byte target.
 *
 * Two-phase on purpose: `measurer()` does the expensive setup once (reading a
 * scan off disk, say) and returns a closure the search calls up to 32 times
 * against bytes already in memory.
 */
export interface Measurer {
  /** Settings to try, coarsest lever first. An image engine returns one rung. */
  ladder: Array<Partial<ConvertOptions>>
  /** Encodes in memory at these settings and resolves the byte length. Writes nothing. */
  measure(options: ConvertOptions): Promise<number>
}
```

Then add to the `Engine` interface, after `run`:

```ts
  /**
   * Present only on engines that can be searched toward a byte target.
   * Absent means "cannot be compressed to a size", which `runPlan` turns into
   * a refusal rather than a crash.
   */
  measurer?(job: Job): Promise<Measurer | undefined>
```

- [ ] **Step 4: Implement it on the image engine**

In `src/engines/image.ts`, add to the exported engine object:

```ts
  /**
   * One rung: an image has a single lever (quality). The dpi ladder belongs to
   * the PDF engine, which is the only place that knows why 150 → 120 → 96 → 72.
   */
  async measurer(job: Job) {
    if (job.op !== 'convert') return undefined
    const source = job.sources[0]
    return {
      ladder: [{}],
      measure: async (options: ConvertOptions) =>
        (await encodeToBuffer(source, job.target, options)).length,
    }
  },
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/engines/image-measurer.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 6: Commit**

```bash
npm run typecheck && npm run lint
git add src/engines/types.ts src/engines/image.ts tests/engines/image-measurer.test.ts
git commit -m "feat(engines): declare how an engine can be searched toward a byte target"
```

---

### Task 3: The PDF engine's two-dimensional ladder

Moves the dpi rungs out of `cli/execute.ts` and into the only module that knows why they are those numbers.

**Files:**
- Modify: `src/engines/pdf.ts` (add `measurer`)
- Test: `tests/engines/pdf-measurer.test.ts`

**Interfaces:**
- Consumes: `Measurer` from `src/engines/types.js`; `compressPdf` from `src/core/pdf-compress.js`
- Produces: `pdfEngine.measurer` returning a 4-rung ladder

- [ ] **Step 1: Write the failing test**

```ts
// tests/engines/pdf-measurer.test.ts
import { describe, expect, it } from 'vitest'
import { pdfEngine } from '../../src/engines/pdf.js'
import { probe } from '../../src/engines/registry.js'
import { makeScannedPdf } from '../helpers/fixtures.js'

describe('pdfEngine.measurer', () => {
  it('descends dpi when quality alone cannot get there', async () => {
    const path = await makeScannedPdf()
    const source = await probe(path)
    const job = {
      op: 'convert' as const,
      sources: [source] as [typeof source],
      outputs: ['/unused.pdf'] as [string],
      target: 'pdf' as const,
      options: { background: '#fff', keepMetadata: false },
    }
    const m = await pdfEngine.measurer?.(job)
    expect(m?.ladder.map((r) => r.dpi)).toEqual([150, 120, 96, 72])
  })

  it('honours an explicit dpi as the first rung', async () => {
    const path = await makeScannedPdf()
    const source = await probe(path)
    const job = {
      op: 'convert' as const,
      sources: [source] as [typeof source],
      outputs: ['/unused.pdf'] as [string],
      target: 'pdf' as const,
      options: { background: '#fff', keepMetadata: false, dpi: 300 },
    }
    const m = await pdfEngine.measurer?.(job)
    expect(m?.ladder[0]?.dpi).toBe(300)
  })

  it('measures in memory and never writes', async () => {
    const path = await makeScannedPdf()
    const source = await probe(path)
    const job = {
      op: 'convert' as const,
      sources: [source] as [typeof source],
      outputs: ['/must-not-exist.pdf'] as [string],
      target: 'pdf' as const,
      options: { background: '#fff', keepMetadata: false },
    }
    const m = await pdfEngine.measurer?.(job)
    const bytes = await m!.measure({ background: '#fff', keepMetadata: false, quality: 40, dpi: 96 })
    expect(bytes).toBeGreaterThan(0)
    expect(existsSync('/must-not-exist.pdf')).toBe(false)
  })
})
```

Add `import { existsSync } from 'node:fs'` at the top.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/engines/pdf-measurer.test.ts`
Expected: FAIL — `m` is `undefined`

- [ ] **Step 3: Implement it**

In `src/engines/pdf.ts`, add to the exported engine object. The comment explaining the rungs moves here from `cli/execute.ts:328-340` — copy its reasoning, do not re-invent it:

```ts
  /**
   * A PDF has two levers, so the search has two dimensions.
   *
   * Quality is tried first at the default resolution. If even quality 1
   * overshoots, the resolution comes down a rung and the quality search runs
   * again. The user named a size; reaching it is what they asked for.
   *
   * Descending only when needed matters: most targets are met on the first
   * rung, and each extra rung is another full bisection.
   *
   * The file is read once here, not per attempt — the search runs `measure`
   * up to 8 times per rung, and re-reading a large scan each time is work the
   * user waits through for nothing.
   */
  async measurer(job: Job) {
    if (job.op !== 'convert') return undefined
    const original = await readFile(job.sources[0].path)
    return {
      ladder: [job.options.dpi ?? 150, 120, 96, 72].map((dpi) => ({ dpi })),
      measure: async (options: ConvertOptions) =>
        (
          await compressPdf(original, {
            quality: options.quality ?? 60,
            ...(options.dpi === undefined ? {} : { dpi: options.dpi }),
          })
        ).bytes.byteLength,
    }
  },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/engines/pdf-measurer.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
npm run typecheck && npm run lint
git add src/engines/pdf.ts tests/engines/pdf-measurer.test.ts
git commit -m "feat(engines): move the dpi ladder into the PDF engine"
```

---

### Task 4: `runPlan` — the regression test for the headline bug

This is the task that fixes bug 1's mechanism. Write the first test and watch it fail before writing any implementation.

**Files:**
- Create: `src/core/execute-jobs.ts`
- Test: `tests/core/execute-jobs.test.ts`

**Interfaces:**
- Consumes: `checkWriteSafety` from `src/core/write-safety.js`; `runJobs`, `RunEvent` from `src/core/run.js`; `findQuality` from `src/core/compress.js`; `engineForJob` from `src/engines/registry.js`; `targetUnreachable`, `unsupportedCompress` from `src/core/errors.js`
- Produces: `runPlan(jobs, policy)`, `RunPolicy`, `RunOutcome`, `UnreachableTarget`, `PlanEvent`

- [ ] **Step 1: Write the failing regression test**

```ts
// tests/core/execute-jobs.test.ts
import { describe, expect, it, vi } from 'vitest'
import { runPlan } from '../../src/core/execute-jobs.js'

// A stub engine keeps this arithmetic rather than a 20-second PDF encode.
// `sizes` maps `${dpi}:${quality}` to a byte count.
const stubEngine = (ladder: Array<Record<string, unknown>>, sizes: (o: Record<string, number>) => number) => ({
  id: 'stub',
  reads: new Set(['pdf']),
  writes: new Set(['pdf']),
  ops: new Set(['convert']),
  probe: vi.fn(),
  run: vi.fn(async (job) => ({ job, outputBytes: 1, warnings: [] })),
  measurer: vi.fn(async () => ({
    ladder,
    measure: async (o: Record<string, number>) => sizes(o),
  })),
})

describe('runPlan', () => {
  it('descends the ladder for a document target size — the bug the shell had', async () => {
    // 150 dpi never fits at any quality; 120 dpi fits at quality <= 50.
    const engine = stubEngine(
      [{ dpi: 150 }, { dpi: 120 }, { dpi: 96 }, { dpi: 72 }],
      ({ dpi, quality }) => (dpi === 150 ? 900_000 : quality <= 50 ? 400_000 : 800_000),
    )
    const outcome = await runPlan([jobFixture()], {
      force: true,
      targetBytes: 500_000,
      engineFor: () => engine,
    })

    expect(outcome.unreachable).toHaveLength(0)
    expect(outcome.results).toHaveLength(1)
    const ran = engine.run.mock.calls[0][0]
    expect(ran.options.dpi).toBe(120)
    expect(ran.options.quality).toBeLessThanOrEqual(50)
  })

  it('reports the smallest achievable when no rung reaches the target', async () => {
    const engine = stubEngine([{ dpi: 150 }, { dpi: 72 }], ({ dpi }) => (dpi === 72 ? 780_000 : 900_000))
    const outcome = await runPlan([jobFixture()], {
      force: true,
      targetBytes: 500_000,
      engineFor: () => engine,
    })

    expect(outcome.results).toHaveLength(0)
    expect(outcome.unreachable).toHaveLength(1)
    expect(outcome.unreachable[0].smallest).toBe(780_000)
    expect(outcome.unreachable[0].settings.dpi).toBe(72)
    expect(engine.run).not.toHaveBeenCalled()
  })

  it('refuses on write-safety BEFORE measuring anything', async () => {
    const engine = stubEngine([{}], () => 1)
    const outcome = await runPlan([jobFixture({ outputs: [existingFilePath()] })], {
      force: false,
      targetBytes: 500_000,
      engineFor: () => engine,
    })

    expect(outcome.refusals).toHaveLength(1)
    expect(outcome.refusals[0].error.code).toBe('output-exists')
    expect(engine.measurer).not.toHaveBeenCalled() // the ordering guarantee
  })

  it('refuses rather than throwing when the engine cannot be searched', async () => {
    const engine = { ...stubEngine([{}], () => 1), measurer: undefined }
    const outcome = await runPlan([jobFixture()], {
      force: true,
      targetBytes: 500_000,
      engineFor: () => engine,
    })

    expect(outcome.results).toHaveLength(0)
    expect(outcome.refusals).toHaveLength(1)
  })

  it('emits per-rung attempt events carrying the rung', async () => {
    const engine = stubEngine([{ dpi: 150 }, { dpi: 120 }], ({ dpi, quality }) =>
      dpi === 150 ? 900_000 : quality <= 50 ? 400_000 : 800_000,
    )
    const events: unknown[] = []
    await runPlan([jobFixture()], {
      force: true,
      targetBytes: 500_000,
      engineFor: () => engine,
      onEvent: (e) => events.push(e),
    })

    const attempts = events.filter((e) => (e as { type: string }).type === 'search:attempt')
    expect(attempts.length).toBeGreaterThan(0)
    expect(attempts.every((a) => (a as { of: number }).of > 0)).toBe(true)
    expect(new Set(attempts.map((a) => (a as { rung: { dpi: number } }).rung.dpi))).toEqual(new Set([150, 120]))
  })
})
```

Write `jobFixture()` and `existingFilePath()` as local helpers at the top of the file: `jobFixture` returns a `convert` job over a temp source file with `options: { background: '#fff', keepMetadata: false }`; `existingFilePath()` writes a temp file and returns its path so `existsSync` finds it.

> `engineFor` is a seam for tests only — it defaults to `engineForJob` from the registry. Keeping it injectable is what lets these tests be arithmetic instead of real encodes.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/core/execute-jobs.test.ts`
Expected: FAIL — `Failed to resolve import "../../src/core/execute-jobs.js"`

- [ ] **Step 3: Write the implementation**

```ts
// src/core/execute-jobs.ts
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
      /** `maxAttempts()` for this rung — a real bound, never invented. */
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
  /** What "use it anyway" would apply. */
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
  /** Never ran — no rung reached the target. Retryable with relaxed settings. */
  unreachable: UnreachableTarget[]
  /** Ran and threw. Not retryable. */
  failures: InputFailure[]
  inputBytes: number
  outputBytes: number
}

/**
 * Composes the pipeline both front ends need, so composing it stops being a
 * per-caller decision. Five hand-written copies of this sequence disagreed
 * with each other in four separate ways; see the 2026-08-26 design doc.
 *
 * Order is deliberate: write-safety is cheap and quality resolution is up to
 * 32 encodes, so a job that will be refused is never searched. Safe because
 * resolution changes `options`, never `outputs`.
 */
export async function runPlan(jobs: Job[], policy: RunPolicy): Promise<RunOutcome> {
  const emit = policy.onEvent ?? (() => {})
  const engineFor = policy.engineFor ?? engineForJob

  const safe = checkWriteSafety(jobs, { force: policy.force })
  const refusals: InputFailure[] = [...safe.failures]
  const unreachable: UnreachableTarget[] = []
  const ready: Job[] = []

  for (const job of safe.jobs) {
    if (policy.targetBytes === undefined || job.op !== 'convert') {
      ready.push(job)
      continue
    }

    const measurer = await engineFor(job)?.measurer?.(job)
    if (!measurer) {
      refusals.push({ path: job.sources[0].path, error: unsupportedCompress(job.sources[0]) })
      continue
    }

    let smallest = Number.POSITIVE_INFINITY
    let best: (Partial<ConvertOptions> & { quality: number }) | undefined
    for (const rung of measurer.ladder) {
      const found = await findQuality({
        encode: (quality) => measurer.measure({ ...job.options, ...rung, quality }),
        targetBytes: policy.targetBytes,
        onAttempt: (attempt, of) => emit({ type: 'search:attempt', job, attempt, of, rung }),
      })
      if (found.bytes < smallest) {
        smallest = found.bytes
        best = { ...rung, quality: found.quality }
      }
      if (!found.missed) {
        Object.assign(job.options, rung, { quality: found.quality })
        ready.push(job)
        best = undefined
        break
      }
    }

    if (best) {
      unreachable.push({
        job,
        smallest,
        settings: best,
        error: targetUnreachable(job.sources[0], policy.targetBytes, smallest),
      })
    }
  }

  const done = await runJobs(ready, {
    ...(policy.concurrency === undefined ? {} : { concurrency: policy.concurrency }),
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/core/execute-jobs.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Verify the whole suite is still green, then commit**

```bash
npm test && npm run typecheck && npm run lint
git add src/core/execute-jobs.ts tests/core/execute-jobs.test.ts
git commit -m "feat(core): add runPlan, one execution seam for both front ends"
```

---

### Task 5: CLI compress path → `runPlan`

Fixes bug 4 (no write-safety on this path) and deletes the dead `compressPlan` block.

**Files:**
- Modify: `src/cli/execute.ts:290-419`
- Test: `tests/cli/compress-write-safety.test.ts`

**Interfaces:**
- Consumes: `runPlan`, `RunOutcome` from `src/core/execute-jobs.js`

- [ ] **Step 1: Write the failing test**

```ts
// tests/cli/compress-write-safety.test.ts
import { describe, expect, it } from 'vitest'
import { execute } from '../../src/cli/execute.js'
// Build an Intent for `compress <path>` the same way the other cli tests do —
// copy the construction from tests/cli/pdf-compress.test.ts.

describe('cli compress write safety', () => {
  it('refuses to overwrite an existing output without --force', async () => {
    // 1. compress once — succeeds, writes <stem>-compressed.jpg
    // 2. compress again with force: false
    // 3. expect exitCode 1 and an output-exists refusal on stderr
  })

  it('replaces it when --force is passed', async () => {
    // same, with force: true — expect exitCode 0
  })
})
```

Fill the bodies by copying the `Intent` construction and fixture setup from `tests/cli/pdf-compress.test.ts`, which already drives `execute` for this path.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/cli/compress-write-safety.test.ts`
Expected: FAIL — the second compress succeeds with exit code 0, silently overwriting

- [ ] **Step 3: Replace the compress branch**

In `src/cli/execute.ts`, the `if (intent.kind === 'compress')` block becomes:

```ts
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
      // A typed `--dpi` applies to both modes.
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

    return {
      exitCode: failures.length > 0 ? 1 : 0,
      stdout:
        outcome.results.length === 0
          ? []
          : outcome.results.length === 1
            ? reportSingle(outcome)
            : reportBatch(outcome),
      stderr: reportFailures(failures, { debug: intent.debug }),
    }
  }
```

The whole `compressPlan` block (`buildPlan` with empty sources, the two assignments) is deleted — it was never read, and it held the only hardcoded `target: 'jpeg'` outside the engines.

> `reportSingle`/`reportBatch` currently take a `RunSummary`. `RunOutcome` is structurally compatible for the fields they read (`results`, `inputBytes`, `outputBytes`). If TypeScript complains, widen their parameter type to `Pick<RunOutcome, 'results' | 'inputBytes' | 'outputBytes'>` — Task 7 reworks them properly.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/cli/compress-write-safety.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Verify no CLI regressions, then commit**

```bash
npx vitest run tests/cli && npm run typecheck && npm run lint
git add src/cli/execute.ts tests/cli/compress-write-safety.test.ts
git commit -m "fix(cli): run write safety on the compress path; drop dead compressPlan"
```

---

### Task 6: CLI convert and page-op paths → `runPlan`

**Files:**
- Modify: `src/cli/execute.ts:243-280` (page-op), `:421-505` (convert)
- Modify: `src/core/plan.ts:8-75` (drop `deferWriteSafety` and the write-safety call)

**Interfaces:**
- Consumes: `runPlan` from `src/core/execute-jobs.js`
- Produces: `buildPlan(req)` with `PlanRequest` no longer carrying `deferWriteSafety`, and no longer calling `checkWriteSafety`

- [ ] **Step 1: Replace the page-op branch**

Replace the `checkWriteSafety` + `runJobs` pair at `execute.ts:243-280` with a single `runPlan(planned, { force: intent.force, ... })` call, mapping `outcome.refusals` and `outcome.failures` into the existing `reportFailures` call exactly as Task 5 does.

- [ ] **Step 2: Replace the convert branch**

At `execute.ts:421-505`, `buildPlan` still builds the jobs (it turns `ResolvedInput` into one job per source), but the `checkWriteSafety([...plan.jobs, ...documentJobs])` call at `:469` is deleted — `runPlan` now does it over the union:

```ts
const outcome = await runPlan([...plan.jobs, ...documentJobs], {
  force: intent.force,
  ...(intent.concurrency === undefined ? {} : { concurrency: intent.concurrency }),
  onEvent: (event) => { /* same progress mapping as Task 5 */ },
})
```

- [ ] **Step 3: Strip `plan.ts` back to planning**

Delete `deferWriteSafety` from `PlanRequest`, delete the `checkWriteSafety` import and the `if (req.deferWriteSafety) return ...` early exit, and return `{ jobs, failures }` directly. The long doc comment explaining why the flag exists goes with it — the two-planning-paths condition it describes is what this change removes.

- [ ] **Step 4: Run the suite**

Run: `npm test`
Expected: PASS. If a `tests/core/plan.test.ts` case asserts that `buildPlan` refuses an existing output, move it to `tests/core/execute-jobs.test.ts` — that responsibility moved.

- [ ] **Step 5: Commit**

```bash
npm run typecheck && npm run lint
git add src/cli/execute.ts src/core/plan.ts tests/
git commit -m "refactor(cli): route convert and page ops through runPlan; plan.ts only plans"
```

---

### Task 7: `report.ts` renders `ResultView`

**Files:**
- Modify: `src/cli/report.ts:24-79`
- Test: `tests/cli/report.test.ts` (extend if present, create if not)

**Interfaces:**
- Consumes: `describeResult`, `ResultView` from `src/core/describe.js`

- [ ] **Step 1: Write the failing test**

```ts
it('names the file count for a multi-output render, not one filename', () => {
  const view = { verb: 'converted', sources: [{ path: '/doc.pdf', bytes: 900 }],
    outputs: Array.from({ length: 20 }, (_, i) => `/doc-${i + 1}.jpg`),
    outputBytes: 500, warnings: [] }
  expect(renderView(view).join(' ')).toContain('20 files')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/cli/report.test.ts`
Expected: FAIL — `renderView` is not exported

- [ ] **Step 3: Add `renderView(view: ResultView): string[]`**

Have `reportSingle` call `describeResult` then `renderView`. Keep the existing byte arithmetic and tally logic in `reportBatch`. Preserve current single-file output wording exactly so existing CLI tests keep passing.

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/cli`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
npm run typecheck && npm run lint
git add src/cli/report.ts tests/cli/report.test.ts
git commit -m "refactor(cli): render results from ResultView"
```

---

### Task 8: Shell PDF path → `runPlan` (fixes dropped warnings)

**Files:**
- Modify: `src/shell/App.tsx:1343-1376` (`runPdfJobs`), `:1402-1410` (`handlePdfDone`)
- Test: `tests/shell/pdf-warnings.test.tsx`

- [ ] **Step 1: Write the failing test**

Stage a scanned PDF, run a compress through the PDF flow, and assert the rendered frame contains the `pdf-downsampled` warning text (`Images reduced from`). Copy the harness setup from `tests/shell/pdf-flow-app.test.tsx`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/shell/pdf-warnings.test.tsx`
Expected: FAIL — the warning never reaches the frame; only a `note` block is pushed

- [ ] **Step 3: Replace `runPdfJobs`**

Call `runPlan(jobs, { force })`, and push a `result` block per `outcome.results` carrying the full `Result` (so `blocks.tsx` can render warnings in Task 10) instead of `{kind:'note', text: describePdfResult(result)}`. Delete `describePdfResult` (`App.tsx:156-176`) once nothing calls it.

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/shell`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
npm run typecheck && npm run lint
git add src/shell/App.tsx tests/shell/pdf-warnings.test.tsx
git commit -m "fix(shell): stop discarding warnings from page and document jobs"
```

---

### Task 9: Shell convert/compress → `runPlan` (fixes the headline bug)

**Files:**
- Modify: `src/shell/App.tsx:1027-1033` (`confirmDestination`), `:1139-1217` (`finishConversion`), `:1219-1284` (`convert`)
- Test: `tests/shell/compress-pdf-target-size.test.tsx`

- [ ] **Step 1: Write the failing regression test**

```tsx
// tests/shell/compress-pdf-target-size.test.tsx
// Stage a scanned PDF, run /compress -> "To a target size" -> 500kb,
// and assert the written file is at most 500 kB.
//
// This fails today: confirmDestination routes documents to
// confirmDocumentConversion, which never reads values.targetBytes, so the
// file is written at a fixed q60/150dpi with no search.
```

Copy the keystroke harness from `tests/shell/compress-flow.test.tsx` (which only ever stages `photo.jpg`) and swap the fixture for `makeScannedPdf()`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/shell/compress-pdf-target-size.test.tsx`
Expected: FAIL — the output exceeds 500 kB

- [ ] **Step 3: Delete the document branch and route both kinds through `runPlan`**

In `confirmDestination`, delete the `if (source?.kind === 'document')` branch entirely — both kinds now take one path. In `finishConversion`, delete the `buildPlan` call and call:

```ts
const outcome = await runPlan([planned], {
  force: opts.force ?? false,
  ...(typeof values.targetBytes === 'number' ? { targetBytes: values.targetBytes } : {}),
  onEvent: (e) => {
    if (e.type === 'search:attempt') setAttempt({ n: e.attempt, of: e.of, dpi: e.rung.dpi })
  },
})
```

Map the outcome: `outcome.refusals` with code `output-exists` → `setPending` + `setStep('overwrite')`; `outcome.unreachable[0]` → `setSizeUnreachable({ ..., smallest: u.smallest, quality: u.settings.quality, dpi: u.settings.dpi })` + `setStep('size-unreachable')`; results → history. Delete the `findQuality` block at `:1242-1268` — `runPlan` owns it now.

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/shell`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
npm run typecheck && npm run lint
git add src/shell/App.tsx tests/shell/compress-pdf-target-size.test.tsx
git commit -m "fix(shell): honour a target size when compressing a PDF"
```

---

### Task 10: `blocks.tsx` renders `ResultView`; size-unreachable names the dpi rung

**Files:**
- Modify: `src/shell/blocks.tsx:102-118`
- Modify: `src/shell/App.tsx` (the `size-unreachable` step's copy, near `:1776`)
- Test: `tests/shell/blocks.test.tsx` (extend)

- [ ] **Step 1: Write the failing test**

Assert that a `result` block for a 20-output convert renders "20 files" rather than one filename, and that a block for a result with warnings renders the warning text.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/shell/blocks.test.tsx`
Expected: FAIL

- [ ] **Step 3: Render from `describeResult`**

Have the `result` case call `describeResult(result)` and render the `ResultView` — verb, output count, size delta, then one line per warning. Delete the `throw new Error('HistoryEntry cannot render a "${job.op}" result yet')` at `:116-118`; the exhaustive switch in `describeResult` makes it unreachable.

In the `size-unreachable` step, include the dpi rung when present: "Smallest is 780 KB (72 dpi, quality 1) — you asked for 500 KB."

- [ ] **Step 4: Run the full suite**

Run: `npm test && npm run typecheck && npm run lint`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/shell/blocks.tsx src/shell/App.tsx tests/shell/blocks.test.tsx
git commit -m "fix(shell): render results from ResultView, warnings included"
```

---

## Done when

- `npm test` passes with more tests than the 915 at the start.
- `npm run typecheck` and `npm run lint` are clean.
- `rg 'deferWriteSafety|compressPlan|describePdfResult' src/` returns nothing.
- `rg 'checkWriteSafety' src/` returns only `core/execute-jobs.ts` and `core/write-safety.ts`.
- Compressing a scanned PDF to a target size in the shell produces a file at or under the target, or offers the size-unreachable choice.
