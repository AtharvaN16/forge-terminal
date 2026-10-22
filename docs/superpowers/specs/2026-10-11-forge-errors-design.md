# Errors: E5 and E5·b

Decided on `mockups/flow-parts-2-2026-10.html`, tab **9 · Errors ✓ E5 · E5·b**
(source of the page script: `errors.js`, figures `E5` and `E5·b`).

## Why

Today every failure in the shell is the same object: a red rounded frame,
52 columns wide, `✕ title` in red, the detail in white, the hint dim, pushed
into the scrollback with home redrawn under it (`blocks.tsx`, the `error`
block). A path you mistyped gets the same card as a run that could not write
its file. Field checks, meanwhile, are a third look: a gold `⚠` line under
the field.

The decided design keeps errors quiet and gives them two sizes of one object.
The user wants little colour: red text appears only on a dark red tint, and
the rest of the words stay white and grey, as K3·a (Done) and the Save as
default pill (P1) do.

## What

### Two sizes, one tint

**E5: a run, or a refusal, that ends in the scrollback.** It replaces the red
card wherever the card is drawn today (every `showError`, `/pdf`'s blocked
refusals).

```
 failed                                   ← tab: red bold on the tint, 8 cells
┌──────────────────────────────────────┐  ← the panel: the tint, block width
│                                      │    blank
│ Cannot write there                   │    title, fg bold
│ ~/Shared/Team/test.jpg could not be  │    detail, fg
│ Check that the path is valid and …   │    the way forward, dim (shellHint ?? hint)
│                                      │    blank
└──────────────────────────────────────┘
```

(The box lines above only mark the panel's extent; the panel is a fill, with
no border.) The tab sits directly on the panel's top edge, as K3·a's tabs
do. Every line is word-wrapped to the block width less two (one cell of
padding each side). Home comes back under it, as it does today.

**E5·b: a refusal of what you just typed or dropped**, fixed right there. One
row, under the field it concerns, with a blank row above it:

```
 Not a size   fifty is not a size. Try 500kb or 2mb.
```

The row is the tint, the block's width. The title is `fail` bold, then three
spaces, then the short reason in `fg`. No tab. A reason that does not fit is
cut at the end with `…` (a new `endEllipsis` beside `middleEllipsis` in
`width.ts`, measured with `string-width`); the title is never cut. It clears as soon as you type or drop again.

### Which errors get which

| Where it comes from | Today | Now |
|---|---|---|
| A single typed or dropped path that cannot be read (not found, not a file, permission, invalid path, symlink loop, too long, unreadable, unsupported type, damaged, password-protected, HEIC unavailable) | red card, scrollback | **E5·b under home's field**, not in the scrollback |
| Compress size field, ↵ on a value it cannot read (`sizeError`) | gold `⚠` line | **E5·b**, title "Not a size" |
| A run that failed, a refusal after a mode is chosen, `/pdf` blocked refusals, anything else through `showError` | red card, scrollback | **E5**, scrollback |
| A folder with nothing readable in it (each failure through `showError`) | red cards | **E5** panels (unchanged routing) |
| Several paths at once with some failing (`StagedFiles`, "⚠ 1 skipped") | gold line | unchanged |
| Warnings and notes (`⚠` batch refusals, config warning, conversion warnings) | gold `⚠` | unchanged: a warning is not an error |
| The live hint under the size field while typing (`⚠ not a size — try 500kb or 2mb`, dim) | dim hint | unchanged: a hint, not a refusal |
| `/pdf`'s `pagesError` and `fieldError` lines | gold `⚠` | **E5·b**, in a follow-up after `feat/consistency` lands (that branch owns `flows/pdf.tsx`) |

"Cannot get that small" is not an error in the shell: it is the
`size-unreachable` question (Use it anyway / Try a different size / …). It is
untouched here; `feat/consistency` is restyling it.

### The short reason

`ForgeError` gains an optional `short?: string`: the detail in one line, for
E5·b. Optional, so every existing constructor and every other branch's new
ones (e.g. `feat/extensions`) keep compiling. E5·b shows `short ?? detail`.

Filled in for the errors a typed or dropped path can produce:

