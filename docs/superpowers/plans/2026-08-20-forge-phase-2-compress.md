# Forge Phase 2 — Slash Commands and Compress Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let Forge make a file smaller without changing what it is, reached
through a `/compress` command, with a slash-command palette that makes every
future action discoverable.

**Architecture:** A command registry in `shell/commands.ts` drives a palette
that opens when the prompt buffer starts with `/`. Compression is a second
`Action` alongside convert, so it inherits the destination, naming and
write-safety steps unchanged. Target-size search lives in `core/compress.ts`
as a pure binary search that takes an `encode` callback and never imports
Sharp.

**Tech Stack:** TypeScript strict ESM · React 19 + Ink 7.1.1 · Sharp 0.35.3 ·
Vitest 4 · ink-testing-library 4 · Biome · Node 20+

**Spec:** [docs/superpowers/specs/2026-08-20-forge-phase-2-compress-design.md](../specs/2026-08-20-forge-phase-2-compress-design.md)

## Global Constraints

From `CLAUDE.md` and the specs. These apply to every task.

- `core/` and `engines/` import no React, no Ink, no Chalk, and never write to
  stdout. They return data.
- No hardcoded list of formats anywhere. Targets come from `targetsFor(source)`;
  the compress suggestion picks its candidate from the capability graph.
- Sources are probed by content, never by file extension.
- `.rotate()` runs before any other Sharp operation.
- Alpha is flattened when the target format cannot carry it.
- Writes are atomic — temp file, then rename.
- **Progress is never fabricated**, and neither is any other number shown to
  the user. The search reports a real position in a sequence whose length the
  algorithm knows in advance; the format suggestion encodes its candidate
  before quoting a size.
- Every status carries a symbol **and** a word. Colour is never the sole
  carrier of meaning; `NO_COLOR` and non-TTY are honoured.
- Width bands: `< 60` compact, `60–100` normal, `> 100` wide. Content is
  truncated with `middleEllipsis`, never wrapped.
- Work on `dev`. Never commit to `main`.
- Commands: `npm test`, `npm run typecheck`, `npm run lint`.

### Testing notes for this codebase

- **Colour.** Chalk fixes its level at first import and vitest externalises
  `node_modules`, so `lastFrame()` carries no ANSI in a normal run. To assert
  colour, set `FORCE_COLOR` inside `vi.hoisted()` at the top of the file — see
  `tests/shell/select.test.tsx`. Otherwise assert structure, not colour.
- **`<Static>`.** History is flushed once and later frames carry only the live
  region, so `lastFrame()` may not contain a committed block. Assert against
  `frames.join('')` when the claim is "this was ever drawn", or against disk
  when the claim is "this happened".
- **Shell walks.** A conversion is: path → Enter → target → Enter → quality →
  Enter → destination → Enter → name → Enter. Tests that convert must pass
  `prefs` with `defaultOutput` set to their own temp dir, or they write into
  the user's real `~/Desktop`.

---

## File Structure

**Created**

| File | Responsibility |
| --- | --- |
| `src/core/actions/index.ts` | The `Action` interface, `ACTIONS`, `actionsFor`, shared option types |
| `src/core/actions/convert.ts` | `convertAction`, moved unchanged |
| `src/core/actions/compress.ts` | `compressAction` |
| `src/core/compress.ts` | `findQuality` — pure binary search, no Sharp |
| `src/shell/commands.ts` | Command registry and matching |
| `src/shell/components/CommandPalette.tsx` | The `/` palette |

**Modified**

| File | Change |
| --- | --- |
| `src/core/units.ts` | `parseSize` for `500kb` / `2 MB` |
| `src/engines/image.ts` | Export `encodeToBuffer` for the search |
| `src/core/actions.ts` | Deleted; becomes the directory above |
| `src/shell/App.tsx` | Palette, command dispatch, compress stages |
| `src/shell/components/Prompt.tsx` | Report whether the buffer opens a command |
| `src/cli/args.ts` | `--quality` without `--to`; `--max-size` |
| `src/cli/execute.ts` | Route the compress intent |
| `README.md` | Document commands and compression |

---

## Task 1: Split `core/actions.ts` into a directory

Pure move, no behaviour change. The existing tests are the safety net — if
they pass unchanged, the move was faithful.

**Files:**
- Create: `src/core/actions/index.ts`, `src/core/actions/convert.ts`
- Delete: `src/core/actions.ts`
- Test: `tests/core/actions.test.ts` (imports only)

**Interfaces:**
- Consumes: nothing.
- Produces: identical exports at a new path —
  `Choice`, `PathPreset`, `OptionSpec`, `Action`, `convertAction`, `ACTIONS`,
  `actionsFor`. Import specifier becomes `../core/actions/index.js`.

- [ ] **Step 1: Confirm the current tests pass before touching anything**

Run: `npx vitest run tests/core/actions.test.ts`
Expected: PASS. This is the baseline the move must preserve.

- [ ] **Step 2: Create the directory and move the code**

Create `src/core/actions/index.ts` with the shared types and registry:

```ts
import type { Job, SourceInfo } from '../types.js'
import type { Preferences } from '../../config/preferences.js'
import { compressAction } from './compress.js'
import { convertAction } from './convert.js'

export interface Choice {
  value: string
  label: string
  hint?: string
  /** A short tag rendered in the accent colour, set apart from the hint. */
  badge?: string
}

export interface PathPreset {
  label: string
  path: string
}

export type OptionSpec =
  | { kind: 'select'; id: string; label: string; choices: Choice[]; default: string }
  | {
      kind: 'slider'
      id: string
      label: string
      min: number
      max: number
      step: number
      default: number
    }
  | { kind: 'path'; id: string; label: string; default: string; presets: PathPreset[] }
  /** A free-text answer, such as a target size. */
  | { kind: 'text'; id: string; label: string; placeholder: string }

export interface Action {
  id: string
  label: string
  hint: string
  appliesTo(source: SourceInfo): boolean
  options(source: SourceInfo, values: Record<string, unknown>, prefs: Preferences): OptionSpec[]
  plan(source: SourceInfo, values: Record<string, unknown>): Job[]
}

export { convertAction } from './convert.js'
export { compressAction } from './compress.js'

export const ACTIONS: Action[] = [convertAction, compressAction]

export function actionsFor(source: SourceInfo): Action[] {
  return ACTIONS.filter((a) => a.appliesTo(source))
}
```

Move the rest of the old file into `src/core/actions/convert.ts` verbatim —
`targetSelect`, `requireTarget`, `labelFor`, `destinationPath`,
`convertAction` — changing only the import paths (`./capabilities.js` becomes
`../capabilities.js`, and the shared types come from `./index.js`).

Create a placeholder `src/core/actions/compress.ts` so `index.ts` resolves:

```ts
import type { Action } from './index.js'

/** Filled in by Task 5. Registered now so the module graph is complete. */
export const compressAction: Action = {
  id: 'compress',
  label: 'Compress',
  hint: 'make it smaller',
  appliesTo: () => false,
  options: () => [],
  plan: () => [],
}
```

Delete `src/core/actions.ts`.

- [ ] **Step 3: Update every import**

Run: `grep -rn "core/actions.js" src tests`
Change each to `core/actions/index.js`. Expect hits in `src/shell/App.tsx`,
`src/shell/components/Select.tsx`, `src/shell/components/PathInput.tsx`,
`src/core/plan.ts` if present, and `tests/core/actions.test.ts`.

- [ ] **Step 4: Verify nothing changed**

Run: `npm test && npm run typecheck && npm run lint`
Expected: the same test count as before, all passing. A behaviour change here
means the move was not faithful.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor(core): actions.ts becomes a directory, one file per action"
```

---

## Task 2: Parse human size strings

**Files:**
- Modify: `src/core/units.ts`
- Test: `tests/core/units.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `export function parseSize(input: string): number | undefined` —
  bytes, or `undefined` when the string is not a size.

- [ ] **Step 1: Write the failing tests**

Append to `tests/core/units.test.ts`:

```ts
import { parseSize } from '../../src/core/units.js'

describe('parseSize', () => {
  it('reads plain byte counts', () => {
    expect(parseSize('1024')).toBe(1024)
    expect(parseSize('500 b')).toBe(500)
  })

  it('reads KB, MB and GB as powers of 1024', () => {
    expect(parseSize('1kb')).toBe(1024)
    expect(parseSize('500kb')).toBe(512_000)
    expect(parseSize('2mb')).toBe(2 * 1024 * 1024)
    expect(parseSize('1gb')).toBe(1024 * 1024 * 1024)
  })

  it('ignores case and an optional space', () => {
    expect(parseSize('2 MB')).toBe(parseSize('2mb'))
    expect(parseSize('2Mb')).toBe(parseSize('2mb'))
    expect(parseSize('  2mb  ')).toBe(parseSize('2mb'))
  })

  it('accepts a decimal', () => {
    expect(parseSize('1.5mb')).toBe(Math.round(1.5 * 1024 * 1024))
  })

  it('rejects what is not a size', () => {
    for (const bad of ['', '   ', 'abc', 'mb', '-5mb', '5xb', '5 5mb', 'NaN']) {
      expect(parseSize(bad), bad).toBeUndefined()
    }
  })

  it('rejects zero — a file cannot be nothing', () => {
    expect(parseSize('0')).toBeUndefined()
    expect(parseSize('0kb')).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run tests/core/units.test.ts`
