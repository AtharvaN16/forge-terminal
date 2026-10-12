# Forge — Resize and Trim edges

**Date:** 2026-10-12
**Status:** design approved in conversation; building on `feat/resize`
**Mockup:** `mockups/resize-2026-10.html` (built by `scripts/resize-mockup.ts`
from cells captured from the real app). Decided: tab "★ Resize slider" **H3**
and **X**; tab "2 · Resize and Trim in Enhance's list" **E3**.

---

## 1. Why

Two of the most-used Figma image utilities that Forge does not have, and that
suit a terminal: one file in, one file out, nothing to arrange by hand.

- **Resize**: make an image a different size, plainly. Forge has Boost
  resolution (AI, an extension, enlarges with invented detail) but nothing that
  just shrinks a 4000 px photo to 1200 px, or sets an exact width.
- **Trim edges**: cut transparent or solid-colour borders off the canvas.
  Remove background leaves the canvas its old size; Trim makes it fit.

Both are plain Sharp. No dependency, no download, instant.

## 2. Behaviour

### 2.1 Trim edges

- Cuts borders that are transparent, or one solid colour (Sharp `.trim()`,
  default threshold — the top-left pixel is the background).
- Asks nothing. Its row in Enhance shows the size after trimming:
  `empty edges off · 3610 × 2804`. Measured once when the list opens.
- Nothing to cut (the measured box equals the image): the row is dimmed with
  `no empty edges` and cannot be chosen, like Boost 4× over its limit.
- Animated GIF / WebP: refused (`animated-trim`) — the row is dimmed with
  `animated` and the CLI refuses. Trimming frame by frame is not reliable.
- Spike (2026-10-12, Sharp 0.35): `.rotate().trim()` trims the *upright*
  image (an orientation-6 JPEG trimmed to a portrait box); transparent edges
  trim; a uniform image comes back unchanged rather than throwing.

### 2.2 Resize

- **Slider** (Quality's G1 band): 0–200 %, **100 % in the middle**, left
  smaller, right larger; ←→ in steps of 5; never below 5 %. Under it,
  `smaller · same size · larger`. Starts at 100 %.
- Under the slider: `same size · 4032 × 3024` at 100 %, else
  `becomes 2016 × 1512`. Past 100 % one quiet line more:
  `stretched, so softer · Boost resolution adds detail`.
- **H3**: the `#` key cap and `type an exact size` sit beside the slider, on
  its row, inside the screen — as well as in the key row.
- **`#` → Exact size (R4)**: two filled boxes, `W` and `H`, holding the
  slider's current size. Typing over one makes the other follow (drawn dim —
  Forge worked it out). The shape is always kept; there is no unlock. tab
  moves between them; esc returns to the slider at the value it had; ↵
  confirms. Only digits are accepted; empty or 0 cannot be confirmed.
- Trail: `Resize ╱ Size`, and `Resize ╱ Exact size ╱ Size` after `#`.
- Animated images stay animated (Sharp resizes every frame).

### 2.3 Both

- **Format**: the source's own, by the rule Sharpen and Boost use
  (`keptFormat`: HEIC → JPEG, a format the engine cannot write → PNG).
