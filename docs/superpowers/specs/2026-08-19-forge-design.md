# Forge — Design

**Date:** 2026-08-19
**Status:** Approved, ready for implementation planning
**Product name:** Convert · **Command:** `forge` · **Target version:** 0.1

---

## 1. What Forge is

A terminal-native file converter for macOS with two front ends over one core:

- a flag CLI for scripting and one-off use — `forge photo.jpg --to webp`
- an interactive shell for exploration — `forge`

Version 0.1 converts images. The architecture exists so that PDF, video, and
audio engines can be added later without touching the user interface.

---

## 2. Verified technical facts

These were measured on this machine, not assumed. They are load-bearing for
several decisions below.

Environment: macOS (Darwin 25.2.0), Node v24.2.0, npm 11.3.0, pnpm 10.12.3.
Nothing named `forge` or `convert` on PATH. Only Terminal.app installed.

Sharp 0.35.3 / libvips 8.18.3:

| Capability | Result |
| --- | --- |
| AVIF encode + decode | works |
| HEIC decode (real HEVC file from `sips`) | works |
| HEIC encode | **fails** — `heifsave: Unsupported compression` |
| GIF, TIFF, JPEG, PNG, WebP | read + write |
| SVG | read only |
| PDF | unavailable in the prebuilt binary |

Consequences: the MVP format matrix is achievable with the stock Sharp
binary — no custom libvips build, no `sips` shell-out. HEIC is decode-only,
which is all that was ever required. A future PDF engine cannot use Sharp.

Two failure modes were reproduced directly, and the fixes for them are
mandatory rather than optional:

```
transparent PNG → JPEG, no flatten : rgb(0,0,0)        ← wrong
transparent PNG → JPEG, w/ flatten : rgb(255,255,255)  ← correct

EXIF orientation=6 → PNG, no .rotate() : 40x80         ← wrong
EXIF orientation=6 → PNG, w/ .rotate() : 80x40         ← correct
```

---

## 3. Decisions

| Decision | Rationale |
| --- | --- |
| Command is `forge` | `convert` is ImageMagick's legacy binary name; Homebrew still installs it and one would silently shadow the other. Product remains "Convert". |
| Interactive mode is a chat-style shell, not a stepwise wizard | Matches the interaction model of Claude Code / Codex CLI, which is the stated reference. A wizard replaces the screen at each step; the shell keeps one screen with inline pickers. |
| File is selected first; the menu is derived from it | The set of valid targets depends on the source. Hardcoding a format list would have to be undone the moment PDF or video is added. |
| Single-file progress is indeterminate | Sharp exposes no progress callback for one image. Any percentage would be invented, which the requirements forbid. Batch progress is real. |
| Metadata stripped by default | Phone photos carry GPS coordinates. Silently republishing a home address in a converted file is the wrong default. `--keep-metadata` opts in. ICC profile is always preserved. |
| Biome instead of ESLint + Prettier | One dependency and one config doing both jobs. |
| No `--compress` in 0.1 | Deferred, but the action layer is shaped to accept it without restructuring. |

---

## 4. Architecture

```
src/
├── core/
│   ├── formats.ts        format registry, capability graph
│   ├── actions.ts        action registry, option schemas
│   ├── resolve.ts        paths / globs / directories → SourceInfo[]
│   ├── plan.ts           (sources, action, values) → Job[]   pure
│   ├── run.ts            executes jobs, bounded concurrency, emits events
│   ├── errors.ts         ForgeError taxonomy
│   └── format.ts         byte/percentage formatting helpers
│
├── engines/
│   ├── types.ts          Engine interface
│   └── image.ts          Sharp engine
│
├── cli/
│   ├── args.ts           Commander wiring → Intent
│   ├── execute.ts        non-interactive run
│   └── report.ts         stdout formatting
│
├── shell/
│   ├── App.tsx
│   ├── theme.ts
│   ├── hyperlink.ts      OSC 8 with graceful degradation
│   ├── components/       Prompt, Select, Slider, PathInput, Progress,
│   │                     FileCard, StatusLine, Hints, Divider
│   ├── blocks/           committed history entries
│   └── commands/         /convert /help /clear /quit
│
├── utils/
│   └── unescape-path.ts  shell-escaped drop → real path
│
└── index.ts              TTY detection → cli | shell
```

**The invariant:** `core/` and `engines/` import no React, no Ink, no Chalk,
and never write to stdout. Everything they produce is data. This is what
makes the core testable without a terminal and keeps the two front ends
consistent with each other.

---

## 5. Format registry and capability graph

