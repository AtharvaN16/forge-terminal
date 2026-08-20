# Forge Phase 3 — PDF Page Operations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `/pdf` command, multi-file staging, and five page operations — merge, split, extract, delete, rotate — on top of a new `pdf-lib` engine.

**Architecture:** `SourceInfo` and `Job` become discriminated unions so a document (pages, encryption) and a multi-input/multi-output operation are representable without loosening the image path. A new `engines/pdf.ts` implements the five operations. The shell's single staged file becomes a list, and the PDF conversation lives in its own flow module rather than growing `App.tsx`.

**Tech Stack:** Node 24 · TypeScript strict, ESM · React + Ink · Sharp 0.35.3 · **pdf-lib 1.17.1 (new)** · Commander · Vitest · Biome · npm

**Spec:** [docs/superpowers/specs/2026-08-20-forge-phase-3-pdf-design.md](../specs/2026-08-20-forge-phase-3-pdf-design.md)

## Global Constraints

- **Work on `dev`.** Never commit to `main`. Merge to `main` only when the phase is complete and tests pass.
- **`core/` and `engines/` import no React, no Ink, no Chalk, and never write to stdout.** They return data.
- **No hardcoded list of output formats anywhere.** Targets come from `targetsFor(source)`, computed from engine capabilities.
- **Sources are probed by content, never by file extension.**
- **Writes are atomic** — temp file, then rename. Extended this phase: a multi-output job is all-or-nothing; a failure part-way removes outputs already renamed.
- **Progress is never fabricated.** Page operations report no percentage. The `page` progress event may only be emitted where the total is genuinely known in advance.
- **Rotation is additive**, never absolute: `page.getRotation().angle + turns * 90`, normalised to 0–270.
- **Split partitions.** Every page lands in exactly one output. It never drops pages.
- **Page numbers are 1-based in everything the user sees and 0-based everywhere in code.**
- **Grid geometry:** gaps are 3 columns on all three lines; page numbers right-aligned; cell width fixed by the document's largest page number.
- **Cut glyphs are `┃` (cut) and `┆` (uncut).** Never `✂` — it is a Dingbat many terminals render at two columns.
- Symbols are paired with words at every call site so meaning survives a monochrome terminal.
- Run `npm run lint && npm run typecheck && npm test` before every commit.

---

## File Structure

**Created:**

| File | Responsibility |
| --- | --- |
| `src/core/pages.ts` | Range grammar, `cuts ⇄ ranges`, page-set validation. Pure. |
| `src/engines/pdf.ts` | The five page operations on `pdf-lib`. Probing by content. |
| `src/core/actions/merge.ts` | Merge action: option specs and job planning. |
| `src/core/actions/split.ts` | Split action: mode picker, then cuts. |
| `src/core/actions/extract.ts` | Extract **and** delete — inverses, one file. |
| `src/core/actions/rotate.ts` | Rotate action. |
| `src/shell/stage.ts` | The staged list and its rules, lifted out of `App.tsx`. |
| `src/shell/components/PageGrid.tsx` | Page cells; cell-mode and gap-mode cursors; paging. |
| `src/shell/components/StagedFiles.tsx` | The multi-file card and the skipped-files report. |
| `src/shell/flows/pdf.tsx` | The `/pdf` conversation. |

**Modified:**

| File | Change |
| --- | --- |
| `src/core/types.ts` | `SourceInfo` → union; `Job` → union; add `Progress`. |
| `src/core/formats.ts` | Add the `pdf` entry. |
| `src/core/errors.ts` | Add `invalid-page-range`, `encrypted-source`, `empty-selection`. |
| `src/core/output-path.ts` | Suffix naming for page ops; merge's folder rule. |
| `src/core/run.ts` | Dispatch by `job.op`; multi-output atomicity. |
| `src/core/plan.ts` | Build `op: 'convert'` jobs. |
| `src/core/actions/index.ts` | `appliesTo(sources[])`; register the new actions. |
| `src/engines/types.ts` | `Engine.ops`; `convert` → `run`. |
| `src/engines/registry.ts` | Register `pdfEngine`; route by op. |
| `src/engines/image.ts` | `kind: 'image'`; `run` dispatching on `op`. |
| `src/cli/args.ts` | `--merge --split --extract --delete --rotate`. |
| `src/shell/App.tsx` | Staged list; delegate to `flows/pdf.tsx`. |
| `src/shell/commands.ts` | The `pdf` command entry. |
| `tests/helpers/fixtures.ts` | `makePdf`, `makeStampedPdf`, `pdfPageCount`, `pdfPageLabels`. |

---

## Task 1: The page-range grammar

**Files:**
- Create: `src/core/pages.ts`
- Modify: `src/core/errors.ts`
- Test: `tests/core/pages.test.ts`

**Interfaces:**
- Consumes: `ForgeError` from `src/core/errors.ts`
- Produces:
  - `parseRanges(input: string, pageCount: number): number[]` — 0-based indices, sorted, deduped
  - `formatRanges(pages: number[]): string` — 1-based display, e.g. `"3-7, 12, 20-24"`
  - `cutsToRanges(cuts: number[], pageCount: number): PageRange[]`
  - `rangesToCuts(ranges: PageRange[]): number[]`
  - `interface PageRange { from: number; to: number }` — 0-based, inclusive
  - `invalidPageRange(input: string, detail: string, pageCount: number): ForgeError`

- [ ] **Step 1: Write the failing test**

Create `tests/core/pages.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { cutsToRanges, formatRanges, parseRanges, rangesToCuts } from '../../src/core/pages.js'

describe('parseRanges', () => {
  it('parses a single page as a 0-based index', () => {
    expect(parseRanges('3', 10)).toEqual([2])
  })

  it('parses an inclusive span', () => {
    expect(parseRanges('3-7', 10)).toEqual([2, 3, 4, 5, 6])
  })

  it('parses an open-ended span as "to the end"', () => {
    expect(parseRanges('8-', 10)).toEqual([7, 8, 9])
  })

  it('parses several comma-separated terms', () => {
    expect(parseRanges('3-5, 9, 1', 10)).toEqual([0, 2, 3, 4, 8])
  })

  it('collapses duplicates and overlaps', () => {
    expect(parseRanges('1,1,1-3,2', 10)).toEqual([0, 1, 2])
  })

  it('tolerates any amount of surrounding whitespace', () => {
    expect(parseRanges('  3 - 5 ,  9  ', 10)).toEqual([2, 3, 4, 8])
  })

  it('rejects page 0, because pages are 1-based to the user', () => {
    expect(() => parseRanges('0-3', 10)).toThrow(/1 and 10/)
  })

  it('rejects a page past the end and names the page count', () => {
    expect(() => parseRanges('11', 10)).toThrow(/1 and 10/)
  })

  it('rejects a reversed span', () => {
    expect(() => parseRanges('7-3', 10)).toThrow(/7-3/)
  })

  it('rejects non-numeric input', () => {
    expect(() => parseRanges('three', 10)).toThrow(/three/)
  })

  it('rejects empty input rather than selecting nothing silently', () => {
    expect(() => parseRanges('   ', 10)).toThrow(/no pages/)
  })
})

describe('formatRanges', () => {
  it('collapses consecutive pages into spans, 1-based', () => {
    expect(formatRanges([2, 3, 4, 5, 6, 11, 19, 20])).toBe('3-7, 12, 20-21')
  })

  it('renders a single page without a dash', () => {
    expect(formatRanges([0])).toBe('1')
  })

  it('renders an empty selection as an empty string', () => {
    expect(formatRanges([])).toBe('')
  })

  it('round-trips through parseRanges', () => {
    const pages = [0, 1, 2, 6, 9]
    expect(parseRanges(formatRanges(pages), 10)).toEqual(pages)
  })
})

describe('cuts and ranges are the same data', () => {
  it('turns cuts into the ranges they partition the document into', () => {
    // cuts after 0-based pages 0 and 3 -> [0,0], [1,3], [4,6]
    expect(cutsToRanges([0, 3], 7)).toEqual([
      { from: 0, to: 0 },
      { from: 1, to: 3 },
      { from: 4, to: 6 },
    ])
  })

  it('returns the whole document when there are no cuts', () => {
    expect(cutsToRanges([], 7)).toEqual([{ from: 0, to: 6 }])
  })

  it('turns ranges back into cuts', () => {
    expect(rangesToCuts([{ from: 0, to: 0 }, { from: 1, to: 3 }, { from: 4, to: 6 }])).toEqual([0, 3])
  })

  it('round-trips any cut set unchanged', () => {
    for (const cuts of [[], [0], [2, 5], [0, 1, 2, 3, 4, 5]]) {
      expect(rangesToCuts(cutsToRanges(cuts, 7))).toEqual(cuts)
    }
  })

  it('always partitions: every page appears exactly once', () => {
    const ranges = cutsToRanges([1, 4], 9)
    const seen = ranges.flatMap((r) => Array.from({ length: r.to - r.from + 1 }, (_, i) => r.from + i))
    expect(seen).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8])
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/core/pages.test.ts`
Expected: FAIL — `Failed to resolve import "../../src/core/pages.js"`

- [ ] **Step 3: Add the error factory**

Append to `src/core/errors.ts`. Add `'invalid-page-range'` to the `ErrorCode` union first, then:

```ts
export function invalidPageRange(input: string, detail: string, pageCount: number): ForgeError {
  return new ForgeError({
    code: 'invalid-page-range',
    title: 'Page range not understood',
    detail,
    hint: `This document has ${pageCount} pages. Use numbers and spans, like "3-7, 12, 20-".`,
  })
}
```

- [ ] **Step 4: Write the implementation**

Create `src/core/pages.ts`:

```ts
import { invalidPageRange } from './errors.js'

/** A span of pages, 0-based and inclusive at both ends. */
export interface PageRange {
  from: number
  to: number
}

/**
 * Parse a user-typed page selection into 0-based page indices.
 *
 * The grammar is comma-separated terms, each `N`, `N-M`, or `N-` meaning "to
 * the end". Input is 1-based because that is what page numbers are to
 * everyone who is not a programmer; the output is 0-based because that is
 * what pdf-lib wants. That conversion happens here and nowhere else.
 *
 * Out-of-range pages are an error rather than a silent clamp: someone who
 * types `1-100` on a 10-page document has misunderstood something, and
 * quietly giving them 10 pages hides it.
 */
export function parseRanges(input: string, pageCount: number): number[] {
  const terms = input
    .split(',')
    .map((t) => t.trim())
    .filter((t) => t !== '')

  if (terms.length === 0) {
    throw invalidPageRange(input, 'That selects no pages.', pageCount)
  }

  const pages = new Set<number>()
  const inBounds = (n: number, term: string) => {
    if (!Number.isInteger(n) || n < 1 || n > pageCount) {
      throw invalidPageRange(term, `"${term}" is outside 1 and ${pageCount}.`, pageCount)
    }
    return n
  }

  for (const term of terms) {
    const span = term.match(/^(\d+)\s*-\s*(\d*)$/)
    if (span?.[1] !== undefined) {
      const from = inBounds(Number(span[1]), term)
      const to = span[2] === '' ? pageCount : inBounds(Number(span[2]), term)
      if (to < from) {
        throw invalidPageRange(term, `"${term}" ends before it starts.`, pageCount)
      }
      for (let p = from; p <= to; p++) pages.add(p - 1)
      continue
    }

    if (!/^\d+$/.test(term)) {
      throw invalidPageRange(term, `"${term}" is not a page number.`, pageCount)
    }
    pages.add(inBounds(Number(term), term) - 1)
  }

  return [...pages].sort((a, b) => a - b)
}

/** The inverse of `parseRanges`, for showing a selection back to the user. */
export function formatRanges(pages: number[]): string {
  if (pages.length === 0) return ''
  const sorted = [...new Set(pages)].sort((a, b) => a - b)
  const parts: string[] = []

  let start = sorted[0] as number
  let prev = start
  for (const page of sorted.slice(1)) {
    if (page === prev + 1) {
      prev = page
      continue
    }
    parts.push(start === prev ? `${start + 1}` : `${start + 1}-${prev + 1}`)
    start = page
    prev = page
  }
  parts.push(start === prev ? `${start + 1}` : `${start + 1}-${prev + 1}`)
  return parts.join(', ')
}

/**
 * Cut points and contiguous ranges are the same data seen two ways, which is
 * what lets the grid and the typed range editor edit one selection.
 *
 * `cuts` holds the 0-based index of each page *after which* the document is
 * cut. The result always partitions the document: every page lands in exactly
 * one range, which is what makes split a partition rather than a selection.
 */
export function cutsToRanges(cuts: number[], pageCount: number): PageRange[] {
  const sorted = [...new Set(cuts)].sort((a, b) => a - b).filter((c) => c >= 0 && c < pageCount - 1)
  const ranges: PageRange[] = []
  let from = 0
  for (const cut of sorted) {
    ranges.push({ from, to: cut })
    from = cut + 1
  }
  ranges.push({ from, to: pageCount - 1 })
  return ranges
}

/** The cut points implied by a list of contiguous ranges. */
export function rangesToCuts(ranges: PageRange[]): number[] {
  return ranges.slice(0, -1).map((r) => r.to)
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run tests/core/pages.test.ts`
Expected: PASS — 21 tests

- [ ] **Step 6: Lint, typecheck, commit**

```bash
npm run lint && npm run typecheck && npx vitest run tests/core/pages.test.ts
git add src/core/pages.ts src/core/errors.ts tests/core/pages.test.ts
git commit -m "feat(core): page range grammar and cuts/ranges conversion"
```

---

## Task 2: `SourceInfo` becomes a discriminated union

**Files:**
- Modify: `src/core/types.ts`, `src/engines/image.ts`, and every site that reads image-only fields
- Test: `tests/core/types-narrowing.test.ts`

**Interfaces:**
- Produces:
  - `interface ImageInfo { kind: 'image'; path; format; bytes; width; height; hasAlpha; frames }`
  - `interface DocumentInfo { kind: 'document'; path; format; bytes; pages; encrypted }`
  - `type SourceInfo = ImageInfo | DocumentInfo`

**Note:** This task is a compile-driven sweep. TypeScript strict finds every site; there is no runtime discovery to do.

