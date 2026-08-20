# Forge Phase 4a — PDF Pixels Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render PDF pages to images, embed images into PDFs, decrypt PDFs from the CLI, and show real progress while doing it.

**Architecture:** A second PDF engine (`engines/mupdf.ts`) sits beside the existing pdf-lib one, split by library rather than by feature. `engineForJob` learns to match a conversion on source *and* target, which two PDF-writing engines make mandatory. `Progress` and `runJobs`'s `onEvent` — both declared in phase 3 and never used — get wired to a determinate bar.

**Tech Stack:** Node 24 · TypeScript strict, ESM · React + Ink · Sharp 0.35.3 · pdf-lib 1.17.1 · **mupdf 1.28.0 (new)** · Commander · Vitest · Biome · npm

**Spec:** [docs/superpowers/specs/2026-08-20-forge-phase-4a-pdf-pixels-design.md](../specs/2026-08-20-forge-phase-4a-pdf-pixels-design.md)

## Global Constraints

- **Work on `dev`.** Never commit to `main`.
- `core/` and `engines/` import no React, no Ink, no Chalk, and never write to stdout.
- **No hardcoded format list.** A PDF gains JPEG and PNG targets because an engine declares them — no menu is edited anywhere.
- Sources are probed by content, never by extension.
- **Writes are atomic** — temp file, then rename. A multi-output job is all-or-nothing: a 248-page rasterisation failing at page 200 leaves nothing behind.
- **Progress is never fabricated.** The bar is determinate only because the page total is known before the first page renders. An operation whose length is unknown reports phases only.
- **A password never surfaces** — not in a logged `Job`, an error's `detail` or `hint`, a `Result`, or `--debug` output. New for this phase, with its own test.
- Page numbers are 1-based to the user, 0-based in code. `--pages` shares `parseRanges` with `--extract`; it is not a second grammar.
- `--dpi` accepts any integer 36–600, default 150.
- Symbols are paired with words so meaning survives a monochrome terminal.
- Run `npm run lint && npm run typecheck && npm test` before every commit. Stage explicitly with `git add <paths>`, never `git add -A`.

### Hard-won lessons from phase 3 — these are requirements, not advice

1. **Insist on a genuine RED.** Six tests in this repo were caught passing for the wrong reason. Say in each report what the failing output looked like.
2. **Never let two code paths derive the same thing independently.** Phase 3's worst defect was extract naming files from one ordering while the engine wrote from another. If two places need the same value, they call the same function.
3. **A predicate used in two places is one exported constant**, not two expressions that agree today. `HUB_ACTIONS` is the pattern to copy.
4. **Fixtures must identify themselves.** `makeMarkedPdf(dir, name, marks)` gives page *n* width `600 + marks[n]`; `pdfPageMarks(path)` reads them back. A test asserting "a file appeared" proves nothing.

---

## File Structure

**Created:**

| File | Responsibility |
| --- | --- |
| `src/engines/mupdf.ts` | mupdf: rasterise pages, decrypt documents. |
| `src/core/actions/unlock.ts` | Unlock action: applies to encrypted documents, plans the job. |
| `src/cli/stdin.ts` | Read a password from stdin or a TTY prompt. Nothing else. |
| `src/shell/components/Progress.tsx` | The determinate bar plus its counter line. |

**Modified:**

| File | Change |
| --- | --- |
| `src/engines/registry.ts` | `engineForJob` matches source + target for conversions; register `mupdfEngine`. |
| `src/engines/pdf.ts` | Reads image formats; handles `convert` when the target is `pdf`. |
| `src/core/types.ts` | `Job` gains `unlock`; `ConvertOptions` gains `dpi` and `pages`. |
| `src/core/actions/convert.ts` | Page and resolution option specs when the source is a document. |
| `src/core/actions/index.ts` | Register `unlockAction`. |
| `src/core/errors.ts` | `wrongPassword`, `invalidDpi`. |
| `src/cli/args.ts` | `--pages`, `--dpi`, `--unlock`, `--password-stdin`. |
| `src/cli/execute.ts` | Pass `onEvent` to `runJobs`; per-page CLI output. |
| `src/shell/App.tsx` | Pass `onEvent`; render `Progress`; encrypted-file hint names the CLI. |
| `tests/helpers/fixtures.ts` | `makeEncryptedPdf`. |

**Parallelisable.** Tasks 1, 2, 4 and 5 touch disjoint files and can run concurrently in separate worktrees. Everything after depends on them. One agent per checkout — phase 3 lost a reviewed commit to two agents sharing one.

---

## Task 1: Route conversions on source and target

**Files:**
- Modify: `src/engines/registry.ts`
- Test: `tests/engines/routing.test.ts`

**Interfaces:**
- Produces: `engineForJob(job: Job): Engine | undefined` — unchanged signature, corrected behaviour.

**Why this is first:** it is a silent-failure fix. Without it, a PDF→JPEG job reaches the Sharp engine, which cannot read a PDF, and fails with a confusing error rather than an obvious one.

- [ ] **Step 1: Write the failing test**

Create `tests/engines/routing.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { engineForJob } from '../../src/engines/registry.js'
import type { DocumentInfo, ImageInfo, Job } from '../../src/core/types.js'

const doc: DocumentInfo = {
  kind: 'document', path: '/tmp/a.pdf', format: 'pdf',
  bytes: 1, pages: 3, encrypted: false,
}
const png: ImageInfo = {
  kind: 'image', path: '/tmp/a.png', format: 'png',
  bytes: 1, width: 1, height: 1, hasAlpha: false, frames: 1,
}
const options = { background: '#ffffff', keepMetadata: false }

describe('engineForJob routes a conversion by both ends', () => {
  it('sends an image to the image engine', () => {
    const job: Job = {
      op: 'convert', sources: [png], outputs: ['/tmp/a.jpg'], target: 'jpeg', options,
    }
    expect(engineForJob(job)?.id).toBe('image')
  })

  it('sends a document to the engine that can read one', () => {
    const job: Job = {
      op: 'convert', sources: [doc], outputs: ['/tmp/a.jpg'], target: 'jpeg', options,
    }
    // The image engine also writes jpeg. Matching on target alone picks it,
    // and it cannot read a PDF — this is the regression under test.
    expect(engineForJob(job)?.id).not.toBe('image')
  })

  it('finds no engine for a pairing nothing supports', () => {
    const job: Job = {
      op: 'convert', sources: [doc], outputs: ['/tmp/a.gif'], target: 'gif', options,
    }
    expect(engineForJob(job)).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/engines/routing.test.ts`
Expected: the second test FAILS — `engineForJob` returns the image engine, because it matches on `writes.has('jpeg')` alone.

- [ ] **Step 3: Fix the routing**

In `src/engines/registry.ts`, replace the convert branch:

