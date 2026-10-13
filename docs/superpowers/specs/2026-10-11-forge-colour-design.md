# Forge — colour: palette from an image, scale from a colour

**Date:** 2026-10-11
**Status:** design approved in conversation; spec awaiting review
**Mockups:** `mockups/colour-2026-10.html`. The **★ Flow** tab is the decided
flow, one frame per step. The other tabs record how each part was chosen.
**Origin:** a Figma paste spike and an extraction benchmark on an Apple M2
(16 GB), macOS 27, Node 26 (`/tmp/forge-colour-probe/`, `/tmp/forge-colour/`).
Numbers are measured unless marked *(est.)*.

---

## 1. Why

Designers spend a lot of time on colour work. Two parts of it fit a terminal:
a file or a value goes in, and values come out that you paste somewhere.

- **Palette from an image.** Drop a photo, screenshot or artwork and get its
  main colours, ordered by how much of the image each covers. Any colour can
  be opened to show the shades it is made of.
- **Tonal scale from a colour.** Type a colour and get 50–950 built around
  it, with how text reads on each step.

Both end on the clipboard, either one hex or the whole set. The whole set
pastes into Figma as real shapes. Nothing here needs a canvas to tweak on.
Ideas that do (harmonies, dark-mode derivation, semantic roles) were dropped
for that reason.

## 2. What was decided, and why

### 2.1 The whole set pastes into Figma as SVG text

Verified on the user's Mac. With SVG markup on the clipboard as **plain
text** (`pbcopy`), ⌘V in Figma creates vector rectangles with their fills and
editable text layers, named from the SVG `id`s. A card version with labels
also pasted cleanly. This gives Figma **shapes, not colour styles or
variables**. Creating those needs a plugin, or the Figma REST API, which is
Enterprise-only for writes. Both are out of scope.

### 2.2 Extraction: k-means in OKLab on a small copy

OKLab distances follow how different two colours look, so grouping there puts
together what a person would. The image is shrunk first. The colour mix
barely changes, and the work becomes small.

| Input | Decode + shrink to 192 px | To OKLab | k-means (k = 8, typed arrays) |
| --- | --- | --- | --- |
| 640 × 640 JPEG | 5 ms | 5 ms | 24 ms |
| 6000 × 4000 JPEG | 15 ms | 3 ms | 15 ms |
| 4000 × 4000 PNG | 54 ms | 3 ms | 23 ms |

At a 256 px sample, k-means took 27–135 ms. **192 px** (longest side) is the
default. A palette is ready in well under the 0.3 s after which the Working
screen appears (W5), so that screen will almost never show. HEIC goes through
`sips` first (`engines/heic.ts`), which can take longer, and then the Working
screen shows as usual.

Two findings from the spike shaped §4.1:

- **A group's average colour may not exist in the photo.** The Sonoma coral
  averaged to `#EB767E`, between an orange-red and two pinks. So each colour
  is reported as **the real sampled pixel nearest the group's centre**, not
  the average.
- **Starting points change the result.** One seeding merged lavender and
  blue into a single 29% colour. Seeding is deterministic (§4.1), so the same
  image always gives the same palette, and going deeper (§4.2) splits a merged
  group again.

### 2.3 Scale: built in OKLCH, the reference always at 500

