# Forge — extensions, boost resolution and remove background

**Date:** 2026-10-11
**Status:** design approved in conversation; spec awaiting review
**Origin:** two measured spikes on an Apple M2 (16 GB), macOS 27, Node 26:
remove-background (`/tmp/rembg-review/`) and boost (`/tmp/boost-bench/`), plus
a web survey of GitHub, Hugging Face and OpenModelDB. Numbers below are
measured unless marked *(est.)*.

---

## 1. Why

Two features people currently pay AI credits for in Figma: **Boost
resolution** (make a small image bigger *and* sharper) and **Remove
background**. Forge can do both on-device, free, in well under a second.

They do not belong in the core install. Boost needs ONNX Runtime, whose npm
package is **287 MB** (every platform's binaries); the darwin-arm64 part alone
is **~45 MB**. Shipping that to every user would undo the 0.2 work that took
the install from 188 MB to 33 MB. So both features are **extensions**: listed
by Forge, downloaded only when asked for, removable.

PDF stays in core. After 0.2 the PDF stack is ~12–15 MB of the 33 MB install;
moving it out is not worth the friction (lean-and-fast spec §2).

## 2. What was chosen, and why

### 2.1 Remove background — Apple Vision

`VNGenerateForegroundInstanceMaskRequest` (macOS 14+), called by a tiny Swift
helper.

| | Apple Vision | Best small ONNX (U²-Net-p 4.4 MB, MODNet 6–25 MB) |
| --- | --- | --- |
| Model download | **0** (part of macOS) | 4–25 MB |
| Per image (≈2 MP) | **60–100 ms** (0.8 s first call) | ~450 ms |
| Peak memory | **176 MB** | ~650 MB |
| Quality on the 7-image set | clean on portrait, long-haired cat, dog in grass, mug, sneakers (3 subjects), wine glass; picked the monument in a night scene | washed-out partial masks; mug removed entirely |

Larger models (IS-Net 170 MB, BiRefNet 109–214 MB, BEN2 209 MB) are excluded
by the size rule (§3) and needed 3–14 GB of RAM.

### 2.2 Boost resolution — Real-ESRGAN general x4v3

`realesr-general-x4v3` (SRVGG "Compact", BSD-3), 4.6 MB ONNX, run by ONNX
Runtime with the **CoreML execution provider**.

Figma documents Boost resolution only as "enhance the clarity of
low-resolution images"; a Figma plugin that replicates it locally offers 2×/4×
with a ~5 MB model — the same class as this one. Measured, 300 px → 1200 px
(4×):

| | |
| --- | --- |
| Time per image | **0.1–0.2 s** (CoreML EP); CPU EP is ~20× slower and is not used |
| Peak memory | ~400 MB |
| Quality vs Lanczos 4× | text and edges far crisper (sign legible, watch digits sharp); faces crisp with the usual AI smoothing of skin texture; cannot invent detail a heavily blurred photo never had |

Rejected, with reasons recorded so they are not re-proposed:

| Candidate | Why not |
| --- | --- |
| 2×Public RealPLKSR (30 MB), 1×DeJPG RealPLKSR (28 MB) | 3.5–8 s per 256 px tile; 5–7 GB peak under CoreML |
| 1×GaterV3 sharpen (fp16 43.5 MB / fp32 86 MB) | fp16 file does not load in ONNX Runtime; it is a same-size sharpener, not a resolution booster |
| NAFNet, Restormer, MPRNet, CodeFormer, most OpenModelDB "focus" models | over 100 MB, or non-commercial / AGPL / unlicensed |
| Any Apple built-in | none exists as a public API (Core Image has only classical sharpen; MetalFX is a game render-pipeline scaler) |

## 3. Constraints

- **Size:** a model is ideally < 50 MB; 100 MB is the hard ceiling. A whole
  extension download should stay under 100 MB.
- **An idle Forge holds no model memory** — in the CLI, the shell and
  `forge mcp`.
- **Jobs run one at a time.** No two extension jobs run concurrently (the spike
  that ran models in parallel froze the machine).
- **Base install growth ≈ 0.** The catalogue, the manager and the glue live in
  the existing bundle as lazy chunks; no new runtime `dependencies`.
- CLAUDE.md invariants 1–7 hold. In particular: capabilities come from what is
  installed (2); EXIF `.rotate()` first (4); alpha is kept when the target can
  carry it (5); writes are atomic (6); progress is real (7).
- Licences: everything shipped or downloaded is commercial-safe and
  redistributable (Real-ESRGAN BSD-3; ONNX Runtime MIT; the helper is ours).
  Third-party notices are added to the extension and to Forge's licence output.

## 4. Extensions

### 4.1 What an extension is

A versioned directory under the Forge data root, produced from a release asset:

```
~/.config/forge/extensions/          (XDG_CONFIG_HOME respected, as configPath() does)
  boost/
    1.0.0/
      manifest.json        id, version, files, sha256 of each
      runner.mjs           bundled: onnxruntime-node JS + tiling + IO
      onnxruntime_binding.node
      libonnxruntime.1.dylib
      realesr-general-x4v3.onnx
      NOTICES.txt
      cache/               CoreML compiled-model cache (ModelCacheDirectory)
    current -> 1.0.0       (or a `current` file; whichever is atomic on rename)
  remove-background/
    1.0.0/
      manifest.json
      forge-cutout         universal (arm64 + x86_64), signed
      NOTICES.txt
```

### 4.2 The catalogue is compiled into Forge

`src/extensions/catalog.ts` lists each extension Forge knows: id, title, one
line of description, version, minimum macOS, per-architecture asset URL, byte
size and SHA-256. Forge never downloads a catalogue and never runs anything
that is not in it. `forge extensions` works offline.

A Forge release that changes an extension's version ships the new catalogue
entry; `forge extensions` then reports "update available" and `add` installs
it. Old versions are removed after the new one is in place.

### 4.3 Hosting and integrity

- Assets are attached to GitHub Releases on `AtharvaN16/forge-terminal`, tagged
  `ext-<id>-v<version>`, one asset per architecture (`darwin-arm64`,
  `darwin-x64`; remove-background is one universal asset).
- Download with Node's `fetch` (honours `HTTPS_PROXY` via the environment where
  Node supports it; otherwise a clear error naming the proxy).