```ts
type FormatId = 'jpeg' | 'png' | 'webp' | 'avif' | 'heic' | 'gif' | 'tiff'

interface FormatSpec {
  id: FormatId
  label: string          // 'WebP'
  extensions: string[]   // ['.webp']
  hasAlpha: boolean
  animatable: boolean
  lossy: boolean
  hint: string           // 'smaller, modern' — shown in the picker
}
```

Each engine declares `reads` and `writes` as sets. Targets are computed:

```ts
targetsFor(source: SourceInfo): Target[]
```

No component anywhere renders a hardcoded format list. The picker renders
whatever `targetsFor` returns. Adding an engine changes the menu everywhere
at once.

0.1 matrix (all via the Sharp engine):

- reads: `jpeg png webp avif heic gif tiff`
- writes: `jpeg png webp avif gif tiff`

GIF and TIFF go beyond the original brief. They are included because the
matrix is computed from what the engine can already do — excluding them would
cost code rather than save it.

so `heic` appears as a source only, which is correct and matches the
measured capability.

**Sources are probed by content, not by extension.** A `.jpg` file that is
really a PNG is common; trusting the extension means showing the wrong menu.
`sharp().metadata()` reads the container's magic bytes.

```ts
interface SourceInfo {
  path: string
  format: FormatId       // from content
  width: number
  height: number
  bytes: number
  hasAlpha: boolean
  frames: number         // > 1 means animated
  orientation?: number
}
```

---

## 6. Actions

The step after choosing a file is "what do you want to do", not "pick a
format". Version 0.1 registers one action, so the shell skips a menu of one
and proceeds directly to target selection.

```ts
type OptionSpec =
  | { kind: 'select'; id: string; label: string; choices: Choice[]; default: string }
  | { kind: 'slider'; id: string; label: string; min: number; max: number
                    ; step: number; default: number }
  | { kind: 'path';   id: string; label: string; default: string
                    ; presets: PathPreset[] }

interface Action {
  id: string                                   // 'convert'
  label: string
  hint: string
  appliesTo(s: SourceInfo): boolean
  options(s: SourceInfo): OptionSpec[]
  plan(s: SourceInfo, values: Record<string, unknown>): Job[]
}
```

The shell knows how to render exactly those three widget kinds. Version 0.1
needs all three regardless — target format is a select, quality is a slider,
destination is a path — so the schema costs nothing now and means a future
`compress` or `resize` action requires no new UI components.

---

## 7. Conversion core — correctness rules

Every rule below is applied by the image engine unconditionally unless a flag
opts out. Each corresponds to a real, user-visible defect.

1. **Auto-orient first.** `.rotate()` with no argument applies EXIF
   orientation and is called before any other operation. Without it, photos
   from phones come out sideways. *(Reproduced — see §2.)*

2. **Flatten alpha when the target cannot carry it.** If
   `source.hasAlpha && !targetSpec.hasAlpha`, apply
   `.flatten({ background })`, defaulting to white, overridable with
   `--background`. Without it, transparent pixels become black.
   *(Reproduced — see §2.)*

3. **Strip metadata by default, always keep ICC.** EXIF and GPS are removed
   unless `--keep-metadata`. The colour profile is preserved regardless, so
   colours do not shift on wide-gamut displays.

4. **Handle animation explicitly.** If `source.frames > 1`, decode with
   `{ animated: true }` when the target is animatable. Otherwise convert the
   first frame and attach a `Warning` to the result, surfaced to the user.
   Silently discarding animation is not acceptable.

5. **Bound concurrency.** Batches run `min(os.cpus().length, 4)` jobs at a
   time. Sharp dispatches to libuv's threadpool; unbounded dispatch thrashes.

Per-format encoder defaults: WebP q80, JPEG q82 with mozjpeg, AVIF q50,
PNG effort 7. Quality applies only to lossy targets — the slider is not shown
for PNG.

---

## 8. Safety

- **Atomic writes.** Output goes to a temp file in the destination directory
  and is renamed into place on success. A crash mid-encode can never leave a
  truncated file where a good one used to be. Temp files are cleaned up on
  failure.
- **No overwrite without consent.** CLI requires `--force`; the shell shows
  an inline choice — keep both (suffixes ` (1)`), replace, or cancel.
- **Never write over the input.** If the resolved output path is the input
  path, refuse with `output-is-input` unless `--force` is given, in which case
  the atomic rename makes it safe.
- **Directory scans are non-recursive by default,** with `--recursive` to opt
  in. Files that cannot be read are reported, not fatal — a batch continues
  and reports failures at the end.

---

## 9. CLI surface