The user's choice: **the colour you start from is always 500**, so "500"
always means "my colour". The alternative (Tailwind's) puts it on the step
nearest its lightness, so 500 is equally light across hues. It was declined.
`r` makes any step the new reference, and the scale is rebuilt around it.

### 2.4 Screens

Picked in the mockups, in order:

- **C1:** pressing 4 offers Palette or Scale as two cards in home's panel.
- **The field:** a field at the top of each screen, drawn as the app's other
  fields are. It is a filled block three rows tall, **neutral grey, with no
  border**. It holds the value in use, and typing replaces it.
- The palette starts from the **D2 drop zone**.
- **D1:** the photo drawn in its own colours, with going deeper.
- **S9:** the ramp, plus a preview of the chosen step.
- **The F1 Figma card:** a square outer card with rounded swatches.

### 2.5 Neutral greys, app-wide

Decided with this design: **nowhere in the app uses a blue-tinted grey any
more.** Every grey fill becomes the neutral grey of equal OKLab lightness, so
nothing gets brighter or darker. This covers the field, home's cards, the
drop zone, picker bands, keycaps and the slider track. In the dark theme:

| Token | Was | Now |
| --- | --- | --- |
| `selectionBg`, `band`: drop zone, home panel, filled field | `#252c3a` | `#2c2c2c` |
| `listBand`: picker band | `#2a3242` | `#323232` |
| `panelBand`: band inside a panel, the chosen home card | `#33405a` | `#404040` |
| `keycapBg` | `#2e3340` | `#333333` |
| `track`: slider | `#2a2e37` | `#2e2e2e` |

The text greys go neutral too. The secondary text also gets **more
contrast**. The ratios below are measured on the `#1e1e1e` canvas and on the
`#2c2c2c` panel:

| Token | Was | Now | On canvas | On panel |
| --- | --- | --- | --- | --- |
| `fg`: main text | `#e4e8f0` | `#e7e7e7` | 13.5 | 11.3 |
| `dim`: secondary text | `#8b93a6` (5.4) | `#b0b0b0` | 7.7 AAA | 6.4 AA |
| `border`: dim labels, hints, frames | `#5f6879` (3.0) | `#808080` | 4.2 | 3.5 |
| `faint`: dots, decoration | `#3d4350` | `#4d4d4d` | 2.0 | 1.7 |

The comments in `theme.ts` that quote the old ratios are updated with the
values. `textSelectionBg` (`#3f5c86`) stays blue, because it is a selection
colour, not a grey. The light theme's greys are warm, not blue, so they are
unchanged.

This touches every screen, and it lands as its own commit on `dev`, ahead of
colour mode, which only uses the tokens. Fixtures that encode the old greys
must be regenerated or mapped:

- `tests/shell/fixtures/*.json`, which are read from the frozen
  `flow-parts-2026-10.html`
- the W5/G1 fixtures

## 3. Invariants

The repo's invariants apply as written. How each one lands here:

1. Colour maths, grouping, scale generation and the SVG card are pure
   functions in `src/core/colour/`. They return data and strings and never
   print. Pixel decoding lives in `src/engines/` and uses the lazy
   `loadSharp`.
2. The formats line in the drop zone comes from the image engine's `reads`
   and the HEIC engine, not from a typed list.
3. A dropped or typed path is probed by content (`probe`). Only
   `kind: 'image'` sources make a palette. A PDF dropped on the palette is
   refused with its real kind, whatever its extension says.
4. `.rotate()` runs first, so the palette's photo map matches the photo's
   orientation.
5. Alpha: pixels with alpha below 128 are left out of the palette and drawn
   as empty cells in the map. They are not flattened, because the colour
   behind a transparent pixel is not part of the image.
6. Colour mode writes no files. `--svg` writes to stdout. If a file export is
   added later, it goes through `core/atomic.ts`.
7. No progress is invented. A palette is a single job, so it shows W5's phase
   line only after 0.3 s, and no percentage.

## 4. Core: `src/core/colour/`

### 4.1 Palette

`palette(pixels: Pixels, opts?) → Group[]`, where `Pixels` is
`{ width, height, rgba: Uint8Array }` and comes from the engine (§5).

1. Convert every opaque pixel to OKLab, using typed arrays.
2. **Seeding** is deterministic. The first centre is the mean. Each next
   centre is the pixel farthest from every centre so far. There is no
   randomness, so results can be tested.
3. Run k-means with **k = 8** until no pixel moves, up to 30 iterations.
4. **Merge** groups whose centres are closer than ΔE_OK 0.06, and **drop**
   groups under 1.5% of the opaque pixels. The result is 1–8 colours. A
   flat image gives one.
5. Each group reports `hex` (the real pixel nearest its centre), `share` (its
   fraction of opaque pixels), its `centre` in OKLab, and its pixel indices,
   which going deeper and the photo map need.
6. Groups are sorted by share. Percentages shown to people are whole numbers
   that add up to 100, by largest remainder.

The thresholds (ΔE 0.06, 1.5%) are starting values. Tune them during
implementation against a small fixture set of real photos kept out of the
repo, and pin them with synthetic images in tests.

### 4.2 Going deeper

`inside(pixels, group) → Group[]` runs the same steps on only the group's
pixels, with **k = 4**, a merge threshold of ΔE_OK 0.03, and shades under 2%
of the group dropped. Shares are fractions of the group. Share of the image
is the product of the two.

It can be repeated: a shade can be opened again. Going deeper stops (→ does
nothing, and the key is not offered) when a group has fewer than 64 pixels or
yields one shade.

### 4.3 Photo map

`photoMap(pixels, groups, cols = 24) → (number | null)[][]` gives, for each
cell of a grid at most 24 wide and 24 tall (aspect kept), the index of the
nearest group. It returns `null` for transparent cells. Drawn with `▀` half
blocks, that is 24 columns by 12 rows. Inside a group it maps to the group's
shades instead.

### 4.4 Scale

`scale(ref: Rgb) → Step[11]`, with steps 50, 100, 200 … 900, 950. In OKLCH,
with the reference at L₀, C₀, h:

- **500 is the reference, exactly.** It is not regenerated.
- **Lighter steps** 50–400: L = L₀ + (0.975 − L₀)·f, with f = 1.00, 0.86,
  0.68, 0.46, 0.22. C = C₀·(1 − 0.88·f).
- **Darker steps** 600–950: L = L₀ − (L₀ − L_min)·g, with g = 0.2, 0.4, 0.6,
  0.8, 1.0. L_min = max(0.16, 0.42·L₀). C = C₀·(1 − 0.45·g).
- **Hue is held.** If C₀ < 0.015 the reference is treated as grey, and every
  step gets chroma 0.
- **Gamut:** a step outside sRGB loses chroma, 0.002 at a time, until it
  fits.

#### 4.4.1 Choosing the steps (added 2026-10-13)

`scale(ref, spec)` takes a `StepSpec` of `{ start, end, every }`; the default,
`{ 50, 950, 100 }`, is the scale above. Decided on
`mockups/scale-steps-2026-10.html` (V1).

- The numbers are places on a ruler from **0** (near white) to **1000** (near
  black). The colour is always **500**.
- **start** is 0–450 and **end** 550–1000, both in 50s, so the colour is
  always in its own scale. **every** is 50, 100 or 250. 25 is left out: 0–1000
  every 25 would be 41 swatches, too narrow to tell apart at 80 columns.
- The steps are the start, the end, and every multiple of `every` between
  them: `{ 50, 950, 100 }` gives 50, 100, 200 … 900, 950. At most 21 (0–1000
  every 50).
- A step between two of the ladder's is interpolated along it, so the default
  eleven keep their exact hex. Past 50, lightness goes on to 0.995 and the
  last of the chroma goes; past 950, lightness drops to 0.65 of the floor
  and chroma to 0.6 of what it was at 950.
- A spec outside those values is refused with what was expected
  (`stepsProblem`).

Worked example, measured: `#6579FD` gives 50 `#F4F6FF` … 500 `#6579FD` …
950 `#161B58`. Its 800, `#343F96`, made the reference with `r`, gives
50 `#F4F6FF` … 950 `#070931`.

Properties the tests hold the code to:

- Lightness falls strictly from 50 to 950. For a reference above
  L₀ ≈ 0.95, the lighter steps may share a hex, which is allowed and
  documented.
- Every step is in sRGB.
- Every step has the reference's hue, within 2°, unless it is grey.

### 4.5 Contrast and names

- `contrast(a, b)` is the WCAG 2 ratio. Each step is rated against `#FFFFFF`
  and `#000000`: **AAA** ≥ 7, **AA** ≥ 4.5, **large** ≥ 3, otherwise
  **fails**. The "Aa" samples in the preview use exactly those two colours.
- `hueName(oklch)` names a colour family for the card title and the layer
  ids: red, orange, amber, yellow, lime, green, teal, cyan, sky, blue, indigo,
  violet, purple, pink, rose, or grey. It is a fixed table of OKLCH hue
  ranges. It is not a naming service, and the name is only a label.

### 4.6 Parsing and formatting

- **Input**, in the shell and the CLI: `#RGB` or `#RRGGBB`, case-insensitive.
  The CLI also accepts it without the `#`, because an unquoted `#` starts a
  comment in bash. Anything else is refused with what was expected.
- **Output:** the hex as `#RRGGBB` in uppercase. The facts line shows
  `rgb(r g b)` and `oklch(L% C h)` as well.

### 4.7 The Figma card

`card(title, subtitle, items, theme) → string`. This is the F1 card,
returned as SVG text:

- The outer `rect` has **square corners** and is white, or `#18181B` when
  the shell theme is dark. The swatches are rounded (rx 12, or 10 when there
  are more than 8 items) with an 8% hairline.
- The name is bold and the value grey under each swatch, in Inter. Figma
  substitutes a font if Inter is missing.
- Ids are `<hue>-<step>` (`blue-500`) for a scale and `<file>-<n>` for a
  palette. A palette's value line is `rgb(…)`.
- Text is escaped. The output is deterministic, so a snapshot test can hold
  it.

## 5. Engine: pixels

`samplePixels(path, longest = 192) → Pixels` goes in `src/engines/pixels.ts`.

- It probes first (invariant 3). HEIC goes through the existing `sips` path.
- The sharp chain is `rotate()`, then `resize({ fit: 'inside' })`, then
  `ensureAlpha()`, then `raw()`.
- Animated images use the first frame.

It is not an `Engine`, because it plans no jobs and writes nothing. It is a
helper beside the engines so that sharp stays out of `core/`.

## 6. The shell

### 6.1 The mode

- `colour` is the fourth `ShellMode`. It is reached with **4** or `/colour`;
  `/color` also works but is not listed. Its colour is pink: `#F27BA8` on
  dark, a deeper pink on light, magenta on the neutral palette.
- Its hatching runs through a **spectrum**: coral, amber, lime, cyan, blue,
  violet. So `modeGradient` changes from returning two stops to returning
  `readonly string[]`, and its users (`brandRows`, `trailBarRow`, the working
  art) interpolate over n stops. The other modes keep their two stops.
- Every place that assumes three modes (the `1–3` regexes and hints,
  `MODE_KINDS`, `ModeHeader.styleFor`, the per-mode branches in `App.tsx`,
  the tests that list three modes) moves to four. This is mechanical, but it
  touches many files. The change becomes "1–4 mode" everywhere, and the
  mockup fixtures that contain "1–3" are regenerated.

### 6.2 Home (C1)

- With colour active, the panel holds two cards side by side: **Palette**
  ("extract colours from an image", a strip of a sample palette) and
  **Scale** ("create shades from one colour", a sample ramp). Each card is
  half the panel less its gaps, so the pair fits inside the margins. The chosen card gets the
  picker's band and the ▌ strip in the mode colour. ←→ chooses and ↵ opens.
- The tab row's right side says `copies to clipboard`, where other modes say
  `saves to …`.
- **There is no field at rest.** Typing `/` shows the field with the slash
  and opens the commands in place, as N6 does. A drop (or a pasted path) on
  this home opens Palette with that image. `#` opens Scale with the field
  ready.

### 6.3 The field

Both screens open with the app's filled field at the top, in place of a card:

- `Prompt`'s `field` look: a block three rows tall at the full content width,
  filled with the neutral `selectionBg` (§2.5), with no border.
- `›` comes first, in the mode colour while focused and dim at rest.
- **Empty:** `›` and one dim hint, `type an image path` or `type a hex code`.
  There is no second line of help.
- **At rest:** it shows the value in use, dim:
  - `› sonoma.jpg   640×640 · 58 KB`
  - `› #6579FD ████   from sonoma.jpg`, or `was 800 of #6579FD`, when the
    colour came from somewhere
- **Typing:** the text appears after `›`, with the swatch once a hex is
  whole.

### 6.4 Palette (D2, D1)

**Empty.** The field (§6.3), and under it the D2 drop zone:
`↓ Drop an image here`, with the formats it takes on its second line (§3,
invariant 2).

**Opening.** A drop types the path into the field. ↵ probes it, or it opens
by itself once a pasted path probes as an image. A non-image is refused on
the line under the field ("`report.pdf` is a PDF, not an image"), and the
field keeps its text.

**The palette (D1).**

- The field at rest, showing the image's name and size.
- Then the photo map on the left, 24 × 12.
- On the right, one row per colour: swatch, hex, a bar as long as its share
  (scaled to the largest), and the percentage.
- The chosen row has the band and ▌. The chosen colour is lit in the map and
  the rest are dimmed: mixed 78% toward the theme's background.
- The line under the view gives the chosen colour's hex, rgb and OKLCH.

**Inside a colour.** The trail becomes `Palette ╱ #F26E69`. The map dims
everything outside the colour to 90% and lights only the chosen shade. The
list shows the colour itself on top (swatch, hex, "12% of the image"), then
its shades with bars and "% of it". The line under the view adds the share of
the image.

| Key | Palette | Inside a colour |
| --- | --- | --- |
| ↑↓ | choose | choose |
| → | open (go deeper) | open again, if it has shades |
| ← | — | back up |
| ↵ | copy the hex | copy the hex |
| c | copy all, as the Figma card | copy all shades |
| s | a scale from this colour | a scale from this shade |
| # | a new colour: a scale from what you type | same |
| drop, `/`, `~` | a new image | a new image |
| esc | back to home | back up |

Copy confirmations replace the line under the view for 1.5 s:
`✓ copied #FD6457` and
`✓ copied 6 swatches · paste into Figma with ⌘V`.

### 6.5 Scale (S9)

**Empty** (opened from home). The field, `› type a hex code`, then the
eleven step labels and outlined boxes, and nothing else.

**The scale.**

- The field at rest shows the reference's hex and swatch, and where it came
  from (§6.3).
- The S1 ramp: one swatch per step, as wide as fit in the field's width (at
  most 6), with a blank between them while they are at least 4 wide. Step
  labels above (the reference in the mode colour, the chosen one bold); a
  label that would touch its neighbour's is left out, never the chosen one's.
  A `▔` under the chosen one.