Expected: FAIL — `parseSize is not exported`.

- [ ] **Step 3: Implement**

Append to `src/core/units.ts`:

```ts
const SIZE_UNITS: Record<string, number> = {
  b: 1,
  kb: 1024,
  mb: 1024 * 1024,
  gb: 1024 * 1024 * 1024,
}

/**
 * Reads a size the way a person writes one: `500kb`, `2 MB`, `1.5mb`.
 *
 * Powers of 1024 rather than 1000, because the number this is compared
 * against is `stat().size` and every other size Forge prints comes from
 * `formatBytes`, which is also binary. Mixing the two would make a file
 * "1 MB" in one line and over the limit in the next.
 *
 * Returns undefined rather than throwing or guessing: the caller is a text
 * field that has to tell the user their input was not understood, and
 * `undefined` is the only answer that cannot be mistaken for a size.
 */
export function parseSize(input: string): number | undefined {
  const match = /^\s*(\d+(?:\.\d+)?)\s*(b|kb|mb|gb)?\s*$/i.exec(input)
  if (!match) return undefined

  const amount = Number(match[1])
  if (!Number.isFinite(amount) || amount <= 0) return undefined

  const unit = SIZE_UNITS[(match[2] ?? 'b').toLowerCase()]
  if (unit === undefined) return undefined

  return Math.round(amount * unit)
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run tests/core/units.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/units.ts tests/core/units.test.ts
git commit -m "feat(core): parse human size strings for target-size compression"
```

---

## Task 3: Target-size binary search

**Files:**
- Create: `src/core/compress.ts`
- Test: `tests/core/compress.test.ts`

**Interfaces:**
- Consumes: nothing. Deliberately takes `encode` as a parameter and imports no
  engine, so it is tested with arithmetic instead of images.
- Produces:
  ```ts
  export interface SearchRequest {
    encode: (quality: number) => Promise<number>
    targetBytes: number
    min?: number   // default 1
    max?: number   // default 100
    onAttempt?: (attempt: number, of: number) => void
  }
  export interface SearchResult { quality: number; bytes: number; missed: boolean }
  export function findQuality(req: SearchRequest): Promise<SearchResult>
  export function maxAttempts(min?: number, max?: number): number
  ```

- [ ] **Step 1: Write the failing tests**

Create `tests/core/compress.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'
import { findQuality, maxAttempts } from '../../src/core/compress.js'

/**
 * A stand-in encoder: size rises with quality, the way a real one does. The
 * search only relies on that monotonicity, so it can be tested with
 * arithmetic rather than images — which is the point of `encode` being a
 * parameter.
 */
const curve = (bytesAtQ1: number, bytesAtQ100: number) => async (q: number) =>
  Math.round(bytesAtQ1 + ((bytesAtQ100 - bytesAtQ1) * (q - 1)) / 99)

describe('findQuality', () => {
  it('returns the highest quality whose output fits', async () => {
    const encode = curve(100_000, 1_000_000)
    const { quality, bytes, missed } = await findQuality({
      encode,
      targetBytes: 500_000,
    })
    expect(missed).toBe(false)
    expect(bytes).toBeLessThanOrEqual(500_000)
    // One step higher must not fit, or it was not the highest that does.
    expect(await encode(quality + 1)).toBeGreaterThan(500_000)
  })

  it('reports a bounded, honest attempt count', async () => {
    const onAttempt = vi.fn()
    await findQuality({ encode: curve(100_000, 1_000_000), targetBytes: 500_000, onAttempt })

    const calls = onAttempt.mock.calls
    expect(calls.length).toBeLessThanOrEqual(maxAttempts())
    // Every call names a real position in a sequence whose length was known
    // before the search started — never a fabricated denominator.
    for (const [attempt, of] of calls) {
      expect(of).toBe(maxAttempts())
      expect(attempt).toBeGreaterThanOrEqual(1)
      expect(attempt).toBeLessThanOrEqual(of)
    }
    expect(calls.map(([a]) => a)).toEqual(calls.map((_, i) => i + 1))
  })

  it('never needs more than ceil(log2(range)) attempts', () => {
    expect(maxAttempts(1, 100)).toBe(7)
    expect(maxAttempts(1, 2)).toBe(1)
  })

  it('flags a target nothing can reach, and reports the smallest achievable', async () => {
    const encode = curve(900_000, 1_000_000)
    const { missed, bytes, quality } = await findQuality({ encode, targetBytes: 100_000 })
    expect(missed).toBe(true)
    expect(quality).toBe(1)
    expect(bytes).toBe(await encode(1))
  })

  it('returns max without searching when the target is already generous', async () => {
    const encode = vi.fn(curve(100_000, 200_000))
    const { quality, missed } = await findQuality({ encode, targetBytes: 10_000_000 })
    expect(quality).toBe(100)
    expect(missed).toBe(false)
    // One probe at max is enough to know; there is nothing to search for.
    expect(encode).toHaveBeenCalledTimes(1)
  })

  it('honours a narrowed range', async () => {
    const { quality } = await findQuality({
      encode: curve(100_000, 1_000_000),
      targetBytes: 500_000,
      min: 40,
      max: 60,
    })
    expect(quality).toBeGreaterThanOrEqual(40)
    expect(quality).toBeLessThanOrEqual(60)
  })
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run tests/core/compress.test.ts`
Expected: FAIL — `Cannot find module '../../src/core/compress.js'`.

- [ ] **Step 3: Implement**

Create `src/core/compress.ts`:

```ts
export interface SearchRequest {
  /** Encodes at a quality and resolves the resulting byte length. */
  encode: (quality: number) => Promise<number>
  targetBytes: number
  min?: number
  max?: number
  /** Called once per encode with a real position in a known sequence. */
  onAttempt?: (attempt: number, of: number) => void
}

export interface SearchResult {
  quality: number
  bytes: number
  /** True when even the lowest quality overshot the target. */
  missed: boolean
}

const DEFAULT_MIN = 1
const DEFAULT_MAX = 100

/**
 * How many encodes the search can possibly need.
 *
 * Known before the search starts, which is what lets progress be reported
 * honestly: `attempt 3 of 7` is a real position in a bounded sequence, not a
 * percentage invented to look like movement. Spec §12 forbids the latter, and
 * a made-up denominator is the same offence.
 */
export function maxAttempts(min: number = DEFAULT_MIN, max: number = DEFAULT_MAX): number {
  return Math.max(1, Math.ceil(Math.log2(Math.max(1, max - min + 1))))
}

/**
 * The highest quality whose encoded size fits within `targetBytes`.
 *
 * Assumes only that size rises with quality, which is true of every encoder
 * Forge uses. `encode` is a parameter rather than an import so this module
 * stays free of Sharp and can be tested against arithmetic.
 */
export async function findQuality(req: SearchRequest): Promise<SearchResult> {
  const min = req.min ?? DEFAULT_MIN
  const max = req.max ?? DEFAULT_MAX
  const of = maxAttempts(min, max)
  let attempt = 0

  const measure = async (quality: number): Promise<number> => {
    attempt += 1
    req.onAttempt?.(Math.min(attempt, of), of)
    return req.encode(quality)
  }

  // The best case first: if the largest size already fits, there is nothing
  // to search for and the user keeps every bit of quality.
  const atMax = await measure(max)
  if (atMax <= req.targetBytes) return { quality: max, bytes: atMax, missed: false }

  let low = min
  let high = max
  let best: SearchResult | undefined

  while (low <= high) {
    const mid = Math.floor((low + high) / 2)
    const bytes = await measure(mid)
    if (bytes <= req.targetBytes) {
      best = { quality: mid, bytes, missed: false }
      low = mid + 1
    } else {
      high = mid - 1
    }
  }

  if (best) return best

  // Nothing fits. Report the smallest achievable rather than writing a file
  // that quietly misses the number the user asked for — the caller shows this
  // so they learn what is actually possible.
  const floor = await req.encode(min)
  return { quality: min, bytes: floor, missed: true }
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run tests/core/compress.test.ts`
Expected: PASS, all six.

- [ ] **Step 5: Commit**

```bash
git add src/core/compress.ts tests/core/compress.test.ts
git commit -m "feat(core): binary search for the highest quality that fits a size"
```

---

## Task 4: Encode to a buffer without writing

**Files:**
- Modify: `src/engines/image.ts`
- Test: `tests/engines/encode-buffer.test.ts`

