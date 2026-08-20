# Forge Phase 4a — PDF Pixels Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render PDF pages to images, embed images into PDFs, decrypt PDFs from the CLI, and show real progress while doing it.

**Architecture:** A second PDF engine (`engines/pdfium.ts`) sits beside the existing pdf-lib one, split by library rather than by feature. `engineForJob` learns to match a conversion on source *and* target, which two PDF-writing engines make mandatory. `Progress` and `runJobs`'s `onEvent` — both declared in phase 3 and never used — get wired to a determinate bar.

**Tech Stack:** Node 24 · TypeScript strict, ESM · React + Ink · Sharp 0.35.3 · pdf-lib 1.17.1 · **@hyzyla/pdfium 2.1.13 (new)** · Commander · Vitest · Biome · npm

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
| `src/engines/pdfium.ts` | pdfium: rasterise pages; open encrypted documents for reading. |
| `src/cli/stdin.ts` | Read a password from stdin or a TTY prompt. Nothing else. |
| `src/shell/components/Progress.tsx` | The determinate bar plus its counter line. |

**Modified:**

| File | Change |
| --- | --- |
| `src/engines/registry.ts` | `engineForJob` matches source + target for conversions; register `pdfiumEngine`. |
| `src/engines/pdf.ts` | Reads image formats; handles `convert` when the target is `pdf`. |
| `src/core/types.ts` | `ConvertOptions` gains `dpi`, `pages` and `password`. `Job` is unchanged. |
| `src/core/actions/convert.ts` | Page and resolution option specs when the source is a document. |
| `src/core/errors.ts` | `wrongPassword`, `invalidDpi`. |
| `src/cli/args.ts` | `--pages`, `--dpi`, `--password-stdin`. |
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

## Task 2: The pdfium engine skeleton

> **Amended 2026-08-20 (ruling R7).** This task originally created an `mupdf`
> engine. `mupdf` is AGPL-3.0-or-later and Forge is MIT, so it is replaced by
> `@hyzyla/pdfium` (wrapper MIT, PDFium core BSD-3-Clause). **If
> `src/engines/mupdf.ts` already exists in your checkout, delete it, remove
> `mupdf` from `package.json`, and delete `tests/engines/mupdf-registration.test.ts`.**
> The engine id is `pdfium` and it no longer declares an `unlock` op.

**Files:**
- Create: `src/engines/pdfium.ts`
- Delete (if present): `src/engines/mupdf.ts`, `tests/engines/mupdf-registration.test.ts`
- Modify: `src/engines/registry.ts`, `package.json`
- Test: `tests/engines/pdfium-registration.test.ts`

**Interfaces:**
- Produces: `pdfiumEngine: Engine` with `reads: {pdf}`, `writes: {jpeg, png}`, `ops: {convert}`; and `openPdf(bytes: Uint8Array, password?: string): Promise<PDFiumDocument>` at module scope for task 3.

- [ ] **Step 1: Swap the dependency**

```bash
npm uninstall mupdf
npm install @hyzyla/pdfium@2.1.13
```

Then confirm the licence is what this swap was for:

```bash
node -e "console.log(require('@hyzyla/pdfium/package.json').license)"   # MIT
```

- [ ] **Step 2: Write the failing test**

Create `tests/engines/pdfium-registration.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { ENGINES } from '../../src/engines/registry.js'
import { targetIdsFor } from '../../src/core/capabilities.js'
import type { DocumentInfo } from '../../src/core/types.js'

const doc: DocumentInfo = {
  kind: 'document', path: '/tmp/a.pdf', format: 'pdf',
  bytes: 1, pages: 3, encrypted: false,
}

describe('the pdfium engine', () => {
  it('is registered', () => {
    expect(ENGINES.map((e) => e.id)).toContain('pdfium')
  })

  it('declares what it reads and writes', () => {
    const engine = ENGINES.find((e) => e.id === 'pdfium')
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

  it('carries no AGPL dependency', async () => {
    // The reason this engine exists. A regression here is a licensing bug,
    // not a rendering one, and nothing else in the suite would catch it.
    const pkg = await import('../../package.json', { with: { type: 'json' } })
    expect(Object.keys(pkg.default.dependencies)).not.toContain('mupdf')
  })
})
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run tests/engines/pdfium-registration.test.ts`
Expected: FAIL — no engine with id `pdfium`.

