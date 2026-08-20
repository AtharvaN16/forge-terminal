# Forge Phase 4a — PDF pixels

**Date:** 2026-08-20
**Status:** Draft, awaiting review
**Depends on:** phase 3 (the PDF engine, the page grid, the range grammar, `checkWriteSafety`)

---

## Amendment 1 — mupdf replaced by pdfium; unlock cut — 2026-08-20

**This amendment supersedes every mention of `mupdf` and of the `unlock`
feature below it.** The rest of the document stands.

`mupdf@1.28.0` is **AGPL-3.0-or-later**. Forge declares **MIT**, and every other
dependency (pdf-lib, sharp, ink, commander) is MIT or Apache-2.0. Shipping an
MIT CLI linked against an AGPL runtime forces the combined work to AGPL. The
repo is public and the deliverable is a distributable command, so the obligation
is real. This was my error in the phase 3 spike: I chose mupdf on capability and
never read its licence. It never reached `dev` or `main`.

**Rasterisation now uses `@hyzyla/pdfium`** — wrapper MIT, PDFium core
BSD-3-Clause.

**`unlock` is cut.** PDFium can *open* an encrypted PDF but exposes no save
function, and unlock must decrypt *and write*. Reading an encrypted PDF is kept:
`/convert` on a locked PDF prompts for a password and rasterises it. So
`cli/stdin.ts` and invariant 8 both stand — passwords still exist, they just
unlock a read rather than produce a decrypted file.

### Re-measured on pdfium

The §2 figures were taken with mupdf on a different fixture and do not carry
over. Re-measured here: 24 A4 pages, each a photo plus 18 lines of text.

| dpi | scale | render 1 page | PNG | JPEG q75 | ratio |
| --- | --- | --- | --- | --- | --- |
| 72 | 1.000 | 33 ms | 0.68 MB | 0.08 MB | 8× |
| 150 | 2.083 | 36 ms | 2.83 MB | 0.25 MB | 12× |
| 300 | 4.167 | 58 ms | 10.78 MB | 0.71 MB | 15× |

- **JPEG-by-default survives**, 12× at 150 dpi rather than the 46× claimed in §2.
  That gap is the *fixture*, not the library — Sharp does the encoding either
  way, and text compresses far better as PNG than the photo-heavy page the old
  number came from. The decision is unchanged; the evidence for it is weaker
  than I wrote.
- **150 dpi by default survives** on the same reasoning.
- **The progress bar's justification weakens and its conclusion holds.** 24 pages
  took 740 ms, 31 ms a page, so a 248-page scan is about **8 seconds** — not the
  25 seconds §2 claims. 8 seconds is still far past the point a person wonders
  whether it has hung, so the bar is warranted, but it is not the emergency the
  original number implied.
- **pdfium honours `/Rotate`,** same as mupdf: a 400×800 page with `/Rotate 90`
  renders 800×400. The §2 conclusion is unaffected.

### Two API constraints that must reach the implementation

1. **`render: 'bitmap'` returns RGBA, not BGRA.** A page painted R=51 G=102 B=229
   yields first pixel `[51,102,230,255]`. Feed Sharp's `raw` input directly with
   `channels: 4`. Swapping produces `r=232 b=56` — silently inverted colour that
   passes every width/height assertion. **Task 3 must assert a colour, not only
   a size.**
2. **A `PDFiumPage` object is single-use.** Calling `.render()` twice on one page
   object corrupts the wasm heap (`table index is out of bounds`). Take a fresh
   `doc.getPage(n)` for every render, or iterate `doc.pages()` once.

**Disk cost is slightly better, and the §2 "no brew step" claim survives.**
`@hyzyla/pdfium` is **11 MB** against mupdf's 14 MB, has **zero dependencies**,
and declares **no install or postinstall script** — so it stays pure JS/WASM with
nothing to compile at install time, which was the constraint that ruled out
native bindings in the first place.

`qpdf-wasm` (Apache-2.0) could restore unlock later, but it is v0.1.0 and is not
being taken on now.

---

## 1. What phase 4a is

Phase 3 gave PDFs page operations — merge, split, extract, delete, rotate — all
of which move pages around without ever looking inside one. Phase 4a is the
first time Forge renders a PDF's pixels.

It adds:

- **PDF → image**, rasterised through mupdf
- **image → PDF**, embedded through pdf-lib
- **unlock**, CLI only, for batch-decrypting a folder
- the **progress bar**, because rasterising is the first operation slow enough
  to need one
