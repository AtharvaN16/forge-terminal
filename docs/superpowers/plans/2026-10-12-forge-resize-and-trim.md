# Resize and Trim edges Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Trim edges and Resize (centred 0–200 % slider, `#` → exact W × H) as two always-ready rows in Enhance, plus `--trim` / `--resize` / `--width` / `--height` on the CLI and `trim` / `resize` on MCP `forge_convert`.

**Architecture:** Trim and resize are options on the existing `convert` job, applied in the image engine's shared `pipelineFor` right after EXIF rotation. Core owns the size arithmetic, limits, names and two `Action`s; CLI, MCP and the shell each plan through core.

**Tech Stack:** TypeScript (strict, `noUncheckedIndexedAccess`), Sharp 0.35, Ink + React, Commander, Zod (MCP), Vitest, Biome.

**Spec:** `docs/superpowers/specs/2026-10-12-forge-resize-and-trim-design.md` — read it first.

**Worktree:** `/Users/atharvanayak/Developer/Convert Terminal/.claude/worktrees/resize`, branch `feat/resize`. Always use absolute paths or `cd` into it in the same command; the shell's cwd resets.

## Global Constraints

- `core/` and `engines/` import no React/Ink/Chalk and never write to stdout (CLAUDE.md invariant 1).
- No hardcoded output-format list: the format comes from `targetIdsFor` via `keptFormat` (invariant 2).
- `.rotate()` stays the first Sharp operation (invariant 4); alpha flattened when the target cannot carry it (5); writes atomic (6); no fabricated progress (7).
- Slider: 0–200 %, 100 % centred, step 5, minimum 5 %. CLI `--resize` accepts 1–200.
- Limits: no side over 16,384 px (`BOOST_MAX_SIDE`), at most 100 MP (`BOOST_MAX_PIXELS`), every side ≥ 1 px.
- Names: `photo-trimmed.jpg`, `photo-<W>x<H>.jpg` (result size). CLI with trim **and** resize: `photo-trimmed-<spec>.jpg` where spec is `50pct` / `1200w` / `900h` (the trimmed size is unknown at plan time).
- Copy (exact strings): `Trim edges`, `Resize`, `empty edges off · `, `no empty edges`, `animated`, `Resize to`, `Exact size`, `smaller`, `same size`, `larger`, `same size · `, `becomes `, `stretched, so softer · Boost resolution adds detail`, `type an exact size`, `Trimming edges`, `Resizing`.
- Tests: each earns its place. No snapshot sprawl, no re-testing what another test already pins. Don't loop on flaky timing — if an Ink test is timing-sensitive, use the existing `until(...)` polling pattern from `tests/shell/enhance-flow.test.tsx`, and move on.
- Run Vitest under `caffeinate -i` for anything longer than a single file. Lint with `npx biome check <files>`, types with `npx tsc --noEmit -p .`.
- Commit only your own files (`git add <paths>`); other agents work in the same worktree. If `index.lock` exists, wait a second and retry.

## Review Focus

1. **Sideways phone photo** (EXIF orientation 6): every size shown and written is the upright one — the card, the slider's "becomes", the file. → Task 1 (probe returns upright size) + Task 1 engine test.
2. **Trim then resize by percent** (CLI `--trim --resize 50%`): percent is of the trimmed size. → Task 1 engine test.
3. **RGBA PNG resized, kept as PNG; HEIC resized → JPEG**: alpha kept for PNG, format rule holds. → Task 1 (`keptFormat` test) — HEIC needs sips, not tested.
4. **Exact width typed larger than the limit**: refused in the pair, never sent to the engine. → Task 3 (`exactFromWidth` + limit test).
5. **Animated GIF**: resize keeps frames; Trim row dimmed `animated`, CLI `--trim` refused. → Task 1 engine test.

---

### Task 1: Core + engine (sequential — everything else builds on it)