- **The steps' line**, right under the ramp: `50 – 950, every 100 · 11
  steps`, and `s steps` at the field's right edge (§4.4.1).
- The S9 preview: a block of the chosen step, 18 × 5, with "Aa" in white and
  "Aa" in black. Beside it in plain text: step and hex, OKLCH, and "white
  text 9.1 AAA" and "black text 2.3 fails", with the rating in green when it
  passes AA.

**Typing.**

- `#` puts you in the field with `#` typed.
- The scale follows the moment the hex is whole. ↵ keeps it. esc puts the
  previous colour back.
- A new colour starts a new history entry, so esc goes back to the last one.

| Key | Scale |
| --- | --- |
| ←→ | choose a step |
| ↵ | copy its hex |
| c | copy all the steps, as the Figma card |
| s | change the steps (below) |
| r | make this step the centre: it becomes the reference at 500 and the scale is rebuilt |
| # | a new colour |
| esc | back one: the previous reference, then the palette (if it came from one), then home |

After `r`: `✓ #343F96 is now 500 · esc goes back to #6579FD`.

The key row shows ←→ choose, ↵ copy and c copy all; `r make centre` and `#
new colour` are quiet keys at its right.

**Changing the steps.** `s` turns the line into `from 50 to 950 every 100`,
each value a pill. The value in hand is white with `‹ ›` round it, and `s
steps` becomes `↵ done` in its place. ←→ changes the value, stopping at its
ends, and tab goes to the next (shift-tab back). The ramp redraws as each
value changes, and the chosen step stays on the same number, or the nearest
one. ↵ keeps the steps; esc puts back what they were. The key row while
editing: ←→ change, tab next, and esc cancel at the right. Every other key
does nothing until then.