- [ ] **Step 1: Write the failing test**

Create `tests/core/types-narrowing.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import type { DocumentInfo, ImageInfo, SourceInfo } from '../../src/core/types.js'

describe('SourceInfo', () => {
  it('narrows to image fields on kind "image"', () => {
    const source: SourceInfo = {
      kind: 'image',
      path: '/tmp/a.jpg',
      format: 'jpeg',
      bytes: 1024,
      width: 800,
      height: 600,
      hasAlpha: false,
      frames: 1,
    }
    expect(source.kind === 'image' ? source.width : 0).toBe(800)
  })

  it('narrows to document fields on kind "document"', () => {
    const source: SourceInfo = {
      kind: 'document',
      path: '/tmp/a.pdf',
      format: 'pdf',
      bytes: 4096,
      pages: 24,
      encrypted: false,
    }
    expect(source.kind === 'document' ? source.pages : 0).toBe(24)
  })

  it('keeps the two shapes distinct', () => {
    const image: ImageInfo = {
      kind: 'image',
      path: '/tmp/a.jpg',
      format: 'jpeg',
      bytes: 1,
      width: 1,
      height: 1,
      hasAlpha: false,
      frames: 1,
    }
    const doc: DocumentInfo = {
      kind: 'document',
      path: '/tmp/a.pdf',
      format: 'pdf',
      bytes: 1,
      pages: 1,
      encrypted: false,
    }
    expect(image.kind).not.toBe(doc.kind)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/core/types-narrowing.test.ts`
Expected: FAIL — `DocumentInfo` is not exported

- [ ] **Step 3: Rewrite the types**

In `src/core/types.ts`, replace the `SourceInfo` interface with:

```ts
/** What a file actually is, determined by reading it — never by its extension. */
export interface ImageInfo {
  kind: 'image'
  path: string
  format: FormatId
  bytes: number
  width: number
  height: number
  hasAlpha: boolean
  /** 1 for a still image, >1 for an animation. */
  frames: number
}

/** A paged document. Pages are what it has instead of pixels. */
export interface DocumentInfo {
  kind: 'document'
  path: string
  format: FormatId
  bytes: number
  pages: number
  /** True when the file is password-protected. Probing never prompts. */
  encrypted: boolean
}

export type SourceInfo = ImageInfo | DocumentInfo
```

- [ ] **Step 4: Set the discriminant in the image engine**

In `src/engines/image.ts`, find where `probe` builds its return value and add `kind: 'image'` as the first property.

- [ ] **Step 5: Let the compiler find the rest**

Run: `npm run typecheck`

Fix each error by narrowing on `kind` first. The expected sites and their fixes:

- `src/shell/components/FileCard.tsx` — the `facts` array reads `width`, `height`, `hasAlpha`. Guard the whole block: build `facts` from `source.kind === 'image' ? [...] : [`${source.pages} pages`]`.
- `src/shell/blocks.tsx` — same treatment wherever dimensions are printed.
- `src/core/suggest.ts`, `src/core/compress.ts`, `src/core/actions/convert.ts`, `src/core/actions/compress.ts`, `src/cli/report.ts` — each reads image fields; narrow at the top of the function and return early for documents where the operation is image-only.

Fix existing test fixtures the same way: any literal `SourceInfo` in `tests/` needs `kind: 'image'`.

- [ ] **Step 6: Run everything**

Run: `npm run lint && npm run typecheck && npm test`
Expected: PASS — the full existing suite plus the three new narrowing tests

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "refactor(core): SourceInfo becomes an image/document union"
```

---

## Task 3: The `pdf` format and probing by content

**Files:**
- Create: `src/engines/pdf.ts`
- Modify: `src/core/formats.ts`, `src/engines/registry.ts`, `tests/helpers/fixtures.ts`, `package.json`
- Test: `tests/engines/pdf-probe.test.ts`

**Interfaces:**
- Consumes: `DocumentInfo` (Task 2)
- Produces:
  - `pdfEngine: Engine` with `reads: {pdf}`, `writes: {pdf}`
  - `makePdf(dir, name, pages): Promise<string>` in fixtures
  - `makeStampedPdf(dir, name, labels): Promise<string>` — draws its label on each page
  - `pdfPageCount(path): Promise<number>`
  - `pdfPageLabels(path): Promise<string[]>` — reads back what `makeStampedPdf` drew

- [ ] **Step 1: Install pdf-lib**

```bash
npm install pdf-lib@1.17.1
```

- [ ] **Step 2: Write the failing test**

Create `tests/engines/pdf-probe.test.ts`:

```ts
import { rename } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { probe } from '../../src/engines/registry.js'
import { makeJpeg, makePdf, makeTempDir } from '../helpers/fixtures.js'

describe('probing a PDF', () => {
  it('reports it as a document with a page count', async () => {
    const dir = await makeTempDir()
    const path = await makePdf(dir, 'doc.pdf', 24)
    const info = await probe(path)
    expect(info.kind).toBe('document')
    expect(info.format).toBe('pdf')
    if (info.kind !== 'document') throw new Error('expected a document')
    expect(info.pages).toBe(24)
    expect(info.encrypted).toBe(false)
    expect(info.bytes).toBeGreaterThan(0)
  })

  it('recognises it by content, not by extension', async () => {
    const dir = await makeTempDir()
    const path = await makePdf(dir, 'doc.pdf', 3)
    const lying = join(dir, 'doc.txt')
    await rename(path, lying)
    const info = await probe(lying)
    expect(info.kind).toBe('document')
    expect(info.format).toBe('pdf')
  })

  it('still probes images as images', async () => {
    const dir = await makeTempDir()
    const path = await makeJpeg(dir, 'a.jpg')
    const info = await probe(path)
    expect(info.kind).toBe('image')
    expect(info.format).toBe('jpeg')
  })
})
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run tests/engines/pdf-probe.test.ts`
Expected: FAIL — `makePdf` is not exported

- [ ] **Step 4: Add the fixture helpers**

Append to `tests/helpers/fixtures.ts`:

```ts
import { PDFDocument, StandardFonts } from 'pdf-lib'

/** A plain N-page A4 document. 24 pages builds in about 14 ms. */
export async function makePdf(dir: string, name: string, pages = 3): Promise<string> {
  const doc = await PDFDocument.create()
  for (let i = 0; i < pages; i++) doc.addPage([595, 842])
  const path = join(dir, name)
  await writeFile(path, await doc.save())
  return path
}

/**
 * A document whose pages each carry a visible label.
 *
 * Merge and split tests need this: a page-count assertion passes even when an
 * operation silently reorders pages, and order is the whole point of merge.
 */
export async function makeStampedPdf(dir: string, name: string, labels: string[]): Promise<string> {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  for (const label of labels) {
    const page = doc.addPage([595, 842])
    page.drawText(label, { x: 50, y: 700, size: 36, font })
  }
  const path = join(dir, name)
  await writeFile(path, await doc.save())
  return path
}

export async function pdfPageCount(path: string): Promise<number> {
  const doc = await PDFDocument.load(await readFile(path), { ignoreEncryption: true })
  return doc.getPageCount()
}

/**
 * The labels `makeStampedPdf` drew, read back in page order.
 *
 * pdf-lib cannot extract text, so this reads the raw content stream of each
 * page and pulls out the string literal drawn by `drawText`. Adequate because
 * the labels are ASCII and the only text on the page.
 */
export async function pdfPageLabels(path: string): Promise<string[]> {
  const doc = await PDFDocument.load(await readFile(path), { ignoreEncryption: true })
  const labels: string[] = []
  for (const page of doc.getPages()) {
    const streams = page.node.normalizedEntries().Contents
    const bytes = streams?.asBytes?.() ?? new Uint8Array()
    const text = Buffer.from(bytes).toString('latin1')
    labels.push(text.match(/\((.*?)\)\s*Tj/)?.[1] ?? '')
  }
  return labels
}
```

Add `readFile` and `writeFile` to the existing `node:fs/promises` import at the top of the file if they are not already there.

- [ ] **Step 5: Add the format entry**

In `src/core/formats.ts`, add to `FORMATS`:

```ts
  pdf: {
    id: 'pdf',
    label: 'PDF',
    extensions: ['.pdf'],
    hasAlpha: false,
    animatable: false,
    // A PDF container is not lossy. /compress supplies its own quality
    // control; /convert must not show a quality slider for this target.
    lossy: false,
    hint: 'document',
  },
```

And add `'pdf'` to the `FormatId` union in `src/core/types.ts`.

- [ ] **Step 6: Write the engine's probe**

Create `src/engines/pdf.ts`:

```ts
import { readFile, stat } from 'node:fs/promises'
import { PDFDocument } from 'pdf-lib'
import type { DocumentInfo, FormatId, Job, Progress, Result } from '../core/types.js'
import type { Engine } from './types.js'

const READS: ReadonlySet<FormatId> = new Set<FormatId>(['pdf'])
const WRITES: ReadonlySet<FormatId> = new Set<FormatId>(['pdf'])
const OPS: ReadonlySet<Job['op']> = new Set<Job['op']>([
  'merge',
  'split',
  'extract',
  'delete',
  'rotate',
])

/**
 * Load a document for inspection.
 *
 * `ignoreEncryption` is deliberate: an encrypted PDF must probe successfully
 * and report `encrypted: true`, so the flow can refuse it with a message that
 * names the fix. Failing here instead would surface as "not a format Forge
 * reads", which is both wrong and unactionable.
 */
async function load(path: string): Promise<PDFDocument> {
  return PDFDocument.load(await readFile(path), { ignoreEncryption: true })
}

async function probe(path: string): Promise<DocumentInfo> {
  const doc = await load(path)
  const { size } = await stat(path)
  return {
    kind: 'document',
    path,
    format: 'pdf',
    bytes: size,
    pages: doc.getPageCount(),
    encrypted: doc.isEncrypted,
  }
}

export const pdfEngine: Engine = {
  id: 'pdf',
  reads: READS,
  writes: WRITES,
  ops: OPS,
  probe,
  async run(_job: Job, _onPhase: (p: Progress) => void): Promise<Result> {
    throw new Error('not implemented until task 6')
  },
}
```

- [ ] **Step 7: Register the engine**

In `src/engines/registry.ts`:

```ts
import { pdfEngine } from './pdf.js'

export const ENGINES: Engine[] = [imageEngine, pdfEngine]
```

Order matters: Sharp throws on a PDF, so the image engine declines first and `probe()` moves on. Keep `imageEngine` first so the common case costs one attempt.

- [ ] **Step 8: Run the test**

Run: `npx vitest run tests/engines/pdf-probe.test.ts`
Expected: PASS — 3 tests

- [ ] **Step 9: Lint, typecheck, commit**

```bash
npm run lint && npm run typecheck && npm test
git add -A
git commit -m "feat(engines): pdf format, engine skeleton, probing by content"
```

---

## Task 4: `Job` becomes a discriminated union

**Files:**
- Modify: `src/core/types.ts`, `src/engines/types.ts`, `src/engines/image.ts`, `src/engines/registry.ts`, `src/core/run.ts`, `src/core/plan.ts`
- Test: `tests/core/job-shape.test.ts`

**Interfaces:**
- Produces:
  - The `Job` union (all six members)
  - `type Progress = { phase: 'reading' | 'decoding' | 'encoding' | 'writing' } | { phase: 'page'; done: number; total: number }`
  - `Engine.ops: ReadonlySet<Job['op']>`
  - `Engine.run(job, onPhase)` — replaces `Engine.convert`
  - `engineForJob(job: Job): Engine | undefined` in the registry

- [ ] **Step 1: Write the failing test**

Create `tests/core/job-shape.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { engineForJob } from '../../src/engines/registry.js'
import type { DocumentInfo, ImageInfo, Job } from '../../src/core/types.js'

const image: ImageInfo = {
  kind: 'image', path: '/tmp/a.jpg', format: 'jpeg',
  bytes: 1, width: 1, height: 1, hasAlpha: false, frames: 1,
}
const doc: DocumentInfo = {
  kind: 'document', path: '/tmp/a.pdf', format: 'pdf',
  bytes: 1, pages: 7, encrypted: false,
}