- [ ] **Step 4: Write the engine skeleton**

Create `src/engines/pdfium.ts`:

```ts
import { PDFiumLibrary } from '@hyzyla/pdfium'
import type { PDFiumDocument } from '@hyzyla/pdfium'
import type { FormatId, Job, Progress, Result, SourceInfo } from '../core/types.js'
import type { Engine } from './types.js'

const READS: ReadonlySet<FormatId> = new Set<FormatId>(['pdf'])
const WRITES: ReadonlySet<FormatId> = new Set<FormatId>(['jpeg', 'png'])
const OPS: ReadonlySet<Job['op']> = new Set<Job['op']>(['convert'])

// PDFiumLibrary.init() compiles the wasm module. It costs real time and there
// is no reason to pay it per file, so it is memoised for the process. The
// promise itself is cached, not the resolved value, so two concurrent callers
// share one initialisation rather than racing two.
let library: Promise<Awaited<ReturnType<typeof PDFiumLibrary.init>>> | undefined
function getLibrary() {
  library ??= PDFiumLibrary.init()
  return library
}

/**
 * Open a PDF for reading.
 *
 * `password` is for ENCRYPTED SOURCES ONLY — PDFium can read a locked document
 * but cannot write one, so there is no unlock feature here (ruling R7). The
 * value must never be logged, returned, or attached to an error (invariant 8).
 */
export async function openPdf(bytes: Uint8Array, password?: string): Promise<PDFiumDocument> {
  const lib = await getLibrary()
  return await lib.loadDocument(bytes, password)
}

export const pdfiumEngine: Engine = {
  id: 'pdfium',
  reads: READS,
  writes: WRITES,
  ops: OPS,
  probe(): Promise<SourceInfo> {
    // engines/pdf.ts already classifies PDFs by content and is registered
    // first, so this is never reached. It throws rather than returning a
    // wrong answer if the registration order is ever changed.
    throw new Error('pdfium does not probe; engines/pdf.ts classifies PDFs')
  },
  async run(_job: Job, _onProgress: (p: Progress) => void): Promise<Result> {
    throw new Error('not implemented')   // Task 3
  },
}
```

- [ ] **Step 5: Register it**

In `src/engines/registry.ts`, import `pdfiumEngine` and add it **last**:

```ts
export const ENGINES: readonly Engine[] = [imageEngine, pdfEngine, pdfiumEngine]
```

