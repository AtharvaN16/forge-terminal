# Forge — Crop to shape

**Date:** 2026-10-13
**Status:** design approved in conversation; spec awaiting review
**Mockup:** `mockups/crop-2026-10.html` (built by `scripts/crop-mockup.ts`
from cells captured from the real app). Decided: preview **P3 · outside
hatched**; the row (tab 2); one-axis moves (tab 3); zoom (tab 4).

---

## 1. Why

Resize changes an image's size; nothing in Forge changes its **shape**. A
landscape photo that has to be a square avatar, a 4:5 post or a 9:16 story is
cut by hand in another app today. Crop to shape does it in Enhance, keeps the
subject in the frame, and never scales: every kept pixel is the original.

It is plain Sharp — no dependency, no download, Mac and Windows alike.

## 2. Behaviour

### 2.1 The row

- A built-in row in Enhance's list, after **Resize** in the plain group (E3):
  never absent, never an install.
- Highlighted, it carries Boost's pill at the band's far end: `‹ 1:1 ›`.
  **←→ steps 1:1 · 4:5 · 16:9 · 9:16**; an arrow is grey where there is no
  step. A shape the photo already has (its largest box is the whole image) is
  left out of the pill.
- The pane (S1): `Changes the shape.` (bold) · `Cuts it to a new shape around
  the subject. You see the crop next and can move it.` · last line
  `becomes 3024 × 3024` — the largest box of that shape, `becomes` dim and the
  size bold.
- Animated GIF / WebP: the row is dimmed with `animated` (as Trim is).
- ↵ opens the preview at the shape on the pill.

### 2.2 The preview (P3)

```
 enhance ╱╱╱╱╱╱╱╱╱╱╱╱╱╱╱╱╱╱╱╱╱╱╱╱╱╱╱╱╱╱╱╱╱ Crop to shape ╱ 1:1 ╱╱
 ╭─ JPEG ──────────────────────────────╮
 │ IMG_2041.jpg                        │
 │ 4032×3024 · 71.7 KB                 │
 ╰─────────────────────────────────────╯

 Crop to 1:1

   ╱╱╱╱▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀      3024 × 3024 · 1:1
   ╱╱╱╱▀▀▀▀▀▀▀▀ (the photo) ▀▀▀▀▀▀      keeps 75 % of the photo
   …
 ──────────────────────────────────────────────────────────────
   ←→  move   +−  zoom   ↵  confirm              1–5 mode · esc back
```