```bash
forge <inputs...> --to <format> [options]

  -t, --to <format>        target format
  -o, --output <path>      file or directory
  -q, --quality <n>        1-100, lossy targets only
      --background <css>   fill colour when flattening alpha (default white)
      --keep-metadata      preserve EXIF/GPS
      --recursive          descend into subdirectories
      --force              allow overwrite
      --concurrency <n>    default min(cpus, 4)
      --debug              include stack traces
      --formats            print the capability matrix
  -V, --version
  -h, --help
```

Output resolution:

| Invocation | Result |
| --- | --- |
| `forge a.jpg --to webp` | `./a.webp` |
| `forge a.jpg --to webp -o ./dist/` | `./dist/a.webp` |
| `forge a.jpg --to webp -o ./dist/x.webp` | `./dist/x.webp` |
| `forge ./photos --to webp` | alongside each source |
| `forge ./photos --to webp -o ./dist/` | flattened into `./dist/` |

A trailing slash, or an existing directory, means directory. Otherwise an
explicit filename. Missing intermediate directories are created.

`--to` is required in 0.1; omitting it is an `invalid-arguments` error.
`--quality` without `--to` is reserved for the future compress action and is
rejected for now, so that the flag never changes meaning later.

With `--recursive` and `-o`, the source tree is recreated under the output
directory. Without `--recursive` only one directory level is scanned, so
results land flat and same-named files cannot collide.

Both glob forms work: unquoted `*.jpg` is expanded by the shell into
multiple arguments; quoted `"*.jpg"` is expanded internally by `tinyglobby`.

Success output:

```
✓ photo.jpg → photo.webp
  4.2 MB → 820 KB · 80.5% smaller
```

Batch output:

```
Converting 12 files
━━━━━━━━━━━━━━━━━━ 12/12

✓ 12 converted
  42.8 MB → 11.4 MB · 73.4% smaller

Output: ./dist/
```

Exit codes: `0` all succeeded · `1` some failed · `2` invalid arguments.

---

## 10. Interactive shell

Launched by bare `forge` **only when `process.stdout.isTTY`**. Piped or
non-interactive invocations print help and exit rather than hanging.

### Flow

```
drop file  →  probe by content
           →  action        (skipped while only one is registered)
           →  target        (derived from the source)
           →  options       (declared by the action)
           →  destination
           →  convert
           →  result + links
```

### Rendering

Committed history renders through Ink's `<Static>`; only the bottom region is
live. Without this, every keystroke re-renders the whole log, which flickers
and breaks the terminal's native scrollback.

```
  photo.jpg · 4.2 MB · JPEG 3024×4032

  Convert to
  ❯ WebP   smaller, modern
    PNG    lossless
    AVIF   smallest
  ↑↓ choose · ↵ confirm · esc back

 ╭────────────────────────────────────────╮
 │ › drop a file or type a path           │
 ╰────────────────────────────────────────╯
  /convert  /help  ↵ send
```

### Destination step

```
Save to
❯ Same folder      ~/Desktop/
  New subfolder    ~/Desktop/converted/
  Downloads        ~/Downloads/
  Type a path…

  → ~/Desktop/photo.webp
```

### Result

```
✓ photo.jpg → photo.webp
  4.2 MB → 820 KB · 80.5% smaller

  Open file · Reveal in Finder

  ↵ convert another · f open · o reveal · q quit
```

### Drag and drop

Dropping a file into a terminal pastes a shell-escaped path —
`/Users/you/My\ Photo.jpg`, sometimes single-quoted. `unescape-path.ts`
normalises backslash escapes, surrounding quotes, and `~`. This is the entire
mechanism; no drop-target API exists or is needed. Multiple paths pasted at
once are split on unescaped whitespace.

### Clickable links

`Open file` and `Reveal in Finder` are emitted as OSC 8 hyperlinks pointing at
`file://` URLs, detected via `supports-hyperlinks`. Supported by iTerm2,
Ghostty, WezTerm, Kitty, and the VS Code integrated terminal. **Terminal.app
does not support OSC 8** — there the literal `file://` URL is printed instead,
which Terminal.app makes cmd+clickable. The `f` and `o` keybindings perform
the same actions via `open(1)` and always work, so the feature never depends
on terminal capability.

---

## 11. Errors

```ts
type ErrorCode =
  | 'file-not-found'  | 'not-a-file'         | 'permission-denied'
  | 'unsupported-source' | 'unsupported-target' | 'corrupt-source'
  | 'output-exists'   | 'output-invalid'     | 'output-is-input'
  | 'empty-directory' | 'invalid-arguments'  | 'conversion-failed'

class ForgeError extends Error {
  code: ErrorCode
  title: string     // 'File not found'
  detail: string    // 'photo.jpg could not be found.'
  hint?: string     // 'Check the filename and try again.'
  cause?: unknown   // surfaced only under --debug
}
```

