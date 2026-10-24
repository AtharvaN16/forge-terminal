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
- **Hue is held.** Chroma only ever falls away from the reference, so a
  step is never more tinted than the colour. Only a reference with no
  chroma to speak of (C₀ < 0.0005, rounding noise) is treated as grey.
  (Until 2026-10-13 the cut-off was 0.015, which stripped Tailwind zinc and
  stone of their tint on every step but 500; §12.2.)
- **Gamut:** a step outside sRGB loses chroma, 0.002 at a time, until it
  fits.

#### 4.4.1 Choosing the steps (added 2026-10-13, round 3)

`scale(ref, spec)` takes a `StepSpec` of `{ set, start, end, count }`; the
default, Tailwind from 50 to 950, is the scale above. Decided on
`mockups/scale-steps-2026-10.html` (round 3, C1), after looking at how
online generators do it: tints.dev (lightness of imagined 0 and 1000
swatches), ColorBox (a count, start and end lightness, and a curve), Radix
(twelve steps by purpose), Material (tones 0–100).

- Every step is a **place** on a ruler from **0** (near white) to **1000**
  (near black), and the colour is always at **500**. A place between two of
  the ladder's is interpolated along it, so the default eleven keep their
  exact hex. Past 50, lightness goes on to 0.995 and the last of the chroma
  goes; past 950, lightness drops to 0.65 of the floor and chroma to 0.6 of
  what it was at 950.
- **Tailwind**: 50, 100, 200 … 900, 950. Its ends move in 50s, the start
  0–450 and the end 550–1000; the hundreds between stay.
