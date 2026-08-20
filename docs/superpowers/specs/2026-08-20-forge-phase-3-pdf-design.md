# Forge Phase 3 — PDF page operations

**Date:** 2026-08-20
**Status:** Draft, awaiting review
**Depends on:** phase 2 (the command layer and the measured-search discipline)

---

## 1. What phase 3 is

Phase 2 gave the shell a command registry and a second action. It said, in as
many words, that PDF work would need its own path and that `/merge` and
`/split` would land there.

Phase 3 opens that path. It adds a PDF engine, a `/pdf` command, the ability
to stage more than one file, and five operations on the pages of a document:
**merge, split, extract, delete, rotate**.

### What is deliberately *not* here

The full `/pdf` menu is nine entries. The other four are held back because
they depend on pixels or on encryption, and both carry risk this phase should
not absorb:

| Held for | Why |
| --- | --- |
| Compress, PDF↔image (phase 4) | Needs rasterisation and an image re-encode pipeline. §2 shows compression is a much larger job than it looked. |
| Protect, Unlock (phase 4) | Needs `mupdf`. Verified to work, but it is a second engine and belongs with the rest of the mupdf work. |
| Documents — Markdown, HTML, Office (phase 5) | An unrelated engine. `/convert` picks it up through the capability graph with no change here. |

Phase 3 depends on `pdf-lib` alone, which is why it can ship on its own.

---

## 2. Verified technical facts

Measured on this machine, not assumed. Fixture: a 24-page A4 PDF with a
1600×1200 JPEG (427 KB, q88) drawn on every page — 0.42 MB total.
`pdf-lib@1.17.1`, `mupdf@1.28.0`, Node 24.

**Page operations are effectively free.**

| Operation | Time |
| --- | --- |
| Probe — load + page count | 4 ms |
| Merge 4 copies → 96 pages | 23 ms |
| Split into 24 single-page files | 19 ms |
| Extract 11 pages | 2 ms |
| Rotate all 24 pages | 2 ms |
| 10 JPEGs → a 10-page PDF | 9 ms |

Nothing here needs a progress bar, bounded concurrency, or a worker. Batch is
a non-issue: the whole 24-page document round-trips faster than a single
image conversion.

**Rasterisation is not free, and PNG is the wrong default.**

| | 72 dpi | 150 dpi | 300 dpi |
| --- | --- | --- | --- |
| Render one page | 51 ms | 120 ms | 391 ms |
| PNG size | 0.54 MB | 9.13 MB | 55.96 MB |

At 150 dpi the same page is **0.20 MB as JPEG q75 — 46× smaller than PNG**.
Rendering all 24 pages at 150 dpi took 2434 ms, about 100 ms a page, so a
248-page scan is roughly 25 seconds. Consequences are recorded here for
phase 4: JPEG must be the default target, 150 dpi the default resolution, and
per-page progress is genuine (page *n* of *m*) rather than fabricated.

**Compression is not a save flag.** Every combination of mupdf's own options
was tried on the fixture:

| `saveToBuffer` options | Result |
| --- | --- |
| `compress` | 1.0% smaller |
| `compress,compress-images` | 1.0% smaller |
| `garbage=compact,compress,compress-images` | 1.0% smaller |
| `garbage=deduplicate,compress,compress-images,compress-fonts` | 1.0% smaller |

mupdf does not re-encode images that are already compressed. Actually
shrinking a PDF means extracting its images, re-encoding them, and rebuilding:

| Re-encode embedded JPEG at | PDF becomes |
| --- | --- |
| q75 | 43% smaller |
| q50 | 66% smaller |
| q30 | 77% smaller |

So "Compress PDF" is an image-pipeline job that runs through the Sharp engine
Forge already has, not a thin wrapper over a library call. That is the single
biggest reason it is in phase 4 and not this one.

**Encryption works, and is no longer a risk.**
`saveToBuffer("encrypt=aes-256,user-password=…,owner-password=…")` produced a
document that reopened with `needsPassword() === true`;
`authenticatePassword("secret")` returned 6 — user and owner password both
matched — and the 24 pages read normally afterwards. Protect and Unlock are
feasible in pure WASM. They are deferred for sequencing, not for doubt.

**Disk cost.** `pdf-lib` 23 MB, `mupdf` 14 MB. Phase 3 installs only the
first.

---

## 3. Decisions