**Interfaces:**
- Consumes: `SourceInfo`, `FormatId`, `ConvertOptions` from `core/types.js`.
- Produces:
  ```ts
  export async function encodeToBuffer(
    source: SourceInfo,
    target: FormatId,
    options: ConvertOptions,
  ): Promise<Buffer>
  ```

- [ ] **Step 1: Write the failing test**

Create `tests/engines/encode-buffer.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import sharp from 'sharp'
import { encodeToBuffer } from '../../src/engines/image.js'
import { probe } from '../../src/engines/registry.js'
import { makeJpeg, makeTempDir, makeTransparentPng } from '../helpers/fixtures.js'

const opts = { background: '#ffffff', keepMetadata: false }

describe('encodeToBuffer', () => {
  it('returns bytes without writing a file', async () => {
    const dir = await makeTempDir()
    const jpg = await makeJpeg(dir, 'photo.jpg')
    const source = await probe(jpg)

    const buffer = await encodeToBuffer(source, 'jpeg', { ...opts, quality: 50 })
    expect(buffer.length).toBeGreaterThan(0)

    const { readdir } = await import('node:fs/promises')
    expect(await readdir(dir)).toEqual(['photo.jpg'])
  })

  it('a lower quality yields fewer bytes — the assumption the search rests on', async () => {
    const dir = await makeTempDir()
    const jpg = await makeJpeg(dir, 'photo.jpg')
    const source = await probe(jpg)

    const low = await encodeToBuffer(source, 'jpeg', { ...opts, quality: 20 })
    const high = await encodeToBuffer(source, 'jpeg', { ...opts, quality: 95 })
    expect(low.length).toBeLessThan(high.length)
  })

  it('flattens alpha for a target that cannot carry it', async () => {
    const dir = await makeTempDir()
    const png = await makeTransparentPng(dir, 'clear.png')
    const source = await probe(png)

    const buffer = await encodeToBuffer(source, 'jpeg', { ...opts, quality: 80 })
    const meta = await sharp(buffer).metadata()
    expect(meta.format).toBe('jpeg')
    expect(meta.hasAlpha).toBeFalsy()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/engines/encode-buffer.test.ts`
Expected: FAIL — `encodeToBuffer is not exported`.

- [ ] **Step 3: Implement**

In `src/engines/image.ts`, extract the pipeline the existing `convert` already
builds so both paths share it, then export the buffer variant. Add near
`convert`:

```ts
/**
 * Builds the same pipeline `convert` writes with, up to the encode.
 *
 * Shared rather than duplicated so the invariants hold in both paths: HEIC
 * decoded through sips, `.rotate()` before anything else, alpha flattened for
 * a target that cannot carry it, EXIF stripped unless asked for.
 */
async function pipelineFor(
  source: SourceInfo,
  target: FormatId,
  options: ConvertOptions,
  animated: boolean,
): Promise<{ pipeline: Sharp; cleanup: () => Promise<void> }> {
  if (source.format === 'heic' && !(await heicDecodable())) {
    throw heicDecoderUnavailable(source.path)
  }
  const heic = source.format === 'heic' ? await decodeHeic(source.path) : undefined
  const input = heic?.path ?? source.path
  const cleanup = async () => {
    await heic?.cleanup()
  }

  let pipeline = sharp(input, animated ? { animated: true } : {})
  pipeline = pipeline.rotate()
  if (source.hasAlpha && !FORMATS[target].hasAlpha) {
    pipeline = pipeline.flatten({ background: options.background })
  }
  pipeline = options.keepMetadata ? pipeline.keepMetadata() : pipeline.keepIccProfile()
  return { pipeline, cleanup }
}

/**
 * Encodes without touching the disk. The target-size search calls this once
 * per attempt, so writing a temp file each time would be wasted I/O — and the
 * search only ever needs the byte count.
 */
export async function encodeToBuffer(
  source: SourceInfo,
  target: FormatId,
  options: ConvertOptions,
): Promise<Buffer> {
  const { pipeline, cleanup } = await pipelineFor(source, target, options, false)
  try {
    return await encode(pipeline, target, options.quality).toBuffer()
  } finally {
    await cleanup()
  }
}
```

Then rewrite `convert`'s body to call `pipelineFor` instead of assembling the
pipeline inline, keeping its phase callbacks, animation warning and
`writeAtomic` exactly as they are.

- [ ] **Step 4: Run to verify the new and existing tests pass**

Run: `npx vitest run tests/engines/`
Expected: PASS, including the HEIC, correctness and atomic-write suites — the
refactor must not change what `convert` does.

- [ ] **Step 5: Commit**

```bash
git add src/engines/image.ts tests/engines/encode-buffer.test.ts
git commit -m "feat(engines): encodeToBuffer, sharing one pipeline with convert"
```

---

## Task 5: The compress action

**Files:**
- Modify: `src/core/actions/compress.ts`
- Test: `tests/core/actions-compress.test.ts`

**Interfaces:**
- Consumes: `Action`, `OptionSpec` (Task 1); `parseSize` (Task 2);
  `Preferences`, `expandTilde` from `config/preferences.js`.
- Produces: `compressAction` with option ids `mode` (`'quality' | 'size'`),
  `quality`, `size`, `destination`; and a `plan()` returning one `Job` whose
  `target` equals `source.format`.

- [ ] **Step 1: Write the failing tests**

Create `tests/core/actions-compress.test.ts`:

```ts
import { homedir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DEFAULT_PREFERENCES } from '../../src/config/preferences.js'
import { compressAction } from '../../src/core/actions/index.js'
import type { SourceInfo } from '../../src/core/types.js'

const source = (over: Partial<SourceInfo> = {}): SourceInfo => ({
  path: '/Users/me/Pictures/photo.jpg',
  format: 'jpeg',
  width: 4032,
  height: 3024,
  bytes: 4_400_000,
  hasAlpha: false,
  frames: 1,
  ...over,
})

const spec = (values: Record<string, unknown>, id: string) =>
  compressAction.options(source(), values, DEFAULT_PREFERENCES).find((s) => s.id === id)

describe('compress action', () => {
  it('applies to a lossy source, where quality is a dial that exists', () => {
    expect(compressAction.appliesTo(source({ format: 'jpeg' }))).toBe(true)
    expect(compressAction.appliesTo(source({ format: 'webp' }))).toBe(true)
  })

  it('does not apply to a lossless source — there is no quality to trade', () => {
    // Compressing a PNG by quality is not a thing; that is what /convert is for.
    expect(compressAction.appliesTo(source({ format: 'png' }))).toBe(false)
  })

  it('asks how to compress before anything else', () => {
    const first = compressAction.options(source(), {}, DEFAULT_PREFERENCES)[0]
    expect(first?.id).toBe('mode')
    if (first?.kind !== 'select') throw new Error('expected a select')
    expect(first.choices.map((c) => c.value)).toEqual(['quality', 'size'])
  })

  it('offers a slider once quality is chosen', () => {
    const s = spec({ mode: 'quality' }, 'quality')
    if (s?.kind !== 'slider') throw new Error('expected a slider')
    expect(s.default).toBe(DEFAULT_PREFERENCES.quality)
    expect(s.min).toBe(1)
    expect(s.max).toBe(100)
  })

  it('offers a text field once target size is chosen', () => {
    const s = spec({ mode: 'size' }, 'size')
    if (s?.kind !== 'text') throw new Error('expected a text field')
    expect(s.placeholder.toLowerCase()).toContain('kb')
  })

  it('asks for a destination in both modes', () => {
    expect(spec({ mode: 'quality', quality: 70 }, 'destination')?.kind).toBe('path')
    expect(spec({ mode: 'size', size: '500kb' }, 'destination')?.kind).toBe('path')
  })

  it('plans a job in the same format as the source', () => {
    const [job] = compressAction.plan(source(), {
      mode: 'quality',
      quality: 60,
      destination: '/tmp/out',
    })
    expect(job?.target).toBe('jpeg')
    expect(job?.options.quality).toBe(60)
  })

  it('suffixes the output so it cannot collide with the input', () => {
    const [job] = compressAction.plan(source(), {
      mode: 'quality',
      quality: 60,
      destination: '/Users/me/Pictures',
    })
    // Same folder, same extension — without a suffix this is the input.
    expect(job?.output).not.toBe(source().path)
    expect(job?.output).toContain('photo-small')
    expect(job?.output.endsWith('.jpg')).toBe(true)
  })

  it('preselects the configured default destination', () => {
    const s = spec({ mode: 'quality', quality: 70 }, 'destination')
    if (s?.kind !== 'path') throw new Error('expected a path')
    expect(s.default).toBe(join(homedir(), 'Desktop'))
  })

  it('rejects a plan with no usable mode rather than guessing', () => {
    expect(() => compressAction.plan(source(), { destination: '/tmp' })).toThrow()
  })
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run tests/core/actions-compress.test.ts`
Expected: FAIL — `appliesTo` returns false for jpeg (the Task 1 placeholder).

- [ ] **Step 3: Implement**

Replace `src/core/actions/compress.ts`:

