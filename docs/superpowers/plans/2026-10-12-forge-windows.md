# Forge Windows Port Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Forge installs and runs on Windows 10/11 from the same codebase, with HEIC and Boost as Windows extensions, and no behaviour change on macOS.

**Architecture:** Platform branches beside the existing Mac code, in the same file. Every OS-specific function takes `platform` as a parameter defaulting to `process.platform`, so the Windows branch is unit-testable on a Mac. The extension catalogue becomes OS-aware; a new `heic` extension (libheif-js WASM) decodes HEIC on Windows; Boost gains a DirectML build.

**Tech Stack:** Node ≥20, TypeScript, Vitest, Ink, Sharp, onnxruntime-node, libheif-js, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-10-12-forge-windows-design.md` — read it first.

## Execution rules (owner's instructions)

- Tasks 1–7 run **in parallel**, in one worktree. Each task owns a disjoint set of files (listed per task). **Never edit a file another task owns.** If you need something from another task's file, use the interface given in this plan and accept a temporary type error.
- **Every test has to earn its place.** Pin Mac behaviour that the change could break, and test each Windows branch once. No exhaustive matrices, no snapshot tests, no tests of trivial getters.
- Run **only your own test files** (`npx vitest run <files>`). Never the full suite — seven agents share one machine. Do not loop: if a test fails twice for a reason outside your files, stop and report it.
- Commit with `git add <your files>` then `git commit`. Never `git add -A`, `git stash`, `git reset`, or `git checkout` of others' files. On `index.lock` errors, wait 3 s and retry.
- Commit messages: conventional style as in `git log` (`feat(windows): …`), ending with the line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- No per-task review; one whole-branch review at the end.

## Global Constraints

- **The Mac version must not change behaviour.** The darwin branch is the existing code, left in place.
- `core/` and `engines/` import no React/Ink/Chalk and never write to stdout (invariant 1).
- Writes are atomic: temp file, then rename (invariant 6).
- Progress is never fabricated (invariant 7).
- Neither the owner nor users pay anything (no paid codecs).
- Extension models/downloads: under 100 MB.
- Windows targets: Windows 10 and 11, x64 and arm64.
- Windows Terminal is detected by the `WT_SESSION` environment variable.

## Review Focus

1. A Mac user dropping `My\ Photo.jpg` (backslash-escaped) still gets `My Photo.jpg` — pinned in Task 3.
2. On a OneDrive-redirected Windows Desktop, "Save to Desktop" writes to the real Desktop, not a newly created `C:\Users\x\Desktop` — Task 3.
3. A Mac with boost 1.0.0 installed sees no "update available" after the catalogue gains Windows assets — Task 5.
4. A malicious extension archive with an entry like `..\..\evil.dll` is rejected on every platform — Task 5.
5. `explorer.exe` exiting with code 1 on success is not reported as a failure — Task 2.

---

### Task 1: CI on Windows, tester checklist

**Files:**
- Create: `.github/workflows/test.yml`
- Create: `docs/windows-test-checklist.md`

**Interfaces:** none consumed or produced.

- [ ] **Step 1:** (Done by the controller before dispatch: `"os": ["darwin", "win32"]` and `libheif-js` devDependency are already committed. Do not touch `package.json`.)
- [ ] **Step 2:** Create `.github/workflows/test.yml`:

```yaml
name: test
on:
  push:
    branches: [dev, main, 'feat/**']
  pull_request:
jobs:
  test:
    strategy:
      fail-fast: false
      matrix:
        os: [macos-14, windows-latest]
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
      - run: npm ci
      - run: npm run typecheck
      - run: npm run lint
      - run: npm test