| Decision | Why |
| --- | --- |
| The stage holds a list, not one file | `resolve.ts` already returns `SourceInfo[]` and `run.ts` already takes a list. The shell is the only place that narrowed to one, and that narrowing is what blocks merge. It also fixes batch conversion, which the shell cannot do today. |
| Drops accumulate; finishing an action clears the stage | Building a merge list means adding files one at a time. Converting `a.jpg` and then dropping `b.jpg` must not leave two staged — and does not, because the stage empties when an action completes. |
| `Job` becomes a discriminated union with tuple arities | Merge is N:1, split is 1:N. A single widened `{sources[], outputs[]}` would let any operation claim any arity; tuples make `split` the only member that can return several outputs. |
| `SourceInfo` becomes a union | `width`, `height`, `frames` and `hasAlpha` are meaningless for a document. Narrowing at each use site is a compile-time sweep, not a runtime risk. |
| `/pdf` is a hub that delegates | Its Compress and Convert rows are shortcuts to `/compress` and `/convert`, shown with those names in the margin. The hub advertises the faster door rather than duplicating it. |
| Unavailable operations are dimmed, not hidden | One staged file cannot merge. "needs 2+ files" in the margin teaches the tool; a vanishing row teaches nothing. |
| The PDF flow lives in `shell/flows/pdf.tsx` | `App.tsx` is 1031 lines. Nine operations inside it is the change most likely to break the file that everything else depends on. |
| Split partitions; it never drops pages | Ranges can skip pages, cut points cannot. Letting split drop pages duplicates `delete` and makes both vaguer. Every page lands in exactly one output. |
| Split asks *how* before showing the grid | Splitting a 248-page scan into single pages would otherwise be 247 keystrokes. Every-page and every-N never touch the grid. |
| The grid is never hidden by page count | Hiding a feature at an arbitrary threshold is a surprise. What changes with size is which view opens *first*: the grid when the document fits on screen, the range editor when it does not. |
| Cut glyphs are box-drawing, not scissors | `string-width` calls `✂` one column, but it is a Dingbat and many terminals give it emoji presentation at two. A wide glyph shears the row the same way a mis-sized card does. |
| Merge order is edited by pick-up-and-move | Modifier-plus-arrow is the least reliably detected input across terminals. Space grabs, arrows move the row, space drops. |

---

## 4. Multi-file staging

### The stage

`App.tsx` replaces `source: SourceInfo | null` with `sources: SourceInfo[]`.
Empty means nothing staged. The prompt accepts the same three inputs it
accepts today — dragged paths, a glob, a directory — and each resolves
through `resolve.ts` unchanged.

A second drop **appends**. `esc` clears. Completing an action clears.

### The card

One file keeps `FileCard` exactly as it is. More than one gets the same
frame with a count in the tag and totals at the foot:

```
╭─ PDF ×4 ───────────────────────────────────╮
│ invoice-jan.pdf                    3 pages │
│ invoice-feb.pdf                    2 pages │
│ invoice-mar.pdf                   12 pages │
│ invoice-apr.pdf                   14 pages │
│                                            │
│ 31 pages · 3.9 MB                          │
╰────────────────────────────────────────────╯
```

At most three rows are listed, then `… 27 more`. Thirty rows would push the
prompt off screen for no gain.

Mixed types tag each row (`PDF`, `JPEG`, `PNG`) and the frame reads
`MIXED ×5`.

### Failures

`resolve.ts` already returns `failures` alongside `sources`; nothing consumes
it. The shell now reports them **outside** the card, because a skipped file is
not staged and the card lists what is:

```
  ⚠ 2 skipped
    notes.txt        not a format Forge reads
    draft.pdf        could not be read
```

### Targets for a mixed stage

`targetIdsFor` is computed per source and **intersected** across the stage.
Staging two PDFs and three images offers JPEG and PNG only, because the PDFs
cannot become WebP. No new rule — the capability graph answers it.

---

## 5. The core data model

### Formats

`FormatId` gains `'pdf'`. Its `FormatSpec` sets `lossy: false` — a PDF
container is not lossy, so `/convert` shows no quality slider for it.
`/compress` supplies its own in phase 4.

### SourceInfo

```ts
export interface ImageInfo {
  kind: 'image'
  path: string
  format: FormatId
  bytes: number
  width: number
  height: number
  hasAlpha: boolean
  frames: number
}

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

Every site reading `source.width` must narrow on `kind` first. TypeScript
strict finds all of them; there is no runtime discovery.

### Job

```ts
export type Job =
  | { op: 'convert'; sources: [SourceInfo]; outputs: [string]
      target: FormatId; options: ConvertOptions }
  | { op: 'merge';   sources: SourceInfo[]; outputs: [string] }
  | { op: 'split';   sources: [DocumentInfo]; outputs: string[]; cuts: number[] }
  | { op: 'extract'; sources: [DocumentInfo]; outputs: string[]
      pages: number[]; separate: boolean }
  | { op: 'delete';  sources: [DocumentInfo]; outputs: [string]; pages: number[] }
  | { op: 'rotate';  sources: [DocumentInfo]; outputs: [string]; turns: 1 | 2 | 3 }