- a **routing fix** that two PDF-writing engines make mandatory

### Why this is 4a and not 4

Phase 4 was originally scoped as five features. It split by the kind of work
each needs:

| | |
| --- | --- |
| **4a — pixels** | render and embed. Call a library, write the result. |
| **4b — sizes** | compress, and split-under-a-size. Both are bounded searches for a byte target, sharing the discipline `core/compress.ts` already has. |

Splitting that way keeps each phase to one idea. Compress in particular is a
pipeline, not a call, and belongs beside the other thing that hunts for a
size.

### What was dropped, and why

**Protect** was cut during design. Its cost is inverted: encrypting is one
`saveToBuffer` call, but the shell would need a masked text input (no such
component exists), a confirm-twice step, and an audited guarantee that a
password never reaches an error, a `Result` or `--debug`. That is the largest
shell change in the phase for the smallest engine change — and macOS Preview
already adds a password in two clicks.

**Unlock survived, CLI only.** Preview cannot decrypt thirty statements in a
folder; that is a genuine terminal job and the reason to build this at all.
Its value lives entirely in `--password-stdin` and a directory argument,
neither of which needs the UI protect would have required.

---

## 2. Verified technical facts

Measured on this machine during the phase 3 spike and extended for this
design. `mupdf@1.28.0`, `pdf-lib@1.17.1`, Node 24.

**Rasterising costs real time, and PNG is the wrong default.**

| | 72 dpi | 150 dpi | 300 dpi |
| --- | --- | --- | --- |
| Render one A4 page | 51 ms | 120 ms | 391 ms |
| PNG | 0.54 MB | 9.13 MB | 55.96 MB |

At 150 dpi that same page is **0.20 MB as JPEG q75 — 46× smaller than PNG**.
Rendering 24 pages at 150 dpi took 2434 ms, about 100 ms a page, so a
248-page scan is roughly **25 seconds**. That is the number that makes a
progress bar necessary rather than decorative.

**mupdf honours `/Rotate`.** A 400×800 page carrying `/Rotate 90` renders as
an 800×400 pixmap; an unrotated page of the same box renders 400×800. So
`/pdf` → Rotate followed by a conversion produces correctly oriented images
with no extra work. This project has had to ask that question three times —
EXIF orientation in phase 1, additive page rotation in phase 3, and now
rasterisation. It is the first time the answer cost nothing.

**Embedding images is effectively free.** Ten JPEGs into a ten-page PDF: 9 ms.

**Decryption works.** A document saved with
`encrypt=aes-256,user-password=…,owner-password=…` reopens with
`needsPassword() === true`; `authenticatePassword("secret")` returns 6 — the
bitfield for *both* the user and owner password matching — and its pages read
normally afterwards.

**Disk cost.** `mupdf` is 14 MB, on top of `pdf-lib`'s 23 MB. Both are pure
JS/WASM with no install scripts and no brew step.

---

## 3. Decisions

| Decision | Why |
| --- | --- |
| `engineForJob` matches on source **and** target for conversions | Today it matches on target alone. Two engines that write JPEG make that ambiguous, and the wrong one wins silently. |
| A second engine file, split by library | `engines/pdf.ts` keeps pdf-lib, `engines/mupdf.ts` is new. One library per file is a boundary that stays meaningful, and it is the one that matters if either is ever swapped — pdf-lib has had no release since 2021. |
| JPEG is the default rasterisation target | Measured 46× smaller than PNG at 150 dpi. PNG stays offered for anyone who wants lossless. |
| 150 dpi is the default resolution | Legible on screen and in print at a tenth of 300 dpi's render cost and a sixth of its bytes. |
| `/convert` asks which pages when the source is a PDF | A 248-page scan is 248 files. The range grammar and the page grid already exist; a third way to pick pages would not. |
| The progress bar is determinate | The page count is known before the first page renders, so a bar is honest. Invariant 7 forbids inventing progress, not showing it. |
| Images → PDF stays one-in-one-out | Every other conversion is. Making PDF the one target that silently collapses a batch is the surprise this project keeps refusing. The offer to merge comes after, measured, as phase 2 established. |
| Unlock is CLI-only | A deliberate parity break. Its value is batch decryption, which is a CLI shape; the shell would need a masked-input component built for one operation. |
| The shell's encrypted-file refusal names the CLI command | If the shell cannot do the thing, it should say where the thing lives. |
| Protect is not built | See §1. Cost inverted, and Preview already does it. |