```

- [ ] **Step 3:** Create `docs/windows-test-checklist.md` for a non-developer tester. Sections: *Before you start* (install Node.js LTS from nodejs.org; open Windows Terminal; `npm i -g forge-terminal`; `forge --version`), *Try these* (numbered: run `forge`, drop in a JPG and convert to PNG; a PNG to WebP; compress a JPG; a PDF to images; a Word file to PDF — note whether LibreOffice is installed; a HEIC photo from an iPhone — accept the extension install when asked; Boost resolution 2× on a small photo — note roughly how long it took; press `c` to copy a result path and paste it into Notepad; open a result; Show in Explorer), *Then once in the old console* (Win+R → `conhost.exe`, repeat steps 1–2), *What to send back* (Windows version from `winver`, which terminal, PC model / chip, a screenshot of anything wrong, the exact text of any error).
- [ ] **Step 4:** Commit.

---

### Task 2: Clipboard, open/reveal, terminal glyphs

**Files:**
- Modify: `src/shell/clipboard.ts`, `src/shell/reveal.ts`, `src/shell/glyphs.ts`
- Test: `tests/shell/clipboard.test.ts`, `tests/shell/reveal.test.ts`, `tests/shell/glyphs.test.ts` (create or extend; check what exists first)

**Interfaces — Produces:**

```ts
// clipboard.ts
export function copy(text: string, platform: NodeJS.Platform = process.platform): void
export function paste(platform: NodeJS.Platform = process.platform): string
// reveal.ts
export async function openPath(path: string, platform: NodeJS.Platform = process.platform): Promise<void>
export async function revealPath(path: string, platform: NodeJS.Platform = process.platform): Promise<void>
export function revealLabel(platform: string = process.platform): string // win32 → 'Show in Explorer'
```

- [ ] **Step 1: Pin Mac.** Tests with `vi.mock('node:child_process')`: `copy('x', 'darwin')` runs `pbcopy`; `paste('darwin')` runs `pbpaste`; `openPath(p,'darwin')` runs `open [p]`; `revealPath(p,'darwin')` runs `open ['-R', p]`. Run — they pass on current code once the `platform` param exists (add the param first, ignored).
- [ ] **Step 2: Windows tests (failing).**
  - `copy('héllo', 'win32')` runs `clip.exe` and writes `Buffer.concat([Buffer.from([0xff,0xfe]), Buffer.from('héllo','utf16le')])` to stdin.
  - `paste('win32')` runs `powershell.exe` with args `['-NoProfile','-NonInteractive','-Command','[Console]::OutputEncoding=[Text.Encoding]::UTF8; Get-Clipboard -Raw']`, and strips one trailing `\r\n`.
  - `revealPath('C:\\a\\b.png','win32')` runs `explorer.exe ['/select,C:\\a\\b.png']` and **resolves** when execFile fails with a numeric exit `code: 1`; it **rejects** when the error `code` is `'ENOENT'`. Same exit-code rule for `openPath` (`explorer.exe [path]`).
  - `revealLabel('win32') === 'Show in Explorer'` (update any existing test asserting `'Show location'`).
- [ ] **Step 3: Implement.** In each function: `if (platform === 'win32') { …new code… }` before the existing Mac body, which stays byte-for-byte. Keep the fire-and-forget/`catch` shape of `copy` and the `maxBuffer`/`timeout` of `paste`. For explorer, wrap `run` in a helper that swallows errors whose `code` is a number.
- [ ] **Step 4: Glyphs.** In `glyphs.ts`, both `slantedChips` and `trueColour` also return true when `env.WT_SESSION !== undefined && env.WT_SESSION !== ''` (after the FORGE_*/NO_COLOR checks, so overrides still win). One test: `slantedChips({ WT_SESSION: 'x' })` and `trueColour({ WT_SESSION: 'x' })` are true. Mouse and OSC 8 already detect Windows Terminal through `supports-hyperlinks` — no change there.
- [ ] **Step 5:** Run your three test files. Commit.

---

### Task 3: Paths — dropped paths, settings root, known folders, basenames

**Files:**
- Modify: `src/utils/unescape-path.ts`, `src/config/preferences.ts`, `src/extensions/paths.ts` (only `extensionsRoot`), `src/core/actions/destination.ts`, `src/core/actions/compress.ts` (lines ~70, ~118 only), `src/shell/stage.ts` (line ~71), `src/shell/components/StagedFiles.tsx` (lines ~59, ~140), `src/shell/components/FileCard.tsx` (line ~31)
- Create: `src/config/config-base.ts`, `src/utils/known-folders.ts`
- Test: `tests/utils/unescape-path.test.ts`, `tests/config/config-base.test.ts`, `tests/utils/known-folders.test.ts` (extend existing files where they exist)

**Interfaces — Produces:**

```ts
// src/config/config-base.ts
export function configBase(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): string
// XDG_CONFIG_HOME (non-empty) wins everywhere. Else darwin/linux: join(homedir(), '.config').
// Else win32: env.APPDATA (non-empty) ?? join(homedir(), 'AppData', 'Roaming').

