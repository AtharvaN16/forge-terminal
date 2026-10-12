# The drop zone, once a file lands — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dropped files are read the moment the paste arrives and shown on home — one file as a card on the drop surface, several as a list — with files that could not be read as one red line under the field.

**Architecture:** Pure row builders in `home-art.ts` draw the card, the list and the row under the field; `Home.tsx` chooses between them from two props (`staged`, `under`); `App.tsx` detects a paste into the empty home field, resolves it with the logic `submitPath` already has, keeps home on screen while files are staged, and gives ↵/esc their staged meanings.

**Tech Stack:** TypeScript, React 19 + Ink 7, vitest + ink-testing-library, biome.

**Spec:** `docs/superpowers/specs/2026-10-11-forge-drop-zone-design.md`

## Global Constraints

- Work only in the worktree `.claude/worktrees/drop-zone` on branch `feat/drop-zone`. Stage only your own files (`git add <paths>`), never `git add -A`.
- `core/` and `engines/` do not change.
- Colours come from the palette (`DARK` etc. in `src/shell/theme.ts`), never hex literals in `src/`.
- Tests earn their place: no test that restates the implementation; prefer one test that pins a behaviour a user would notice. Do not loop on flaky timing — `settle()` with 300–400 ms like the existing app tests.
- `npm run typecheck`, `npm run lint` and the touched tests pass before each commit.

## Already done (commits on the branch)

- `mockups/drop-zone-2026-10.html` — the frozen design; `scripts/drop-mockup-fixture.mjs` → `tests/shell/fixtures/drop-mockup.json`: three 80×24 frames, by label — `one` (photo.png as the card), `three` (three HEICs as the list), `many, one left out` (8 files, "+5 more", and the R1 row on row 18).
- `src/shell/stage.ts`: `StagedFile`, `StagedView`, `cardFacts(source)`, `stagedView(stage, fresh)`, `UnderField`, `underField(stage, mode)`, `stagedVerb(stage, mode)`.
- `src/shell/components/Home.tsx`: `homeKeys({ …, staged?: { count; verb } })` returns the staged key rows; `Home` accepts `staged?: StagedView` and `under?: UnderField` but does not draw them yet.

## Review Focus

1. A paste of text that is not a path (or a half path) must stay in the field as typed — no error, no clearing.
2. ↵ pressed before a paste has been read must not stage twice or lose the file (the drop resolution is superseded by `requestId`).
3. A long file name (> 36 columns) must be middle-ellipsised in the list and never push a row past the terminal width.
4. A short terminal (panel 4 rows, or none) must still show the headline and "+N more".
5. esc on a staged home clears the stage *and* its failures; a later drop starts fresh.

---

### Task A: Draw the staged drop zone (art + Home)