- The archive's SHA-256 is checked against the catalogue **before** extraction;
  each extracted file is checked against `manifest.json`. Any mismatch deletes
  the download and fails with `extension-corrupt`.
- Install is atomic: download to a temp file in the extensions directory,
  extract into `<id>/.staging-<random>/`, verify, then rename to
  `<id>/<version>/` and update `current`. A failure at any step leaves the
  previous state untouched and no partial directory behind.
- Disk space is checked before download (needed ≈ 2.5 × archive size).

### 4.4 macOS execution — to verify first

The interrupted spike did not finish this. The implementation plan's first
task proves, on this machine, with files written by Node's `fetch`:

1. whether `com.apple.quarantine` is set (expected: no);
2. that an ad-hoc-signed arm64 helper built in CI runs when downloaded;
3. that a downloaded `.node` addon + dylib load via `dlopen` from the extension
   directory (rpath / `@loader_path`).

If any fails, the fix (e.g. `codesign --force -s -` at install, stripping an
xattr) is added to the installer and recorded in this spec.

### 4.5 Running a job — always a child process

Each extension job is one short-lived child process, so its memory is returned
the moment it ends:

- **boost:** `process.execPath <ext>/runner.mjs` — the same Node that runs
  Forge, with the extension's own ONNX Runtime. Input and output are file
  paths; one JSON line on stdout reports dimensions and timing; errors go to
  stderr as one JSON line with a code.
- **remove-background:** `<ext>/forge-cutout <in> <out.png>` — same contract.
- A queue in the parent runs one job at a time. Cancellation (esc / Ctrl-C /
  MCP cancel) kills the child; the atomic writer means nothing partial is left.
- Inputs are prepared by Forge's existing pipeline first (EXIF rotate, decode
  HEIC via the existing path) into a temp PNG, so extensions only ever read
  PNG and invariants 4/5 stay in one place. Outputs are written to a temp path
  and moved into place by Forge's atomic writer.

### 4.6 Managing extensions

**CLI**

```
forge extensions                    list: id, installed version or "not installed", size, one-line description
forge extensions add <id>           install or update
forge extensions remove <id>        delete it
forge extensions --json            the list as data
```

Download progress on a TTY is a byte-based percentage (the size is known from
the catalogue, so it is real — invariant 7); without a TTY, nothing until the
result.

**Shell:** `/extensions` opens a screen listing each extension with size,
state and a key to install, update or remove. The visual design follows the
current shell redesign (picker band, hints) and is drawn by the redesign's
components; this spec fixes behaviour, not look.

## 5. The two features

### 5.1 Boost resolution

- **CLI:** `forge photo.jpg --boost` (2×) or `--boost 4`. Output beside the
  source as `photo-2x.png` / `photo-4x.png` unless `-o` or `--to` says
  otherwise; `--to` may be any writable format (alpha flattened only if the
  target cannot carry it).
