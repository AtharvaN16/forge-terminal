# Errors (E5, E5·b) — implementation plan

Spec: `docs/superpowers/specs/2026-10-11-forge-errors-design.md` (binding).
Mockup: `mockups/flow-parts-2-2026-10.html`, tab "9 · Errors ✓"; its page
script defines `e5`, `LINE1.b`, `line1Screen`, `ER`, `ER1`, `ERT`, `FAIL_`.

Branch `feat/errors`, worktree `.claude/worktrees/errors`. Tasks 1 and 2 run
in parallel (disjoint files); Task 3 after both.

## Global constraints

- `core/` imports no React/Ink/Chalk and never writes to stdout (invariant 1).
- `ForgeError.short` is optional; no existing constructor call changes shape.
- `failTint`: DARK `#2e2020`; NEUTRAL `''`; LIGHT a pale red on which LIGHT
  `fail` (#b3261e) and LIGHT `fg` (#23262d) each clear 4.5:1 — measure and
  state the ratio in a comment, as the other LIGHT tokens do. Declared next to
  `fail` in `Palette` and in each palette object.
- Red text only ever on the tint. Title in E5 is `fg` bold; in E5·b it is
  `fail` bold. Reason/detail `fg`; hint `dim`.
- E5 hint text is `shellHint ?? hint`.
- Without fills (palette fill `''`, or `plain`): E5 tab row reads `✕ failed`
  (fail, bold); E5·b row starts `✕ ` then the title.
- Tests: TDD. Each test owns one behaviour and lives in the file that owns
  the unit (extend an existing test file where one owns it; a new file only
  for a new unit). No assertion duplicated across files. Run the test files
  you touch, plus `npm run typecheck` and `npm run lint`; do not loop on the
  full suite — run it once at the end of your task.
- Commit only your own files, by explicit path (`git add <paths>`;
  `git commit`). Another task may be committing in the same worktree: if
  `index.lock` exists, wait a few seconds and retry. Never `git stash`,
  never `git add -A`.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Task 1: `short` on ForgeError (core)

Files: `src/core/errors.ts`, `tests/core/errors.test.ts`.

- Add `short?: string` to `ForgeErrorInit` and a `readonly short?: string` to
  `ForgeError` (doc comment: the detail in one line, for the shell's one-line
  refusal row; absent means the shell shows `detail`). Set it in the
  constructor.
- Set `short` in these constructors, `<name>` = `basename(path)` as their
  details already use:

| code | short |
|---|---|
| `file-not-found` | `<name> could not be found.` |
| `not-a-file` | `<name> is not a file.` |
| `permission-denied` | `<name> could not be read.` |
| `not-a-directory` | `part of <name>'s path is not a folder.` |
| `symlink-loop` | `<name>'s path loops back on itself.` |
| `path-too-long` | `<name>'s path is too long.` |
| `unreadable-path` | `<name> could not be checked.` |
| `unsupported-source` | `<name> is <detected>, which Forge cannot read.` (same `<detected>` the detail uses) |
| `corrupt-source` (both constructors) | `<name> could not be read.` |
| `encrypted-source` | `<name> is password-protected.` (`<name>` as its detail names it) |
| `heic-decoder-unavailable` | `HEIC needs sips, which could not be run.` |

- Tests: one table-driven test over the constructors above asserting each
  `short`; one asserting a constructor not in the table (e.g.
  `conversionFailed`) leaves `short` undefined.

## Task 2: the art, the token, the components

Files: `src/shell/theme.ts`, `src/shell/width.ts`, `src/shell/error-art.ts`
(new), `src/shell/components/ErrorPanel.tsx` (new),
`src/shell/components/ErrorLine.tsx` (new),
`scripts/errors-mockup-fixture.mjs` (new),
`tests/shell/fixtures/errors-mockup.json` (generated),
`tests/shell/error-art.test.ts` (new), `tests/shell/width.test.ts`.

- `theme.ts`: `failTint` per Global constraints.
- `width.ts`: `endEllipsis(text, max)`: `text` if its `string-width` ≤ max,
  else cut so the result plus `…` is ≤ max columns; `max ≤ 0` → `''`. Tests in
  `width.test.ts`.
- `error-art.ts`, pure, rows of `Run` (`Row` from `home-art.ts`), following
  `done-art.ts`/`save-as-art.ts` conventions (rows start at the block's left
  edge; the component adds the margin). Reuse `wrapWords` from `done-art.ts`.
  - `errorPanel({ palette, title, detail, hint, width, plain? }): Row[]` —
    row 0: the tab ` failed ` (8 cells: fail bold on failTint), nothing after
    it; then panel rows each exactly `width` wide on failTint: blank; ` ` +
    title (fg bold); detail lines (` ` + fg); hint lines if any (` ` + dim);
    blank. Text wrapped to `width - 2`.
  - `errorLine({ palette, title, reason, width, plain? }): Row` — one row
    exactly `width` wide on failTint: ` ` + title (fail bold) + `   ` +
    reason (fg), the reason cut with `endEllipsis` to fit; the title never cut.
  - Plain/no-fill forms per Global constraints.
- `ErrorPanel.tsx` / `ErrorLine.tsx`: thin Ink components rendering those
  rows (find the existing component that renders `Row[]` for Done/Save as and
  reuse it). Props: `ErrorPanel { error: ForgeError; width }` (takes title,
  detail, `shellHint ?? hint`); `ErrorLine { title; reason; width }`. Palette
  from `useTheme()`; `plain` from the same NO_COLOR check the other art
  components use.
- Fixture: `scripts/errors-mockup-fixture.mjs`, on the `mockup-cells.mjs`
  pattern (see `scripts/done-mockup-fixture.mjs`). Inject before the line
  `fig('errors-grid', { id: ER5.id` the export
  `globalThis.__errors = { write: e5(ER.write).rows, small: e5(ER.small).rows, lines: K1.map((k) => line1Screen(ER1[k], 'b').rows) }`
  and write the frames' cells to `tests/shell/fixtures/errors-mockup.json`.
  In the E5 frames the tab is row 0 and the panel follows; in the E5·b
  frames the tinted row is the one whose background is `#2e2020`.
- `error-art.test.ts`: cell for cell against the fixture at width 76 (E5 for
  `write` and `small`, E5·b for the three lines, texts as the mockup's `ER`
  and `ER1`); wrapping at a narrow width; the ellipsis; the plain forms; the
  LIGHT and NEUTRAL tokens.

## Task 3: wire it in

Files: `src/shell/blocks.tsx`, `src/shell/App.tsx`,
`src/shell/components/Home.tsx`, and App-level tests in the files that own
those flows (`tests/shell/blocks.test.tsx` or `blocks-design.test.tsx` for the
block, `tests/shell/home-app.test.tsx` for home, the existing compress size
test file for the size error).

- `blocks.tsx`: the `error` block renders `<ErrorPanel error={e} width=…/>`
  at the block width (as the Done block computes it) instead of the bordered
  Box. Remove the now-dead border code and its comment; keep the comment's
  reason (a framed object you stop at) in one line on the new code.
- `App.tsx`:
  - `homeError: ForgeError | undefined` state. In `submitPath`, the single-
    path failure `catch` (the one calling `showError(e)` then
    `setStep('idle')`) sets `homeError` (wrapping a non-ForgeError with
    `unexpectedError`) instead of `showError`. Cleared when the home field's
    text changes, on any successful submit, and when a mode or command is
    chosen. Folder-with-nothing-readable and multi-path routes unchanged.
  - Pass `Home` a `note` of `<ErrorLine title={homeError.title}
    reason={homeError.short ?? homeError.detail} width=…/>` while set.
  - The `sizeError` `<Text>` becomes `<ErrorLine title="Not a size"
    reason={sizeError} width=…/>` with a blank row above. Touch nothing else in
    the size step (another branch is restyling it).
- `Home.tsx`: optional `note?: ReactNode` rendered under the field with one
  blank row above, taking its two rows from the `list` budget; when `note` is
  set the list is not drawn.
- Tests: a missing typed path shows the E5·b row under home's field and no
  error block in the scrollback; typing clears it; a damaged dropped file
  shows its row; ↵ on an unreadable size shows the "Not a size" row; a failed
  run renders the panel (the `failed` tab) in the scrollback; a multi-path
  drop with one failure still shows "⚠ 1 skipped". Update existing tests that
  asserted the old red card or the gold size line — change the assertion in
  place, don't add a parallel test.
