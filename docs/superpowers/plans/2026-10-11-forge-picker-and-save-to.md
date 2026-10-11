# The picker, Save to, and motion — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restyle every `Select` as the chosen picker (a band with a `▌` strip),
show a measured size on the highlighted format, rebuild Save to as a framed
search box, and add the motion from `mockups/motion-2026-10.html`. The launch
sweep is the one exception.

**Architecture:** Four pieces of the shell change, and nothing in `core/` or
`engines/`.
- **`src/shell/motion.ts` (new).** It owns the motion switch and the tween and
  ticker hooks.
- **`Select`.** It draws the band on a width-sized `Box`, and gains a `speak`
  prop for the highlighted row.
- **`useMeasuredSize` (new).** It runs one injected encode at a time, for the
  highlighted target only.
- **`PathInput`.** It is rewritten as a frame holding an input line and a
  `Select`.

**Tech Stack:** TypeScript, React 19 and Ink 7 (`ink-testing-library`),
Vitest, Biome.

**Spec:** `docs/superpowers/specs/2026-10-11-forge-picker-and-save-to-design.md`

## Global Constraints

- `core/` and `engines/` import no React or Ink and never write to stdout
  (invariant 1).
- No progress is fabricated (invariant 7). A size shown on a row always comes
  from an encode that actually ran.
- Every line drawn fits within the `width` it was given. Long text is cut with
  `middleEllipsis`, never wrapped.
- Each animation ticks at 33 ms or slower and stops when it has finished.
  When `motionEnabled()` is false, it shows its final frame.
- Out of scope: the start-screen drop zone, the Name step, the file card, the
  hint bar component, and the intro/logo.
- Tests run with `npx vitest run <file>`. The full suite runs with
  `npm test`, and types are checked with
  `npx tsc -p tsconfig.typecheck.json --noEmit`.

## Review Focus

1. **A dropped path with spaces or backslash escapes on Save to.** It must be
   unescaped before it is classified as a file or a folder. Owner: Task 5,
   test "classifies an escaped dropped file".
2. **A filter that matches nothing.** Esc must still clear the text, and Enter
   must do nothing. Owner: Task 5, test "no match keeps esc working".
3. **Moving off a format before its encode finishes.** The late result must
   never appear on the newly highlighted row. Owner: Task 4, test "a late
   result stays with its own target".
4. **Narrow terminals (40 columns).** Neither the band nor the frame may draw
   past the width. Owners: Tasks 3 and 5, the width-bound tests.
5. **NEUTRAL or NO_COLOR.** The selection must still be visible without any
   colour. Owner: Task 3, test "marks the selection by shape alone".

---

### Task 1: Motion primitives

**Files:**
- Create: `src/shell/motion.ts`
- Create: `src/shell/components/Shimmer.tsx`
- Modify: `src/cli/spinner.ts:23`, exporting the frames as `SPINNER_FRAMES`
- Test: `tests/shell/motion.test.tsx`

**Interfaces — produces:**
- `motionEnabled(paletteName: string): boolean`
- `setMotionForTests(on: boolean | undefined): void`
- `mix(a: string, b: string, k: number): string`
- `easeOut(k: number): number`
- `FRAME_MS = 33`
- `useTween(key: unknown, durationMs: number, opts: { enabled: boolean; onMount?: boolean }): number`
  (0→1)
- `useTicker(active: boolean, intervalMs?: number): number`
- `<Shimmer text base highlight />`

- [ ] **Step 1: Write the failing tests** for `mix` (endpoints, the midpoint,
  clamping, and a non-hex input snapping at 0.5); for `useTween` under
  `vi.useFakeTimers()` (it stays at 1 with no key change, runs 0→1 after a key
  change, and with `onMount` starts from 0 on the first render); for
  `useTicker` (the count advances while active and stops when inactive); and
  for `Shimmer` (it renders the plain text when motion is off).
- [ ] **Step 2: Run them, and check they fail** because the module is missing.
- [ ] **Step 3: Implement `motion.ts`, `Shimmer.tsx` and the export.**
- [ ] **Step 4: Run them, and check they pass.**
- [ ] **Step 5: Commit** with the message
  `feat(shell): motion primitives — tween, ticker, colour mix, shimmer`.

