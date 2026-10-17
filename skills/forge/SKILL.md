---
name: forge
description: Convert, compress and edit local files on macOS with the Forge CLI (`forge`) — images (HEIC, JPEG, PNG, WebP, AVIF, GIF, TIFF), PDFs and Word documents. Use when the user wants a file in another format, smaller or under a size, or cropped to a shape, or a PDF merged, split, trimmed or rotated, or an image's colour palette or a tonal scale from a colour, and `forge` is installed (`npm i -g forge-terminal`).
---

# Forge

Forge converts files on this Mac. Nothing is uploaded.

## Always

1. **Probe first.** `forge probe <file…> --json`. Each entry in `probes` has
   `format` (read from the file's content, not its name), `targets` (every
   format the file can become) and `actions` (what else applies: `compress`,
   `split`, `extract`, `delete`, `rotate`; `convert` is always there).
   `merge` is never listed by probe: to merge, pass `--merge` with two or
   more PDFs. Use these lists; do not
   guess. `compress` appears when quality or size can be reduced: lossy
   images, and PDFs that contain compressible images (a PNG has only
   `convert`). Run it as `--quality N` or `--max-size S` without `--to`. A
   compress run reports `op: "convert"` in `--json` results.
2. **Pass `--json`.** stdout is then exactly one JSON document, on one line.
   Read `ok`, `results[].outputs` (the absolute path of every file written)
   and `failures[]` (`path`, `code`, `title`, `detail`, `hint`).
3. **Read the exit code** (below).
4. **Never pass `--force` unless the user asked to replace files.** Without it
   Forge refuses with `output-exists` and writes nothing. Tell the user, or
   choose another `-o`.

## Exit codes

| Code | Meaning | Do |
| --- | --- | --- |
| 0 | every input succeeded | report `results[].outputs` |
| 1 | understood, but an input failed or was refused | read `failures`, act on `code` and `hint` |
| 2 | the command itself was invalid | fix the flags (`failures[0].code` is `invalid-arguments`) |

## Commands

```bash
forge probe photo.heic --json
forge photo.heic --to jpeg --json                          # convert
forge ~/Pictures/trip --to webp -o ~/Desktop/web/ --json   # a folder
forge photo.jpg --quality 60 --json                        # compress, same format -> photo-small.jpg
forge photo.jpg --max-size 500kb --json                    # compress to fit
forge scan.pdf --max-size 2mb --json                       # a PDF with images
forge doc.pdf --to png --pages 1-3 --dpi 150 --json        # PDF pages -> images
forge report.docx --to pdf --json
forge a.pdf b.pdf --merge --json
forge doc.pdf --split every-page --json                    # or every=N, at=3,7
forge doc.pdf --extract 3-7,12 --json                      # --separate: one file per page
forge doc.pdf --delete 2 --json
forge doc.pdf --rotate 90 --json
forge --formats --json
forge palette photo.jpg --json                             # an image's main colours
forge palette photo.jpg --inside F96363 --json             # one colour's shades
forge scale 6579FD --json                                  # 50–950, the colour at 500
```

For a colour, pass the hex without `#`, or quote it: an unquoted `#` starts
a shell comment, and `forge scale` then exits 2 with "No colour given".
`rgb()`, `hsl()`, `oklch()` and colour names (`crimson`, `cherry red`) work
too, quoted.

`forge update` installs a newer Forge globally with npm. Run it only when the
user asks for an update.

`forge watch <folder> --to <format>` converts the folder, then every file
added to it, until it is interrupted (SIGINT). It never exits by itself, so
start it only when the user asks for a folder to be watched, in the
background. With `--json` it prints one JSON document per line:
`converted-existing`, `watching`, then `converted`, `failed` or `left-alone`
per file, and `stopped` with the totals.

Outputs go beside the source unless `-o` names a folder (or, for one file, a
filename). Page operations always write beside the source, take no `-o`, and
never edit the original.

## Resize and trim edges

Built in, images only, format kept unless `--to` is given:

```bash
forge photo.jpg --resize 50% --json    # photo-<W>x<H>.jpg (percent 1-200)
forge photo.jpg --width 1200 --json    # height follows; --height 900 likewise
forge photo.jpg --trim --json          # photo-trimmed.jpg
forge photo.jpg --trim --width 1200 --to webp --json   # photo-trimmed-1200w.webp
```