```ts
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { expandTilde, type Preferences } from '../../config/preferences.js'
import { invalidArguments } from '../errors.js'
import { FORMATS, primaryExtension } from '../formats.js'
import type { Job, SourceInfo } from '../types.js'
import type { Action, OptionSpec, PathPreset } from './index.js'

/**
 * The suffix that keeps a compressed file from landing on its source.
 * Compression keeps the extension, so without this the default output *is*
 * the input, and `buildPlan` would refuse every run.
 */
const SUFFIX = '-small'

function destinationPath(source: SourceInfo, prefs: Preferences): OptionSpec {
  const here = dirname(source.path)
  const preferred = expandTilde(prefs.defaultOutput)

  const candidates: PathPreset[] = [
    { label: labelFor(preferred, here), path: preferred },
    { label: 'Desktop', path: join(homedir(), 'Desktop') },
    { label: 'Same folder', path: here },
    { label: 'Downloads', path: join(homedir(), 'Downloads') },
  ]

  const seen = new Set<string>()
  const presets = candidates.filter((p) => (seen.has(p.path) ? false : (seen.add(p.path), true)))

  return { kind: 'path', id: 'destination', label: 'Save to', default: preferred, presets }
}

function labelFor(path: string, sourceDir: string): string {
  if (path === sourceDir) return 'Same folder'
  if (path === join(homedir(), 'Desktop')) return 'Desktop'
  if (path === join(homedir(), 'Downloads')) return 'Downloads'
  return path.split('/').pop() || path
}

export const compressAction: Action = {
  id: 'compress',
  label: 'Compress',
  hint: 'make it smaller',

  /**
   * Only formats with a quality dial. Compressing a PNG by quality is not a
   * thing the encoder can do — `formats.ts` declares PNG lossless and
   * `engines/image.ts` encodes it losslessly on purpose — so offering it here
   * would promise something that cannot happen. Making a PNG smaller means
   * changing its format, which is `/convert`.
   */
  appliesTo: (source) => FORMATS[source.format].lossy,

  options(source, values, prefs) {
    const specs: OptionSpec[] = [
      {
        kind: 'select',
        id: 'mode',
        label: `Compress ${source.path.split('/').pop() ?? 'this file'}`,
        choices: [
          { value: 'quality', label: 'By quality', hint: 'pick a level, see the result' },
          { value: 'size', label: 'To a target size', hint: 'smallest quality that fits' },
        ],
        default: 'quality',
      },
    ]

    if (values.mode === 'quality') {
      specs.push({
        kind: 'slider',
        id: 'quality',
        label: 'Quality',
        min: 1,
        max: 100,
        step: 5,
        default: prefs.quality,
      })
    } else if (values.mode === 'size') {
      specs.push({
        kind: 'text',
        id: 'size',
        label: 'Target size',
        placeholder: 'e.g. 500kb or 2mb',
      })
    } else {
      return specs
    }

    specs.push(destinationPath(source, prefs))
    return specs
  },

  plan(source, values) {
    const mode = values.mode
    if (mode !== 'quality' && mode !== 'size') {
      throw invalidArguments(
        `compressAction.plan() needs a mode of "quality" or "size", got ${JSON.stringify(mode)}.`,
        'This is a caller bug: walk options() before calling plan().',
      )
    }

    const stem = (source.path.split('/').pop() ?? 'file').replace(/\.[^.]+$/, '')
    const destination =
      typeof values.destination === 'string' ? values.destination : dirname(source.path)
    const output = `${destination}/${stem}${SUFFIX}${primaryExtension(source.format)}`

    return [
      {
        source,
        // The whole point: the format does not change.
        target: source.format,
        output,
        options: {
          background: '#ffffff',
          keepMetadata: false,
          ...(mode === 'quality' && typeof values.quality === 'number'
            ? { quality: values.quality }
            : {}),
        },
      },
    ]
  },
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run tests/core/actions-compress.test.ts && npm test`
Expected: PASS, and the existing suite unaffected.

- [ ] **Step 5: Commit**

```bash
git add src/core/actions/compress.ts tests/core/actions-compress.test.ts
git commit -m "feat(core): compress action, same format, quality or target size"
```

---

## Task 6: The command registry

**Files:**
- Create: `src/shell/commands.ts`
- Test: `tests/shell/commands.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  ```ts
  export interface Command { name: string; description: string; needsSource: boolean }
  export const COMMANDS: Command[]
  export function isCommandBuffer(text: string): boolean
  export function matchCommands(fragment: string): Command[]
  export function parseCommand(input: string): Command | undefined
  ```

- [ ] **Step 1: Write the failing tests**

Create `tests/shell/commands.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  COMMANDS,
  isCommandBuffer,
  matchCommands,
  parseCommand,
} from '../../src/shell/commands.js'

describe('isCommandBuffer', () => {
  it('is true only for a buffer that opens with a slash', () => {
    expect(isCommandBuffer('/')).toBe(true)
    expect(isCommandBuffer('/co')).toBe(true)
    expect(isCommandBuffer('')).toBe(false)
    expect(isCommandBuffer('photo.jpg')).toBe(false)
  })

  it('is false for a path that merely contains slashes', () => {
    // The single most common input to this prompt is an absolute path. It
    // must never open the palette.
    expect(isCommandBuffer('~/Desktop/a.png')).toBe(false)
    expect(isCommandBuffer('/Users/me/Desktop/a.png')).toBe(false)
    expect(isCommandBuffer('/tmp/x')).toBe(false)
  })
})

describe('matchCommands', () => {
  it('returns everything for an empty fragment', () => {
    expect(matchCommands('')).toEqual(COMMANDS)
  })

  it('prefix-matches, case-insensitively', () => {
    expect(matchCommands('co').map((c) => c.name)).toEqual(['convert', 'compress'])
    expect(matchCommands('CO').map((c) => c.name)).toEqual(['convert', 'compress'])
    expect(matchCommands('comp').map((c) => c.name)).toEqual(['compress'])
  })

  it('returns nothing for a fragment that matches nothing', () => {
    expect(matchCommands('zzz')).toEqual([])
  })
})

describe('parseCommand', () => {
  it('resolves an exact name', () => {
    expect(parseCommand('/compress')?.name).toBe('compress')
    expect(parseCommand('/theme')?.name).toBe('theme')
  })

  it('ignores case and surrounding space', () => {
    expect(parseCommand('  /Compress  ')?.name).toBe('compress')
  })

  it('returns undefined for an unknown command', () => {
    expect(parseCommand('/nope')).toBeUndefined()
    expect(parseCommand('not a command')).toBeUndefined()
  })
})