Node and Sharp errors are mapped at the engine boundary: `ENOENT` →
`file-not-found`, `EACCES`/`EPERM` → `permission-denied`, Sharp's
`Input buffer contains unsupported image format` → `corrupt-source`. A raw
stack trace never reaches the user without `--debug`.

Rendered identically in both front ends:

```
✕ File not found

  photo.jpg could not be found.

  Check the filename and try again.
```

`unsupported-target` is enriched by the capability graph:

```
✕ Can't convert photo.jpg to mp4

  photo.jpg is a JPEG image.

  Available: webp, png, avif, jpeg
```

---

## 12. Progress

- **Single file** — spinner plus the true current phase
  (`reading` → `decoding` → `encoding` → `writing`). No percentage, because
  Sharp cannot supply one.
- **Batch** — a real `n/total` bar driven by job completions, with live ✓/✕
  tallies.

`run.ts` emits `job:start`, `job:phase`, `job:done`, `job:error`, `batch:done`.
Both front ends subscribe to the same stream.

---

## 13. Responsiveness and accessibility

Three width bands: `< 60` compact (drop the box border and choice hints),
`60–100` normal, `> 100` wide (show full paths and dimensions). Content is
truncated with a middle ellipsis rather than wrapped; nothing overflows
horizontally. Width changes are observed by listening for `resize` on the stream returned
by Ink’s `useStdout()`.

Every status carries a symbol and a word — `✓ done`, `✕ failed`, `⚠ warning` —
so colour is never the sole carrier of meaning. Selected rows are marked with
`❯` and bold, not colour alone. `NO_COLOR` and non-TTY output are honoured.

---

## 14. Testing

Vitest. Fixtures are **generated by Sharp at test time**, never committed as
binaries.

**Engine** — the six pairs required by the brief (JPEG↔PNG, JPEG→WebP,
PNG→WebP, WebP→JPEG, WebP→PNG) plus HEIC→PNG/JPEG and AVIF→PNG/JPEG. The HEIC
fixture is produced with `sips`, which is present on macOS; the test skips
with a clear message if it is not.

**Regression tests pinning §7** — these encode the two reproduced defects:

- transparent PNG → JPEG yields white, not black, at pixel (0,0)
- a source with EXIF orientation 6 emerges with swapped dimensions
- an animated GIF → WebP retains frame count
- an animated GIF → PNG yields one frame *and* a warning

**Core** — output path resolution table from §9, capability graph
(`targetsFor`), glob and directory resolution, concurrency limiting, atomic
write leaves no temp file on failure.

**Errors** — one test per `ErrorCode`, asserting the mapping from the raw
cause and that no stack leaks without `--debug`.

**CLI** — argument parsing and exit codes.

The shell is exercised only for the pure pieces — `unescape-path`, width
banding, hyperlink degradation. The core carries the correctness burden and
needs no terminal.

---

## 15. Stack

Node 24 · TypeScript strict, ESM · React + Ink · Sharp 0.35.3 · Commander ·
tinyglobby · supports-hyperlinks · Vitest · Biome · npm.

Package exposes `bin: { forge: "./dist/index.js" }`. `npm link` makes `forge`
available globally. Scripts: `build`, `dev`, `test`, `lint`, `typecheck`.

---

## 16. Phasing

| Phase | Deliverable | Done when |
| --- | --- | --- |
| 1 | Skeleton | `forge --help`, `--version`, `--formats` run; lint/typecheck/test green |
| 2 | Core + engine | All §14 engine and regression tests pass |
| 3 | Flag CLI | Single, batch, globs, directories, all §9 output rules — **usable daily from here** |
| 4 | Shell | Full §10 flow end to end |
| 5 | Polish | Width bands, monochrome, keyboard, hyperlink degradation |
| 6 | Package | `npm link` → `forge` works from any directory; README |

Phase 3 is deliberately a usable product. No TUI work begins until the
conversion path is proven.

---

## 17. Out of scope for 0.1

Compress, resize, and every other action beyond convert. HEIC encoding
(Sharp cannot). PDF, DOCX, PPTX, SVG output, MP4, MP3. Recursive watch mode.
Config files. Presets. A wizard UI. Fake percentages.

---

## 18. What later versions plug into

- **A new engine** — one file in `engines/`, one registry entry. The format
  menu updates everywhere automatically because it is computed, not written.
- **A new action** — one entry in `actions.ts` declaring `OptionSpec[]`. No
  new UI components, because the shell already renders select, slider, and
  path.
- **PDF and video** will not use Sharp; the `Engine` interface is the seam
  that keeps that from mattering.
