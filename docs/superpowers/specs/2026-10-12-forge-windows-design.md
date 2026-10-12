# Forge — Windows port

**Date:** 2026-10-12
**Status:** design approved in conversation; spec awaiting review
**Branch:** `feat/windows-port` (from `dev`), worktree `.claude/worktrees/windows-port`
**Origin:** a read of every macOS dependency in the codebase, and the
platform binaries already present in `node_modules`. Nothing here has been
run on Windows yet; unverified claims are listed in §9.

---

## 1. Why, and the one hard rule

Forge installs only on macOS today (`package.json` `"os": ["darwin"]`). The
core — Sharp, PDFium (WASM), Ink — runs on Windows already. What blocks a
Windows build is a short list of places that call macOS directly.

**Hard rule: the Mac version must not change behaviour.** Mac and Windows
share one codebase. Every Windows difference is a branch beside the Mac code,
which stays as it is. "No change" is proven by tests written *before* the
Windows code (§7.1), and every merge needs the full Mac suite, typecheck and
lint green.

## 2. Scope

Everything ships in one release, because the owner has no Windows PC and will
hand a complete build to a tester.

| Feature | Windows |
| --- | --- |
| Image convert, compress, PDF, Word | yes (Word via LibreOffice when installed; npm fallback otherwise, as on Mac) |
| Copy, paste, open, show in folder | yes |
| HEIC | yes — optional extension (§5.3) |
| Boost resolution | yes — Windows build of the existing extension (§5.2) |
| Remove background | **no** — hidden on Windows (§5.4) |

Targets: Windows 10 and 11; x64 and arm64 (Sharp and ONNX Runtime both ship
win32 builds for both). Distribution stays `npm i -g forge-terminal`.

Terminals: **Windows Terminal gets the full experience** (mouse, OSC 8 links,
native glyphs). **The classic console works** with the plain fallbacks that
unrecognised Mac terminals already get. Forge never refuses to start in
either.

Cost rule: neither the owner nor a user pays anything. This rules out
Windows' own HEIC codecs (the HEVC add-on is paid on many PCs).

Out of scope: inline photo previews in Windows Terminal (Forge speaks the
iTerm2 and kitty image protocols; Windows Terminal speaks neither — sextant
previews are used, as on other terminals); Git Bash / MSYS path forms
(`/c/Users/...`); remove background on Windows (§10).

## 3. Approach

**Platform branches beside the Mac code, in the same file.** Each
OS-specific function takes the platform as a parameter defaulting to
`process.platform` — the pattern `revealLabel(platform)` in
`src/shell/reveal.ts` already uses. Two reasons:

1. The Mac branch is the existing code, untouched in place.
2. The Windows branch can be exercised by tests on a Mac by passing
   `'win32'`. The owner has no Windows PC; this is the first line of testing.

Rejected: a `src/platform/` adapter folder (moves working Mac code — the
change the hard rule exists to avoid); separate per-OS packages (two things
to publish and keep in step, for a few hundred lines of Windows code).

Invariant 1 holds: Windows branches in `core/` and `engines/` return data and
never write to stdout.

## 4. Core swaps

