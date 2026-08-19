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

Today Forge is a flag-driven CLI, built to be scriptable and usable for daily
conversions. An interactive shell is planned but **does not exist yet** — see
[Roadmap](#roadmap).

## Installation

Forge isn't published to npm yet. Build and link it from source:

```bash
git clone https://github.com/AtharvaN16/forge-terminal.git
cd forge-terminal
npm install
npm run build
chmod +x dist/index.js   # tsc does not preserve the executable bit
npm link
```

`npm link` makes `forge` available globally, from any directory. Requires
Node 20+ (tested on Node 24).

```bash
forge --version
# 0.1.0
```

To remove it later: `npm unlink -g forge-terminal`.

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

```
$ forge
The interactive shell is not built yet. Use --to for now, or --help.
$ echo $?
2
```

Piped or non-interactive invocations get a slightly different hint and never
hang waiting for input:

```
$ forge | cat
Forge needs a file and a target format.
Try: forge photo.jpg --to webp
$ echo $?
2
```

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
└── index.ts              entry point: TTY detection, dispatches to execute()
```

**The invariant:** `core/` and `engines/` import no UI framework and never
write to stdout — everything they produce is data (`Job`, `Result`,
`ForgeError`, `RunEvent`). This is what keeps the engine testable without a
terminal, and it's also what a future interactive shell will consume without
the core changing at all. `src/index.ts` detects whether stdout is a TTY;
non-interactive invocations (piped, scripted, or no TTY) always resolve to
the CLI path and print a hint rather than blocking. See
[Roadmap](#roadmap) for the `shell/` directory this will grow once it exists
— it isn't there today.

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

117 tests, all passing. Fixtures (transparent PNGs, EXIF-rotated JPEGs,
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
  without `--to` rejection above.

## Roadmap

Not yet built, in rough order:

- **Interactive shell** (`forge` with no arguments, in a real terminal) —
  drop a file, pick a target from a derived menu, pick a destination, watch
  it convert, with inline pickers in the style of Claude Code / Codex CLI.
  Bare `forge` currently just says the shell isn't built yet and exits 2.
- **Compress action** — quality/size reduction without a format change;
  the reason `--quality` requires `--to` today.
- **Resize action.**
- **PDF and video engines** — Sharp can't do either; these will sit behind
  the same `Engine` interface `image.ts` implements now, so the CLI and
  format menu won't need to change to support them.

Explicitly out of scope for 0.1: HEIC encoding (the underlying library
can't), DOCX/PPTX/SVG output, MP4/MP3, recursive watch mode, config files,
presets.

## License

MIT