| code | short |
|---|---|
| `file-not-found` | `<name> could not be found.` |
| `not-a-file` | `<name> is not a file.` |
| `permission-denied` | `<name> could not be read.` |
| `not-a-directory` | `part of <name>'s path is not a folder.` |
| `symlink-loop` | `<name>'s path loops back on itself.` |
| `path-too-long` | `<name>'s path is too long.` |
| `unreadable-path` | `<name> could not be checked.` |
| `unsupported-source` | `<name> is <detected>, which Forge cannot read.` |
| `corrupt-source` (both) | `<name> could not be read.` |
| `encrypted-source` | `<name> is password-protected.` |
| `heic-decoder-unavailable` | `HEIC needs sips, which could not be run.` |
| `raw-decoder-unavailable` (Mac) | `RAW needs sips, which could not be run.` |
| `raw-decoder-unavailable` (Windows) | `RAW photos open on a Mac only.` |
| `raw-decoder-unavailable` (camera) | `macOS cannot read RAW photos from this camera.` |

`<name>` is the basename, as in the details today.

### Theme

One new token, `failTint`, placed next to `fail` in `Palette` (not next to
`larger`/`grownHatch`, which the Done work just added):

- `DARK`: `#2e2020`.
- `LIGHT`: a pale red on which `fail` (`#b3261e`) and `fg` both clear AA.
  Chosen and measured at build time; the spec does not fix the value.
- `NEUTRAL` (the first-run palette, ANSI names only): `''`, no fill.

Without a fill (`NEUTRAL`, or `NO_COLOR`): E5's tab is drawn as `✕ failed`
in `fail` bold; E5·b's row starts with `✕ ` before the title. The shape still
says error when colour cannot.

## How

### Units

- **`src/shell/error-art.ts`**, pure, no React, following `save-as-art.ts`
  and `done-art.ts`: rows of `Run`s (`home-art.ts`'s `Row`).
  - `errorPanel({ palette, error, width, plain }) → Row[]`: the tab row, then
    the panel rows.
  - `errorLine({ palette, title, reason, width, plain }) → Row`: one row.
  - Reuses `done-art.ts`'s `wrapWords` for wrapping.
- **`src/shell/components/ErrorPanel.tsx`** and **`ErrorLine.tsx`**: render
  those rows with Ink, nothing else.
- **`blocks.tsx`**: the `error` block renders `ErrorPanel` at the block width
  instead of the bordered `Box`.
- **`App.tsx`**:
  - a `homeError: ForgeError | undefined` state. `submitPath`'s single-path
    failure (the `catch` that now calls `showError(e)`) sets it instead of
    pushing a block. Cleared on any change to the home field's text, on a
    successful submit, and when a mode or command is chosen.
  - `Home` gets an optional `note` slot under the field, given the
    `ErrorLine` (with its blank row) while `homeError` is set. It takes rows
    from the `list` budget the way suggestions do; suggestions and the note
    never show at once (typing clears the note).
  - the `sizeError` `<Text>` becomes `ErrorLine` with title "Not a size" and
    the existing message as the reason. `feat/consistency` restyles the
    rest of the size step and has agreed to leave that line to this work.
- **`core/errors.ts`**: `short` on `ForgeErrorInit` and `ForgeError`, and the
  values above. Still data only (invariant 1).

### Tests (test-first)

- **`tests/shell/error-art.test.ts`**: held cell for cell against frames
  captured from the mockup by a new `scripts/errors-mockup-fixture.mjs`
  (the `mockup-cells.mjs` pattern) into
  `tests/shell/fixtures/errors-mockup.json`: E5 for "Cannot write there",
  E5·b for the three one-line cases. Plus: wrapping at narrow widths, the
  ellipsis, the `plain` forms, `LIGHT` and `NEUTRAL` tokens.
- **App-level**: a missing typed path shows `ErrorLine` under home's field
  and nothing in the scrollback; typing clears it; a damaged drop does the
  same; an unreadable size shows "Not a size"; a run failure renders the
  panel in the scrollback; a three-path drop with a failure still reads
  "⚠ 1 skipped".
- **core**: each listed constructor sets `short`; constructors without one
  leave it `undefined`.

### Not in this work

- `/pdf`'s field errors (follow-up, after `feat/consistency`).
- Any change to what fails, or to error wording other than the new `short`.
- Warnings.
- The CLI's `renderError`: the shell only.

## Coordination

Peer branches touch the same files: `feat/consistency` (App.tsx render
blocks, `flows/pdf.tsx`, `Select`, `HintBar`, `SaveAs`), `feat/colour-shell`
(`theme.ts` mode tokens, App.tsx colour flow), `feat/extensions`
(`core/errors.ts` new codes). Each confirmed no overlap with the error block,
`error-art.ts` or the `sizeError` line; small `theme.ts`/`App.tsx`
conflicts are expected and the later branch rebases.
