# Extensions, boost and remove background — implementation plan

**Spec (binding):** docs/superpowers/specs/2026-10-11-forge-extensions-design.md. Read it and CLAUDE.md first.
**Integration branch:** `feat/extensions` (worktree `../forge-ext`), from `dev` at e213b53. Every task works in its own worktree branched from it; the controller merges.
**Process (user's instructions):** parallel subagents in separate worktrees; one final whole-branch review only (no per-task review loop); don't get stuck in test loops; **every test must earn its place** — test behaviour a user or agent depends on and the failure modes the spec names, not implementation details, not trivia. Prefer a few strong tests over many weak ones.

## §4.4 execution checks — DONE (controller, 2026-10-11)

On this Mac (M2, macOS 27, Node 26):
- A file written by Node `fetch` gets `com.apple.provenance` only — **no `com.apple.quarantine`**. No xattr stripping needed.
- `swiftc` output is `adhoc,linker-signed`; a universal (x86_64+arm64) helper copied to another directory runs. No extra `codesign` needed for a locally built or CI-built binary (CI still ad-hoc signs explicitly after `lipo`).
- `onnxruntime_binding.node` links `@rpath/libonnxruntime.1.dylib`; copied together into another directory, `process.dlopen` loads it. Keep the two files side by side.

## Global constraints

- Another session is actively redesigning the interactive shell (`src/shell/**`). Only Task W2b touches `src/shell/`, and only to add the `/extensions` screen and two actions using existing components. Nobody else edits `src/shell/`.
- Heavy runs: never run models from two agents at once. Only Task W1c runs ONNX models; check `sysctl vm.swapusage` before each run and stop if swap > 3 GB; tile 256, at most 2 threads on CPU; CoreML EP for the real runs.
- `package.json` `dependencies` stays exactly `sharp` + `@hyzyla/pdfium`. Anything new for the payload builds is a devDependency or lives in `extensions/<id>/` build tooling.
- Lazy loading holds: nothing in `src/extensions/` is imported by `--version`/`--help`/plain conversions (tests/cli/lazy-load.test.ts and the bundle tests guard this). `onnxruntime` is never imported by the Forge process itself.
- Commits: conventional style, ending `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Gate before your final commit: `npx biome check --write src tests scripts`, `npm test`, `npm run typecheck`, `npm run lint`.

## Shared contracts (all tasks code against these exactly)

### Repository layout
```
extensions/                      payload sources + build scripts (not bundled into Forge)
  boost/
    runner.ts                    child-process entry (bundled to runner.mjs by its build)
    build.mjs                    node extensions/boost/build.mjs --arch arm64|x64 --out <dir>
    model.json                   { url, sha256, bytes, licence } of the ONNX model
  remove-background/
    forge-cutout.swift
    build.sh                     extensions/remove-background/build.sh <outdir>   (universal binary)
scripts/package-extension.mjs    node scripts/package-extension.mjs <id> <version> <arch|universal> <payloadDir> <outDir>
                                 → <outDir>/forge-ext-<id>-<version>-<arch>.tar.gz, prints JSON {asset, bytes, sha256}
src/extensions/
  catalog.ts                     the compiled-in catalogue
  paths.ts                       extensionsRoot(), installedDir(id)
  manager.ts                     list / install / remove
  run.ts                         one-at-a-time child-process runner
.github/workflows/extensions.yml
```

### Payload (inside the tarball, top level)
```
manifest.json   { "id", "version", "arch", "files": { "<relpath>": "<sha256>" }, "entry": "<relpath>", "kind": "node" | "exec" }
NOTICES.txt
boost:              runner.mjs (entry, kind "node"), onnxruntime_binding.node, libonnxruntime.1.dylib, realesr-general-x4v3.onnx
remove-background:  forge-cutout (entry, kind "exec")
```

### Child-process contract (both extensions)
- boost:  `node <dir>/runner.mjs --in <png> --out <png> --scale 2|4 [--cache <dir>]`
- remove-background: `<dir>/forge-cutout <in> <out.png>` (one pair)
- Input is always a PNG prepared by Forge (EXIF-rotated, decoded). Output is a PNG at a temp path Forge chose.
- Success: exit 0, ONE JSON line on stdout: `{"ok":true,"width":N,"height":N,"ms":N}`.
- Failure: exit non-zero, ONE JSON line on stdout: `{"ok":false,"code":"no-subject"|"boost-too-large"|"runtime-error","message":"…"}`. stderr is free-form diagnostics.
- The runner never writes anywhere except `--out` and `--cache`.
- (The existing spike helper prints a different JSON shape; W1b updates it to this contract.)

### TypeScript interfaces (src/extensions/)
```ts
// catalog.ts
export type ExtensionId = 'boost' | 'remove-background'
export interface CatalogAsset { url: string; bytes: number; sha256: string }
export interface CatalogEntry {
  id: ExtensionId; title: string; summary: string; version: string
  minMacos: number                       // major version, e.g. 14
  assets: Partial<Record<'arm64' | 'x64' | 'universal', CatalogAsset>>
  licence: string                        // one line, shown by `forge extensions`
}
export const CATALOG: readonly CatalogEntry[]
export function catalogEntry(id: string): CatalogEntry | undefined

// paths.ts
export function extensionsRoot(): string     // <configDir>/forge/extensions, honours XDG_CONFIG_HOME like configPath()
export interface Installed { id: ExtensionId; version: string; dir: string; entry: string; kind: 'node' | 'exec' }
export async function installed(id: ExtensionId): Promise<Installed | undefined>   // reads `current` + manifest; undefined if absent/invalid

// manager.ts
export interface ExtensionStatus { entry: CatalogEntry; installed?: string; updateAvailable: boolean; supported: boolean; reason?: string; downloadBytes?: number }
export async function listExtensions(): Promise<ExtensionStatus[]>
export async function installExtension(id: string, opts?: { onProgress?: (done: number, total: number) => void; signal?: AbortSignal; fetchImpl?: typeof fetch }): Promise<Installed>
export async function removeExtension(id: string): Promise<boolean>

// run.ts
export interface ExtensionJobResult { width: number; height: number; ms: number }
export async function runExtension(ext: Installed, args: string[], opts?: { signal?: AbortSignal }): Promise<ExtensionJobResult>   // queued: one at a time per process; throws ForgeError with the child's code
```

### Errors (src/core/errors.ts — W1a adds ALL of these, others only use them)
`extension-missing`, `extension-corrupt`, `extension-unsupported`, `extension-download-failed`, `no-subject`, `boost-too-large` — with constructor functions `extensionMissing(id)`, `extensionCorrupt(id, detail)`, `extensionUnsupported(id, reason)`, `extensionDownloadFailed(id, detail)`, `noSubject(path)`, `boostTooLarge(path, maxScale)`. Hints name the CLI command (`forge extensions add <id>`) and give a `shellHint` for the shell.

## Waves

**Wave 1 (parallel, separate worktrees):**
- **W1a Manager + CLI** — catalog.ts (entries with placeholder URLs/sha256 marked `TODO-RELEASE` until W3), paths.ts, manager.ts, the error codes, `forge extensions [add|remove] [--json]` (args.ts subcommand like `probe`; execute.ts branch; text + JSON output; real byte progress on TTY via onProgress → stderr in index.ts). Tests: against a local `http.createServer` fixture serving a tiny tarball: install happy path, sha mismatch → extension-corrupt and nothing left behind, interrupted download → nothing left, update replaces old version, remove, offline list, unsupported macOS/arch.
- **W1b Remove-background payload + runner contract + run.ts** — `extensions/remove-background/{forge-cutout.swift,build.sh}` per the contract (start from `/tmp/spike-rembg/swift/forge-cutout.swift`), `src/extensions/run.ts` (spawn, one-at-a-time queue, JSON-line parse, abort kills child, maps codes to ForgeErrors). Tests: run.ts against a tiny fake runner script (success, error JSON, garbage output, hang → abort). One real test of forge-cutout gated on `process.platform === 'darwin'` and `swiftc` present: build it, cut out a generated fixture with a clear subject → transparent corners, opaque centre; flat grey → `no-subject`.
- **W1c Boost payload** — `extensions/boost/{runner.ts,build.mjs,model.json}`. Runner: CoreML EP with `ModelCacheDirectory` = `--cache`, CPU fallback, 256 px tiles / 16 px overlap, 4× model, 2× by per-tile Lanczos ½, alpha upscaled separately and re-joined, refuse > 16384 px side or > 100 MP with `boost-too-large`. Model source: find a reproducible ONNX of `realesr-general-x4v3` with a **dynamic** input (or a committed conversion script `extensions/boost/convert.py` from the upstream `.pth`, pinned by sha256) — record the decision. Build: bundle runner.ts with esbuild (onnxruntime-node JS + its onnxruntime-common inlined; native files copied beside it), fetch model by URL + sha256. Run it for real on the spike images (one at a time, swap check) and save before/after crops to `/tmp/ext-boost-check/` for the final review.
- **W1d Packaging + CI** — `scripts/package-extension.mjs` (deterministic tar.gz: sorted entries, fixed mtimes; writes manifest.json with per-file sha256; prints asset JSON) and `.github/workflows/extensions.yml` (macos runner; on tag `ext-<id>-v<version>`: build payload(s) via the two build scripts, package, upload to the GitHub Release; prints sha256s). Test: package-extension produces a byte-identical archive twice and a manifest that verifies.

**Wave 2 (after wave 1 merges):**
- **W2a Wire the features into Forge (non-shell)** — `--boost [2|4]` and `--remove-bg` in args.ts; job ops `boost` / `remove-background`; actions in `src/core/actions/` that apply only to images AND only when the extension is installed (capability from installed state — invariant 2); prepare input PNG via existing pipeline (rotate first, HEIC path), run via run.ts, move output via atomic writer; naming `-2x`/`-4x`/`-cutout`; refusals per spec §5 (remove-bg to a no-alpha target refused); `--json` ops; probe lists them when installed; MCP `forge_convert` `boost` / `removeBackground` with `extension-missing` tool errors; SKILL.md + README sections. Tests: CLI with a fake installed extension (fixture runner) end to end — output naming, missing-extension message + exit 1, remove-bg to JPEG refused, alpha kept on boost; lazy-load test proves `--version` and plain conversions don't load src/extensions; module-load test proves the Forge process never loads onnxruntime.
- **W2b Shell** — `/extensions` screen (list, install with real progress, remove) and the two actions in the shell's action list with an install offer when absent. Use the redesign's existing components and patterns (read recent `git log -- src/shell` first). Keep it small. Tests: one ink test for the screen's list + install flow with a fake manager; one for the action offering install when absent.

**Wave 3:** W3 — real release: build both payloads locally, package, record real sha256/bytes in catalog.ts (URLs to the release tag), dry-run install from a local file server, end-to-end boost + cutout through the installed extensions. Publishing the GitHub Release is the human's call (the controller asks first).

**Then:** one final whole-branch review (most capable model) → one fix wave → done.