One of `--resize` / `--width` / `--height` at a time; not with `--max-size`,
`--sharpen`, `--boost`, `--remove-bg` or page operations (`invalid-arguments`).
Runtime refusals: `resize-too-large` (over 16,384 px a side or 100 MP),
`nothing-to-trim`, `animated-trim`. MCP: `forge_convert` with `trim: true`
and/or `resize: { percent | width | height }`; `to` is then optional.

## Crop to shape

Built in, images only, format kept unless `--to` is given. The largest box of
the shape, placed to keep the subject:

```bash
forge photo.jpg --crop 1:1 --json                 # photo-cropped-1x1.jpg
forge photo.jpg --crop 4:5 --width 1080 --to webp --json   # photo-cropped-4x5-1080x1350.webp
```

Any `W:H` of whole numbers 1-100. A resize flag applies to the cropped image.
Not with `--trim`, `--max-size`, `--sharpen`, `--boost`, `--remove-bg` or page
operations (`invalid-arguments`). Runtime refusals: `nothing-to-crop` (already
that shape; with a resize it is the warning `nothing-cropped` instead),
`animated-crop`. MCP: `forge_convert` with `crop: "1:1"`; `to` is then optional.

## Optional extensions: boost and remove background

Two image operations are not built in. They are small downloads, installed once,
and need macOS 14 or later:

```bash
forge extensions                       # what is installed
forge extensions add boost             # about 15 MB; sharpen, 2x / 3x / 4x; Apple Silicon only for now
forge extensions add remove-background # about 32 KB
forge photo.jpg --sharpen --json       # photo-sharp.png (same size, sharper)
forge photo.jpg --boost --json         # photo-2x.png   (--boost 3 -> photo-3x.png, --boost 4 -> photo-4x.png)
forge photo.jpg --remove-bg --json     # photo-cutout.png
```

`forge probe` lists `boost` / `remove-background` under `actions` only when that
extension is installed, so trust the probe. `--json` results carry
`op: "boost"` or `op: "remove-background"`. `--to` picks another output format;
a cutout needs one that carries transparency (png, webp, avif, tiff) and
anything else is refused with `invalid-arguments`. If the extension is missing
the failure code is `extension-missing`, its hint is the install command, and
the exit code is 1: ask the user before installing, since it downloads.
Other codes: `no-subject` (no foreground found), `boost-too-large`
(the result would pass 16,384 px a side or 100 MP; the hint names the largest
factor that fits) and `extension-outdated` (`--boost 3` needs boost 1.1.0 or
later; the hint is the same `forge extensions add boost`, which updates it).
While no released boost makes 3x, `--boost 3` is refused with
`invalid-arguments` and a hint naming the factors that work; don't update then.

## Encrypted PDFs

Forge never prompts when there is no terminal. Send the password on stdin,
one line:

```bash
printf '%s\n' "$PASSWORD" | forge locked.pdf --to png --password-stdin --json
```

Never put a password in an argument; there is no flag for it. Only rendering
to images works on an encrypted PDF; page operations and compression refuse
it (`encrypted-source`), so probe lists only the image `targets` and the one
action `convert` for it. Without `--password-stdin` the run fails at once with
exit 1 and a hint; a wrong password has its own hint.

## Failure codes worth knowing

- `output-exists`: ask before re-running with `--force`.
- `unsupported-target`: pick from the probe's `targets`.
- `target-unreachable`: the smallest possible is still too big. Try a larger size or another format.
- `unsupported-compress`: lossless (PNG) or a PDF with no images. Convert instead.
- `unsupported-operation`: that page operation does not fit those files (PDFs only; merge needs two or more).
- `encrypted-source`: a password is needed, or the one given was wrong.
- `extension-missing`: run the hint's `forge extensions add <id>` (with the user's agreement), then retry.
- `extension-outdated`: the same command updates it (with the user's agreement, it downloads), then retry.
- `file-not-found`: check the path; probe reports it per file without failing the rest.

## MCP

If a `forge` MCP server is connected (tools `forge_probe`, `forge_formats`,
`forge_convert`, `forge_compress`, `forge_pdf`, `forge_palette`,
`forge_scale`), prefer it. It takes absolute
paths and returns the same JSON as `structuredContent`. It never overwrites
unless you pass `overwrite: true`, and an encrypted PDF takes a `password`
argument. `forge_convert` also takes `sharpen: true`, `boost: 2 | 3 | 4` and `removeBackground: true`
(images only; `to` is then the output format); without the extension they fail
with `extension-missing`. A hint that says `--force` means `overwrite: true` there;
`--password-stdin` means `password`.