```ts
/**
 * The engine that runs a job.
 *
 * A conversion matches on **both ends**. Matching on the target alone was
 * correct while exactly one engine wrote each format; the moment a second
 * PDF-capable engine writes JPEG, `writes.has('jpeg')` stops identifying
 * anything — the image engine would win a PDF→JPEG job and then fail on a
 * source it cannot read. Every other operation still routes by `ops`,
 * because a page operation has no target format.
 */
export function engineForJob(job: Job): Engine | undefined {
  if (job.op === 'convert') {
    const from = job.sources[0].format
    return ENGINES.find((e) => e.reads.has(from) && e.writes.has(job.target))
  }
  return ENGINES.find((e) => e.ops.has(job.op))
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/engines/routing.test.ts`
Expected: PASS — 3 tests. The second passes trivially for now (no engine reads pdf *and* writes jpeg, so it returns `undefined`, which is `not.toBe('image')`). Task 3 makes it meaningful; leave the assertion as-is so it keeps holding.

- [ ] **Step 5: Run the full suite**

Run: `npm run lint && npm run typecheck && npm test`
Expected: PASS. Existing conversions are unaffected — every current engine that writes a format also reads the sources it is given.

- [ ] **Step 6: Commit**

```bash
git add src/engines/registry.ts tests/engines/routing.test.ts
git commit -m "fix(engines): route a conversion on its source as well as its target"
```

---

## Task 2: The mupdf engine skeleton

**Files:**
- Create: `src/engines/mupdf.ts`
- Modify: `src/engines/registry.ts`, `package.json`
- Test: `tests/engines/mupdf-registration.test.ts`

**Interfaces:**
- Produces: `mupdfEngine: Engine` with `reads: {pdf}`, `writes: {jpeg, png}`, `ops: {convert, unlock}`; `openPdf(path: string, password?: string): Promise<mupdf.PDFDocument>` at module scope for tasks 3 and 6.

- [ ] **Step 1: Install mupdf**

```bash
npm install mupdf@1.28.0
```

- [ ] **Step 2: Write the failing test**

Create `tests/engines/mupdf-registration.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { ENGINES } from '../../src/engines/registry.js'
import { targetIdsFor } from '../../src/core/capabilities.js'
import type { DocumentInfo } from '../../src/core/types.js'

const doc: DocumentInfo = {
  kind: 'document', path: '/tmp/a.pdf', format: 'pdf',
  bytes: 1, pages: 3, encrypted: false,
}

describe('the mupdf engine', () => {
  it('is registered', () => {
    expect(ENGINES.map((e) => e.id)).toContain('mupdf')
  })

  it('declares what it reads and writes', () => {
    const engine = ENGINES.find((e) => e.id === 'mupdf')
    expect(engine?.reads.has('pdf')).toBe(true)
    expect(engine?.writes.has('jpeg')).toBe(true)
    expect(engine?.writes.has('png')).toBe(true)
  })

  it('makes a PDF convertible to images without any menu being edited', () => {
    // targetIdsFor unions across engines filtered by `reads`. Nothing in
    // capabilities.ts changes for this to work — that is invariant 2.
    const targets = targetIdsFor(doc)
    expect(targets).toContain('jpeg')
    expect(targets).toContain('png')
  })
})
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run tests/engines/mupdf-registration.test.ts`
Expected: FAIL — no engine with id `mupdf`.

- [ ] **Step 4: Write the engine skeleton**

Create `src/engines/mupdf.ts`:

```ts
import { readFile } from 'node:fs/promises'
import * as mupdf from 'mupdf'
import type { FormatId, Job, Progress, Result, SourceInfo } from '../core/types.js'
import type { Engine } from './types.js'

const READS: ReadonlySet<FormatId> = new Set<FormatId>(['pdf'])
const WRITES: ReadonlySet<FormatId> = new Set<FormatId>(['jpeg', 'png'])
const OPS: ReadonlySet<Job['op']> = new Set<Job['op']>(['convert', 'unlock'])

/**
 * Open a document for rendering.
 *
 * Shared by rasterisation and unlock so both reach mupdf the same way. A
 * password is supplied only by unlock; rendering an encrypted document is
 * refused before it gets here, by the action layer.
 */
export async function openPdf(path: string, password?: string) {
  const doc = mupdf.Document.openDocument(await readFile(path), 'application/pdf')
  if (password !== undefined && doc.needsPassword()) {
    doc.authenticatePassword(password)
  }
  return doc
}

export const mupdfEngine: Engine = {
  id: 'mupdf',
  reads: READS,
  writes: WRITES,
  ops: OPS,
  // Probing is handled by `engines/pdf.ts`, which is registered first and
  // already recognises a PDF by content. The registry takes the first engine
  // whose probe succeeds, so a second PDF prober would never run.
  probe(): Promise<SourceInfo> {
    throw new Error('the mupdf engine does not probe; engines/pdf.ts does')
  },
  async run(_job: Job, _onPhase: (p: Progress) => void): Promise<Result> {
    throw new Error('not implemented until task 3')
  },
}
```

- [ ] **Step 5: Register it**

In `src/engines/registry.ts`:

```ts
import { mupdfEngine } from './mupdf.js'

export const ENGINES: Engine[] = [imageEngine, pdfEngine, mupdfEngine]
```

Order matters: `imageEngine` declines a PDF quickly, `pdfEngine` probes it successfully, and `mupdfEngine` never probes. Keep it last.

- [ ] **Step 6: Run the test to verify it passes**

Run: `npx vitest run tests/engines/mupdf-registration.test.ts`
Expected: PASS — 3 tests.

- [ ] **Step 7: Run the full suite**

Run: `npm run lint && npm run typecheck && npm test`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json src/engines/mupdf.ts src/engines/registry.ts tests/engines/mupdf-registration.test.ts
git commit -m "feat(engines): register the mupdf engine"
```

---

## Task 3: Rasterise PDF pages to images

**Files:**
- Modify: `src/engines/mupdf.ts`, `src/core/types.ts`, `src/core/errors.ts`
- Test: `tests/engines/mupdf-render.test.ts`

**Interfaces:**
- Consumes: `openPdf` (Task 2), `writeAtomic` pattern from `engines/pdf.ts`
- Produces: `mupdfEngine.run` handling `op: 'convert'`; `ConvertOptions` gains `dpi?: number` and `pages?: number[]`; `invalidDpi(value: unknown): ForgeError`

**Note on ordering:** `pages` is a 0-based, ascending, deduped list. The engine writes `outputs[i]` from `pages[i]`. **It must not sort or dedupe internally** — phase 3's worst defect was the engine sorting while the naming did not. Whatever hands it a job is responsible for normalising, and `core/pages.ts`'s `normalisePages` is that function.

- [ ] **Step 1: Write the failing test**

Create `tests/engines/mupdf-render.test.ts`:

```ts
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { mupdfEngine } from '../../src/engines/mupdf.js'
import { probe } from '../../src/engines/registry.js'
import type { DocumentInfo, Job, Progress } from '../../src/core/types.js'
import { makeMarkedPdf, makeTempDir } from '../helpers/fixtures.js'

