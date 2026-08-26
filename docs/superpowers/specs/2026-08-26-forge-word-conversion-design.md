# Forge — PDF ⇄ Word (DOCX/DOC) Conversion — Design

**Date:** 2026-08-26
**Status:** Draft, pending review
**Depends on:** [2026-08-19-forge-design.md](2026-08-19-forge-design.md), the PDF work in
[2026-08-20-forge-phase-3-pdf-design.md](2026-08-20-forge-phase-3-pdf-design.md) and
[2026-08-20-forge-phase-4a-pdf-pixels-design.md](2026-08-20-forge-phase-4a-pdf-pixels-design.md)

---

## 1. What this adds

PDF → DOCX, PDF → DOC (read only — see §3), DOCX → PDF, and DOC → PDF. This is
the first non-Sharp, non-pdf-lib document format Forge handles, and the first
feature where the *result's fidelity* is not guaranteed — that is new enough
to this codebase's quality bar that it gets its own section (§4).

Out of scope: `.doc` as a write target, and every page operation
(`merge`/`split`/`extract`/`delete`/`rotate`) for Word documents. Those stay
PDF-only.

---

## 2. Why this needs a new mechanism, not just a new engine

Every existing engine (`image.ts`, `pdf.ts`, `pdfium.ts`) manipulates bytes
Forge already understands the structure of — pixels, or a PDF's own page
tree. A DOCX is reflowable content with no fixed layout; a faithful
conversion to or from PDF's fixed-page model means actually understanding
paragraphs, tables, fonts and page breaks. Nothing already in the dependency
tree does that (`pdf-lib` manipulates PDF structure but does not lay out
text; `pdfium` only rasterises to pixels).

**Verified on this machine:** no `soffice`, `libreoffice`, `pandoc`, or
`unoconv` on `PATH`, and no `LibreOffice.app` in `/Applications`. `textutil`
(macOS's built-in text converter, already load-bearing for nothing here but
precedent for "shell out to a system tool," per `heic.ts`) converts among
`txt html rtf rtfd doc docx wordml odt webarchive` — **no `pdf`, in either
direction.** So there is no system tool on a stock Mac that does this at all.

---

## 3. Decisions

| Decision | Rationale |
| --- | --- |
| Hybrid engine: LibreOffice when present, npm-only fallback otherwise, never blocking | Your call. Keeps the feature always-available while rewarding the user who installs LibreOffice with real fidelity, at the cost of two code paths. |
| `doc` is read-only (no `pdf → doc`) | `targetIdsFor()` is computed from each engine's *static* `reads`/`writes` sets (invariant 2) — it cannot branch on "is LibreOffice installed right now" without breaking that shape. Keeping `doc` out of `writes` avoids the graph ever depending on a runtime check. Matches existing precedent: `heic` is already "a source only" for a symmetric reason (Sharp can decode it but not encode it). |
| `doc → docx` is offered "for free" | Not asked for, but falls straight out of the capability graph once the word engine reads `doc` and writes `docx` — the same composition that lets a HEIC photo be offered WebP/AVIF/etc. today. A legitimate, harmless side effect (turning a legacy file into a modern one), so it is kept rather than filtered out. |
| No page operations (merge/split/extract/delete/rotate) for Word sources | Those operate on a fixed page tree pdf-lib understands. A DOCX has no such thing until something renders it. Adding paged operations to a reflowable format is a separate, much larger feature than "convert." |
| LibreOffice detected once per process, cached | Same pattern as `heic.ts`'s `heicDecodable()`. "Install it and try again" naturally picks it up on the next run — no invalidation logic needed. |
| A failed LibreOffice invocation is a conversion failure, not a silent fallback trigger | Only "LibreOffice isn't installed" is a capability gap that triggers the npm path. A corrupt DOCX that makes `soffice` exit non-zero is a real failure — silently retrying with the weaker path could produce a plausible-looking but wrong result from the same bad input, which is worse than a clear error. |
| Fallback text extraction is genuinely plain — no heading/bullet/table reconstruction | The warning already sets the expectation ("basic formatting only"). Rebuilding partial HTML-like fidelity by hand duplicates exactly what LibreOffice already does correctly, for a result that's still not trustworthy enough to skip the warning. YAGNI. |
| New dependencies: `mammoth`, `docx`, `pdf-parse`, `word-extractor`, `cfb`, `adm-zip` | Six single-purpose libraries rather than one framework. Five are pure JS; `pdf-parse` carries a native `@napi-rs/canvas` dependency it uses for its screenshot/table features (unused here — only `getText()` is called), distributed as prebuilt per-platform binaries the same way Sharp already is. Either way, no native compilation step is added to `npm install`, which the README currently calls out as Sharp's job alone — that property, not "pure JS/WASM" as a goal in itself, is what's load-bearing. |

