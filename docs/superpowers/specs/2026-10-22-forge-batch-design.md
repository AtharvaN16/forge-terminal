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

## Edit with several images (built, second pass)

- ↵ on home, or `/edit`, opens the picker for every image, as "Edit 12 images".
  - The batch is an `edit` recipe: one tool on every image.
  - Files that aren't images are left alone ("images only").
  - A folder in edit is a batch of its images, and is not watched.
- **The rows.** Every tool runs on each image. The details are the tool's
  alone ("same size"), not one picture's measurements.
  - No row is dimmed for one image's sake; Done says which images a tool left
    as they were:
    - Trim: "no empty edges", "animated";
    - Boost and Sharpen: "too large for 4×".
  - Crop to shape is dimmed "one at a time": where to cut is a choice made
    for each picture.
- **Resize** asks one percent, up to what the largest image can take.
  - There is no `#` exact size: several images each keep their own shape.
  - There is no "becomes W × H" line either: no single size is true of them all.
- **After the tool:** the batch flow from Save as on.
  - esc on Save as goes back to the picker.
  - Done lists every image.

## Stopping and the PDF menu (built, second pass)

- **esc while a batch runs.**
  - The files already started finish and nothing more starts (`runJobs`), and
    the run is `cancelled` with what finished kept.
  - Done lists the rest as "stopped". A stopped folder is not watched.
  - esc during a target-size search stops before anything is written, as it
    does for one file.
- **The PDF menu's Compress and Convert rows** take several PDFs as one batch.
  - Compress is dimmed only when none of them has images to shrink.
  - esc on the batch's first question goes back to the menu.
- **The "isn't supported yet" refusal is gone.** Every way of reaching
  several files now leads to a batch.