### Task 2: The `band` and `canvas` palette roles

**Files:** Modify `src/shell/theme.ts`. Test `tests/shell/mode-palette.test.ts`.

**Produces:** `Palette.band` and `Palette.canvas`.
- DARK: band `#252c3a`, canvas `#1e1e1e`.
- LIGHT: band `#eae4d8`, canvas `#ffffff`.
- NEUTRAL: both `''`.

`modePalette` sets `band` to the mode's background when that background is
non-empty.

- [ ] **Step 1: Write the failing tests.**
  - `modePalette(DARK, 'convert').band === DARK.modeConvertBg`, and likewise
    for pdf.
  - `modePalette(NEUTRAL, 'convert').band === ''`.
  - `selectionBg` is unchanged by `modePalette`.
- [ ] **Step 2: Run them, and check they fail.**
- [ ] **Step 3: Add the fields and the mapping.**
- [ ] **Step 4: Run them, and check they pass.**
- [ ] **Step 5: Commit** with the message
  `feat(shell): a band and canvas role in every palette`.

### Task 3: The picker look in `Select`

**Files:** Modify `src/shell/components/Select.tsx`. Tests: `tests/shell/select.test.tsx`,
`tests/shell/select-band.test.tsx`, `tests/shell/convert-pdf.test.tsx:160`,
`tests/shell/mode-colour-app.test.tsx:31` (their `❯` expectations become `▌`).

**Interfaces:**
- Consumes the motion helpers from Task 1 and `palette.band` and
  `palette.canvas` from Task 2.
- Produces a new optional prop,
  `speak?: (item: Choice, budget: number) => ReactNode`, which replaces the
  hint on the selected row. It also adds `SYMBOLS.strip = '▌'`.

**What the rows look like:**
- Every row is a `Box` exactly `width` columns wide.
- The selected row's background is `band`, faded in from `canvas` over 140 ms.
  The row it left fades back out.
- The marker is `▌ ` in `accent` on the selected row and two spaces
  elsewhere.
- A hint is shown on the selected row (when `showHints` is on) and on disabled
  rows, and on no other row.
- A badge is drawn as `★ <badge>` in `accent`, pushed to the right edge by a
  `flexGrow` spacer.