The steps are kept for the session: a new colour (`#`), a new centre (`r`),
and leaving colour and coming back all keep them. The Figma card's subtitle
names them when they are not the default (`from #6579FD · 100–900, every 50
in OKLCH`).

In a terminal without true colour, the "colours shown approximately" note
takes the detail row, which a scale does not otherwise use, so the steps'
line leaves the screen no taller than it was.

### 6.6 What typing means

A field that is always ready would swallow `c`, `r` and `s`. So **only `#`,
`/` and `~` start typing, plus any paste** (a drop is a paste). Every other
letter is a key. While the field has focus, the keys are `↵ done` and
`esc cancel` only.

### 6.7 The bar's trail and back

- The trail records the way back: `Palette`, `Palette ╱ #F26E69`,
  `Palette ╱ Scale`, `Palette ╱ #6579FD ╱ Scale`. esc walks it back one
  entry at a time.
- A colour flow is a flow module beside `PdfFlow`:
  `ColourFlow { start, width, height, onCancel, onTrail }`. `start` is
  `{ palette: path }`, `{ palette: 'empty' }`, `{ scale: 'empty' }` or
  `{ scale: hex }`. It owns its history stack and pushes its trail up with
  `onTrail`, the way `pdfTrail` does.
- No `bar` history block is added, because nothing is written.

