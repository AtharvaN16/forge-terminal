# The drop zone, once a file lands

Decided 2026-10-11 in the mockups (`mockups/drop-zone-2026-10.html`, round
three): **one file is a card, several are a list**, and a file that could not
be read is **one red line under the field (R1)**.

## The problem

Dropping a file on the home screen pastes its path into the field. The drop
zone only dims, as it does for any typing; nothing is read until ↵, and by
then home is gone. Nothing tells the user the drop was understood.

A terminal cannot see a drag, and cannot turn one away: the first and only
thing the app learns is the paths, pasted as text in one chunk. So the zone
answers at that moment, by reading the files as soon as the paste arrives.

## Scope

In: reading a drop on paste; showing what is staged on home (card, list,
left-out line); ↵ and esc on a staged home.

Out, deliberately:

- **Batch conversion.** The user has decided it goes into the app, but its
  screens (Format, Quality, Name, Working and Done for several files) are not
  designed yet. Until they are, several staged files show the list and ↵ says
  batch is coming (below). Several PDFs keep their merge path through `/pdf`.
- The landing motion of the mockup's card (its edge fading in) and the card
  clearing before the list. Only the new rows' band is built (below).
- Removing one file from a staged list.

## Behaviour

### What counts as a drop

A **paste into an empty home field**: one input event of more than one
character, whether or not it ends in a line break. Typing never produces one.
A ⌘V of a path is the same thing and is treated the same way.

The paste is resolved exactly as `submitPath` resolves a path today — whole
and unescaped first, then split with `splitPastedPaths`, a folder through
`resolveDirectory` — moved into one function both use.

- If **nothing in it exists** (every path is "File not found" or "Invalid
  path"), it is not a drop: the text stays in the field as typed, so pasting
  half a path to finish by hand still works. No error.
- Otherwise the field clears and every file that was read is added to the
  stage (`addToStage`: appended, exact repeats dropped). Files that exist but
  could not be read are added to the stage's failures.

A paste into a field that already has text is an edit, never a drop.

### Typing a path

Unchanged with nothing staged: a typed path and ↵ stages the file and goes on
at once, as today. With something already staged, a typed path and ↵ adds to
the stage instead, the same as a drop.

### Home holds the stage

Home shows while the step is idle, staged files or not (`onHome` stops
depending on the stage). The header bar and the `StagedFiles` card at idle are
no longer used there. Only the drop panel changes; band, tabs, field and key
row are the decided ones.

**One file — the card.** The decided file card (`FileCard`'s anatomy: rounded
frame in `border`, the format tag in the top edge in the mode's colour, the
name in bold `fg`, the facts in `dim`), 52 columns wide or as wide as fits,
centred on the drop surface. The dots stay, at 0.42 of their resting
strength, and run up to the frame on every side.

**Several files — the list.** The dots clear and the panel lists the stage,
the way "/ commands" takes the panel:

- A headline: the count in bold `fg` — "3 images", "3 PDFs", "8 files" when
  they mix — then the total size in `border`, three spaces after it.
- A blank row, then one row per file: the name in `dim`, middle-ellipsised to
  36 columns, padded to 40, then its size in `border`. No format tag.
- At most three file rows; past that, "+N more" in `border` on a row of its
  own.
- Text starts six columns in, under the field's text.
- The block is centred in the panel's height. A short panel drops the blank
  row first, then file rows, so the headline and "+N more" always show.
- Rows added by the latest drop wear the picker's band and strip
  (`panelBand`, `▌` in the mode's colour, the name in `fg`) for 1.2 s, then
  settle. Not drawn when motion is off.

With no room for a drop surface at all (a short terminal), the headline alone
sits on the row under the field.

**The field** says `drop more, or type a path` while anything is staged.

**Left out (R1).** When the stage has failures, one row under the field, a
blank row between: `✕` and the count ("1 file left out", "2 files left out")
in bold `fail`, then three spaces and, in `dim`, the first failed file's name
and its error's title in lower case — `archive.zip · unsupported file type` —
with ", +N more" when there are several. It shows whether or not anything was
staged, and clears with the stage.

**Several files, until batch exists.** In place of the left-out row when there
are no failures, one `dim` row: `→ converting several files at once is coming`
and, when every staged file is a PDF, ` · /pdf merges them`.

### Keys on a staged home

| State | Main | Footnote |
| --- | --- | --- |
| One file | `↵` + the mode's verb (convert, compress, pdf) | esc clear · 1–3 mode · ctrl-c quit |
| Several files | `esc` clear | 1–3 mode · ctrl-c quit |
| Several PDFs in pdf mode | `↵` pdf | esc clear · 1–3 mode · ctrl-c quit |

- **↵** on an empty field with one file staged does what a single drop does
  today after it is staged: compress mode goes to compress (or refuses a
  lossless source), pdf mode opens the hub (or refuses a non-PDF), and convert
  goes to the target picker.
- **↵** with several staged: in pdf mode with every file a PDF, the hub, as
  `/pdf` does today; otherwise nothing.
- **esc** on an empty field with a stage clears it and its failures; home goes
  back to rest.
- **1–3** switch mode with the stage kept, as on an empty home.
- `/` still opens the commands in the panel; the stage comes back when the
  field is emptied.

### Coming back to home

Escaping the target picker for a document (`backToPromptKeepingStage`) now
lands on home with the card. An image still clears the stage there, as today.

## What goes away

- At drop time, the refusal of a batch nothing can act on
  (`refuseUnstageable`): a stage of several images, or images with a PDF, is
  now valid and shown. `refuseBatch` stays for `/convert` and `/compress` run
  with several staged.
- The idle `StagedFiles` card and the "→ /pdf for page operations" line under
  the old idle prompt. The note row above replaces both on home.

## Where the code goes

- `home-art.ts`: `stagedCardRows`, `stagedListRows` (panel rows, like
  `surfaceRows`/`commandRows`), and `leftOutRow`/`noteRow` for under the field.
  Pure: they take the stage's display data, never a `SourceInfo` render.
- `Home.tsx`: a `staged` prop — the card/list data, the fresh rows, the
  failures — choosing the panel and the row under the field.
- `App.tsx`: the paste detection in `homeKey`; the resolution shared by
  `submitPath` and the drop; ↵/esc on a staged home; `onHome`.

`core/` and `engines/` do not change.

## Testing

- Art: each builder's rows at 80 columns and at narrow widths and short
  panels — counts, "+N more", the band on fresh rows only, nothing wider than
  the width.
- App, through `ink-testing-library`: a pasted path stages and stays on home;
  a second paste adds; a paste of a non-existent path stays as text; a pasted
  path ending in a line break is still a drop; ↵ with one file reaches the
  target picker; ↵ with several does nothing; esc clears; an unreadable file
  shows the red line.
- Cells: the card, the list and the R1 frames match the frozen mockup cell for
  cell, through a fixture made by `scripts/drop-mockup-fixture.mjs` from
  `mockups/drop-zone-2026-10.html`, the same way home is checked against
  `home-mockup.json`.