- **The picture**: the whole photo in half-blocks (`▀`, fg = top dot, bg =
  bottom dot — the glyph Done's fallback already uses), at column 4 under the
  title, as tall as the rows between the title and the key row allow, its
  width from the photo's aspect. It shrinks so a 26-column facts column
  always fits to its right.
- **Outside the crop (P3)**: a cell wholly outside is `╱` over its own colour
  faded towards the canvas (bg = the mean of its two dots, each mixed 72 %
  towards `canvas` in dark, 70 % in light; fg = that mixed half way to
  `border`). A cell half inside keeps `▀` with only its outside dot faded.
  Inside: the photo's own colours.
- **Facts**, right of the picture: `3024 × 3024` bold + ` · 1:1` dim; under it
  `keeps 75 % of the photo` dim (the crop's area as a share of the photo's,
  rounded). Nothing else — no "starts on the subject" / "moved" lines.
- **Trail**: `Crop to shape ╱ 1:1`. **Title**: `Crop to 1:1`.
- **Opens on the guess**: the largest box of the shape, placed where Sharp's
  attention strategy puts it (§3.2).

### 2.3 Keys

| Key | Does | In the key row |
| --- | --- | --- |
| ←→ / ↑↓ | Move the crop one step | only the arrows that can move it: `←→ move`, `↑↓ move`, or `↑↓←→ move` once zoomed in |
| `+` (also `=`) | Zoom in: the crop shrinks around its centre | `+− zoom`, always |
| `−` (`-`) | Zoom out, back to the largest | (same entry) |
| `r` | Reset: back to the guess, zoom 100 % | `r reset`, only once the crop has moved or zoomed |
| ↵ | Confirm → Save as | `↵ confirm` |
| esc | Back to the list, the shape kept on the pill | in the tail |

- **One step** = one dot of the drawn picture along that axis (photo side ÷
  picture dots, rounded, at least 1 px), so every press visibly moves the
  hatch. Terminal key repeat does the rest.
- **At the largest crop** it spans the whole width or the whole height, so
  only one pair of arrows moves it: ←→ for a shape narrower than the photo,
  ↑↓ for one wider. An arrow that cannot move (at an edge, or on the spanned
  axis) does nothing.
- **Zoom**: the box side is a percentage of the largest box's — 100 → 90 → …
  → 20, ten points a step. `+` at 20 % and `−` at 100 % do nothing. The
  centre is kept, then the box is clamped inside the photo.
- Ctrl/Cmd + arrows were considered and rejected: Ctrl ↑↓ is macOS Mission
  Control / App Exposé (on by default) and never reaches the terminal; Cmd
  reaches a program only under the kitty keyboard protocol (see the
  mouse-and-cmd-keys spec §7).

### 2.4 After the preview

Save as → Working (W5, spinner line only) → Done (X5, kind `whole`: before and
after side by side, both whole), as every Enhance tool.

### 2.5 Rules

- **Format**: `keptFormat` (HEIC → JPEG, unwritable → PNG), as Trim/Resize.
- **Name**: `photo-cropped-1x1.jpg` (the shape, `:` → `x`). With a CLI resize:
  `photo-cropped-1x1-1080x1080.jpg` (the size is known at plan time — the CLI
  crop is always the largest box).
- **Upright**: every box is in upright pixels (after EXIF rotation). Spike
  (2026-10-13, Sharp 0.35.5): an orientation-6 JPEG stored 40 × 80
  `.rotate().extract({ left: 60, top: 0, width: 20, height: 40 })` cuts the
  upright 80 × 40 image correctly, and attention's offsets are upright too.
- **Never scaled**: the written size is the box's size (unless a CLI resize
  follows). No upper limit applies; the box is never larger than the source.
- **Animated**: refused (`animated-crop`), like trim.

## 3. Where it lives

### 3.1 Core

- `src/core/crop.ts` (pure):
  - `CROP_SHAPES` — the pill's four (`{ w, h, label }`). Shapes, not output
    formats: invariant 2 is about formats.
  - `largestBox(size, aspect)`, `shapesFor(size)` (drops a shape whose
    largest box is the whole image), `zoomedBox(size, aspect, centre, pct)`,
    `movedBox(size, box, dx, dy)` (clamped), `movableAxes(size, box)`,
    `keptShare(size, box)`, `cropSuffix(aspect)`, `parseAspect('16:9')`.
  - Constants: `CROP_ZOOM_MIN 20`, `CROP_ZOOM_STEP 10`.
  - `sampleDots(thumb, cols, rows)`: area-average a thumbnail's RGB into a
    `cols × rows*2` dot grid, for the preview. Data only.
- `src/core/types.ts`: `ConvertOptions.crop?: CropSpec` with
  `CropSpec = { aspect: { w: number; h: number }; box?: Box }` and
  `Box = { left; top; width; height }` (upright px). No `box` → the engine
  places the largest box by attention (the CLI and MCP path).
- `src/core/actions/resize.ts`: `planEdit` gains `crop`; new `cropAction` in
  `ACTIONS` (images only, not animated), verb `Cropping`, hint `change the
  shape`. The shell passes `crop` (with its box) through the action's values.
- Errors (`src/core/errors.ts`): `animated-crop`; `nothing-to-crop` when the
  photo already has the shape (CLI) — a warning `nothing-cropped` when a
  resize was also asked, and the resize goes ahead (as trim does).

### 3.2 Engine (`src/engines/image.ts`)

- `pipelineFor` order: `.rotate()` (invariant 4, still first) → `.extract(box)`
  → `.resize()` → flatten → metadata → encode. Trim and crop never meet (§3.3).
