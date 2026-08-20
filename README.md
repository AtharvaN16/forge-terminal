# Forge

**Convert** — a terminal-native file converter for macOS. Command: `forge`.

## What it is

Forge takes a file and turns it into another format without leaving the
terminal. No web upload, no GUI app to open, no ImageMagick incantations to
remember — point it at a file or a folder, say what you want it to become,
and it writes the result next to the original (or wherever you tell it to).

Version 0.1 converts images: JPEG, PNG, WebP, AVIF, GIF, TIFF, and reads
HEIC. It runs correctly, not just fast — auto-orienting phone photos,
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

**Requires macOS and Node 20 or newer** (developed and tested on Node 24).
Check with `node --version`; if you don't have it, `brew install node`.

Forge isn't published to npm yet, so install it from source:

```bash
git clone https://github.com/AtharvaN16/forge-terminal.git
cd forge-terminal
npm install
npm run build
chmod +x dist/index.js   # tsc does not preserve the executable bit
npm link
```

`npm link` puts `forge` on your `PATH`, so it works from any directory.
Verify:

```bash
forge --version
# 0.1.0

forge photo.jpg --to webp
```

`npm install` compiles Sharp's native bindings, which is the slow step —
expect a minute or two on a first install. Nothing else needs Homebrew;
image conversion is entirely self-contained.

### Once it's published

```bash
npm install -g forge-terminal
```

That will be the whole install. It isn't live yet — until then, use the
source route above.

### A name to watch out for

If you write Solidity, you may already have a `forge` on your `PATH`:
Foundry ships a binary by that name, and whichever was installed last wins.
Check before installing:

```bash
which -a forge
```

If more than one path comes back, they're shadowing each other. You can
rename Forge's command by editing the `bin` field in `package.json` before
running `npm link`:

```json
"bin": { "convert-forge": "./dist/index.js" }
```

(The command isn't called `convert` for the same reason: ImageMagick's
legacy binary already claims that name and Homebrew still installs it.)

### Updating and removing

```bash
git pull && npm install && npm run build   # update
npm unlink -g forge-terminal               # remove
```

## Configuration

Forge stores preferences at `~/.config/forge/config.json`, or
`$XDG_CONFIG_HOME/forge/config.json` when that is set.

```bash
forge config list                    # show every setting and where it lives
forge config set output ~/Desktop    # default output folder
forge config set theme light         # dark or light
forge config set quality 80          # what the quality slider opens on
forge config path                    # print the file location
```

A corrupt or unreadable config never blocks a conversion. Forge falls back to
defaults, says so once, and carries on — and it validates key by key, so one
bad setting does not cost you the ones that are fine. Keys written by a newer
version of Forge survive a write from an older one.

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

Compression only applies to formats with a quality dial. A PNG is lossless, so
there is nothing to trade away; `/convert` it to WebP instead, and Forge says
so if you try.

After compressing, if another format would be meaningfully smaller, Forge says
so — and it encodes a candidate to find out rather than guessing:

```
✓ done   photo.jpg → photo-small.jpg
         4.2 MB → 1.1 MB · 73% smaller

⚠ WebP would be 480 KB — 56% smaller again.
  ↵ convert another · c convert to WebP · o open · s show in finder · q quit
```

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

Output: ./out/
```

With `--recursive`, the source tree is recreated under the output directory
instead of being flattened:

```
$ forge photos --to png -o ./t/ --recursive
✓ 4 converted
  8.3 KB → 1.7 KB · 80% smaller

Output: ./t/
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
↵ send · ctrl-c quit
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
↵ convert another · o open · r reveal · q quit
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
region below it being rewritten. `q` quits.

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

- **One file at a time.** No batch conversion through the shell — point it
  at a folder from the flag CLI instead. A paste containing several paths is
  read as one path and fails to probe as such.
- **One action.** Convert is the only thing on offer; the underlying data
  model supports a menu of actions (`actionsFor`), but with exactly one
  action registered the shell skips straight past a menu of one.
- **No slash commands.**
- **No recent-files list** — every session starts at an empty prompt.

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

HEIC is read only because the image library cannot encode it.
```

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

Forge decodes HEIC with `/usr/bin/sips` instead, which uses the same system
codec Preview does. No install, no build step. If `sips` is missing, HEIC
conversion is the only thing that stops working.

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
│   └── errors.ts        ForgeError taxonomy and rendering
│
├── engines/
│   ├── types.ts         Engine interface (reads, writes, probe, convert)
│   ├── image.ts         Sharp-backed engine — the correctness rules live here
│   └── registry.ts      engine list, format→engine lookup, engine-agnostic probe()
│
├── cli/
│   ├── args.ts          Commander wiring → Intent
│   ├── execute.ts       runs an Intent, returns exit code + stdout/stderr
│   └── report.ts        stdout formatting (success, batch, errors, --formats)
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
npm run build         # tsc -p tsconfig.json → dist/
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

237 tests, all passing. Fixtures (transparent PNGs, EXIF-rotated JPEGs,
animated GIFs, HEIC/AVIF samples) are generated by Sharp — or, for HEIC,
`sips` — at test time, never committed as binaries. Coverage includes:

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
- **Shell** — `ink-testing-library` driving real keystrokes through every
  stage: arrow-key selection, the quality slider, the destination presets
  and typed-path fallback, a full probe-to-result conversion, dropped paths
  that are shell-escaped or carry an embedded CR/LF, and that no rendered
  line exceeds the terminal width at four widths.

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
- **PDF and video engines** — Sharp can't do either; these will sit behind
  the same `Engine` interface `image.ts` implements now, so the CLI and
  format menu won't need to change to support them.

Explicitly out of scope for 0.1: HEIC encoding (the underlying library
can't), DOCX/PPTX/SVG output, MP4/MP3, recursive watch mode, config files,
presets.

## License

MIT