Order matters for `probe()`: `pdfEngine` classifies PDFs by content and must be
reached first. `pdfiumEngine` only ever answers capability questions.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run tests/engines/pdfium-registration.test.ts tests/engines/routing.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/engines/pdfium.ts src/engines/registry.ts package.json package-lock.json tests/engines/pdfium-registration.test.ts
git rm -f --ignore-unmatch src/engines/mupdf.ts tests/engines/mupdf-registration.test.ts
git commit -m "feat(engines): add the pdfium engine, drop AGPL mupdf"
```


## Task 3: Rasterise PDF pages to images

> **Amended 2026-08-20 (ruling R7).** Rewritten for `@hyzyla/pdfium`.

**Files:**
- Modify: `src/engines/pdfium.ts`, `src/core/types.ts`, `src/core/errors.ts`
- Test: `tests/engines/pdfium-render.test.ts`

**Interfaces:**
- Consumes: `openPdf` (Task 2), `writeAtomic` from `core/atomic.ts`, `DEFAULT_QUALITY` from `engines/image.ts`
- Produces: `pdfiumEngine.run` handling `op: 'convert'`; `ConvertOptions` gains `dpi?: number` and `pages?: number[]`; `invalidDpi(value: unknown): ForgeError`

**Note on ordering:** `pages` is a 0-based, ascending, deduped list. The engine
writes `outputs[i]` from `pages[i]`. **It must not sort or dedupe internally** —
phase 3's worst defect was the engine sorting while the naming did not. Whatever
hands it a job is responsible for normalising, and `core/pages.ts`'s
`normalisePages` is that function.

**Two measured API constraints. Both were found by spiking; neither is guessable
from the types:**

1. **`render({ render: 'bitmap' })` returns RGBA.** A page painted R=51 G=102
   B=229 gives first pixel `[51,102,230,255]`. Pass it straight to Sharp's `raw`
   input with `channels: 4`. Swapping the channels yields `r=232 b=56` — visibly
   wrong colour that **passes every width/height assertion**. This is why step 1
   asserts a pixel colour.
2. **A `PDFiumPage` object is single-use.** Calling `.render()` twice on the same
   page object corrupts the wasm heap (`RuntimeError: table index is out of
   bounds`). Take a fresh `doc.getPage(n)` for each render. Never cache one.

- [ ] **Step 1: Write the failing test**

Create `tests/engines/pdfium-render.test.ts`:

```ts
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { pdfiumEngine } from '../../src/engines/pdfium.js'
import { probe } from '../../src/engines/registry.js'
import type { DocumentInfo, Job } from '../../src/core/types.js'
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
    // page n is 600 + n points wide, so an image's width identifies which page
    // it came from — not merely that a file appeared.
    const src = await makeMarkedPdf(dir, 'doc.pdf', [1, 2, 3, 4, 5])
    const outputs = [join(dir, 'a.jpg'), join(dir, 'b.jpg')]
    const job: Job = {
      op: 'convert', sources: [await doc(src)], outputs, target: 'jpeg',
      options: { ...options, dpi: 72, pages: [1, 3] },
    }

    await pdfiumEngine.run(job, () => {})

    // page index 1 is 602pt wide, index 3 is 604pt — at 72dpi, 1pt = 1px
    expect((await sharp(await readFile(outputs[0] as string)).metadata()).width).toBe(602)
    expect((await sharp(await readFile(outputs[1] as string)).metadata()).width).toBe(604)
  })

  it('writes the page\'s real colours, not a channel-swapped copy', async () => {
    // Guards the RGBA/BGRA trap. makeColouredPdf paints a deliberately
    // asymmetric colour: a symmetric one cannot tell RGBA from BGRA apart.
    const dir = await makeTempDir()
    const src = await makeColouredPdf(dir, 'c.pdf', { r: 51, g: 102, b: 229 })
    const out = join(dir, 'c.png')
    await pdfiumEngine.run({
      op: 'convert', sources: [await doc(src)], outputs: [out], target: 'png',
      options: { ...options, dpi: 72, pages: [0] },
    }, () => {})

    const { dominant } = await sharp(await readFile(out)).stats()
    expect(dominant.r).toBeGreaterThan(200 - 160)   // ~51, not ~232
    expect(dominant.b).toBeGreaterThan(200)         // ~229, not ~56
    expect(dominant.b).toBeGreaterThan(dominant.r)  // the ordering is the point
  })

  it('scales with the requested resolution', async () => {
    const dir = await makeTempDir()
    const src = await makeMarkedPdf(dir, 'doc.pdf', [1])
    const at = async (dpi: number) => {
      const out = join(dir, `${dpi}.jpg`)
      await pdfiumEngine.run({
        op: 'convert', sources: [await doc(src)], outputs: [out], target: 'jpeg',
        options: { ...options, dpi, pages: [0] },
      }, () => {})
      return (await sharp(await readFile(out)).metadata()).width as number
    }
    expect(await at(144)).toBe((await at(72)) * 2)
  })

  it('reports progress once per page, never fabricating a total', async () => {
    const dir = await makeTempDir()
    const src = await makeMarkedPdf(dir, 'doc.pdf', [1, 2, 3])
    const seen: Array<{ done: number; total: number }> = []
    await pdfiumEngine.run({
      op: 'convert', sources: [await doc(src)], target: 'jpeg',
      outputs: [join(dir, '1.jpg'), join(dir, '2.jpg'), join(dir, '3.jpg')],
      options: { ...options, dpi: 72, pages: [0, 1, 2] },
    }, (p) => { if (p.kind === 'determinate') seen.push({ done: p.done, total: p.total }) })

    expect(seen.map((s) => s.done)).toEqual([1, 2, 3])
    expect(seen.every((s) => s.total === 3)).toBe(true)
  })
})
```

You will need a `makeColouredPdf` helper. Add it to `tests/helpers/fixtures.ts`:

```ts
/** A one-page PDF filled with an asymmetric colour, for channel-order checks. */
export async function makeColouredPdf(
  dir: string, name: string, c: { r: number; g: number; b: number },
): Promise<string> {
  const doc = await PDFDocument.create()
  const page = doc.addPage([200, 200])
  page.drawRectangle({
    x: 0, y: 0, width: 200, height: 200,
    color: rgb(c.r / 255, c.g / 255, c.b / 255),
  })
  const path = join(dir, name)
  await writeFile(path, await doc.save())
  return path
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/engines/pdfium-render.test.ts`
Expected: FAIL — `not implemented`.

- [ ] **Step 3: Add `dpi` and `pages` to `ConvertOptions`**

In `src/core/types.ts`, extend `ConvertOptions`:

```ts
export type ConvertOptions = {
  readonly background: string
  readonly keepMetadata: boolean
  readonly quality?: number
  /** Rasterisation resolution. 36–600. Only meaningful for a PDF source. */
  readonly dpi?: number
  /** 0-based page indices, ascending and deduped by `normalisePages`. */
  readonly pages?: readonly number[]
  /**
   * For an ENCRYPTED source only. Never logged, never returned, never attached
   * to an error — invariant 8. There is no `--password` flag; this arrives from
   * a prompt or `--password-stdin`.
   */
  readonly password?: string
}
```

- [ ] **Step 4: Add the `invalidDpi` error**

In `src/core/errors.ts`, beside the existing constructors:

```ts
export function invalidDpi(value: unknown): ForgeError {
  return forgeError({
    code: 'invalid-dpi',
    message: `${String(value)} is not a resolution I can use.`,
    hint: 'Give a number between 36 and 600. The default is 150.',
  })
}
```

- [ ] **Step 5: Implement `run`**

In `src/engines/pdfium.ts`, replace the throwing `run`:

```ts
async run(job: Job, onProgress: (p: Progress) => void): Promise<Result> {
  if (job.op !== 'convert') throw new Error(`pdfium cannot ${job.op}`)
  const source = job.sources[0]
  const dpi = job.options.dpi ?? 150
  const pages = job.options.pages ?? []
  const quality = job.options.quality ?? DEFAULT_QUALITY.jpeg

  const doc = await openPdf(await readFile(source.path), job.options.password)
  try {
    const written: string[] = []
    for (const [i, index] of pages.entries()) {
      // A fresh page handle per render. Reusing one corrupts the wasm heap.
      const bitmap = await doc.getPage(index).render({
        scale: dpi / 72,
        render: 'bitmap',
      })
      // bitmap.data is RGBA — hand it to Sharp unswapped.
      const image = sharp(Buffer.from(bitmap.data), {
        raw: { width: bitmap.width, height: bitmap.height, channels: 4 },
      })
      const bytes = job.target === 'png'
        ? await image.png().toBuffer()
        : await image.flatten({ background: job.options.background })
                     .jpeg({ quality, mozjpeg: true }).toBuffer()

      const out = job.outputs[i] as string
      await writeAtomic(out, bytes)
      written.push(out)
      onProgress({ kind: 'determinate', done: i + 1, total: pages.length })
    }
    return { ok: true, outputs: written }
  } finally {
    // Frees the wasm document. Skipping it leaks the whole page buffer.
    doc.destroy()
  }
}
```

**CORRECTED 2026-08-20 — the original note here was factually wrong.** It said
"a PDF page is rendered onto transparency where nothing is painted, and JPEG
cannot carry alpha, so flatten on the JPEG path only; PNG keeps it." pdfium does
not do that: `render()` defaults `transparent: false` and pre-fills the bitmap
with opaque white `0xffffffff`. Measured — an unpainted region comes back
`[255,255,255,255]`. So `flatten()` was a no-op, `--background` silently did
nothing, and "PNG keeps alpha" described four channels with alpha uniformly 255.

Pass `transparent: true` to `render()`, then flatten onto
`job.options.background` for **both** targets. The default background is
`#ffffff`, so default output is visually unchanged, but `--background` starts
working. PNG is flattened too, deliberately: a scanned page's unpainted area
reads as paper, not a transparent cut-out.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run tests/engines/pdfium-render.test.ts`
Expected: PASS.

- [ ] **Step 7: Sabotage-check the colour test**

Prove the colour assertion is load-bearing. Temporarily swap the channels before
handing the buffer to Sharp:

```ts
for (let i = 0; i < bitmap.data.length; i += 4) {
  const t = bitmap.data[i]; bitmap.data[i] = bitmap.data[i+2]; bitmap.data[i+2] = t
}
```

Run the suite. **The colour test must fail and the width tests must still pass** —
that asymmetry is the whole reason the colour test exists. Revert the sabotage.

- [ ] **Step 8: Commit**

```bash
git add src/engines/pdfium.ts src/core/types.ts src/core/errors.ts tests/engines/pdfium-render.test.ts tests/helpers/fixtures.ts
git commit -m "feat(engines): rasterise PDF pages through pdfium"
```


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

## Task 6: Unlock — CUT

> **Cut 2026-08-20 (ruling R7).** This task built `unlock` on mupdf's
> `authenticatePassword` + save. `mupdf` is AGPL-3.0-or-later and Forge is MIT,
> so it was removed. PDFium can *open* an encrypted PDF but exposes no save
> function — verified against its API surface — and unlock must decrypt **and
> write**. There is no permissive library in the stack that can do it.
>
> **Do not implement this task.** Skip to Task 7.
>
> What survives: reading an encrypted PDF. `openPdf` takes an optional
> `password`, so `/convert` on a locked PDF prompts and rasterises. That keeps
> `src/cli/stdin.ts` (Task 7) and invariant 8 in force.
>
> If unlock is ever wanted, `qpdf-wasm` (Apache-2.0) can decrypt and write, but
> it was v0.1.0 at the time of this decision and was judged too immature to put
> on the password path.


## Task 7: CLI — page selection, resolution, encrypted sources

> **Amended 2026-08-20 (ruling R7).** `--unlock` is gone with the feature. The
> password path survives for *reading* an encrypted PDF during a conversion.

**Files:**
- Create: `src/cli/stdin.ts`
- Modify: `src/cli/args.ts`, `src/cli/execute.ts`
- Test: `tests/cli/pixels-args.test.ts`

**Interfaces:**
- Consumes: `parseRanges`, `normalisePages` (`core/pages.ts`), `invalidDpi`, `openPdf` (Task 2)
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

describe('encrypted sources', () => {
  it('parses --password-stdin', () => {
    expect(parseArgs(argv('--to', 'jpeg', '--password-stdin')).passwordStdin).toBe(true)
  })

  it('has no --password flag at all', () => {
    // A password in argv lands in shell history and ps output. Spec §8.
    expect(() => parseArgs(argv('--to', 'jpeg', '--password', 'hunter2'))).toThrow()
  })

  it('has no --unlock flag — the feature was cut, so the flag must not linger', () => {
    // A flag that parses but does nothing is worse than no flag. Ruling R7.
    expect(() => parseArgs(argv('--unlock'))).toThrow()
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
  .option('--password-stdin', 'read an encrypted PDF\'s password from stdin')
```

Extend `Intent` with `dpi?: number`, `pages?: string`, and `passwordStdin?: boolean`. The `action` union is unchanged. Validate:

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

In `src/cli/execute.ts`, when a conversion's source is a document with `encrypted: true`: read the password via `readPassword({ stdin: intent.passwordStdin ?? false })` and pass it in `ConvertOptions.password`. If the source is not encrypted, never prompt. A wrong password must fail with the existing encrypted-source error and **must not** echo the attempted value (invariant 8).

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
git commit -m "feat(cli): render pages to images, prompt for locked PDFs"
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
    expect(`${error.detail} ${error.hint ?? ''}`).toContain('--password-stdin')
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
    detail: `${name} is password-protected.`,
    // The shell has no password field by design (spec §8), so it points at
    // the front end that does rather than only refusing.
    hint: `Convert it to images instead:  forge ${name} --to jpeg --password-stdin`,
  })
}
```

In `src/shell/App.tsx`, after a conversion whose target was `pdf` and which produced more than one output, push the offer — reusing the existing suggestion block rather than a new one.

- [ ] **Step 4: Run the tests, then the full suite, and commit**

```bash
npx vitest run tests/shell/embed-suggestion.test.tsx
npm run lint && npm run typecheck && npm test
git add src/core/errors.ts src/shell/App.tsx tests/shell/embed-suggestion.test.tsx
git commit -m "feat(shell): offer to merge embedded PDFs, signpost locked files"
```

---

## Task 10: Documentation

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Document what shipped, by running it**

Build the binary and exercise every command before writing a line about it. Cover PDF→image (`--to jpeg`, `--pages`, `--dpi` and its bounds), image→PDF, and converting an encrypted PDF by both password routes.

State plainly that **Forge cannot remove a password from a PDF, only read one it is given** — and why: the libraries that can decrypt-and-write are AGPL, and Forge is MIT. A README that leaves a user hunting for a command that does not exist is worse than one that says so.

- [ ] **Step 2: Note what is still to come**

Compress and split-under-a-size are phase 4b; Markdown, HTML and Office are phase 5. Do not imply any of them work.

- [ ] **Step 3: Commit**

```bash
npm run lint && npm run typecheck && npm test
git add README.md
git commit -m "docs: rasterisation, embedding, encrypted sources"
```

---

## Self-Review

**Spec coverage.** §4 routing → Task 1. §5 engines → Tasks 2, 3, 4. §6 PDF→image → Tasks 3, 7, 8. §7 image→PDF → Tasks 4, 9. §8 unlock → CUT by ruling R7; the reading half survives in Task 7 and the signpost in Task 9. §9 progress → Tasks 5, 8. §10 CLI → Task 7. §11 code layout → the File Structure table. §12 testing → distributed. §13 invariants → Global Constraints, with invariant 8 tested in Task 7. §14 out of scope → Task 10.

**Placeholder scan.** No `TBD` or "handle edge cases". Three steps describe rather than transcribe — Task 7's execute wiring, Task 8's convert-action options and the App.tsx progress state — because each threads through an existing flow whose shape the implementer must read first. Their tests are written out in full, which is what pins the behaviour.

**Type consistency.** `ConvertOptions.dpi`/`.pages` are defined in Task 3 and consumed in 7 and 8. `Job` gains no new member — `unlock` was cut, so `Job['op']` is untouched by this phase. `openPdf` is defined in Task 2 and reused in 3 and 7; `writeAtomic` lives in `core/atomic.ts`. `normalisePages` comes from phase 3's `core/pages.ts` and is used identically in Tasks 7 and 8 — deliberately the same function, so naming and writing cannot diverge. `Progress`'s props are fixed in Task 5 and mounted in Task 8.

**One risk worth naming.** Task 3's ordering test and Task 8's planning test both rest on `pages` reaching the engine already normalised. If a future caller skips `normalisePages`, the engine will render the wrong page into a correctly-named file — silently, exactly as phase 3's extract did. The engine deliberately does not defend against it, because defending would recreate the two-orderings bug. The protection is that one function exists and both callers use it.