- **2×** is produced by running the 4× model and Lanczos-downscaling each tile
  by 2 (the measured approach); there is no separate 2× model.
- **Alpha:** the RGB goes through the model; the alpha channel is upscaled with
  Lanczos and re-joined.
- **Tiling:** 256 px tiles, 16 px overlap, per-tile assembly into the output;
  memory independent of image size except the output buffer itself.
- **Limits:** output larger than 16,384 px on a side, or over 100 MP, is refused
  before running with a reason and the largest factor that fits.
- **Shell:** an action "Boost resolution" in the action list for images, with a
  2× / 4× choice; shown as available-to-install when the extension is absent.

### 5.2 Remove background

- **CLI:** `forge photo.jpg --remove-bg`. Output `photo-cutout.png`; `--to
  webp`/`avif`/`tiff` allowed (alpha-capable); a format that cannot carry
  alpha is refused, because flattening would undo the operation.
- **No subject found:** a failure with code `no-subject` and a hint, not an
  empty transparent file.
- **macOS < 14:** the extension is listed as "requires macOS 14" and `add`
  refuses.
- **Shell:** an action "Remove background" for images.

### 5.3 Discovery for agents and machines

Installed extensions contribute actions to `actionsFor()` — so `forge probe`,
`--json` results, and MCP see them. Not installed → absent, never offered.

- `--json` results gain `op: "boost"` / `op: "remove-background"`.
- MCP: `forge_convert` gains optional `boost: 2 | 4` and `removeBackground:
  true`, validated against what is installed; a call that asks for an absent
  extension is a tool error with code `extension-missing` and a hint naming the
  install command. (No new tools — the five-tool surface stays.)
- `SKILL.md` and the README document both, including `forge extensions add`.

### 5.4 New error codes

`extension-missing`, `extension-corrupt`, `extension-unsupported` (OS or
architecture), `extension-download-failed`, `no-subject`, `boost-too-large`.
All per-file or per-command refusals exit **1**; malformed arguments exit **2**
(the existing rule).

## 6. Building the extensions (CI)

A GitHub Actions workflow on a macOS runner, triggered by an `ext-*` tag:

- **remove-background:** `swiftc` for arm64 and x86_64, `lipo` into a
  universal binary, ad-hoc sign, tar + manifest + SHA-256, upload.
- **boost:** for each architecture, take `onnxruntime-node`'s
  `bin/napi-v6/darwin/<arch>/` files (binding + dylib), the pinned model file
  (by URL + SHA-256 from upstream Real-ESRGAN, converted to ONNX by a committed
  script), and the bundled `runner.mjs`; tar + manifest + SHA-256, upload.
- The workflow prints the archive SHA-256s; the matching catalogue entry is
  committed in the same release PR, so code and assets cannot drift.

## 7. Testing

- **Manager:** install, update, remove, corrupt archive, wrong hash, disk-full
  simulation, interrupted download, offline list — against a local HTTP fixture
  server serving a tiny fake extension (no network in tests).
- **Child-process contract:** a fake runner that echoes, exits non-zero, hangs
  (cancel kills it), and writes garbage (rejected).
- **Features:** tests that need the real extension are skipped unless it is
  installed (`FORGE_TEST_EXTENSIONS=1`), so CI without them still passes; with
  it: a 64 px PNG boosted to 128/256 px with alpha kept; a cutout of a fixture
  with a clear subject has transparent corners and an opaque centre;
  `no-subject` on a flat grey image.
- **Memory:** a test asserts the shell/MCP process does not load
  `onnxruntime` (module-load hook, as lazy-load tests do), proving models only
  ever live in children.
- **By hand before release:** `forge extensions add` both on this Mac, boost
  and cut out the spike images, compare with `/tmp/boost-bench/x4-*.jpg` and
  `/tmp/rembg-review/v2-*.jpg`.

## 8. Out of scope

- An `x86_64` boost build beyond producing the asset (CoreML on Intel is
  untested; CPU fallback is too slow — the extension may be marked arm64-only
  if the Intel asset is not acceptably fast).
- Video, face restoration, a same-size "sharpen" mode, third-party or
  user-supplied extensions.
- Remote catalogue updates without a Forge release.

## 9. Order

1. §4.4 execution checks (a spike inside the plan; decides installer details).
2. Extension manager + catalogue + CLI `forge extensions` (with a fake
   extension).
3. Remove background (small; proves the child-process contract end to end).
4. Boost (runner, tiling, CoreML cache, size limits).
5. Shell `/extensions` screen and actions; `--json`/probe/MCP/SKILL.md.
6. CI workflow and the first real release assets.