describe('the registry', () => {
  it('carries every command the shell can run', () => {
    expect(COMMANDS.map((c) => c.name).sort()).toEqual([
      'compress',
      'convert',
      'help',
      'theme',
    ])
  })

  it('gives every command a description, since the palette shows them', () => {
    for (const c of COMMANDS) expect(c.description.length).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run tests/shell/commands.test.ts`
Expected: FAIL — `Cannot find module '../../src/shell/commands.js'`.

- [ ] **Step 3: Implement**

Create `src/shell/commands.ts`:

```ts
export interface Command {
  /** Without the leading slash. */
  name: string
  /** Shown beside the name in the palette. */
  description: string
  /** Whether the command needs a staged file to mean anything. */
  needsSource: boolean
}

/**
 * Every command the shell knows, in the order the palette lists them.
 *
 * A list rather than a switch: the palette renders it, `/help` prints it, and
 * a new action adds one entry instead of touching three places. This is where
 * `/merge` and `/split` land when the PDF engine arrives.
 */
export const COMMANDS: Command[] = [
  { name: 'convert', description: "change a file's format", needsSource: true },
  { name: 'compress', description: 'make a file smaller', needsSource: true },
  { name: 'theme', description: 'switch between light and dark', needsSource: false },
  { name: 'help', description: 'list these commands', needsSource: false },
]

/**
 * Whether what has been typed is the start of a command rather than a path.
 *
 * A leading slash alone is not enough: `/Users/me/photo.png` is an absolute
 * path and the most common thing anyone types here. A command has no further
 * slashes and no spaces, which no absolute path can satisfy.
 */
export function isCommandBuffer(text: string): boolean {
  if (!text.startsWith('/')) return false
  const rest = text.slice(1)
  return !rest.includes('/') && !rest.includes(' ')
}

export function matchCommands(fragment: string): Command[] {
  const needle = fragment.trim().toLowerCase()
  if (needle === '') return COMMANDS
  return COMMANDS.filter((c) => c.name.startsWith(needle))
}

export function parseCommand(input: string): Command | undefined {
  const trimmed = input.trim().toLowerCase()
  if (!trimmed.startsWith('/')) return undefined
  const name = trimmed.slice(1)
  return COMMANDS.find((c) => c.name === name)
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run tests/shell/commands.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/shell/commands.ts tests/shell/commands.test.ts
git commit -m "feat(shell): command registry, with paths distinguished from commands"
```

---

## Task 7: The command palette

**Files:**
- Create: `src/shell/components/CommandPalette.tsx`
- Test: `tests/shell/command-palette.test.tsx`

**Interfaces:**
- Consumes: `Command`, `matchCommands` (Task 6); `Select` from
  `components/Select.js`; `useTheme`, `colourProp`.
- Produces:
  ```tsx
  export function CommandPalette(props: {
    fragment: string
    width: number
    onRun: (command: Command) => void
    onCancel: () => void
  }): JSX.Element | null
  ```

- [ ] **Step 1: Write the failing tests**

Create `tests/shell/command-palette.test.tsx`:

```tsx
import { render } from 'ink-testing-library'
import type { ReactElement } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { ThemeProvider } from '../../src/shell/ThemeContext.js'
import { CommandPalette } from '../../src/shell/components/CommandPalette.js'
import { DARK } from '../../src/shell/theme.js'

const ENTER = String.fromCharCode(13)
const DOWN = `${String.fromCharCode(27)}[B`
const settle = (ms = 80) => new Promise((r) => setTimeout(r, ms))

const show = (node: ReactElement) =>
  render(<ThemeProvider palette={DARK}>{node}</ThemeProvider>)

describe('CommandPalette', () => {
  it('lists every command for a bare slash', () => {
    const frame =
      show(<CommandPalette fragment="" width={80} onRun={() => {}} onCancel={() => {}} />)
        .lastFrame() ?? ''
    expect(frame).toContain('/convert')
    expect(frame).toContain('/compress')
    expect(frame).toContain('/theme')
    expect(frame).toContain('/help')
  })

  it('shows each description, which is what makes commands findable', () => {
    const frame =
      show(<CommandPalette fragment="" width={80} onRun={() => {}} onCancel={() => {}} />)
        .lastFrame() ?? ''
    expect(frame).toContain('make a file smaller')
  })

  it('narrows as the fragment grows', () => {
    const frame =
      show(<CommandPalette fragment="comp" width={80} onRun={() => {}} onCancel={() => {}} />)
        .lastFrame() ?? ''
    expect(frame).toContain('/compress')
    expect(frame).not.toContain('/theme')
  })

  it('runs the highlighted command on enter', async () => {
    const onRun = vi.fn()
    const { stdin } = show(
      <CommandPalette fragment="" width={80} onRun={onRun} onCancel={() => {}} />,
    )
    stdin.write(DOWN)
    await settle()
    stdin.write(ENTER)
    await settle()
    expect(onRun).toHaveBeenCalledWith(expect.objectContaining({ name: 'compress' }))
  })

  it('says so when nothing matches, rather than rendering an empty box', () => {
    const frame =
      show(<CommandPalette fragment="zzz" width={80} onRun={() => {}} onCancel={() => {}} />)
        .lastFrame() ?? ''
    expect(frame.toLowerCase()).toContain('no command')
  })

  it('never draws wider than the terminal', () => {
    for (const w of [40, 60, 80]) {
      const frame =
        show(<CommandPalette fragment="" width={w} onRun={() => {}} onCancel={() => {}} />)
          .lastFrame() ?? ''
      for (const line of frame.split(String.fromCharCode(10))) {
        expect(line.length).toBeLessThanOrEqual(w)
      }
    }
  })
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run tests/shell/command-palette.test.tsx`
Expected: FAIL — `Cannot find module '.../CommandPalette.js'`.

- [ ] **Step 3: Implement**

Create `src/shell/components/CommandPalette.tsx`:

```tsx
import { Box, Text } from 'ink'
import type { Choice } from '../../core/actions/index.js'
import { type Command, matchCommands } from '../commands.js'
import { useTheme } from '../ThemeContext.js'
import { colourProp } from '../theme.js'
import { Select } from './Select.js'

/**
 * The list that opens when the prompt buffer starts with `/`.
 *
 * Commands are only worth having if they can be found, and this is the whole
 * discovery mechanism — typing `/` is how anyone learns Forge does more than
 * convert. It reuses `Select`, so the cursor, the selection band and the
 * width budgeting are the same ones every other list in the shell uses.
 *
 * Rendered only while the buffer opens a command, so it costs nothing on the
 * ordinary path of dropping a file.
 */
export function CommandPalette({
  fragment,
  width,
  onRun,
  onCancel,
}: {
  /** What has been typed after the slash. */
  fragment: string
  width: number
  onRun: (command: Command) => void
  onCancel: () => void
}) {
  const palette = useTheme()
  const matches = matchCommands(fragment)

  if (matches.length === 0) {
    return (
      <Box marginBottom={1}>
        <Text color={colourProp(palette.dim)}>{`  no command matches /${fragment}`}</Text>
      </Box>
    )
  }

  const items: Choice[] = matches.map((c) => ({
    value: c.name,
    label: `/${c.name}`,
    hint: c.description,
  }))

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Select
        width={width}
        items={items}
        onSubmit={(name) => {
          const command = matches.find((c) => c.name === name)
          if (command) onRun(command)
        }}
        onCancel={onCancel}
      />
    </Box>
  )
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run tests/shell/command-palette.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/shell/components/CommandPalette.tsx tests/shell/command-palette.test.tsx
git commit -m "feat(shell): the / command palette"
```

---

## Task 8: Wire the palette into the prompt

**Files:**
- Modify: `src/shell/App.tsx`
- Test: `tests/shell/palette-flow.test.tsx`

**Interfaces:**
- Consumes: `CommandPalette` (Task 7), `isCommandBuffer`, `parseCommand`,
  `COMMANDS` (Task 6).
- Produces: `App` handles `/` in the idle prompt, and `/theme` no longer has a
  hardcoded branch in `submitPath`.

- [ ] **Step 1: Write the failing tests**

Create `tests/shell/palette-flow.test.tsx`:

```tsx
import { render } from 'ink-testing-library'
import { describe, expect, it } from 'vitest'
import { DEFAULT_PREFERENCES } from '../../src/config/preferences.js'
import { App } from '../../src/shell/App.js'

const ENTER = String.fromCharCode(13)
const settle = (ms = 120) => new Promise((r) => setTimeout(r, ms))
const prefs = { ...DEFAULT_PREFERENCES, theme: 'dark' as const }

describe('the palette in the prompt', () => {
  it('opens on a bare slash', async () => {
    const { stdin, lastFrame } = render(<App initialWidth={100} prefs={prefs} />)
    stdin.write('/')
    await settle()
    const frame = lastFrame() ?? ''
    expect(frame).toContain('/compress')
    expect(frame).toContain('/theme')
  })

  it('narrows as you type', async () => {
    const { stdin, lastFrame } = render(<App initialWidth={100} prefs={prefs} />)
    stdin.write('/comp')
    await settle()
    const frame = lastFrame() ?? ''
    expect(frame).toContain('/compress')
    expect(frame).not.toContain('/theme')
  })

  it('does not open for a path that contains slashes', async () => {
    const { stdin, lastFrame } = render(<App initialWidth={100} prefs={prefs} />)
    stdin.write('/Users/me/photo.png')
    await settle()
    expect(lastFrame() ?? '').not.toContain('make a file smaller')
  })

  it('closes when the slash is deleted', async () => {
    const BACKSPACE = String.fromCharCode(127)
    const { stdin, lastFrame } = render(<App initialWidth={100} prefs={prefs} />)
    stdin.write('/')
    await settle()
    expect(lastFrame() ?? '').toContain('/compress')
    stdin.write(BACKSPACE)
    await settle()
    expect(lastFrame() ?? '').not.toContain('make a file smaller')
  })

  it('runs /theme from the palette', async () => {
    const { stdin, lastFrame } = render(<App initialWidth={100} prefs={prefs} />)
    stdin.write('/theme')
    await settle()
    stdin.write(ENTER)
    await settle(200)
    const frame = lastFrame() ?? ''
    expect(frame).toContain('Dark')
    expect(frame).toContain('Light')
  })

  it('reports an unknown command instead of probing it as a file', async () => {
    const { stdin, lastFrame } = render(<App initialWidth={100} prefs={prefs} />)
    stdin.write('/nope')
    await settle()
    stdin.write(ENTER)
    await settle(200)
    const frame = lastFrame() ?? ''
    expect(frame.toLowerCase()).toContain('no command')
    expect(frame).not.toContain('could not be read')
  })

  it('/help lists the commands', async () => {
    const { stdin, lastFrame, frames } = render(<App initialWidth={100} prefs={prefs} />)
    stdin.write('/help')
    await settle()
    stdin.write(ENTER)
    await settle(200)
    const all = frames.join('') + (lastFrame() ?? '')
    expect(all).toContain('/convert')
    expect(all).toContain('/compress')
  })
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run tests/shell/palette-flow.test.tsx`
Expected: FAIL — the palette never appears.

- [ ] **Step 3: Implement**

In `src/shell/App.tsx`:

Add the imports:

```tsx
import { COMMANDS, type Command, isCommandBuffer, parseCommand } from './commands.js'
import { CommandPalette } from './components/CommandPalette.js'
```

Add a command dispatcher beside the other handlers:

```tsx
/**
 * Runs a command chosen from the palette or typed in full.
 *
 * `needsSource` decides what a command does with a file already on the bench:
 * `/compress` switches it into the compress flow, `/theme` ignores it.
 */
const runCommand = useCallback(
  (command: Command) => {
    setText('')
    if (command.name === 'theme') {
      setStage('theme')
      return
    }
    if (command.name === 'help') {
      push({
        kind: 'note',
        id: nextId(),
        text: COMMANDS.map((c) => `  /${c.name.padEnd(10)} ${c.description}`).join('\n'),
      })
      return
    }
    if (command.name === 'convert') {
      setMode('convert')
      setStage(source ? 'target' : 'idle')
      return
    }
    if (command.name === 'compress') {
      setMode('compress')
      setStage(source ? 'mode' : 'idle')
    }
  },
  [push, source],
)
```

Replace the hardcoded `/theme` branch in `submitPath` with command handling:

```tsx
if (isCommandBuffer(trimmed)) {
  const command = parseCommand(trimmed)
  if (command) {
    runCommand(command)
  } else {
    setText('')
    push({
      kind: 'note',
      id: nextId(),
      text: `no command matches ${trimmed} — try /help`,
    })
  }
  return
}
```

Render the palette above the prompt in the idle stage:

```tsx
{stage === 'idle' ? (
  <Box flexDirection="column">
    {isCommandBuffer(text) ? (
      <CommandPalette
        fragment={text.slice(1)}
        width={width}
        onRun={runCommand}
        onCancel={() => setText('')}
      />
    ) : null}
    <Prompt … />
```

> Ink delivers input to every mounted `useInput`, so `Prompt` and the
> palette's `Select` are both live while the palette is open. That is what
> makes typing narrow the list *and* the arrows move the selection. Enter
> reaches both: the palette runs the command and `Prompt` submits an empty
> buffer, which `submitPath` already ignores.

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run tests/shell/palette-flow.test.tsx && npm test`
Expected: PASS. The existing `theme-picker.test.tsx` must still pass — `/theme`
now arrives via the registry but behaves identically.

- [ ] **Step 5: Commit**

```bash
git add src/shell/App.tsx tests/shell/palette-flow.test.tsx
git commit -m "feat(shell): / opens the command palette; /theme moves into the registry"
```

---

## Task 9: The compress flow in the shell

**Files:**
- Modify: `src/shell/App.tsx`
- Test: `tests/shell/compress-flow.test.tsx`

**Interfaces:**
- Consumes: `compressAction` (Task 5), `parseSize` (Task 2), `findQuality`
  (Task 3), `encodeToBuffer` (Task 4).
- Produces: `Stage` gains `'mode'` and `'size'`; `App` holds
  `mode: 'convert' | 'compress'` and routes through the matching action.

- [ ] **Step 1: Write the failing tests**

Create `tests/shell/compress-flow.test.tsx`:

```tsx
import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { render } from 'ink-testing-library'
import { describe, expect, it } from 'vitest'
import { DEFAULT_PREFERENCES } from '../../src/config/preferences.js'
import { App } from '../../src/shell/App.js'
import { makeJpeg, makeTempDir } from '../helpers/fixtures.js'

const ENTER = String.fromCharCode(13)
const DOWN = `${String.fromCharCode(27)}[B`
const settle = (ms = 200) => new Promise((r) => setTimeout(r, ms))

/** Stages a file, then switches it into the compress flow. */
async function toCompress() {
  const dir = await makeTempDir()
  const jpg = await makeJpeg(dir, 'photo.jpg')
  const prefs = { ...DEFAULT_PREFERENCES, theme: 'dark' as const, defaultOutput: dir }
  const app = render(<App initialWidth={100} prefs={prefs} />)
  app.stdin.write(jpg)
  await settle()
  app.stdin.write(ENTER)
  await settle(400)
  app.stdin.write('/compress')
  await settle()
  app.stdin.write(ENTER)
  await settle(300)
  return { ...app, dir }
}

describe('compress in the shell', () => {
  it('asks how to compress', async () => {
    const { lastFrame } = await toCompress()
    const frame = lastFrame() ?? ''
    expect(frame).toContain('By quality')
    expect(frame).toContain('To a target size')
  })

  it('compresses by quality and writes a suffixed file', async () => {
    const { stdin, dir } = await toCompress()
    stdin.write(ENTER) // By quality
    await settle()
    stdin.write(ENTER) // accept the slider
    await settle()
    stdin.write(ENTER) // accept the destination
    await settle()
    stdin.write(ENTER) // accept the name
    await settle(900)

    const written = (await readdir(dir)).filter((f) => f !== 'photo.jpg')
    expect(written).toHaveLength(1)
    expect(written[0]).toContain('-small')
    expect(written[0]?.endsWith('.jpg')).toBe(true)
  })

  it('keeps the format — a compressed jpeg is still a jpeg', async () => {
    const { stdin, dir } = await toCompress()
    stdin.write(ENTER)
    await settle()
    stdin.write(ENTER)
    await settle()
    stdin.write(ENTER)
    await settle()
    stdin.write(ENTER)
    await settle(900)

    const written = (await readdir(dir)).find((f) => f.includes('-small'))
    const sharp = (await import('sharp')).default
    const meta = await sharp(join(dir, written ?? '')).metadata()
    expect(meta.format).toBe('jpeg')
  })

  it('takes a target size and lands under it', async () => {
    const { stdin, dir } = await toCompress()
    stdin.write(DOWN) // To a target size
    await settle()
    stdin.write(ENTER)
    await settle()
    stdin.write('2kb')
    await settle()
    stdin.write(ENTER)
    await settle()
    stdin.write(ENTER) // destination
    await settle()
    stdin.write(ENTER) // name
    await settle(1500)

    const written = (await readdir(dir)).find((f) => f.includes('-small'))
    expect(written).toBeDefined()
    const { size } = await stat(join(dir, written ?? ''))
    expect(size).toBeLessThanOrEqual(2048)
  }, 20_000)

  it('rejects a size it cannot parse, in the field', async () => {
    const { stdin, lastFrame } = await toCompress()
    stdin.write(DOWN)
    await settle()
    stdin.write(ENTER)
    await settle()
    stdin.write('banana')
    await settle()
    stdin.write(ENTER)
    await settle(300)
    const frame = lastFrame() ?? ''
    // Still on the size step, with something said about it.
    expect(frame).toContain('Target size')
  })

  it('/compress on a lossless source says why it cannot', async () => {
    const dir = await makeTempDir()
    const { makePng } = await import('../helpers/fixtures.js')
    const png = await makePng(dir, 'flat.png')
    const prefs = { ...DEFAULT_PREFERENCES, theme: 'dark' as const, defaultOutput: dir }
    const { stdin, lastFrame } = render(<App initialWidth={100} prefs={prefs} />)
    stdin.write(png)
    await settle()
    stdin.write(ENTER)
    await settle(400)
    stdin.write('/compress')
    await settle()
    stdin.write(ENTER)
    await settle(300)
    const frame = (lastFrame() ?? '').toLowerCase()
    expect(frame).toContain('png')
    expect(frame).toMatch(/lossless|convert/)
  })
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run tests/shell/compress-flow.test.tsx`
Expected: FAIL — `/compress` does nothing yet.

- [ ] **Step 3: Implement**

In `src/shell/App.tsx`:

Extend the stage union and add mode state:

```tsx
export type Stage =
  | 'theme'
  | 'idle'
  | 'mode'      // compress: by quality, or to a size
  | 'size'      // compress: the target size field
  | 'target'
  | 'quality'
  | 'destination'
  | 'rename'
  | 'overwrite'
  | 'converting'
  | 'result'

/** Which action the staged file is being put through. */
const [mode, setMode] = useState<'convert' | 'compress'>('convert')
const action = mode === 'compress' ? compressAction : convertAction
```

Point the `specs` memo at `action` rather than `convertAction`, and do the same
in `chooseTarget` and `convert`.

Guard `/compress` on a source it cannot serve, in `runCommand`:

```tsx
if (command.name === 'compress') {
  if (source && !compressAction.appliesTo(source)) {
    push({
      kind: 'error',
      id: nextId(),
      error: unsupportedCompress(source),
    })
    return
  }
  setMode('compress')
  setStage(source ? 'mode' : 'idle')
}
```

Add that error to `src/core/errors.ts`:

```ts
export function unsupportedCompress(source: SourceInfo): ForgeError {
  return new ForgeError({
    code: 'unsupported-compress',
    title: 'Nothing to compress',
    detail: `${basename(source.path)} is ${FORMATS[source.format].label}, which is lossless — there is no quality to trade away.`,
    hint: 'Use /convert to change it to a smaller format instead.',
  })
}
```

Add `'unsupported-compress'` to the `ErrorCode` union.

Render the two new stages, following the shape of the existing ones:

```tsx
{stage === 'mode' && source && modeSpec?.kind === 'select' ? (
  <Box flexDirection="column" marginBottom={1}>
    <Text color={colourProp(palette.label)}>{modeSpec.label}</Text>
    <Select
      width={width}
      items={modeSpec.choices}
      onSubmit={(chosen) => {
        setValues((v) => ({ ...v, mode: chosen }))
        setStage(chosen === 'size' ? 'size' : 'quality')
      }}
      onCancel={clearSource}
      showHints={band !== 'compact'}
    />
    <HintBar width={width} pairs={[['↑↓', 'choose'], ['↵', 'confirm'], ['esc', 'remove file']]} />
  </Box>
) : null}

{stage === 'size' && sizeSpec?.kind === 'text' ? (
  <Box flexDirection="column" marginBottom={1}>
    <Text color={colourProp(palette.label)}>{sizeSpec.label}</Text>
    <Prompt
      value={text}
      onChange={setText}
      onSubmit={submitSize}
      placeholder={sizeSpec.placeholder}
      isActive
      variant={band === 'compact' ? 'plain' : 'field'}
      width={width}
    />
    {sizeError ? (
      <Text color={colourProp(palette.warn)}>{`  ${SYMBOLS.warn} ${sizeError}`}</Text>
    ) : null}
    <HintBar width={width} pairs={[['↵', 'confirm'], ['ctrl-u', 'clear'], ['esc', 'back']]} />
  </Box>
) : null}
```

With the size submission validating in place rather than at conversion time:

```tsx
const [sizeError, setSizeError] = useState<string | undefined>(undefined)

const submitSize = (raw: string) => {
  const bytes = parseSize(raw)
  if (bytes === undefined) {
    // Stay on the field. Rejecting here rather than at conversion time is the
    // difference between a typo and a failed run.
    setSizeError(`${raw} is not a size. Try 500kb or 2mb.`)
    return
  }
  setSizeError(undefined)
  setValues((v) => ({ ...v, size: raw, targetBytes: bytes }))
  setText('')
  setStage('destination')
}
```

And in `convert`, when `values.targetBytes` is set, search before writing:

```tsx
if (typeof values.targetBytes === 'number') {
  setStage('converting')
  const found = await findQuality({
    encode: async (quality) =>
      (await encodeToBuffer(source, planned.target, { ...planned.options, quality })).length,
    targetBytes: values.targetBytes,
    onAttempt: (n, of) => setAttempt({ n, of }),
  })
  if (found.missed) {
    push({
      kind: 'error',
      id: nextId(),
      error: targetUnreachable(source, values.targetBytes, found.bytes),
    })
    setStage('idle')
    return
  }
  planned.options.quality = found.quality
}
```

Show the honest attempt counter in the converting stage:

```tsx
{stage === 'converting' ? (
  <Box marginBottom={1}>
    <Text color={colourProp(palette.dim)}>
      {attempt ? `Finding the right quality — attempt ${attempt.n} of ${attempt.of}…` : 'Converting…'}
    </Text>
  </Box>
) : null}
```

Add `targetUnreachable` to `errors.ts`:

```ts
export function targetUnreachable(
  source: SourceInfo,
  targetBytes: number,
  smallest: number,
): ForgeError {
  return new ForgeError({
    code: 'target-unreachable',
    title: 'Cannot get that small',
    detail: `${basename(source.path)} is ${formatBytes(smallest)} at the lowest quality, which is still over ${formatBytes(targetBytes)}.`,
    hint: 'Try a larger target, or /convert to a smaller format.',
  })
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run tests/shell/compress-flow.test.tsx && npm test`
Expected: PASS, and every existing shell test still green — the convert path
must be untouched.

- [ ] **Step 5: Commit**

```bash
git add src/shell/App.tsx src/core/errors.ts tests/shell/compress-flow.test.tsx
git commit -m "feat(shell): the compress flow, by quality or to a target size"
```

---

## Task 10: The measured format suggestion

**Files:**
- Create: `src/core/suggest.ts`
- Modify: `src/shell/App.tsx`, `src/shell/blocks.tsx`
- Test: `tests/core/suggest.test.ts`

**Interfaces:**
- Consumes: `targetIdsFor` from `core/capabilities.js`; `FORMATS`;
  `encodeToBuffer` (Task 4).
- Produces:
  ```ts
  export interface Suggestion { target: FormatId; bytes: number; saving: number }
  export function candidateFor(source: SourceInfo): FormatId | undefined
  export async function suggestFormat(args: {
    source: SourceInfo
    resultBytes: number
    quality: number
    encode: (target: FormatId, quality: number) => Promise<number>
  }): Promise<Suggestion | undefined>
  ```

- [ ] **Step 1: Write the failing tests**

Create `tests/core/suggest.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'
import { writableFormats } from '../../src/core/capabilities.js'
import { candidateFor, suggestFormat } from '../../src/core/suggest.js'
import type { SourceInfo } from '../../src/core/types.js'

const source = (over: Partial<SourceInfo> = {}): SourceInfo => ({
  path: '/tmp/photo.jpg',
  format: 'jpeg',
  width: 100,
  height: 100,
  bytes: 100_000,
  hasAlpha: false,
  frames: 1,
  ...over,
})

describe('candidateFor', () => {
  it('proposes WebP for a JPEG — supported everywhere, and much smaller', () => {
    expect(candidateFor(source({ format: 'jpeg' }))).toBe('webp')
  })

  it('proposes AVIF for a WebP, the only step up left', () => {
    expect(candidateFor(source({ format: 'webp' }))).toBe('avif')
  })

  it('has nothing to suggest when the source is already the strongest', () => {
    expect(candidateFor(source({ format: 'avif' }))).toBeUndefined()
  })

  it('never proposes a format the engine cannot write', () => {
    // Checked against targetIdsFor, so the suggestion cannot outrun the
    // capability graph.
    const candidate = candidateFor(source({ format: 'jpeg' }))
    if (candidate) expect(writableFormats()).toContain(candidate)
  })
})

describe('suggestFormat', () => {
  it('offers a candidate that is meaningfully smaller', async () => {
    const encode = vi.fn(async () => 400_000)
    const s = await suggestFormat({
      source: source(),
      resultBytes: 1_000_000,
      quality: 70,
      encode,
    })
    expect(s?.target).toBe('webp')
    expect(s?.bytes).toBe(400_000)
    expect(s?.saving).toBeCloseTo(0.6, 2)
    // Encoded, not estimated — the number quoted is one that was measured.
    expect(encode).toHaveBeenCalledWith('webp', 70)
  })

  it('stays quiet when the saving is not worth a sentence', async () => {
    const s = await suggestFormat({
      source: source(),
      resultBytes: 1_000_000,
      quality: 70,
      encode: async () => 900_000, // only 10% better
    })
    expect(s).toBeUndefined()
  })

  it('stays quiet when the candidate is larger', async () => {
    const s = await suggestFormat({
      source: source(),
      resultBytes: 1_000_000,
      quality: 70,
      encode: async () => 1_200_000,
    })
    expect(s).toBeUndefined()
  })

  it('does not encode at all when there is no candidate', async () => {
    const encode = vi.fn(async () => 1)
    const s = await suggestFormat({
      source: source({ format: 'avif' }),
      resultBytes: 1_000_000,
      quality: 70,
      encode,
    })
    expect(s).toBeUndefined()
    expect(encode).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run tests/core/suggest.test.ts`
Expected: FAIL — `Cannot find module '../../src/core/suggest.js'`.

- [ ] **Step 3: Implement**

Create `src/core/suggest.ts`:

```ts
import { targetIdsFor } from './capabilities.js'
import type { FormatId, SourceInfo } from './types.js'

/** Below this the sentence is not worth the line it costs. */
const WORTH_SAYING = 0.25

/**
 * What to propose for a given source, and nothing for a source that is
 * already there.
 *
 * WebP rather than AVIF for most sources on purpose: this is a suggestion
 * someone has to live with afterwards, and WebP is supported everywhere that
 * matters while AVIF still is not. A WebP source gets AVIF, because that is
 * the only step up left. An AVIF source gets nothing — there is no honest
 * sentence to write about converting AVIF to WebP.
 *
 * The naming here is a judgement about formats, not a capability list: the
 * candidate is checked against `targetIdsFor` before being returned, so a
 * format the engine cannot actually write is never proposed (invariant 2).
 */
export function candidateFor(source: SourceInfo): FormatId | undefined {
  if (source.format === 'avif') return undefined
  const wanted: FormatId = source.format === 'webp' ? 'avif' : 'webp'
  return targetIdsFor(source).includes(wanted) ? wanted : undefined
}

export interface Suggestion {
  target: FormatId
  bytes: number
  /** Fraction smaller than the result it is compared against, 0-1. */
  saving: number
}

/**
 * Whether another format would do meaningfully better, answered by encoding
 * one candidate and measuring it.
 *
 * `encode` is a parameter so this module stays free of Sharp, and so the
 * measurement is the caller's to make — but it *is* a measurement. Estimating
 * would mean quoting the user a number nobody computed, which is the same
 * offence as the fabricated progress spec §12 forbids.
 */
export async function suggestFormat(args: {
  source: SourceInfo
  resultBytes: number
  quality: number
  encode: (target: FormatId, quality: number) => Promise<number>
}): Promise<Suggestion | undefined> {
  const target = candidateFor(args.source)
  if (target === undefined) return undefined

  const bytes = await args.encode(target, args.quality)
  const saving = (args.resultBytes - bytes) / args.resultBytes
  if (saving < WORTH_SAYING) return undefined

  return { target, bytes, saving }
}
```

Wire it into `App.tsx` after a successful compress, and render it in the
result block as a warning-coloured line with a `w` keybinding that re-enters
the convert flow with that target preselected.

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run tests/core/suggest.test.ts && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/suggest.ts src/shell/App.tsx src/shell/blocks.tsx tests/core/suggest.test.ts
git commit -m "feat(core): offer a stronger format after compressing, measured not estimated"
```

---

## Task 11: The CLI surface

**Files:**
- Modify: `src/cli/args.ts`, `src/cli/execute.ts`
- Test: `tests/cli/compress-args.test.ts`

**Interfaces:**
- Consumes: `parseSize` (Task 2), `compressAction` (Task 5), `findQuality`
  (Task 3), `encodeToBuffer` (Task 4).
- Produces: `Intent` gains
  `{ kind: 'compress'; inputs: string[]; quality?: number; maxBytes?: number; … }`.

- [ ] **Step 1: Write the failing tests**

Create `tests/cli/compress-args.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { parseArgs } from '../../src/cli/args.js'
import { isForgeError } from '../../src/core/errors.js'

const codeOf = (fn: () => unknown): string | undefined => {
  try {
    fn()
  } catch (e) {
    return isForgeError(e) ? e.code : 'unknown'
  }
  return undefined
}

describe('compress via flags', () => {
  it('--quality without --to compresses', () => {
    const intent = parseArgs(['photo.jpg', '--quality', '60'])
    expect(intent.kind).toBe('compress')
    if (intent.kind !== 'compress') throw new Error('expected compress')
    expect(intent.quality).toBe(60)
    expect(intent.inputs).toEqual(['photo.jpg'])
  })

  it('--max-size compresses to fit', () => {
    const intent = parseArgs(['photo.jpg', '--max-size', '500kb'])
    if (intent.kind !== 'compress') throw new Error('expected compress')
    expect(intent.maxBytes).toBe(512_000)
  })

  it('--quality with --to is still a conversion, not a compression', () => {
    const intent = parseArgs(['photo.jpg', '--to', 'webp', '--quality', '60'])
    expect(intent.kind).toBe('convert')
  })

  it('rejects --quality and --max-size together', () => {
    // They answer the same question two ways; accepting both leaves the
    // precedence undefined.
    expect(codeOf(() => parseArgs(['a.jpg', '--quality', '60', '--max-size', '1mb']))).toBe(
      'invalid-arguments',
    )
  })

  it('rejects a size it cannot parse', () => {
    expect(codeOf(() => parseArgs(['a.jpg', '--max-size', 'banana']))).toBe('invalid-arguments')
  })

  it('rejects compression with no files', () => {
    expect(codeOf(() => parseArgs(['--quality', '60']))).toBe('invalid-arguments')
  })
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run tests/cli/compress-args.test.ts`
Expected: FAIL — `--quality` without `--to` currently throws "No target format
given".

- [ ] **Step 3: Implement**

In `src/cli/args.ts`, add the intent and the option, then branch before the
existing "no target format" error:

```ts
export interface CompressIntent {
  kind: 'compress'
  inputs: string[]
  quality?: number
  maxBytes?: number
  options: ConvertOptions
  force: boolean
  recursive: boolean
  concurrency?: number
  debug: boolean
}
```

Add `.option('--max-size <size>', 'compress until the file fits, e.g. 500kb')`
to the program, and after `const inputs = program.args`:

```ts
const wantsCompress = !opts.to && (opts.quality !== undefined || opts.maxSize !== undefined)

if (wantsCompress) {
  if (opts.quality !== undefined && opts.maxSize !== undefined) {
    throw invalidArguments(
      'Use either --quality or --max-size, not both.',
      'They are two ways of asking for the same thing, and Forge will not guess which wins.',
    )
  }
  if (inputs.length === 0) {
    throw invalidArguments(
      'No files given.',
      'Name a file, for example: forge photo.jpg --max-size 500kb',
    )
  }
  const maxBytes = opts.maxSize === undefined ? undefined : parseSize(String(opts.maxSize))
  if (opts.maxSize !== undefined && maxBytes === undefined) {
    throw invalidArguments(
      `${opts.maxSize} is not a size.`,
      'Try a number with a unit, for example 500kb, 2mb or 1.5mb.',
    )
  }
  // …assemble and return the CompressIntent
}
```

In `src/cli/execute.ts`, add a `compress` branch that resolves inputs the same
way conversion does, runs `findQuality` per file when `maxBytes` is set, and
reports through the existing `reportBatch` / `reportSingle`.

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run tests/cli/ && npm test`
Expected: PASS, with the existing arg tests unchanged.

- [ ] **Step 5: Commit**

```bash
git add src/cli tests/cli/compress-args.test.ts
git commit -m "feat(cli): --quality without --to compresses; --max-size compresses to fit"
```

---

## Task 12: Documentation

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Add the commands and compression sections**

After the Configuration section, add:

````markdown
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

## Compressing

`/compress` keeps the format and makes the file smaller. It never changes a
file's extension — that is what `/convert` is for.

Two ways to ask:

- **By quality** — pick a level on the slider and see what it produced.
- **To a target size** — say `500kb` and Forge searches for the highest
  quality that fits, reporting each attempt. If even the lowest quality
  overshoots, it writes nothing and tells you the smallest size achievable.

From the flag CLI:

```bash
forge photo.jpg --quality 60        # compress, same format
forge photo.jpg --max-size 500kb    # compress to fit
```

`--quality` without `--to` compresses; with `--to` it converts. The two are
mutually exclusive with `--max-size`.

Compression only applies to formats that have a quality dial. A PNG is
lossless, so there is nothing to trade away — `/convert` it to WebP instead.

After compressing, if another format would be meaningfully smaller, Forge says
so — and it encodes a candidate to find out rather than guessing.
````

- [ ] **Step 2: Verify the whole suite and the built binary**

```bash
npm test && npm run typecheck && npm run lint
npm run build && chmod +x dist/index.js
forge photo.jpg --quality 50
forge photo.jpg --max-size 100kb
forge                              # / opens the palette
```

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: commands and compression"
```

---

## Self-Review

**Spec coverage**

| Spec section | Task |
| --- | --- |
| §4 Command registry and palette | 6, 7, 8 |
| §5 Compress flow, mode step, size field, `-small` suffix | 5, 9 |
| §6 Target-size search, honest attempts, `missed` | 3, 9 |
| §7 Format suggestion, measured not estimated | 10 |
| §8 CLI `--quality` / `--max-size`, mutual exclusion | 11 |
| §9 `core/actions/` split | 1 |
| §10 Testing — every listed case | 2–11 |
| §11 Invariants — no hardcoded formats, no fabricated numbers | 3 (`maxAttempts`), 10 (`candidateFor` checked against `targetIdsFor`) |
| §12 Not in scope — resize, PDF, batch compress UI | absent by construction |

Two spec items needed tasks that were not obvious from its section list, and
have them: `parseSize` (§5's size field, Task 2) and `encodeToBuffer` (§6's
search needs an encoder that does not write, Task 4).

**Placeholder scan:** none. Every code step carries real code; no "add error
handling" or "similar to Task N".

**Type consistency:** `SearchRequest`/`SearchResult`/`findQuality`/
`maxAttempts` (Task 3) are used with those exact names in Tasks 9 and 11.
`encodeToBuffer(source, target, options)` (Task 4) is called with that
signature in Tasks 9, 10 and 11. `parseSize` (Task 2) is used in Tasks 9 and
11. `Command`/`matchCommands`/`parseCommand`/`isCommandBuffer` (Task 6) are
used in Tasks 7 and 8. `OptionSpec` gains its `text` variant in Task 1, which
is what Task 5 emits and Task 9 renders — that ordering matters and is why the
split comes first.

One bug this review caught and fixed: Task 10's first draft of `candidateFor`
walked a strength table and contradicted its own tests — it returned `avif`
for a JPEG where the test expected `webp`, and `webp` for an AVIF where the
test expected nothing. Traced by hand rather than assumed, and replaced with
the two-case rule now in the task.

One carried note: Task 1 registers a placeholder `compressAction` whose
`appliesTo` returns false, so the module graph is complete before Task 5 fills
it in. Task 5's first test failure is that placeholder, which is expected and
called out there.