```

The tuple types are load-bearing: only `split` and `extract` can name several
outputs, and only `merge` can take several sources. `convert` keeps precisely
the shape it has today, so nothing about the image path changes in meaning.

`cuts` are the indices *after which* a cut falls, 0-based. `pages` are 0-based
page indices. Both are 1-based only in what the user sees.

### Engine

```ts
export interface Engine {
  id: string
  reads: ReadonlySet<FormatId>
  writes: ReadonlySet<FormatId>
  /** Which operations this engine implements. */
  ops: ReadonlySet<Job['op']>
  probe(path: string): Promise<SourceInfo>
  run(job: Job, onPhase: (phase: Progress) => void): Promise<Result>
}

export type Progress =
  | { phase: 'reading' | 'decoding' | 'encoding' | 'writing' }
  /** Only emitted where the count is genuinely known in advance. */
  | { phase: 'page'; done: number; total: number }
```

`convert` is renamed `run` and dispatches on `job.op`. The image engine
declares `ops: {'convert'}` and throws on anything else, which cannot happen
because the registry routes by capability.

### Actions

`appliesTo(source)` becomes `appliesTo(sources: SourceInfo[])`. Merge returns
`sources.length > 1`; the rest require exactly one document. This is what
drives the dimmed rows in the hub.

---

## 6. The PDF engine

`src/engines/pdf.ts`, built on `pdf-lib`.

- `reads: {pdf}`, `writes: {pdf}`, `ops: {merge, split, extract, delete, rotate}`
- **Probing is by content.** `PDFDocument.load(bytes, { ignoreEncryption: true })`.
  A file that is not a PDF throws and the registry moves on, exactly as it
  does for images today. Extensions are never consulted.
- `encrypted` is recorded from the loaded document. Page operations on an
  encrypted file fail with a dedicated `ForgeError` naming Unlock as the fix,
  rather than a generic parse failure at the last step — the shape of failure
  that [heic.ts](../../../src/engines/heic.ts) exists to avoid.
- **Rotation is additive.** `page.getRotation().angle + turns * 90`, normalised
  to 0–270. Replacing the angle would silently undo a document's existing
  rotation, which is the PDF equivalent of ignoring EXIF orientation.
- **Writes stay atomic.** Every output goes to a temp file and is renamed.
  For a split producing many files, a failure part-way removes the outputs
  already renamed — the job is all-or-nothing, not partly applied.

---

## 7. `/pdf` and the flow module

### The command

One entry in `COMMANDS`:

```ts
{ name: 'pdf', description: 'page operations on a PDF', needsSource: true }
```

### The hub

A `Select` rendered with the existing component. **In phase 3 it lists the
five operations this phase builds** — merge, split, extract, delete, rotate.
Compress, Convert, Protect and Unlock arrive in phase 4 along with the
delegation described in §3; a row that says "not built yet" is noise, so the
hub lists what the build can do and nothing else.

Rows whose `appliesTo` fails are dimmed with a reason in the margin — with one
file staged, Merge reads `needs 2+ files` and cannot be selected.

### The flow module

`shell/flows/pdf.tsx` owns the PDF conversation: which operation, its options,
its confirmation. `App.tsx` keeps the prompt, the stage, history, and
dispatch, and hands off.

Making that possible is the one refactor in this phase. Staging state and the
option-answering loop move out of `App.tsx` into `shell/stage.ts` and
`shell/flows/options.tsx`, so both the existing convert/compress flows and the
new PDF flow drive them. `App.tsx` should end this phase smaller than it
started.

---

## 8. The page grid

`shell/components/PageGrid.tsx`. One component, two cursor modes.

```
╭─────╮   ╭─────╮   ╭─────╮   ╭─────╮   ╭─────╮
│   1 │ ┆ │   2 │ ┆ │   3 │ ┆ │   4 │ ┃ │   5 │
╰─────╯   ╰─────╯   ╰─────╯   ╰─────╯   ╰─────╯
```

- **Cell mode** — the cursor is on a page; space selects it. Used by extract
  and delete. Selection is marked in the top border (`╭─✓─╮`), the same trick
  `FileCard` uses to inline its format tag.
- **Gap mode** — the cursor is between pages; space cuts there. Used by split.
  `┃` is a cut, `┆` is not.

Geometry, all of which has bitten this design once already:

- Gaps are **3 columns on all three lines**. A gap of 1 on the border rows and
  3 on the number row drifts 8 columns across seven pages.
- Page numbers are **right-aligned** so units stay in a column.
- Cell width is fixed by the **document's** largest page number, not the
  visible page's, so the grid does not resize when paging past 99.
- Cells per row come from the terminal **width**; rows per screen are capped
  against the terminal **height** so the prompt and hints stay visible. The
  grid pages with `pgup`/`pgdn` and prints `pages 1–24 of 248`.
- Decisions made off-screen still count in the header total, so paging never
  hides a choice already made.

**Which view leads.** If the whole document fits the visible grid, the grid
opens first. If it does not, the range editor opens first and `g` opens the
grid. Nothing is hidden either way; `r` and `g` toggle between them, and both
edit the same list of ranges.

---

## 9. Split

A mode picker comes first:

```
  SPLIT — HOW
  ❯ Every page              248 files
    Every N pages           ask how many
    At points I choose      scissors