| Concern | File | Mac (unchanged) | Windows |
| --- | --- | --- | --- |
| Install rule | `package.json` | — | `"os": ["darwin", "win32"]` |
| Copy | `src/shell/clipboard.ts` | `pbcopy` | `clip.exe`, fed UTF-16LE with a BOM (so non-ASCII survives) |
| Paste | `src/shell/clipboard.ts` | `pbpaste` | `powershell.exe -NoProfile -NonInteractive -Command` setting `[Console]::OutputEncoding` to UTF-8, then `Get-Clipboard -Raw` |
| Open | `src/shell/reveal.ts` | `open <path>` | `explorer.exe <path>` |
| Show in folder | `src/shell/reveal.ts` | `open -R <path>` | `explorer.exe /select,<path>`; `revealLabel('win32')` → "Show in Explorer" |
| LibreOffice | `src/engines/word.ts` | PATH, then `/Applications/LibreOffice.app/...` | PATH, then `%ProgramFiles%\LibreOffice\program\soffice.exe`, then `%ProgramFiles(x86)%\...` |
| Settings root | `src/config/preferences.ts`, `src/extensions/paths.ts` | `$XDG_CONFIG_HOME` else `~/.config` | `$XDG_CONFIG_HOME` else `%APPDATA%` |
| Dropped paths | `src/utils/unescape-path.ts` | strip quotes, else remove backslash escapes | strip surrounding quotes **only**; backslashes are separators |
| Terminal detection | `src/shell/glyphs.ts`, `src/shell/mouse.ts`, `src/shell/hyperlink.ts` | as today | `WT_SESSION` set ⇒ Windows Terminal: native glyphs, SGR mouse, OSC 8 |
| Desktop / Downloads | `src/core/actions/destination.ts` | `~/Desktop`, `~/Downloads` | real locations from `HKCU\...\Explorer\User Shell Folders` via `reg.exe query`, env vars expanded; falls back to `%USERPROFILE%\Desktop` / `\Downloads`. Handles OneDrive-redirected Desktops. Looked up once, cached. |
| HEIC decode | `src/engines/heic.ts` | `/usr/bin/sips` | the `heic` extension (§5.3) |
| HEIC missing error | `src/core/errors.ts` | "ships with macOS at /usr/bin/sips" | "Install it with: forge extensions add heic" / shell: "Open /extensions to install it." |

Notes:

- `explorer.exe` exits 1 even on success. The Windows branch does not treat
  its exit code as failure; only a spawn error is.
- The settings-root logic is duplicated today in `preferences.ts` and
  `extensions/paths.ts`. Both gain the same Windows branch through one shared
  `configBase(platform, env)` helper; on Mac it returns exactly today's value.
- The two path forms in `src/utils/unescape-path.ts` cannot both apply: on
  Windows a backslash is a separator, so escape removal would corrupt
  `C:\Users\...`. The Windows branch is strictly `platform === 'win32'`. This
  is the change most able to break Mac drag-and-drop, so §7.1 locks the Mac
  cases first.

**Shared changes with identical Mac results:**

- File names. Seven sites take a name with `path.split('/').pop()`:
  `src/core/actions/compress.ts:70,118`, `src/core/actions/destination.ts:16`,
  `src/shell/stage.ts:71`, `src/shell/components/StagedFiles.tsx:59,140`,
  `src/shell/components/FileCard.tsx:31`. They become `basename()` from
  `node:path`, which on darwin returns the same string.
- Atomic rename (invariant 6). On Windows, antivirus and the search indexer
  briefly hold new files, so `rename` can fail with `EPERM`/`EBUSY`/`EACCES`.
  A `renameAtomic(from, to, platform)` in `src/core/atomic.ts` retries those
  codes on win32 only (5 attempts, backoff to ~1 s total) and is a plain
  `rename` on darwin. Used by `core/atomic.ts`, `engines/image.ts`'s
  `writeAtomic`, and the extension installer's directory rename.
- Signals. `src/shell/useMouse.ts` listens for SIGINT/SIGTERM/SIGHUP and
  re-raises with `process.kill(process.pid, signal)`. On Windows SIGINT and
  SIGHUP (console close) are emulated by libuv, and re-raising SIGHUP throws
  ENOSYS. So on win32 the re-raise (`reraise` in `useMouse.ts`) is wrapped:
  if `process.kill` throws, the process exits with the status the signal
  would have given (SIGHUP 129, SIGINT 130, SIGTERM 143) — the cleanup has
  already run. Unit-tested with an injected `kill`; not exercised on the
  Windows runner. There is no SIGTSTP handling to change.

## 5. Extensions

### 5.1 The catalogue learns operating systems

`src/extensions/catalog.ts` keys assets by chip only and assumes macOS
(`minMacos`; `manager.ts` returns "extensions need macOS" off darwin). It
changes to:

```ts
type PlatformKey =
  | 'darwin-arm64' | 'darwin-x64' | 'darwin-universal'
  | 'win32-x64' | 'win32-arm64' | 'win32-universal'

interface CatalogAsset {
  version: string        // per asset, was per entry
  url: string
  bytes: number
  sha256: string
}

interface CatalogEntry {
  id: ExtensionId        // gains 'heic'
  title: string
  summary: string
  minMacos?: number      // darwin assets only
  assets: Partial<Record<PlatformKey, CatalogAsset>>
  licence: string
}
```

