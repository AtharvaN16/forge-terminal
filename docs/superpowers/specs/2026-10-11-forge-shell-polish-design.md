# Forge — Shell polish, round 1

**Date:** 2026-10-11
**Status:** Draft, awaiting review
**Mockup:** `mockups/explorations-2026-10.html`, section 1 ("The flow with your decisions applied")

---

## 1. Scope

Five visual decisions taken from the round-2 explorations. Nothing else.

| # | Decision | Mockup |
| --- | --- | --- |
| 1 | Each mode owns its colour | §8 A–C, §1 frames 2–6 |
| 2 | Keycap key hints | §7 A |
| 3 | Full logo when idle, a header bar while working | §1 C |
| 4 | Receipt card with size bars for a finished conversion | §6 B |
| 5 | Quality stays as it is (recoloured by decision 1 only) | §1 frame 3 |

**Out of scope**, still under discussion: the question-screen layout, what
the option rows say, and the save-to screen. Their content and layout do not
change here; they only pick up the new colours and keycaps.

No change to `core/` or `engines/`. Every load-bearing invariant in
`CLAUDE.md` is untouched; invariant 7 (no fabricated progress) is unaffected
because the size bars draw *measured* bytes after the job has finished.

---

## 2. Mode-owned colour

**Today** a single screen can draw amber (`accent`), cyan (`tag`), violet
(`label`) and the mode colour at once.

**Change:** while the shell is in a mode, the three role colours resolve to
that mode's colour:

```ts
// src/shell/theme.ts
export function modePalette(base: Palette, mode: ShellMode): Palette
//   accent → modeConvert | modeCompress | modePdf
//   tag    → same
//   label  → same
//   every other key unchanged
```

- `App` wraps its live tree **and** the `<Static>` history in
  `<ThemeProvider palette={modePalette(palette, mode)}>`.
- **The banner is the exception**: it keeps the base palette, so the anvil
  heat and the wordmark's amber edges stay the brand constant. `Banner` and
  `intro.ts` take the base palette explicitly rather than from context.
- `ok`, `fail`, `warn` and `larger` are outcome colours and never change with
  the mode.
- `NEUTRAL` (no theme chosen yet) maps to the ANSI names it already uses
  (`cyan`, `green`, `red`), so first run stays legible on any background.
- Known, accepted side effect: when a resize replays history, older blocks
  redraw in the *current* mode's colour. Only the format tag inside a receipt
  is affected.

Contrast: the mode colours already clear AA as text in both palettes
(`theme.ts` records the measurements); no new colour is introduced here.

---

## 3. Keycap hints

**Today:** a full-width rule, then `↵ send  │  / commands  │  …`, keys bold in
`accent`.

**Change:**

```
 ↵  send      /  commands      esc  clear      ctrl-c  quit
```

- Each key is drawn as ` key ` on a new palette token `keycapBg`, bold `fg`.
  The label follows in `dim`. Pairs are separated by five spaces in the
  normal and wide bands and three in the compact band. No `│` dividers.
- `HintBar` loses its top rule; one blank row above the hints separates them
  from content instead.
- `keycapBg`: DARK `#2e3340`, LIGHT `#e4e1da`, NEUTRAL `''`. Text on it is
  `fg`, which must measure ≥ 4.5:1 against `keycapBg`; recorded in a comment
  next to the value, like the other tokens.
- When `keycapBg` is empty (NEUTRAL, `NO_COLOR`), keys render as `[↵]`, so a
  key is still distinguishable from its label without colour.
- Keys no longer use `accent`. The amber key colour was what tied keys to
  clickable labels (`Hints.tsx` comment); keycaps carry that meaning by shape.

---

## 4. Logo when idle, header bar while working

**Today:** `playIntro` prints the logo into ordinary scrollback before Ink
mounts; it stays there and is followed by a `current mode: …` bar on every
step.

**Change:**

| Screen state | What is at the top |
| --- | --- |
| Idle, nothing staged | The full logo, exactly as today, then today's mode line |
| Anything else (a file is staged, any wizard step, a result) | A one-row header bar |

**The header bar**, full width, on the mode's background (`modeConvertBg` …):

```
 ↔ FORGE   convert                                                  ~/Desktop
```

- ` <marker> FORGE ` bold in the mode colour, then the mode name in `dim`,
  then the default output folder right-aligned in `dim`.
- Compact band (< 60 columns): ` ↔ convert ` only.
- It replaces the `current mode:` bar on every non-idle step, including the
  one stacked under the result hints.

**Getting the logo off the screen.** Scrollback cannot be edited, so the
switch reuses the mechanism the resize path already has (`redraw.ts`):