---

## 4. Routing

`engineForJob` currently reads:

```ts
if (job.op === 'convert') return ENGINES.find((e) => e.writes.has(job.target))
```

A PDF→JPEG job has `target: 'jpeg'`, and `imageEngine.writes.has('jpeg')` is
true — so the image engine wins and then fails on a source it cannot read.
The capability graph is correct right up until two engines write the same
format, which is exactly what this phase introduces.

```ts
if (job.op === 'convert') {
  const from = job.sources[0].format
  return ENGINES.find((e) => e.reads.has(from) && e.writes.has(job.target))
}
```

`targetIdsFor` needs no change — it already unions across engines, filtered by
`reads`. A PDF starts offering JPEG and PNG the moment the new engine declares
them, and no menu anywhere is edited. That is invariant 2 working.

**This is a silent-failure fix, and it needs a test that would catch the
regression**: a PDF→JPEG job must route to the mupdf engine while a PNG→JPEG
job routes to the image engine, asserted by engine `id`.

---

## 5. The engines

### `engines/mupdf.ts` — new

```ts
reads:  {pdf}
writes: {jpeg, png}
ops:    {convert, unlock}
```

- **`convert`** renders each selected page at the chosen resolution.
  `page.toPixmap(Matrix.scale(dpi/72, dpi/72), ColorSpace.DeviceRGB, false, true)`,
  then `pixmap.asJPEG(quality, false)` or `pixmap.asPNG()`. Emits
  `{ phase: 'page', done, total }` per page.
- **`unlock`** opens with `ignoreEncryption`, calls `authenticatePassword`,
  and saves without encryption. A failed authentication is a dedicated
  `ForgeError`, never a parse failure.
- `probe` is not implemented here — `engines/pdf.ts` already probes PDFs and
  the registry takes the first engine that succeeds.

### `engines/pdf.ts` — extended

Gains `reads: {jpeg, png, webp, avif, gif, tiff}` alongside `{pdf}`, and
handles `convert` when the target is `pdf`: `embedJpg`/`embedPng` and one page
sized to the image. Formats pdf-lib cannot embed directly (WebP, AVIF, GIF,
TIFF) are decoded to PNG through the existing Sharp engine first — the same
two-step shape `heic.ts` already uses, and for the same reason.

---

## 6. PDF → image

The flow inserts one step into `/convert` when the source is a document:

```
  WHICH PAGES
❯ All 248 pages       248 files
  Just the first      1 file
  Choose…             grid or range

  RESOLUTION
❯ 150 dpi   reading
  72 dpi    screen
  300 dpi   print
```

`Choose…` opens `PageGrid` in cell mode when the document fits the visible
grid, and the typed range editor when it does not — the same rule phase 3
established, with `r` and `g` toggling.

Outputs are zero-padded to the width of the page count, reusing
`splitOutputPaths`' rule: `report-001.jpg` … `report-248.jpg`. Unpadded
numbers sort `-10` before `-2`.

Quality applies as it does for any lossy target — the existing slider, no
special case.

---

## 7. Image → PDF

`/convert` on images gains `PDF` in the target list, from the capability graph
rather than a list. Ten JPEGs produce ten PDFs. Afterwards:

```
✓ 10 files converted   14 MB ──→ 9.1 MB

10 separate PDFs. Merge them into one?   y / n
```

Answering yes runs the existing merge action over the outputs. The offer is a
next step, never an applied default.

---

## 8. Unlock (CLI only)

```bash
forge doc.pdf --unlock                          # prompts on a TTY
cat pw | forge ~/statements/ --unlock --password-stdin
```

- The password never appears in `argv`, so never in shell history or `ps`.
- One password applies to every file in a batch. A file it does not open fails
  as any batch failure does — reported, with the rest continuing.
- Output is `<stem>-unlocked.pdf`, through `suffixedOutputPath`.
- `checkWriteSafety` covers it for free: unlock writes a new file.

**The password is the one value in this codebase that must never surface.** It
must not appear in a `Job` that is logged, an error's `detail` or `hint`, a
`Result`, or `--debug` output. That is an invariant for this phase with a test
of its own.

The shell does not gain unlock. Its existing encrypted-source refusal gains a
pointer:

```
✕ This PDF is password-protected
  scan.pdf cannot be changed until it is unlocked.
  Unlock it first:  forge scan.pdf --unlock
```

---

## 9. Progress

`Progress` and `runJobs`'s `onEvent` both exist from phase 3 and are both
unused — every call site passes `{}`. This phase wires them and adds
`shell/components/Progress.tsx`, reusing `theme.ts`'s `BAR` glyphs so the bar
reads like the quality slider rather than a new vocabulary.

```
  RENDERING
  ├─────────●────────┤  page 112 of 248
  report-112.jpg
```

The CLI prints a line per completed page rather than a bar — a redrawing bar
in a piped stdout is noise.

**Nothing is estimated.** The total is known before the first page renders. An
operation whose length is not known in advance still reports phases only.

---

## 10. CLI surface

```bash
forge doc.pdf --to jpeg                      # all pages, 150 dpi
forge doc.pdf --to jpeg --pages 3-7 --dpi 300
forge doc.pdf --to png --pages 1
forge ~/receipts/*.jpg --to pdf
forge doc.pdf --unlock
cat pw | forge ~/statements/ --unlock --password-stdin
```

`--pages` shares `parseRanges` with `--extract` and `--delete`; it is not a
second grammar.

`--dpi` accepts **any integer from 36 to 600**, defaulting to 150. The shell
offers three presets because a picker needs a short list; the CLI has no such
constraint and refusing `--dpi 200` because it is not one of three blessed
numbers would be arbitrary. The bounds are not: below 36 the output is
illegible, and 600 dpi on a 248-page scan is roughly 40 GB of PNG and twenty
minutes of rendering — a number worth refusing rather than discovering.

---

## 11. Code layout

```
src/
├── core/
│   ├── types.ts          Job gains `unlock`; ConvertOptions gains dpi/pages
│   └── actions/
│       └── unlock.ts     NEW
├── engines/
│   ├── registry.ts       engineForJob matches source + target
│   ├── mupdf.ts          NEW  rasterise, unlock
│   └── pdf.ts            + image → PDF
├── cli/
│   ├── args.ts           --pages, --dpi, --unlock, --password-stdin
│   └── stdin.ts          NEW  read a password from stdin
└── shell/
    ├── components/
    │   └── Progress.tsx  NEW
    └── flows/
        └── convert.tsx   the page + resolution steps
```

---

## 12. Testing

- **Routing.** A PDF→JPEG job resolves to `mupdf`, a PNG→JPEG job to `image`,
  asserted by engine id. This is the regression that would otherwise be silent.
- **Rasterisation identifies its pages.** `makeMarkedPdf` gives each page a
  distinct width, so a rendered image's aspect ratio proves *which* page it
  came from — not merely that a file appeared. Extract's phase-3 defect,
  where naming and writing used different orderings, is exactly this class.
- **Rotation.** A page carrying `/Rotate 90` renders with its dimensions
  swapped.
- **Resolution.** 72/150/300 produce pixel dimensions in the expected ratio.
- **Unlock round-trip.** New fixture `makeEncryptedPdf`; probe reports
  `encrypted: true`, unlock succeeds, probe reports `false`. A wrong password
  produces the dedicated error.
- **The password never surfaces.** Drive a failing unlock and assert the
  password string appears in no error, result, or debug output.
- **Progress is real.** The emitted `page` events count from 1 to the true
  total, and no event is emitted by an operation whose length is unknown.
- **Images → PDF** stays one-in-one-out for a batch of ten.

---

## 13. Invariants

1. `core/` and `engines/` import no React, Ink or Chalk and write nothing to
   stdout — the new engine returns data; `Progress.tsx` renders it.
2. **No hardcoded format list.** PDF gains JPEG and PNG targets because an
   engine declares them. No menu is edited.
3. Sources are probed by content.
4. `.rotate()` before other Sharp operations — untouched.
5. Alpha flattening — untouched.
6. Writes are atomic, and multi-output jobs are all-or-nothing. A 248-page
   rasterisation that fails at page 200 leaves nothing behind.
7. **Progress is never fabricated.** The bar is determinate because the total
   is real.
8. **New for this phase: a password never surfaces.**

---

## 14. Not in phase 4a

Compress and split-under-a-size — phase 4b, where the measured-search
discipline belongs together.

Protect — see §1.

Markdown, HTML and Office conversion — phase 5, an independent engine that
reaches `/convert` through the capability graph.