### 6.8 Fallbacks

**Colour depth.** No 24-bit detection exists today. Add `trueColour(env)` in
`glyphs.ts`, next to `slantedChips`:

- On when `COLORTERM` is `truecolor` or `24bit`, or for the same
  `TERM_PROGRAM`/`TERM` sets.
- `FORGE_TRUECOLOR=1|0` overrides it.
- Off under `NO_COLOR`.

Without true colour, swatches are drawn as chalk downsamples them. Hex values
are always exact. The view adds one dim line, `colours shown approximately ·
this terminal has 256 colours`. Whether Apple Terminal on macOS 27 sets
`COLORTERM` is to be checked first. If it draws 24-bit colour without saying
so, it joins the set.

**`NO_COLOR`.** There are no swatches, and no photo map.

- The palette is a list: hex, a bar of `█` in the text colour, and the
  percentage.
- The scale is a list: step, hex, and the two ratings.
- Every key still works, and copying is unchanged.

### 6.9 Light theme

Same layout. Dimming mixes toward the light background. The Figma card uses
the light (white) variant when the shell theme is light.

## 7. CLI and MCP

### 7.1 Commands

`forge palette <image>` and `forge scale <colour>` are real subcommands,
claimed before Commander like `probe` and `config` (`args.ts`).

- **Default output** is the swatch rows, printed once and then exit:
  - palette: `██  #356723  19%` per colour
  - scale: `500  ██  #6579FD  white 3.7 large · black 5.7 AA` per step
  - under `NO_COLOR`, the same rows without swatches