1. On **entering** a working state while the logo is on screen: write
   `CLEAR_SCREEN`, rebuild history *without* the banner block, bump
   `staticGeneration` so `<Static>` replays it.
2. On **returning** to idle-and-empty (`↵ convert another`, `esc` that clears
   the stage, `ctrl-n`): write `CLEAR_SCREEN`, rebuild history **with** a
   banner block first, bump `staticGeneration`.
3. A single `bannerOnScreen` flag (replacing `introPending`) records which
   of the two is current, so neither transition fires twice, and the resize
   handler respects it.

Accepted cost (chosen explicitly): like a resize today, `CLEAR_SCREEN`
includes `ESC[3J`, which also clears the terminal's scrollback from before
`forge` was launched.

First run is unchanged in shape: the theme picker owns the screen, then the
banner is pushed and the same rules apply from there.

---

## 5. Receipt card

**Today:** two framed filenames with an arrow, then `122 KB → 74.6 KB · 39.1%
smaller` and `saved to <folder>`.

**Change** (normal and wide bands), for every `convert`-op result, which
covers conversions and compressions:

```
╭─ ✓ DONE ─────────────────────────────────────────────────╮
│                                                          │
│  test.png  ──→  test.jpg                                 │
│                                                          │
│  before  ████████████████████████  122 KB                │
│  after   ███████████████░░░░░░░░░  74.6 KB  39.1% smaller│
│                                                          │
│  saved to ~/Desktop/test.jpg                             │
╰──────────────────────────────────────────────────────────╯
```

- Border and title in `ok`. Width `min(width, 68)`; every line is padded to
  exactly that width (a test pins it, as the file card's does).
- Bars are `BAR_CELLS = 24` wide. The larger of the two byte counts gets all
  24 cells; the other gets `round(24 × smaller / larger)`, at least 1.
- **Smaller result:** the `before` bar is full and `dim`; the `after` bar is
  `ok` with the remainder `░` in `border`; the phrase is `ok`.
- **Larger result:** the `after` bar is full and drawn in `larger`, `before`
  is the shorter one, and the phrase (`… larger`) is `larger`. The border
  stays `ok`: the file you asked for was written correctly.
- **Same size:** both bars full, phrase `same size` in `ok`.
- The phrase reuses `changePhrase`, so wording and rounding do not change.
- Filenames are middle-ellipsed to fit; the source and output names each get
  half of what is left after the arrow.
- `saved to` shows the full output path, `~`-abbreviated and middle-ellipsed,
  with the filename bold. It is still an OSC 8 link to the **folder** where
  hyperlinks are supported.
- Warnings render inside the card under `saved to`, `⚠` in `warn`.
- **Compact band:** today's single-line form, unchanged.
- `NO_COLOR`: the bars still read, because `█` and `░` differ in shape.

The format tag (`PNG`, `JPEG`) does not appear in the card. The arrow line
carries the filenames, whose extensions already say it.

---

## 6. Testing

Test-first, per `superpowers:test-driven-development`.

| Unit | Tests |
| --- | --- |
| `modePalette` | maps accent/tag/label per mode; leaves outcome colours alone; NEUTRAL maps to ANSI names |
| `Hints` | keycap rendering with `keycapBg`; `[key]` fallback when empty; spacing per band; no `│` |
| Receipt card | every line exactly the card width at 60, 80, 120 columns; bar lengths for smaller, larger and same; larger uses `larger`; warnings inside the card; compact band unchanged; long names ellipsed |
| Header bar | content per band; right-aligned default output; shown on non-idle steps only |
| Banner transitions | staging a file writes `CLEAR_SCREEN` once and replays history without the banner; returning to idle replays it with the banner first; a resize in either state keeps that state; nothing fires twice |
| Banner colour | the banner keeps the base palette's accent in a non-convert mode |

Existing suites that assert the old visuals (`blocks-design`, `result-colour`,
`result-destination`, `mode-header`, `sticky-context`, `responsive`, and any
that match `current mode:` or `│`-separated hints) are updated to the new
design in the same change, not deleted.

Before merging, the new screens are captured in tmux (as the audit did) at
48, 72, 100 and 120 columns, in dark, light and `NO_COLOR`, and checked by
eye in Terminal.app.

---

## 7. Order of work

1. `modePalette` and wiring, with the banner kept on the base palette.
2. Keycap `Hints` and the `HintBar` rule removal.
3. Receipt card.
4. Header bar.
5. Banner clear-and-replay transitions.

Each step is independently shippable and leaves the suite green.
