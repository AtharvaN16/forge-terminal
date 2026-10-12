# Colour, plan 2 of 2 — colour mode in the shell

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Colour as the shell's fourth mode, as decided on the mockup's ★ Flow tab:

- **4** offers Palette or Scale on home (C1).
- Each screen opens with the neutral filled field.
- The palette shows the photo in its own colours, and you can go deeper into a colour (D1).
- The scale shows a ramp and a preview, with `r` to make a step the centre and `#` to type a new colour (S9).
- `↵` copies one hex and `c` copies all as the Figma card.
- `esc` walks back.

**Architecture:**
- **Rows as data.** Every screen is built as rows in `src/shell/colour/colour-art.ts`, the same `Row = Run[]` shape `save-as-art.ts` uses. It is drawn with the existing `Runs` component, and the tests hold it cell for cell to fixtures taken from `mockups/colour-2026-10.html`.
- **Behaviour without Ink.** State lives in a pure reducer, `src/shell/colour/state.ts`, which is tested without Ink.
- **A flow beside `PdfFlow`.** `ColourFlow.tsx` wires the reducer to keys, the clipboard and the core colour functions (plan 1). It pushes its trail up the way `PdfFlow` does.

**Tech Stack:** TypeScript, Ink 6 / React, vitest and ink-testing-library, plus the plan 1 core: `src/core/colour/*` and `src/engines/pixels.ts`.

**Spec:** `docs/superpowers/specs/2026-10-11-forge-colour-design.md` §6 (shell), §2.4–2.5 (picks, neutral greys) and §3 (invariants). The ★ Flow tab of `mockups/colour-2026-10.html` is the picture of record.

## Global Constraints

- **Mode.** `ShellMode` gains `'colour'`, fourth in `MODE_ORDER`, reached with **4** or `/colour`; `/color` also works but is not listed.
  - Colour: DARK `#f27ba8`, LIGHT `#b0306a`, NEUTRAL `magenta`. Background: DARK `#3a1e2b`, LIGHT `#f7e3ec`, NEUTRAL `''`.
  - Gradient stops: `['#f26e69', '#e5a23c', '#ace02c', '#55c7d9', '#6579fd', '#ad95e9']` in DARK. The LIGHT and NEUTRAL themes use their mode colour and `violet`.
- **The field.** A filled block three rows tall at the full content width (`width − 4`, from column 2). Fill `palette.selectionBg`, no border.
  - Content starts with one space, then `›`. The `›` is in the colour mode's colour while focused, and `palette.border` at rest.
  - Empty: one dim hint, `type an image path` (palette) or `type a hex code` (scale), in `palette.border`.
  - At rest: the value in `palette.dim`, then 3 spaces and its detail in `palette.border`.
  - A whole hex gets a 4-cell swatch two cells after it.
- **Typing.** Only `#`, `/`, `~` or a paste (multi-character input) start typing. Every other letter is a key. While the field is focused, the keys are `↵ done` and `esc cancel`.
- **Copying.**
  - `↵` copies the chosen hex (`#RRGGBB`).
  - `c` copies `paletteCard(...)` / `scaleCard(...)` with the shell's theme (`'dark'` or `'light'`).
  - Confirmations replace the detail line for 1.5 s: `✓ copied #FD6457`, or `✓ copied N swatches · paste into Figma with ⌘V`.
- **The trail** (`Trail = {answers, current}`):
  - palette: `{[], 'Palette'}`
  - inside a colour: `{['Palette'], '#HEX'}`
  - a scale from the palette: `{['Palette'], 'Scale'}`
  - after `r`: the previous reference is appended to the answers
- **esc.** It walks back one entry of the colour flow's own history. At the root it returns to colour home.
- **Invariants.**
  - Invariant 1: `colour-art.ts` and `state.ts` import no Ink or React.
  - Invariant 3: an opened path is probed by content (`samplePixels` already probes).
  - Invariant 7: sampling shows no percentage. It uses W5's rules: nothing for 0.3 s, then the spinner line `Finding colours`.