- **Names**: `photo-trimmed.jpg`; `photo-2016x1512.jpg` (the result's size).
  Combined (CLI only): `photo-trimmed-50pct.jpg` / `-trimmed-1200w` / `-trimmed-900h`
  — the trimmed size is not known when outputs are planned.
- **Limits** (Boost's): no side over 16,384 px, no more than 100 MP; the
  smallest side is at least 1 px. Over the limit is refused before running,
  with the reason (`resize-too-large`), and the slider does not go past it.
- **Rounding**: `Math.round` of source × percent; a computed side under 1 → 1.
  Exact size: the typed side is exact, the other is `Math.round` of the ratio.
- Percent is of the **upright** size (after EXIF rotation), and of the
  trimmed size when trimming too.
- Shell flow after the row: Save as → Working → Done (X5, before and after
  side by side), as every Enhance tool.

## 3. Where it lives

### 3.1 Enhance's list (E3)

```
▌ Sharpen              same size · 4032 × 3024
  Boost resolution 2×
  Boost resolution 4×  195 MP, over 100 MP
  Remove background

  Trim edges
  Resize
```

One blank row between the AI tools and the plain ones, no label. Trim and
Resize need no extension: never "absent", never an install.

### 3.2 Pipeline

Resize and Trim are **options on the convert job**, not new job ops:

```ts
interface ConvertOptions {
  …
  /** Trim transparent or solid-colour edges (after EXIF rotation). */
  trim?: boolean
  /** The output size, of the upright (and trimmed) image. */
  resize?: ResizeSpec
}
type ResizeSpec = { percent: number } | { width: number } | { height: number }
```

`pipelineFor` in `src/engines/image.ts` applies them in this order:
`.rotate()` (invariant 4, still first) → `.trim()` → `.resize()` → flatten
→ metadata → encode. So atomic writes, HEIC, metadata, flattening and format
rules are the ones every conversion uses. Sharp resizes with Lanczos3.

`{ percent }` needs the upright (trimmed) size; the engine reads it from the
probe's dimensions (already upright) or, when trimming too, from the trim.

### 3.3 Core

- `src/core/resize.ts` (pure): `resizedSize(w, h, spec)`, `resizeOverLimit`
  (reuses `BOOST_MAX_SIDE` / `BOOST_MAX_PIXELS`), `resizeSuffix`, the slider's
  constants (`RESIZE_MIN 5`, `RESIZE_MAX 200`, `RESIZE_STEP 5`).
- `src/core/actions/resize.ts`: `resizeAction` and `trimAction` in `ACTIONS`,
  images only. Each plans one `convert` job per image with `target` =
  `keptFormat`, `options.resize` / `options.trim`, and the §2.3 name. Being in
  `ACTIONS` puts them in `forge probe` and the MCP's probe report.
- `keptFormat` moves from `src/shell/enhance.ts` to core (the shell imports it).
- Errors (`src/core/errors.ts`): `resize-too-large`, `nothing-to-trim`,
  `animated-trim`. A `nothing-to-trim` when also resizing is a warning
  (`nothing-trimmed`), and the resize goes ahead.

### 3.4 CLI

```
forge photo.jpg --resize 50%        percent, 1–200 (CLI allows 1, the slider 5)
forge photo.jpg --width 1200        height follows
forge photo.jpg --height 900        width follows
forge photo.jpg --trim
forge photo.jpg --trim --width 1200 --to webp -q 80
```

One of `--resize` / `--width` / `--height` at a time. Combinable with `--to`,
`-q`, `-o`, `--background`, `--keep-metadata`, `--recursive`, `--force`,
`--concurrency`, `--json`. Refused with `--max-size`, `--sharpen`, `--boost`,
`--remove-bg`, and the PDF page operations, with a one-line reason. Without
`--to` the format is kept (§2.3).

### 3.5 MCP

`forge_convert` gains optional `trim: boolean` and
`resize: { percent } | { width } | { height }`; `target` stays as it is.

### 3.6 Shell

- `src/shell/enhance.ts`: rows `trim` and `resize` (no `extension`), E3's gap.
  The Trim row's facts come from a measurement passed in (async, read once per
  source); until it arrives the row shows no detail.
- `src/engines/image.ts` exports `measureImage(source)` →
  `{ upright: Size, trimmed: Size | 'nothing' | 'animated' }`.
- The probe reports the **upright** size (Sharp's `metadata().autoOrient`),
  so the card, the slider and the names agree for a sideways phone photo.
- New screen `ResizeStep` (slider + H3 hint) and `ExactSizeStep` (W × H pair),
  drawn from art functions (`resize-art.ts`) so the mockup and tests share
  them. Quality's slider gets a centred variant rather than a copy.
- App wiring: choosing Trim goes straight to Save as; Resize goes to the
  slider; ↵ there (or in Exact size) goes to Save as.

## 4. Invariants

1–7 hold. Notably: rotate stays first (4); alpha still flattened when the kept
format cannot carry it (5); writes stay atomic (6) because the convert path
writes; no fabricated progress (7) — Working shows the spinner line only.
No hardcoded output-format list: the format comes from `targetIdsFor`.

## 5. Testing

Each test earns its place; no snapshot sprawl.

- Core: `resizedSize` rounding and the 1 px floor; limits; suffixes; the
  actions' plans (format kept, names).
- Engine (real Sharp, generated fixtures): orientation-6 JPEG trims upright;
  transparent edges trim; uniform image → `nothing-to-trim`; animated GIF
  resizes keeping its frames and refuses trim; RGBA → JPEG resize is
  flattened; percent of an EXIF-rotated source uses the upright size.
- CLI/MCP: flags parse; conflicts refused; a real run writes the right size.
- Shell: slider rows at 100 / 50 / 150 (centre, result line, the softer line);
  `#` → pair prefilled, typing W updates H, esc returns; Trim row measured and
  dimmed states; one end-to-end run through Save as to Done.

## 6. Out of scope

Crop to a different shape (cover/fill), unlocking the aspect ratio, resize in
Convert or Compress, batch resize in the shell (Enhance takes one image),
`--max-size` combined with resize, trim threshold or padding options.