---

## 4. A new kind of result: fidelity is not guaranteed

Every existing conversion in Forge either succeeds correctly or fails
outright. This feature adds a third outcome: **succeeds, but plainer than the
original.** That is surfaced the same way invariant 4's animation-flattened
case already is — a `Warning` on the `Result`, rendered by both front ends
without new UI:

```ts
{
  code: 'word-basic-fidelity',
  message:
    "Converted with basic formatting only — tables, images, and complex " +
    "layouts weren't preserved. Install LibreOffice for full-fidelity " +
    "conversion: brew install --cask libreoffice",
}
```

Added to the `Warning['code']` union in `core/types.ts`. Emitted whenever the
npm fallback path runs, never when LibreOffice did the conversion.

---

## 5. Format registry

```ts
// core/types.ts
export type FormatId =
  | 'jpeg' | 'png' | 'webp' | 'avif' | 'heic' | 'gif' | 'tiff' | 'pdf'
  | 'docx' | 'doc'
```

```ts
// core/formats.ts
docx: {
  id: 'docx', label: 'DOCX', extensions: ['.docx'],
  hasAlpha: false, animatable: false, lossy: false,
  hint: 'Word document',
},
doc: {
  id: 'doc', label: 'DOC', extensions: ['.doc'],
  hasAlpha: false, animatable: false, lossy: false,
  hint: 'legacy Word',
},
```

`lossy: false` for both — same reasoning as `pdf`: quality is not a concept
that applies, so `convertAction` never shows a quality slider for these
targets. No `defaultQuality`.

`DocumentInfo` is reused unchanged — no new fields, no type change:

- `pages`: for DOCX, read from the cached `<Pages>` value in
  `docProps/app.xml` when present (Word and LibreOffice both write this on
  save; it costs one small zip-entry read, not a render). Absent → `0`,
  meaning "unknown," the same value the codebase already treats as "nothing
  to show" via its existing `?? 0` fallbacks (`core/actions/split.ts`'s
  `appliesTo`, `cli/execute.ts`'s `pageCount`). For `.doc`, always `0` —
  extracting a legacy binary format's cached page count is real added
  complexity for a number that is purely decorative.
- `encrypted`: always `false`. Detecting or unlocking a password-protected
  Word document is out of scope; if one is encountered, the parse fails and
  surfaces as the existing `corrupt-source` error — an acceptable known
  limitation, not a new user-facing path.
- `images`: left `undefined`. There is no "compress a DOCX" concept, so
  `compressAction.appliesTo` (which reads `images?.compressible ?? 0`)
  correctly never offers `/compress` for a Word source without any change
  there.

One rendering fix is needed because `pages` can now legitimately be `0`:
`shell/components/FileCard.tsx` currently always renders `` `${source.pages}
pages` `` for a document. Changed to omit that fact entirely when
`pages === 0`, so a `.doc` file's card reads `45 KB` rather than the
misleading `0 pages · 45 KB`.

---

## 6. Content-based probing (invariant 3)