- **`--json`** follows `report-data.ts`. `forge` and `ok` are present, then
  `palette: { source, colours: [{ hex, rgb, oklch, share }] }` or
  `scale: { reference, steps: [{ step, hex, oklch, white, black }] }`.
  `failures` uses the existing shape.
- **`--svg`** prints the Figma card to stdout, for piping to `pbcopy`.
- **`--inside <hex>`** on `palette` prints the shades of the colour nearest
  that hex.

Exit codes follow the contract: 0 ok; 1 the image could not be read or
probed as something else; 2 bad arguments, including an unparseable colour.

### 7.2 MCP tools

- `forge_palette { path, inside? } → palette JSON`
- `forge_scale { colour } → scale JSON`

Both are registered in `mcp/server.ts`, with Zod schemas in `schemas.ts`,
and annotated read-only.

## 8. Code layout

```
src/core/colour/   space.ts (sRGB ↔ OKLab/OKLCH, gamut, hex)  contrast.ts  names.ts
                   kmeans.ts  palette.ts (palette, inside, photoMap)  scale.ts  card.ts
src/engines/pixels.ts
src/shell/colour/  ColourFlow.tsx  PaletteView.tsx  ScaleView.tsx  colour-art.ts (row builders)
src/shell/         home-art.ts (C1 cards), theme.ts (mode, gradient stops), glyphs.ts (trueColour)
src/cli/colour.ts  src/cli/args.ts (palette, scale)
src/mcp/           tools.ts, schemas.ts, server.ts (two tools)
```

