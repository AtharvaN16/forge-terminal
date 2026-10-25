# Forge

**Convert** — a terminal-native file converter for macOS, Windows and Linux. Command: `forge`.

## What it is

Forge takes a file and turns it into another format without leaving the
terminal. No web upload, no GUI app to open, no ImageMagick incantations to
remember — point it at a file or a folder, say what you want it to become,
and it writes the result next to the original (or wherever you tell it to).

Version 0.1 converts images: JPEG, PNG, WebP, AVIF, GIF, TIFF, and reads
HEIC. It also converts between PDF and Word documents (DOCX both ways, DOC
one way in) — install [LibreOffice](https://www.libreoffice.org/) for
full-fidelity results; without it, Forge still converts, using a plain-text
fallback and a note in the result saying so. It runs correctly, not just fast — auto-orienting phone photos,
flattening transparency instead of turning it black, and stripping GPS data
from EXIF by default so a converted photo doesn't quietly leak where it was
taken.

The command is `forge` rather than `convert` on purpose: `convert` is
ImageMagick's legacy binary name, and Homebrew still installs it — a command
called `convert` would silently shadow or collide with that. The product is
still called Convert; the binary just has a name of its own.

Forge is both a flag-driven CLI, built to be scriptable and usable for daily
conversions, and an interactive shell — run `forge` with no arguments in a
real terminal and it walks you through the same conversion by drag-and-drop
and arrow keys instead of flags. See [Interactive shell](#interactive-shell).

## Installation

**Requires macOS, Windows 10/11 or Linux, and Node 20 or newer** (developed and
tested on Node 24). Check with `node --version`; if you don't have it,
`brew install node` on a Mac, the LTS installer from nodejs.org on Windows, or
your distro's package (or nodejs.org's build) on Linux.
On Windows, use Windows Terminal for the full experience.

Most features work on all three. The exceptions: transcript summaries and
notes need Apple Intelligence, so they are Mac-only; Boost has no Linux ARM
build (there it would run on the processor alone). Where a feature needs a
tool the OS does not have, it is a small optional extension
(`forge extensions`) or a common package, named in the error that asks for it.

```bash
npm install -g forge-terminal
```

That puts `forge` on your `PATH`, so it works from any directory. Verify:

```bash
forge --version
# 0.5.0

forge photo.jpg --to webp
```

Nothing else needs Homebrew; image conversion is entirely self-contained.

### From source

```bash
git clone https://github.com/AtharvaN16/forge-terminal.git
cd forge-terminal
npm install
npm run build
chmod +x dist/index.js   # tsc does not preserve the executable bit
npm link
```

`npm link` puts your working copy on your `PATH` instead of the published
package. If you have both, whichever was installed last wins —
`npm uninstall -g forge-terminal` removes the published one.

### A name to watch out for

If you write Solidity, you may already have a `forge` on your `PATH`:
Foundry ships a binary by that name, and whichever was installed last wins.
Check before installing:

```bash
which -a forge
```

If more than one path comes back, they're shadowing each other. You can
rename Forge's command when installing from source, by editing the `bin`
field in `package.json` before running `npm link`:

```json
"bin": { "convert-forge": "./dist/index.js" }
```

(The command isn't called `convert` for the same reason: ImageMagick's
legacy binary already claims that name and Homebrew still installs it.)

### Updating and removing

```bash
npm update -g forge-terminal      # update
forge uninstall                   # remove
```

`forge uninstall` takes Forge's [right-click menu](#right-click-menu) out
first, then runs `npm uninstall -g forge-terminal` itself. npm runs nothing
when a package is removed, so `npm uninstall -g` on its own leaves the menu
items behind; the first click on one of those finds Forge gone, removes them
all, and says so.

From source, `git pull && npm install && npm run build` updates and
`npm unlink -g forge-terminal` removes.

## Right-click menu

On a Mac, on Windows and on Linux, Forge adds itself to the right-click menu
the first time you run `forge`, and says so once:

| Right-click | Items |
| --- | --- |
| an image | Open Forge · Convert in Forge · Compress in Forge · Sharpen in Forge |
| a folder | Open Forge · Convert in Forge · Compress in Forge |
| a PDF | Open in Forge |

- **Open Forge** opens Forge in a terminal window, nothing staged.
- **Convert in Forge** and **Compress in Forge** open it with the file staged
  and that mode's first question already asked.
- **Open in Forge** opens a PDF staged in PDF mode.
- **Sharpen in Forge** runs with no window, says how it went in a
  notification, and selects the new file. It is there once the Boost
  extension is installed (`forge extensions add boost`).

Forge opens in the terminal you last ran it in: Terminal, iTerm or Ghostty on
a Mac; Windows Terminal, or a console window, on Windows; on Linux the one you
last ran it in if it is still installed, else your desktop's default
(xdg-terminal-exec, x-terminal-emulator, then GNOME Terminal, Konsole and the
other common ones). Each item's icon is
Forge's logo with the slashes in its mode's colour.

On a Mac the items are under **Quick Actions**, and Finder's own
**Customize…** at the bottom of that menu hides any you do not want. On
Windows 11 they are under **Show more options** (or shift + right-click): an
image's and a folder's in a **Forge** submenu, a PDF's one item on its own. They are set up only for a Forge installed with
`npm install -g`; from a source checkout, `forge menu install` sets them up
by hand and `forge menu remove` takes them out.

On Linux, Forge writes entries for the common file managers, no dependencies
needed: GNOME Files (Nautilus) shows them under **Scripts › Forge**, and
Nemo, Dolphin and Thunar in a **Forge** submenu. Nautilus cannot limit a script
to some kinds of file, so there every item shows for every file, and Forge
says so when a file is not one it takes. Thunar's entries are merged into
`~/.config/Thunar/uca.xml` beside your own and removed without touching them.
Sharpen's notification uses `notify-send` (or D-Bus); without either, it is
silent.

## Transcribe on Windows, Linux and older Macs

On Apple-silicon Macs with macOS 26 or later, `forge transcribe` uses Apple's
speech recogniser. Everywhere else (Windows, Linux, Intel Macs, and Macs before
macOS 26) it uses [whisper.cpp](https://github.com/ggml-org/whisper.cpp)
instead. Everything stays on the machine. It needs ffmpeg and the whisper
extension (whisper.cpp's `whisper-cli` and its speech model, about 60 MB on
every OS):

```bash
forge extensions add whisper     # every OS (Linux x64 needs AVX2)
winget install ffmpeg            # Windows
sudo apt install ffmpeg          # Linux, or your distro's ffmpeg
brew install ffmpeg              # Mac

forge transcribe talk.mp4
forge transcribe "https://www.youtube.com/watch?v=..." --language en
```

- The speech model is ggml-base, multilingual, compressed to q5_1 (60 MB),
  inside the extension. With a `whisper-cli` of your own instead, the first
  run downloads the same model, checked against its sha256, into
  `%LOCALAPPDATA%\forge\whisper`, `~/Library/Caches/forge/whisper` or
  `~/.cache/forge/whisper`.
- Transcripts can be Markdown, Word, PDF or text everywhere. Forge writes the
  Word and PDF itself where Apple's helper is not. The PDF is set in Noto Sans
  for Latin, Greek and Cyrillic, and in the fonts your computer already has for
  Chinese, Japanese, Korean, Arabic, Hebrew and Thai (Forge adds none). Writing
  that has to be rearranged to be read, such as Hindi, is drawn as boxes in the
  PDF; Markdown, Word and text have it.
- Reading the text of pictures and PDFs (`forge transcribe shot.png`) uses
  Apple's reader on macOS 26. Everywhere else it uses the read-text extension
  (`forge extensions add read-text`, about 45 MB): PaddleOCR's models for the
  scripts Apple's reader reads (Latin, Chinese, Japanese, Korean, Cyrillic,
  Arabic, Devanagari and Thai). Nothing asks which language a page is in: the
  models say how sure they are, and the surest reads it. It does not read
  vertical text, and leaves out Vietnamese's doubly-marked vowels. A PDF's own
  text, when it has one, corrects words OCR splits at ligatures.
- Without `--language`, whisper detects the language itself.
- Summary and notes need Apple Intelligence, so off it Forge writes the
  transcript. `--to notes` is refused; the default `--to all` gives the
  transcript.
- On Windows the upstream whisper.cpp build needs the Microsoft Visual C++
  Redistributable; if it is missing, Forge says so and links it.
- YouTube links need yt-dlp: `forge extensions add yt-dlp` installs upstream's
  own build on every OS (and updates it when YouTube breaks it). A yt-dlp of
  your own on PATH also works; Forge never updates that one.
- Overrides: `FORGE_WHISPER_CLI`, `FORGE_FFMPEG`, `FORGE_WHISPER_MODEL` (any
  ggml `.bin`, e.g. a larger model for accuracy).

## Configuration

Forge stores preferences at `~/.config/forge/config.json`, or
`$XDG_CONFIG_HOME/forge/config.json` when that is set.

```bash
forge config list                    # show every setting and where it lives
forge config set output ~/Desktop    # default output folder
forge config set theme light         # dark or light
forge config set quality 80          # what the quality slider opens on
forge config set update-check off    # stop the once-a-day update check
forge config path                    # print the file location
```

A corrupt or unreadable config never blocks a conversion. Forge falls back to
defaults, says so once, and carries on — and it validates key by key, so one
bad setting does not cost you the ones that are fine. Keys written by a newer
version of Forge survive a write from an older one.

### Updates

Once a day, in the background, Forge asks the npm registry for the latest
version number of `forge-terminal`. That is the whole request: nothing about
your files or your Mac is sent. When a newer Forge is out, home's band says
`/update is available`, and a one-off command run in a terminal ends with a
short note, at most once a day. Neither ever slows anything down: the check
reads a cached answer, refreshes it after the command has finished, and is
silent when offline. It is never printed with `--json`, into a pipe, or over
MCP.

```bash
forge update                         # install a newer Forge now, if there is one
```

In the shell, `/update` checks on the spot, and ↵ installs the new version and
restarts Forge. If npm needs permission (Node installed for the whole Mac), it
shows the `sudo` command to run yourself instead.

Turn the automatic check off with `forge config set update-check off`, the
switch on `/update`, or `FORGE_NO_UPDATE_CHECK=1`. It is always off on CI.

### Themes

Forge ships two palettes, built separately rather than one dimmed: a colour
that reads on `#0e1016` does not read on paper white. The first time you run
the shell it asks which suits your terminal and remembers the answer.

Change it later with `/theme` in the shell, or:

```bash
forge config set theme light
```

`NO_COLOR` is honoured and turns both palettes off entirely. Every status
still carries a symbol *and* a word — `✓ done`, `✕ failed`, `⚠ warning` — so
nothing depends on colour to be readable.

### Default output folder

Desktop is the factory default. The shell's **Save to** step marks whichever
folder is currently your default and preselects it:

```
  Save to
❯ Desktop         ~/Desktop              default
  Same folder     ~/Pictures
  Downloads       ~/Downloads
  New subfolder   ~/Pictures/converted

  → ~/Desktop/diagram.webp
  ↑↓ choose · ↵ save · d make default · esc back
```

Press `d` on any row to make it the new default. It takes effect immediately
— the tag moves, the banner updates — and it does not advance the flow, since
you are still choosing where *this* conversion goes.

### Naming the output

After choosing where the file goes, Forge asks what to call it, pre-filled
with the current name and showing the resolved path as you type. `ctrl-u`
clears the field, arrow keys move the caret, and `esc` goes back to the
folder list. If a file of that name is already there, Forge asks — keep
both, rename, replace, or cancel.

## Commands

Type `/` in the shell and a list opens:

```
  /convert     change a file's format
  /compress    make a file smaller
  /pdf         page operations on a PDF
  /theme       switch between light and dark
  /help        list these commands
```

Typing narrows it, arrows move, Enter runs. Dropping a file without typing
anything converts, so the common path costs nothing.

A leading slash alone does not open the palette — `/Users/me/photo.png` is a
path, and paths are what this prompt is mostly for. A command has no further
slashes and no spaces.

## Compressing

`/compress` keeps the format and makes the file smaller. It never changes a
file's extension — that is what `/convert` is for.

Two ways to ask:

- **By quality** — pick a level on the slider and see what it produced.
- **To a target size** — say `500kb` and Forge searches for the highest
  quality that fits, reporting each attempt as a real position in a bounded
  sequence. If even the lowest quality overshoots, it writes nothing and tells
  you the smallest size achievable, rather than handing you a file that misses
  the number you asked for.

From the flag CLI:

```bash
forge photo.jpg --quality 60        # compress, same format
forge photo.jpg --max-size 500kb    # compress to fit
forge *.jpg --max-size 1mb          # a whole folder
```

`--quality` without `--to` compresses; with `--to` it converts, as it always
has. `--quality` and `--max-size` are mutually exclusive — they ask the same
question two ways, and Forge will not guess which wins.

A PNG or GIF is compressed by cutting it to fewer colours, which is what
makes it lossy here: `/convert` keeps both lossless. The slider stops at three
points, 30 · 65 · 100, since a palette's size moves in steps; `--quality` takes
any number. Colours stay flat unless you press `d` for dithering, which looks
smoother and costs bytes. A GIF keeps every frame and its timing.

Compressing never writes a bigger file. A file another tool already squeezed,
or a JPEG asked for more quality than it was saved at, would grow, so Forge
says "Cannot compress more" and writes nothing. A TIFF is lossless with no
palette to cut; `/convert` it to WebP instead.

After compressing, if another format would be meaningfully smaller, Forge says
so — and it encodes a candidate to find out rather than guessing:

```
✓ done   photo.jpg → photo-small.jpg
         4.2 MB → 1.1 MB · 73% smaller

⚠ WebP would be 480 KB — 56% smaller again.
  ↵ convert another · c convert to WebP · o open · s show in finder · ctrl-c close app
```

## The clipboard

On a Mac, a copied image can be the file. Copy a screenshot (⌃⇧⌘4) or an
image in a browser, Figma or Preview, and home's field says `⌘V to paste from
clipboard`. ⌘V lands it as a card named **Copied image**; pick a mode as for
any file. There is no Save as: the result goes back on the clipboard, so the
next ⌘V — in Slack, GitHub, a chat — pastes it. On Done, `u` puts the original
back and `s` also saves the result to the default folder.

If your terminal sends nothing on ⌘V with only a picture copied, ctrl-v does
the same.

On Windows and Linux the same works with Ctrl+V, and the hint says so.
Windows uses its own clipboard through PowerShell. Linux needs a desktop
session and `wl-clipboard` (Wayland) or `xclip` (X11), and Forge names the one
to install if neither is there; on Linux a result goes back as image data
only. There is no clipboard over SSH on any system.

Forge never overwrites something you copied while it worked: the result is
saved to the default folder instead, and Done says so. A compression that
would come out larger is never put back.

From the command line:

```bash
forge clip                   # compress the copied image, then ⌘V
forge clip --max-size 1mb    # to fit
forge clip --to webp         # convert it on the clipboard
forge clip --save ~/Desktop  # and keep a file too
forge clip --undo            # put the last original back
```

Agents get the same as the MCP tool `forge_clip`.

## Watch a folder

Drop a folder on home in convert mode: it is one card, **FOLDER – its name**.
↵ asks what to convert to, as for a file, then converts every file in it and
keeps watching: any file you add afterwards is converted too, a row each,
until you press ↵. A folder holding several kinds of file (images, PDFs, …)
asks once per kind; ↵ on a kind opens a window to change its answer.

Files are read by their content once they stop changing, so a screenshot or a
download is never read half-written. Forge never picks up its own output, and
dropping the same folder again leaves what it already converted alone.

From the command line:

```bash
forge watch ./images --to webp            # convert what is there, then each new file
forge watch ./images --to webp -q 70      # at a quality
forge watch ./scans --to png --dpi 300    # PDFs, a page each
forge watch ./images --to webp -o ./dist  # into another folder
forge watch ./images --to webp --new-only # only what lands from now on
forge watch ./images --to webp --json     # one JSON document per line, per event
```

ctrl-c stops it and prints the totals.

## Resize and trim edges

Both need nothing extra, keep the file's own format unless `--to` says otherwise,
and work on images only:

```bash
forge photo.jpg --resize 50%       # photo-2016x1512.jpg (percent, 1-200)
forge photo.jpg --width 1200       # photo-1200x900.jpg  (the height follows)
forge photo.jpg --height 900       # the width follows
forge photo.jpg --trim             # photo-trimmed.jpg   (transparent or solid-colour edges)
forge photo.jpg --trim --width 1200 --to webp -q 80   # photo-trimmed-1200w.webp
```

Use one of `--resize`, `--width` and `--height`. A percent is of the upright
(and trimmed) size. They combine with `--to`, `-q`, `-o`, `--background`,
`--keep-metadata`, `--recursive`, `--force`, `--concurrency` and `--json`, and
are refused with `--max-size`, `--sharpen`, `--boost`, `--remove-bg` and the PDF
page operations, and with a `--to` that is not an image format. No side may pass
16,384 px, nor the result 100 MP. Trimming an animated image is refused; so is
trimming one with nothing to trim, unless it is also resized, which then only
warns. `forge_convert` takes
`trim: true` and `resize: { percent } | { width } | { height }`, and then `to`
is optional.

## Crop to shape

Cut a photo to a shape — the largest box of that shape it holds, placed to
keep the subject. Built in, images only, and the format is kept unless `--to`
says otherwise:

```bash
forge photo.jpg --crop 1:1                        # photo-cropped-1x1.jpg
forge photo.jpg --crop 4:5 --width 1080 --to webp # photo-cropped-4x5-1080x1350.webp
forge *.jpg --crop 16:9 -o out/
```

The shape is `W:H`, two whole numbers from 1 to 100. A `--resize`, `--width`
or `--height` applies to the cropped image. `--crop` combines with the same
flags resize does, and is refused with the same ones — and with `--trim`: run
one, then the other. Cropping an animated image is refused; so is cropping one
that already has the shape, unless it is also resized, which then only warns.
`forge_convert` takes `crop: "1:1"` (any `W:H`), and then `to` is optional.
In the app, Crop to shape is an Edit row with a preview you can move and
zoom.

## Boost resolution and remove background

Two image operations that need a model, so they are optional extensions rather
than part of the install. On a Mac both need macOS 14 or later. Boost runs on
the graphics card: CoreML on Apple silicon, DirectML on Windows (any DirectX 12
graphics), WebGPU on Intel Macs (Metal) and on Linux x64 (Vulkan, so it needs a
Vulkan driver for the card). Where that would leave the processor to do it and
a photo would take over about three minutes, Boost stops and says so. Remove
background uses Apple Vision on a Mac, and on Windows and Linux a small model
(BiRefNet-lite, 54 MB, on the processor: about two seconds a photo and 2 GB of
memory at its peak). Windows and Linux also have a `heic` extension, because macOS opens
iPhone photos itself and they need a decoder. Nothing downloads until you ask:

```bash
forge extensions                        # list: installed or not, size, licence
forge extensions add boost              # about 15 MB on Apple silicon, 16 MB on an Intel Mac, 17 MB on Linux x64, 23 MB on Windows
forge extensions add remove-background  # 32 KB on a Mac (Apple Vision); 46 to 52 MB on Windows and Linux
forge extensions add heic               # about 0.5 MB; Windows and Linux
forge extensions add whisper            # transcribe where Apple's recogniser is not (see above)
forge extensions add yt-dlp             # YouTube links for transcribe, every OS
forge extensions remove boost
```

```bash
forge photo.jpg --sharpen          # photo-sharp.png (the same size, sharper)
forge photo.jpg --boost            # photo-2x.png   (2x, the default)
forge photo.jpg --boost 3          # photo-3x.png   (needs boost 1.1.0 or later)
forge photo.jpg --boost 4          # photo-4x.png
forge photo.jpg --remove-bg        # photo-cutout.png
forge photo.jpg --remove-bg --to webp
```

Output goes beside the source unless `-o` says otherwise. Boost keeps
transparency, and flattens it onto `--background` only when `--to` names a
format that cannot carry it. A cutout must be saved in a format that holds
transparency (PNG, WebP, AVIF, TIFF); JPEG is refused, because flattening would
undo the cutout. Without the extension installed, either flag stops with
`extension-missing` and the install command (exit 1). `--boost 3` on an older
boost stops with `extension-outdated`; `forge extensions add boost` updates it
(and while no released boost makes 3x, it is refused naming the factors that work).
Output more than 16,384 px on a side, or over 100 MP, is refused before
anything runs.

`forge probe` lists `boost` / `remove-background` among a file's `actions` only
while that extension is installed, and `--json` results report `op: "boost"` or
`op: "remove-background"`. `forge_convert` accepts `sharpen: true`, `boost: 2 | 3 | 4` and
`removeBackground: true`, with the same `extension-missing` tool error.

The shell's edit Done shows the real pictures in iTerm2, WezTerm, Kitty and Ghostty (a half-block close-up elsewhere); `FORGE_INLINE_IMAGES=0` turns them off, `=1` forces them on (e.g. tmux with passthrough).

## PDF

Five page operations, one flag each: merge, split, extract, delete and
rotate. None of them take `--to` — a PDF stays a PDF — and only one
operation runs per invocation:

```bash
forge a.pdf b.pdf --merge                # combine, in argument order
forge report.pdf --split every-page      # one file per page
forge report.pdf --split every=5         # groups of 5; the last group is shorter
forge report.pdf --split at=4,8          # cut after pages 4 and 8 → three parts
forge report.pdf --extract 3-7,12        # keep only these pages, one output file
forge report.pdf --extract 1,3 --separate  # one output file per selected page
forge report.pdf --delete 1,2            # drop these pages
forge report.pdf --rotate 90             # quarter turn clockwise
```

Asking for two at once is rejected outright, not merged into some combined
behaviour:

```
$ forge report.pdf --merge --split every-page
✕ Invalid arguments

  Use one operation at a time — got --merge and --split.
```

### Page ranges

`--extract` and `--delete` share one grammar: comma-separated terms, each
`N`, `N-M`, or `N-` for "to the end" — `3-7, 12, 20-`. Page numbers are
1-based. A page outside the document is an error naming the actual count,
never a silent clamp:

```
$ forge report.pdf --extract 1-100
✕ Page range not understood

  "1-100" is outside 1 and 12.

  This document has 12 pages. Use numbers and spans, like "3-7, 12, 20-".
```

### `--split`

Three forms, checked in this order:

| Form | Meaning |
| --- | --- |
| `--split every-page` | one file per page |
| `--split every=N` | groups of `N` pages; the last group takes whatever's left |
| `--split at=N,N,...` | cuts after the named 1-based pages — `at=4,8` on a 12-page document gives pages 1-4, 5-8, 9-12 |

Anything else is rejected: `--split takes every-page, every=N or at=N,N`.

### `--rotate`

Degrees only, and only a multiple of 90 below 360: `90` (quarter turn
clockwise), `180` (upside down) or `270` (quarter turn back). `45` or `360`
are both refused rather than rounded. Rotation is additive — rotating an
already-rotated PDF by another 90° lands at 180°, it doesn't reset to 90°.

### Output names

| Operation | Name |
| --- | --- |
| `--split` | `report-01.pdf` … `report-12.pdf` — zero-padded to the width of the part count, so a 12-part split doesn't sort `-10` before `-2` in a file listing |
| `--extract` | `report-extract.pdf` (one output for the whole selection) |
| `--extract --separate` | `report-p3.pdf`, `report-p12.pdf` — named by page number, not by sequence |
| `--delete` | `report-trimmed.pdf` |
| `--rotate` | `report-rotated.pdf` |
| `--merge` | derived from the inputs' shared parent folder — merging everything in `~/invoices/` writes `invoices-merged.pdf` into that folder; inputs spanning different folders fall back to `<first-file>-merged.pdf` |

Every one of these writes beside its source(s) — page operations have no
`--output` flag, and passing one is refused rather than quietly ignored.

### Write safety

A page operation refuses to overwrite an existing output, and refuses to
write over one of its own inputs. `--force` overrides both of those — but
never a collision between two of a job's own outputs, which is a bug in the
request rather than a preference. This is what makes running the same merge
twice safe rather than destructive: the second run stops instead of folding
the first run's output back in as one of its own inputs.

```
$ forge invoices/jan.pdf invoices/feb.pdf --merge
✓ 1 file · invoices-merged.pdf
$ forge invoices/jan.pdf invoices/feb.pdf --merge
✕ File already exists

  invoices-merged.pdf is already there.

  Pass --force to replace it, or move the existing file out of the way.
```

(A glob like `invoices/*.pdf --merge` run twice hits a sharper version of the
same problem: the second run's glob also matches the first run's
`invoices-merged.pdf`, so it fails with "Output would replace the original"
instead — one of its own inputs, not just a stale file on disk. Either way,
nothing gets overwritten without `--force`.)

### PDF → image

A PDF can also become a JPEG or PNG — this is `--to`, not one of the five
page operations above, so it composes with the rest of the flag CLI rather
than living in `--merge`/`--split`/etc.:

```bash
forge report.pdf --to jpeg --pages 2-4 --dpi 150
```

```
$ forge report.pdf --to jpeg --pages 2-4 --dpi 150
✓ report.pdf → 3 files
  report-2.jpg, report-3.jpg, report-4.jpg
  1.6 KB → 11.6 KB total
```

`--pages` uses the same grammar as `--extract`/`--delete` (see
[Page ranges](#page-ranges) above) and defaults to every page when omitted.
`--dpi` sets the rasterisation resolution, `36`-`600`, default `150`:

```
$ forge report.pdf --to png --dpi 35
✕ Invalid resolution

  35 is not a resolution Forge can use.

  Give a number between 36 and 600. The default is 150.
```

A PDF's only targets are `jpeg`, `png`, and `pdf` itself (page operations) —
asking for anything else is rejected the same way an unsupported image
target is:

```
$ forge report.pdf --to webp
✕ Can't convert report.pdf to webp

  report.pdf is a PDF image.

  Available: jpeg, png, pdf
```

Output files are named by 1-based page number and zero-padded to the width of
the *highest page number being written*, not the size of the `--pages`
selection — so picking pages 1 and 10 still sorts correctly rather than
listing `-10` before `-2`:

```
$ forge big.pdf --to jpeg --pages 1,10
✓ big.pdf → 2 files
  big-01.jpg, big-10.jpg
  2.9 KB → 7.7 KB total
```

The padding follows the pages actually written, so a small selection out of a
long document is not padded to that document's width:

```
$ forge big.pdf --to png --pages 1,2      # big.pdf has 300 pages
✓ big.pdf → 2 files
  big-1.png, big-2.png
  4.2 KB → 928 B total
```

### image → PDF

```
$ forge report-1.png --to pdf
✓ report-1.png → report-1.pdf
  5.9 KB → 6.2 KB · 5.8% larger
```

Each image becomes its own single-page PDF — converting several images with
`--to pdf` writes one PDF per image, not one PDF containing all of them.
Combining several files into one PDF is `--merge`, and `--merge` only takes
PDFs as input.

### Encrypted PDFs

Forge can **read** a password-protected PDF — probing and `--to jpeg`/`--to
png` both work once it has the password. Page operations (`--merge`,
`--split`, `--extract`, `--delete`, `--rotate`) refuse an encrypted PDF
outright: they rewrite the file, and Forge cannot write an encrypted one.
`forge probe` says so: for an encrypted PDF it lists only the image formats
as targets and `convert` as the only action.

It cannot **remove** a password either; there is no unlock or decrypt-and-resave
feature, on purpose. The only libraries that can decrypt and rewrite a PDF
are AGPL-licensed, and Forge is MIT, so that feature was cut rather than
shipped under a licence the rest of the project doesn't carry.

There is deliberately no `--password` flag — an argument lands in shell
history and in `ps` output, and PDF passwords are reused often enough that
leaking one leaks more than one file. Two routes instead:

```
$ echo -n "hunter2" | forge locked-hunter2.pdf --to png --password-stdin
✓ locked-hunter2.pdf → 3 files
  locked-hunter2-1.png, locked-hunter2-2.png, locked-hunter2-3.png
  2.7 KB → 22.4 KB total
```

or, at a terminal, leave `--password-stdin` off and Forge prompts on stderr,
reading one line without echoing it back:

```
$ forge locked-hunter2.pdf --to jpeg
Password: 
✓ locked-hunter2.pdf → 3 files
  locked-hunter2-1.jpg, locked-hunter2-2.jpg, locked-hunter2-3.jpg
  2.7 KB → 16.6 KB total
```

A wrong password is told apart from a missing one, and Forge never echoes the
attempt itself:

```
$ echo -n "wrongpass" | forge locked-hunter2.pdf --to png --password-stdin
✕ This PDF is password-protected

  locked-hunter2.pdf is password-protected.

  That password didn't open it. Check it and try again.
```

`--password-stdin` reads one line, so a pipe that stays open after sending
the password does not hold Forge up. Without a terminal (piped, scripted, or
driven by an agent) Forge never prompts: an encrypted PDF without
`--password-stdin` fails at once with exit 1.

### In the shell

`/pdf` needs at least one staged PDF (drop a file, then drop another to
stage a second one — that's how two files end up ready for merge). It opens
a hub listing all five operations, dimming whichever don't apply to what's
staged — merge stays dimmed with fewer than two PDFs, the other four need
exactly one PDF (split additionally needs it to have more than one page) —
then walks that operation's own options: extract and delete open a page grid
(`space` toggles, `a` selects all, `r` switches to a typed range) that falls
back straight to the typed field on a terminal too narrow to fit the grid;
split's "at points I choose" opens the same grid in cut mode; merge opens a
reorderable list where files can be picked up and dropped into a new order,
sorted, removed, or renamed before confirming. A confirm screen lists the
planned output filenames before anything runs.

Choosing an image target for a staged PDF (see [PDF → image](#pdf--image)
above) adds two steps of its own between target and destination: which pages
to render — all, or choose from a page grid the same way extract/delete
does — and the rasterisation resolution. Rendering itself runs a live
progress bar tracking pages completed against the page count, rather than
the shell's usual single-file "no percentage" convert step, since a
multi-page render has a real count to report against.

### Not yet

PDF↔image conversion, reading a password-protected PDF (see [PDF →
image](#pdf--image) and [Encrypted PDFs](#encrypted-pdfs) above — including
in the shell), and compressing a PDF that holds images (`forge scan.pdf
--max-size 2mb`) all work. A PDF that is only text and layout has nothing
compression can shrink, and Forge says so. Still not implemented: Markdown,
HTML and Office conversion beyond Word. Removing a password from a PDF is not
planned at all — see [Encrypted PDFs](#encrypted-pdfs) for why. Separately,
and not specific to PDFs: the shell refuses to convert or compress several
staged files at once today — that's a deliberate limit while batch handling
through the shell is still unbuilt, not a bug.

## Colour

Two things for designers: an image's palette, and a tonal scale from one
colour. Both are in the shell as its fourth mode, and on the command line.

### In the shell

Press **5** (or type `/colour`). Home shows three cards: **Extract**,
**Scale** and **Palette**. Choose one with ←→ and open it with ↵. You can
also drop an image straight onto colour's home, or press `#` (or paste a
colour) to type one.

The colour box takes a hex code, `rgb()`, `hsl()`, `oklch()` or a colour
name: CSS's 148 and the xkcd colour survey's 949 everyday ones, so
`cherry red` works. Something it can't read turns red, marked `wrong input`.

- **Extract.** Drop an image, or type its path into the field at the top. The
  photo is drawn in its own colours next to the list, with each colour's share
  of the image.
  - ↑↓ choose a colour; it stays lit in the photo and the rest dim.
  - → goes inside a colour: its shades, lit where they are in the photo.
    ← comes back.
  - `s` makes a scale from the chosen colour.
- **Scale.** Type a colour. You get 50–950 with your colour at 500, and a
  preview of the chosen step: "Aa" in white and black, with each rated
  (AAA, AA, large, fails).
  - ←→ choose a step; `s` chooses the steps (Tailwind, Even, Radix).
  - `tab` switches between three tabs. **Colour** is the scale itself.
    **Neutral** is a grey scale tinted with your colour's hue (tint: none,
    faint, soft, strong). **Alpha** is each step as the most see-through
    `#RRGGBBAA` that looks the same over white (or black), drawn over a
    checkerboard with its opacity on it.
  - `r` makes that step the new centre and rebuilds the scale around it.
  - `→` at the end of a colour in the box asks for a second: ↵ **mixes**
    the two, in OKLab or OKLCH, in 3 to 21 steps.
- **Palette.** Type one colour and get a whole palette that goes with it:
  red, orange, yellow, green, teal, blue, purple and pink, each a 50–950
  scale, and a neutral.
  - `m` chooses a mode: Full set, Monochromatic, Analogous, Complementary,
    Split complementary, Triadic or Pastel.
  - `t` tweaks the whole palette: brightness, saturation and contrast from
    −100 to +100, hue from −180° to +180°. ←→ moves by 1, ⇧←→ by 10, and `r`
    resets.

On every screen, ↵ copies the chosen hex and `c` copies the whole set. Paste
it into Figma with ⌘V: you get real shapes and text layers, named
`blue-500` and so on. esc goes back one step, and the bar at the top shows
the way back. Under `NO_COLOR`, the screens are plain text with every key
still working.

### On the command line

```
$ forge palette photo.jpg
#B897E4   16%
#86B627   16%
#256129   14%
…
$ forge palette photo.jpg --inside F96363     # the shades one colour is made of
#FF665A   63%
#F35949   15%
#E58A9F   14%
#BE5C38    8%
$ forge scale 6579FD
  50  #F4F6FF  white 1.0 fails · black 19.4 AAA
 …
 500  #6579FD  white 3.6 large · black 5.7 AA
 …
 950  #161B58  white 15.7 AAA · black 1.3 fails
```

- **`forge palette <image>`** gives an image's main colours, most of the image
  first. Each one is a real pixel from the image, not an average, and the
  percentages add up to 100. The image is probed by content, so a PDF named
  `.png` is refused as not an image.
- **`forge scale <colour>`** gives 50–950 built in OKLCH, with your colour
  exactly at 500. Each step is rated for white and black text (WCAG: AAA, AA,
  large, fails). Ratios are rounded down, so 4.48:1 shows as `4.4 large` and
  is never passed off as AA. The colour can be written as the colour box
  takes it (`forge scale crimson`, `forge scale 'rgb(210 4 45)'`). Pass a hex
  without the `#`, or quote it (`'#6579FD'`): an unquoted `#` starts a
  comment in the shell.
- **`--svg`** prints a card of swatches. Pipe it to `pbcopy` and press ⌘V in
  Figma to get real shapes and text layers: `forge scale 6579FD --svg | pbcopy`.
- **`--json`** returns `palette` (`source`, `colours[]` with `hex`, `rgb`,
  `oklch`, `share`) or `scale` (`reference`, `steps[]` with `step`, `hex`,
  `oklch`, `white`, `black`).

On a colour terminal each row starts with a swatch. Piped, or under
`NO_COLOR`, the rows are plain text.

## Usage

```
forge <inputs...> --to <format> [options]
```

| Flag | Meaning |
| --- | --- |
| `-t, --to <format>` | target format (required) |
| `-o, --output <path>` | output file or directory |
| `-q, --quality <n>` | 1–100, lossy targets only, **requires `--to`** |
| `--background <css>` | fill colour when flattening alpha (default white) |
| `--keep-metadata` | preserve EXIF/GPS instead of stripping it |
| `--recursive` | descend into subdirectories |
| `--force` | allow overwriting an existing output file |
| `--concurrency <n>` | batch parallelism (default `min(cpus, 4)`) |
| `--debug` | include stack traces in error output |
| `--formats` | print the capability matrix |
| `-V, --version` / `-h, --help` | the usual |

`--quality` is rejected unless `--to` is also given — even though it looks
like it should stand alone. That's deliberate: a future `compress` action
will accept `--quality` on its own with different semantics (compress in
place, no format change), and letting `--quality` alone mean something today
would make it a breaking change later. So for now it's tied to `--to`.

### A single conversion

```
$ forge sample.jpg --to webp
✓ sample.jpg → sample.webp
  11.5 KB → 3.5 KB · 69.6% smaller
```

Run it again without `--force` and it refuses to clobber the existing file:

```
$ forge sample.jpg --to webp
✕ File already exists

  sample.webp is already there.

  Pass --force to replace it, or choose a different --output.
$ echo $?
1
```

```
$ forge sample.jpg --to webp --force
✓ sample.jpg → sample.webp
  11.5 KB → 3.5 KB · 69.6% smaller
$ echo $?
0
```

### Errors are specific, not stack traces

```
$ forge ghost.jpg --to webp
✕ File not found

  ghost.jpg could not be found.

  Check the filename and try again.
$ echo $?
1
```

```
$ forge sample.jpg --to mp4
✕ Invalid arguments

  mp4 is not a format Forge knows.

  Run forge --formats to see what is available.
$ echo $?
2
```

```
$ forge sample.jpg --to heic
✕ Can't convert sample.jpg to heic

  sample.jpg is a JPEG image.

  Available: jpeg, png, webp, avif, gif, tiff
$ echo $?
1
```

```
$ forge sample.jpg
✕ Invalid arguments

  No target format given.

  Add --to <format>, for example: forge photo.jpg --to webp
$ echo $?
2
```

No stack trace ever reaches the terminal unless you pass `--debug`.

### Batches and folders

Point Forge at a directory and it converts everything inside (one level
deep, unless you pass `--recursive`):

```
$ forge photos --to webp -o ./out/
✓ 3 converted
  6.2 KB → 1.9 KB · 69.6% smaller
  out/photo1.webp
  out/photo2.webp
  out/photo3.webp
```

With `--recursive`, the source tree is recreated under the output directory
instead of being flattened:

```
$ forge photos --to png -o ./t/ --recursive
✓ 4 converted
  8.3 KB → 1.7 KB · 80% smaller
  t/photo1.png
  t/photo2.png
  t/photo3.png
  t/sub/deeper/bottom.png
```

```
$ find t -type f
t/photo1.png
t/photo2.png
t/photo3.png
t/sub/deeper/bottom.png
```

Both glob forms work — `forge *.jpg --to webp` (expanded by your shell) and
`forge "*.jpg" --to webp` (expanded internally).

### Output path rules

| Invocation | Result |
| --- | --- |
| `forge a.jpg --to webp` | `./a.webp` |
| `forge a.jpg --to webp -o ./dist/` | `./dist/a.webp` |
| `forge a.jpg --to webp -o ./dist/x.webp` | `./dist/x.webp` |
| `forge ./photos --to webp` | alongside each source |
| `forge ./photos --to webp -o ./dist/` | flattened into `./dist/` |
| `forge ./photos --to webp -o ./dist/ --recursive` | tree recreated under `./dist/` |

A trailing slash, or an existing directory, means directory. Anything else
without a file extension is also treated as a directory (`-o dist` is far
more often a folder than a file named `dist`). Missing intermediate
directories are created. Exit codes: `0` all succeeded, `1` some failed,
`2` invalid arguments.

### Bare `forge`

Run `forge` with no arguments in a real terminal and it launches the
interactive shell instead of erroring — see [Interactive shell](#interactive-shell)
below for the full flow. That launch is gated on stdout actually being a
TTY, so it only ever happens in a terminal you're sitting at.

Piped or non-interactive invocations (no TTY) get a hint instead, and never
hang waiting for input:

```
$ forge | cat
Forge needs a file and a target format.
Try: forge photo.jpg --to webp
$ echo $?
2
```

## Use with AI agents

Tell an agent *"take this image and use Forge on it"* and it can: Forge is
local, private, and built to be driven without a person at the keyboard.

### As an MCP server

```bash
claude mcp add forge -- forge mcp     # Claude Code
codex mcp add forge -- forge mcp      # Codex / ChatGPT desktop's Codex
```

Claude Desktop and Cursor:

```json
{ "mcpServers": { "forge": { "command": "forge", "args": ["mcp"] } } }
```

Seven tools, deliberately few:

| Tool | Does |
| --- | --- |
| `forge_probe` | what files are and what Forge can do with them |
| `forge_formats` | the capability matrix |
| `forge_convert` | convert to a target format (`quality`, `dpi`, `pages`, `background`, `password`, `overwrite`; images also `trim`, `crop`, `resize`, `sharpen`, `boost: 2 \| 3 \| 4` and `removeBackground`, the last two needing the optional extensions) |
| `forge_compress` | compress by `quality` or to a `maxSize` (also `dpi` for PDFs, `output`, `overwrite`; no `password`: compression refuses encrypted PDFs) |
| `forge_pdf` | `merge`, `split`, `extract`, `delete`, `rotate` |
| `forge_palette` | an image's main colours with their shares; `inside` gives one colour's shades (read-only) |
| `forge_scale` | a 50–950 tonal scale with the colour at 500, rated for white and black text; the colour as hex, `rgb()`, `hsl()`, `oklch()` or a name (read-only) |

Paths must be absolute. Results come back as structured content in the
`--json` shape below, with a `file://` link to every output, and never as
file contents. Nothing is overwritten unless the call passes
`overwrite: true`. An encrypted PDF takes a `password` argument to
`forge_convert`; there is no prompt. The server speaks MCP over stdio,
negotiates protocol revision 2025-11-25 with current Claude Code, writes
nothing but protocol messages to stdout, and exits when its client closes
stdin.

**Limitation:** an image pasted into a chat app is not a file on disk, so a
path-based tool cannot see it. Agents with file access (Claude Code, Cursor,
Codex) are the natural fit.

### As a CLI, with the skill

[`skills/forge/SKILL.md`](skills/forge/SKILL.md) teaches an agent with a
shell to probe before converting, pass `--json`, read exit codes, and never
pass `--force` unless asked. For Claude Code, copy it to
`~/.claude/skills/forge/SKILL.md`. It ships in the npm package: after
`npm install -g forge-terminal` it is at
`$(npm root -g)/forge-terminal/skills/forge/SKILL.md`.

### `forge probe`

```
$ forge probe locked.pdf photo.png
locked.pdf · PDF · 2.7 KB · 3 pages · password-protected
  converts to  jpeg, png, pdf, docx
  actions      convert, split, extract, delete, rotate

photo.png · PNG · 122 KB · 2756×774
  converts to  jpeg, png, webp, avif, gif, tiff, pdf
  actions      convert
```

With `--json`:

```json
{"forge":"0.5.0","ok":true,"probes":[{"path":"/Users/me/photo.png","kind":"image","format":"png","bytes":122449,"width":2756,"height":774,"targets":["jpeg","png","webp","avif","gif","tiff","pdf"],"actions":["convert"]}],"failures":[]}
```

`targets` and `actions` come from the engines' own capabilities, so they are
always true for that file. `format` is read from the file's content, not its
name. `actions` lists `convert` plus what else applies: `compress`,
`split`, `extract`, `delete`, `rotate`; `merge` appears only when several
PDFs are probed together. `compress` appears when quality or size can be
reduced: lossy images, PNG and GIF, and PDFs that contain compressible images
(a TIFF has only `convert`). Run it as `--quality N` or `--max-size S` without `--to`;
its `--json` result reports `op: "convert"`. The encrypted PDF above omits
`compress` and `merge`; a plain PDF with images would also list `compress`.
A probe has `width`/`height` for an image,
`pages` and `encrypted` for a PDF. Probing writes nothing. A file that cannot
be probed goes in `failures` and does not stop the others.

### `--json`

Every command accepts `--json`. stdout then carries exactly one JSON document
on one line, and nothing else: no colour, no glyphs, no progress. Every
document has `forge` (the version), `ok` (true only if every input
succeeded) and `failures`. A conversion, compression or page operation adds
`results`:

```jsonc
{
  "forge": "0.5.0",
  "ok": false,
  "results": [
    {
      "op": "convert",                  // convert | merge | split | extract | delete | rotate
      "source": "/abs/photo.heic",      // = sources[0]
      "sources": ["/abs/photo.heic"],   // all of them, for a merge
      "outputs": ["/abs/photo.webp"],   // always absolute, always every file written
      "inputBytes": 52074,
      "outputBytes": 42684,
      "warnings": [{ "code": "animation-flattened", "message": "…" }]
    }
  ],
  "failures": [
    {
      "path": "/abs/locked.pdf",        // absent for a command-level error
      "code": "encrypted-source",       // a stable ErrorCode
      "title": "…", "detail": "…", "hint": "…"
    }
  ]
}
```

`--formats --json` returns `formats` (`id`, `label`, `extensions`, `read`,
`write`, `lossy`). `forge probe --json` returns `probes`. `forge palette
--json` returns `palette`, and `forge scale --json` returns `scale` (see
[Colour](#colour)). `forge config
--json` returns `config` and `warnings`. An argument error is a document with
one `invalid-arguments` failure and exit code 2. Fields are not renamed or
removed within a minor version; the `forge` field says which version you are
reading. `--help` and `--version` print text even with `--json`.

### Exit codes

| Code | Meaning |
| --- | --- |
| 0 | Every input succeeded |
| 1 | The command was understood, and at least one input failed or was refused |
| 2 | The command itself was invalid: an unknown flag, a missing argument, contradictory flags |

If the same flags could succeed on a different file, it's 1; otherwise it's 2.
The table is also in `forge --help`.

### No terminal, no prompt

Without a TTY, Forge never waits for input. An encrypted PDF without
`--password-stdin` fails at once (exit 1), and `--password-stdin` reads a
single line, so a pipe left open by the caller does not hold it up.

### By hand, before a release

Registering a server in a real agent config is a human step, so it is not
part of the test suite:

1. `npm run build && npm link`, then `claude mcp add forge -- forge mcp`. In
   Claude Code: "convert ~/Desktop/x.heic to jpeg", "compress it to 200kb",
   "split ~/Desktop/doc.pdf into pages". Each must succeed and name its
   outputs. `/mcp` should show the server connected.
2. Repeat in Claude Desktop with the `mcpServers` snippet above, and record
   which protocol revision it negotiates (its MCP log shows the `initialize`
   exchange).
3. If either client cannot connect, read its MCP log before changing code.

## Interactive shell

Ink/React are only loaded (via a dynamic `import()`) once the TTY check
above passes, so a normal flag invocation like `forge photo.jpg --to webp`
never pays to load a UI framework it doesn't use — confirmed by hand: the
flag CLI's own tests and manual runs are unaffected by the shell's
existence.

The flow is one path, start to finish: drop a file → pick a target format →
a quality slider, for a lossy target only → pick a destination → convert →
see the result. What follows is a real session, captured verbatim (with the
ANSI styling stripped for readability) converting an 11.5 KB JPEG to WebP
in a 100-column terminal:

```
╭──────────────────────────────────────────────────────────────────────────────────────────────────╮
│ › drop a file or type a path                                                                     │
╰──────────────────────────────────────────────────────────────────────────────────────────────────╯
↵ send · ctrl-c close app
```

Drag a file in from Finder (its path arrives shell-escaped, e.g. `my\ photo.jpg`,
and is unescaped automatically) or type a path, then press Enter. Forge
probes it and shows a one-line card:

```
sample.jpg · 11.5 KB · JPEG 1600×1200
```

Then a target menu — built from what the source can actually become, never
a hardcoded list, which is why HEIC never appears here (see
[Supported formats](#supported-formats)):

```
Convert to
❯ JPEG  universal
  PNG   lossless
  WebP  smaller, modern
  AVIF  smallest
  GIF   animation
  TIFF  archival
↑↓ choose · ↵ confirm · esc back
```

Arrow keys move `❯`; Enter accepts the highlighted format. Choosing a lossy
target (WebP, JPEG, AVIF) adds a quality slider; PNG, GIF and TIFF skip
straight to the destination step:

```
Quality
━━━━━━━━━━━━━━━●━━━━ 80
←→ adjust · ↵ confirm · esc back
```

The destination step offers the source folder, a new `converted/`
subfolder, `~/Downloads`, or a typed path — the preview line below follows
whichever preset is highlighted:

```
Save to
❯ Same folder    .
  New subfolder  converted
  Downloads      /Users/you/Downloads
  Type a path…
  → ./sample.webp
```

Enter on a preset converts immediately — unless writing there would destroy
something. The shell runs the same `buildPlan()` write-safety checks the flag
CLI does (§ *Safety* above): converting a JPEG to JPEG in its own folder, which
is what accepting every default does, resolves the output onto the input and is
refused outright rather than replacing your original with a lossy re-encode:

```
✕ Output would replace the original
  sample.jpg is both the input and the output.
```

and an output that already exists asks instead of clobbering it:

```
sample.webp already exists
❯ Keep both  sample (1).webp
  Replace    the existing file is lost
  Cancel     pick a different folder
```

Either way you land back on the destination step. Otherwise:

```
✓ sample.jpg → sample.webp
  11.5 KB → 3.5 KB · 69.6% smaller

file:///private/tmp/forge-shell-check/sample.webp  ·  file:///private/tmp/forge-shell-check
↵ convert another · o open · r reveal · ctrl-c close app
```

`o` opens the converted file in its default app and `o` reveals it in
Finder — both just shell out to macOS's `open`; both actually launched
Preview and Finder in this run, confirmed by asking each app afterward what
it had open. `↵` clears the picker and returns to the prompt with this
result still sitting above it: finished entries are written to the
terminal with Ink's `<Static>`, which commits them to the real scrollback
once rather than redrawing them on every frame — confirmed by inspecting
the raw output stream, which contains no full-screen or scrollback-clearing
escape codes once a card or result has been printed, only the small live
region below it being rewritten. `ctrl-c` closes the app.

Those two links print as bare `file://` URLs (to wherever the file actually
landed — `/tmp/forge-shell-check` was this session's scratch directory)
rather than as the words "Open file" and "Reveal in Finder". Both are
rendered as OSC 8 hyperlinks — a link *target* wrapped around a label — and
a terminal that understands OSC 8 (iTerm2, Ghostty, WezTerm, Kitty, VS
Code's terminal) shows just the label, clickable. Terminal.app doesn't
understand OSC 8, and neither did the scripted terminal this transcript was
captured in, so both degrade to the bare, still cmd+clickable URL instead
of dropping the link entirely — which is exactly what's shown above.

### Terminal support

The layout adapts to width rather than wrapping: below 60 columns the
bordered prompt box, the per-item format hints (`universal`, `lossless`,
...), the destination presets' folder paths, and the file card's
format/dimensions are all dropped so every line stays inside the terminal
edge; above that, a preset's path is middle-truncated to whatever the width
leaves for it; at 60 columns and above everything renders
as pictured above. This re-bands live if you resize the window mid-session,
not just at launch. Long filenames and paths are truncated from the middle
(keeping both the start and the extension visible) rather than overflowing
or wrapping. Meaning is never colour-only: every status is a symbol plus a
word (`✓`/`✕`/`⚠`), and the selected item in every list is marked with `❯`
and rendered bold.

### What the shell doesn't do yet

- **Batch convert or compress.** `/convert` and `/compress` refuse to run
  against more than one staged file, rather than silently acting on just the
  first — point the flag CLI at a folder instead. Several files *can* be
  staged at once now, but only `/pdf`'s merge is defined by having more than
  one; a paste containing several paths is still read as one path and fails
  to probe as such.
- **PDF compression and splitting to a target size.** Not in this phase —
  see [PDF § Not yet](#not-yet) above for what's coming and when.
- **No recent-files list** — every session starts at an empty prompt.

## Keyboard shortcuts

In the text field:

| Action | Keys |
| --- | --- |
| Move a word | Option+Left / Option+Right (also Ctrl+Left / Ctrl+Right) |
| Start / end of line | Home / End, or Ctrl+A / Ctrl+E |
| Delete the word before the caret | Option+Backspace, or Ctrl+W |
| Delete the word after the caret | Option+fn+Delete |
| Delete to start / end of line | Ctrl+U / Ctrl+K |
| Cut / paste the selection | Ctrl+X / Ctrl+Y |
| Extend a selection | Shift+Left / Shift+Right |

**On Cmd shortcuts.** Cmd is the line-scoped counterpart to Option's
word-scoped one, not a word-movement shortcut itself: Cmd+Left/Right go to
the start/end of the line and Cmd+Backspace deletes to the line start — the
same three things Home/End (or Ctrl+A/Ctrl+E) and Ctrl+U already do above.
Cmd+A selects the whole field and has no other binding. All four work only
in terminals that speak the kitty keyboard protocol — iTerm2, Ghostty,
WezTerm, kitty, and the VS Code integrated terminal. Terminal.app cannot
report Cmd at all: its key-mapping UI does not offer Command as a modifier,
so no Cmd chord produces any bytes there. Home/End, Ctrl+A/Ctrl+E and Ctrl+U
cover the same ground everywhere; selecting the whole field has no fallback
in Terminal.app.

## Supported formats

```
$ forge --formats
Formats

  JPEG   .jpg .jpeg   read and write
  PNG    .png         read and write
  WebP   .webp        read and write
  AVIF   .avif        read and write
  HEIC   .heic .heif  read only
  GIF    .gif         read and write
  TIFF   .tif .tiff   read and write
  PDF    .pdf         read and write

HEIC is read only because the image library cannot encode it.
```

PDF's "read and write" covers the five page operations plus rasterising to
JPEG/PNG and encoding images to PDF — see [PDF](#pdf) above for the actual
grammar; it isn't a peer of the image formats above it in every respect
(there's no `--quality` for it, for one).

**Why HEIC is read-only:** Forge's image engine is Sharp/libvips, and the
prebuilt libvips binary can decode HEVC (what iPhones save HEIC as) but
cannot encode it — encoding attempts fail with `heifsave: Unsupported
compression`. So converting *from* `.heic` works normally; converting *to*
`.heic` is refused with a clear error listing what you can target instead,
rather than failing partway through an encode.

Formats are probed by file content (Sharp's magic-byte detection), not by
extension — a `.jpg` that's secretly a PNG is handled correctly, and the
target list is never a hardcoded string list.

### HEIC

Reading HEIC needs a decoder Sharp's prebuilt binary does not ship. HEVC sits
in a patent pool, so upstream's position is that HEIC support requires a
globally installed libvips built against libheif, libde265 and x265 — AVIF
works in the same container only because AV1 is royalty-free.

On a Mac, Forge decodes HEIC with `/usr/bin/sips` instead, which uses the
same system codec Preview does. No install, no build step. If `sips` is
missing, HEIC conversion is the only thing that stops working.

On Windows and Linux, `forge extensions add heic` installs libheif compiled to
WebAssembly (about 0.5 MB, one build for any chip, LGPL-3.0 in its own files).

Writing HEIC is still unavailable: Sharp cannot encode HEVC at all.

## Correctness rules

These apply automatically, unconditionally, unless a flag opts out:

1. **Auto-orient first.** EXIF orientation is applied before any other
   operation, so photos from phones don't come out sideways.
2. **Flatten alpha when the target can't carry it.** Converting a
   transparent PNG to JPEG fills with white (or `--background`), not black.
3. **Strip metadata by default, always keep colour profile.** EXIF and GPS
   are removed unless `--keep-metadata`; the ICC colour profile is always
   kept so colours don't shift on wide-gamut displays.
4. **Never drop animation silently.** An animated source converting to a
   format that can't animate keeps only the first frame — and attaches a
   warning to the result, rather than converting quietly and losing frames.
5. **Bounded concurrency.** Batches run `min(cpus, 4)` conversions at a
   time, so Sharp's threadpool isn't overwhelmed.

Writes are atomic: output goes to a temp file in the destination directory
and is renamed into place only on success, so a crash mid-encode never
leaves a truncated file where a good one used to be.

## Architecture

```
src/
├── core/               pure logic — no stdout, no UI framework
│   ├── types.ts         shared types: SourceInfo, Job, Result, FormatId...
│   ├── formats.ts       format registry (labels, extensions, capabilities)
│   ├── capabilities.ts  readable/writable format sets, targetsFor()
│   ├── actions.ts       Action/OptionSpec — what convert asks for, and in what order
│   ├── resolve.ts       paths / globs / directories → SourceInfo[]
│   ├── plan.ts          (sources, target, options) → Job[]
│   ├── run.ts           bounded-concurrency batch runner, emits events
│   ├── output-path.ts   output path resolution (the table above)
│   ├── units.ts         byte / percentage formatting
│   ├── errors.ts        ForgeError taxonomy and rendering
│   └── colour/          OKLab/OKLCH, contrast, palette (k-means), scale, the Figma card
│
├── engines/
│   ├── types.ts         Engine interface (reads, writes, probe, convert)
│   ├── image.ts         Sharp-backed engine — the correctness rules live here
│   └── registry.ts      engine list, format→engine lookup, engine-agnostic probe()
│
├── cli/
│   ├── args.ts          Commander wiring → Intent
│   ├── execute.ts       runIntent() → RunReport (data); execute() renders text or --json
│   └── report.ts        stdout formatting (success, batch, errors, --formats)
│
├── mcp/                the MCP server — a third front end, loaded only by `forge mcp`
│   ├── server.ts        createForgeServer(): seven tools; runMcpServer(): stdio
│   ├── tools.ts         tool handlers → the same intents and runIntent() the CLI uses
│   ├── schemas.ts       zod input/output schemas, vocabularies read from core/actions
│   └── stdout-guard.ts  stdout belongs to the protocol; stray writes go to stderr
│
├── shell/              the interactive shell (Ink + React) — the only place
│   │                    that renders to a real terminal frame by frame
│   ├── App.tsx           the state machine: file → target → quality →
│   │                      destination → convert → result; the only file
│   │                      that knows the flow
│   ├── blocks.tsx        HistoryBlock/HistoryEntry — what gets committed to
│   │                      <Static> scrollback (file cards, results, errors)
│   ├── launch.tsx        render(<App/>), awaits waitUntilExit()
│   ├── width.ts          width bands (<60 compact) and middle-ellipsis
│   │                      truncation, so nothing overflows or wraps
│   ├── theme.ts          symbols and colour tokens — meaning is carried by
│   │                      symbol + word, never colour alone
│   ├── hyperlink.ts      OSC 8 links with a plain-URL fallback
│   ├── reveal.ts         shells out to macOS `open` / `open -R`
│   └── components/
│       ├── Prompt.tsx      the bordered/unbordered text input; drop target
│       ├── Select.tsx      arrow-key list picker (❯ + bold selection)
│       ├── Slider.tsx      the quality bar
│       ├── PathInput.tsx   destination picker: presets, plus type-a-path
│       ├── FileCard.tsx    the dropped-file summary line
│       └── Hints.tsx       the "key · action" row under each stage
│
├── utils/
│   └── unescape-path.ts  undoes shell escaping on a dragged-and-dropped path
│
└── index.ts              entry point: TTY detection, dispatches to execute()
                           or (on a real TTY, bare invocation) launchShell()
```

**The invariant:** `core/` and `engines/` import no UI framework and never
write to stdout — everything they produce is data (`Job`, `Result`,
`ForgeError`, `RunEvent`). This is what keeps the engine testable without a
terminal, and it's also what lets the shell consume the exact same
`core`/`engines` layer the flag CLI does, unchanged — `App.tsx` calls
`convertAction.plan()` and `runJobs()` directly, the same functions
`cli/execute.ts` calls. `src/index.ts` detects whether stdout is a TTY:
non-interactive invocations (piped, scripted, or no TTY) resolve to the CLI
path and print a hint rather than blocking; a bare `forge` on a real TTY
dynamically imports `shell/launch.js` and hands off to it instead.

## Development

```bash
npm run dev          # run from source with tsx, no build step
npm run build         # one esbuild bundle → dist/ (scripts/build.mjs)
npm run typecheck     # tsc --noEmit over src + tests
npm run lint          # biome check src tests
npm run format         # biome format --write src tests
```

TypeScript runs in strict mode with `noUncheckedIndexedAccess` and
`noImplicitOverride` on. Biome replaces ESLint + Prettier with one dependency
and one config.

## Testing

```bash
npm test        # vitest run
npm run test:watch
```

1413 tests (4 skipped), all passing. Fixtures (transparent PNGs, EXIF-rotated JPEGs,
animated GIFs, HEIC/AVIF samples) are generated by Sharp — or, for HEIC,
`sips` — at test time, never committed as binaries; the one exception is
`tests/fixtures/locked-hunter2.pdf`, a real encrypted PDF (password
`hunter2`) checked in because pdf-lib can't produce an encrypted document
itself. Coverage includes:

- **Engine correctness** — the two reproduced defects (transparent-PNG→JPEG
  going black, EXIF-rotated images staying sideways) as regression tests,
  plus animation handling and the JPEG/PNG/WebP/HEIC/AVIF conversion pairs.
- **Core** — output path resolution, the capability graph, glob and
  directory resolution, concurrency limiting, atomic writes leaving no temp
  file behind on failure.
- **Errors** — one test per `ErrorCode`, including that no stack trace
  leaks without `--debug`.
- **CLI** — argument parsing and exit codes, including the `--quality`
  without `--to` rejection above, and that a bare `forge` on a TTY hands off
  to the shell rather than erroring.
- **PDF rasterisation** — page selection and DPI bounds, zero-padded output
  naming keyed to the document's page count, reading an encrypted PDF by
  both password routes, and that a wrong password never leaks the attempted
  string into an error message.
- **Shell** — `ink-testing-library` driving real keystrokes through every
  stage: arrow-key selection, the quality slider, the destination presets
  and typed-path fallback, a full probe-to-result conversion, dropped paths
  that are shell-escaped or carry an embedded CR/LF, that no rendered line
  exceeds the terminal width at four widths, and — new this phase — the
  page-grid and resolution steps for PDF→image plus the live per-page
  progress bar.

## Roadmap

Not yet built, in rough order:

- **Batch conversion through the shell** — the flag CLI already converts a
  whole folder; the shell only ever probes and converts one file per
  session right now.
- **A real action menu** — the shell's data model already supports more
  than one `Action` (`actionsFor(source)`), but with only `convert`
  registered it skips straight past a menu of one. This is what the next
  two roadmap items would turn on.
- **Compress action** — quality/size reduction without a format change;
  the reason `--quality` requires `--to` today.
- **Resize action.**
- **`/slash` commands** in the shell, and **a recent-files list** so a
  session doesn't always start from an empty prompt.
- **A video engine** — Sharp can't do it; it will sit behind the same
  `Engine` interface `image.ts` and the PDF engine already implement, so the
  CLI and format menu won't need to change to support it. The PDF engine
  itself now covers page operations and PDF↔image (see [PDF](#pdf) above);
  splitting a PDF to a target size is still to come.

Explicitly out of scope for 0.1: HEIC encoding (the underlying library
can't), DOCX/PPTX/SVG output, MP4/MP3, recursive watch mode, config files,
presets.

## License

MIT