async function doc(path: string): Promise<DocumentInfo> {
  const info = await probe(path)
  if (info.kind !== 'document') throw new Error('expected a document')
  return info
}

const options = { background: '#ffffff', keepMetadata: false }

describe('rasterising', () => {
  it('renders the pages it was given, in the order it was given them', async () => {
    const dir = await makeTempDir()
    // page n is 600 + n points wide, so an image's aspect ratio identifies
    // which page it came from — not merely that a file appeared.
    const src = await makeMarkedPdf(dir, 'doc.pdf', [1, 2, 3, 4, 5])
    const outputs = [join(dir, 'a.jpg'), join(dir, 'b.jpg')]
    const job: Job = {
      op: 'convert', sources: [await doc(src)], outputs, target: 'jpeg',
      options: { ...options, dpi: 72, pages: [1, 3] },
    }

    await mupdfEngine.run(job, () => {})

    // page index 1 is 602pt wide, index 3 is 604pt — at 72dpi, 1pt = 1px
    const a = await sharp(await readFile(outputs[0] as string)).metadata()
    const b = await sharp(await readFile(outputs[1] as string)).metadata()
    expect(a.width).toBe(602)
    expect(b.width).toBe(604)
  })

  it('scales with the requested resolution', async () => {
    const dir = await makeTempDir()
    const src = await makeMarkedPdf(dir, 'doc.pdf', [0])
    const out = join(dir, 'a.jpg')
    await mupdfEngine.run(
      {
        op: 'convert', sources: [await doc(src)], outputs: [out], target: 'jpeg',
        options: { ...options, dpi: 144, pages: [0] },
      },
      () => {},
    )
    // 600pt at 144dpi = 1200px
    expect((await sharp(await readFile(out)).metadata()).width).toBe(1200)
  })

  it('honours a page rotation rather than ignoring it', async () => {
    const dir = await makeTempDir()
    const src = await makeMarkedPdf(dir, 'doc.pdf', [0], { rotate: 90 })
    const out = join(dir, 'a.jpg')
    await mupdfEngine.run(
      {
        op: 'convert', sources: [await doc(src)], outputs: [out], target: 'jpeg',
        options: { ...options, dpi: 72, pages: [0] },
      },
      () => {},
    )
    const meta = await sharp(await readFile(out)).metadata()
    // 600x842 rotated 90 renders 842x600
    expect(meta.width).toBe(842)
    expect(meta.height).toBe(600)
  })

  it('writes PNG when asked', async () => {
    const dir = await makeTempDir()
    const src = await makeMarkedPdf(dir, 'doc.pdf', [0])
    const out = join(dir, 'a.png')
    await mupdfEngine.run(
      {
        op: 'convert', sources: [await doc(src)], outputs: [out], target: 'png',
        options: { ...options, dpi: 72, pages: [0] },
      },
      () => {},
    )
    expect((await sharp(await readFile(out)).metadata()).format).toBe('png')
  })

  it('reports one page event per page, counting to the real total', async () => {
    const dir = await makeTempDir()
    const src = await makeMarkedPdf(dir, 'doc.pdf', [0, 1, 2])
    const outputs = [join(dir, 'a.jpg'), join(dir, 'b.jpg'), join(dir, 'c.jpg')]
    const seen: Progress[] = []
    await mupdfEngine.run(
      {
        op: 'convert', sources: [await doc(src)], outputs, target: 'jpeg',
        options: { ...options, dpi: 72, pages: [0, 1, 2] },
      },
      (p) => seen.push(p),
    )
    const pages = seen.filter((p) => p.phase === 'page')
    expect(pages).toEqual([
      { phase: 'page', done: 1, total: 3 },
      { phase: 'page', done: 2, total: 3 },
      { phase: 'page', done: 3, total: 3 },
    ])
  })

  it('leaves nothing behind when one output cannot be written', async () => {
    const { readdir, mkdir } = await import('node:fs/promises')
    const dir = await makeTempDir()
    const src = await makeMarkedPdf(dir, 'doc.pdf', [0, 1])
    const blocked = join(dir, 'blocked')
    await mkdir(blocked)
    const outputs = [join(dir, 'a.jpg'), blocked]
    await expect(
      mupdfEngine.run(
        {
          op: 'convert', sources: [await doc(src)], outputs, target: 'jpeg',
          options: { ...options, dpi: 72, pages: [0, 1] },
        },
        () => {},
      ),
    ).rejects.toThrow()
    expect((await readdir(dir)).sort()).toEqual(['blocked', 'doc.pdf'])
  })
})
```

- [ ] **Step 2: Extend the fixture helper**

`makeMarkedPdf` needs an optional rotation. In `tests/helpers/fixtures.ts`, change its signature and body:

```ts
export async function makeMarkedPdf(
  dir: string,
  name: string,
  marks: number[],
  opts: { rotate?: 90 | 180 | 270 } = {},
): Promise<string> {
  const doc = await PDFDocument.create()
  for (const mark of marks) {
    const page = doc.addPage([MARK_BASE + mark, 842])
    if (opts.rotate) page.setRotation(degrees(opts.rotate))
  }
  const path = join(dir, name)
  await writeFile(path, await doc.save())
  return path
}
```

Add `degrees` to the existing `pdf-lib` import. Every current caller passes three arguments and is unaffected.

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run tests/engines/mupdf-render.test.ts`
Expected: FAIL — `not implemented until task 3`.

- [ ] **Step 4: Extend the types**

In `src/core/types.ts`, add to `ConvertOptions`:

```ts
export interface ConvertOptions {
  /** 1-100. Ignored for lossless targets. */
  quality?: number
  /** CSS colour used when flattening alpha into a format that cannot carry it. */
  background: string
  keepMetadata: boolean
  /** Rasterisation resolution, 36-600. Only meaningful for a document source. */
  dpi?: number
  /**
   * 0-based page indices to render, ascending and deduped. Only meaningful
   * for a document source. The engine writes `outputs[i]` from `pages[i]` and
   * does NOT reorder — whoever builds the job owns the ordering, so naming
   * and writing can never disagree.
   */
  pages?: number[]
}
```

- [ ] **Step 5: Add the error factory**

In `src/core/errors.ts`, add `'invalid-dpi'` to `ErrorCode`, then:

```ts
export function invalidDpi(value: unknown): ForgeError {
  return new ForgeError({
    code: 'invalid-dpi',
    title: 'Resolution out of range',
    detail: `${String(value)} is not a resolution between 36 and 600.`,
    hint: 'Try 150 for reading, or 300 for print.',
  })
}
```

- [ ] **Step 6: Implement rasterisation**

In `src/engines/mupdf.ts`:

```ts
import { randomBytes } from 'node:crypto'
import { rename, rm, writeFile } from 'node:fs/promises'

/** Invariant 6: temp file, then rename. Never a partial file at the real path. */
async function writeAtomic(path: string, bytes: Uint8Array): Promise<number> {
  const temp = `${path}.${randomBytes(6).toString('hex')}.tmp`
  try {
    await writeFile(temp, bytes)
    await rename(temp, path)
    return bytes.byteLength
  } catch (e) {
    await rm(temp, { force: true }).catch(() => {})
    throw e
  }
}

async function rasterise(
  job: Extract<Job, { op: 'convert' }>,
  onPhase: (p: Progress) => void,
) {
  const source = job.sources[0]
  const dpi = job.options.dpi ?? 150
  const pages = job.options.pages ?? []
  const scale = dpi / 72

  onPhase({ phase: 'reading' })
  const doc = await openPdf(source.path)

  const written: string[] = []
  let outputBytes = 0
  try {
    for (const [i, pageIndex] of pages.entries()) {
      const pixmap = doc
        .loadPage(pageIndex)
        .toPixmap(mupdf.Matrix.scale(scale, scale), mupdf.ColorSpace.DeviceRGB, false, true)
      const bytes =
        job.target === 'png'
          ? pixmap.asPNG()
          : pixmap.asJPEG(job.options.quality ?? 82, false)

      const path = job.outputs[i]
      if (path === undefined) {
        throw new Error(`rendering ${pages.length} pages into ${job.outputs.length} outputs`)
      }
      outputBytes += await writeAtomic(path, bytes)
      written.push(path)
      onPhase({ phase: 'page', done: i + 1, total: pages.length })
    }
  } catch (e) {
    // All-or-nothing: remove outputs already renamed, not just the failing temp.
    await Promise.all(written.map((p) => rm(p, { force: true }).catch(() => {})))
    throw e
  }

  return { job, outputBytes, warnings: [] }
}
```

Replace the stub `run` with a dispatcher:

```ts
  async run(job: Job, onPhase: (p: Progress) => void): Promise<Result> {
    switch (job.op) {
      case 'convert':
        return rasterise(job, onPhase)
      default:
        throw new Error(`mupdf engine cannot ${job.op}`)
    }
  },
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `npx vitest run tests/engines/mupdf-render.test.ts`
Expected: PASS — 6 tests.

- [ ] **Step 8: Prove the tests are load-bearing**

Sabotage each, confirm the named test fails, then revert:

- Replace `pages.entries()` with a reversed iteration → the ordering test fails.
- Drop the `rm` in the catch → the all-or-nothing test fails.
- Hardcode `scale = 1` → the resolution test fails.

Record what you saw in your report.

- [ ] **Step 9: Run the full suite and commit**

```bash
npm run lint && npm run typecheck && npm test
git add src/engines/mupdf.ts src/core/types.ts src/core/errors.ts tests/engines/mupdf-render.test.ts tests/helpers/fixtures.ts
git commit -m "feat(engines): rasterise PDF pages through mupdf"
```

---

## Task 4: Embed images into a PDF

**Files:**
- Modify: `src/engines/pdf.ts`
- Test: `tests/engines/pdf-embed.test.ts`

**Interfaces:**
- Produces: `pdfEngine` gains `reads: {pdf, jpeg, png, webp, avif, gif, tiff}` and handles `op: 'convert'` when `target === 'pdf'`

**Note:** pdf-lib embeds only JPEG and PNG. WebP, AVIF, GIF and TIFF are decoded to PNG through Sharp first — the same two-step `heic.ts` already uses, for the same reason.

- [ ] **Step 1: Write the failing test**

Create `tests/engines/pdf-embed.test.ts`:

```ts
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { PDFDocument } from 'pdf-lib'
import { describe, expect, it } from 'vitest'
import { pdfEngine } from '../../src/engines/pdf.js'
import { probe } from '../../src/engines/registry.js'
import type { ImageInfo, Job } from '../../src/core/types.js'
import { makeJpeg, makePng, makeTempDir, makeAvif } from '../helpers/fixtures.js'

async function image(path: string): Promise<ImageInfo> {
  const info = await probe(path)
  if (info.kind !== 'image') throw new Error('expected an image')
  return info
}

const options = { background: '#ffffff', keepMetadata: false }