// src/utils/known-folders.ts
export type KnownFolder = 'Desktop' | 'Downloads'
export function knownFolder(
  name: KnownFolder,
  platform: NodeJS.Platform = process.platform,
  query: (valueName: string) => string | undefined = regQuery,
): string
// darwin/linux: join(homedir(), name) — exactly today's value.
// win32: registry value from HKCU\Software\Microsoft\Windows\CurrentVersion\Explorer\User Shell Folders
//   Desktop → value 'Desktop'; Downloads → value '{374DE290-123F-4565-9164-39C4925E467B}'.
//   Expand %VAR% from process.env. Fallback: join(homedir(), name). Cached per name.
export function resetKnownFoldersForTests(): void

// src/utils/unescape-path.ts
export function unescapePath(raw: string, platform: NodeJS.Platform = process.platform): string
```

- [ ] **Step 1: Pin Mac (`unescapePath`).** `unescapePath('My\\ Photo.jpg','darwin') === 'My Photo.jpg'`; `unescapePath("'/a b/c.png'",'darwin') === '/a b/c.png'`; `unescapePath('~/x','darwin') === join(homedir(),'x')`. Must pass on current code (add the ignored param first).
- [ ] **Step 2: Windows tests (failing).** `unescapePath('"C:\\My Files\\a.png"','win32') === 'C:\\My Files\\a.png'`; `unescapePath('C:\\Users\\a.png','win32') === 'C:\\Users\\a.png'` (backslashes kept).
- [ ] **Step 3: Implement** a `platform === 'win32'` branch: trim, strip one matched pair of surrounding `"` or `'`, no escape processing; `~` handling identical to Mac.
- [ ] **Step 4: `configBase`.** Tests: darwin with `{}` env → `join(homedir(),'.config')`; darwin with `XDG_CONFIG_HOME:'/x'` → `'/x'`; win32 with `{ APPDATA: 'C:\\Users\\a\\AppData\\Roaming' }` → that value. Implement. Then `configPath()` in `preferences.ts` becomes `join(configBase(), 'forge', 'config.json')` and `extensionsRoot()` in `extensions/paths.ts` becomes `join(configBase(), 'forge', 'extensions')` — both still read env at call time. Run the existing preferences and extensions-path tests to confirm Mac is unchanged.
- [ ] **Step 5: `knownFolder`.** `regQuery(valueName)` runs `execFileSync('reg.exe', ['query', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\User Shell Folders', '/v', valueName], { encoding: 'utf8', timeout: 2000 })` and parses the line `    <name>    REG_EXPAND_SZ    <value>` (also `REG_SZ`); returns undefined on any error. Tests: darwin → `join(homedir(),'Desktop')`; win32 with a fake `query` returning `'%USERPROFILE%\\OneDrive\\Desktop'` and `USERPROFILE` set → expanded path; win32 with `query` returning undefined → `join(homedir(),'Desktop')`. One parser test on a real `reg query` output sample.
- [ ] **Step 6: Wire it in.** `destination.ts`: replace both `join(homedir(), 'Desktop')` with `knownFolder('Desktop')` and both `join(homedir(), 'Downloads')` with `knownFolder('Downloads')`. `preferences.ts` `expandTilde`: on win32 only, `'~/Desktop'` → `knownFolder('Desktop')` and `'~/Downloads'` → `knownFolder('Downloads')` before the generic rule (the default preference is `'~/Desktop'`; without this a OneDrive Desktop gets a new empty `C:\Users\x\Desktop`). Give `expandTilde` a `platform = process.platform` param.
- [ ] **Step 7: Basenames.** Replace each `x.split('/').pop()` that takes a file name (`compress.ts` ×2, `destination.ts:16`, `stage.ts:71` — delete its local `basename` const and import from `node:path`, `StagedFiles.tsx` ×2, `FileCard.tsx`) with `basename(x)` from `node:path`, keeping each site's existing `?? fallback`/`|| fallback`. Note `basename('')` is `''`, so `|| path` fallbacks still work. No new tests: darwin `basename` equals the old expression; existing tests for these files cover it — run them.
- [ ] **Step 8:** Run your test files plus `tests/config`, `tests/core/actions`. Commit.