**Files:**
- Modify: `src/core/types.ts` (`ConvertOptions`, `ResizeSpec`, `WarningCode`)
- Create: `src/core/resize.ts`
- Create: `src/core/actions/resize.ts`
- Modify: `src/core/actions/index.ts` (export, add to `ACTIONS`)
- Modify: `src/core/errors.ts` (codes + constructors)
- Modify: `src/core/describe.ts` (verbs)
- Modify: `src/shell/enhance.ts` (import `keptFormat` from core instead of defining it)
- Modify: `src/engines/image.ts` (probe upright size; trim/resize in `pipelineFor`; `measureImage`)
- Test: `tests/core/resize.test.ts`, `tests/engines/resize-trim.test.ts`

**Interfaces — Produces (later tasks rely on these exact names):**

```ts
// src/core/types.ts
export type ResizeSpec = { percent: number } | { width: number } | { height: number }
// ConvertOptions gains:
  /** Trim transparent or solid-colour edges, after EXIF rotation. */
  trim?: boolean
  /** The output size, of the upright (and trimmed) image. */
  resize?: ResizeSpec
// WarningCode gains: | 'nothing-trimmed'

// src/core/resize.ts
export const RESIZE_MIN = 5
export const RESIZE_MAX = 200
export const RESIZE_STEP = 5
export interface Size { width: number; height: number }
export function resizedSize(from: Size, spec: ResizeSpec): Size
export function sizeOverLimit(size: Size): { side: number } | { megapixels: number } | undefined
export function keptFormat(source: ImageInfo): FormatId          // moved from shell/enhance.ts
export const sizeSuffix = (s: Size): string                       // "2016x1512"
export const specSuffix = (spec: ResizeSpec): string              // "50pct" | "1200w" | "900h"

// src/core/actions/resize.ts
export interface EditRequest {
  trim: boolean
  resize?: ResizeSpec
  target?: FormatId            // absent → keptFormat(source)
  output?: string
  roots?: Map<string, string>
  destination?: unknown        // shell Save as answers, via `answer()` like rotate.ts
  name?: unknown
  background: string
  keepMetadata: boolean
  quality?: number
}
export function planEdit(images: ImageInfo[], req: EditRequest): Job[]   // one convert job per image
export const trimAction: Action      // id 'trim', label 'Trim edges', verb 'Trimming edges'
export const resizeAction: Action    // id 'resize', label 'Resize', verb 'Resizing'

// src/core/errors.ts
code 'resize-too-large'   → resizeTooLarge(path: string, size: Size): ForgeError
code 'nothing-to-trim'    → nothingToTrim(path: string): ForgeError
code 'animated-trim'      → animatedTrim(path: string): ForgeError

// src/engines/image.ts
export interface ImageMeasure {
  upright: Size
  trimmed: Size | 'nothing' | 'animated'
}
export async function measureImage(source: ImageInfo): Promise<ImageMeasure>
```

- [ ] **Step 1: Write the failing core tests** — `tests/core/resize.test.ts`

