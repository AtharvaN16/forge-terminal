---
name: forge
description: Convert, compress and edit local files on macOS with the Forge CLI (`forge`) — images (HEIC, JPEG, PNG, WebP, AVIF, GIF, TIFF), PDFs and Word documents. Use when the user wants a file in another format, smaller or under a size, or a PDF merged, split, trimmed or rotated, and `forge` is installed (`npm i -g forge-terminal`).
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
```

Outputs go beside the source unless `-o` names a folder (or, for one file, a
filename). Page operations always write beside the source, take no `-o`, and
never edit the original.

## Optional extensions: boost and remove background

Two image operations are not built in. They are small downloads, installed once:

```bash
forge extensions                       # what is installed
forge extensions add boost             # about 50 MB; 2x / 4x resolution
forge extensions add remove-background # about 0.2 MB; needs macOS 14 or later
forge photo.jpg --boost --json         # photo-2x.png   (--boost 4 -> photo-4x.png)
forge photo.jpg --remove-bg --json     # photo-cutout.png
```

`forge probe` lists `boost` / `remove-background` under `actions` only when that
extension is installed, so trust the probe. `--json` results carry
`op: "boost"` or `op: "remove-background"`. `--to` picks another output format;
a cutout needs one that carries transparency (png, webp, avif, tiff) and
anything else is refused with `invalid-arguments`. If the extension is missing
the failure code is `extension-missing`, its hint is the install command, and
the exit code is 1: ask the user before installing, since it downloads.
Other codes: `no-subject` (no foreground found) and `boost-too-large`
(the result would pass 16,384 px a side or 100 MP; the hint names the largest
factor that fits).

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
- `file-not-found`: check the path; probe reports it per file without failing the rest.

## MCP

If a `forge` MCP server is connected (tools `forge_probe`, `forge_formats`,
`forge_convert`, `forge_compress`, `forge_pdf`), prefer it. It takes absolute
paths and returns the same JSON as `structuredContent`. It never overwrites
unless you pass `overwrite: true`, and an encrypted PDF takes a `password`
argument. `forge_convert` also takes `boost: 2 | 4` and `removeBackground: true`
(images only; `to` is then the output format); without the extension they fail
with `extension-missing`. A hint that says `--force` means `overwrite: true` there;
`--password-stdin` means `password`.