**Files:**
- Modify: `src/shell/home-art.ts` (generalise `surfaceRows`' dotted panel; add `stagedCardRows`, `stagedListRows`, `underRow`)
- Modify: `src/shell/components/Home.tsx` (draw `staged` and `under`)
- Modify: `src/shell/components/FileCard.tsx` (use `cardFacts` from `stage.ts` instead of its inline copy)
- Test: `tests/shell/drop-cells.test.tsx` (new), `tests/shell/home-art.test.ts` (add)

**Interfaces:**
- Consumes: `StagedView`, `StagedFile`, `UnderField` from `src/shell/stage.ts`.
- Produces (exported from `home-art.ts`):
  - `stagedCardRows({ width, rows, palette, mode, file }: { width: number; rows: number; palette: Palette; mode: ShellMode; file: StagedFile }): Row[]` — exactly `rows` rows.
  - `stagedListRows({ width, rows, palette, mode, view }: { width: number; rows: number; palette: Palette; mode: ShellMode; view: StagedView }): Row[]` — exactly `rows` rows.
  - `underRow({ width, palette, under }: { width: number; palette: Palette; under: UnderField }): Row`.

**Drawing, exactly as the fixture (cell-level):** all panel rows are `HOME_MARGIN` blank, then `W = width − 2·HOME_MARGIN` cells on `palette.selectionBg`.
- *Card* (`file`): the dotted surface of `surfaceRows`, every dot at **0.42×** its resting strength (rest uses `k`, typing `k·0.45`; card uses `k·0.42`), with the card as the cut-out's lines and a cut-out padding of **1** each side (rest uses 4: `a = floor((W − words − 2·pad)/2)`, then widen to the next dot either side, as today). Card width `cw = min(52, W − 6)`; rows: top `╭─ ` + tag (mode colour `modeColours(palette, mode).fg`, bold) + ` ` + `─`×(cw − 5 − tagWidth) + `╮`; `│ ` + name (bold `fg`, padded to cw − 4) + ` │`; `│ ` + facts (`dim`) + ` │`; `╰` + `─`×(cw−2) + `╯`. Frame glyphs in `palette.border`. All on the panel fill.
- *List* (`view`, 2+ files): no dots. Block = headline row, blank row, up to 3 file rows, then `+N more` (N = files − 3) if more than 3. Headline: 4 spaces, headline text bold `fg`, then `   ` + total in `border`. File row: 4 spaces, name in `dim` middle-ellipsised to 36 (`middleEllipsis` from `width.ts`) padded to 40, then size in `border`. Fresh row (the last `view.fresh` files, only among those shown): 2 spaces, then a band of width 54 on `palette.panelBand`: `▌` in the mode colour, space, name in `fg` padded to 40, size in `dim`, padded with band to 54. Vertical placement: `top = 1 + floor((rows − 2 − blockLength) / 2)` blank rows first (min 0); a short panel drops the blank row first, then file rows from the end, keeping headline and `+N more`.
- *Under row*: 4 spaces (`HOME_MARGIN + 2`), then for `left-out`: `✕` bold `fail`, space, `"<count> file(s) left out"` bold `fail`, then in `dim`: `"   <name> · <reason>"` + (`more > 0` ? `", +<more> more"` : ''); for `note`: the text in `dim`. Clipped to width.

**Home.tsx:** panel = commands (unchanged) › `staged` with 1 file → `stagedCardRows` › `staged` with 2+ → `stagedListRows` › rest `surfaceRows`. When `under` is set: a blank row then `underRow` right after the field, and the completions list gets 2 fewer rows. With `layout.surface === 0` and `staged`, put the headline (one file: `name · size`) as the under-field row instead when there is no `under`.

- [ ] **Step 1: Cell test first.** `tests/shell/drop-cells.test.tsx`: load `drop-mockup.json` via `loadFixture` (`tests/shell/home-cells.ts`); render `<Home>` at 80×24 in the DARK theme the way `tests/shell/home-screen.test.tsx` does (copy its render helper), with a `Prompt` `variant="home"` placeholder `drop more, or type a path`, `staged` built from the fixture's data (one: `{tag:'PNG', name:'photo.png', size:'122 KB', facts:'2756×774 · 122 KB · transparent'}`; three: IMG_4101.HEIC 2.1 MB, IMG_4102.HEIC 1.9 MB, IMG_4103.HEIC 2.4 MB, total 6.4 MB, headline `3 images`; many: the three HEICs, IMG_4104.HEIC 2.2 MB, IMG_4105.HEIC 2.0 MB, `Screenshot 2026-10-09 at 14.02.11.png` 840 KB, photo.png 122 KB, report.pdf 1.4 MB, total 13.2 MB, headline `8 files`; `fresh: 0`) and `under` (many: `{kind:'left-out', count:1, name:'archive.zip', reason:'unsupported file type', more:0}`). Compare rows 0–16 of every frame (`ansiRow` vs `homeRow`), row 18 of "many", and row 23 (keys) of "one" only — the list's key row deliberately differs from the mockup (spec: `esc clear` until batch). Note: run `homeRow`-style comparison; row 22 is the rule above the keys (see `homeRow`).
- [ ] **Step 2:** run it, see it fail. `npx vitest run tests/shell/drop-cells.test.tsx`
- [ ] **Step 3:** implement the builders and Home wiring; make `FileCard` use `cardFacts`.
- [ ] **Step 4:** add to `tests/shell/home-art.test.ts` only: (a) a 4-row list panel for 8 files keeps the headline and `+5 more` and every row is exactly `width` wide; (b) with `fresh: 2` only the last two shown rows carry `palette.panelBand`; (c) a 60-character name never makes a list row wider than 80.
- [ ] **Step 5:** `npx vitest run tests/shell/drop-cells.test.tsx tests/shell/home-art.test.ts tests/shell/home-screen.test.tsx tests/shell/file-card.test.tsx` green; `npm run typecheck && npm run lint`.
- [ ] **Step 6:** commit `feat(shell): the drop zone draws what is staged — a card for one, a list for several`.

### Task B: Read drops on paste, keep home while staged (App)

**Files:**
- Modify: `src/shell/App.tsx`
- Create: `tests/shell/drop-zone-app.test.tsx`
- Modify/delete, to match the spec: `tests/shell/batch-refusal.test.tsx`, `tests/shell/multi-file-drop.test.tsx`, `tests/shell/folder-drop.test.tsx`, `tests/shell/merge-list.test.tsx`, `tests/shell/stage-esc.test.tsx`, `tests/shell/drop-partial-escape.test.tsx`, `tests/shell/staged-files.test.tsx`, `tests/shell/pdf-flow*.test.tsx`, `tests/shell/compress-flow.test.tsx`, `tests/shell/sticky-context.test.tsx`, `tests/shell/failed-run-clears-stage.test.tsx`, `tests/shell/use-frame-origin.test.tsx` — only where they assert behaviour the spec changes (refusals at drop time, `PDF ×2` card at idle, "→ /pdf for page operations", the idle prompt). Delete a test whose whole point is now wrong; do not rewrite it into a weaker one.

**Interfaces:**
- Consumes: `stagedView`, `underField`, `stagedVerb` (`src/shell/stage.ts`); `Home` props `staged`, `under`; `homeKeys({ …, staged })`.
- Task A draws the panel concurrently. Until it lands, `Home` ignores `staged`/`under`; text assertions on "3 images", "photo.png" in the panel or "left out" will fail for that reason only. Write them against the spec's text anyway; the controller runs the full suite after both tasks.

**Behaviour (spec §Behaviour):**
1. Extract the resolution from `submitPath` (whole-unescaped probe, then `splitPastedPaths`, then folders through `resolveDirectory`) into `resolveDrop(text): Promise<{ sources: SourceInfo[]; failures: InputFailure[]; anyExists: boolean }>`; `anyExists` is false when every failure is "File not found" / "Invalid path" (check the `ForgeError` code in `src/core/errors.ts`). `submitPath` keeps using it.
2. In `homeKey(input, key, value)`: when `value === ''`, `[...input].length > 1`, no ctrl/meta, not `isStrayEscapeSequence(input)`, and the input does not start with `/`: it is a drop.
   - If it contains a line break: consume it (`return true`) and resolve the text before the break.
   - Otherwise `return false` (the field shows the text) and resolve it in the background.
   - Resolution uses `const id = ++requestId.current`; on completion, if `requestId.current !== id` drop the result. If `!anyExists`: leave the field (for the line-break case, `setText(text)`). Else: `setText('')`, `setStage(addToStage(stage, sources, failures))` (functional update), set `fresh` to the number of newly added sources, stay on home (`step` stays `idle`).
3. `onHome = step === 'idle'` (no longer depends on the stage); the header bar and the idle `StagedFiles` card / idle prompt / "→ /pdf for page operations" no longer render on home.
4. ↵ on an empty field with a stage (in `homeKey`, `key.return && value === ''`): one source → the post-staging logic that `submitPath` runs after `setStage` for a single drop today (compress → `mode` step or refusal; pdf → hub or refusal; convert → `target` if `hasConvertTarget`), extracted into `proceedWith(info)`; several with `stagedVerb(stage, mode) === 'pdf'` → `runCommand` for `/pdf`; otherwise nothing. `return true`.
5. esc on an empty field with a stage or failures → `setStage(clearStage())`, `fresh = 0`. `return true`.
6. A typed path + ↵ (`submitPath`) with nothing staged: unchanged. With something staged: add to the stage and stay on home.
7. Drop the drop-time refusal (`refuseUnstageable` and its call sites in `submitPath`/`stageSeveral`); keep `refuseBatch` for `/convert` and `/compress`.
8. `fresh`: state `{ count, at }`; clear after 1200 ms (a `setTimeout` in an effect); 0 when `!motionEnabled(palette.name)` (see `src/shell/motion.ts`).
9. Pass to `Home`: `staged={stage.sources.length ? stagedView(stage, fresh) : undefined}`, `under={underField(stage, mode)}`, `keys={homeKeys({ …, staged: stage.sources.length ? { count: stage.sources.length, verb: stagedVerb(stage, mode) } : undefined })}`, and the field's placeholder `drop more, or type a path` when anything is staged.

- [ ] **Step 1:** write `tests/shell/drop-zone-app.test.tsx` (pattern: `tests/shell/multi-file-drop.test.tsx` — `render(<App …/>)`, `stdin.write`, `settle`; fixtures from `tests/helpers/fixtures.ts`). Keep it to these, one `it` each:
  1. pasting one PNG's path stages it on home: frame shows the file name and `drop more, or type a path`, and the field is empty; then ↵ reaches the target picker (`Convert to`).
  2. pasting a second path adds: two PNGs pasted in two writes → `2 images`, and ↵ does nothing (still home).
  3. pasting a path that does not exist leaves it in the field as text, no error block.
  4. a pasted path ending in `\r` is still a drop (stages, does not go to the target picker).
  5. pasting a real file and an unreadable one (a `.zip` or a text file written into the temp dir) → `1 file left out`; esc clears both the stage and the line.
- [ ] **Step 2:** run, see failures.
- [ ] **Step 3:** implement 1–9.
- [ ] **Step 4:** run the listed existing tests; update or delete the ones the spec changed (see Files). Do not chase failures in other files caused by the missing drawing (Task A).
- [ ] **Step 5:** `npm run typecheck && npm run lint`; commit `feat(shell): drops are read on paste and stay on home`.

### Task C (controller): integrate

- [ ] After A and B: `npx vitest run` (whole suite), fix integration breaks, `npm run typecheck && npm run lint`, commit. Then one whole-branch review (superpowers:requesting-code-review), fix, and hand back.