```ts
import { describe, expect, it } from 'vitest'
import { planEdit } from '../../src/core/actions/resize.js'
import { keptFormat, resizedSize, sizeOverLimit, specSuffix } from '../../src/core/resize.js'
import type { ImageInfo } from '../../src/core/types.js'

const img = (over: Partial<ImageInfo> = {}): ImageInfo => ({
  kind: 'image', path: '/p/photo.jpg', format: 'jpeg', bytes: 1, width: 4032, height: 3024,
  hasAlpha: false, frames: 1, ...over,
})

describe('resizedSize', () => {
  it('scales by percent, keeps the shape from either side, and never goes under 1 px', () => {
    expect(resizedSize({ width: 4032, height: 3024 }, { percent: 50 })).toEqual({ width: 2016, height: 1512 })
    expect(resizedSize({ width: 4032, height: 3024 }, { width: 1200 })).toEqual({ width: 1200, height: 900 })
    expect(resizedSize({ width: 4032, height: 3024 }, { height: 1080 })).toEqual({ width: 1440, height: 1080 })
    expect(resizedSize({ width: 4000, height: 10 }, { percent: 5 })).toEqual({ width: 200, height: 1 })
  })
})

describe('sizeOverLimit', () => {
  it('refuses past 16,384 px a side or 100 MP', () => {
    expect(sizeOverLimit({ width: 16_384, height: 6000 })).toBeUndefined()
    expect(sizeOverLimit({ width: 16_385, height: 10 })).toEqual({ side: 16_385 })
    expect(sizeOverLimit({ width: 12_000, height: 9000 })).toEqual({ megapixels: 108 })
  })
})

describe('planEdit', () => {
  it('keeps the format, names by the result size, and carries the options', () => {
    const [job] = planEdit([img()], { trim: false, resize: { percent: 50 }, background: '#fff', keepMetadata: false })
    expect(job).toMatchObject({ op: 'convert', target: 'jpeg', outputs: ['/p/photo-2016x1512.jpg'], options: { resize: { percent: 50 } } })
    const [trim] = planEdit([img({ format: 'heic', path: '/p/IMG.heic' })], { trim: true, background: '#fff', keepMetadata: false })
    expect(trim).toMatchObject({ target: 'jpeg', outputs: ['/p/IMG-trimmed.jpg'], options: { trim: true } })
    const [both] = planEdit([img()], { trim: true, resize: { width: 1200 }, background: '#fff', keepMetadata: false })
    expect(both?.outputs).toEqual(['/p/photo-trimmed-1200w.jpg'])
  })

  it('keeps PNG for an image with alpha', () => {
    expect(keptFormat(img({ format: 'png', hasAlpha: true }))).toBe('png')
    expect(specSuffix({ percent: 50 })).toBe('50pct')
  })
})
```

- [ ] **Step 2: Run, expect FAIL** — `cd "$WT" && npx vitest run tests/core/resize.test.ts` (module not found).

- [ ] **Step 3: Implement core.** `src/core/resize.ts`:

```ts
import { targetIdsFor } from './capabilities.js'
import { BOOST_MAX_PIXELS, BOOST_MAX_SIDE } from './extension-targets.js'
import type { FormatId, ImageInfo, ResizeSpec } from './types.js'

/**
 * Resize (spec 2026-10-12): the size arithmetic, the limits and the names.
 * Pure. The slider's range is here so the shell, the CLI and the tests agree.
 */
export const RESIZE_MIN = 5
export const RESIZE_MAX = 200
export const RESIZE_STEP = 5

export interface Size {
  width: number
  height: number
}

const px = (n: number) => Math.max(1, Math.round(n))

/** The size `spec` gives `from`, the shape always kept. */
export function resizedSize(from: Size, spec: ResizeSpec): Size {
  if ('percent' in spec) {
    return { width: px((from.width * spec.percent) / 100), height: px((from.height * spec.percent) / 100) }
  }
  if ('width' in spec) return { width: px(spec.width), height: px((from.height * spec.width) / from.width) }
  return { width: px((from.width * spec.height) / from.height), height: px(spec.height) }
}

/** Boost's limits, for a size rather than a scale. */
export function sizeOverLimit(size: Size): { side: number } | { megapixels: number } | undefined {
  const side = Math.max(size.width, size.height)
  if (side > BOOST_MAX_SIDE) return { side }
  const pixels = size.width * size.height
  if (pixels > BOOST_MAX_PIXELS) return { megapixels: Math.round(pixels / 1e6) }
  return undefined
}

/**
 * What Sharpen, Boost, Trim and Resize write: the source's own format where
 * the image engine writes it, else JPEG for a HEIC (it cannot be written),
 * else PNG.
 */
export function keptFormat(source: ImageInfo): FormatId {
  if (source.format === 'heic') return 'jpeg'
  return targetIdsFor(source).includes(source.format) ? source.format : 'png'
}

export const sizeSuffix = (s: Size): string => `${s.width}x${s.height}`

export const specSuffix = (spec: ResizeSpec): string =>
  'percent' in spec ? `${spec.percent}pct` : 'width' in spec ? `${spec.width}w` : `${spec.height}h`
```

(Check `boostOverLimit` in `src/core/extension-targets.ts`; if it already does exactly this for scale 1, make `sizeOverLimit` call it instead of duplicating.)