---

### Task 4: Atomic rename retry, LibreOffice on Windows

**Files:**
- Modify: `src/core/atomic.ts`, `src/engines/image.ts` (only the `rename` inside its own `writeAtomic`), `src/engines/word.ts` (only `resolveSofficePath` and the constant beside it)
- Test: `tests/core/atomic.test.ts`, `tests/engines/word.test.ts` (extend)

**Interfaces — Produces:**

```ts
// src/core/atomic.ts
export async function renameAtomic(
  from: string,
  to: string,
  platform: NodeJS.Platform = process.platform,
  wait: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
): Promise<void>
// darwin/linux: await rename(from, to) — nothing else.
// win32: up to 5 attempts; retry only on EPERM, EBUSY, EACCES; waits 50, 100, 200, 400 ms; then rethrow the last error.
export function sofficeCandidates(platform: NodeJS.Platform, env: NodeJS.ProcessEnv): string[] // in word.ts
```

- [ ] **Step 1: Tests (failing).** `renameAtomic` with `vi.mock('node:fs/promises')`: win32, rename fails `EBUSY` twice then succeeds → resolves, 3 calls, `wait` called with 50 then 100; win32 with `ENOENT` → rejects after 1 call; darwin with `EBUSY` → rejects after 1 call.
- [ ] **Step 2: Implement** `renameAtomic`; use it in `writeAtomic` in `core/atomic.ts` and in `engines/image.ts`'s `writeAtomic`. The extension installer (`src/extensions/manager.ts`, owned by Task 5) will import it.
- [ ] **Step 3: LibreOffice.** `sofficeCandidates('darwin', env)` → `['/Applications/LibreOffice.app/Contents/MacOS/soffice']` (today's `CASK_SOFFICE_PATH`); `sofficeCandidates('win32', env)` → `[join(env.ProgramFiles ?? 'C:\\Program Files', 'LibreOffice', 'program', 'soffice.exe'), join(env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)', 'LibreOffice', 'program', 'soffice.exe')]` using `path.win32.join`. `resolveSofficePath` tries `soffice` on PATH (unchanged), then each candidate for `process.platform` in order. Two tests: the darwin list equals today's path; the win32 list for a given env.
- [ ] **Step 4:** Run your test files plus the existing `tests/engines/word*` and `tests/core/atomic*`. Commit.

---

### Task 5: OS-aware extension catalogue

**Files:**
- Modify: `src/extensions/catalog.ts`, `src/extensions/manager.ts`, `src/shell/enhance.ts` (only `enhanceRows`), `src/engines/extension.ts` (only the top of `run`), `scripts/package-extension.mjs`, plus any other file that reads `entry.version` or `entry.minMacos` (grep; adjust those reads only)
- Test: `tests/extensions/catalog.test.ts`, `tests/extensions/manager.test.ts` (extend existing)

**Interfaces — Produces (Tasks 6 and 7 rely on these exact names):**

```ts
// src/extensions/catalog.ts
export type ExtensionId = 'boost' | 'remove-background' | 'heic'
export type PlatformKey = `${'darwin' | 'win32'}-${'arm64' | 'x64' | 'universal'}`
export interface CatalogAsset { version: string; url: string; bytes: number; sha256: string }
export interface CatalogEntry {
  id: ExtensionId
  title: string
  summary: string
  /** Major macOS version; darwin assets only. */
  minMacos?: number
  assets: Partial<Record<PlatformKey, CatalogAsset>>
  licence: string
}
/** `${platform}-${arch}`, else `${platform}-universal`. */
export function assetFor(entry: CatalogEntry, platform?: NodeJS.Platform, arch?: string): CatalogAsset | undefined
/** Whether any asset exists for this OS. */
export function offeredOn(entry: CatalogEntry, platform?: NodeJS.Platform): boolean
export function offeredHere(id: ExtensionId, platform?: NodeJS.Platform): boolean
```

- [ ] **Step 1: Pin Mac (failing only because of the new shape).** For `darwin`/`arm64`: `listExtensions()` lists exactly `boost` and `remove-background` with today's URLs, bytes and sha256 (copy them from the current file), versions `1.0.0`; for `darwin`/`x64`: boost is listed unsupported with reason `no build for x64 Macs`; an installed boost 1.0.0 has `updateAvailable: false`. Make `listExtensions`/`supportFor` take `platform`/`arch` params defaulting to `process.*` so tests can pass them.
- [ ] **Step 2: Reshape the catalogue.** Move `version` into each asset; key existing assets as `darwin-arm64` (boost) and `darwin-universal` (remove-background) with **identical** url/bytes/sha256/version. Add the `heic` entry: `title: 'HEIC photos'`, `summary: 'Open iPhone photos (HEIC) on Windows'`, `assets: {}` (filled at release), `licence: 'libheif and libde265 (LGPL-3.0), via libheif-js'`. Move `assetFor` here from `manager.ts`.
- [ ] **Step 3: Manager.** `listExtensions` skips entries where `!offeredOn(entry, platform)`. `supportFor`: darwin keeps today's checks and wording; win32 → unsupported `no build for ${arch} PCs` when `assetFor` is undefined; any other OS → `extensions need macOS or Windows`. Everywhere `entry.version` was compared (installed vs catalogue, `verifyStaged`, `updateAvailable`, the early return in `installExtension`), use `assetFor(entry, …)?.version`. Replace the directory/`current` renames with `renameAtomic(from, to)` from `src/core/atomic.ts` (Task 4 produces it). Unsupported install throws `extensionUnsupported(id, reason)` as today; for an entry not offered on this OS the reason is `not available on Windows` / `not available on macOS`.
- [ ] **Step 4: Unsafe archive paths (Review Focus 4).** In `verifyStaged`, also reject a manifest path that contains `\` or matches `/^[A-Za-z]:/`. One test: a manifest listing `..\\evil.dll` is rejected.
- [ ] **Step 5: Windows tests.** For `win32`/`x64` with a test catalogue entry that has a `win32-x64` asset: listed and supported; `remove-background` not listed; `offeredHere('remove-background','win32') === false`.
- [ ] **Step 6: Callers.** `enhanceRows` omits the `cutout` row when `!offeredHere('remove-background')`. In `src/engines/extension.ts` `run`, before `installed(id)`: `if (!offeredHere(id)) throw extensionUnsupported(id, 'not available on this system')`. `scripts/package-extension.mjs`: `ENTRIES` gains `heic: { entry: 'runner.mjs', kind: 'node' }`; `ARCHES` becomes `['arm64','x64','universal','win32-x64','win32-arm64','win32-universal']` (the label goes into the file name `forge-ext-<id>-<version>-<label>.tar.gz` and the manifest's `arch`).
- [ ] **Step 7:** Run `tests/extensions`, `tests/shell/enhance*`, `tests/engines/extension*`. Commit.

---

### Task 6: HEIC extension for Windows

**Files:**
- Create: `extensions/heic/runner.ts`, `extensions/heic/build.mjs`, `tests/fixtures/heic/small.heic` (+ how it was made in `tests/fixtures/README.md`)
- Modify: `src/engines/heic.ts`, `src/core/errors.ts` (only `heicDecoderUnavailable`), `src/extensions/run.ts` (only `ExtensionJobResult` and its parsing)(`libheif-js` is already installed as a devDependency — do not touch `package.json`)
- Test: `tests/engines/heic.test.ts` (extend), `tests/extensions/heic-runner.test.ts`

**Interfaces — Consumes:** `installed('heic')` from `src/extensions/paths.ts` (returns `Installed | undefined`); `runExtension(ext, args, opts)` from `src/extensions/run.ts`; `ExtensionId` includes `'heic'` (Task 5). **Produces:**

```ts
// runner contract (extensions/heic/runner.ts → bundled runner.mjs)
//   node runner.mjs --info --in <file.heic>           stdout: {"width":W,"height":H,"hasAlpha":bool}
//   node runner.mjs --in <file.heic> --out <file.rgba> stdout: {"width":W,"height":H}
//   Exit non-zero with a one-line stderr message on failure, using the same failure
//   JSON shape boost's runner uses (read extensions/boost/runner.ts).
// src/extensions/run.ts
export interface ExtensionJobResult { width: number; height: number; ms: number; hasAlpha?: boolean }
// src/core/errors.ts
export function heicDecoderUnavailable(path: string, platform?: NodeJS.Platform): ForgeError
```

- [ ] **Step 1: Fixture.** On this Mac: make a 64×48 PNG with an RGB gradient via Sharp, convert with `sips -s format heic in.png --out tests/fixtures/heic/small.heic`. Commit it with a README line.
- [ ] **Step 2: Runner test (failing).** Build the runner into a temp dir with `node extensions/heic/build.mjs --out <tmp>`, run `node <tmp>/runner.mjs --info --in small.heic` → `{width:64,height:48}`; run decode → `.rgba` file of exactly `64*48*4` bytes. Runs on Mac too (WASM).
- [ ] **Step 3: Runner.** Use its `wasm-bundle` entry (WASM inlined). `HeifDecoder().decode(buffer)` → take the primary image (`is_primary()`, else first); `--info` reads `get_width()/get_height()` and alpha from the handle if libheif-js exposes it (else report `true` — a flatten of an opaque image is a no-op; say so in a comment); decode via `display({ data: new Uint8ClampedArray(w*h*4), width: w, height: h }, cb)` and write the bytes. libheif applies `irot`/`imir` during decode — confirm with a comment, not a test. `build.mjs` (model on `extensions/boost/build.mjs`): esbuild-bundle `runner.ts` to `runner.mjs` (ESM, node target), write `NOTICES.txt` with libheif-js's, libheif's and libde265's licence texts (from `node_modules/libheif-js`) and the line `Source: https://github.com/catdad-experiments/libheif-js`.
- [ ] **Step 4: Engine (`src/engines/heic.ts`).** Add `platform = process.platform` params. darwin: unchanged (sips). win32:
  - `heicDecodable()` → `(await installed('heic')) !== undefined`, **not cached** on win32 (an install mid-session must take effect).
  - `heicInfo(path)` → `runExtension(ext, ['--info','--in',path], { subject: path })` → `{ width, height, hasAlpha: hasAlpha ?? true }`.
  - `decodeHeic(source)` → temp dir; run `['--in', source, '--out', rgba]`; `sharp(rgba, { raw: { width, height, channels: 4 } }).png().toFile(png)` (Sharp via `loadSharp()` from `engines/libs.ts`); delete the rgba; return `{ path: png, cleanup }` where cleanup removes the temp dir.
  - `run.ts`: parse optional `hasAlpha` from the child's result JSON.