- **Even**: `count` steps, 3 to 21, spread evenly from `start` to `end`
  (the same ends as Tailwind's). The count is split between the places
  lighter than the colour and those darker, in proportion to how much of
  the range each side has, so 500 is always a step. Each step is named by
  its place to the 10 (15 over 0–1000: 0, 70, 140 … 930, 1000), or to the 5
  or the 1 where two would share a name.
- **Radix**: twelve, numbered 1–12, the colour at 9 where Radix puts its
  solid colour; 1–8 are its backgrounds and borders, 10 the solid's hover,
  11–12 text. Its places are fixed: 20, 50, 100, 150, 200, 260, 330, 420,
  500, 560, 750, 920. Start, end and count do not apply.
- At most 21 steps (Even), which still fit the ramp at 80 columns. A spec
  outside these values is refused with what was expected (`stepsProblem`).

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

- **Input**, in the shell and the CLI: `parseColour` (§12.5): hex (3, 4, 6
  or 8 digits, with or without `#`), `rgb()`, `hsl()`, `oklch()`, `oklab()`,
  and colour names (CSS's 148, then the xkcd survey's 949). A transparency
  in the input is read and ignored: a scale is made from a solid colour.
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
  (Since 2026-10-14 three cards, chosen with `a s d`; ←→ are the tab row's, §12.9.)
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
- **The steps' line**, right under the ramp: the set in bold, its first and
  last names, and how many (`Tailwind  50 – 950  ·  11 steps`; Radix adds
  `· your colour at 9`), and `s steps` at the field's right edge (§4.4.1).
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

**Changing the steps.** `s` turns the line into pills, the set first and
then what that set lets you change: Tailwind `from` and `to`; Even `from`,
`to` and `steps` (the count); Radix nothing more. The value in hand is white with `‹ ›` round it, and `s
steps` becomes `↵ done` in its place. ←→ changes the value (the set goes
Tailwind, Even, Radix), stopping at its ends, and tab goes to the next
(shift-tab back). The ramp redraws as each value changes, and the chosen
step stays on the same place on the ruler, or the nearest one, so Radix's
9 is Tailwind's 500. ↵ keeps the steps; esc puts back what they were. The key row while
editing: ←→ change, tab next, and esc cancel at the right. Every other key
does nothing until then.

The steps are kept for the session: a new colour (`#`), a new centre (`r`),
and leaving colour and coming back all keep them. The Figma card's subtitle
names them when they are not the default (`from #6579FD · 0–1000, 15 even
steps in OKLCH`, `Tailwind 100–900`, `Radix 1–12`). After `r`, the note
names the colour's step in the set (`is now 9` in Radix).

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
- ~~Colour formats other than hex as input~~: in, §12.5.
- Palettes from URLs.
- ~~Harmonies, semantic roles~~: in, as Palette's modes, §12.6. Dark-mode
  derivation stays out.
- A colour generator, a contrast checker and an export window (the
  Coolors-style tools, 2026-10-13): considered and dropped.
- A colour-vision (colour-blindness) check: considered and dropped.

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

## 12. Round two (2026-10-13)

Decided over two mockups: `mockups/neutral-alpha-2026-10.html` and
`mockups/colour-more-2026-10.html`, both built by scripts of the same name.
The user's picks are recorded there and in this section.

### 12.1 Scale's three tabs (K1)

The scale screen gets tabs over the ramp: **Colour · Neutral · Alpha**,
drawn like /about's (L2): names with room around them, a faint rule under,
heavy in the mode's colour under the one in use. `tab` switches. The
field, the steps line and the preview stay where they are.

- **Colour** is today's scale.
- **Neutral** is the scale of `neutralRef(ref, tint)`: a grey at OKLCH
  L 0.553 (where every Tailwind grey's 500 sits), tinted with the colour's
  hue. Tint: none, faint, soft, strong = chroma 0, 0.012, 0.024, 0.04 at
  500 (Tailwind's neutral, zinc/stone, gray, slate). Default soft.
- **Alpha** is each step as the most see-through `#RRGGBBAA` that looks
  exactly like it over white (or black), blended in sRGB (Radix's method).
  Drawn over a checkerboard (A1), each step's opacity written on the middle
  row of its swatch (P1); at counts where a cell is under four columns wide
  the numbers drop out and only the preview says it. The preview block is
  the step over the board; its facts are `500  #0223FC9B`, `61% opaque ·
  rgb(2 35 252 / 61%)`, then what it looks like over white and over black.
- A neutral's tint and an alpha's background (white, black) are the last
  pill on the steps line under `s`.
- `r make centre` only on Colour. `↵` copies the step (the 8-digit hex on
  Alpha); `c` copies the tab's card (§12.7).

### 12.2 The grey fix

§4.4: tinted greys keep their tint on every step.

### 12.3 Mix (M1)

In a scale, `⇧→` at the end of a whole colour in the box puts ` → ` after
it and asks for a second (`->` and `>` type the same); `→` alone only moves
the cursor, as `→` moves along the ramp (2026-10-14). The box's hint until
then is `type a second colour to mix` (approved). Before that, once a whole
colour is typed, the box's far end says `↵ done`; once ↵ has drawn the
scale, the resting box's far end says `⇧ → gradient to a second colour`
(2026-10-14) — the key glyphs bold in the mode's colour, a space between
them, the words grey — where it fits. ⇧→ starts the mix from either. ↵ makes the mix: the bar says **Scale ╱ Mix**, the ramp runs
from one to the other, labelled by how far along (0–100), the preview is
the scale's. The line under the ramp holds the way across (OKLab straight,
OKLCH round the hue wheel) and the count (3–21), changed under `s` like the
steps. Pasting `#A #B` (two hexes, a space between) works the same, here
and on colour's home. A mix typed over another colour's scale goes on top
of that colour's own scale, so esc walks back through both.

### 12.4 Typing a colour

- The box's hint: `type a hex, rgb(), hsl(), oklch() or a colour name`
  (approved).
- Something typed another way shows its hex beside it.
- **Wrong input:** what was typed turns red, and `wrong input` sits in grey
  at the far end inside the box. Nothing is said under it.
- An 8-digit hex: the colour is used, its transparency ignored, nothing said.
- No clipboard offer.

### 12.5 `parseColour`

`src/core/colour/parse.ts`; the name tables in `colour-names.ts` (CSS, W3C;
xkcd colour survey, CC0). Names match case-insensitively with spaces,
hyphens and underscores ignored; CSS wins a clash. Out-of-range numbers are
wrong input.

### 12.6 Palette from one colour

Its own screen in colour mode, named **Palette**. Today's photo Palette is
renamed **Extract**. Colour's home has three cards, subtitles on two lines:
Extract ("extract colours / from an image"), Scale ("create shades / from
one colour"), Palette ("build a palette / from one colour").

- **The box** takes a colour as Scale's does. The grid waits as outlines.
- **The screen:** the chosen swatch's line (`blue 700  #004598  oklch(…)`),
  a gap, the grid, a gap, the mode's line: its name, then `m mode`,
  `t tweak`, `s steps`. Keys: ↑↓←→ choose, ↵ copy, `c` copy all, `#` new
  colour, `r` reset (once tweaked), esc back. Under `s` the steps line
  takes the mode's line, as it does under Scale's ramp.
- **The grid:** a row per colour named down the left, the step numbers over
  it. Swatches are whole cells, spaces on their colour, never half blocks:
  Apple Terminal draws `▀ ▄` from the font, short of the cell, and the
  seams read as lines inside the boxes (2026-10-14). A gap line between
  rows, a gap column between cells. Cells grow with the window up to 8
  wide; swatches are two lines tall while four rows still fit, one below
  that, up to three when every row fits. When not every row fits, the grid
  scrolls with the chosen row kept in the middle, and a bar (`┃` on a faint
  `│`) at its right says where.
- **The chosen cell** has a thin frame, `╭─╮ │ ╰─╯`, in the text colour, in
  the gaps round it. **Your colour's cell** is underlined, `━` in the mode's
  colour in the gap under it, taking the middle of the frame's bottom edge
  when chosen (2026-10-14; replaces ◤). The step number above and the
  row's name are bold.
- **Modes** (`m`, a centred window over the faded screen, W1; each mode with
  its colours as chips; it scrolls when too short): Full set, Monochromatic,
  Analogous, Complementary, Split complementary, Triadic, Pastel. Maths in
  `system.ts`, ported from the mockup.
- **Tweak** (`t`, the same window): brightness, saturation, contrast −100 to
  +100, hue −180° to +180° (Photoshop's ranges); ←→ 1, ⇧←→ 10; a strip of
  the palette's colours changes as they move. They move every row, yours
  too. `r` resets to the palette as the mode made it.
- **No helper text** on this screen beyond what is listed here.

### 12.7 Cards

`neutralCard`, `alphaCard` (a checkerboard under each swatch, the swatch's
`fill-opacity` carrying the alpha, the 8-digit hex under it), `systemCard`
(a grid: steps across the top, a row per colour, the neutral last). Whether
Figma keeps `fill-opacity` on paste is to be checked by hand.

### 12.9 Round three (2026-10-14)

- **Home's keys.** ←→ walk the tab row (the five modes, then `/ commands`)
  and stop at both ends: → on commands and ← on convert do nothing. They
  pass through colour like any tab. Colour's three cards open at once with
  `A S D` (either case), the keys under the left hand in the cards' order;
  each card shows its key before its name, bold in the mode's colour. ↵
  opens the card last opened, which keeps the band. The key row says
  `A S D open`, `1–5 ←→ mode`.
- **A gradient from a shown scale.** `⇧→` on Scale opens the box with the
  colour and its ` → `, as typing it would; the resting box's far end says
  `⇧ → gradient to a second colour`, where it fits (§12.3).
- **Going to or from colour's home** fades as every mode change does (M1b),
  but a row whose words change fades its old words out into their fill over
  the first half and the new ones up over the second, rather than swapping
  letter by letter half way (which read as one garbled line). The field,
  which colour's home has none of, fades out or in the same way.
- **Contrast, as Figma reads it.** Scale's preview grades white and black
  text by use, as Figma's picker and Stark do: under a quiet `normal  large`
  head, each row is the ratio (`5.5:1`), then the best WCAG grade for normal
  text (AA 4.5, AAA 7) and for large text, 18 pt or 14 pt bold (AA 3, AAA
  4.5). A pass is green, a fail `✗` in red. No graphics column (decided).
  The plain-text fallback and the CLI keep their one-word rating.
- **Tweak on Scale.** `t` opens Palette's Tweak window over a scale
  (brightness, saturation, hue, contrast; ←→ 1, ⇧←→ 10, `r` reset, ↵ done,
  esc cancel), its strip the scale's steps. The tweak is the scale's own,
  kept on its screen: Palette's is not touched, a new colour starts
  untweaked, esc back finds the last scale still tweaked. It moves the scale
  as Palette's row for the colour is moved (the colour tweaked, then the
  contrast about the centre step), on every tab, and Copy all copies what is
  shown. `r make centre` on a tweaked scale starts the new one untweaked:
  the step is the tweaked colour already. The steps line says `t tweak` before
  `s steps`. The window's strip narrows its chips when there are more than
  fit at three cells (eleven at two, up to 21 at one).
- **Extract's photo in a terminal that draws pictures** (Ghostty, Kitty,
  iTerm2, WezTerm; `inline-image.ts`) is the photo itself, sent as a PNG
  into the same framed box: the chosen colour's pixels as they are, the
  other colours' taken 60 % to the canvas, and inside a colour the rest of
  the photo 80 %. Lighter than the rows' 78 % / 90 %: there the photo is its
  colours; here it is the photo, and a dark one dimmed that far is gone.
  Everywhere else, the half blocks as before.

### 12.8 Not in this round

The CLI and MCP keep `forge palette` (an image's colours) and `forge scale`
as they are, except that `forge scale`, `--inside` and the MCP tools read a
colour with `parseColour`.
Steps, neutrals, alpha, mix and Palette are app-only for now.

## 13. Simpler (2026-10-24)

People given colour mode without guidance got lost: about ten tools behind
three cards, key hints on four rows, keys meaning different things on
different screens. The audit and its rounds are in
`mockups/colour-audit-2026-10-simple.html`, `colour-redesign-2026-10-round5.html`
(Flow 1, liked) and `colour-more-copy-2026-10-round6.html` (P1, picked).

- **Home is unchanged**: Extract, Scale and Palette cards, A S D.
- **Palette is Scale's fourth tab**: Colour · Neutral · Alpha · Palette.
  `S` opens Scale on Colour, `D` on Palette; one screen, one colour, the
  trail says Scale. The Palette tab draws the grid where the ramp is, its own
  cursor (`cell`) beside the scale's step; ↑↓←→ move it. When its rows would
  scroll with gap lines between them but fit a line each, they show touching,
  all of them, the chosen cell marked `▕ ▏` in the gaps; the blank lines round
  the grid go before the rows would scroll.
- **More**: `m`, drawn over the key row's rule at the right as home's
  "/ menu" is — the key on the grey cap, in the mode's pink, then `more`
  dim. It opens a W1 window (centred, the screen faded): Gradient (⇧→),
  Tweak (t), Steps (s) on a scale's tabs; Mode, Tweak, Steps on Palette;
  Steps on a gradient. The keys still work at once. `m` is no longer Mode;
  in the window `m` is done, closing it as esc does (`↑↓ choose ↵ open m done`).
- **Gradient** (was Mix) takes any number of colours. Its window lists them
  numbered, then a box for the next on the shelf's grey, then the gradient
  as one strip: ↵ adds, ↑↓ choose, ⌫ removes the chosen one (or deletes in
  the box), tab shows it, esc cancels. The screen is the Mix screen with every
  colour; the bar says Gradient. Typed in the field, `a → b → c` makes one
  too. Core: `gradientSteps(stops, count, space)`; `mixSteps` is its two-stop
  case.
- **The lines say no keys**: the steps line, the gradient's line and the
  mode's line are values only; the tab row ends in the `tab` cap alone.
- **The field**: `# new colour` at its far end at rest, as plain text (the
  key bright, the words quiet). While a whole colour is typed — or two or more
  for a gradient — `↵ done` is its grey chip at the far end, as before; there
  is no gradient hint (Gradient is in More).
- **Key rows**: Colour `←→ choose ↵ copy c copy all · r make centre · esc
  back`; Neutral, Alpha, a gradient `… · esc back`; Palette `↑↓←→ choose …
  · (r reset ·) esc back`; More `↑↓ choose ↵ open · esc close`; Gradient
  `↵ add ↑↓ choose · ⌫ remove · tab done · esc cancel`.
- **A copy says so in place of the key row** for 3 s (K1): a colour just
  what was copied; a set — swatches or a palette's rows of them — with
  "paste into Figma with ⌘V". Make centre's line stays under the view.
