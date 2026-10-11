# Forge — lean and fast (0.2)

**Date:** 2026-10-11
**Status:** design approved in conversation; spec awaiting review
**Origin:** two measurement spikes run against `forge-terminal@0.1.0`
(`96e26a7`) on an Apple M2, Node 26.8.1 — a dependency audit and a
performance baseline. Every number below was measured, not estimated, unless
marked *(est.)*.

---

## 1. Why

Forge's premise is that it is fast and small. 0.1.0 is neither:

| | 0.1.0 measured |
| --- | --- |
| Global install | 188 MB, 105 packages |
| `forge --version` | 253 ms (Node's own floor is 26 ms) |
| Load time before any CLI work | ~230 ms, on every command |
| Shell, launch to first prompt | 968 ms (473 ms under `NO_COLOR`) |
| 50 JPEGs with `--max-size 50kb` | 36 s |

Two findings explain most of it:

1. **`pdf-parse` costs 83 MB and ~140 ms per run.** It is used for exactly one
   thing — `getText()` for PDF→DOCX (`src/engines/word.ts:213-221`). It pulls
   in `pdfjs-dist` (36.9 MB) and, through it, `@napi-rs/canvas` (24 MB of
   native Skia). pdfjs's legacy build `require`s the canvas binary at import
   and scans system fonts. Because `word.ts` imports `pdf-parse` at top level
   and the registry imports `word.ts` statically, **`forge --version` loads
   Skia.** The word-conversion spec (line 54) describes the canvas dependency
   as "unused here"; at runtime it is not.
2. **About a third of the install is never executed** — 43 MB of source maps,
   19 MB of `.d.ts`, and duplicate UMD/ESM/CJS/min builds. `es-toolkit`
   (18 MB, via Ink) is almost entirely type declarations.

## 2. Decision: PDF stays in core

The original proposal was to move the PDF stack into an optional extension.
The audit makes that not worth its friction. After §4.1 and §4.5 the PDF stack
is `@hyzyla/pdfium` (11.1 MB, of which the wasm is 4 MB) plus the ~1.7 MB of
`pdf-lib` that executes — roughly 12–15 MB *(est.)*. Asking a user to install
an extension to save that much is a worse experience than shipping it.

The extensions system is reserved for genuinely heavy, genuinely optional
capability — on-device models (boost, remove background), and later ffmpeg.
It gets its own spec.

`pdf-lib` stays. It is the only library that can write PDFs here: the pdfium
wrapper exposes no save, and the spike that made pdfium save did so by
overwriting a slot in the wasm's function table — not shippable.

## 3. Targets

Measured the same way as the baseline (medians of ≥11 warm runs, spawned
process, same machine). These are acceptance criteria.

| | 0.1.0 | Target |
| --- | --- | --- |
| Global install (`npm i -g` into an empty prefix, `du -sh`) | 188 MB | **≤ 40 MB** |
| `forge --version` | 253 ms | **≤ 60 ms** |
| Load overhead for an image conversion | ~230 ms | **≤ 100 ms** |
| Shell to first prompt, intro on | 968 ms | **≤ 600 ms** |
| 50 JPEGs, `--max-size 50kb` | 36 s | **≤ 12 s** |

No conversion's output bytes change, except where §4.6 fixes a bug.

## 4. Changes

### 4.1 Replace `pdf-parse` with pdfium's text extraction

`PDFiumPage.getText()` replaces `PDFParse.getText()` for PDF→DOCX on the
no-LibreOffice path.

- On two text-native PDFs (231 and 16 pages) pdfium matched page counts,
  agreed on 99.6% of words, and was faster (230 vs 399 ms; 58 vs 88 ms). Its
  `\r\n` line endings are already handled by `splitParagraphs`.
- **Before switching, widen the evidence.** A comparison test runs both
  extractors over a fixture set covering: multi-column layout, right-to-left
  text, CJK, ligatures, a Type3 font, and a scanned (image-only) PDF. The
  switch proceeds if pdfium is at least as good on each; any regression is
  recorded in this spec as a known limitation or blocks the change.
- The 4a spec's one-library-per-file rule holds: pdfium text extraction is
  exported from `src/engines/pdfium.ts`, and `word.ts` calls it.
- The encrypted-PDF refusal in `word.ts` (line 389) already precedes
  extraction and is unaffected.
- Three tests use `PDFParse` as an oracle (`word-convert.test.ts`,
  `word-fallback-text.test.ts`, `word-libreoffice-convert.test.ts`). They
  switch to pdfium, or to a fixed expected string where the fixture is ours.
- `pdf-parse` is removed from `dependencies`. This restores the "no native
  bindings beyond Sharp" property from the 4a spec (lines 84-87).

### 4.2 Load only what the command needs

Today `src/index.ts` statically imports `src/cli/execute.ts` (237 ms on its
own), which imports the registry, which imports every engine and every engine
library.

1. **Parse first, import second.** `index.ts` parses arguments with
   `src/cli/args.ts` (8 ms), answers `--version` and `--help` without importing
   anything else, and dynamically imports `execute.ts` only when there is work.
2. **Engines declare capability eagerly and load libraries lazily.** Each
   engine module keeps `id`, `reads`, `writes`, `ops` and `probe` ordering as
   cheap static data, and moves its heavy import (`sharp`, `pdf-lib`,
   `@hyzyla/pdfium`, `mammoth`, `word-extractor`, `docx`) behind a cached
   `load()` called from `probe`/`run`/`measurer`. `docx` already works this
   way (`word.ts`, commit `bb3cb09`) — this generalises it.
   - Invariant 2 holds: `targetsFor()` still reads `reads`/`writes` from every
     registered engine. Nothing hardcodes a list to decide what to load.
   - Invariant 3 holds: probing is still by content and in the same order. A
     probe may load its engine's library; that is the point at which it is
     needed.
3. **Compile cache.** `module.enableCompileCache()` at the top of the entry
   point (measured −25 ms per run). Guarded so Node versions without it are
   unaffected.

Measured with only the `pdf-parse`/`mammoth` part of this applied: `--version`
253 → 113 ms, each image conversion −140 ms.

### 4.3 The shell's intro overlaps loading

The intro (4 frames × 130 ms = 520 ms) starts only after `launch.js` has
finished importing (~370 ms), so the two add up. Start `playIntro` before
`await import('./shell/launch.js')` and let the import run during the
animation; the prompt appears at `max(animation, import)` rather than their
sum.

- `applyColourPreference()` must still run before Ink or chalk is imported —
  nothing moves ahead of it.
- The intro's look is not changed here. The shell redesign happening in
  parallel owns that.

### 4.4 `--max-size` runs in parallel

`execute-jobs.ts:123` runs each file's quality search one at a time, about 8
encodes each, re-decoding the source on every attempt. Searches go through the
same concurrency pool conversions already use (`src/core/run.ts`), and each
search decodes its source once and encodes from that buffer.

- Write-safety checks still run before any search starts.
- Cancellation behaves as today.
- Progress stays real (invariant 7): per-file completion, no percentage within
  a search.
- Expected 36 s → ~9–10 s for 50 files *(est., from the measured 1→4 worker
  scaling)*.

### 4.5 Ship one bundled file

The published package ships a single esbuild bundle instead of `tsc` output.

- `sharp` and `@hyzyla/pdfium` stay external `dependencies` — they carry
  native binaries or a wasm file and must be installed, not inlined.
- Everything else (Ink, React, commander, pdf-lib, mammoth, docx, …) is
  bundled, so their maps, type declarations and duplicate builds never reach
  the user. They move to `devDependencies`.
- Lazy imports from §4.2 become separate chunks (esbuild `splitting`, ESM), so
  bundling does not undo lazy loading.
- Ink imports `react-devtools-core` optionally; it is aliased to an empty stub.
- Source maps are not shipped. `--debug` still prints stack traces; they point
  at bundle lines.
- `tsc` remains the typechecker (`npm run typecheck`). Tests keep running
  against source via vitest.
- One end-to-end suite runs against the built bundle, so a bundling mistake
  (a missed external, a broken dynamic import) fails CI rather than a user.
- Measured spike: a 2.3 MB bundle passed `--version`, PDF→PNG and PDF→DOCX.
  Sharp + pdfium installed measure 30.7 MB, so the total is ~33 MB *(est. —
  sum of measured parts)*.

### 4.6 Fix: `--to <format> --max-size` ignores the size

`src/cli/args.ts:302` honours `--max-size` only when `--to` is absent, and the
convert intent has no field for it, so `--to jpeg --max-size 50kb` produced a
75.5 KB file with no warning. A target size given with `--to` is applied to
that target, through the same search compress uses. If the target cannot be
size-searched (it is lossless), Forge refuses with the existing error instead
of ignoring the flag.

## 5. Not changing

Recorded so they are not re-proposed without new evidence:

| Idea | Why not |
| --- | --- |
| mozjpeg → libjpeg-turbo | −60 ms per JPEG but ~21% larger files. mozjpeg is a deliberate spec default. |
| PNG `compressionLevel` 9 → 6 | −33 to −100 ms per PNG for 10–16% larger files. The code says 9 and the original spec says "effort 7" — that disagreement needs its own decision, not a drive-by. |
| Replace `docx` with a hand-written OOXML writer | Saves 21 MB unbundled, but bundling (§4.5) removes most of that for free. |
| Move PDF into an extension | §2. |
| HEIC intermediate PNG → TIFF | ~17 ms. Not worth the change. |

## 6. Invariants

- **1** — no lazy import moves output into `core/` or `engines/`; all output
  stays in `src/index.ts`, `src/cli/` and `src/shell/`.
- **2, 3** — §4.2.
- **4, 5** — untouched; no engine's operation order changes.
- **6** — untouched.
- **7** — §4.4.

## 7. Testing

- **Size and speed are tests, not claims.** A script
  (`scripts/bench.mjs`) reproduces the §3 measurements from a packed tarball
  installed into a temp prefix and prints them against the targets. It runs
  on demand and before a release, not in the unit suite — wall-clock
  assertions in CI are flaky.
- **A guard against regressions:** a unit test asserts that running
  `--version` does not load `sharp`, `pdf-lib`, `@hyzyla/pdfium`, `mammoth`,
  `ink` or `react` (via a module-load hook), so a stray static import fails
  the suite instead of quietly costing 100 ms.
- §4.1 comparison fixtures, §4.4 parallel-search behaviour (including cancel
  and write-safety ordering), §4.6 regression test.
- The full existing suite passes unchanged, apart from the three oracle swaps
  in §4.1.

## 8. Order

§4.2 (lazy loading) lands first — it is small, and the AI-native work
(separate spec, same date) touches `src/index.ts` and `src/cli/execute.ts`
too. After it, §4.1, §4.3, §4.4 and §4.6 are independent. §4.5 lands last,
since it changes how everything above is packaged and is where the install
target is met.
