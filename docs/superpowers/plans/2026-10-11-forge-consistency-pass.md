# Consistency Pass Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every screen the shell still draws the old way is drawn with the decided parts, as `mockups/consistency-2026-10.html` shows: Convert, Compress, /pdf and the staged prompt.

**Architecture:** No new design. Each older screen gets the same parts, and the shared ones live in one place so the screens can't drift apart again:
- A `StepTitle` component wraps `titleRow`.
- `HintBar` always draws F1, with the divider above it.
- `Select` draws the grey band, and P1's tag for a default.
- `Prompt`'s field variant matches Save as's field.

/pdf ending on Save as is its own plan (`2026-10-11-forge-pdf-save-as.md`) and runs alongside this one.

**Tech Stack:** TypeScript, Ink 7, React 19, vitest, biome.

**Spec:** `mockups/consistency-2026-10.html` (the right-hand frames, with the user's notes of 2026-10-11):
- "Update everywhere."
- The divider above the key row is the user's own and stays everywhere (`HintBar`'s rule).

## Global Constraints

- CLAUDE.md invariants hold. In particular: no hardcoded format or folder lists (2), and progress never fabricated (7).
- The divider above every key row stays (`HintBar`'s rule, the terminal's width).
- Placeholders on the page are not built:
  - the hints for 72 and 300 dpi (Resolution keeps its rows; only the default's mark changes);
  - merge's one-line card (the card belongs to the drop-zone work);
  - the drop zone's own look with a file staged.
- The Target size field with the unit inside it is a proposal on the page; the user's "update everywhere" takes it.
- Coordinate before editing `App.tsx`: the Done session (K3·a) is editing its result block in the same checkout. Stay out of the result block, the run-completion code, `blocks.tsx`, `Done.tsx` and `done-art.ts`.
- Each test walking the shell waits for its screen (`until`), never a fixed sleep.

## Review Focus

1. **Narrow terminals (compact band, under 60 columns).** Every title, field and key row fits without wrapping. The F1 footnote drops items from the right before it would wrap (`KeyRow`).
2. **`NO_COLOR`.** The grey band falls back to the strip alone, the default tag to the word, titles to plain text. Nothing reads by colour alone.
3. **esc wording.**
   - It says `back` wherever esc goes back.
   - It says `cancel` only where it abandons the run: Name taken, Can't get that small.
   - It never says "remove file", "clear / back" or "close app".
4. **The light theme.** Every new use of a token has a light value: `listBand`, `defaultTag`, `defaultTagBg`, `pill`.
5. **Name taken with many outputs (a /pdf split).** Keep both renames every colliding output, never just the first.

---

### Task 1: The shared parts

**Files:** create `src/shell/components/StepTitle.tsx`; modify `src/shell/components/HintBar.tsx`, `src/shell/components/Select.tsx`, `src/shell/components/Prompt.tsx`, `src/core/actions/convert.ts` (dpi: `badge: 'default'` instead of `hint: 'default'`). Tests: `tests/shell/step-title.test.tsx` (new), `hints-*.test.tsx`, `select*.test.tsx`, `prompt-*.test.tsx`.

- `StepTitle({ mode, title, aside, width })` renders `titleRow`. `QualityStep` and `SaveAs` switch to it.
- `HintBar({ pairs, foot, width })`:
  - `foot` is required; the old caps-only row goes.
  - The default foot is `[['esc', 'back'], ['ctrl-c', 'quit']]`.
  - Screens with `1–3 mode` put it first in the foot.
- `Select`:
  - The highlighted row's band is `palette.listBand`, grey, not the mode's tint.
  - The strip is `▌` in the accent colour.
  - A `badge` is drawn as P1's tag at the far end of the row (`defaultTagBg`/`defaultTag`, one cell inside the band's edge), and the ★ goes.
  - Under NO_COLOR the badge is the bare word.
- `Prompt` variant `field`: width `min(76, width - 4)`, filled in every band. `plain` stays only for no colour.
- Tests:
  - the band colour;
  - the badge as a tag;
  - the field's width at 40/80/120;
  - F1 on a HintBar with no `foot` given.

### Task 2: Convert and Compress screens

**Files:** `src/shell/App.tsx` (the `target`, `pages`, `page-picker`, `dpi`, `mode`, `size`, `size-unreachable` and idle-prompt render blocks only), `src/shell/components/UnitRow.tsx`. Tests: `tests/shell/consistency-app.test.tsx` (new), and the screen tests that assert the old titles.