- `run` resolves a box-less crop once, before writing: `guessCrop` on the
  source, then hands the box to the pipeline (as it resolves Resize's size).
- `loadCropView(source)` → `{ size: Size; thumb: { width; height; rgb } }`:
  the upright photo decoded once to at most 1024 px on its long side (HEIC
  through the usual `sips` path). Read when the preview opens.
- `guessCrop(input, size, aspect)` → `Box`: Sharp
  `resize(w, h, { fit: 'cover', position: sharp.strategy.attention })` on the
  1024 px thumbnail, its `cropOffsetLeft/Top` (negative) scaled back to full
  size and clamped. Measured: attention can prefer a bright sky to a person
  (the mockup's first scene picked a sun) — the reason the preview exists.

### 3.3 CLI

```
forge photo.jpg --crop 1:1
forge photo.jpg --crop 4:5 --width 1080 --to webp
forge *.jpg --crop 16:9 -o out/
```

- `--crop <W:H>`: any ratio of two whole numbers 1–100 (the shell offers four;
  the CLI need not limit them). Placed by attention, largest box, no zoom.
- Combinable with `--resize/--width/--height` (applied to the cropped image),
  `--to`, `-q`, `-o`, `--background`, `--keep-metadata`, `--recursive`,
  `--force`, `--concurrency`, `--json`.
- Refused with `--trim` (two cuts whose order would surprise), `--max-size`,
  `--sharpen`, `--boost`, `--remove-bg` and the PDF page operations — the
  existing one-line clash message.

### 3.4 MCP

`forge_convert` gains `crop: string` (`"1:1"`, any `W:H` as the CLI), placed
by attention. Same refusals as the CLI.

### 3.5 Shell

- `src/shell/enhance.ts`: row `crop` (no `extension`) after `resize`, with
  `shapes` like Boost's `scales`; `rowValues` carries the shape.
  `EnhancePicker` generalises Boost's pill to any row with steps (one pill,
  not a copy).
- `src/shell/crop-art.ts` (pure): the picture rows (P3 hatch), the facts, the
  key row's entries for a state — shared by the component, its tests and the
  mockup.
- `src/shell/components/CropStep.tsx`: loads `loadCropView` + `guessCrop` once
  per source and shape, keeps `{ box, zoom }`, maps keys. While loading,
  the picture area is empty (no fabricated progress; the load is short).
- **No colour** (NO_COLOR, `chalk.level` 0): no picture, as Done. The facts
  and keys still work; in the picture's place one dim line
  `left 1,008 px · top 0 px` says where the crop sits.
- App wiring: the `crop` row → step `crop` → ↵ → Save as. esc → `enhance`.

## 4. Invariants

1–7 hold. `core/` returns data only (the dot grid is numbers; drawing is in
`crop-art.ts`). No output-format list: the format is `keptFormat` via
`targetIdsFor`. Sources stay probed by content. Rotate stays first. Alpha is
flattened by the existing rule. The write is the convert path's atomic write.
No progress is shown beyond W5's spinner line.

## 5. Testing

- Core: `largestBox` for each shape on landscape, portrait and square sizes;
  `shapesFor` drops the photo's own shape; `zoomedBox` keeps the centre and
  clamps at edges; `movedBox` clamps; `movableAxes` one axis at 100 %, both
  when zoomed; `keptShare`; `parseAspect` rejects `0:1`, `1:0`, `a:b`,
  `101:1`; names with and without resize; `sampleDots` averages.
- Engine (real Sharp, generated fixtures): orientation-6 JPEG crops upright;
  `guessCrop` puts a 1:1 box over a saturated subject on one side; a box-less
  crop resolves before writing; crop then resize writes the resized size;
  RGBA → JPEG crop is flattened; animated refused; already-that-shape refused.
- CLI/MCP: `--crop` parses; clashes refused; a real run writes the right size
  and name.
- Shell: the row's pill steps and skips the photo's own shape; preview opens
  on the guess; ←→ moves one dot, edge stops; `+` frees both axes and changes
  the key row; `r` appears only after a change and restores the guess; esc
  returns with the shape kept; one run through Save as to Done. Light mode
  parity through `scripts/light-audit`.

## 6. Out of scope

Free ratios in the shell, rotating or straightening, several images in the
shell (Enhance takes one), mouse dragging of the crop, remembering the last
shape, zoom or position in the CLI/MCP (an explicit box flag), crop with trim.