`src/core/actions/resize.ts` — follow `rotate.ts` (Save as answers via `answer()` / `placeOutput`) and `extension.ts` (`suffixedImagePath`, `roots`). Suffix: `trim && resize` → `trimmed-${specSuffix}`; `resize` only → `sizeSuffix(resizedSize(source, resize))`; `trim` only → `trimmed`. `trimAction`/`resizeAction`: `appliesTo` = every source is an image; `unavailable` = `'images only'`; `options` = `[]` (the shell asks its own questions); `plan(sources, values)` reads `values.resize` (a `ResizeSpec`), `values.target`, `values.destination`, `values.name`, `values.background`, `values.keepMetadata`, `values.quality`, `values.output`, `values.roots` and calls `planEdit`. Add both to `ACTIONS` (after `rotateAction`).

`describe.ts` `verbFor` `case 'convert'`: `job.options.trim && job.options.resize ? 'trimmed and resized' : job.options.resize ? 'resized' : job.options.trim ? 'trimmed' : <existing>`.

`errors.ts`: three codes and constructors, worded like `boostTooLarge`:
- `resizeTooLarge(path, size)` — title `Too large to resize to`, detail `${basename} would be ${w} × ${h}.`, hint `Resize works up to 16,384 px a side and 100 megapixels.`
- `nothingToTrim(path)` — title `Nothing to trim`, detail `${basename} has no empty edges.`, short `no empty edges`.
- `animatedTrim(path)` — title `Can't trim an animation`, detail `${basename} is animated; trimming works on still images.`

`src/shell/enhance.ts`: delete its `keptFormat`, `import { keptFormat } from '../core/resize.js'`, and re-export it (`export { keptFormat }`) so existing importers keep working.

- [ ] **Step 4: Run core tests, expect PASS.**

- [ ] **Step 5: Write the failing engine tests** — `tests/engines/resize-trim.test.ts`. Generate fixtures with Sharp in a temp dir (`makeTempDir` from `tests/helpers/fixtures.js`); look in `tests/` for an existing animated GIF fixture helper before writing one.

```ts
// Pin, one `it` each:
// 1. An orientation-6 JPEG stored 200×100 probes as 100×200, and --resize {percent: 50} writes 50×100.
//    (build: sharp({create:{width:200,height:100,...}}).jpeg().withMetadata({orientation:6}))
// 2. Transparent edges: 100×100 RGBA PNG with a 30×50 opaque block → trim writes 30×50 PNG with alpha.
// 3. Trim + resize {percent: 50} on (2) writes 15×25 (percent of the TRIMMED size).
// 4. A uniform image: trim alone throws code 'nothing-to-trim'; trim + resize writes the resize and
//    returns warning 'nothing-trimmed'.
// 5. Animated GIF: resize {width: N} keeps frame count (metadata pages); trim throws 'animated-trim'.
// 6. RGBA PNG resized to JPEG target is flattened (output hasAlpha false) — invariant 5 on the new path.
// 7. A resize over the limit throws 'resize-too-large' before writing (output does not exist).
// 8. measureImage: upright size for (1); trimmed 30×50 for (2); 'nothing' for uniform; 'animated' for the GIF.
```

Run each through the real engine path the CLI uses (`imageEngine.run` via `runPlan`, or whatever `tests/engines/*` already does for convert jobs — copy that harness).

- [ ] **Step 6: Run, expect FAIL.**

