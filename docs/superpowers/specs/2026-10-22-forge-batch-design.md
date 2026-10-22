# Several files at once in the shell

2026-10-22. Mockup: `mockups/batch-2026-10.html` (round 1).

## Why

The CLI has always taken several files. The shell only converted a folder,
by watching it. Several loose files were refused in every mode, compress
included. The user asked for compress to take several files and folders,
"ideally the same as convert mode", with the size reduction and the
percentage added.

## Decided (user)

- Compress's Done for several files is convert's folder screen: the compact
  totals bar, then a row per file. Each row reads `was → now −65%`, where
  convert's reads `PNG → WebP`.
- A folder in compress is compressed, then watched, exactly as convert
  watches one.

## Built

- **One planner** (`src/core/batch.ts`). `planBatch` and `runBatch` take a
  `Recipe`: each kind's convert answer, or a compress at a quality or to a
  target size. `batchRows` gives every file's fate, in order: done, failed,
  or left alone and why. `forge watch` and the folder flow go through it.
- **One flow** (`WatchFlow`). It takes a folder, or several files grouped by
  kind (`scanOfFiles`), in convert or in compress.
  - Compress asks Method, then Quality or Target size, once for every file.
  - Only a folder is watched. For loose files the list is the Done, and
    ↵ is "go home".
- **Every file is listed at the end**, the files done at the start of a watch
  included. Before, only files that arrived while watching appeared, so the
  first pass's failures were never shown.

## Calls made (mine)

- A target size is for each file. A file already under it is left alone
  ("already under that size"), not re-encoded. A file that can't reach it is
  left alone with its floor ("can't get below 612 KB").
- Files compress can't touch are left alone with a reason:
  - a lossless image: "TIFF is lossless";
  - a text-only PDF: "no images to shrink".
- Video and sound go one at a time ("one at a time"). Each has its own
  length and floor.
- One quality slider for every file. It uses a PNG's or GIF's three points
  only when every file is a PNG or GIF.
- Names already on disk, for loose files:
  - asked once for all of them (keep both, replace, cancel), as /pdf asks;
  - a folder leaves them alone, as watch always has.
- The steps' card for loose files is the folder card's shape, edged with
  `PNG ×12` or `MIXED ×12`. The card and the Each kind band now sit on the
  margin; before, they were two columns outside it.
- By quality's hint drops "see the result": a batch has no one result to show.

## Not yet

- **Edit with several images.** Home still says "→ editing several files at
  once is coming".
  - Planned: every tool applies to each image except Crop to shape, which
    stays one at a time.
  - Trim and Boost leave alone the images they can't change.
- **The PDF menu's Compress and Convert rows.** They aren't on dev yet, and
  should take several PDFs once they land.
- **Esc to stop a batch** after the file in progress (mockup F6).