- [ ] **Step 5: Error wording.** `heicDecoderUnavailable(path, 'win32')`: detail `${basename(path)} is a HEIC photo, which needs Forge's free HEIC extension on Windows.`, short `HEIC needs the heic extension.`, hint `Install it with: forge extensions add heic`, shellHint `Open /extensions to install it.`; darwin wording unchanged. One test per platform on the hint.
- [ ] **Step 6: Engine test.** win32 with a temp `XDG_CONFIG_HOME` containing an installed heic extension (built runner + `manifest.json` + `current`; read `src/extensions/paths.ts` for the layout) → `decodeHeic(small.heic,'win32')` produces a 64×48 PNG. One darwin pin: `heicInfo` still calls `/usr/bin/sips` (skip if absent, as existing tests do).
- [ ] **Step 7:** Run your test files. Commit.

---

### Task 7: Boost on Windows, extension CI

**Files:**
- Modify: `extensions/boost/runner.ts` (only `openModel`), `extensions/boost/build.mjs`, `.github/workflows/extensions.yml`
- Test: `tests/extensions/boost-build.test.ts` (extend if exists, else create)

**Interfaces — Consumes:** `scripts/package-extension.mjs` labels `win32-x64`, `win32-arm64`, `win32-universal` and id `heic` (Task 5); `node extensions/heic/build.mjs --out <dir>` (Task 6).