- [ ] **Step 7: Implement the engine** in `src/engines/image.ts`:
  - `probe`: `width: meta.autoOrient?.width ?? meta.width ?? 0`, same for height (Sharp 0.35's `autoOrient` is the upright size; verified 2026-10-12). Check nothing in tests pins the stored size of an oriented fixture; if one does, it was pinning the bug — update it.
  - `pipelineFor`, after `pipeline = pipeline.rotate()` and before the flatten:
    ```ts
    // Trim and resize (spec 2026-10-12), on the upright image.
    if (options.trim) pipeline = pipeline.trim()
    if (options.resize) {
      const size = resizedSize(await uprightOrTrimmed(...), options.resize)
      pipeline = pipeline.resize(size.width, size.height, { fit: 'fill' })
    }
    ```
    The base size for a percent/width/height is the probe's upright size, or — when trimming — the trimmed size, measured with a separate `sharp(input).rotate().trim().toBuffer({ resolveWithObject: true })` info read. `fit: 'fill'` with both sides computed by `resizedSize`, so Sharp's own rounding never disagrees with the name.
  - Refusals before any write: `options.trim` on `source.frames > 1` → `animatedTrim`; trimmed size equal to upright size → `nothingToTrim` when no resize, else push warning `{ code: 'nothing-trimmed', message: '<name> has no empty edges; resized only.' }` (`run` owns `warnings`, so do the trim measurement in `run` and pass the base size into `pipelineFor` through a new optional parameter rather than recomputing); `sizeOverLimit(size)` → `resizeTooLarge`.
  - `measureImage(source)`: upright = `{ source.width, source.height }` (now upright from the probe); `frames > 1` → `'animated'`; else trim-measure; equal → `'nothing'`. HEIC: go through `decodeHeic` like `pipelineFor` does. Export it.
  - Keep `encodeToBuffer` / `measurer` working — they call `pipelineFor` with options that never carry trim/resize today; leave them unchanged.

- [ ] **Step 8: Run engine + core tests, expect PASS; then the existing image-engine and enhance tests** (`npx vitest run tests/engines tests/core tests/shell/enhance-flow.test.tsx`) to catch the probe change.

- [ ] **Step 9: Lint, typecheck, commit.**

```bash
cd "$WT" && npx biome check src/core src/engines src/shell/enhance.ts tests/core/resize.test.ts tests/engines/resize-trim.test.ts && npx tsc --noEmit -p . \
 && git add src/core src/engines/image.ts src/shell/enhance.ts tests/core/resize.test.ts tests/engines/resize-trim.test.ts \
 && git commit -m "feat(core): resize and trim as convert options, upright probe sizes"
```

---

### Task 2: CLI and MCP (parallel with Task 3, after Task 1)

**Files:**
- Modify: `src/cli/args.ts` (flags, intent, help text), `src/cli/execute.ts` (run it)
- Modify: `src/mcp/schemas.ts`, `src/mcp/tools.ts` (and `src/mcp/server.ts` description of `forge_convert`)
- Modify: `README.md` (one short section), and the skill doc if one lists flags (`grep -rn "remove-bg" docs *.md skills 2>/dev/null`)
- Test: `tests/cli/resize-args.test.ts`, one case in the existing MCP convert test file

**Interfaces — Consumes:** `planEdit`, `EditRequest`, `ResizeSpec`, `RESIZE_MAX` from Task 1. **Produces:** nothing other tasks use.

- [ ] **Step 1: Failing tests.** Parse-level (`parseArgs` — find the exported parser name in `args.ts`):
  - `photo.jpg --resize 50%` → an intent carrying `resize: { percent: 50 }`; `--width 1200` → `{ width: 1200 }`; `--height 900`; `--trim` alone; `--trim --width 1200 --to webp`.
  - Refusals (`invalidArguments`, one assertion each via `it.each`): two of `--resize/--width/--height`; any of them or `--trim` with `--max-size`, `--sharpen`, `--boost`, `--remove-bg`, `--merge`; `--resize 0`, `--resize 201`, `--resize abc`, `--width 0`.
  - One real run (spawn-free: call `execute` like the existing CLI tests do) of `--width 100` on a generated 400×300 JPEG writes `photo-100x75.jpg` at 100×75.
  - MCP: `forge_convert` with `{ resize: { percent: 50 } }` on a generated PNG writes half size.

- [ ] **Step 2: Run, expect FAIL.**

- [ ] **Step 3: Implement.** Add options: `--trim`, `--resize <percent>` (`50%` or `50`), `--width <px>`, `--height <px>`. Follow the `ExtensionOpIntent` pattern: a new `EditIntent { kind: 'edit', inputs, trim, resize?, target?, output?, options, force, recursive, concurrency?, debug }`, checked right after the extension-op block, with the conflict checks above. In `execute.ts`, run it the way `extension-op` runs (expand inputs, probe, plan with `planEdit`, `runPlan`, report) — read that path and reuse its helpers; do not duplicate the reporting. `--json` must work as for convert. Help: one line per flag. MCP: extend the convert input schema with `trim: z.boolean().optional()` and `resize: z.union([z.object({ percent: z.number().min(1).max(200) }), z.object({ width: z.number().int().min(1) }), z.object({ height: z.number().int().min(1) })]).optional()`; `target` becomes optional only when `trim`/`resize` is given (refuse otherwise with the existing message).

- [ ] **Step 4: PASS, lint, typecheck, commit** (`git add src/cli src/mcp README.md tests/cli/resize-args.test.ts <mcp test>` → `feat(cli): --trim, --resize, --width, --height; MCP forge_convert trim and resize`).

---

### Task 3: Shell — art, screens, Enhance rows, App wiring (parallel with Task 2, after Task 1)

**Files:**
- Create: `src/shell/resize-art.ts` (pure rows), `src/shell/components/ResizeStep.tsx`, `src/shell/components/ExactSizeStep.tsx`
- Modify: `src/shell/quality-art.ts` (centred variant of `sliderRow` — add params, don't copy)
- Modify: `src/shell/enhance.ts` (rows, E3 gap), `src/shell/components/EnhancePicker.tsx` (gap row, no-extension rows always ready), `src/shell/App.tsx` (steps `resize` and `exact-size`, measurement, Done)
- Modify: `scripts/resize-mockup.ts` only if you want it to draw from `resize-art.ts` (optional; don't spend long)
- Test: `tests/shell/resize-art.test.ts`, `tests/shell/resize-flow.test.tsx`

**Interfaces — Consumes:** `measureImage`/`ImageMeasure` (lazy `await import('../engines/image.js')`), `resizedSize`, `sizeOverLimit`, `RESIZE_*`, `resizeAction`, `trimAction`, `keptFormat` from Task 1.

**Produces:**

```ts
// src/shell/enhance.ts
export type EnhanceToolId = 'sharpen' | 'boost-2' | 'boost-4' | 'cutout' | 'trim' | 'resize'
// EnhanceRow.extension becomes optional (absent = built in, always ready)
export function enhanceRows(source: ImageInfo, measure?: ImageMeasure): EnhanceRow[]
// Trim row: measure undefined → no detail; size → detail {dim:'empty edges off · ', bold:'3610 × 2804'};
// 'nothing' → tooLarge-style dim reason 'no empty edges'; 'animated' → 'animated'.
// Resize row: detail {dim:'smaller or larger, as you choose', bold:''}.
// actionForRow: trim → trimAction, resize → resizeAction.
// The picker draws one blank row after 'cutout' (E3). Keys ↑↓ skip it.

// src/shell/resize-art.ts
export function resizeSliderRows(o: { palette: Palette; percent: number; mode: ShellMode }): Row[]   // band + H3 hint on row 0, ends row
export function resizeResultRows(o: { palette: Palette; from: Size; percent: number }): Row[]      // "same size · " / "becomes " (+ softer line > 100)
export function exactPairRows(o: { palette: Palette; mode: ShellMode; width: string; height: string; focus: 'width' | 'height'; follows: boolean }): Row[]
export function exactFromWidth(from: Size, width: number): Size     // thin wrappers over resizedSize, for the pair
export function exactFromHeight(from: Size, height: number): Size
```

The look is the mockup's tab "★ Resize slider", **H3** and **X** (`mockups/resize-2026-10.html`, drawn by `scripts/resize-mockup.ts` — `centredSlider`, `sliderResult`, `sliderScreen(L, v, 'slider')`, `pair`, `exact`). Port those functions into `resize-art.ts` using the palette tokens they read (`trackFill`, `thumb`, `track`, `ink`, `keycapBg`, `border`, `dim`, `fg`, `warn`; the field fill is the token Compress's Target size field uses — find it in `Prompt.tsx`/`theme.ts`, don't hardcode `#2c2c2c`).

- [ ] **Step 1: Failing art tests** (`tests/shell/resize-art.test.ts`), text-level, few:
  - at 100 the thumb label ` 100% ` starts at the band's middle (column `1 + round((48 - 6) / 2)`), the ends row reads `smaller` … `same size` … `larger`, and row 0 ends with `#` + ` type an exact size`;
  - result rows: 100 → `same size · 4032 × 3024`; 50 → `becomes 2016 × 1512`; 150 → `becomes 6048 × 4536` plus the softer line;
  - `exactFromWidth({4032,3024}, 1200)` → `{1200, 900}`; `exactPairRows` with `follows` draws the other side in `dim`.

- [ ] **Step 2: FAIL → implement art → PASS.**

- [ ] **Step 3: Failing flow test** (`tests/shell/resize-flow.test.tsx`), modelled on `tests/shell/enhance-flow.test.tsx` (same `render(<App …/>)`, `tools` fake with both extensions installed, `until(...)`), one or two `it`s:
  - `/enhance`, drop a generated 400×300 PNG with a transparent border → list shows `Trim edges` with `empty edges off · ` and the trimmed size, and `Resize`; the blank row sits after `Remove background`.
  - ↓ to Resize, ↵ → `Resize to`, `same size · 400 × 300`; ← ×10 → `becomes 200 × 150`; `#` → `Exact size` with `200` and `150`; type `1` `0` `0` over the width (the field starts selected: first digit replaces) → height `75`; esc → slider back at 50 %; `#`, type `100`, ↵ → Save as; ↵ → Done; the file `…-100x75.png` exists at 100×75.
- [ ] **Step 4: Implement.**
  - `enhance.ts` / `EnhancePicker.tsx`: as in Produces. Built-in rows never look up `tools` state; render as ready.
  - `App.tsx`: read the enhance flow around `chooseEnhance` (≈ line 2560) and the `step === 'enhance'` render (≈ 3300). When the list opens for an image, kick off `measureImage(source)` once (lazy import), keep it in state, pass to `enhanceRows`. Choosing `trim` → `chooseEnhance` as today (straight to Save as, values `{ tool: 'trim', target: keptFormat, trim: true }`). Choosing `resize` → new step `'resize'` (slider, ←→ by `RESIZE_STEP`, clamped to `[RESIZE_MIN, RESIZE_MAX]` and to the largest percent within `sizeOverLimit`), `#` → step `'exact-size'`, ↵ → `openSaveAs({ values: { tool: 'resize', target, resize: { percent } | { width } | { height } }, action: resizeAction })`. esc on the slider → back to the list; esc on the pair → the slider. Header bar trail as the spec says. Add both steps to the `isActive` list that lets digits switch mode only where it should — digits must NOT switch mode on `'exact-size'`, and `#` must not be swallowed by the home field.
  - Done: enhance's Done (X5) for a `convert` job with `trim`/`resize` — show before and after whole (the cutout's "subject" path in `src/core/closeup.ts`), not a pixel-scale patch. If X5's code assumes `op === 'boost' | 'remove-background'`, extend that check; don't restructure it.
  - Working verb: the action's `verb` (`Trimming edges` / `Resizing`).
- [ ] **Step 5: PASS; run the shell suite once** (`caffeinate -i npx vitest run tests/shell`) and fix only what this task broke. If a pinned cell fixture for the enhance picker now differs only by the new rows, update that test's expectation, nothing wider.
- [ ] **Step 6: Lint, typecheck, commit** (`git add src/shell tests/shell/resize-art.test.ts tests/shell/resize-flow.test.tsx scripts/resize-mockup.ts` → `feat(shell): Trim edges and Resize in Enhance`).

---

### Task 4: Whole-branch check (after 2 and 3)

- [ ] Full suite under `caffeinate -i npx vitest run`, `npx biome check .`, `npx tsc --noEmit -p .`. Fix breaks.
- [ ] Try it: `npx tsx src/index.ts <photo> --trim --width 800`, and the shell (`npm run dev`) — Enhance → Resize → `#` → Save as → Done.
- [ ] One whole-branch review (superpowers:requesting-code-review) against the spec and Review Focus; fix what it finds that matters.