describe('Job', () => {
  it('routes a convert job to the image engine', () => {
    const job: Job = {
      op: 'convert', sources: [image], outputs: ['/tmp/a.webp'],
      target: 'webp', options: { background: '#ffffff', keepMetadata: false },
    }
    expect(engineForJob(job)?.id).toBe('image')
  })

  it('routes a merge job to the pdf engine', () => {
    const job: Job = { op: 'merge', sources: [doc, doc], outputs: ['/tmp/out.pdf'] }
    expect(engineForJob(job)?.id).toBe('pdf')
  })

  it('routes a split job to the pdf engine', () => {
    const job: Job = {
      op: 'split', sources: [doc], outputs: ['/tmp/1.pdf', '/tmp/2.pdf'], cuts: [2],
    }
    expect(engineForJob(job)?.id).toBe('pdf')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/core/job-shape.test.ts`
Expected: FAIL — `engineForJob` is not exported

- [ ] **Step 3: Rewrite `Job` and add `Progress`**

In `src/core/types.ts`, replace the `Job` interface and the `Phase` type:

```ts
/**
 * One unit of work.
 *
 * A union rather than a widened `{sources[], outputs[]}` because arity is part
 * of what each operation means: only `merge` takes several sources, only
 * `split` and `extract` produce several outputs. Tuple types make that a
 * compile error rather than a convention.
 *
 * `cuts` are 0-based indices of the page *after which* a cut falls. `pages`
 * are 0-based page indices. Both are 1-based only in what the user sees.
 */
export type Job =
  | {
      op: 'convert'
      sources: [SourceInfo]
      outputs: [string]
      target: FormatId
      options: ConvertOptions
    }
  | { op: 'merge'; sources: SourceInfo[]; outputs: [string] }
  | { op: 'split'; sources: [DocumentInfo]; outputs: string[]; cuts: number[] }
  | {
      op: 'extract'
      sources: [DocumentInfo]
      outputs: string[]
      pages: number[]
      separate: boolean
    }
  | { op: 'delete'; sources: [DocumentInfo]; outputs: [string]; pages: number[] }
  | { op: 'rotate'; sources: [DocumentInfo]; outputs: [string]; turns: 1 | 2 | 3 }

/**
 * Where a job has got to.
 *
 * The `page` variant may only be emitted where the total is genuinely known
 * in advance. Spec §12 forbids fabricated progress, and a page count is real.
 */
export type Progress =
  | { phase: 'reading' | 'decoding' | 'encoding' | 'writing' }
  | { phase: 'page'; done: number; total: number }
```

Keep `export type Phase = 'reading' | 'decoding' | 'encoding' | 'writing'` as an alias so existing render code compiles; it is now `Progress`'s first variant.

- [ ] **Step 4: Update the Engine interface**

In `src/engines/types.ts`:

```ts
export interface Engine {
  id: string
  reads: ReadonlySet<FormatId>
  writes: ReadonlySet<FormatId>
  /** Which operations this engine implements. */
  ops: ReadonlySet<Job['op']>
  probe(path: string): Promise<SourceInfo>
  run(job: Job, onPhase: (progress: Progress) => void): Promise<Result>
}
```

- [ ] **Step 5: Update the image engine**

In `src/engines/image.ts`: add `ops: new Set<Job['op']>(['convert'])`, rename `convert` to `run`, and open the body with:

```ts
  async run(job, onPhase) {
    if (job.op !== 'convert') {
      throw new Error(`image engine cannot ${job.op}`)
    }
    const source = job.sources[0]
    const output = job.outputs[0]
    // ...the existing body, reading `source`, `output`, `job.target`, `job.options`
  },
```

- [ ] **Step 6: Add `engineForJob` to the registry**

In `src/engines/registry.ts`:

```ts
/**
 * The engine that runs a job. Convert routes by target format; every other
 * operation routes by op, because a page operation has no target format.
 */
export function engineForJob(job: Job): Engine | undefined {
  if (job.op === 'convert') return ENGINES.find((e) => e.writes.has(job.target))
  return ENGINES.find((e) => e.ops.has(job.op))
}
```

- [ ] **Step 7: Update `run.ts` and `plan.ts`**

In `src/core/run.ts`, replace `engineForTarget(job.target)` with `engineForJob(job)`, `engine.convert(...)` with `engine.run(...)`, `job.source.path` with `job.sources[0].path`, and the `no engine writes ${job.target}` message with `no engine runs ${job.op}`.

In `src/core/plan.ts`, build jobs in the new shape:

```ts
jobs.push({
  op: 'convert',
  sources: [source],
  outputs: [output],
  target,
  options,
})
```

- [ ] **Step 8: Let the compiler find the rest**

Run: `npm run typecheck`

Every remaining error is a `job.source` or `job.output` that should be `job.sources[0]` / `job.outputs[0]`, in `src/cli/report.ts`, `src/core/suggest.ts` and the shell. Fix each, plus the same substitution in existing tests.

- [ ] **Step 9: Run everything**

Run: `npm run lint && npm run typecheck && npm test`
Expected: PASS — the whole suite

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "refactor(core): Job becomes a union with explicit arity"
```

---

## Task 5: Output naming for page operations

**Files:**
- Modify: `src/core/output-path.ts`
- Test: `tests/core/output-path-pages.test.ts`

**Interfaces:**
- Produces:
  - `suffixedOutputPath(sourcePath: string, suffix: string): string` — `doc.pdf` + `trimmed` → `doc-trimmed.pdf`
  - `splitOutputPaths(sourcePath: string, count: number): string[]` — zero-padded
  - `extractOutputPaths(sourcePath: string, pages: number[], separate: boolean): string[]`
  - `mergeOutputPath(sourcePaths: string[]): string`

- [ ] **Step 1: Write the failing test**

Create `tests/core/output-path-pages.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  extractOutputPaths,
  mergeOutputPath,
  splitOutputPaths,
  suffixedOutputPath,
} from '../../src/core/output-path.js'

describe('suffixedOutputPath', () => {
  it('appends a suffix before the extension', () => {
    expect(suffixedOutputPath('/docs/report.pdf', 'trimmed')).toBe('/docs/report-trimmed.pdf')
  })

  it('leaves the directory alone', () => {
    expect(suffixedOutputPath('/a/b/c/report.pdf', 'rotated')).toBe('/a/b/c/report-rotated.pdf')
  })
})

describe('splitOutputPaths', () => {
  it('numbers the outputs from 1', () => {
    expect(splitOutputPaths('/docs/report.pdf', 3)).toEqual([
      '/docs/report-1.pdf',
      '/docs/report-2.pdf',
      '/docs/report-3.pdf',
    ])
  })

  it('zero-pads so a file listing sorts correctly', () => {
    const paths = splitOutputPaths('/docs/report.pdf', 12)
    expect(paths[0]).toBe('/docs/report-01.pdf')
    expect(paths[11]).toBe('/docs/report-12.pdf')
  })

  it('pads to three digits past a hundred', () => {
    const paths = splitOutputPaths('/docs/report.pdf', 248)
    expect(paths[0]).toBe('/docs/report-001.pdf')
    expect(paths[247]).toBe('/docs/report-248.pdf')
  })
})

describe('extractOutputPaths', () => {
  it('produces one file when not separating', () => {
    expect(extractOutputPaths('/docs/report.pdf', [2, 3, 11], false)).toEqual([
      '/docs/report-extract.pdf',
    ])
  })

  it('names separate files by 1-based page number, not sequence', () => {
    expect(extractOutputPaths('/docs/report.pdf', [2, 3, 11], true)).toEqual([
      '/docs/report-p3.pdf',
      '/docs/report-p4.pdf',
      '/docs/report-p12.pdf',
    ])
  })
})

describe('mergeOutputPath', () => {
  it('names the output after the folder the inputs share', () => {
    expect(
      mergeOutputPath(['/home/me/invoices/jan.pdf', '/home/me/invoices/feb.pdf']),
    ).toBe('/home/me/invoices/invoices-merged.pdf')
  })

  it('falls back to the first file when the inputs span folders', () => {
    expect(mergeOutputPath(['/home/me/a/jan.pdf', '/home/me/b/feb.pdf'])).toBe(
      '/home/me/a/jan-merged.pdf',
    )
  })

  it('handles a single input', () => {
    expect(mergeOutputPath(['/home/me/invoices/jan.pdf'])).toBe(
      '/home/me/invoices/invoices-merged.pdf',
    )
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/core/output-path-pages.test.ts`
Expected: FAIL — none of the four functions are exported

- [ ] **Step 3: Write the implementation**

Append to `src/core/output-path.ts`:

```ts
function stemAndExt(path: string): { dir: string; stem: string; ext: string } {
  const dir = resolve(path, '..')
  const name = basename(path)
  const ext = extname(name)
  return { dir, stem: ext ? name.slice(0, -ext.length) : name, ext: ext || '.pdf' }
}

/** `report.pdf` + `trimmed` → `report-trimmed.pdf`, beside the source. */
export function suffixedOutputPath(sourcePath: string, suffix: string): string {
  const { dir, stem, ext } = stemAndExt(resolve(sourcePath))
  return join(dir, `${stem}-${suffix}${ext}`)
}

/**
 * Numbered outputs for a split.
 *
 * Zero-padded to the width of the count, so `-01`…`-12` sorts the way anyone
 * looking at the folder expects. Unpadded numbers put `-10` before `-2`.
 */
export function splitOutputPaths(sourcePath: string, count: number): string[] {
  const { dir, stem, ext } = stemAndExt(resolve(sourcePath))
  const width = String(count).length
  return Array.from({ length: count }, (_, i) =>
    join(dir, `${stem}-${String(i + 1).padStart(width, '0')}${ext}`),
  )
}

/**
 * Outputs for an extract.
 *
 * Separate files are named by 1-based page number rather than sequence, so
 * the name says where the page came from — `report-p12.pdf` is page 12, not
 * the twelfth file.
 */
export function extractOutputPaths(
  sourcePath: string,
  pages: number[],
  separate: boolean,
): string[] {
  if (!separate) return [suffixedOutputPath(sourcePath, 'extract')]
  const { dir, stem, ext } = stemAndExt(resolve(sourcePath))
  return pages.map((p) => join(dir, `${stem}-p${p + 1}${ext}`))
}

/**
 * The output for a merge.
 *
 * Every other operation derives its name from its one source; merge has none.
 * The common parent folder is the best available answer — `~/invoices/*.pdf`
 * becomes `invoices-merged.pdf` in that folder. When the inputs span folders
 * there is no shared name worth using, so it falls back to the first file.
 */
export function mergeOutputPath(sourcePaths: string[]): string {
  const first = resolve(sourcePaths[0] ?? 'merged.pdf')
  const dirs = new Set(sourcePaths.map((p) => resolve(p, '..')))
  if (dirs.size === 1) {
    const dir = resolve(first, '..')
    return join(dir, `${basename(dir)}-merged.pdf`)
  }
  return suffixedOutputPath(first, 'merged')
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/core/output-path-pages.test.ts`
Expected: PASS — 10 tests

- [ ] **Step 5: Lint, typecheck, commit**

```bash
npm run lint && npm run typecheck && npm test
git add src/core/output-path.ts tests/core/output-path-pages.test.ts
git commit -m "feat(core): output naming for page operations"
```

---

## Task 6: Merge

**Files:**
- Modify: `src/engines/pdf.ts`
- Test: `tests/engines/pdf-merge.test.ts`

**Interfaces:**
- Consumes: `makeStampedPdf`, `pdfPageLabels`, `pdfPageCount` (Task 3)
- Produces: `pdfEngine.run` handling `op: 'merge'`; a shared `writeAtomic(path, bytes)` helper inside `pdf.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/engines/pdf-merge.test.ts`:

```ts
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { pdfEngine } from '../../src/engines/pdf.js'
import { probe } from '../../src/engines/registry.js'
import type { DocumentInfo, Job } from '../../src/core/types.js'
import { makeStampedPdf, makeTempDir, pdfPageCount, pdfPageLabels } from '../helpers/fixtures.js'

async function doc(path: string): Promise<DocumentInfo> {
  const info = await probe(path)
  if (info.kind !== 'document') throw new Error('expected a document')
  return info
}

describe('merge', () => {
  it('produces one document whose page count is the sum', async () => {
    const dir = await makeTempDir()
    const a = await makeStampedPdf(dir, 'a.pdf', ['A1', 'A2', 'A3'])
    const b = await makeStampedPdf(dir, 'b.pdf', ['B1', 'B2'])
    const out = join(dir, 'out.pdf')
    const job: Job = { op: 'merge', sources: [await doc(a), await doc(b)], outputs: [out] }

    const result = await pdfEngine.run(job, () => {})

    expect(await pdfPageCount(out)).toBe(5)
    expect(result.outputBytes).toBeGreaterThan(0)
  })

  it('keeps the pages in the order the sources were given', async () => {
    const dir = await makeTempDir()
    const a = await makeStampedPdf(dir, 'a.pdf', ['A1', 'A2'])
    const b = await makeStampedPdf(dir, 'b.pdf', ['B1'])
    const out = join(dir, 'out.pdf')
    const job: Job = { op: 'merge', sources: [await doc(b), await doc(a)], outputs: [out] }

    await pdfEngine.run(job, () => {})

    // b first, because that is the order the job listed them.
    expect(await pdfPageLabels(out)).toEqual(['B1', 'A1', 'A2'])
  })

  it('merges a single document into a copy', async () => {
    const dir = await makeTempDir()
    const a = await makeStampedPdf(dir, 'a.pdf', ['A1', 'A2'])
    const out = join(dir, 'out.pdf')
    await pdfEngine.run({ op: 'merge', sources: [await doc(a)], outputs: [out] }, () => {})
    expect(await pdfPageLabels(out)).toEqual(['A1', 'A2'])
  })

  it('reports each source as it is read', async () => {
    const dir = await makeTempDir()
    const a = await makeStampedPdf(dir, 'a.pdf', ['A1'])
    const b = await makeStampedPdf(dir, 'b.pdf', ['B1'])
    const out = join(dir, 'out.pdf')
    const seen: string[] = []
    await pdfEngine.run(
      { op: 'merge', sources: [await doc(a), await doc(b)], outputs: [out] },
      (p) => seen.push(p.phase),
    )
    expect(seen).toContain('reading')
    expect(seen).toContain('writing')
  })

  it('refuses an encrypted source with a message that names the fix', async () => {
    const dir = await makeTempDir()
    const a = await makeStampedPdf(dir, 'a.pdf', ['A1'])
    const info = await doc(a)
    const encrypted: DocumentInfo = { ...info, encrypted: true }
    const out = join(dir, 'out.pdf')
    await expect(
      pdfEngine.run({ op: 'merge', sources: [encrypted], outputs: [out] }, () => {}),
    ).rejects.toThrow(/password/i)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/engines/pdf-merge.test.ts`
Expected: FAIL — `not implemented until task 6`

- [ ] **Step 3: Add the encrypted-source error**

In `src/core/errors.ts`, add `'encrypted-source'` to `ErrorCode` and:

```ts
export function encryptedSource(path: string): ForgeError {
  return new ForgeError({
    code: 'encrypted-source',
    title: 'This PDF is password-protected',
    detail: `${basename(path)} cannot be changed until it is unlocked.`,
    hint: 'Remove the password first, then try again.',
  })
}
```

- [ ] **Step 4: Implement merge**

In `src/engines/pdf.ts`, add the imports and helpers, then the `run` body:

```ts
import { randomBytes } from 'node:crypto'
import { rename, rm, writeFile } from 'node:fs/promises'
import { encryptedSource } from '../core/errors.js'

/** Invariant 6: temp file, then rename. Never a partial file at the real path. */
async function writeAtomic(path: string, bytes: Uint8Array): Promise<number> {
  const temp = `${path}.${randomBytes(6).toString('hex')}.tmp`
  try {
    await writeFile(temp, bytes)
    await rename(temp, path)
    return bytes.byteLength
  } catch (e) {
    await rm(temp, { force: true })
    throw e
  }
}

function assertUnencrypted(sources: readonly { path: string; encrypted?: boolean }[]): void {
  for (const s of sources) {
    if (s.encrypted) throw encryptedSource(s.path)
  }
}

async function merge(job: Extract<Job, { op: 'merge' }>, onPhase: (p: Progress) => void) {
  assertUnencrypted(job.sources.filter((s) => s.kind === 'document'))
  const out = await PDFDocument.create()

  for (const source of job.sources) {
    onPhase({ phase: 'reading' })
    const src = await load(source.path)
    const pages = await out.copyPages(src, src.getPageIndices())
    for (const page of pages) out.addPage(page)
  }

  onPhase({ phase: 'writing' })
  const bytes = await out.save()
  const outputBytes = await writeAtomic(job.outputs[0], bytes)
  return { job, outputBytes, warnings: [] }
}
```

Replace the stub `run` with a dispatcher:

```ts
  async run(job: Job, onPhase: (p: Progress) => void): Promise<Result> {
    switch (job.op) {
      case 'merge':
        return merge(job, onPhase)
      default:
        throw new Error(`pdf engine cannot ${job.op}`)
    }
  },
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run tests/engines/pdf-merge.test.ts`
Expected: PASS — 5 tests

- [ ] **Step 6: Lint, typecheck, commit**

```bash
npm run lint && npm run typecheck && npm test
git add -A
git commit -m "feat(engines): pdf merge"
```

---

## Task 7: Split

**Files:**
- Modify: `src/engines/pdf.ts`
- Test: `tests/engines/pdf-split.test.ts`

**Interfaces:**
- Consumes: `cutsToRanges` (Task 1), `writeAtomic` (Task 6)
- Produces: `pdfEngine.run` handling `op: 'split'`

- [ ] **Step 1: Write the failing test**

Create `tests/engines/pdf-split.test.ts`:

```ts
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { pdfEngine } from '../../src/engines/pdf.js'
import { probe } from '../../src/engines/registry.js'
import type { DocumentInfo, Job } from '../../src/core/types.js'
import { makeStampedPdf, makeTempDir, pdfPageLabels } from '../helpers/fixtures.js'

async function doc(path: string): Promise<DocumentInfo> {
  const info = await probe(path)
  if (info.kind !== 'document') throw new Error('expected a document')
  return info
}

const LABELS = ['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7']

describe('split', () => {
  it('partitions the document at the cut points', async () => {
    const dir = await makeTempDir()
    const src = await makeStampedPdf(dir, 'doc.pdf', LABELS)
    const outputs = [join(dir, 'o1.pdf'), join(dir, 'o2.pdf'), join(dir, 'o3.pdf')]
    const job: Job = { op: 'split', sources: [await doc(src)], outputs, cuts: [0, 3] }

    await pdfEngine.run(job, () => {})

    expect(await pdfPageLabels(outputs[0] as string)).toEqual(['P1'])
    expect(await pdfPageLabels(outputs[1] as string)).toEqual(['P2', 'P3', 'P4'])
    expect(await pdfPageLabels(outputs[2] as string)).toEqual(['P5', 'P6', 'P7'])
  })

  it('loses no page and duplicates none', async () => {
    const dir = await makeTempDir()
    const src = await makeStampedPdf(dir, 'doc.pdf', LABELS)
    const outputs = [join(dir, 'o1.pdf'), join(dir, 'o2.pdf')]
    await pdfEngine.run(
      { op: 'split', sources: [await doc(src)], outputs, cuts: [2] },
      () => {},
    )
    const all = [
      ...(await pdfPageLabels(outputs[0] as string)),
      ...(await pdfPageLabels(outputs[1] as string)),
    ]
    expect(all).toEqual(LABELS)
  })

  it('splits into single pages when every gap is cut', async () => {
    const dir = await makeTempDir()
    const src = await makeStampedPdf(dir, 'doc.pdf', LABELS)
    const outputs = LABELS.map((_, i) => join(dir, `o${i}.pdf`))
    await pdfEngine.run(
      { op: 'split', sources: [await doc(src)], outputs, cuts: [0, 1, 2, 3, 4, 5] },
      () => {},
    )
    for (const [i, label] of LABELS.entries()) {
      expect(await pdfPageLabels(outputs[i] as string)).toEqual([label])
    }
  })

  it('reports real per-page progress', async () => {
    const dir = await makeTempDir()
    const src = await makeStampedPdf(dir, 'doc.pdf', LABELS)
    const outputs = [join(dir, 'o1.pdf'), join(dir, 'o2.pdf')]
    const totals: number[] = []
    await pdfEngine.run(
      { op: 'split', sources: [await doc(src)], outputs, cuts: [2] },
      (p) => { if (p.phase === 'page') totals.push(p.done) },
    )
    expect(totals).toEqual([1, 2])
  })

  it('leaves nothing behind when an output cannot be written', async () => {
    const dir = await makeTempDir()
    const src = await makeStampedPdf(dir, 'doc.pdf', LABELS)
    const outputs = [join(dir, 'o1.pdf'), join(dir, 'nope', 'o2.pdf')]
    await expect(
      pdfEngine.run({ op: 'split', sources: [await doc(src)], outputs, cuts: [2] }, () => {}),
    ).rejects.toThrow()
    expect(await readdir(dir)).toEqual(['doc.pdf'])
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/engines/pdf-split.test.ts`
Expected: FAIL — `pdf engine cannot split`

- [ ] **Step 3: Implement split**

Add to `src/engines/pdf.ts`:

```ts
import { cutsToRanges } from '../core/pages.js'

async function split(job: Extract<Job, { op: 'split' }>, onPhase: (p: Progress) => void) {
  const source = job.sources[0]
  assertUnencrypted([source])

  onPhase({ phase: 'reading' })
  const src = await load(source.path)
  const ranges = cutsToRanges(job.cuts, src.getPageCount())

  // Every output is written before any is kept. A split that fails half way
  // through must not leave a folder of partial results (invariant 6).
  const written: string[] = []
  let outputBytes = 0
  try {
    for (const [i, range] of ranges.entries()) {
      const out = await PDFDocument.create()
      const indices = Array.from({ length: range.to - range.from + 1 }, (_, n) => range.from + n)
      const pages = await out.copyPages(src, indices)
      for (const page of pages) out.addPage(page)

      const path = job.outputs[i]
      if (path === undefined) throw new Error(`split produced ${ranges.length} parts but was given ${job.outputs.length} outputs`)
      outputBytes += await writeAtomic(path, await out.save())
      written.push(path)
      onPhase({ phase: 'page', done: i + 1, total: ranges.length })
    }
  } catch (e) {
    await Promise.all(written.map((p) => rm(p, { force: true })))
    throw e
  }

  return { job, outputBytes, warnings: [] }
}
```

Add `case 'split': return split(job, onPhase)` to the dispatcher.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/engines/pdf-split.test.ts`
Expected: PASS — 5 tests

- [ ] **Step 5: Lint, typecheck, commit**

```bash
npm run lint && npm run typecheck && npm test
git add -A
git commit -m "feat(engines): pdf split with all-or-nothing outputs"
```

---

## Task 8: Extract and delete

**Files:**
- Modify: `src/engines/pdf.ts`, `src/core/errors.ts`
- Test: `tests/engines/pdf-extract.test.ts`

**Interfaces:**
- Produces: `pdfEngine.run` handling `op: 'extract'` and `op: 'delete'`; `emptySelection(detail: string): ForgeError`

- [ ] **Step 1: Write the failing test**

Create `tests/engines/pdf-extract.test.ts`:

```ts
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { pdfEngine } from '../../src/engines/pdf.js'
import { probe } from '../../src/engines/registry.js'
import type { DocumentInfo, Job } from '../../src/core/types.js'
import { makeStampedPdf, makeTempDir, pdfPageLabels } from '../helpers/fixtures.js'

async function doc(path: string): Promise<DocumentInfo> {
  const info = await probe(path)
  if (info.kind !== 'document') throw new Error('expected a document')
  return info
}

const LABELS = ['P1', 'P2', 'P3', 'P4', 'P5']

describe('extract', () => {
  it('keeps only the selected pages, in document order', async () => {
    const dir = await makeTempDir()
    const src = await makeStampedPdf(dir, 'doc.pdf', LABELS)
    const out = join(dir, 'out.pdf')
    const job: Job = {
      op: 'extract', sources: [await doc(src)], outputs: [out],
      pages: [0, 2, 4], separate: false,
    }
    await pdfEngine.run(job, () => {})
    expect(await pdfPageLabels(out)).toEqual(['P1', 'P3', 'P5'])
  })

  it('writes one file per page when separating', async () => {
    const dir = await makeTempDir()
    const src = await makeStampedPdf(dir, 'doc.pdf', LABELS)
    const outputs = [join(dir, 'a.pdf'), join(dir, 'b.pdf')]
    const job: Job = {
      op: 'extract', sources: [await doc(src)], outputs, pages: [1, 3], separate: true,
    }
    await pdfEngine.run(job, () => {})
    expect(await pdfPageLabels(outputs[0] as string)).toEqual(['P2'])
    expect(await pdfPageLabels(outputs[1] as string)).toEqual(['P4'])
  })

  it('refuses an empty selection rather than writing an empty document', async () => {
    const dir = await makeTempDir()
    const src = await makeStampedPdf(dir, 'doc.pdf', LABELS)
    const job: Job = {
      op: 'extract', sources: [await doc(src)], outputs: [join(dir, 'out.pdf')],
      pages: [], separate: false,
    }
    await expect(pdfEngine.run(job, () => {})).rejects.toThrow(/no pages/i)
  })
})

describe('delete', () => {
  it('keeps everything except the selected pages', async () => {
    const dir = await makeTempDir()
    const src = await makeStampedPdf(dir, 'doc.pdf', LABELS)
    const out = join(dir, 'out.pdf')
    const job: Job = {
      op: 'delete', sources: [await doc(src)], outputs: [out], pages: [1, 3],
    }
    await pdfEngine.run(job, () => {})
    expect(await pdfPageLabels(out)).toEqual(['P1', 'P3', 'P5'])
  })

  it('is the exact inverse of extract', async () => {
    const dir = await makeTempDir()
    const src = await makeStampedPdf(dir, 'doc.pdf', LABELS)
    const kept = join(dir, 'kept.pdf')
    const dropped = join(dir, 'dropped.pdf')
    const pages = [0, 3]
    const info = await doc(src)
    await pdfEngine.run(
      { op: 'extract', sources: [info], outputs: [kept], pages, separate: false }, () => {},
    )
    await pdfEngine.run({ op: 'delete', sources: [info], outputs: [dropped], pages }, () => {})

    const a = await pdfPageLabels(kept)
    const b = await pdfPageLabels(dropped)
    expect([...a, ...b].sort()).toEqual([...LABELS].sort())
    expect(a.filter((l) => b.includes(l))).toEqual([])
  })

  it('refuses to delete every page', async () => {
    const dir = await makeTempDir()
    const src = await makeStampedPdf(dir, 'doc.pdf', LABELS)
    const job: Job = {
      op: 'delete', sources: [await doc(src)], outputs: [join(dir, 'out.pdf')],
      pages: [0, 1, 2, 3, 4],
    }
    await expect(pdfEngine.run(job, () => {})).rejects.toThrow(/every page/i)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/engines/pdf-extract.test.ts`
Expected: FAIL — `pdf engine cannot extract`

- [ ] **Step 3: Add the empty-selection error**

In `src/core/errors.ts`, add `'empty-selection'` to `ErrorCode` and:

```ts
export function emptySelection(detail: string): ForgeError {
  return new ForgeError({
    code: 'empty-selection',
    title: 'Nothing to write',
    detail,
    hint: 'Select at least one page to keep.',
  })
}
```

- [ ] **Step 4: Implement both operations**

Add to `src/engines/pdf.ts`:

```ts
import { emptySelection } from '../core/errors.js'

/** Copy an explicit page list into a new document, in the order given. */
async function pagesInto(src: PDFDocument, indices: number[]): Promise<Uint8Array> {
  const out = await PDFDocument.create()
  const pages = await out.copyPages(src, indices)
  for (const page of pages) out.addPage(page)
  return out.save()
}

async function extract(job: Extract<Job, { op: 'extract' }>, onPhase: (p: Progress) => void) {
  const source = job.sources[0]
  assertUnencrypted([source])
  if (job.pages.length === 0) {
    throw emptySelection('That extract selects no pages.')
  }

  onPhase({ phase: 'reading' })
  const src = await load(source.path)
  const wanted = [...new Set(job.pages)].sort((a, b) => a - b)

  const written: string[] = []
  let outputBytes = 0
  try {
    if (!job.separate) {
      onPhase({ phase: 'writing' })
      const path = job.outputs[0] as string
      outputBytes = await writeAtomic(path, await pagesInto(src, wanted))
      written.push(path)
    } else {
      for (const [i, page] of wanted.entries()) {
        const path = job.outputs[i] as string
        outputBytes += await writeAtomic(path, await pagesInto(src, [page]))
        written.push(path)
        onPhase({ phase: 'page', done: i + 1, total: wanted.length })
      }
    }
  } catch (e) {
    await Promise.all(written.map((p) => rm(p, { force: true })))
    throw e
  }

  return { job, outputBytes, warnings: [] }
}

async function deletePages(job: Extract<Job, { op: 'delete' }>, onPhase: (p: Progress) => void) {
  const source = job.sources[0]
  assertUnencrypted([source])

  onPhase({ phase: 'reading' })
  const src = await load(source.path)
  const drop = new Set(job.pages)
  const keep = src.getPageIndices().filter((i) => !drop.has(i))
  if (keep.length === 0) {
    throw emptySelection('That would delete every page.')
  }

  onPhase({ phase: 'writing' })
  const outputBytes = await writeAtomic(job.outputs[0], await pagesInto(src, keep))
  return { job, outputBytes, warnings: [] }
}
```

Add `case 'extract': return extract(job, onPhase)` and `case 'delete': return deletePages(job, onPhase)` to the dispatcher.

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run tests/engines/pdf-extract.test.ts`
Expected: PASS — 6 tests

- [ ] **Step 6: Lint, typecheck, commit**

```bash
npm run lint && npm run typecheck && npm test
git add -A
git commit -m "feat(engines): pdf extract and delete"
```

---

## Task 9: Rotate — additively

**Files:**
- Modify: `src/engines/pdf.ts`
- Test: `tests/engines/pdf-rotate.test.ts`

**Interfaces:**
- Produces: `pdfEngine.run` handling `op: 'rotate'`

**Note:** The additive test is the one that matters. A naive `setRotation(degrees(90))` passes every other rotate test and silently discards a document's existing rotation — the PDF equivalent of ignoring EXIF orientation, which the project already treats as a load-bearing bug.

- [ ] **Step 1: Write the failing test**

Create `tests/engines/pdf-rotate.test.ts`:

```ts
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { PDFDocument, degrees } from 'pdf-lib'
import { describe, expect, it } from 'vitest'
import { pdfEngine } from '../../src/engines/pdf.js'
import { probe } from '../../src/engines/registry.js'
import type { DocumentInfo, Job } from '../../src/core/types.js'
import { makeStampedPdf, makeTempDir } from '../helpers/fixtures.js'

async function doc(path: string): Promise<DocumentInfo> {
  const info = await probe(path)
  if (info.kind !== 'document') throw new Error('expected a document')
  return info
}

async function rotations(path: string): Promise<number[]> {
  const d = await PDFDocument.load(await readFile(path))
  return d.getPages().map((p) => p.getRotation().angle)
}

async function preRotated(dir: string, name: string, angle: number): Promise<string> {
  const path = await makeStampedPdf(dir, name, ['P1', 'P2'])
  const d = await PDFDocument.load(await readFile(path))
  for (const p of d.getPages()) p.setRotation(degrees(angle))
  const { writeFile } = await import('node:fs/promises')
  await writeFile(path, await d.save())
  return path
}

describe('rotate', () => {
  it('turns every page by a quarter turn', async () => {
    const dir = await makeTempDir()
    const src = await makeStampedPdf(dir, 'doc.pdf', ['P1', 'P2'])
    const out = join(dir, 'out.pdf')
    const job: Job = { op: 'rotate', sources: [await doc(src)], outputs: [out], turns: 1 }
    await pdfEngine.run(job, () => {})
    expect(await rotations(out)).toEqual([90, 90])
  })

  it('adds to an existing rotation rather than replacing it', async () => {
    const dir = await makeTempDir()
    const src = await preRotated(dir, 'doc.pdf', 90)
    const out = join(dir, 'out.pdf')
    const job: Job = { op: 'rotate', sources: [await doc(src)], outputs: [out], turns: 1 }
    await pdfEngine.run(job, () => {})
    expect(await rotations(out)).toEqual([180, 180])
  })

  it('wraps past a full turn', async () => {
    const dir = await makeTempDir()
    const src = await preRotated(dir, 'doc.pdf', 270)
    const out = join(dir, 'out.pdf')
    const job: Job = { op: 'rotate', sources: [await doc(src)], outputs: [out], turns: 2 }
    await pdfEngine.run(job, () => {})
    expect(await rotations(out)).toEqual([90, 90])
  })

  it('handles three-quarter turns', async () => {
    const dir = await makeTempDir()
    const src = await makeStampedPdf(dir, 'doc.pdf', ['P1'])
    const out = join(dir, 'out.pdf')
    const job: Job = { op: 'rotate', sources: [await doc(src)], outputs: [out], turns: 3 }
    await pdfEngine.run(job, () => {})
    expect(await rotations(out)).toEqual([270])
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/engines/pdf-rotate.test.ts`
Expected: FAIL — `pdf engine cannot rotate`

- [ ] **Step 3: Implement rotate**

Add to `src/engines/pdf.ts`:

```ts
import { degrees } from 'pdf-lib'

/**
 * Rotation is *additive*.
 *
 * A page already at 90° rotated by another quarter turn must land at 180°.
 * Setting the angle absolutely would silently discard a rotation the document
 * already carried — the same class of bug as ignoring EXIF orientation, which
 * this project treats as load-bearing.
 */
async function rotate(job: Extract<Job, { op: 'rotate' }>, onPhase: (p: Progress) => void) {
  const source = job.sources[0]
  assertUnencrypted([source])

  onPhase({ phase: 'reading' })
  const doc = await load(source.path)
  for (const page of doc.getPages()) {
    const next = (page.getRotation().angle + job.turns * 90) % 360
    page.setRotation(degrees(next))
  }

  onPhase({ phase: 'writing' })
  const outputBytes = await writeAtomic(job.outputs[0], await doc.save())
  return { job, outputBytes, warnings: [] }
}
```

Add `case 'rotate': return rotate(job, onPhase)` to the dispatcher, and remove the `default` throw's unreachable branches by keeping it as the exhaustiveness guard.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/engines/pdf-rotate.test.ts`
Expected: PASS — 4 tests

- [ ] **Step 5: Lint, typecheck, commit**

```bash
npm run lint && npm run typecheck && npm test
git add -A
git commit -m "feat(engines): pdf rotate, additive to existing page rotation"
```

---

## Task 10: The page actions

**Files:**
- Create: `src/core/actions/merge.ts`, `src/core/actions/split.ts`, `src/core/actions/extract.ts`, `src/core/actions/rotate.ts`
- Modify: `src/core/actions/index.ts`, `src/core/actions/convert.ts`, `src/core/actions/compress.ts`
- Test: `tests/core/actions-pages.test.ts`

**Interfaces:**
- Produces:
  - `Action.appliesTo(sources: SourceInfo[]): boolean` — replaces the single-source signature
  - `Action.plan(sources: SourceInfo[], values: Record<string, unknown>): Job[]`
  - `mergeAction`, `splitAction`, `extractAction`, `deleteAction`, `rotateAction`
  - `actionsFor(sources: SourceInfo[]): Action[]`
  - `unavailableReason(action: Action, sources: SourceInfo[]): string | undefined` — the dimmed row's margin text

- [ ] **Step 1: Write the failing test**

Create `tests/core/actions-pages.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  actionsFor, deleteAction, extractAction, mergeAction, rotateAction,
  splitAction, unavailableReason,
} from '../../src/core/actions/index.js'
import type { DocumentInfo, ImageInfo } from '../../src/core/types.js'

const doc = (path: string, pages = 7): DocumentInfo => ({
  kind: 'document', path, format: 'pdf', bytes: 1000, pages, encrypted: false,
})
const image: ImageInfo = {
  kind: 'image', path: '/tmp/a.jpg', format: 'jpeg',
  bytes: 1, width: 1, height: 1, hasAlpha: false, frames: 1,
}

describe('appliesTo', () => {
  it('offers merge only when two or more documents are staged', () => {
    expect(mergeAction.appliesTo([doc('/a.pdf')])).toBe(false)
    expect(mergeAction.appliesTo([doc('/a.pdf'), doc('/b.pdf')])).toBe(true)
  })

  it('explains why merge is unavailable', () => {
    expect(unavailableReason(mergeAction, [doc('/a.pdf')])).toBe('needs 2+ files')
  })

  it('offers the single-document operations on exactly one document', () => {
    for (const action of [splitAction, extractAction, deleteAction, rotateAction]) {
      expect(action.appliesTo([doc('/a.pdf')])).toBe(true)
      expect(action.appliesTo([doc('/a.pdf'), doc('/b.pdf')])).toBe(false)
    }
  })

  it('offers no page operation on an image', () => {
    expect(actionsFor([image]).map((a) => a.id)).not.toContain('split')
  })

  it('does not offer split on a one-page document', () => {
    expect(splitAction.appliesTo([doc('/a.pdf', 1)])).toBe(false)
    expect(unavailableReason(splitAction, [doc('/a.pdf', 1)])).toBe('only one page')
  })
})

describe('plan', () => {
  it('builds a merge job in the staged order', () => {
    const sources = [doc('/inv/jan.pdf'), doc('/inv/feb.pdf')]
    const [job] = mergeAction.plan(sources, {})
    expect(job?.op).toBe('merge')
    expect(job?.sources.map((s) => s.path)).toEqual(['/inv/jan.pdf', '/inv/feb.pdf'])
    expect(job?.outputs).toEqual(['/inv/inv-merged.pdf'])
  })

  it('builds a split job with one output per part', () => {
    const [job] = splitAction.plan([doc('/docs/report.pdf')], { cuts: [0, 3] })
    expect(job?.op).toBe('split')
    expect(job?.outputs).toEqual([
      '/docs/report-1.pdf', '/docs/report-2.pdf', '/docs/report-3.pdf',
    ])
  })

  it('builds an extract job from a typed range', () => {
    const [job] = extractAction.plan([doc('/docs/report.pdf')], {
      pages: '1-3', separate: false,
    })
    expect(job?.op).toBe('extract')
    if (job?.op !== 'extract') throw new Error('expected extract')
    expect(job.pages).toEqual([0, 1, 2])
    expect(job.outputs).toEqual(['/docs/report-extract.pdf'])
  })

  it('builds a rotate job from a degree value', () => {
    const [job] = rotateAction.plan([doc('/docs/report.pdf')], { degrees: 180 })
    expect(job?.op).toBe('rotate')
    if (job?.op !== 'rotate') throw new Error('expected rotate')
    expect(job.turns).toBe(2)
    expect(job.outputs).toEqual(['/docs/report-rotated.pdf'])
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/core/actions-pages.test.ts`
Expected: FAIL — `mergeAction` is not exported

- [ ] **Step 3: Widen the Action interface**

In `src/core/actions/index.ts`:

```ts
export interface Action {
  id: string
  label: string
  hint: string
  /**
   * Whether this action can run against the staged list.
   *
   * Takes the list rather than one source because merge is defined by having
   * several, and because the hub dims what does not apply rather than hiding
   * it — which needs an answer for every action on every stage.
   */
  appliesTo(sources: SourceInfo[]): boolean
  /** Why `appliesTo` said no, in three words for the hub's right margin. */
  unavailable?(sources: SourceInfo[]): string | undefined
  options(
    sources: SourceInfo[],
    values: Record<string, unknown>,
    prefs: Preferences,
  ): OptionSpec[]
  plan(sources: SourceInfo[], values: Record<string, unknown>): Job[]
}

export function actionsFor(sources: SourceInfo[]): Action[] {
  return ACTIONS.filter((a) => a.appliesTo(sources))
}

export function unavailableReason(action: Action, sources: SourceInfo[]): string | undefined {
  return action.appliesTo(sources) ? undefined : action.unavailable?.(sources)
}
```

Update `convertAction` and `compressAction` to the list signature: each takes `sources`, uses `sources[0]`, and its `appliesTo` returns `sources.length === 1 && sources[0]?.kind === 'image'` for compress, `sources.length >= 1` for convert.

- [ ] **Step 4: Write the page actions**

Create `src/core/actions/merge.ts`:

```ts
import { mergeOutputPath } from '../output-path.js'
import type { Job, SourceInfo } from '../types.js'
import type { Action } from './index.js'

const documents = (sources: SourceInfo[]) => sources.filter((s) => s.kind === 'document')

export const mergeAction: Action = {
  id: 'merge',
  label: 'Merge',
  hint: 'several files into one',
  appliesTo: (sources) => documents(sources).length >= 2 && documents(sources).length === sources.length,
  unavailable: (sources) =>
    documents(sources).length !== sources.length ? 'PDFs only' : 'needs 2+ files',
  options: () => [],
  plan(sources): Job[] {
    return [{ op: 'merge', sources, outputs: [mergeOutputPath(sources.map((s) => s.path))] }]
  },
}
```

Create `src/core/actions/split.ts`:

```ts
import { cutsToRanges } from '../pages.js'
import { splitOutputPaths } from '../output-path.js'
import type { DocumentInfo, Job, SourceInfo } from '../types.js'
import type { Action, OptionSpec } from './index.js'

const soleDocument = (sources: SourceInfo[]): DocumentInfo | undefined =>
  sources.length === 1 && sources[0]?.kind === 'document' ? sources[0] : undefined

export const splitAction: Action = {
  id: 'split',
  label: 'Split',
  hint: 'into several files',
  appliesTo: (sources) => (soleDocument(sources)?.pages ?? 0) > 1,
  unavailable: (sources) =>
    soleDocument(sources) === undefined ? 'one PDF at a time' : 'only one page',
  options(sources): OptionSpec[] {
    const doc = soleDocument(sources)
    if (!doc) return []
    return [
      {
        kind: 'select',
        id: 'mode',
        label: 'How',
        default: 'every-page',
        choices: [
          { value: 'every-page', label: 'Every page', hint: `${doc.pages} files` },
          { value: 'every-n', label: 'Every N pages', hint: 'ask how many' },
          { value: 'points', label: 'At points I choose', hint: 'grid' },
        ],
      },
    ]
  },
  plan(sources, values): Job[] {
    const doc = soleDocument(sources)
    if (!doc) return []
    const cuts = Array.isArray(values.cuts) ? (values.cuts as number[]) : []
    const parts = cutsToRanges(cuts, doc.pages).length
    return [
      { op: 'split', sources: [doc], outputs: splitOutputPaths(doc.path, parts), cuts },
    ]
  },
}

/** Cuts after every page — what "every page" means. */
export function everyPageCuts(pages: number): number[] {
  return Array.from({ length: Math.max(0, pages - 1) }, (_, i) => i)
}

/** Cuts every `n` pages, so a 25-page document at n=10 gives 10, 10, 5. */
export function everyNCuts(pages: number, n: number): number[] {
  const cuts: number[] = []
  for (let p = n; p < pages; p += n) cuts.push(p - 1)
  return cuts
}
```

Create `src/core/actions/extract.ts` — extract and delete together, because they are inverses:

```ts
import { parseRanges } from '../pages.js'
import { extractOutputPaths, suffixedOutputPath } from '../output-path.js'
import type { DocumentInfo, Job, SourceInfo } from '../types.js'
import type { Action, OptionSpec } from './index.js'

const soleDocument = (sources: SourceInfo[]): DocumentInfo | undefined =>
  sources.length === 1 && sources[0]?.kind === 'document' ? sources[0] : undefined

function selectedPages(doc: DocumentInfo, values: Record<string, unknown>): number[] {
  if (Array.isArray(values.pages)) return values.pages as number[]
  if (typeof values.pages === 'string') return parseRanges(values.pages, doc.pages)
  return []
}

const pagesOption = (doc: DocumentInfo): OptionSpec => ({
  kind: 'text',
  id: 'pages',
  label: 'Pages',
  placeholder: `1-${doc.pages}`,
})

export const extractAction: Action = {
  id: 'extract',
  label: 'Extract',
  hint: 'keep only some pages',
  appliesTo: (sources) => soleDocument(sources) !== undefined,
  unavailable: () => 'one PDF at a time',
  options: (sources) => {
    const doc = soleDocument(sources)
    if (!doc) return []
    return [
      pagesOption(doc),
      {
        kind: 'select',
        id: 'separate',
        label: 'Output',
        default: 'one',
        choices: [
          { value: 'one', label: 'One file', hint: 'all selected pages together' },
          { value: 'many', label: 'Separate files', hint: 'one per page' },
        ],
      },
    ]
  },
  plan(sources, values): Job[] {
    const doc = soleDocument(sources)
    if (!doc) return []
    const pages = selectedPages(doc, values)
    const separate = values.separate === 'many'
    return [
      {
        op: 'extract',
        sources: [doc],
        outputs: extractOutputPaths(doc.path, pages, separate),
        pages,
        separate,
      },
    ]
  },
}

export const deleteAction: Action = {
  id: 'delete',
  label: 'Delete',
  hint: 'drop some pages',
  appliesTo: (sources) => soleDocument(sources) !== undefined,
  unavailable: () => 'one PDF at a time',
  options: (sources) => {
    const doc = soleDocument(sources)
    return doc ? [pagesOption(doc)] : []
  },
  plan(sources, values): Job[] {
    const doc = soleDocument(sources)
    if (!doc) return []
    return [
      {
        op: 'delete',
        sources: [doc],
        outputs: [suffixedOutputPath(doc.path, 'trimmed')],
        pages: selectedPages(doc, values),
      },
    ]
  },
}
```

Create `src/core/actions/rotate.ts`:

```ts
import { suffixedOutputPath } from '../output-path.js'
import type { DocumentInfo, Job, SourceInfo } from '../types.js'
import type { Action, OptionSpec } from './index.js'

const soleDocument = (sources: SourceInfo[]): DocumentInfo | undefined =>
  sources.length === 1 && sources[0]?.kind === 'document' ? sources[0] : undefined

export const rotateAction: Action = {
  id: 'rotate',
  label: 'Rotate',
  hint: 'turn pages',
  appliesTo: (sources) => soleDocument(sources) !== undefined,
  unavailable: () => 'one PDF at a time',
  options: (): OptionSpec[] => [
    {
      kind: 'select',
      id: 'degrees',
      label: 'Turn',
      default: '90',
      choices: [
        { value: '90', label: '90° right', hint: 'a quarter turn' },
        { value: '180', label: '180°', hint: 'upside down' },
        { value: '270', label: '90° left', hint: 'a quarter turn back' },
      ],
    },
  ],
  plan(sources, values): Job[] {
    const doc = soleDocument(sources)
    if (!doc) return []
    const deg = Number(values.degrees ?? 90)
    const turns = ((deg / 90) % 4 || 1) as 1 | 2 | 3
    return [
      { op: 'rotate', sources: [doc], outputs: [suffixedOutputPath(doc.path, 'rotated')], turns },
    ]
  },
}
```

Register all five in `src/core/actions/index.ts`:

```ts
export const ACTIONS: Action[] = [
  convertAction, compressAction,
  mergeAction, splitAction, extractAction, deleteAction, rotateAction,
]
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run tests/core/actions-pages.test.ts`
Expected: PASS — 9 tests

- [ ] **Step 6: Fix the existing action tests**

Run: `npm test`. `tests/core/actions.test.ts` and `tests/core/actions-compress.test.ts` call `appliesTo(source)` and `plan(source, …)`; wrap each argument in an array.

- [ ] **Step 7: Lint, typecheck, commit**

```bash
npm run lint && npm run typecheck && npm test
git add -A
git commit -m "feat(core): merge, split, extract, delete and rotate actions"
```

---

## Task 11: CLI surface

**Files:**
- Modify: `src/cli/args.ts`, `src/cli/execute.ts`, `src/cli/report.ts`
- Test: `tests/cli/pdf-args.test.ts`

**Interfaces:**
- Consumes: the five actions (Task 10), `parseRanges` and `everyPageCuts`/`everyNCuts` (Tasks 1, 10)
- Produces: `--merge`, `--split <mode>`, `--extract <ranges>`, `--delete <ranges>`, `--rotate <degrees>`, `--separate`

- [ ] **Step 1: Write the failing test**

Create `tests/cli/pdf-args.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { parseArgs } from '../../src/cli/args.js'

describe('page operation flags', () => {
  it('parses --merge with several inputs', () => {
    const intent = parseArgs(['node', 'forge', 'a.pdf', 'b.pdf', '--merge'])
    expect(intent.action).toBe('merge')
    expect(intent.inputs).toEqual(['a.pdf', 'b.pdf'])
  })

  it('parses --split every-page', () => {
    const intent = parseArgs(['node', 'forge', 'doc.pdf', '--split', 'every-page'])
    expect(intent.action).toBe('split')
    expect(intent.split).toEqual({ mode: 'every-page' })
  })

  it('parses --split every=10', () => {
    const intent = parseArgs(['node', 'forge', 'doc.pdf', '--split', 'every=10'])
    expect(intent.split).toEqual({ mode: 'every-n', n: 10 })
  })

  it('parses --split at=1,4 as 1-based cut points', () => {
    const intent = parseArgs(['node', 'forge', 'doc.pdf', '--split', 'at=1,4'])
    expect(intent.split).toEqual({ mode: 'points', after: [1, 4] })
  })

  it('parses --extract with a range and --separate', () => {
    const intent = parseArgs(['node', 'forge', 'doc.pdf', '--extract', '3-7,12', '--separate'])
    expect(intent.action).toBe('extract')
    expect(intent.pages).toBe('3-7,12')
    expect(intent.separate).toBe(true)
  })

  it('parses --delete', () => {
    const intent = parseArgs(['node', 'forge', 'doc.pdf', '--delete', '3-7'])
    expect(intent.action).toBe('delete')
    expect(intent.pages).toBe('3-7')
  })

  it('parses --rotate in degrees', () => {
    const intent = parseArgs(['node', 'forge', 'doc.pdf', '--rotate', '180'])
    expect(intent.action).toBe('rotate')
    expect(intent.rotate).toBe(180)
  })

  it('rejects a rotation that is not a multiple of 90', () => {
    expect(() => parseArgs(['node', 'forge', 'doc.pdf', '--rotate', '45'])).toThrow(/multiple of 90/)
  })

  it('rejects two page operations at once', () => {
    expect(() =>
      parseArgs(['node', 'forge', 'doc.pdf', '--rotate', '90', '--delete', '2']),
    ).toThrow(/one operation/)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/cli/pdf-args.test.ts`
Expected: FAIL — `intent.action` is undefined

- [ ] **Step 3: Extend the Intent type and the parser**

In `src/cli/args.ts`, add to the `Intent` type:

```ts
  /** Which operation was asked for. Absent means convert, the default. */
  action?: 'convert' | 'compress' | 'merge' | 'split' | 'extract' | 'delete' | 'rotate'
  /** Raw range text for --extract / --delete, parsed once the page count is known. */
  pages?: string
  separate?: boolean
  rotate?: number
  split?:
    | { mode: 'every-page' }
    | { mode: 'every-n'; n: number }
    | { mode: 'points'; after: number[] }
```

Register the options with Commander:

```ts
  .option('--merge', 'combine several PDFs into one')
  .option('--split <mode>', 'every-page | every=N | at=N,N')
  .option('--extract <pages>', 'keep only these pages, e.g. 3-7,12')
  .option('--delete <pages>', 'drop these pages')
  .option('--rotate <degrees>', '90, 180 or 270')
  .option('--separate', 'with --extract, write one file per page')
```

And in the body that builds the `Intent`:

```ts
const chosen = (['merge', 'split', 'extract', 'delete', 'rotate'] as const).filter(
  (name) => opts[name] !== undefined,
)
if (chosen.length > 1) {
  throw invalidArguments(`Use one operation at a time — got ${chosen.map((c) => `--${c}`).join(' and ')}.`)
}

if (opts.rotate !== undefined) {
  const deg = Number(opts.rotate)
  if (!Number.isInteger(deg) || deg % 90 !== 0 || deg === 0 || deg >= 360) {
    throw invalidArguments(`--rotate takes a multiple of 90 below 360, not "${opts.rotate}".`)
  }
  intent.rotate = deg
}

if (typeof opts.split === 'string') {
  const every = opts.split.match(/^every=(\d+)$/)
  const at = opts.split.match(/^at=([\d,\s]+)$/)
  if (opts.split === 'every-page') intent.split = { mode: 'every-page' }
  else if (every?.[1]) intent.split = { mode: 'every-n', n: Number(every[1]) }
  else if (at?.[1]) {
    intent.split = { mode: 'points', after: at[1].split(',').map((s) => Number(s.trim())) }
  } else {
    throw invalidArguments(`--split takes every-page, every=N or at=N,N — not "${opts.split}".`)
  }
}
```

Add an `invalidArguments(detail: string)` factory to `src/core/errors.ts` using the existing `'invalid-arguments'` code if one is not already there.

- [ ] **Step 4: Wire execution**

In `src/cli/execute.ts`, when `intent.action` names a page operation: probe the inputs, look the action up by id in `ACTIONS`, convert `intent` into the action's `values` shape (`pages` string, `separate` boolean, `degrees`, and for split convert `after` from 1-based to 0-based cuts via `after.map(n => n - 1)`), call `action.plan(sources, values)`, and pass the jobs to `runJobs`.

In `src/cli/report.ts`, print a page-operation result as `✓ <n> files · <output names>` rather than the `from ──→ to` size line, which only means something for a conversion.

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run tests/cli/pdf-args.test.ts`
Expected: PASS — 9 tests

- [ ] **Step 6: Verify by hand**

```bash
npm run build
node dist/index.js --help                       # the five flags are listed
```

- [ ] **Step 7: Lint, typecheck, commit**

```bash
npm run lint && npm run typecheck && npm test
git add -A
git commit -m "feat(cli): page operation flags"
```

---

## Task 12: The staged list

**Files:**
- Create: `src/shell/stage.ts`, `src/shell/components/StagedFiles.tsx`
- Modify: `src/shell/App.tsx`
- Test: `tests/shell/stage.test.ts`, `tests/shell/staged-files.test.tsx`

**Interfaces:**
- Produces:
  - `interface Stage { sources: SourceInfo[]; failures: InputFailure[] }`
  - `emptyStage(): Stage`
  - `addToStage(stage: Stage, sources: SourceInfo[], failures: InputFailure[]): Stage`
  - `clearStage(): Stage`
  - `stageSummary(stage: Stage): string` — e.g. `"4 files · 31 pages · 3.9 MB"`
  - `<StagedFiles stage={stage} width={n} />`

- [ ] **Step 1: Write the failing test**

Create `tests/shell/stage.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { addToStage, clearStage, emptyStage, stageSummary } from '../../src/shell/stage.js'
import type { DocumentInfo, ImageInfo } from '../../src/core/types.js'

const doc = (path: string, pages: number, bytes: number): DocumentInfo => ({
  kind: 'document', path, format: 'pdf', bytes, pages, encrypted: false,
})
const img: ImageInfo = {
  kind: 'image', path: '/a.jpg', format: 'jpeg',
  bytes: 2048, width: 10, height: 10, hasAlpha: false, frames: 1,
}

describe('the staged list', () => {
  it('starts empty', () => {
    expect(emptyStage().sources).toEqual([])
  })

  it('accumulates across drops', () => {
    let stage = emptyStage()
    stage = addToStage(stage, [doc('/a.pdf', 3, 100)], [])
    stage = addToStage(stage, [doc('/b.pdf', 2, 100)], [])
    expect(stage.sources.map((s) => s.path)).toEqual(['/a.pdf', '/b.pdf'])
  })

  it('does not stage the same file twice', () => {
    let stage = emptyStage()
    stage = addToStage(stage, [doc('/a.pdf', 3, 100)], [])
    stage = addToStage(stage, [doc('/a.pdf', 3, 100)], [])
    expect(stage.sources).toHaveLength(1)
  })

  it('clears back to empty', () => {
    const stage = addToStage(emptyStage(), [doc('/a.pdf', 3, 100)], [])
    expect(clearStage().sources).toEqual([])
    expect(stage.sources).toHaveLength(1)
  })

  it('summarises documents with a page total', () => {
    let stage = emptyStage()
    stage = addToStage(stage, [doc('/a.pdf', 3, 1024), doc('/b.pdf', 2, 1024)], [])
    expect(stageSummary(stage)).toBe('2 files · 5 pages · 2 KB')
  })

  it('omits the page total when nothing staged has pages', () => {
    const stage = addToStage(emptyStage(), [img], [])
    expect(stageSummary(stage)).toBe('1 file · 2 KB')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/shell/stage.test.ts`
Expected: FAIL — cannot resolve `src/shell/stage.js`

- [ ] **Step 3: Write the stage module**

Create `src/shell/stage.ts`:

```ts
import type { InputFailure } from '../core/resolve.js'
import type { SourceInfo } from '../core/types.js'
import { formatBytes } from '../core/units.js'

export interface Stage {
  sources: SourceInfo[]
  failures: InputFailure[]
}

export function emptyStage(): Stage {
  return { sources: [], failures: [] }
}

export function clearStage(): Stage {
  return emptyStage()
}

/**
 * Drops accumulate.
 *
 * Building a merge list means adding files one at a time, so a second drop
 * has to append rather than replace. Converting `a.jpg` and then dropping
 * `b.jpg` still starts fresh, because completing an action clears the stage —
 * that is where the replace behaviour lives, not here.
 */
export function addToStage(
  stage: Stage,
  sources: SourceInfo[],
  failures: InputFailure[],
): Stage {
  const seen = new Set(stage.sources.map((s) => s.path))
  const added = sources.filter((s) => !seen.has(s.path))
  return {
    sources: [...stage.sources, ...added],
    failures: [...stage.failures, ...failures],
  }
}

export function stageSummary(stage: Stage): string {
  const { sources } = stage
  const bytes = sources.reduce((n, s) => n + s.bytes, 0)
  const pages = sources.reduce((n, s) => n + (s.kind === 'document' ? s.pages : 0), 0)
  const parts = [`${sources.length} ${sources.length === 1 ? 'file' : 'files'}`]
  if (pages > 0) parts.push(`${pages} ${pages === 1 ? 'page' : 'pages'}`)
  parts.push(formatBytes(bytes))
  return parts.join(' · ')
}
```

- [ ] **Step 4: Run the stage test**

Run: `npx vitest run tests/shell/stage.test.ts`
Expected: PASS — 6 tests

- [ ] **Step 5: Write the failing card test**

Create `tests/shell/staged-files.test.tsx`:

```tsx
import { render } from 'ink-testing-library'
import { createElement } from 'react'
import stringWidth from 'string-width'
import { describe, expect, it } from 'vitest'
import { StagedFiles } from '../../src/shell/components/StagedFiles.js'
import { addToStage, emptyStage } from '../../src/shell/stage.js'
import type { DocumentInfo } from '../../src/core/types.js'

const doc = (path: string, pages: number): DocumentInfo => ({
  kind: 'document', path, format: 'pdf', bytes: 240_000, pages, encrypted: false,
})

const frame = (stage: ReturnType<typeof emptyStage>, width = 80) => {
  const { lastFrame } = render(createElement(StagedFiles, { stage, width }))
  return (lastFrame() ?? '').split('\n')
}

describe('StagedFiles', () => {
  it('draws a framed list with the count in the tag', () => {
    const stage = addToStage(emptyStage(), [doc('/inv/jan.pdf', 3), doc('/inv/feb.pdf', 2)], [])
    const lines = frame(stage)
    expect(lines[0]).toContain('PDF ×2')
    expect(lines.join('\n')).toContain('jan.pdf')
    expect(lines.join('\n')).toContain('5 pages')
  })

  it('draws every line to one width', () => {
    const stage = addToStage(emptyStage(), [doc('/inv/jan.pdf', 3), doc('/inv/feb.pdf', 2)], [])
    const widths = new Set(frame(stage).filter((l) => l !== '').map(stringWidth))
    expect(widths.size).toBe(1)
  })

  it('lists three files and counts the rest', () => {
    const many = Array.from({ length: 30 }, (_, i) => doc(`/scans/scan-${i}.pdf`, 8))
    const lines = frame(addToStage(emptyStage(), many, [])).join('\n')
    expect(lines).toContain('… 27 more')
  })

  it('tags each row when the types are mixed', () => {
    const stage = addToStage(emptyStage(), [doc('/a.pdf', 1)], [])
    const mixed = addToStage(stage, [{
      kind: 'image', path: '/b.jpg', format: 'jpeg',
      bytes: 1, width: 1, height: 1, hasAlpha: false, frames: 1,
    }], [])
    const lines = frame(mixed).join('\n')
    expect(lines).toContain('MIXED ×2')
    expect(lines).toContain('JPEG')
  })

  it('reports skipped files outside the frame', () => {
    const stage = addToStage(
      emptyStage(),
      [doc('/a.pdf', 1)],
      [{ path: '/notes.txt', error: { code: 'unsupported-source', title: 'x', detail: 'not a format Forge reads' } as never }],
    )
    const lines = frame(stage).join('\n')
    expect(lines).toContain('1 skipped')
    expect(lines).toContain('notes.txt')
  })
})
```

- [ ] **Step 6: Write the card component**

Create `src/shell/components/StagedFiles.tsx`, following `FileCard.tsx`'s exact frame arithmetic — `MAX_CARD = 52`, `inner = outer - 2`, `textWidth = inner - 2`, the top border's rule sized as `inner - stringWidth(tag) - 3`. One staged file delegates to `FileCard` unchanged. More than one draws the tag as `PDF ×4` when every source shares a format and `MIXED ×5` otherwise, lists at most three rows with a right-aligned fact per row (pages for documents, `W×H` for images), a blank row, then `stageSummary(stage)`. Skipped files render after the frame as a `⚠ N skipped` block with one dim row each, outside the card because a skipped file is not staged.

- [ ] **Step 7: Run both tests**

Run: `npx vitest run tests/shell/stage.test.ts tests/shell/staged-files.test.tsx`
Expected: PASS — 11 tests

- [ ] **Step 8: Wire the stage into App.tsx**

Replace `const [source, setSource] = useState<SourceInfo | null>(null)` with `const [stage, setStage] = useState<Stage>(emptyStage())`. Every read of `source` becomes `stage.sources[0]`; the drop handler calls `addToStage`; the run path passes `stage.sources` instead of `[source]`; completing an action calls `setStage(clearStage())`; `esc` at the prompt with a non-empty stage clears it. Render `<StagedFiles>` where the single `FileCard` was.

- [ ] **Step 9: Run everything**

Run: `npm run lint && npm run typecheck && npm test`
Expected: PASS — including the existing `tests/shell/app-flow.test.tsx`

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "feat(shell): the stage holds a list of files"
```

---

## Task 13: The page grid

**Files:**
- Create: `src/shell/components/PageGrid.tsx`
- Test: `tests/shell/page-grid.test.tsx`

**Interfaces:**
- Produces:
  - `<PageGrid mode="cell" | "gap" pageCount selected cuts onSubmit onCancel width height />`
  - `gridLayout(pageCount: number, width: number, height: number): { perRow: number; rowsPerPage: number; cellWidth: number }` — exported for testing

- [ ] **Step 1: Write the failing test**

Create `tests/shell/page-grid.test.tsx`:

```tsx
import { render } from 'ink-testing-library'
import { createElement } from 'react'
import stringWidth from 'string-width'
import { describe, expect, it } from 'vitest'
import { PageGrid, gridLayout } from '../../src/shell/components/PageGrid.js'

const lines = (props: Record<string, unknown>) => {
  const { lastFrame } = render(createElement(PageGrid, props as never))
  return (lastFrame() ?? '').split('\n').filter((l) => l.trim() !== '')
}

describe('gridLayout', () => {
  it('sizes the cell from the document, not the visible page', () => {
    expect(gridLayout(248, 80, 24).cellWidth).toBe(7)
    expect(gridLayout(9, 80, 24).cellWidth).toBe(5)
  })

  it('fits as many cells per row as the width allows', () => {
    expect(gridLayout(9, 80, 24).perRow).toBeGreaterThan(gridLayout(9, 40, 24).perRow)
  })

  it('always places at least one cell per row', () => {
    expect(gridLayout(248, 20, 24).perRow).toBeGreaterThanOrEqual(1)
  })

  it('caps rows against the terminal height', () => {
    expect(gridLayout(248, 80, 12).rowsPerPage).toBeLessThan(gridLayout(248, 80, 40).rowsPerPage)
  })
})

describe('PageGrid geometry', () => {
  const base = { pageCount: 7, selected: [], cuts: [], onSubmit: () => {}, onCancel: () => {}, width: 80, height: 24 }

  it('draws the three lines of a row to one width', () => {
    const rows = lines({ ...base, mode: 'gap' })
    const cellLines = rows.filter((l) => /[╭│╰]/.test(l))
    expect(new Set(cellLines.map(stringWidth)).size).toBe(1)
  })

  it('right-aligns page numbers so units share a column', () => {
    const rows = lines({ ...base, pageCount: 12, mode: 'cell' })
    const numberRow = rows.find((l) => l.includes('│')) ?? ''
    expect(numberRow).toContain('  1 ')
  })

  it('marks a cut with the heavy bar and an uncut gap with the dashed one', () => {
    const rows = lines({ ...base, mode: 'gap', cuts: [0] }).join('\n')
    expect(rows).toContain('┃')
    expect(rows).toContain('┆')
  })

  it('never draws scissors, which some terminals render two columns wide', () => {
    expect(lines({ ...base, mode: 'gap', cuts: [0] }).join('\n')).not.toContain('✂')
  })

  it('marks a selected page in the top border', () => {
    expect(lines({ ...base, mode: 'cell', selected: [1] }).join('\n')).toContain('╭─✓─╮')
  })

  it('shows the paging position for a document that does not fit', () => {
    expect(lines({ ...base, pageCount: 248, mode: 'cell' }).join('\n')).toContain('of 248')
  })

  it('counts decisions made off-screen in the header', () => {
    const rows = lines({ ...base, pageCount: 248, mode: 'gap', cuts: [200] }).join('\n')
    expect(rows).toContain('2 files')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/shell/page-grid.test.tsx`
Expected: FAIL — cannot resolve `PageGrid.js`

- [ ] **Step 3: Write the layout function**

Create `src/shell/components/PageGrid.tsx`, starting with the pure part:

```tsx
const GAP = 3 // columns between cells, on all three lines

/**
 * How the grid fits the terminal.
 *
 * `cellWidth` is fixed by the *document's* largest page number, not the
 * visible page's, so the grid does not resize under the cursor when paging
 * past 99.
 */
export function gridLayout(
  pageCount: number,
  width: number,
  height: number,
): { perRow: number; rowsPerPage: number; cellWidth: number } {
  const cellWidth = String(pageCount).length + 4 // '│', pad, digits, ' ', '│'
  const usable = Math.max(cellWidth, width - 4)
  const perRow = Math.max(1, Math.floor((usable + GAP) / (cellWidth + GAP)))
  // Three lines a row, plus header, footer, hints and the prompt below.
  const rowsPerPage = Math.max(1, Math.floor((height - 8) / 3))
  return { perRow, rowsPerPage, cellWidth }
}
```

Then the component: it renders `rowsPerPage` rows of `perRow` cells, three `<Text>` lines each — top borders, numbers, bottom borders — with `GAP` spaces between cells on the border lines and `' ' + glyph + ' '` between cells on the number line in gap mode. Page numbers are `String(n).padStart(cellWidth - 3)` followed by one space. Selected cells draw `╭─✓─╮` centred in the top border. The cursor is an accent background on the cell (cell mode) or on the three-column gap (gap mode). `useInput` handles arrows, `space`, `a`, `pgup`/`pgdn`, `r`, `g`, `return` and `escape`, using an `indexRef` the way `Select` does — the comment in `Select.tsx` explains why state alone cannot be the source of truth in a synchronous input handler. The header prints the count of files the current cuts imply (gap mode) or `n of m` selected (cell mode); the footer prints `pages a–b of total` when the document does not fit on one screen.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/shell/page-grid.test.tsx`
Expected: PASS — 12 tests

- [ ] **Step 5: Lint, typecheck, commit**

```bash
npm run lint && npm run typecheck && npm test
git add -A
git commit -m "feat(shell): the page grid, in cell and gap modes"
```

---

## Task 14: The `/pdf` flow

**Files:**
- Create: `src/shell/flows/pdf.tsx`
- Modify: `src/shell/commands.ts`, `src/shell/App.tsx`
- Test: `tests/shell/pdf-flow.test.tsx`

**Interfaces:**
- Consumes: `actionsFor`, `unavailableReason` (Task 10); `PageGrid` (Task 13); `Stage` (Task 12)
- Produces: `<PdfFlow stage onDone onCancel width height prefs />`

- [ ] **Step 1: Write the failing test**

Create `tests/shell/pdf-flow.test.tsx`:

```tsx
import { render } from 'ink-testing-library'
import { createElement } from 'react'
import { describe, expect, it } from 'vitest'
import { PdfFlow } from '../../src/shell/flows/pdf.js'
import { addToStage, emptyStage } from '../../src/shell/stage.js'
import { COMMANDS, parseCommand } from '../../src/shell/commands.js'
import type { DocumentInfo } from '../../src/core/types.js'

const doc = (path: string, pages = 7): DocumentInfo => ({
  kind: 'document', path, format: 'pdf', bytes: 1000, pages, encrypted: false,
})

const frame = (sources: DocumentInfo[]) => {
  const stage = addToStage(emptyStage(), sources, [])
  const { lastFrame } = render(
    createElement(PdfFlow, {
      stage, width: 80, height: 24, onDone: () => {}, onCancel: () => {},
    } as never),
  )
  return lastFrame() ?? ''
}

describe('/pdf', () => {
  it('is a command the palette lists', () => {
    expect(COMMANDS.map((c) => c.name)).toContain('pdf')
    expect(parseCommand('/pdf')?.name).toBe('pdf')
  })

  it('lists the five operations this phase builds', () => {
    const out = frame([doc('/a.pdf')])
    for (const label of ['Split', 'Extract', 'Delete', 'Rotate']) {
      expect(out).toContain(label)
    }
  })

  it('dims merge with a reason when only one file is staged', () => {
    const out = frame([doc('/a.pdf')])
    expect(out).toContain('Merge')
    expect(out).toContain('needs 2+ files')
  })

  it('offers merge when two files are staged', () => {
    const out = frame([doc('/a.pdf'), doc('/b.pdf')])
    expect(out).toContain('Merge')
    expect(out).not.toContain('needs 2+ files')
  })

  it('says why split is unavailable on a one-page document', () => {
    expect(frame([doc('/a.pdf', 1)])).toContain('only one page')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/shell/pdf-flow.test.tsx`
Expected: FAIL — cannot resolve `flows/pdf.js`

- [ ] **Step 3: Register the command**

In `src/shell/commands.ts`, add to `COMMANDS` after `compress`:

```ts
  { name: 'pdf', description: 'page operations on a PDF', needsSource: true },
```

- [ ] **Step 4: Write the flow**

Create `src/shell/flows/pdf.tsx`. It owns a small state machine: `hub` → the chosen action's options → confirm → run.

- **hub** renders a `Select` built from `ACTIONS.filter(a => a.id !== 'convert' && a.id !== 'compress')`, each row's `label` and `hint` from the action. A row where `appliesTo(stage.sources)` is false renders dim with `unavailableReason(...)` in the right margin and is skipped by the cursor. Only the five page actions appear; compress and convert reach the hub in phase 4.
- **options** walks `action.options(stage.sources, values, prefs)` one spec at a time, reusing `Select`, `Slider`, `PathInput` and the text input exactly as the convert flow does.
- **split** intercepts the `mode` answer: `every-page` calls `everyPageCuts(doc.pages)`, `every-n` asks for a number then calls `everyNCuts`, `points` renders `<PageGrid mode="gap">`.
- **extract** and **delete** render `<PageGrid mode="cell">` when the document fits, and the text range input when it does not — `gridLayout(...).rowsPerPage * perRow >= pageCount` is the test. `r` and `g` swap between the two views; both write the same `values.pages`.
- **confirm** shows the planned outputs, then calls `action.plan(stage.sources, values)` and hands the jobs to the caller through `onDone`.

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run tests/shell/pdf-flow.test.tsx`
Expected: PASS — 5 tests

- [ ] **Step 6: Dispatch `/pdf` from App.tsx**

Add a `'pdf'` case to the command dispatch that mounts `<PdfFlow>`, passes `stage`, and on `onDone(jobs)` runs them through the same `runJobs` path the convert flow uses, then clears the stage.

- [ ] **Step 7: Run everything**

Run: `npm run lint && npm run typecheck && npm test`
Expected: PASS

- [ ] **Step 8: Verify by hand**

```bash
npm run build && npm link
cd /tmp && mkdir -p forge-check && cd forge-check
node -e "const {PDFDocument}=require('pdf-lib');(async()=>{const d=await PDFDocument.create();for(let i=0;i<7;i++)d.addPage([595,842]);require('fs').writeFileSync('doc.pdf',await d.save())})()"
forge doc.pdf --split every-page && ls          # doc-1.pdf … doc-7.pdf
forge doc.pdf --extract 2-4 && ls               # doc-extract.pdf
forge doc-1.pdf doc-2.pdf --merge && ls         # forge-check-merged.pdf
forge                                            # drop doc.pdf, then /pdf
```

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat(shell): the /pdf flow"
```

---

## Task 15: Merge ordering

**Files:**
- Create: `src/shell/components/MergeList.tsx`
- Modify: `src/core/order.ts` (new), `src/shell/flows/pdf.tsx`
- Test: `tests/core/order.test.ts`, `tests/shell/merge-list.test.tsx`

**Interfaces:**
- Consumes: `Stage` (Task 12), `mergeAction` (Task 10)
- Produces:
  - `moveItem<T>(list: T[], from: number, to: number): T[]`
  - `type SortMode = 'dropped' | 'name' | 'newest' | 'oldest'`
  - `sortSources(sources: SourceInfo[], mode: SortMode, mtimes: Map<string, number>): SourceInfo[]`
  - `nextSortMode(mode: SortMode): SortMode`
  - `<MergeList sources onSubmit onCancel width />`

- [ ] **Step 1: Write the failing test**

Create `tests/core/order.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { moveItem, nextSortMode, sortSources } from '../../src/core/order.js'
import type { DocumentInfo } from '../../src/core/types.js'

const doc = (path: string): DocumentInfo => ({
  kind: 'document', path, format: 'pdf', bytes: 1, pages: 1, encrypted: false,
})

describe('moveItem', () => {
  it('moves an item later', () => {
    expect(moveItem(['a', 'b', 'c'], 0, 2)).toEqual(['b', 'c', 'a'])
  })

  it('moves an item earlier', () => {
    expect(moveItem(['a', 'b', 'c'], 2, 0)).toEqual(['c', 'a', 'b'])
  })

  it('is a no-op when the position does not change', () => {
    expect(moveItem(['a', 'b', 'c'], 1, 1)).toEqual(['a', 'b', 'c'])
  })

  it('clamps rather than dropping an item off either end', () => {
    expect(moveItem(['a', 'b', 'c'], 0, -1)).toEqual(['a', 'b', 'c'])
    expect(moveItem(['a', 'b', 'c'], 2, 9)).toEqual(['a', 'b', 'c'])
  })

  it('never loses or duplicates an item', () => {
    const out = moveItem(['a', 'b', 'c', 'd'], 3, 1)
    expect([...out].sort()).toEqual(['a', 'b', 'c', 'd'])
  })
})

describe('sortSources', () => {
  const sources = [doc('/s/c.pdf'), doc('/s/a.pdf'), doc('/s/b.pdf')]
  const mtimes = new Map([['/s/c.pdf', 300], ['/s/a.pdf', 100], ['/s/b.pdf', 200]])

  it('leaves the dropped order alone', () => {
    expect(sortSources(sources, 'dropped', mtimes).map((s) => s.path)).toEqual([
      '/s/c.pdf', '/s/a.pdf', '/s/b.pdf',
    ])
  })

  it('sorts by filename', () => {
    expect(sortSources(sources, 'name', mtimes).map((s) => s.path)).toEqual([
      '/s/a.pdf', '/s/b.pdf', '/s/c.pdf',
    ])
  })

  it('sorts newest first', () => {
    expect(sortSources(sources, 'newest', mtimes).map((s) => s.path)).toEqual([
      '/s/c.pdf', '/s/b.pdf', '/s/a.pdf',
    ])
  })

  it('sorts oldest first', () => {
    expect(sortSources(sources, 'oldest', mtimes).map((s) => s.path)).toEqual([
      '/s/a.pdf', '/s/b.pdf', '/s/c.pdf',
    ])
  })

  it('cycles through the four modes and back', () => {
    expect(nextSortMode('dropped')).toBe('name')
    expect(nextSortMode('name')).toBe('newest')
    expect(nextSortMode('newest')).toBe('oldest')
    expect(nextSortMode('oldest')).toBe('dropped')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/core/order.test.ts`
Expected: FAIL — cannot resolve `src/core/order.js`

- [ ] **Step 3: Write the ordering module**

Create `src/core/order.ts`:

```ts
import { basename } from 'node:path'
import type { SourceInfo } from './types.js'

export type SortMode = 'dropped' | 'name' | 'newest' | 'oldest'

const CYCLE: SortMode[] = ['dropped', 'name', 'newest', 'oldest']

export function nextSortMode(mode: SortMode): SortMode {
  return CYCLE[(CYCLE.indexOf(mode) + 1) % CYCLE.length] as SortMode
}

/**
 * Move one item to a new position, clamping at both ends.
 *
 * Clamping rather than wrapping: a row dragged past the top should stop
 * there, not reappear at the bottom, which is what every list in every other
 * application does.
 */
export function moveItem<T>(list: T[], from: number, to: number): T[] {
  const target = Math.min(Math.max(to, 0), list.length - 1)
  if (from === target || from < 0 || from >= list.length) return [...list]
  const next = [...list]
  const [item] = next.splice(from, 1)
  if (item === undefined) return [...list]
  next.splice(target, 0, item)
  return next
}

/**
 * Order for merge.
 *
 * Hand-reordering thirty scans is not a thing anyone should do, and a glob
 * already arrives in name order — this makes that explicit and reversible.
 * `dropped` is identity, which is what makes the cycle safe to spin through.
 */
export function sortSources(
  sources: SourceInfo[],
  mode: SortMode,
  mtimes: Map<string, number>,
): SourceInfo[] {
  const time = (s: SourceInfo) => mtimes.get(s.path) ?? 0
  switch (mode) {
    case 'dropped':
      return [...sources]
    case 'name':
      return [...sources].sort((a, b) => basename(a.path).localeCompare(basename(b.path)))
    case 'newest':
      return [...sources].sort((a, b) => time(b) - time(a))
    case 'oldest':
      return [...sources].sort((a, b) => time(a) - time(b))
  }
}
```

- [ ] **Step 4: Run the ordering test**

Run: `npx vitest run tests/core/order.test.ts`
Expected: PASS — 10 tests

- [ ] **Step 5: Write the failing list test**

Create `tests/shell/merge-list.test.tsx`:

```tsx
import { render } from 'ink-testing-library'
import { createElement } from 'react'
import stringWidth from 'string-width'
import { describe, expect, it } from 'vitest'
import { MergeList } from '../../src/shell/components/MergeList.js'
import type { DocumentInfo } from '../../src/core/types.js'

const doc = (name: string, pages: number): DocumentInfo => ({
  kind: 'document', path: `/inv/${name}`, format: 'pdf',
  bytes: 240_000, pages, encrypted: false,
})

const sources = [doc('jan.pdf', 3), doc('feb.pdf', 2), doc('mar.pdf', 12)]

const frame = (props: Record<string, unknown> = {}) => {
  const { lastFrame } = render(
    createElement(MergeList, {
      sources, width: 80, onSubmit: () => {}, onCancel: () => {}, ...props,
    } as never),
  )
  return lastFrame() ?? ''
}

describe('MergeList', () => {
  it('numbers the files in their current order', () => {
    const out = frame()
    expect(out).toMatch(/1\s+jan\.pdf/)
    expect(out).toMatch(/2\s+feb\.pdf/)
    expect(out).toMatch(/3\s+mar\.pdf/)
  })

  it('shows the page total and the output name', () => {
    const out = frame()
    expect(out).toContain('17 pages')
    expect(out).toContain('inv-merged.pdf')
  })

  it('aligns every row to one width', () => {
    const rows = frame().split('\n').filter((l) => /\.pdf/.test(l) && !/merged/.test(l))
    expect(new Set(rows.map((l) => stringWidth(l.trimEnd()))).size).toBeLessThanOrEqual(1)
  })

  it('names the keys, including the pick-up gesture', () => {
    const out = frame()
    expect(out).toContain('pick up')
    expect(out).toContain('sort')
    expect(out).toContain('remove')
  })

  it('marks the held row when one is picked up', () => {
    expect(frame({ heldIndex: 1 })).toContain('⇅')
  })
})
```

- [ ] **Step 6: Write the component**

Create `src/shell/components/MergeList.tsx`. Rows are `'  ' + mark + ' ' + String(i + 1).padStart(2) + '  ' + name.padEnd(nameWidth) + pages.padStart(9) + size.padStart(10)`, where `nameWidth` is the longest basename plus four — the same padding arithmetic the plan verified for the mockup. `mark` is `❯` for the cursor, `⇅` in accent for a held row, a space otherwise; a held row also takes a background band. `useInput` handles `↑↓` (move the cursor, or the row when `heldIndex` is set), `space` (pick up / drop), `esc` (put a held row back, or cancel when nothing is held), `x` (remove), `s` (`nextSortMode`), `n` (rename the output) and `return` (submit the current order). The footer shows `──→ <mergeOutputPath(...)>` with the page total, and the sort mode as `sorted: name ▾` when it is not `dropped`.

**Do not use `shift+↑↓`.** Modifier-plus-arrow is the least reliably detected input across terminals, and a held row that visibly travels explains itself where a chord does not.

- [ ] **Step 7: Run the list test**

Run: `npx vitest run tests/shell/merge-list.test.tsx`
Expected: PASS — 5 tests

- [ ] **Step 8: Wire it into the flow**

In `src/shell/flows/pdf.tsx`, the merge branch renders `<MergeList>` instead of going straight to confirm. `onSubmit(ordered)` calls `mergeAction.plan(ordered, values)` so the job's `sources` carry the edited order — merge order *is* page order, and this is the only place it can be set.

`x` removing the last-but-one file drops merge below two sources; the flow returns to the hub with a note rather than planning a one-source merge.

- [ ] **Step 9: Run everything**

Run: `npm run lint && npm run typecheck && npm test`
Expected: PASS

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "feat(shell): merge ordering, sorting and removal"
```

---

## Task 16: Documentation

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Document the operations**

Add a `## PDF` section covering `/pdf` and the five flags, with the range grammar (`3-7, 12, 20-`, 1-based) and the naming rules — `-1`…`-N` zero-padded for split, `-extract`, `-trimmed`, `-rotated`, and merge's folder-derived name.

- [ ] **Step 2: Note what is not here yet**

One short paragraph: compression, PDF↔image and password handling arrive in phase 4; Markdown, HTML and Office conversion in phase 5.

- [ ] **Step 3: Commit**

```bash
npm run lint && npm run typecheck && npm test
git add README.md
git commit -m "docs: PDF page operations"
```

---

## Self-Review

**Spec coverage.** Walking the spec section by section: §4 multi-file staging → Task 12. §5 core data model → Tasks 2 and 4. §6 the PDF engine → Tasks 3, 6–9. §7 `/pdf` and the flow module → Task 14. §8 the page grid → Task 13. §9 split → Tasks 7, 10, 14. §10 merge → Tasks 6, 10, 15, plus naming in Task 5. §11 extract and delete → Tasks 8, 10. §12 rotate → Task 9. §13 CLI → Task 11. §14 code layout → the File Structure table. §15 testing → distributed through every task. §16 invariants → Global Constraints. §17 out of scope → Task 16.

One spec item is deliberately not implemented here, and the spec itself defers it: **split under a size** (§9) belongs with phase 4's measured target-size search.

**Placeholder scan.** No `TBD`, `TODO`, or "handle edge cases" steps. Four components are described in prose rather than full source — `StagedFiles` (Task 12), the `PageGrid` render body (Task 13), the `PdfFlow` state machine (Task 14) and `MergeList` (Task 15) — because each is a direct transcription of an existing component's frame arithmetic (`FileCard`) or input handling (`Select`), both of which are cited by file. Their tests are written out in full, which is what pins the behaviour.

**Type consistency.** `SourceInfo` narrows on `kind` throughout. `Job` members carry the tuple arities defined in Task 4 and used unchanged in Tasks 6–11. `appliesTo`/`plan` take `SourceInfo[]` from Task 10 onward, including in the shell and in Task 15's `onSubmit(ordered)`. `writeAtomic` is defined once in Task 6 and reused in Tasks 7–9. `cutsToRanges` has the same signature in Tasks 1, 7 and 10. `suffixedOutputPath`, `splitOutputPaths`, `extractOutputPaths` and `mergeOutputPath` are defined in Task 5 and used with matching arguments in Tasks 10 and 15. `SortMode` and `moveItem` are defined in Task 15 and used nowhere earlier.

**Sequencing note.** Tasks 2 and 4 are breaking sweeps: the suite is red between the type change and the last call-site fix within each. Both are single tasks for that reason — splitting them would commit a broken build.