| Screen | Title | Aside | Foot |
| --- | --- | --- | --- |
| Format | `Convert to` | `n/N`, the highlighted row's position | `1–3 mode · esc back · ctrl-c quit` |
| Pages | `Pages` | `<file> · N pages` | same as Format |
| Resolution | `Resolution` | `<file>` | same as Format; the 150 dpi default is the tag from Task 1 |
| Method | `Method` | `<file>` | `esc back` (not "remove file") |
| Target size | `Target size` | `<file> · <size>` | `↵ confirm`, `tab unit` |
| Can't get that small | `<file> can't get below <smallest>` | `asked for <size>` | `esc cancel` |
| Staged prompt | — | — | home's F1 row: `↵ send` / `commands · esc clear · ctrl-n new · ctrl-c quit` |

- **Target size:** the unit moves inside the filled field as pills (the chosen one white, the others dim), right-aligned. The separate unit row and the `→ 1 B` echo go.
- **Can't get that small:** the highlighted answer says what it does ("saves photo-small.jpg at 326 B"). The bar's trail ends at the size.
- **Staged prompt:** "close app" goes.
- **Tests:** one App-level test per screen, asserting the title row's text (`/^ Pages +report\.pdf · 3 pages$/m`) and the key row's foot.

### Task 3: Name taken (L1), in convert and /pdf

**Files:** create `src/shell/components/NameTaken.tsx`; modify `src/shell/App.tsx` (the `overwrite` and `pdf-blocked` output-exists blocks), `src/shell/trail.ts` (`overwrite`/`pdf-blocked` → `Name taken`). Tests: `tests/shell/name-taken.test.tsx` (new), `app-safety.test.tsx`, `pdf-flow-app.test.tsx`, `trail.test.ts`.

The decided L1 is the "Name taken ✓" tab of `mockups/flow-parts-2-2026-10.html` (`exists.js`):
- **Title:** `<name> already exists`, with the old file's size and age at its right (one `stat`).
- **Rows:** Keep both, Replace, Cancel, in that order. Only the highlighted row speaks:
  - Keep both: `saves yours as test (1).jpg`, the ` (1)` bold in the mode's colour;
  - Replace: `test.jpg  68.2 KB`, struck through in the quiet grey, then the band hatched in faint `╱`;
  - Cancel: `back to Save as`.
- **Keys:** `esc cancel · ctrl-c quit`.
- **In /pdf:** the same component.
  - Keep both runs the jobs with every colliding output given `uniqueOutputPath`.
  - Cancel goes back to Save as on the folder (the /pdf plan's Task 4).
  - The red `✕` heading and the extra "esc or enter to go back" line go.
- **Not output-exists:** /pdf's other refusals (output is the input, and so on) keep today's error card. Only the existing-file question becomes L1.

### Task 4: /pdf screens

**Files:** `src/shell/flows/pdf.tsx`, `src/shell/components/MergeList.tsx`, `src/shell/components/PageGrid.tsx` (keys only). Tests: `pdf-flow.test.tsx`, `merge-list.test.tsx`, `page-grid.test.tsx`.

- **Hub:** title `Choose an operation`, aside `<file> · N pages`. The Select is no wider than the file card (`min(width, CARD_WIDTH)`), as App's pickers are. A row that can't be chosen shows why, quietly. esc says back.
- **Option pickers (split's How, rotate's Turn, extract's Output):** a title from the spec's label (`How to split` for split's mode, otherwise the label), the file's page count at its right, and the band at card width.
- **Every N pages:** title `Pages per file`, the `field` Prompt from Task 1. The field says what the number makes: `pages each → 2 files`.
- **Extract/Delete pages:** title `Pages` with `n of N selected` at its right. F1 keys, with `esc back` in the foot, which today's grid row leaves out.
- **Merge:**
  - Title `Order the files`, aside `n files · N pages`.
  - Rows: the picker's band with the `▌` strip, not `❯` on a fill.
  - Keys: `choose`, not `select`; `s sort · x remove · esc back · ctrl-c quit` in the foot.
  - The output-path line and the `n` rename go, with the /pdf plan's Task 3.
- **Confirm → Save as:** the /pdf plan.

### Task 5: Verify and commit

- Run `npm run lint`, `npm run typecheck` and `npx vitest run`: all green.
- Recapture the left-hand frames on the consistency page. The right-hand frames should now match them, apart from the key row's position.
- Commit on `dev`, one commit per task.