- [ ] **Step 1: Providers.** `openModel`: `const preferred = process.platform === 'win32' ? ['dml'] : [{ name: 'coreml', coreMlFlags: 0 }]`; create with `[...preferred, 'cpu']`; on throw, stderr `DirectML unavailable, using CPU: …` / existing CoreML message, and retry with `['cpu']`. Darwin path identical to today.
- [ ] **Step 2: Build flags (test first).** `build.mjs` gains `--platform darwin|win32` (default `darwin`) and `--onnx <file>` (use this ONNX instead of converting the .pth; verify against the same pinned output sha256). For win32 copy `onnxruntime_binding.node` and every `*.dll` from `node_modules/onnxruntime-node/bin/napi-v6/win32/<arch>/` beside `runner.mjs`; add the DirectML licence text from the onnxruntime-node package to `NOTICES.txt` if it ships one (grep the package). Test: `--runner-only --platform win32 --arch x64 --out <tmp>` produces `runner.mjs`, `onnxruntime_binding.node`, `onnxruntime.dll`, `DirectML.dll`; darwin `--runner-only` output file list unchanged.
- [ ] **Step 3: `extensions.yml`.**
  - id `case` accepts `heic`; dispatch `options: [boost, remove-background, heic]`; tag trigger `ext-heic-v*`.
  - boost: after the darwin loop, for `arch in x64 arm64`: `node extensions/boost/build.mjs --platform win32 --arch "$arch" --onnx dist-ext/payload-arm64/realesr-general-x4v3.onnx --out "dist-ext/payload-win32-$arch"` and package with label `win32-$arch`.
  - heic: `node extensions/heic/build.mjs --out dist-ext/payload-win32-universal`, package label `win32-universal`.
  - `actions/upload-artifact@v4` the `dist-ext/payload-*` dirs.
  - New job `verify-windows` (`needs: package`, `runs-on: windows-latest`, `shell: bash`): checkout, setup-node 20, download the artifact, then for boost: `node dist-ext/payload-win32-x64/runner.mjs --in tests/fixtures/<a small PNG fixture> --out out.png --scale 2` and assert `out.png` exists; for heic: `node dist-ext/payload-win32-universal/runner.mjs --info --in tests/fixtures/heic/small.heic` prints width 64. Read the boost runner's actual CLI flags before writing this.
  - Verify-against-catalogue uses `shasum` — use `sha256sum` when `shasum` is missing (Windows job doesn't run it, but keep bash portable).
- [ ] **Step 4:** Run your test file. Commit.

---

### Task 8 (after 1–7; controller): integrate and go green

- [ ] Full Mac gate: `npm run typecheck && npm run lint && npm test`. Fix integration breaks in the owning task's files.
- [ ] Push `feat/windows-port` to `origin`; watch `test.yml` on `windows-latest`. Fix Windows-only failures — in **tests** when a test hard-codes POSIX paths, in the app when the app is wrong.
- [ ] Build the release archives locally (boost win32-x64/arm64 with `--onnx` from `~/Developer/forge-release-assets/ext-v1.0.0/` arm64 archive's model; heic win32-universal), fill the catalogue's Windows assets (boost `version: '1.1.0'`, heic `'1.0.0'`; bytes; sha256; URLs under `ext-boost-v1.1.0/` and `ext-heic-v1.0.0/`).
- [ ] Do **not** publish releases or npm without the owner's go-ahead.

### Task 9 (controller): final whole-branch review

- [ ] `superpowers:requesting-code-review` over `dev..feat/windows-port`, against the spec and the Review Focus list.