```

`Every page` and `Every N pages` never open the grid. `At points I choose`
does, in gap mode.

Cut points and contiguous ranges are the same data seen two ways: cuts after
pages 1 and 4 are the ranges `1, 2-4, 5-7`. `r` shows the ranges as editable
text; editing the text moves the cuts. One list, two editors.

Outputs are `<stem>-1.pdf`, `<stem>-2.pdf`, …, zero-padded to the width of the
count so `-01`…`-24` sorts correctly in a file listing.

*Under a size* is specified but deferred with compress, because packing pages
to a byte target requires measuring real output — the same discipline as the
target-size search — and that belongs beside it.

---

## 10. Merge

The staged list, reorderable:

```
  MERGE — ORDER                       4 files · 31 pages

  ❯  1  invoice-jan.pdf      3 pages    240 KB
     2  invoice-feb.pdf      2 pages    180 KB
     3  invoice-mar.pdf     12 pages    1.1 MB
     4  invoice-apr.pdf     14 pages    2.4 MB

     ──→  invoices-merged.pdf  31 pages
```

- `↑↓` moves the cursor; `space` picks the row up, `↑↓` then moves the **row**,
  `space` drops it, `esc` puts it back.
- `x` removes a file from the merge without clearing the stage.
- `s` cycles the order: as dropped · name · newest · oldest.
- `n` renames the output before committing.

**Naming.** Every other operation derives its output from its one source;
merge has none. The name comes from the **common parent folder** —
`~/invoices/*.pdf` → `invoices-merged.pdf`, written into that folder. When the
inputs span different folders there is no common parent worth naming, and it
falls back to the first file's stem: `invoice-jan-merged.pdf`.

---

## 11. Extract and delete

Both answer "which pages", both use the grid in cell mode, and they are
inverses: extract keeps the selection, delete keeps everything else. The
header states which, so the same grid never means two things silently.

Extract asks one more question, because a selection of three pages is
ambiguous:

```
   ◉ one file, 3 pages        ○ 3 separate files
```

One file is the default. Separate files produce `<stem>-p3.pdf`,
`<stem>-p4.pdf`, … named by page number rather than sequence, so the name says
where the page came from.

Delete has no such question — it always produces one document —
and writes `<stem>-trimmed.pdf`.

Selecting every page in delete, or none in extract, is refused before the run
with a message rather than producing an empty document.

---

## 12. Rotate

Turns of 90, 180 or 270, applied to a page selection that defaults to all
pages. Reuses the grid in cell mode; `a` selects everything, which is the
common case. Output is `<stem>-rotated.pdf`.

---

## 13. CLI surface

Both front ends run the same core, so parity is nearly free.

```bash
forge a.pdf b.pdf c.pdf --merge -o combined.pdf
forge doc.pdf --split every-page
forge doc.pdf --split every=10
forge doc.pdf --split at=1,4
forge doc.pdf --extract 3-7,12,20- [--separate]
forge doc.pdf --delete 3-7
forge doc.pdf --rotate 90
forge ~/invoices/ --merge            # directory, name from the folder
```

The range grammar is one parser shared by `--extract`, `--delete` and `r` in
the shell: comma-separated terms, each `N`, `N-M`, or `N-` for "to the end",
1-based, order-insensitive, duplicates collapsed. Out-of-range pages are an
error naming the document's page count, not a silent clamp.

Two conversions to state rather than imply. `--split at=1,4` cuts **after**
1-based pages 1 and 4, producing `1`, `2-4`, `5-`. `--rotate` takes degrees and
maps to the `turns` field of the job — 90 → 1, 180 → 2, 270 → 3; any other
value is rejected, since a PDF page rotation must be a multiple of 90.

---

## 14. Code layout

```
src/
├── core/
│   ├── types.ts            SourceInfo union, Job union, Progress
│   ├── pages.ts            NEW  range grammar, cuts ⇄ ranges, validation
│   ├── actions/
│   │   ├── merge.ts        NEW
│   │   ├── split.ts        NEW
│   │   ├── extract.ts      NEW   (delete is its inverse, same file)
│   │   └── rotate.ts       NEW
│   └── output-path.ts      + suffix naming, merge's folder rule
├── engines/
│   └── pdf.ts              NEW  pdf-lib
└── shell/
    ├── stage.ts            NEW  staged list, extracted from App.tsx
    ├── components/
    │   └── PageGrid.tsx    NEW
    └── flows/
        ├── options.tsx     NEW  option loop, extracted from App.tsx
        └── pdf.tsx         NEW  the /pdf conversation
```

---

## 15. Testing

Following the existing shape: pure logic in `tests/core`, engine behaviour
against generated fixtures in `tests/engines`, rendered frames in
`tests/shell` via `ink-testing-library`.

**Fixtures.** `tests/helpers/fixtures.ts` gains `makePdf(pages, opts)`,
building documents with `pdf-lib` — 14 ms for 24 pages, so fixtures are built
per test rather than committed, exactly as the image fixtures are.

**`core/pages.ts`** — the range grammar is pure and gets the heaviest table:
`3-7`, `20-`, `1,1,2` collapsing, `7-3` reversed, `0` and `999` rejected with
the page count named, empty and whitespace-only input.

**Cuts ⇄ ranges round-trips.** Property-style: any valid cut set converts to
ranges and back unchanged, and the ranges always partition the document with
no page missing and none twice.

**Engine.**
- Merge: page count is the sum; page *order* is asserted by stamping each
  fixture page with its origin and reading it back, because a merge that
  silently reorders passes a count check.
- Split: outputs partition the input; concatenating them reproduces the
  original page sequence.
- Extract/delete: inverses — extracting *S* and deleting *S* from the same
  document yield page sets whose union is the original and whose intersection
  is empty.
- Rotate: **additive**, not absolute. A page already at 90 rotated by 90 is
  at 180. This is the regression test that matters; the naive implementation
  passes every other rotate test.
- Encrypted input fails with the dedicated error, not a parse error.
- Atomicity: a split forced to fail on its fifth output leaves no files behind.

**Shell.**
- The multi-file card renders every line to one width at 80, 60 and 40 columns.
- `PageGrid` rows are width-asserted the way `FileCard` already is, at 1-, 2-
  and 3-digit page counts.
- Dimmed hub rows appear with their reason and cannot be selected.
- Drops accumulate; a completed action clears the stage.

**Regression pinned from §2.** A test asserts that a merge of four 24-page
fixtures completes well inside a second, so a future change that makes page
operations slow enough to need progress reporting fails loudly instead of
quietly degrading.

---

## 16. Invariants

Restating the ones this phase could break, and how it does not.

1. `core/` and `engines/` import no React, Ink or Chalk and write nothing to
   stdout. `pdf.ts` returns data; the shell renders it.
2. **No hardcoded format list.** `pdf` enters `FORMATS` and the engine
   declares what it reads and writes. Every menu updates because every menu is
   computed. The mixed-stage target list is `targetIdsFor` intersected — still
   no table of pairings anywhere.
3. **Sources are probed by content.** A PDF is recognised by loading it, never
   by `.pdf`.
4. `.rotate()` before other Sharp operations — untouched; no Sharp work here.
5. Alpha flattening — untouched.
6. **Writes are atomic**, extended: a multi-output job is all-or-nothing.
7. **Progress is never fabricated.** Page operations report no percentage
   because §2 shows they finish in milliseconds. The `page` progress event
   exists for phase 4's rasterisation, where *n* of *m* is a real count.

---

## 17. Not in phase 3

Compress, PDF→image, image→PDF, protect, unlock, split-under-a-size —
phase 4, with `mupdf` and the Sharp re-encode pipeline §2 showed compression
actually needs.

Markdown, HTML and Office conversion — phase 5, an independent engine that
reaches `/convert` through the capability graph.

Page reordering within one document, watermarks, page numbering, redaction,
OCR, and anything requiring a rendered preview.