- **Fallbacks.**
  - `trueColour(env)` in `glyphs.ts`: on for `COLORTERM=truecolor|24bit`, or for the `slantedChips` program/term sets; `FORGE_TRUECOLOR=1|0` overrides it; off under `NO_COLOR`.
  - Without true colour, one dim line: `colours shown approximately · this terminal has 256 colours`.
  - Under `NO_COLOR` (`palette.selectionBg === ''`):
    - the palette is rows of `#HEX  NN%`
    - the scale is rows of `step  #HEX  white R rating · black R rating`
    - no photo map, no swatches; every key still works
- **Commits.**
  - one commit per task on `feat/colour-shell`
  - message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`
  - `npm run lint` and `npm run typecheck` are clean, and the full suite is green, before each commit

## Review Focus

1. **A dropped path that is not an image** (a PDF, a folder, a missing file). The palette screen stays on the field with the text kept. One line under the field names what it is ("report.pdf is a PDF, not an image"). Nothing crashes, and the old palette is not lost. Pinned in Task 6.
2. **Keys while the field has focus.** `c`, `r` and `s` typed inside a path or a hex go into the field, not to the actions. `esc` in the field cancels the edit and restores the previous value. Pinned in Task 4.
3. **Terminal width.** At 80 × 24 every colour screen fits: no row wider than 80 and nothing cut off. On a terminal under 24 rows, the photo map (12 rows) is the first thing to go. Pinned in Task 5.
4. **`NO_COLOR` and 256 colours.** The text-only views, and the "colours shown approximately" note. Pinned in Task 8.
5. **Mode keys elsewhere.** Pressing 4 on convert's pickers switches to colour. Ctrl-n from colour goes back to convert. `1–4 mode` appears in every hint that said `1–3`. Pinned in Task 2.

---

### Task 1: Colour as a mode in the theme, with gradient stops and `trueColour`

**Files:**
- `src/shell/theme.ts`: `ShellMode`, `MODE_ORDER`, `MODE_MARKERS`, the Palette fields `modeColour` and `modeColourBg`, `modeColours`, and `modeGradient`, which now returns `readonly string[]`.
- `src/shell/glyphs.ts`: `trueColour(env)`.
- Tests: `tests/shell/theme-modes.test.ts` (new) and `tests/shell/glyphs.test.ts` (new, or extend the existing one).

**Interfaces — Produces:**
- `ShellMode = 'convert' | 'compress' | 'pdf' | 'colour'`
- `modeGradient(p, mode): readonly string[]`
- `trueColour(env?: Record<string, string | undefined>): boolean`

- [ ] **Test first.** Write and see fail:
  - `MODE_ORDER` ends with `'colour'`.
  - `modeColours(DARK, 'colour')` is `{ fg: '#f27ba8', bg: '#3a1e2b' }`.
  - `modeGradient(DARK, 'colour')` has the six spectrum stops.
  - `modeGradient(DARK, 'convert')` is unchanged: `[modeConvert, violet]`.
  - Every `modeColours(LIGHT, 'colour').fg` clears 4.5:1 on white.
  - `trueColour({COLORTERM: 'truecolor'})` is true; `trueColour({NO_COLOR: '1', COLORTERM: 'truecolor'})` is false; `trueColour({FORGE_TRUECOLOR: '0', COLORTERM: 'truecolor'})` is false; `trueColour({TERM_PROGRAM: 'iTerm.app'})` is true; `trueColour({})` is false.
- [ ] **Implement.**
  - Fix every place the compiler reports (`MODE_KINDS` needs `colour: 'palette · scale'`; the `mode` state in `App.tsx` becomes `ShellMode`).
  - `ModeHeader.styleFor`: check whether `ModeHeader` is still imported anywhere. If not, leave it. If it is, give colour a single border and the marker `◐`.
- [ ] Run the suite, lint and typecheck, then commit `feat(shell): colour as the fourth mode in the theme`.

### Task 2: 1–4 everywhere, `/colour`, and the tab row

**Files:**
- `src/shell/App.tsx` (the regexes `/^[1-3]$/` at the number keys and `homeKey`, and the hint pairs `['1–3','mode']`)
- `src/shell/components/Home.tsx` (`homeKeys`)
- `src/shell/components/QualityStep.tsx`
- `src/shell/commands.ts` (`colour`, with `group: 'modes'`; `color` with no `group`, as an alias)
- `src/shell/home-art.ts` (`tabRows` gains `right?: { label: string; value: string }`, replacing `savesTo`)
- Tests: `tests/shell/commands.test.ts`, `tests/shell/home-screen.test.tsx` and the other tests that list three modes.

**The tab row's rule** (a plan ruling; the spec is silent):
1. The right-hand side is `label value` (`saves to ~/Desktop`, `copies to clipboard`).
2. When that leaves no 1-cell gap, it is `value` alone, in `dim`.
3. When even that does not fit, nothing.

With four tabs at 80 columns, convert's home shows `~/Desktop`, and colour's shows `clipboard`.

- [ ] **Tests first:**
  - `parseCommand('/colour')` and `parseCommand('/color')` give the colour mode, and `listCommands()` lists `colour` but not `color`.
  - With four tabs at width 80, `tabRows` contains `colour` and ends with `~/Desktop ` when `right = {label: 'saves to', value: '~/Desktop'}`.
  - In App: home, press `4`, and the tab row shows `colour` active and `clipboard`. On convert's Format picker, press `4` and you are on colour home. Ctrl-n from colour lands on convert.
  - Every key row that showed `1–3 mode` now shows `1–4 mode`.
- [ ] **Fixtures.** Home fixtures from the frozen mockup show three tabs. Change `home-screen.test.tsx` so the tab row (rows 5–6) is held to a constructed expectation instead of the fixture: `tabRows` for the same mode, compared cell for cell. Every other row stays held to the fixture. Do the same in `commands-screen.test.tsx` if it compares those rows. Ledger this as a ruling.
- [ ] Commit `feat(shell): 1–4 mode, /colour, a fourth tab`.

### Task 3: `colour-art.ts`, the rows of every colour screen

**Files:** create `src/shell/colour/colour-art.ts`. Test: `tests/shell/colour-art.test.ts`. Fixture script: `scripts/colour-mockup-fixture.mjs`, which writes `tests/shell/fixtures/colour-mockup.json`.

**Interfaces — Produces** (all pure, each returning `Row` or `Row[]`, all 80 columns wide):
- `choiceCards({ width, palette, selected: 0 | 1, samples }): Row[]`: home's panel for colour, 8 rows. It holds two 36-wide cards, Palette and Scale. The chosen one is on `panelBand` with a `▌` in the mode colour. Each card has its name (bold on the chosen card), a sub-line (`the colours of an image` / `50 to 950 from one colour`), and a preview strip: six 4-cell palette swatches, or eleven 2-cell ramp swatches. `samples` gives the preview colours; App passes fixed constants (the Sonoma six and the `#6579FD` scale) so home looks like the mockup.
- `fieldRows({ width, palette, content, focus }): Row[]`: the 3-row filled field (Global Constraints). `content` is a `Row`.
- `fieldValue({ palette, value, detail?, swatch? }): Row` and `fieldHint(palette, text): Row`: the content of the field at rest, and empty.
- `dropZone({ width, palette, typing, formats }): Row[]`: `surfaceRows` with the title `Drop an image here` and the sub-line `formats`. `surfaceRows` gains an optional `title` parameter, default `Drop a file here`.
- `photoRows({ palette, groups, map, lit, outside? }): Row[]`: 12 rows of 24 cells of `▀`. Each cell's fg is the top pixel's colour and its bg the bottom's, by the photo-map index.
  - The lit group's colour is drawn as it is. Others are mixed 78% toward `palette.canvas`.
  - `OUTSIDE` cells use `outside` (the parent level's colours, mixed 90%).
  - `TRANSPARENT` cells are blank.
- `listRows({ palette, items, selected, header? }): Row[]`, the right-hand list. Each entry is `{ hex, rgb, pct, of? }`, one entry every other row: a 4-cell swatch, 2 spaces, the hex (bold and `fg` when selected), a bar 14 cells long scaled to the largest `pct` (`█` plus eighths), a space, then `NN%`. The selected row sits on `listBand` with `▌` in the mode colour. `header` is the parent-colour line for going deeper.
- `paletteBody({ ... }): Row[]`: photo plus list, side by side. The photo starts at column 4; the list starts 4 cells after it.
- `detailRow({ palette, text }): Row` and `copiedRow({ palette, what }): Row`.
- `rampRows({ palette, steps, selected }): Row[]`: S1, 5 rows (labels, 3 swatch rows, `▔` mark).
- `previewRows({ palette, step }): Row[]`: S9, 5 rows. An 18 × 5 block with `Aa` in `#FFFFFF` and in `#000000`, then 4 spaces and the facts (step, hex, OKLCH, `white text R rating`, `black text R rating`, with the rating in `ok` when it is at least AA).
- `emptyRampRows({ palette }): Row[]`: the step labels and outlined boxes in `faint`.

- [ ] **Fixture script.** Write `scripts/colour-mockup-fixture.mjs` on the `mockup-cells.mjs` pattern, `mockupScript('colour-2026-10.html')`. Before `/* ------------------------------------------------------------------ tabs */`, inject code that:
  - sets `USE_FILLED = true`
  - captures the rows of `STEPS` and `BRANCH` (each `r()` gives rows or `{rows, cursor}`)
  - stores `{ id, title, rows: fixtureRows(rows, 80, 24) }`

  Run it. It writes `tests/shell/fixtures/colour-mockup.json` with 15 frames.
- [ ] **Tests first**, holding builder output to fixture rows with `describeRow(runsRow(row), fixtureRow(frame, n))`:
  - frame `1`, rows 8–15: `choiceCards` with `selected: 0`
  - frame `B1`, same rows: `selected: 1`
  - frame `2`, rows 2–4: the empty palette field; rows 6–13: `dropZone`
  - frame `4`: the field at rest (rows 2–4), `paletteBody` (rows 6–17) and the detail row (19)
  - frame `5`: going deeper (`header` plus shades, photo with `outside`)
  - frame `8`: the scale field at rest, `rampRows` and `previewRows`
  - frame `B2`: the empty scale (field plus `emptyRampRows`)

  Build the inputs from the same data the mockup used: the Sonoma palette numbers are in the HTML's `CDATA`. Read them in the test from the fixture script's output: the script also writes `CDATA` into the fixture JSON as `data`. Where a row differs only because the mockup used a stand-in (for example a cursor cell), say so in the test and compare the rest. Write the tests and watch them fail before writing any builder.
- [ ] Implement each builder until its test passes. Commit `feat(shell): colour screens as rows, held to the mockup`.

### Task 4: `state.ts`, colour mode's behaviour as a reducer

**Files:** create `src/shell/colour/state.ts`. Test: `tests/shell/colour-state.test.ts`.

**Interfaces — Produces:**

```ts
type Screen =
  | { kind: 'palette-empty' }
  | { kind: 'palette'; path: string; name: string; meta: string; level: number[]; sel: number }
  | { kind: 'scale-empty' }
  | { kind: 'scale'; ref: Rgb; from?: string; sel: number }
interface ColourState {
  history: Screen[]
  field: { text: string; focus: boolean }
  flash?: { text: string; until: number }
  error?: string
}
type Action =
  | { type: 'key'; input: string; key: KeyLike }   // KeyLike: the subset of Ink's Key we read
  | { type: 'opened'; path: string; name: string; meta: string }  // a probe succeeded
  | { type: 'refused'; message: string }                          // a probe failed
  | { type: 'tick'; now: number }
reduce(state: ColourState, action: Action, ctx: Ctx): { state: ColourState; effects: Effect[] }
type Effect =
  | { type: 'copy'; text: string }
  | { type: 'open'; path: string }   // probe and sample
  | { type: 'back' }                 // leave colour flow → colour home
```

`Ctx` gives the reducer what it cannot compute: `{ groups(level): Group[]; canOpen(level, i): boolean; card(): string; now: number }`. `level` is the drill path into the palette: `[]` is the top, `[5]` is inside group 5.

- [ ] **Tests first, one per rule.** The reducer runs with a fake `Ctx`.
  - **Typing:**
    - `#` on a scale focuses the field with `#`.
    - Typing `6579FD` makes the field text `#6579FD`, and the screen becomes `scale` with that ref.
    - `/`, `~` or a paste focuses the field on the palette screen.
    - `c`, `r` and `s` do not type when the field is not focused.
    - While the field is focused they do type, and do not act.
    - `esc` while focused restores the previous text and unfocuses.
  - **Palette:**
    - `↑↓` move `sel`.
    - `→` pushes a deeper screen only when `canOpen`.
    - `←` and `esc` pop.
    - `↵` emits `copy` of the selected hex and a `✓ copied` flash.
    - `c` emits `copy` of `card()` and the `N swatches` flash.
    - `s` pushes `scale` with that colour and `from: <file name>`.
    - `#` focuses the field; a whole hex then pushes `scale` with that ref.
  - **Scale:**
    - `←→` move `sel`.
    - `r` pushes `scale` with `ref = steps[sel]` and `from = 'was <step> of <old ref hex>'`, with `sel` back at 5.
    - `esc` pops.
  - **Root:** `esc` with one screen left emits `back`.
  - **Flash:** a `tick` past `until` clears it.
  - **Opening:** `opened` replaces `palette-empty` with `palette`. `refused` sets `error` and keeps the field text.
- [ ] Implement. Commit `feat(shell): colour mode's behaviour as a reducer`.

### Task 5: `ColourFlow.tsx`, the screen

**Files:** create `src/shell/colour/ColourFlow.tsx`. Test: `tests/shell/colour-flow.test.tsx`.

**Interfaces:**
- **Consumes:** Tasks 3 and 4, `samplePixels`, `palette`, `inside`, `photoMap`, `wholePercents`, `scale`, `paletteCard`, `scaleCard`, `onWhiteAndBlack`, `rate`, `formatRgb`, `formatOklch` (plan 1), `copy` (clipboard.ts), `Runs` (Home.tsx), `useKeys`, and `Trail`.
- **Produces:** `ColourFlow({ start: 'palette' | 'scale' | { palette: string } | { scale: Rgb }, width, height, onCancel, onTrail })`.

**Behaviour:**
- It renders: the field rows; an error line, if any; the screen body; one blank line; the detail or flash row; the keys row via the existing hint-row helper (the same as `PdfFlow`'s); and the approximate-colours line when `!trueColour()`.
- **Keys.** `useKeys` passes keys to the reducer. When the field is focused, an inline `Prompt` handles the editing (as `SaveAs.tsx` does): `variant="inline"` inside the filled row. The reducer's `field.text` is kept in sync through `onChange`.
- **Effects:**
  - `open` runs `samplePixels(path)`, then `palette()`, and caches `pixels`/`groups` per drill level, then dispatches `opened`. Errors become `refused` with `${e.detail}`.
  - `copy` calls `copy(text)`.
  - `back` calls `onCancel()`.
- **The trail** is pushed with `onTrail` from an effect keyed on its JSON, as `PdfFlow` does.

- [ ] **Tests first.** ink-testing-library, `clipboard.js` mocked as in `prompt-selection.test.tsx`, an image from `makeGradientPng`. The file starts with `vi.hoisted(() => { process.env.FORCE_COLOR = '3'; process.env.NO_COLOR = '' })`.
  - Render `<ColourFlow start={{ palette: png }} … />`, wait, and the frame contains `NN%` rows that add up to 100.
  - `↓` then `↵` puts the selected hex on the stubbed clipboard.
  - `c` puts an `<svg` card on the clipboard.
  - `s` shows the scale with `500`.
  - `esc` returns to the palette.
  - `esc` again calls `onCancel`.
  - `start="scale"`: typing `#6579FD` shows the ramp. `r` after two `→` shows `was 700 of #6579FD`.
  - **Width:** every line of every frame in this file is at most 80 cells (`stringWidth` of the stripped line).
  - **Height:** at height 18, the photo map is not drawn, and the list and keys still are.
- [ ] Implement. Commit `feat(shell): ColourFlow — palette, going deeper, scale`.

### Task 6: Home and App wiring

**Files:** `src/shell/components/Home.tsx`, `src/shell/App.tsx`. Test: `tests/shell/colour-app.test.tsx`.

**Home:**
- With `mode === 'colour'`, the panel is `choiceCards`, `field` is drawn only while `typing`, and `homeKeys` gives `←→ choose · ↵ open`, with `1–4 mode · ctrl-n new · ctrl-c quit` as the footnote.
- Home gains `colourChoice?: 0 | 1`.

**App:**
- `Step` gains `'colour'`. `colourStart` and `colourTrailNow` are new state.
- On colour home, a `useKeys` (active on `onHome && mode === 'colour'`):
  - `←`/`→` set `colourChoice`
  - `↵` enters `'colour'` with `start` from the choice
  - `#` enters scale with the field focused on `#`
  - a paste (input longer than one character) enters palette with that path, via `unescapePath`
  - `/` sets the text to `/`, which opens the commands as today (N6)
- `barTrail()`: `if (at === 'colour') return colourTrailNow`.
- `<ColourFlow … onCancel={() => setStep('idle')} onTrail={setColourTrailNow} />`.
- Ctrl-n resets `colourChoice` and the trail.

- [ ] **Tests first:**
  - Press 4. Home shows both cards and no field.
  - `→` `↵` opens the empty scale with `type a hex code`.
  - Typing `6579FD` shows the ramp, and the bar's trail reads `Scale`.
  - `esc` `esc` is back on colour home.
  - Dropping a PNG path on colour home opens its palette.
  - Dropping a PDF shows `is a PDF, not an image` on the palette field, keeps the text, and quits nothing.
  - `/` opens the commands list.
- [ ] Implement. Commit `feat(shell): colour mode on home and in the app`.

### Task 7: Sampling with W5's rules

**Files:** `ColourFlow.tsx`. Test: `tests/shell/colour-flow.test.tsx`.

- [ ] **Tests first.** A `samplePixels` mocked to resolve after 600 ms shows nothing for the first 0.3 s, then one line with the braille spinner and `Finding colours`. Resolved within 0.3 s, it never shows that line. Use the existing `useAfter` hook (`src/shell/useAfter.ts`) and the spinner frames `Working` uses.
- [ ] Implement. Commit `feat(shell): finding colours waits 0.3 s before it says so`.

### Task 8: Fallbacks

**Files:** `colour-art.ts`, `ColourFlow.tsx`. Tests: `tests/shell/colour-art.test.ts`, `tests/shell/colour-flow.test.tsx`.

- [ ] **Tests first.**
  - With `palette.selectionBg === ''` (NEUTRAL), the palette view is rows of `#HEX  NN%` with no photo rows, and the scale view is text rows as in Global Constraints.
  - With `trueColour()` false (env `FORGE_TRUECOLOR=0`), the frame contains `colours shown approximately · this terminal has 256 colours`.
- [ ] Implement. Commit `feat(shell): colour mode without true colour or without colour`.

### Task 9: Plan 1's deferred minors that the shell now reaches

**Files:** as named per item. Each gets a test first.

- [ ] `forge_palette` text uses `wholePercents`.
- [ ] MCP colour refusals append `hint`.
- [ ] `forge scale --inside` is refused as invalid arguments.
- [ ] `paletteCard` subtitle reads `1 colour` / `N colours`, and with `--inside` reads `N shades of #HEX`.
- [ ] `formatOklch` prints hue `0` when C < 0.0005.
- [ ] `scale()` with L₀ < 0.16 keeps descending toward black, using `floor = 0.42·L₀`. `#0A0A2A` and `#00000A` are added to the sweep.
- [ ] CLI swatches use `trueColour()`.
- [ ] Commit `fix(colour): plan 1's deferred minors`.

### Task 10: Docs, build, and a real run

- [ ] The README's Colour section describes the shell mode (4, the two cards, the keys).
- [ ] `npm run build`.
- [ ] Run `forge` by hand: 4 → Palette → drop a photo → walk, go deeper, copy, `s`, `r`, `c`, `#`, `esc` back.
- [ ] Commit `docs(colour): colour mode in the shell`.