describe('images to PDF', () => {
  it('makes a one-page PDF sized to the image', async () => {
    const dir = await makeTempDir()
    const src = await makeJpeg(dir, 'a.jpg')
    const out = join(dir, 'a.pdf')
    const info = await image(src)
    const job: Job = {
      op: 'convert', sources: [info], outputs: [out], target: 'pdf', options,
    }

    await pdfEngine.run(job, () => {})

    const doc = await PDFDocument.load(await readFile(out))
    expect(doc.getPageCount()).toBe(1)
    const { width, height } = doc.getPage(0).getSize()
    expect(Math.round(width)).toBe(info.width)
    expect(Math.round(height)).toBe(info.height)
  })

  it('embeds a PNG', async () => {
    const dir = await makeTempDir()
    const src = await makePng(dir, 'a.png')
    const out = join(dir, 'a.pdf')
    await pdfEngine.run(
      { op: 'convert', sources: [await image(src)], outputs: [out], target: 'pdf', options },
      () => {},
    )
    expect((await PDFDocument.load(await readFile(out))).getPageCount()).toBe(1)
  })

  it('decodes a format pdf-lib cannot embed directly', async () => {
    const dir = await makeTempDir()
    const src = await makeAvif(dir, 'a.avif')
    const out = join(dir, 'a.pdf')
    await pdfEngine.run(
      { op: 'convert', sources: [await image(src)], outputs: [out], target: 'pdf', options },
      () => {},
    )
    expect((await PDFDocument.load(await readFile(out))).getPageCount()).toBe(1)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/engines/pdf-embed.test.ts`
Expected: FAIL — `pdf engine cannot convert`.

- [ ] **Step 3: Implement embedding**

In `src/engines/pdf.ts`, widen `READS` and add the handler:

```ts
const READS: ReadonlySet<FormatId> = new Set<FormatId>([
  'pdf', 'jpeg', 'png', 'webp', 'avif', 'gif', 'tiff',
])
```

Add `'convert'` to `OPS`, then:

```ts
import sharp from 'sharp'

/**
 * pdf-lib embeds JPEG and PNG and nothing else. Anything else is decoded to
 * PNG first, the same two-step `heic.ts` uses — one extra decode, no new
 * dependency, and the alternative is refusing formats the capability graph
 * has already offered.
 */
async function embedBytes(doc: PDFDocument, source: SourceInfo, raw: Buffer) {
  if (source.format === 'jpeg') return doc.embedJpg(raw)
  if (source.format === 'png') return doc.embedPng(raw)
  return doc.embedPng(await sharp(raw).png().toBuffer())
}

async function imageToPdf(
  job: Extract<Job, { op: 'convert' }>,
  onPhase: (p: Progress) => void,
) {
  const source = job.sources[0]
  onPhase({ phase: 'reading' })
  const raw = await readFile(source.path)

  onPhase({ phase: 'encoding' })
  const doc = await PDFDocument.create()
  const embedded = await embedBytes(doc, source, raw)
  const page = doc.addPage([embedded.width, embedded.height])
  page.drawImage(embedded, { x: 0, y: 0, width: embedded.width, height: embedded.height })

  onPhase({ phase: 'writing' })
  const outputBytes = await writeAtomic(job.outputs[0], await doc.save())
  return { job, outputBytes, warnings: [] }
}
```

Add to the dispatcher:

```ts
      case 'convert':
        if (job.target !== 'pdf') throw new Error('the pdf engine only converts to pdf')
        return imageToPdf(job, onPhase)
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/engines/pdf-embed.test.ts`
Expected: PASS — 3 tests.

- [ ] **Step 5: Run the full suite and commit**

```bash
npm run lint && npm run typecheck && npm test
git add src/engines/pdf.ts tests/engines/pdf-embed.test.ts
git commit -m "feat(engines): embed images into a PDF"
```

---

## Task 5: The progress bar

**Files:**
- Create: `src/shell/components/Progress.tsx`
- Test: `tests/shell/progress.test.tsx`

**Interfaces:**
- Produces: `<Progress label={string} done={number} total={number} detail={string | undefined} width={number} />`

**Note:** this task builds the component only. Task 8 wires it to real events.

- [ ] **Step 1: Write the failing test**

Create `tests/shell/progress.test.tsx`:

```tsx
import { render } from 'ink-testing-library'
import { createElement } from 'react'
import stringWidth from 'string-width'
import { describe, expect, it } from 'vitest'
import { Progress } from '../../src/shell/components/Progress.js'

const frame = (props: Record<string, unknown>) => {
  const { lastFrame } = render(
    createElement(Progress, { label: 'RENDERING', width: 60, ...props } as never),
  )
  return lastFrame() ?? ''
}

describe('Progress', () => {
  it('states a real position, not a percentage of nothing', () => {
    expect(frame({ done: 112, total: 248 })).toContain('page 112 of 248')
  })

  it('fills in proportion to the work done', () => {
    const early = frame({ done: 1, total: 100 })
    const late = frame({ done: 99, total: 100 })
    const knobAt = (s: string) => s.indexOf('●')
    expect(knobAt(early)).toBeLessThan(knobAt(late))
  })

  it('shows the current item when given one', () => {
    expect(frame({ done: 3, total: 9, detail: 'report-003.jpg' })).toContain('report-003.jpg')
  })

  it('renders every line within the given width', () => {
    const lines = frame({ done: 5, total: 9, detail: 'x'.repeat(200) }).split('\n')
    for (const line of lines) expect(stringWidth(line)).toBeLessThanOrEqual(60)
  })

  it('reads without colour', () => {
    // The count carries the meaning; the bar is decoration. Strip ANSI and
    // the frame must still say where it is.
    const plain = frame({ done: 2, total: 4 }).replace(/\[[0-9;]*m/g, '')
    expect(plain).toContain('page 2 of 4')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/shell/progress.test.tsx`
Expected: FAIL — cannot resolve `Progress.js`.

- [ ] **Step 3: Write the component**

Create `src/shell/components/Progress.tsx`, following `Slider.tsx`'s bar construction and `FileCard.tsx`'s truncation:

```tsx
import { Box, Text } from 'ink'
import { useTheme } from '../ThemeContext.js'
import { BAR, colourProp } from '../theme.js'
import { middleEllipsis } from '../width.js'

interface ProgressProps {
  label: string
  done: number
  total: number
  detail?: string
  width: number
}

/**
 * A determinate bar.
 *
 * Determinate is honest here and nowhere else so far: the page total is known
 * before the first page renders. Invariant 7 forbids inventing progress, not
 * showing it — an operation whose length is unknown must report phases only
 * and must not mount this component.
 *
 * The count carries the meaning and the bar is the accent, so the frame still
 * reads in a monochrome terminal.
 */
export function Progress({ label, done, total, detail, width }: ProgressProps) {
  const palette = useTheme()
  const counter = `page ${done} of ${total}`
  const track = Math.max(4, Math.min(24, width - counter.length - 6))
  const filled = total === 0 ? 0 : Math.round((done / total) * (track - 1))

  return (
    <Box flexDirection="column">
      <Text color={colourProp(palette.label)}>{label}</Text>
      <Text>
        <Text color={colourProp(palette.border)}>{'├'}</Text>
        <Text color={colourProp(palette.accent)}>{BAR.filled.repeat(filled)}</Text>
        <Text color={colourProp(palette.accent)}>{BAR.knob}</Text>
        <Text color={colourProp(palette.border)}>
          {BAR.empty.repeat(Math.max(0, track - 1 - filled))}
          {'┤'}
        </Text>
        <Text color={colourProp(palette.dim)}>{`  ${counter}`}</Text>
      </Text>
      {detail ? (
        <Text color={colourProp(palette.dim)}>{middleEllipsis(detail, width - 2)}</Text>
      ) : null}
    </Box>
  )
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/shell/progress.test.tsx`
Expected: PASS — 5 tests.

- [ ] **Step 5: Run the full suite and commit**

```bash
npm run lint && npm run typecheck && npm test
git add src/shell/components/Progress.tsx tests/shell/progress.test.tsx
git commit -m "feat(shell): a determinate progress bar"
```

---

## Task 6: Unlock — engine and action

**Files:**
- Modify: `src/engines/mupdf.ts`, `src/core/types.ts`, `src/core/errors.ts`, `src/core/actions/index.ts`
- Create: `src/core/actions/unlock.ts`
- Test: `tests/engines/mupdf-unlock.test.ts`, `tests/helpers/fixtures.ts`

**Interfaces:**
- Consumes: `openPdf`, `writeAtomic` (Tasks 2, 3)
- Produces: `Job` gains `{ op: 'unlock'; sources: [DocumentInfo]; outputs: [string]; password: string }`; `unlockAction: Action`; `wrongPassword(path: string): ForgeError`; `makeEncryptedPdf(dir, name, password, pages?): Promise<string>`

- [ ] **Step 1: Write the failing test**

Create `tests/engines/mupdf-unlock.test.ts`:

```ts
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { mupdfEngine } from '../../src/engines/mupdf.js'
import { probe } from '../../src/engines/registry.js'
import type { DocumentInfo, Job } from '../../src/core/types.js'
import { makeEncryptedPdf, makeTempDir } from '../helpers/fixtures.js'

async function doc(path: string): Promise<DocumentInfo> {
  const info = await probe(path)
  if (info.kind !== 'document') throw new Error('expected a document')
  return info
}

describe('unlock', () => {
  it('probes an encrypted document as encrypted', async () => {
    const dir = await makeTempDir()
    const src = await makeEncryptedPdf(dir, 'locked.pdf', 'hunter2', 3)
    expect((await doc(src)).encrypted).toBe(true)
  })

  it('writes a copy that is no longer encrypted', async () => {
    const dir = await makeTempDir()
    const src = await makeEncryptedPdf(dir, 'locked.pdf', 'hunter2', 3)
    const out = join(dir, 'open.pdf')
    const job: Job = {
      op: 'unlock', sources: [await doc(src)], outputs: [out], password: 'hunter2',
    }

    await mupdfEngine.run(job, () => {})

    const after = await doc(out)
    expect(after.encrypted).toBe(false)
    expect(after.pages).toBe(3)
  })

  it('refuses a wrong password with a specific error', async () => {
    const dir = await makeTempDir()
    const src = await makeEncryptedPdf(dir, 'locked.pdf', 'hunter2', 1)
    const job: Job = {
      op: 'unlock', sources: [await doc(src)], outputs: [join(dir, 'o.pdf')], password: 'wrong',
    }
    await expect(mupdfEngine.run(job, () => {})).rejects.toThrow(/password/i)
  })

  it('never puts the password in the error', async () => {
    const dir = await makeTempDir()
    const src = await makeEncryptedPdf(dir, 'locked.pdf', 'hunter2', 1)
    const secret = 'correct-horse-battery-staple'
    let caught: unknown
    try {
      await mupdfEngine.run(
        { op: 'unlock', sources: [await doc(src)], outputs: [join(dir, 'o.pdf')], password: secret },
        () => {},
      )
    } catch (e) {
      caught = e
    }
    const text = JSON.stringify(caught, Object.getOwnPropertyNames(Object(caught)))
    expect(text).not.toContain(secret)
  })
})
```

- [ ] **Step 2: Add the fixture**

Append to `tests/helpers/fixtures.ts`:

```ts
/** A document that genuinely requires a password to read. */
export async function makeEncryptedPdf(
  dir: string,
  name: string,
  password: string,
  pages = 1,
): Promise<string> {
  const mupdf = await import('mupdf')
  const plain = await PDFDocument.create()
  for (let i = 0; i < pages; i++) plain.addPage([595, 842])
  const doc = mupdf.Document.openDocument(
    Buffer.from(await plain.save()),
    'application/pdf',
  ).asPDF()
  const bytes = doc
    .saveToBuffer(`encrypt=aes-256,user-password=${password},owner-password=${password}`)
    .asUint8Array()
  const path = join(dir, name)
  await writeFile(path, bytes)
  return path
}
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run tests/engines/mupdf-unlock.test.ts`
Expected: FAIL — `mupdf engine cannot unlock`.

- [ ] **Step 4: Add the Job member and error**

In `src/core/types.ts`, add to the `Job` union:

```ts
  | {
      op: 'unlock'
      sources: [DocumentInfo]
      outputs: [string]
      /**
       * Never log, render, or include this in an error, a Result, or debug
       * output. Invariant 8.
       */
      password: string
    }
```

In `src/core/errors.ts`, add `'wrong-password'` to `ErrorCode` and:

```ts
export function wrongPassword(path: string): ForgeError {
  return new ForgeError({
    code: 'wrong-password',
    title: 'Password not accepted',
    detail: `${basename(path)} did not open with that password.`,
    hint: 'Check the password and try again.',
  })
}
```

Note what this does **not** interpolate.

- [ ] **Step 5: Implement unlock**

In `src/engines/mupdf.ts`:

```ts
import { wrongPassword } from '../core/errors.js'

async function unlock(job: Extract<Job, { op: 'unlock' }>, onPhase: (p: Progress) => void) {
  const source = job.sources[0]
  onPhase({ phase: 'reading' })

  const doc = mupdf.Document.openDocument(await readFile(source.path), 'application/pdf')
  if (doc.needsPassword() && doc.authenticatePassword(job.password) === 0) {
    throw wrongPassword(source.path)
  }

  onPhase({ phase: 'writing' })
  const bytes = doc.asPDF().saveToBuffer('').asUint8Array()
  const outputBytes = await writeAtomic(job.outputs[0], bytes)
  return { job, outputBytes, warnings: [] }
}
```

`authenticatePassword` returns a bitfield: 0 means neither the user nor the owner password matched. Add `case 'unlock': return unlock(job, onPhase)` to the dispatcher.

- [ ] **Step 6: Write the action**

Create `src/core/actions/unlock.ts`:

```ts
import { suffixedOutputPath } from '../output-path.js'
import type { DocumentInfo, Job, SourceInfo } from '../types.js'
import type { Action } from './index.js'

const encryptedDocuments = (sources: SourceInfo[]): DocumentInfo[] =>
  sources.filter((s): s is DocumentInfo => s.kind === 'document' && s.encrypted)

export const unlockAction: Action = {
  id: 'unlock',
  label: 'Unlock',
  hint: 'remove a known password',
  appliesTo: (sources) =>
    sources.length > 0 && encryptedDocuments(sources).length === sources.length,
  unavailable: () => 'encrypted PDFs only',
  options: () => [],
  plan(sources, values): Job[] {
    const password = typeof values.password === 'string' ? values.password : ''
    return encryptedDocuments(sources).map((doc) => ({
      op: 'unlock' as const,
      sources: [doc] as [DocumentInfo],
      outputs: [suffixedOutputPath(doc.path, 'unlocked')] as [string],
      password,
    }))
  },
}
```

Register it in `src/core/actions/index.ts`'s `ACTIONS` array.

**It does not appear in `/pdf`'s hub** — `HUB_ACTIONS` filters by id, so add `'unlock'` to the ids it excludes alongside `'convert'` and `'compress'`. Unlock is CLI-only by design (spec §8); the shell has no masked input.

- [ ] **Step 7: Run the test to verify it passes**

Run: `npx vitest run tests/engines/mupdf-unlock.test.ts`
Expected: PASS — 4 tests.

- [ ] **Step 8: Run the full suite and commit**

```bash
npm run lint && npm run typecheck && npm test
git add src/engines/mupdf.ts src/core/types.ts src/core/errors.ts src/core/actions/unlock.ts src/core/actions/index.ts src/shell/flows/pdf.tsx tests/engines/mupdf-unlock.test.ts tests/helpers/fixtures.ts
git commit -m "feat(engines): unlock an encrypted PDF"
```

---

## Task 7: CLI — page selection, resolution, unlock

**Files:**
- Create: `src/cli/stdin.ts`
- Modify: `src/cli/args.ts`, `src/cli/execute.ts`
- Test: `tests/cli/pixels-args.test.ts`

**Interfaces:**
- Consumes: `parseRanges`, `normalisePages` (`core/pages.ts`), `invalidDpi`, `unlockAction`
- Produces: `readPassword(opts: { stdin: boolean }): Promise<string>` in `src/cli/stdin.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/cli/pixels-args.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { parseArgs } from '../../src/cli/args.js'

const argv = (...a: string[]) => ['doc.pdf', ...a]

describe('rasterisation flags', () => {
  it('defaults dpi to 150', () => {
    expect(parseArgs(argv('--to', 'jpeg')).dpi).toBe(150)
  })

  it('accepts a resolution in range', () => {
    expect(parseArgs(argv('--to', 'jpeg', '--dpi', '300')).dpi).toBe(300)
    expect(parseArgs(argv('--to', 'jpeg', '--dpi', '36')).dpi).toBe(36)
    expect(parseArgs(argv('--to', 'jpeg', '--dpi', '600')).dpi).toBe(600)
  })

  it('rejects a resolution outside it, naming the bounds', () => {
    expect(() => parseArgs(argv('--to', 'jpeg', '--dpi', '35'))).toThrow(/36 and 600/)
    expect(() => parseArgs(argv('--to', 'jpeg', '--dpi', '601'))).toThrow(/36 and 600/)
    expect(() => parseArgs(argv('--to', 'jpeg', '--dpi', 'lots'))).toThrow(/36 and 600/)
  })

  it('carries a page range through unparsed, for the page count to validate', () => {
    expect(parseArgs(argv('--to', 'jpeg', '--pages', '3-7,12')).pages).toBe('3-7,12')
  })

  it('rejects --pages without a conversion', () => {
    expect(() => parseArgs(argv('--pages', '1-2'))).toThrow(/--to/)
  })
})

describe('unlock flags', () => {
  it('parses --unlock', () => {
    expect(parseArgs(argv('--unlock')).action).toBe('unlock')
  })

  it('parses --password-stdin', () => {
    expect(parseArgs(argv('--unlock', '--password-stdin')).passwordStdin).toBe(true)
  })

  it('has no --password flag at all', () => {
    // A password in argv lands in shell history and ps output. Spec §8.
    expect(() => parseArgs(argv('--unlock', '--password', 'hunter2'))).toThrow()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/cli/pixels-args.test.ts`
Expected: FAIL — `intent.dpi` is undefined.

- [ ] **Step 3: Add the flags**

In `src/cli/args.ts`, register:

```ts
  .option('--pages <ranges>', 'with --to, which pages to render, e.g. 3-7,12')
  .option('--dpi <n>', 'rasterisation resolution, 36-600', '150')
  .option('--unlock', 'remove a known password from a PDF')
  .option('--password-stdin', 'read the password from stdin instead of prompting')
```

Extend `Intent` with `dpi?: number`, `pages?: string`, `passwordStdin?: boolean`, and `'unlock'` in the `action` union. Validate:

```ts
const dpi = Number(opts.dpi)
if (!Number.isInteger(dpi) || dpi < 36 || dpi > 600) throw invalidDpi(opts.dpi)
intent.dpi = dpi

if (opts.pages !== undefined && opts.to === undefined) {
  throw invalidArguments('--pages needs --to: it chooses which pages to render.')
}
```

Commander rejects an unknown `--password` on its own; the third test asserts that rather than requiring code.

- [ ] **Step 4: Write the stdin reader**

Create `src/cli/stdin.ts`:

```ts
import { createInterface } from 'node:readline'

/**
 * A password, never from argv.
 *
 * An argument lands in shell history and in `ps` output, and PDF passwords
 * are reused often enough that leaking one leaks more than one file. Reading
 * stdin or prompting costs the same keystrokes and avoids both.
 */
export async function readPassword(opts: { stdin: boolean }): Promise<string> {
  if (opts.stdin) {
    const chunks: Buffer[] = []
    for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk))
    return Buffer.concat(chunks).toString('utf8').replace(/\r?\n$/, '')
  }

  const rl = createInterface({ input: process.stdin, output: process.stderr, terminal: true })
  try {
    // Prompt on stderr so a piped stdout stays clean.
    return await new Promise<string>((resolve) => rl.question('Password: ', resolve))
  } finally {
    rl.close()
  }
}
```

- [ ] **Step 5: Wire execution**

In `src/cli/execute.ts`, for `intent.action === 'unlock'`: read the password via `readPassword`, call `unlockAction.plan(sources, { password })`, run the jobs through `checkWriteSafety` and `runJobs` exactly as the other page operations do.

For a conversion whose source is a document: parse `intent.pages` with `parseRanges(text, source.pages)` — or all pages when absent — normalise it with `normalisePages`, and pass `{ dpi, pages }` in `ConvertOptions`. Build one output per page with `splitOutputPaths`-style zero-padding.

- [ ] **Step 6: Run the test, then verify by hand**

```bash
npx vitest run tests/cli/pixels-args.test.ts    # PASS, 8 tests
npm run build
cd /tmp && node -e "const {PDFDocument}=require('$PWD/node_modules/pdf-lib');(async()=>{const d=await PDFDocument.create();for(let i=0;i<4;i++)d.addPage([595,842]);require('fs').writeFileSync('t.pdf',await d.save())})()"
node <repo>/dist/index.js t.pdf --to jpeg --pages 2-3 --dpi 72 && ls t-*.jpg
```

Expected: `t-2.jpg` and `t-3.jpg` exist, each 595px wide.

- [ ] **Step 7: Run the full suite and commit**

```bash
npm run lint && npm run typecheck && npm test
git add src/cli/args.ts src/cli/execute.ts src/cli/stdin.ts tests/cli/pixels-args.test.ts
git commit -m "feat(cli): render pages to images, and unlock"
```

---

## Task 8: The shell — page and resolution steps, live progress

**Files:**
- Modify: `src/core/actions/convert.ts`, `src/shell/App.tsx`
- Test: `tests/shell/convert-pdf.test.tsx`

**Interfaces:**
- Consumes: `Progress` component (Task 5), `normalisePages`, `PageGrid`
- Produces: `convertAction.options` returning page and resolution specs for a document source

- [ ] **Step 1: Write the failing test**

Create `tests/shell/convert-pdf.test.tsx`:

```tsx
import { render } from 'ink-testing-library'
import { createElement } from 'react'
import { describe, expect, it } from 'vitest'
import { convertAction } from '../../src/core/actions/convert.js'
import { DEFAULT_PREFERENCES } from '../../src/config/preferences.js'
import type { DocumentInfo, ImageInfo } from '../../src/core/types.js'

const doc: DocumentInfo = {
  kind: 'document', path: '/tmp/a.pdf', format: 'pdf',
  bytes: 1, pages: 248, encrypted: false,
}
const img: ImageInfo = {
  kind: 'image', path: '/tmp/a.jpg', format: 'jpeg',
  bytes: 1, width: 10, height: 10, hasAlpha: false, frames: 1,
}

describe('converting a document', () => {
  it('asks which pages, naming the file count', () => {
    const specs = convertAction.options([doc], { target: 'jpeg' }, DEFAULT_PREFERENCES)
    const pages = specs.find((s) => s.id === 'pages')
    expect(pages?.kind).toBe('select')
    if (pages?.kind !== 'select') throw new Error('expected a select')
    expect(pages.choices[0]?.hint).toContain('248')
  })

  it('asks for a resolution, defaulting to 150', () => {
    const specs = convertAction.options([doc], { target: 'jpeg' }, DEFAULT_PREFERENCES)
    const dpi = specs.find((s) => s.id === 'dpi')
    if (dpi?.kind !== 'select') throw new Error('expected a select')
    expect(dpi.default).toBe('150')
  })

  it('asks neither of an image', () => {
    const specs = convertAction.options([img], { target: 'png' }, DEFAULT_PREFERENCES)
    expect(specs.find((s) => s.id === 'pages')).toBeUndefined()
    expect(specs.find((s) => s.id === 'dpi')).toBeUndefined()
  })

  it('plans one output per selected page, zero-padded', () => {
    const [job] = convertAction.plan([{ ...doc, pages: 12 }], {
      target: 'jpeg', pages: 'all', dpi: '150', destination: '/out',
    })
    expect(job?.outputs).toHaveLength(12)
    expect(job?.outputs[0]).toContain('-01.jpg')
    expect(job?.outputs[11]).toContain('-12.jpg')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/shell/convert-pdf.test.tsx`
Expected: FAIL — no `pages` spec.

- [ ] **Step 3: Extend the convert action**

In `src/core/actions/convert.ts`, when `source.kind === 'document'` and the target is an image format, return a `pages` select (`all` / `first` / `choose`), then a `dpi` select of `72` / `150` / `300` defaulting to `150`. `plan()` resolves `values.pages` — `'all'` to every index, `'first'` to `[0]`, and a range string through `parseRanges` then `normalisePages` — and builds one zero-padded output per page.

**The same `normalisePages` that the CLI uses.** Naming and writing must never derive from two orderings; that was phase 3's worst defect.

- [ ] **Step 4: Wire progress into the shell**

In `src/shell/App.tsx`, pass `onEvent` to `runJobs` and hold the latest `{ done, total, detail }` in state, mounting `<Progress>` while a job is running. `detail` is the basename of the output just written.

Mount it **only** when a `page` event has been seen — an operation that reports phases only must not show a bar.

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run tests/shell/convert-pdf.test.tsx`
Expected: PASS — 4 tests.

- [ ] **Step 6: Run the full suite and commit**

```bash
npm run lint && npm run typecheck && npm test
git add src/core/actions/convert.ts src/shell/App.tsx tests/shell/convert-pdf.test.tsx
git commit -m "feat(shell): choose pages and resolution, and watch them render"
```

---

## Task 9: The merge offer, and the encrypted-file signpost

**Files:**
- Modify: `src/shell/App.tsx`, `src/core/errors.ts`
- Test: `tests/shell/embed-suggestion.test.tsx`

**Interfaces:**
- Consumes: `mergeAction` (phase 3), the suggestion pattern from phase 2's compress flow

- [ ] **Step 1: Write the failing test**

Create `tests/shell/embed-suggestion.test.tsx`:

```tsx
import { describe, expect, it } from 'vitest'
import { encryptedSource } from '../../src/core/errors.js'

describe('the encrypted-file refusal', () => {
  it('names the command that can actually do it', () => {
    const error = encryptedSource('/tmp/scan.pdf')
    expect(`${error.detail} ${error.hint ?? ''}`).toContain('--unlock')
  })

  it('names the file so the command can be copied', () => {
    const error = encryptedSource('/tmp/scan.pdf')
    expect(`${error.detail} ${error.hint ?? ''}`).toContain('scan.pdf')
  })
})
```

Add a shell test asserting that converting several images to PDF offers a merge and does not perform one, following `tests/shell/compress-flow.test.tsx`'s structure for the existing suggestion.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/shell/embed-suggestion.test.tsx`
Expected: FAIL — the hint says "Remove the password first" and names no command.

- [ ] **Step 3: Update the error and add the offer**

In `src/core/errors.ts`:

```ts
export function encryptedSource(path: string): ForgeError {
  const name = basename(path)
  return new ForgeError({
    code: 'encrypted-source',
    title: 'This PDF is password-protected',
    detail: `${name} cannot be changed until it is unlocked.`,
    // The shell has no password field by design (spec §8), so it points at
    // the front end that does rather than only refusing.
    hint: `Unlock it first:  forge ${name} --unlock`,
  })
}
```

In `src/shell/App.tsx`, after a conversion whose target was `pdf` and which produced more than one output, push the offer — reusing the existing suggestion block rather than a new one.

- [ ] **Step 4: Run the tests, then the full suite, and commit**

```bash
npx vitest run tests/shell/embed-suggestion.test.tsx
npm run lint && npm run typecheck && npm test
git add src/core/errors.ts src/shell/App.tsx tests/shell/embed-suggestion.test.tsx
git commit -m "feat(shell): offer to merge embedded PDFs, and point at --unlock"
```

---

## Task 10: Documentation

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Document what shipped, by running it**

Build the binary and exercise every command before writing a line about it. Cover PDF→image (`--to jpeg`, `--pages`, `--dpi` and its bounds), image→PDF, and `--unlock` with both password routes.

State plainly that **unlock is CLI-only and protect is not built** — a README that leaves a user hunting for a shell command that does not exist is worse than one that says so.

- [ ] **Step 2: Note what is still to come**

Compress and split-under-a-size are phase 4b; Markdown, HTML and Office are phase 5. Do not imply any of them work.

- [ ] **Step 3: Commit**

```bash
npm run lint && npm run typecheck && npm test
git add README.md
git commit -m "docs: rasterisation, embedding, and unlock"
```

---

## Self-Review

**Spec coverage.** §4 routing → Task 1. §5 engines → Tasks 2, 3, 4. §6 PDF→image → Tasks 3, 7, 8. §7 image→PDF → Tasks 4, 9. §8 unlock → Tasks 6, 7, and the signpost in Task 9. §9 progress → Tasks 5, 8. §10 CLI → Task 7. §11 code layout → the File Structure table. §12 testing → distributed. §13 invariants → Global Constraints, with invariant 8 tested in Task 6. §14 out of scope → Task 10.

**Placeholder scan.** No `TBD` or "handle edge cases". Three steps describe rather than transcribe — Task 7's execute wiring, Task 8's convert-action options and the App.tsx progress state — because each threads through an existing flow whose shape the implementer must read first. Their tests are written out in full, which is what pins the behaviour.

**Type consistency.** `ConvertOptions.dpi`/`.pages` are defined in Task 3 and consumed in 7 and 8. `Job`'s `unlock` member is defined in Task 6 and consumed in 7. `openPdf` and `writeAtomic` are defined in Tasks 2 and 3 and reused in 6. `normalisePages` comes from phase 3's `core/pages.ts` and is used identically in Tasks 7 and 8 — deliberately the same function, so naming and writing cannot diverge. `Progress`'s props are fixed in Task 5 and mounted in Task 8.

**One risk worth naming.** Task 3's ordering test and Task 8's planning test both rest on `pages` reaching the engine already normalised. If a future caller skips `normalisePages`, the engine will render the wrong page into a correctly-named file — silently, exactly as phase 3's extract did. The engine deliberately does not defend against it, because defending would recreate the two-orderings bug. The protection is that one function exists and both callers use it.