`colour-art.ts` builds rows as data, like `working-art.ts` and
`quality-art.ts`, so they can be tested cell by cell without Ink.

## 9. Testing

- **Core:**
  - Conversion round trips, with known OKLab values for a few colours.
  - WCAG ratios for known pairs (`#777` on white 4.48; black on white 21).
  - Hex parsing: 3 and 6 digits, no `#`, rejects.
  - The scale properties in §4.4, over a sweep of references including
    white, black, greys, and saturated sRGB corners.
  - The `#6579FD` and `#343F96` scales above, pinned.
  - Palette on synthetic images (`tests/helpers/fixtures.ts` generators):
    - a four-colour quadrant PNG gives exactly those four, each with a 25%
      share;
    - one flat colour gives one group;
    - a gradient gives ordered groups;
    - transparent pixels are excluded;
    - the same input always gives the same output.
  - Inside: a group made of two colours splits into those two.
  - The photo map keeps aspect, and `null` for transparent cells.
  - The card: SVG snapshot, escaping, ids.
- **Engine:** EXIF-rotated JPEG fixture → the map matches orientation. HEIC
  via `sips` where available (skipped elsewhere, as the HEIC tests already
  are).
- **Shell:**
  - `colour-art.ts` rows are compared with fixtures generated from the
    mockup page by `scripts/colour-mockup-fixture.mjs`, using the existing
    `mockup-cells.mjs` pipeline.
  - ink-testing-library flows: 4 → home cards → Palette empty → path → the
    palette → → into a colour → ← → s → scale → r → c → esc back to the
    palette → esc home.
  - Clipboard calls are asserted through a stubbed `copy`.
  - `#` typing and live update, and that `c`, `r` and `s` are not swallowed
    by the field.
  - `NO_COLOR` and `FORGE_TRUECOLOR=0` renders.
- **CLI and MCP:** `--json` envelopes for both commands, exit codes, `--svg`
  output equals `card(…)`, and the MCP tools listed and callable, as the
  existing MCP tests do.

## 10. Out of scope

- File exports: PNG swatch sheet, `.ase`, `.clr`, CSS variables.
- A standalone contrast command.
- Figma styles or variables.
- Display P3.
- The Tailwind-style nearest-step placement.
- Colour formats other than hex as input (`rgb()`, `oklch()`).
- Palettes from URLs.
- Harmonies, dark-mode derivation, semantic roles.

## 11. Order

0. **Neutral greys (§2.5)**, as its own commit on `dev`: the DARK tokens
   and the regenerated fixtures. Every screen changes, so it goes first and
   apart from colour.
1. `core/colour`: space, contrast, parse, names (tests first).
2. Scale.
3. k-means, palette, going deeper, photo map; `engines/pixels.ts`.
4. The Figma card.
5. CLI `palette`/`scale` with `--json`/`--svg`/`--inside`; MCP tools.
6. Mode plumbing: fourth mode, `modeGradient` stops, 1–4 everywhere,
   `/colour`.
7. Home C1.
8. `ColourFlow` and Palette: empty, open, D1, inside, keys, copy.
9. Scale: S9, `r`, `#`, history.
10. Fallbacks: `trueColour`, the 256-colour note, `NO_COLOR` lists, light
    theme.
11. Mockup fixtures and cell tests; a full manual run in Terminal.app and
    Ghostty.

**Merge note.** Uncommitted work by another session on `dev` (W5 Working
screen, G1 Quality slider) touches `App.tsx`, `theme.ts`, `Home.tsx` and
`trail.ts`. This branch starts from `ad2de63` and will need a rebase onto
that work once it lands. Step 6 is where the conflicts will be, so do it
after the rebase if that work has landed by then.