**DOCX** is a zip. Read via `adm-zip` (small, synchronous, in-memory — a
perfect fit for files this size) and confirmed by the presence of the
`word/document.xml` entry, which only a WordprocessingML document has
(`.xlsx` has `xl/workbook.xml`, `.pptx` has `ppt/presentation.xml` — the
same OOXML container, different content). The `<Pages>` value, if any, is
read from `docProps/app.xml` in the same pass with a plain regex — matching
the codebase's existing light-touch style for one-off value extraction
(`heic.ts`'s `pixelWidth`/`hasAlpha` regexes).

**DOC** is an OLE2 compound file, signature `D0 CF 11 E0 A1 B1 1A E1` at byte
0 — shared with `.xls`, `.ppt`, and `.msi`, so the signature alone is not
enough. Confirmed via `cfb` (a small, pure-JS compound-file directory reader,
already a transitive part of the SheetJS ecosystem) by checking for a
`WordDocument` stream, which only the legacy Word format has. `cfb` is used
for this cheap directory read only — the full parse happens later, inside
`word-extractor`, only when a `.doc` is actually converted.

Both checks are content-based, never the extension, matching `heic.ts`'s
`looksLikeHeic` precedent exactly.

---

## 7. The engine (`src/engines/word.ts`)

```ts
export const wordEngine: Engine = {
  id: 'word',
  reads: new Set(['docx', 'doc']),
  writes: new Set(['docx']),
  ops: new Set(['convert']),
  probe,
  run,
}
```

Registered in `engines/registry.ts` as
`[imageEngine, pdfEngine, wordEngine, pdfiumEngine]` — anywhere before
`pdfiumEngine`, which the existing comment already documents must stay last
because it never probes. `imageEngine` declines a zip/OLE file's bytes via a
failed Sharp `metadata()` call and `pdfEngine` declines via a failed pdf-lib
load, the same way each already declines every format it doesn't own.

**Dispatch, independent of which specific formats are involved:**

```
if libreOfficeAvailable():
  bytes = runSoffice(source.path, job.target)     // --headless --convert-to <ext>
else:
  text  = extractPlainText(source)                // by source.format: docx→mammoth, doc→word-extractor, pdf→pdf-parse
  bytes = job.target === 'pdf' ? layoutAsPdf(text) : buildDocx(text)
  warnings.push(basicFidelityWarning)
writeAtomic(job.outputs[0], bytes)
```

This is deliberately pair-agnostic rather than one function per direction.
LibreOffice's `--convert-to` already handles any pair uniformly (it doesn't
care what the input was, only what format to resave as), so the only
branching the npm fallback needs is "extract text" (by source format) and
"lay it back out" (by target format) — two small, composable functions
instead of a combinatorial table. This also means the CLI's own-format
recompress convention (`forge doc.pdf --to pdf`, already supported for
images and PDFs today) extends to Word documents for free: `docx → docx`
via `--to docx` on a `.docx` file runs the exact same dispatch and produces
a re-saved copy, the same honest (if not very useful) behaviour `pdf → pdf`
already has via `pdfEngine`'s `compressDocument`. It needs no special case
because nothing here treats same-format as different from any other pair.

**LibreOffice detection**, cached per process like `heicDecodable()`:

```ts
async function libreOfficeAvailable(): Promise<boolean>
```

Tries `soffice` on `PATH` first (Node resolves a bare command via the OS's
own `PATH` search, the same as typing it in a shell), then falls back to the
fixed Homebrew-cask install location,
`/Applications/LibreOffice.app/Contents/MacOS/soffice`, since a cask install
does not put `soffice` on `PATH` by itself. Whichever resolves is cached (the
path, not just a boolean) for the process's remaining conversions.

**Failure handling:** if `libreOfficeAvailable()` was true but the actual
`soffice --convert-to` invocation for a given file fails (non-zero exit,
timeout), that surfaces as the existing `conversion-failed` mapping — it does
**not** fall back to the npm path (§3's rationale). Only "not installed at
all" routes to the fallback.

**PDF layout (`layoutAsPdf`)**, used when the target is `pdf` and LibreOffice
is unavailable: paragraphs (split on blank lines) word-wrapped at a fixed
margin on US Letter pages using `pdf-lib`'s built-in Helvetica metrics
(`widthOfTextAtSize`) to find line breaks, paginating whenever the next line
would cross the bottom margin. One font, one size, no headings, no lists —
per §3, matching what the warning already promises.

**DOCX build (`buildDocx`)**, used when the target is `docx`: one paragraph
per extracted line via the `docx` package. Same "plain, not styled"
treatment.

---

## 8. Fixing three places that assumed "document" meant "PDF"

`DocumentInfo`/`kind: 'document'` was PDF-only until now. Three existing,
correctly-working files assumed that and need a small, targeted fix each —
not because this feature is elegant to add, but because without these fixes
dropping a `.docx` file would silently offer broken actions.

**a) `core/actions/convert.ts`.** Its `options()` and `plan()` currently
branch on `source.kind === 'document'` alone to decide "this is a
rasterisation — show the pages/dpi pickers and produce one output per page."
That was a safe shortcut while the only non-image target was `jpeg`/`png`
rasterisation of a PDF; it stops being safe the moment a document's target
can also be `pdf` or `docx`. Fixed by checking what the target actually is,
reusing the exact concept `cli/execute.ts` already has (currently a private,
duplicated `rasterises()`), promoted to a shared export in
`core/capabilities.ts`:

```ts
export function rasterises(target: FormatId): boolean {
  return pdfiumEngine.writes.has(target)
}
```

`convert.ts` branches on `source.kind === 'document' && rasterises(target)`
instead of `source.kind === 'document'` alone; `cli/execute.ts` imports the
shared function instead of keeping its own copy. `pdf → docx`, `docx → pdf`,
and `doc → pdf` all then fall through to the same single-output path an
image conversion already uses — no pages picker, no per-page output naming,
which is correct, since none of those are rasterisations.

**b) `core/actions/{merge,split,extract,rotate}.ts`.** Each gates on a
`soleDocument`/`documents` helper checking only `kind === 'document'`. Once
DOCX/DOC are also `kind: 'document'`, a dropped `.docx` would be offered
`/merge`, `/split`, `/extract`, and `/rotate` — actions that hand it straight
to `pdf-lib`'s `PDFDocument.load()`, which is not a PDF parser for anything
else, and would fail with an opaque error deep inside the run instead of the
action simply not being offered. Fixed by tightening each helper to also
require `format === 'pdf'`, since page operations are — and, per §3, remain
— PDF-only.

**c) `shell/components/FileCard.tsx`** — covered in §5 above (omit the pages
fact when it's `0`).

**d) `engines/image.ts`'s `encode()`.** Its `switch (target)` already has an
explicit case per `FormatId` with no `default` — including `case 'pdf':
throw ...` for a target the image engine's capability graph should never
route here. TypeScript strict mode requires the two new members to be
covered the same way, so this needs the same one-line
`case 'docx':`/`case 'doc': throw new Error(...)` treatment as the existing
`heic`/`pdf` cases — not new behaviour, just keeping the switch exhaustive.

---

## 9. Errors

No new `ErrorCode`. A corrupt or unreadable DOCX/DOC surfaces through the
existing `probe()`/`fs.stat`+`fs.access` guard exactly like every other
format (`file-not-found`, `permission-denied` before the file is ever handed
to a parser); a file that parses as the wrong content for its probe (an
`.xlsx` renamed to `.docx`, say) fails the `word/document.xml` check and is
reported `unsupported-source`, the same as any other content mismatch. A
mid-conversion parser failure (mammoth, word-extractor, pdf-parse, or
`soffice` itself) maps to `conversion-failed`, matching how a Sharp failure
already does today.

---

## 10. Testing

Fixtures generated at test time, no committed binaries — this project's
existing rule, extended:

- `.docx` fixtures via the `docx` package (mirrors how PDF fixtures already
  use `pdf-lib` directly).
- `.doc` fixtures via `textutil -convert doc` on a generated `.txt`/`.rtf` —
  a system tool already precedented by `heic.ts`'s use of `sips`, and the
  only way to produce a genuine legacy-binary `.doc` without a committed
  binary.

**Always-run coverage (the npm fallback path — this machine, and most CI,
has no LibreOffice):**

- Content-based probing: a `.docx` and a `.doc` fixture are correctly
  identified regardless of a wrong extension; an `.xlsx` renamed to `.docx`
  is correctly rejected.
- `docx → pdf`, `doc → pdf`, `pdf → docx` each produce a valid, non-empty
  output file and a `word-basic-fidelity` warning.
- `docx → docx` (the free same-format case) round-trips without error.
- The three tightened `appliesTo` checks: a `.docx` source is correctly
  refused by `/merge`, `/split`, `/extract`, `/rotate`.
- `FileCard` renders no page count for a `.doc` source (`pages === 0`).

**LibreOffice-path coverage, skipped with a clear message when `soffice`
isn't found** (the existing `heic.ts` sips-skip pattern) — same three
directions, asserting no warning is attached and that a corrupt input
produces `conversion-failed` rather than a silent fallback.

---

## 11. What's explicitly not built here

- `.doc` as a write target.
- Page operations (merge/split/extract/delete/rotate) on Word documents.
- Any structure-aware fallback (headings, tables, images, columns) beyond
  plain paragraphs — that is LibreOffice's job in this design, not the
  fallback's.
- Detecting or unlocking password-protected Word documents.
- A settings/preference to force one path over the other — the dispatch is
  automatic and unconditional, per your answer.