Existing Mac assets move to `darwin-arm64` / `darwin-universal` with their
**exact** URLs, sizes, SHA-256s and version (1.0.0). Lookup order on a
machine: `<os>-<arch>`, then `<os>-universal`.

Listing rules (`manager.ts`):

- An entry with **no asset for this OS** is not listed at all. That hides
  remove-background on Windows and heic on Mac.
- An entry with assets for this OS but **not this chip** is listed as
  unsupported with today's reason — so an Intel Mac still sees boost with
  "no build for x64 Macs", exactly as now.
- `updateAvailable` compares the installed version with **this platform's
  asset** version. A Windows-only Boost bump never prompts a Mac user.

The Enhance rows (`src/shell/enhance.ts`) and the MCP tools
(`src/mcp/tools.ts`) offer an extension's operation only where the catalogue
lists it for this OS. `forge extensions add remove-background` on Windows
fails with "Remove background is not available on Windows."

Installer hardening for Windows: tar entry names are already rejected when
they start with `/` or contain a `..` segment split on `/`
(`manager.ts:139`). On Windows a backslash is also a separator, so entries
containing `\` or a drive prefix (`C:`) are rejected too — on every
platform, since no legitimate archive has them.

### 5.2 Boost on Windows

- Same model (`realesr-general-x4v3`), same runner. `extensions/boost/runner.ts`
  `openModel` picks providers by platform: darwin keeps
  `[coreml, cpu]`; win32 uses `[dml, cpu]` (DirectML), with the same
  catch-and-fall-back-to-CPU shape and a stderr note.
- `onnxruntime-node` already ships `bin/napi-v6/win32/{x64,arm64}/` with
  `onnxruntime_binding.node`, `onnxruntime.dll`, `DirectML.dll`,
  `dxcompiler.dll`, `dxil.dll` (~60 MB unpacked for x64, measured). So the
  Windows archive is packaged on the existing macOS CI runner:
  `extensions/boost/build.mjs` gains `--platform darwin|win32` and copies the
  matching directory. On Windows the DLLs sit beside the `.node` file, which
  is where Node's addon loader resolves dependents from.
- Version: Windows assets are **boost 1.1.0**; the Mac asset stays 1.0.0 and
  is not rebuilt (§5.1 per-asset versions).
- No GPU ⇒ CPU. Slower, but the working screen already shows only a spinner
  and clock for extension work (invariant 7).

### 5.3 HEIC extension (Windows only)

- `extensions/heic/` — a Node runner bundling `libheif-js`'s WASM build
  (LGPL-3.0). Kind `node`, run by the existing `runExtension` as a child
  process, so WASM memory is released when it exits.
- Contract:
  - `--info --in <file>` → JSON on stdout `{ width, height, hasAlpha }`, read
    from the container without decoding pixels.
  - `--in <file> --out <file>` → decodes the primary image and writes raw
    RGBA, plus JSON `{ width, height }` on stdout.
- `src/engines/heic.ts` on win32: `heicDecodable()` = heic extension
  installed; `heicInfo()` = `--info`; `decodeHeic()` = run the extension,
  then Sharp wraps the raw RGBA (`{ raw: { width, height, channels: 4 } }`)
  into the temporary PNG the rest of the pipeline already expects. Nothing
  downstream changes.
- Orientation: libheif applies the container's `irot`/`imir` during decode,
  so the pixels are upright and carry no EXIF. Invariant 4 (`.rotate()`
  first) is unaffected.
- Archive `forge-ext-heic-1.0.0-universal.tar.gz` (WASM is chip-independent),
  catalogue key `win32-universal`, release tag `ext-heic-v1.0.0`.
- `NOTICES.txt`: libheif and libde265 licence texts, and a link to the
  libheif-js source — LGPL compliance. The WASM stays a separate file.

### 5.4 Remove background

Not on Windows (no Apple Vision). Hidden per §5.1. Revisiting it means
testing int8-quantised versions of the stronger models against the
2026-10-11 seven-image set, under the 50 MB / 100 MB size rule — separate
work.

## 6. Errors

No new error codes beyond the reworded HEIC hint (§4) and the "not available
on Windows" refusal for remove-background (§5.1), which reuses
`extension-missing`'s shape with its own wording. Every Windows failure maps
to an existing `ForgeError` code.

## 7. Testing

### 7.1 Lock the Mac first

Before any Windows code, add tests that pin today's darwin behaviour:

- clipboard runs `pbcopy` / `pbpaste`; reveal runs `open` / `open -R`;
  `revealLabel('darwin')` unchanged;
- `heic.ts` runs `/usr/bin/sips`; the HEIC error hint names sips;
- `unescapePath` on darwin: `My\ Photo.jpg`, quoted paths, `~`, `~/x`;
- settings root: `~/.config/forge`, and `XDG_CONFIG_HOME` honoured;
- catalogue on darwin-arm64 / darwin-x64: same entries listed, same assets,
  same URLs and hashes, same "no build for x64 Macs" reason, no
  `updateAvailable` for an installed 1.0.0 boost.

These pass on the current code, and must still pass after every change.

### 7.2 Windows branches, on the Mac

Each Windows branch gets unit tests run with `platform = 'win32'`: the
commands and arguments built, quote stripping, `%APPDATA%` resolution,
`reg.exe` output parsing, `explorer.exe` exit-code handling, the rename
retry, catalogue filtering for win32-x64 / win32-arm64.

### 7.3 Real Windows, on GitHub Actions

`forge-terminal` is public, so standard runners cost nothing.

- New `.github/workflows/test.yml`: matrix `macos-14` and `windows-latest`,
  on every push and pull request — `npm ci`, typecheck, lint, test.
- Existing tests that assume POSIX (`/tmp/...` literals, `/` joins) are
  fixed in the **tests**, not the app. Tests that need `sips` already skip
  without it.
- A small committed HEIC fixture (made once on a Mac with `sips` from a
  synthetic image) so the Windows job can exercise the heic extension.
- `extensions.yml` gains a `windows-latest` verify job: install the freshly
  built win32 boost and heic archives, boost a fixture image, convert the
  HEIC fixture. Runners have no GPU, so this covers the CPU fallback; the
  DirectML path is covered by the human tester (§7.4).

The header-bar test (`tests/shell/header-bar-app.test.tsx`) fails
intermittently under full-suite load on the Mac (passes alone). Noted, not in
scope.

### 7.4 Human tester

`docs/windows-test-checklist.md`: install with npm; drop in a JPG, PNG, PDF,
Word file and HEIC photo (installing the heic extension when asked); boost an
image; copy and open a result; show in Explorer; repeat once in the classic
console. Records the Windows version, terminal and chip, and what to send
back on failure.

## 8. Release

- Forge **0.3.0** on npm. Mac users see no behaviour change.
- `ext-boost-v1.1.0` (win32-x64, win32-arm64) and `ext-heic-v1.0.0`
  (win32-universal), following the existing `extensions.yml` process:
  archives are kept, published with `gh release create`, and CI never
  replaces a published asset.
- Merge order per CLAUDE.md: `feat/windows-port` → `dev` → `main`, each only
  when green.

## 9. Unverified — confirm on the Windows runner first

1. `onnxruntime_binding.node` finds `onnxruntime.dll` / `DirectML.dll` beside
   it when loaded from the extension directory.
2. DirectML session creation on a GPU-less runner either works (WARP) or
   throws so the CPU fallback runs — not a hang.
3. Windows Terminal and the classic console paste a dropped path quoted when
   it contains spaces, and unquoted otherwise.
4. `clip.exe` with UTF-16LE + BOM round-trips non-ASCII through
   `Get-Clipboard`.
5. `libheif-js` decodes an iPhone HEIC (grid-tiled, with `irot`) correctly
   and reads `--info` without a full decode.
6. Ink raw mode and SGR mouse behave in Windows Terminal; the classic
   console degrades without garbage output.

Each is a test or a CI step in §7; any that fails is fixed before the
release, or the feature it supports is cut and this spec updated.

## 10. Later

- Remove background on Windows (§5.4).
- Inline photo previews via sixel, which Windows Terminal supports.