- [ ] **Step 1: Write the failing tests.**
  - `▌ WebP` appears.
  - The PNG row's hint (`lossless`) is not shown while WebP is selected, and
    appears after moving down.
  - A disabled row keeps its hint.
  - `speak` replaces the hint, and is called only for the selected row.
  - A badge renders as `★ default` at the end of its row.
  - Under NEUTRAL, the selected row still starts with `▌` ("marks the
    selection by shape alone").
  - Lines stay within 20, 30, 40 and 80 columns.
- [ ] **Step 2: Run them, and check they fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run `select*`, `convert-pdf` and `mode-colour-app` after
  moving their `❯` expectations to `▌`, and check they pass.**
- [ ] **Step 5: Commit** with the message
  `feat(shell): the picker — a band with a strip, hints on the highlighted row`.

### Task 4: Measured sizes in the format picker

**Files:**
- Create: `src/shell/useMeasuredSize.ts`
- Create: `src/shell/components/SizeAside.tsx`
- Modify: `src/shell/App.tsx` (the target step and one `useMeasuredSize` call)
- Tests: `tests/shell/measured-size.test.tsx`

**Interfaces:**
- `useMeasuredSize({ highlighted, measure, resetKey, delayMs = 150 })` returns
  `{ status: 'idle' } | { status: 'measuring' } | { status: 'done'; bytes: number }`.
- `<SizeAside status sourceBytes budget />`

**Behaviour of `useMeasuredSize`:**
- It runs one measurement at a time, starting `delayMs` after the highlight
  settles.
- Results are cached per target, and the cache is cleared when `resetKey`
  changes.
- A failed measurement reads as `idle`.

**`SizeAside`** shows one of three things:
- `measuring…` as a `Shimmer`;
- `74.6 KB  39% smaller`, with the percentage in `ok` (or `larger` when the
  file grows);
- nothing, when `budget` is under 24 columns.

**App wiring:**
- `measureTarget` is defined only for a single staged image. It plans with the
  live values and the target, then returns
  `encodeToBuffer(...).length`.
- The target `Select` gets `speak` and `onHighlight`.

- [ ] **Step 1: Write the failing hook tests.** Each injects a `measure`
  function the test resolves by hand.
  - It starts as `measuring`, then reads `done` once resolved.
  - "A late result stays with its own target": move to B, resolve A, and B
    still reads `measuring`.
  - A failure reads `idle`.
  - Without `measure`, it reads `idle`.
  - A `resetKey` change clears the cache.
  - `SizeAside` text and tone render correctly.
- [ ] **Step 2: Run them, and check they fail.**
- [ ] **Step 3: Implement the hook, the component and the App wiring.**
- [ ] **Step 4: Run the tests, and `tests/shell/app-convert.test.tsx`, and
  check they pass.**
- [ ] **Step 5: Commit** with the message
  `feat(shell): the highlighted format shows its measured size`.

### Task 5: Save to as a framed search box

**Files:** Rewrite `src/shell/components/PathInput.tsx`, and change the
destination `HintBar` in `src/shell/App.tsx`. Tests: rewrite
`tests/shell/path-input.test.tsx`, and change `tests/shell/set-default.test.tsx`
from `d` to tab and from `[default]` to `★ default`.

**Interfaces:**
- The props are unchanged except that `onRename` is removed (it has no
  callers).
- The rows come from a pure function,
  `destinationRows(text, presets, defaultPath, preview): Choice[]`, which is
  exported for the tests.

- [ ] **Step 1: Write the failing tests.**
  - The frame shows the label in its top border and the count `4/4`.
  - Typing `do` leaves only Downloads.
  - "Classifies an escaped dropped file": write `/tmp/x\ y/a.png` as a file
    and drop it. The single row reads `Next to a.png`, and Enter submits
    `/tmp/x y`.
  - A folder path reads `Use this folder`.
  - "No match keeps esc working": typing `zzz` shows the no-match row, Enter
    does nothing, the first Esc clears the text and the second cancels.
  - Tab calls `onMakeDefault` with the highlighted place.
  - The CR/LF test and the stray-escape test are carried over.
  - Lines stay within 40, 55 and 80 columns.
- [ ] **Step 2: Run them, and check they fail.**
- [ ] **Step 3: Implement the rewrite and change the App hint bar** to
  `type filter`, `↑↓ choose`, `↵ save here`, `tab make default`, or just
  `tab make default` when compact.
- [ ] **Step 4: Run `path-input` and `set-default`, then `npm test`, and check
  they pass.**
- [ ] **Step 5: Commit** with the message
  `feat(shell): Save to is a framed search box that takes a dropped file`.

### Task 6: Motion on the converting line, the receipt and the header

**Files:**
- Create: `src/shell/components/WorkingLine.tsx`
- Modify: `src/shell/App.tsx` (the converting step's label, when there is no
  `attempt`)
- Modify: `src/shell/components/ReceiptCard.tsx` (the after-bar tween)
- Modify: `src/shell/components/HeaderBar.tsx` (the fill wipe on a mode change)
- Tests: `tests/shell/motion-surfaces.test.tsx`

**Behaviour:**
- **`WorkingLine`** shows `<spinner> Converting…  1.2s` when motion is on, and
  the plain `Converting…` when it is off.
- **The receipt's after bar** draws `round(after × easeOut(k))` cells, where
  `k` comes from `useTween('mount', 500, { onMount: true })`.
- **`HeaderBar`**, when the mode changes, splits each segment at the wipe edge.
  Cells left of the edge get the new fill and cells right of it the old one,
  over 260 ms.

- [ ] **Step 1: Write the failing tests** with `setMotionForTests(true)` and
  fake timers.
  - The spinner frame and the elapsed time appear, and are absent with motion
    off.
  - The receipt's after bar is shorter at 100 ms than at 600 ms, and full at
    600 ms.
  - The header shows both fills mid-wipe and one fill after 300 ms.
- [ ] **Step 2: Run them, and check they fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them plus `receipt-card*`, `header-bar` and
  `mode-colour-app`, and check they pass.**
- [ ] **Step 5: Run `npm test` and the typecheck, then commit** with the
  message `feat(shell): motion — spinner and elapsed time, bars draw once,
  mode wipe`.
