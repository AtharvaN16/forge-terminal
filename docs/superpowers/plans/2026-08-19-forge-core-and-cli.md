# Forge Core + CLI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the conversion core and the flag CLI, so that `forge photo.jpg --to webp` and batch conversion work end to end and are usable daily.

**Architecture:** A UI-free core (`src/core/`) holds types, the format capability graph, path resolution, job planning, and a bounded batch runner. A single Sharp-backed engine (`src/engines/image.ts`) sits behind an `Engine` interface. The CLI (`src/cli/`) is a thin layer that parses arguments, calls the core, and formats results. Nothing in `core/` or `engines/` writes to stdout or imports a UI library.

**Tech Stack:** Node 24, TypeScript (strict, ESM/NodeNext), Sharp 0.35.3, Commander, tinyglobby, Vitest, Biome.

**Spec:** [docs/superpowers/specs/2026-08-19-forge-design.md](../specs/2026-08-19-forge-design.md)

**Scope:** This plan covers spec phases 1–3. The interactive Ink shell (phases 4–5) is a separate subsystem consuming a then-stable core, and gets its own plan. This plan alone produces working, shippable software.

## Global Constraints

- Command name is `forge`. Product name is Convert. Package name `forge-terminal`.
- Node >= 20. ESM only (`"type": "module"`). TypeScript `strict: true`.
- Relative imports in `src/` **must** carry a `.js` extension (NodeNext ESM).
- Sharp's ESM types export named interfaces (`Metadata`, `Sharp`, `OutputInfo`),
  NOT a `sharp` namespace — the namespace exists only in its CJS typings. Use
  `import type { Metadata, Sharp } from 'sharp'`; `sharp.Metadata` fails with
  TS2503. Verified empirically at Task 5.
- TypeScript is **7.x**, not 5.x. TS7 does not auto-include every `/*`
  package, so `tsconfig.json` carries `"types": ["node"]` deliberately —
  without it, `import { basename } from 'node:path'` fails with TS2591.
  Do not remove it. Verified empirically at Task 3.
- `src/core/` and `src/engines/` import no React, no Ink, no Chalk, and never call `console.*` or write to stdout. They return data.
- No hardcoded list of output formats outside `src/core/formats.ts`. Targets come from `targetsFor(source)`.
- Sources are identified by file content, never by extension.
- `.rotate()` runs before every other Sharp operation.
- Alpha is flattened when the target format cannot carry it.
- All writes are atomic: temp file in the destination directory, then rename.
- Progress is never fabricated. Single-file conversion reports phases, not percentages.
- Never overwrite an existing file without `--force`.
- Raw stack traces reach the user only under `--debug`.
- Work on branch `dev`. Commit after every task.

### Verified facts this plan depends on

Measured on this machine with sharp 0.35.3 / libvips 8.18.3. Do not re-derive; do not assume otherwise.

| Fact | Value |
| --- | --- |
| AVIF | encodes and decodes |
| HEIC | decodes; **encode fails** with `heifsave: Unsupported compression` |
| Sharp format for HEIC *and* AVIF | both `'heif'`; separated by `metadata().compression` — `'hevc'`=HEIC, `'av1'`=AVIF |
| `metadata().pages` | `undefined` for stills, frame count for animated |
| `error.code` from Sharp | always `undefined` |
| Unreadable file vs corrupt file | **identical** Sharp message; must pre-check with `fs` |
| Missing file message | `Input file is missing: <path>` |
| Corrupt/unreadable message | `Input file contains unsupported image format` |
| `.rotate()` on animated input | safe — preserves page count |
| `.keepIccProfile()` with no ICC present | safe — does not throw |
| Animated GIF fixture recipe | `sharp(strip, { raw: { width, height: h*n, channels, pageHeight: h } }).gif()` |

---

### Task 1: Project skeleton

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`, `biome.json`
- Create: `src/index.ts`
- Test: `tests/smoke.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: working `npm run build`, `npm test`, `npm run lint`, `npm run typecheck`

- [ ] **Step 1: Initialise the package and install dependencies**

```bash
cd "/Users/atharvanayak/Developer/Convert Terminal"
git switch dev
npm init -y
npm i sharp commander tinyglobby
npm i -D typescript @types/node vitest @biomejs/biome tsx
npx @biomejs/biome init
```

- [ ] **Step 2: Write `package.json`**

Replace the generated file with this. Leave the `dependencies` and `devDependencies` blocks exactly as npm resolved them in Step 1 — do not hand-write versions.

```json
{
  "name": "forge-terminal",
  "version": "0.1.0",
  "description": "A terminal-native file converter for macOS",
  "type": "module",
  "bin": { "forge": "./dist/index.js" },
  "files": ["dist"],
  "engines": { "node": ">=20" },
  "license": "MIT",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "dev": "tsx src/index.ts",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "lint": "biome check src tests",
    "format": "biome format --write src tests"
  }
}
```

- [ ] **Step 3: Write `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "lib": ["ES2023"],
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "rootDir": "src",
    "outDir": "dist",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "verbatimModuleSyntax": true,
    "sourceMap": true,
    "skipLibCheck": true
  },
  "include": ["src"]
}
```

- [ ] **Step 4: Write `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    testTimeout: 20_000,
  },
})
```

- [ ] **Step 5: Configure Biome**

Open the `biome.json` that `biome init` generated and set the formatter section. Keep whatever `$schema` version it wrote — it matches the installed Biome.

```json
{
  "formatter": { "enabled": true, "indentStyle": "space", "indentWidth": 2, "lineWidth": 100 },
  "linter": { "enabled": true },
  "javascript": { "formatter": { "quoteStyle": "single", "semicolons": "asNeeded" } }
}
```

- [ ] **Step 6: Write the failing smoke test**

```ts
// tests/smoke.test.ts
import { describe, expect, it } from 'vitest'
import { VERSION } from '../src/index.js'

describe('package', () => {
  it('exposes a version', () => {
    expect(VERSION).toBe('0.1.0')
  })
})
```

- [ ] **Step 7: Run it and confirm it fails**

Run: `npm test`
Expected: FAIL — cannot resolve `../src/index.js`

- [ ] **Step 8: Write the minimal entry point**

```ts
// src/index.ts
export const VERSION = '0.1.0'
```

- [ ] **Step 9: Verify the whole toolchain is green**

```bash
npm test && npm run typecheck && npm run lint && npm run build
```

Expected: test passes, no type errors, no lint errors, `dist/index.js` exists.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "chore: project skeleton with typescript, vitest and biome"
```

---

### Task 2: Shared types, format registry, and unit formatting

**Files:**
- Create: `src/core/types.ts`, `src/core/formats.ts`, `src/core/units.ts`
- Test: `tests/core/formats.test.ts`, `tests/core/units.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `type FormatId = 'jpeg'|'png'|'webp'|'avif'|'heic'|'gif'|'tiff'`
  - `interface FormatSpec { id: FormatId; label: string; extensions: string[]; hasAlpha: boolean; animatable: boolean; lossy: boolean; hint: string }`
  - `interface SourceInfo { path: string; format: FormatId; width: number; height: number; bytes: number; hasAlpha: boolean; frames: number }`
  - `interface ConvertOptions { quality?: number; background: string; keepMetadata: boolean }`
  - `interface Job { source: SourceInfo; target: FormatId; output: string; options: ConvertOptions }`
  - `interface Warning { code: 'animation-flattened'; message: string }`
  - `interface Result { job: Job; outputBytes: number; warnings: Warning[] }`
  - `type Phase = 'reading'|'decoding'|'encoding'|'writing'`
  - `FORMATS: Record<FormatId, FormatSpec>`, `ALL_FORMAT_IDS: FormatId[]`
  - `formatById(id: string): FormatSpec | undefined`
  - `primaryExtension(id: FormatId): string`
  - `formatBytes(n: number): string`
  - `percentChange(from: number, to: number): { pct: number; direction: 'smaller'|'larger'|'same' }`

- [ ] **Step 1: Write the failing tests**

```ts
// tests/core/formats.test.ts
import { describe, expect, it } from 'vitest'
import { ALL_FORMAT_IDS, FORMATS, formatById, primaryExtension } from '../../src/core/formats.js'

describe('format registry', () => {
  it('knows all seven formats', () => {
    expect(ALL_FORMAT_IDS.sort()).toEqual(['avif', 'gif', 'heic', 'jpeg', 'png', 'tiff', 'webp'])
  })

  it('records that jpeg cannot carry alpha and png can', () => {
    expect(FORMATS.jpeg.hasAlpha).toBe(false)
    expect(FORMATS.png.hasAlpha).toBe(true)
  })

  it('records which formats can animate', () => {
    expect(FORMATS.gif.animatable).toBe(true)
    expect(FORMATS.webp.animatable).toBe(true)
    expect(FORMATS.png.animatable).toBe(false)
  })

  it('records which formats are lossy, which drives the quality option', () => {
    expect(FORMATS.jpeg.lossy).toBe(true)
    expect(FORMATS.webp.lossy).toBe(true)
    expect(FORMATS.avif.lossy).toBe(true)
    expect(FORMATS.png.lossy).toBe(false)
    expect(FORMATS.tiff.lossy).toBe(false)
  })

  it('resolves a format by id and returns undefined for nonsense', () => {
    expect(formatById('webp')?.label).toBe('WebP')
    expect(formatById('mp4')).toBeUndefined()
  })

  it('gives a primary extension for output filenames', () => {
    expect(primaryExtension('jpeg')).toBe('.jpg')
    expect(primaryExtension('webp')).toBe('.webp')
  })
})
```

```ts
// tests/core/units.test.ts
import { describe, expect, it } from 'vitest'
import { formatBytes, percentChange } from '../../src/core/units.js'

describe('formatBytes', () => {
  it('shows plain bytes below a kilobyte', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(940)).toBe('940 B')
  })

  it('drops the decimal once the number is big enough not to need it', () => {
    expect(formatBytes(820_000)).toBe('820 KB')
  })

  it('keeps one decimal for small values', () => {
    expect(formatBytes(4_200_000)).toBe('4.2 MB')
  })
})

describe('percentChange', () => {
  it('reports a reduction', () => {
    expect(percentChange(4_200_000, 820_000)).toEqual({ pct: 80.5, direction: 'smaller' })
  })

  it('reports growth', () => {
    expect(percentChange(100, 150)).toEqual({ pct: 50, direction: 'larger' })
  })

  it('reports no change', () => {
    expect(percentChange(100, 100)).toEqual({ pct: 0, direction: 'same' })
  })

  it('does not divide by zero', () => {
    expect(percentChange(0, 100)).toEqual({ pct: 0, direction: 'larger' })
  })
})
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npx vitest run tests/core/formats.test.ts tests/core/units.test.ts`
Expected: FAIL — modules not found

- [ ] **Step 3: Write `src/core/types.ts`**

```ts
export type FormatId = 'jpeg' | 'png' | 'webp' | 'avif' | 'heic' | 'gif' | 'tiff'

export interface FormatSpec {
  id: FormatId
  /** Human-facing name, e.g. "WebP". */
  label: string
  /** Primary extension first. */
  extensions: string[]
  hasAlpha: boolean
  animatable: boolean
  /** Drives whether the quality option applies. */
  lossy: boolean
  /** One short phrase shown beside the format in a picker. */
  hint: string
}

/** What a file actually is, determined by reading it — never by its extension. */
export interface SourceInfo {
  path: string
  format: FormatId
  width: number
  height: number
  bytes: number
  hasAlpha: boolean
  /** 1 for a still image, >1 for an animation. */
  frames: number
}

export interface ConvertOptions {
  /** 1-100. Ignored for lossless targets. */
  quality?: number
  /** CSS colour used when flattening alpha into a format that cannot carry it. */
  background: string
  keepMetadata: boolean
}

export interface Job {
  source: SourceInfo
  target: FormatId
  output: string
  options: ConvertOptions
}

export interface Warning {
  code: 'animation-flattened'
  message: string
}

export interface Result {
  job: Job
  outputBytes: number
  warnings: Warning[]
}

export type Phase = 'reading' | 'decoding' | 'encoding' | 'writing'
```

- [ ] **Step 4: Write `src/core/formats.ts`**

```ts
import type { FormatId, FormatSpec } from './types.js'

export const FORMATS: Record<FormatId, FormatSpec> = {
  jpeg: {
    id: 'jpeg', label: 'JPEG', extensions: ['.jpg', '.jpeg'],
    hasAlpha: false, animatable: false, lossy: true, hint: 'universal',
  },
  png: {
    id: 'png', label: 'PNG', extensions: ['.png'],
    hasAlpha: true, animatable: false, lossy: false, hint: 'lossless',
  },
  webp: {
    id: 'webp', label: 'WebP', extensions: ['.webp'],
    hasAlpha: true, animatable: true, lossy: true, hint: 'smaller, modern',
  },
  avif: {
    id: 'avif', label: 'AVIF', extensions: ['.avif'],
    hasAlpha: true, animatable: true, lossy: true, hint: 'smallest',
  },
  heic: {
    id: 'heic', label: 'HEIC', extensions: ['.heic', '.heif'],
    hasAlpha: true, animatable: false, lossy: true, hint: 'Apple photos',
  },
  gif: {
    id: 'gif', label: 'GIF', extensions: ['.gif'],
    hasAlpha: true, animatable: true, lossy: false, hint: 'animation',
  },
  tiff: {
    id: 'tiff', label: 'TIFF', extensions: ['.tif', '.tiff'],
    hasAlpha: true, animatable: false, lossy: false, hint: 'archival',
  },
}

export const ALL_FORMAT_IDS = Object.keys(FORMATS) as FormatId[]

export function formatById(id: string): FormatSpec | undefined {
  return (FORMATS as Record<string, FormatSpec | undefined>)[id.toLowerCase()]
}

export function primaryExtension(id: FormatId): string {
  const ext = FORMATS[id].extensions[0]
  if (!ext) throw new Error(`format ${id} declares no extensions`)
  return ext
}
```

- [ ] **Step 5: Write `src/core/units.ts`**

```ts
const KB = 1000
const MB = KB * 1000
const GB = MB * 1000

/**
 * Renders a byte count the way the CLI shows it: "940 B", "820 KB", "4.2 MB".
 * One decimal below 100, none above, because "820.0 KB" reads as noise.
 */
export function formatBytes(bytes: number): string {
  const [value, unit] =
    bytes >= GB ? [bytes / GB, 'GB'] :
    bytes >= MB ? [bytes / MB, 'MB'] :
    bytes >= KB ? [bytes / KB, 'KB'] :
    [bytes, 'B']

  if (unit === 'B') return `${Math.round(value)} B`
  const rendered = value >= 100 ? Math.round(value).toString() : (Math.round(value * 10) / 10).toString()
  return `${rendered} ${unit}`
}

export interface SizeChange {
  /** Absolute magnitude of the change, one decimal place. */
  pct: number
  direction: 'smaller' | 'larger' | 'same'
}

export function percentChange(from: number, to: number): SizeChange {
  if (from === to) return { pct: 0, direction: 'same' }
  if (from === 0) return { pct: 0, direction: 'larger' }
  const ratio = ((from - to) / from) * 100
  return {
    pct: Math.round(Math.abs(ratio) * 10) / 10,
    direction: ratio > 0 ? 'smaller' : 'larger',
  }
}
```

- [ ] **Step 6: Run the tests and confirm they pass**

Run: `npx vitest run tests/core/formats.test.ts tests/core/units.test.ts`
Expected: PASS, 10 tests

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(core): format registry, shared types and unit formatting"
```

---

### Task 3: Error taxonomy

**Files:**
- Create: `src/core/errors.ts`
- Test: `tests/core/errors.test.ts`

**Interfaces:**
- Consumes: `FormatId`, `SourceInfo` from `core/types.js`; `FORMATS` from `core/formats.js`
- Produces:
  - `type ErrorCode` (12 members, listed in the implementation below)
  - `class ForgeError extends Error` with readonly `code`, `title`, `detail`, `hint?`
  - constructors: `fileNotFound`, `notAFile`, `permissionDenied`, `unsupportedSource`, `unsupportedTarget`, `corruptSource`, `outputExists`, `outputIsInput`, `emptyDirectory`, `invalidArguments`, `conversionFailed`
  - `isForgeError(e: unknown): e is ForgeError`
  - `renderError(e: ForgeError, opts?: { debug?: boolean }): string[]`

- [ ] **Step 1: Write the failing test**

```ts
// tests/core/errors.test.ts
import { describe, expect, it } from 'vitest'
import {
  ForgeError, conversionFailed, corruptSource, fileNotFound, isForgeError,
  outputExists, permissionDenied, renderError, unsupportedTarget,
} from '../../src/core/errors.js'
import type { SourceInfo } from '../../src/core/types.js'

const source: SourceInfo = {
  path: '/tmp/photo.jpg', format: 'jpeg', width: 10, height: 10,
  bytes: 100, hasAlpha: false, frames: 1,
}

describe('ForgeError', () => {
  it('carries a code, a title, a detail and a hint', () => {
    const e = fileNotFound('photo.jpg')
    expect(e).toBeInstanceOf(ForgeError)
    expect(e.code).toBe('file-not-found')
    expect(e.title).toBe('File not found')
    expect(e.detail).toContain('photo.jpg')
    expect(e.hint).toBeTruthy()
  })

  it('is recognisable by a type guard', () => {
    expect(isForgeError(fileNotFound('a.jpg'))).toBe(true)
    expect(isForgeError(new Error('plain'))).toBe(false)
  })

  it('lists the available targets when the requested one is impossible', () => {
    const e = unsupportedTarget(source, 'mp4', ['webp', 'png', 'avif'])
    expect(e.code).toBe('unsupported-target')
    expect(e.detail).toContain('JPEG')
    expect(e.hint).toContain('webp, png, avif')
  })

  it('names the offending file for every file-scoped error', () => {
    expect(permissionDenied('/tmp/x.png').detail).toContain('x.png')
    expect(corruptSource('/tmp/x.png', new Error('boom')).detail).toContain('x.png')
    expect(outputExists('/tmp/out.webp').detail).toContain('out.webp')
  })

  it('suggests --force when the output already exists', () => {
    expect(outputExists('/tmp/out.webp').hint).toContain('--force')
  })
})

describe('renderError', () => {
  it('renders a symbol, a title, the detail and the hint', () => {
    const lines = renderError(fileNotFound('photo.jpg')).join('\n')
    expect(lines).toContain('✕ File not found')
    expect(lines).toContain('photo.jpg')
    expect(lines).toContain('Check the filename')
  })

  it('hides the underlying cause by default', () => {
    const e = conversionFailed('/tmp/x.png', new Error('vips exploded'))
    expect(renderError(e).join('\n')).not.toContain('vips exploded')
  })

  it('reveals the underlying cause under debug', () => {
    const e = conversionFailed('/tmp/x.png', new Error('vips exploded'))
    expect(renderError(e, { debug: true }).join('\n')).toContain('vips exploded')
  })
})
```

- [ ] **Step 2: Run and confirm it fails**

Run: `npx vitest run tests/core/errors.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write `src/core/errors.ts`**

```ts
import { basename } from 'node:path'
import { FORMATS } from './formats.js'
import type { FormatId, SourceInfo } from './types.js'

export type ErrorCode =
  | 'file-not-found'
  | 'not-a-file'
  | 'permission-denied'
  | 'unsupported-source'
  | 'unsupported-target'
  | 'corrupt-source'
  | 'output-exists'
  | 'output-is-input'
  | 'empty-directory'
  | 'invalid-arguments'
  | 'conversion-failed'
  | 'output-invalid'

interface ForgeErrorInit {
  code: ErrorCode
  title: string
  detail: string
  hint?: string
  cause?: unknown
}

export class ForgeError extends Error {
  readonly code: ErrorCode
  readonly title: string
  readonly detail: string
  readonly hint?: string

  constructor(init: ForgeErrorInit) {
    super(`${init.title}: ${init.detail}`, init.cause === undefined ? undefined : { cause: init.cause })
    this.name = 'ForgeError'
    this.code = init.code
    this.title = init.title
    this.detail = init.detail
    this.hint = init.hint
  }
}

export function isForgeError(e: unknown): e is ForgeError {
  return e instanceof ForgeError
}

export function fileNotFound(path: string): ForgeError {
  return new ForgeError({
    code: 'file-not-found',
    title: 'File not found',
    detail: `${basename(path)} could not be found.`,
    hint: 'Check the filename and try again.',
  })
}

export function notAFile(path: string): ForgeError {
  return new ForgeError({
    code: 'not-a-file',
    title: 'Not a file',
    detail: `${basename(path)} is not a file.`,
    hint: 'Point Forge at an image, or at a directory of images.',
  })
}

export function permissionDenied(path: string): ForgeError {
  return new ForgeError({
    code: 'permission-denied',
    title: 'Permission denied',
    detail: `${basename(path)} could not be read.`,
    hint: 'Check the file permissions and try again.',
  })
}

export function unsupportedSource(path: string, detected: string): ForgeError {
  return new ForgeError({
    code: 'unsupported-source',
    title: 'Unsupported file type',
    detail: `${basename(path)} is ${detected}, which Forge cannot read.`,
    hint: 'Forge 0.1 handles images only.',
  })
}

export function unsupportedTarget(
  source: SourceInfo,
  requested: string,
  available: FormatId[],
): ForgeError {
  return new ForgeError({
    code: 'unsupported-target',
    title: `Can't convert ${basename(source.path)} to ${requested}`,
    detail: `${basename(source.path)} is a ${FORMATS[source.format].label} image.`,
    hint: `Available: ${available.join(', ')}`,
  })
}

export function corruptSource(path: string, cause: unknown): ForgeError {
  return new ForgeError({
    code: 'corrupt-source',
    title: 'Damaged image',
    detail: `${basename(path)} could not be read as an image.`,
    hint: 'The file may be incomplete or corrupted.',
    cause,
  })
}

export function outputExists(path: string): ForgeError {
  return new ForgeError({
    code: 'output-exists',
    title: 'File already exists',
    detail: `${basename(path)} is already there.`,
    hint: 'Pass --force to replace it, or choose a different --output.',
  })
}

export function outputIsInput(path: string): ForgeError {
  return new ForgeError({
    code: 'output-is-input',
    title: 'Output would replace the original',
    detail: `${basename(path)} is both the input and the output.`,
    hint: 'Choose a different --output, or pass --force to overwrite in place.',
  })
}

export function outputInvalid(path: string, cause: unknown): ForgeError {
  return new ForgeError({
    code: 'output-invalid',
    title: 'Cannot write there',
    detail: `${path} could not be written to.`,
    hint: 'Check that the path is valid and that you have permission to write to it.',
    cause,
  })
}

export function emptyDirectory(path: string): ForgeError {
  return new ForgeError({
    code: 'empty-directory',
    title: 'No images found',
    detail: `${basename(path)} contains no images Forge can convert.`,
    hint: 'Try --recursive to look inside subfolders.',
  })
}

export function invalidArguments(detail: string, hint?: string): ForgeError {
  return new ForgeError({ code: 'invalid-arguments', title: 'Invalid arguments', detail, hint })
}

export function conversionFailed(path: string, cause: unknown): ForgeError {
  return new ForgeError({
    code: 'conversion-failed',
    title: 'Conversion failed',
    detail: `${basename(path)} could not be converted.`,
    hint: 'Run again with --debug for the underlying error.',
    cause,
  })
}

/**
 * Returns display lines rather than printing, so the core stays free of stdout.
 * The symbol is paired with a word so the meaning survives a monochrome terminal.
 */
export function renderError(e: ForgeError, opts: { debug?: boolean } = {}): string[] {
  const lines = [`✕ ${e.title}`, '', `  ${e.detail}`]
  if (e.hint) lines.push('', `  ${e.hint}`)
  if (opts.debug && e.cause instanceof Error) {
    lines.push('', `  ${e.cause.stack ?? e.cause.message}`)
  }
  return lines
}
```

- [ ] **Step 4: Run and confirm it passes**

Run: `npx vitest run tests/core/errors.test.ts`
Expected: PASS, 8 tests

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(core): human-readable error taxonomy"
```

---

### Task 4: Test fixture helpers

Fixtures are generated by Sharp at test time. No binary files are committed.

**Files:**
- Create: `tests/helpers/fixtures.ts`
- Test: `tests/helpers/fixtures.test.ts`

**Interfaces:**
- Consumes: nothing from the project; `sharp` directly
- Produces:
  - `makeTempDir(): Promise<string>`
  - `makePng(dir: string, name: string): Promise<string>`
  - `makeTransparentPng(dir: string, name: string): Promise<string>`
  - `makeJpeg(dir: string, name: string): Promise<string>`
  - `makeOrientedJpeg(dir: string, name: string, orientation: number): Promise<string>`
  - `makeAnimatedGif(dir: string, name: string, frames?: number): Promise<string>`
  - `makeCorruptFile(dir: string, name: string): Promise<string>`
  - `makeHeic(dir: string, name: string): Promise<string | null>` — returns `null` when `sips` is unavailable
  - `makeAvif(dir: string, name: string): Promise<string>`
  - `pixelAt(path: string, x: number, y: number): Promise<[number, number, number]>`

- [ ] **Step 1: Write `tests/helpers/fixtures.ts`**

```ts
import { execFile } from 'node:child_process'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import sharp from 'sharp'

const run = promisify(execFile)

export async function makeTempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'forge-test-'))
}

export async function makePng(dir: string, name: string): Promise<string> {
  const path = join(dir, name)
  await sharp({ create: { width: 40, height: 20, channels: 3, background: '#c86432' } })
    .png()
    .toFile(path)
  return path
}

export async function makeTransparentPng(dir: string, name: string): Promise<string> {
  const path = join(dir, name)
  await sharp({
    create: { width: 32, height: 32, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 0 } },
  })
    .png()
    .toFile(path)
  return path
}

export async function makeJpeg(dir: string, name: string): Promise<string> {
  const path = join(dir, name)
  await sharp({ create: { width: 40, height: 20, channels: 3, background: '#336699' } })
    .jpeg()
    .toFile(path)
  return path
}

/** Orientation 6 means "rotate 90° clockwise on display" — the classic phone-photo case. */
export async function makeOrientedJpeg(dir: string, name: string, orientation = 6): Promise<string> {
  const path = join(dir, name)
  const buffer = await sharp({
    create: { width: 40, height: 80, channels: 3, background: '#0000ff' },
  })
    .jpeg()
    .toBuffer()
  await sharp(buffer).withMetadata({ orientation }).jpeg().toFile(path)
  return path
}

/**
 * Sharp only treats raw input as multi-page when pageHeight sits inside the raw
 * options — the other three plausible spellings silently produce one tall frame.
 */
export async function makeAnimatedGif(dir: string, name: string, frames = 3): Promise<string> {
  const path = join(dir, name)
  const w = 8
  const h = 8
  const strip = Buffer.concat(
    Array.from({ length: frames }, (_, i) => Buffer.alloc(w * h * 3, 40 * (i + 1))),
  )
  await sharp(strip, { raw: { width: w, height: h * frames, channels: 3, pageHeight: h } })
    .gif()
    .toFile(path)
  return path
}

export async function makeCorruptFile(dir: string, name: string): Promise<string> {
  const path = join(dir, name)
  await writeFile(path, 'this is definitely not an image')
  return path
}

export async function makeAvif(dir: string, name: string): Promise<string> {
  const path = join(dir, name)
  await sharp({ create: { width: 24, height: 24, channels: 3, background: '#22aa55' } })
    .avif()
    .toFile(path)
  return path
}

/**
 * Sharp cannot encode HEIC, so the only way to get a genuine HEVC fixture is
 * macOS's built-in sips. Returns null elsewhere so tests can skip cleanly.
 */
export async function makeHeic(dir: string, name: string): Promise<string | null> {
  const source = await makePng(dir, `${name}.source.png`)
  const path = join(dir, name)
  try {
    await run('sips', ['-s', 'format', 'heic', source, '--out', path])
    return path
  } catch {
    return null
  }
}

export async function pixelAt(path: string, x: number, y: number): Promise<[number, number, number]> {
  const { data, info } = await sharp(path).raw().toBuffer({ resolveWithObject: true })
  const offset = (y * info.width + x) * info.channels
  return [data[offset] ?? 0, data[offset + 1] ?? 0, data[offset + 2] ?? 0]
}
```

- [ ] **Step 2: Write a test proving the fixtures are what they claim**

```ts
// tests/helpers/fixtures.test.ts
import { describe, expect, it } from 'vitest'
import sharp from 'sharp'
import {
  makeAnimatedGif, makeAvif, makeHeic, makeOrientedJpeg,
  makeTempDir, makeTransparentPng,
} from './fixtures.js'

describe('fixtures', () => {
  it('builds a genuinely animated gif', async () => {
    const dir = await makeTempDir()
    const gif = await makeAnimatedGif(dir, 'anim.gif', 3)
    expect((await sharp(gif).metadata()).pages).toBe(3)
  })

  it('builds a jpeg carrying exif orientation', async () => {
    const dir = await makeTempDir()
    const jpg = await makeOrientedJpeg(dir, 'rot.jpg', 6)
    expect((await sharp(jpg).metadata()).orientation).toBe(6)
  })

  it('builds a png with a real alpha channel', async () => {
    const dir = await makeTempDir()
    const png = await makeTransparentPng(dir, 't.png')
    expect((await sharp(png).metadata()).hasAlpha).toBe(true)
  })

  it('builds an avif that sharp reports as heif/av1', async () => {
    const dir = await makeTempDir()
    const avif = await makeAvif(dir, 'x.avif')
    const meta = await sharp(avif).metadata()
    expect(meta.format).toBe('heif')
    expect(meta.compression).toBe('av1')
  })

  it('builds a heic that sharp reports as heif/hevc, or skips off macOS', async () => {
    const dir = await makeTempDir()
    const heic = await makeHeic(dir, 'x.heic')
    if (!heic) return
    const meta = await sharp(heic).metadata()
    expect(meta.format).toBe('heif')
    expect(meta.compression).toBe('hevc')
  })
})
```

- [ ] **Step 3: Run and confirm the fixtures behave**

Run: `npx vitest run tests/helpers/fixtures.test.ts`
Expected: PASS, 5 tests

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "test: sharp-generated fixture helpers"
```

---

### Task 5: Engine interface and content-based probing

**Files:**
- Create: `src/engines/types.ts`, `src/engines/image.ts`, `src/engines/registry.ts`
- Test: `tests/engines/probe.test.ts`

**Interfaces:**
- Consumes: `SourceInfo`, `FormatId`, `Job`, `Result`, `Phase` from `core/types.js`; error constructors from `core/errors.js`
- Produces:
  - `interface Engine { id: string; reads: ReadonlySet<FormatId>; writes: ReadonlySet<FormatId>; probe(path: string): Promise<SourceInfo>; convert(job: Job, onPhase: (p: Phase) => void): Promise<Result> }`
  - `imageEngine: Engine`
  - `ENGINES: Engine[]`
  - `engineForSource(format: FormatId): Engine | undefined`
  - `probe(path: string): Promise<SourceInfo>` re-exported from `registry.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/engines/probe.test.ts
import { chmod, rename } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { isForgeError } from '../../src/core/errors.js'
import { probe } from '../../src/engines/registry.js'
import {
  makeAnimatedGif, makeAvif, makeCorruptFile, makeHeic,
  makeJpeg, makeTempDir, makeTransparentPng,
} from '../helpers/fixtures.js'

async function codeOf(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn()
  } catch (e) {
    return isForgeError(e) ? e.code : `unexpected:${String(e)}`
  }
  return 'no-error'
}

describe('probe', () => {
  it('reads dimensions, size and alpha', async () => {
    const dir = await makeTempDir()
    const info = await probe(await makeTransparentPng(dir, 'a.png'))
    expect(info.format).toBe('png')
    expect(info.width).toBe(32)
    expect(info.height).toBe(32)
    expect(info.hasAlpha).toBe(true)
    expect(info.bytes).toBeGreaterThan(0)
  })

  it('defaults frames to 1 for a still and counts them for an animation', async () => {
    const dir = await makeTempDir()
    expect((await probe(await makeJpeg(dir, 'a.jpg'))).frames).toBe(1)
    expect((await probe(await makeAnimatedGif(dir, 'a.gif', 3))).frames).toBe(3)
  })

  it('identifies by content, not by extension', async () => {
    const dir = await makeTempDir()
    const png = await makeTransparentPng(dir, 'real.png')
    const lying = join(dir, 'lying.jpg')
    await rename(png, lying)
    expect((await probe(lying)).format).toBe('png')
  })

  it('separates avif from heic, which sharp reports identically as heif', async () => {
    const dir = await makeTempDir()
    expect((await probe(await makeAvif(dir, 'a.avif'))).format).toBe('avif')
    const heic = await makeHeic(dir, 'a.heic')
    if (heic) expect((await probe(heic)).format).toBe('heic')
  })

  it('reports a missing file as file-not-found', async () => {
    expect(await codeOf(() => probe('/definitely/not/here.jpg'))).toBe('file-not-found')
  })

  it('reports a directory as not-a-file', async () => {
    const dir = await makeTempDir()
    expect(await codeOf(() => probe(dir))).toBe('not-a-file')
  })

  it('reports a corrupt file as corrupt-source', async () => {
    const dir = await makeTempDir()
    const bad = await makeCorruptFile(dir, 'bad.jpg')
    expect(await codeOf(() => probe(bad))).toBe('corrupt-source')
  })

  it('distinguishes unreadable from corrupt, which sharp alone cannot', async () => {
    const dir = await makeTempDir()
    const png = await makeTransparentPng(dir, 'locked.png')
    await chmod(png, 0o000)
    const code = await codeOf(() => probe(png))
    await chmod(png, 0o644)
    expect(code).toBe('permission-denied')
  })
})
```

- [ ] **Step 2: Run and confirm it fails**

Run: `npx vitest run tests/engines/probe.test.ts`
Expected: FAIL — modules not found

- [ ] **Step 3: Write `src/engines/types.ts`**

```ts
import type { FormatId, Job, Phase, Result, SourceInfo } from '../core/types.js'

/**
 * The seam that lets PDF, video and audio engines arrive later without the
 * UI changing. Everything the UI knows about capability comes from reads/writes.
 */
export interface Engine {
  id: string
  reads: ReadonlySet<FormatId>
  writes: ReadonlySet<FormatId>
  probe(path: string): Promise<SourceInfo>
  convert(job: Job, onPhase: (phase: Phase) => void): Promise<Result>
}
```

- [ ] **Step 4: Write the probe half of `src/engines/image.ts`**

The `convert` method is added in Task 7. For now it throws, so the module type-checks.

```ts
import { constants } from 'node:fs'
import { access, stat } from 'node:fs/promises'
import sharp from 'sharp'
import type { Metadata } from 'sharp'
import {
  corruptSource, fileNotFound, notAFile, permissionDenied, unsupportedSource,
} from '../core/errors.js'
import type { FormatId, Job, Phase, Result, SourceInfo } from '../core/types.js'
import type { Engine } from './types.js'

const READS: ReadonlySet<FormatId> = new Set<FormatId>([
  'jpeg', 'png', 'webp', 'avif', 'heic', 'gif', 'tiff',
])

/** heic is absent deliberately: sharp cannot encode HEVC. */
const WRITES: ReadonlySet<FormatId> = new Set<FormatId>([
  'jpeg', 'png', 'webp', 'avif', 'gif', 'tiff',
])

const DIRECT: Record<string, FormatId> = {
  jpeg: 'jpeg', png: 'png', webp: 'webp', gif: 'gif', tiff: 'tiff',
}

/**
 * Sharp reports HEIC and AVIF with the same format string. The compression
 * field is the only thing separating them, and getting it wrong would offer
 * HEIC as a writable target — which fails at encode time.
 */
function identify(path: string, meta: Metadata): FormatId {
  if (meta.format === 'heif') return meta.compression === 'av1' ? 'avif' : 'heic'
  const id = DIRECT[meta.format ?? '']
  if (!id) throw unsupportedSource(path, meta.format ?? 'an unknown format')
  return id
}

async function probe(path: string): Promise<SourceInfo> {
  let stats: Awaited<ReturnType<typeof stat>>
  try {
    stats = await stat(path)
  } catch (cause) {
    const code = (cause as NodeJS.ErrnoException).code
    if (code === 'ENOENT') throw fileNotFound(path)
    if (code === 'EACCES' || code === 'EPERM') throw permissionDenied(path)
    throw cause
  }

  if (!stats.isFile()) throw notAFile(path)

  // Sharp gives an unreadable file the same message as a corrupt one and never
  // sets error.code, so readability has to be established before it is involved.
  try {
    await access(path, constants.R_OK)
  } catch {
    throw permissionDenied(path)
  }

  let meta: Metadata
  try {
    meta = await sharp(path).metadata()
  } catch (cause) {
    throw corruptSource(path, cause)
  }

  return {
    path,
    format: identify(path, meta),
    width: meta.width ?? 0,
    height: meta.height ?? 0,
    bytes: stats.size,
    hasAlpha: meta.hasAlpha ?? false,
    frames: meta.pages ?? 1,
  }
}

async function convert(_job: Job, _onPhase: (phase: Phase) => void): Promise<Result> {
  throw new Error('not implemented until Task 7')
}

export const imageEngine: Engine = {
  id: 'image',
  reads: READS,
  writes: WRITES,
  probe,
  convert,
}
```

- [ ] **Step 5: Write `src/engines/registry.ts`**

```ts
import type { FormatId, SourceInfo } from '../core/types.js'
import { imageEngine } from './image.js'
import type { Engine } from './types.js'

export const ENGINES: Engine[] = [imageEngine]

export function engineForSource(format: FormatId): Engine | undefined {
  return ENGINES.find((e) => e.reads.has(format))
}

export function engineForTarget(format: FormatId): Engine | undefined {
  return ENGINES.find((e) => e.writes.has(format))
}

/** Probing is engine-agnostic: the first engine that can read the file wins. */
export async function probe(path: string): Promise<SourceInfo> {
  let lastError: unknown
  for (const engine of ENGINES) {
    try {
      return await engine.probe(path)
    } catch (e) {
      lastError = e
    }
  }
  throw lastError
}
```

- [ ] **Step 6: Run and confirm the tests pass**

Run: `npx vitest run tests/engines/probe.test.ts`
Expected: PASS, 8 tests

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(engines): engine interface and content-based probing"
```

---

### Task 6: Capability graph

**Files:**
- Create: `src/core/capabilities.ts`
- Test: `tests/core/capabilities.test.ts`

**Interfaces:**
- Consumes: `ENGINES` from `engines/registry.js`; `FORMATS` from `core/formats.js`
- Produces:
  - `interface Target { id: FormatId; label: string; hint: string; lossy: boolean }`
  - `targetsFor(source: SourceInfo): Target[]`
  - `targetIdsFor(source: SourceInfo): FormatId[]`
  - `canConvert(source: SourceInfo, target: FormatId): boolean`
  - `readableFormats(): FormatId[]`
  - `writableFormats(): FormatId[]`

- [ ] **Step 1: Write the failing test**

```ts
// tests/core/capabilities.test.ts
import { describe, expect, it } from 'vitest'
import { canConvert, readableFormats, targetIdsFor, writableFormats } from '../../src/core/capabilities.js'
import type { SourceInfo } from '../../src/core/types.js'

function source(format: SourceInfo['format']): SourceInfo {
  return { path: `/tmp/x.${format}`, format, width: 8, height: 8, bytes: 10, hasAlpha: false, frames: 1 }
}

describe('capability graph', () => {
  it('offers every writable format for a jpeg source', () => {
    expect(targetIdsFor(source('jpeg')).sort()).toEqual(['avif', 'gif', 'jpeg', 'png', 'tiff', 'webp'])
  })

  it('never offers heic as a target, because sharp cannot encode it', () => {
    for (const id of ['jpeg', 'png', 'heic', 'avif'] as const) {
      expect(targetIdsFor(source(id))).not.toContain('heic')
    }
  })

  it('reads heic even though it cannot write it', () => {
    expect(readableFormats()).toContain('heic')
    expect(writableFormats()).not.toContain('heic')
    expect(targetIdsFor(source('heic'))).toContain('png')
  })

  it('allows same-format conversion, which is what recompression will use', () => {
    expect(canConvert(source('jpeg'), 'jpeg')).toBe(true)
  })

  it('rejects a target no engine can write', () => {
    expect(canConvert(source('png'), 'heic')).toBe(false)
  })
})
```

- [ ] **Step 2: Run and confirm it fails**

Run: `npx vitest run tests/core/capabilities.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write `src/core/capabilities.ts`**

```ts
import { ENGINES } from '../engines/registry.js'
import { FORMATS } from './formats.js'
import type { FormatId, SourceInfo } from './types.js'

export interface Target {
  id: FormatId
  label: string
  hint: string
  lossy: boolean
}

function sortByRegistryOrder(ids: FormatId[]): FormatId[] {
  const order = Object.keys(FORMATS) as FormatId[]
  return [...ids].sort((a, b) => order.indexOf(a) - order.indexOf(b))
}

/**
 * The single source of truth for "what can this file become". Nothing else in
 * the codebase may hardcode a format list — a new engine has to change the
 * menu everywhere at once, and this is how that happens.
 */
export function targetIdsFor(source: SourceInfo): FormatId[] {
  const ids = new Set<FormatId>()
  for (const engine of ENGINES) {
    if (!engine.reads.has(source.format)) continue
    for (const id of engine.writes) ids.add(id)
  }
  return sortByRegistryOrder([...ids])
}

export function targetsFor(source: SourceInfo): Target[] {
  return targetIdsFor(source).map((id) => ({
    id,
    label: FORMATS[id].label,
    hint: FORMATS[id].hint,
    lossy: FORMATS[id].lossy,
  }))
}

export function canConvert(source: SourceInfo, target: FormatId): boolean {
  return targetIdsFor(source).includes(target)
}

export function readableFormats(): FormatId[] {
  const ids = new Set<FormatId>()
  for (const engine of ENGINES) for (const id of engine.reads) ids.add(id)
  return sortByRegistryOrder([...ids])
}

export function writableFormats(): FormatId[] {
  const ids = new Set<FormatId>()
  for (const engine of ENGINES) for (const id of engine.writes) ids.add(id)
  return sortByRegistryOrder([...ids])
}
```

- [ ] **Step 4: Run and confirm it passes**

Run: `npx vitest run tests/core/capabilities.test.ts`
Expected: PASS, 5 tests

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(core): computed capability graph"
```

---

### Task 7: Conversion — format pairs and atomic writes

**Files:**
- Modify: `src/engines/image.ts` (replace the stub `convert`)
- Test: `tests/engines/convert.test.ts`

**Interfaces:**
- Consumes: `Job`, `Result`, `Phase`, `ConvertOptions` from `core/types.js`; `FORMATS` from `core/formats.js`
- Produces: a working `imageEngine.convert(job, onPhase)`; internal `DEFAULT_QUALITY: Record<FormatId, number | undefined>`

- [ ] **Step 1: Write the failing test**

```ts
// tests/engines/convert.test.ts
import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { isForgeError } from '../../src/core/errors.js'
import type { FormatId, Job, Phase } from '../../src/core/types.js'
import { imageEngine } from '../../src/engines/image.js'
import { probe } from '../../src/engines/registry.js'
import { makeCorruptFile, makeJpeg, makePng, makeTempDir } from '../helpers/fixtures.js'

async function job(input: string, target: FormatId, output: string): Promise<Job> {
  return {
    source: await probe(input),
    target,
    output,
    options: { background: '#ffffff', keepMetadata: false },
  }
}

describe('convert — format pairs', () => {
  const pairs: Array<[string, FormatId, FormatId]> = [
    ['jpeg->png', 'jpeg', 'png'],
    ['jpeg->webp', 'jpeg', 'webp'],
    ['png->jpeg', 'png', 'jpeg'],
    ['png->webp', 'png', 'webp'],
    ['webp->jpeg', 'webp', 'jpeg'],
    ['webp->png', 'webp', 'png'],
  ]

  for (const [name, from, to] of pairs) {
    it(`converts ${name}`, async () => {
      const dir = await makeTempDir()
      const seed = from === 'jpeg' ? await makeJpeg(dir, 'seed.jpg') : await makePng(dir, 'seed.png')
      const input = from === 'webp' ? join(dir, 'seed.webp') : seed
      if (from === 'webp') await sharp(seed).webp().toFile(input)

      const out = join(dir, `out.${to}`)
      const result = await imageEngine.convert(await job(input, to, out), () => {})

      const meta = await sharp(out).metadata()
      expect(meta.format).toBe(to)
      expect(result.outputBytes).toBeGreaterThan(0)
      expect(result.outputBytes).toBe((await stat(out)).size)
    })
  }

  it('reports phases in order and never invents a percentage', async () => {
    const dir = await makeTempDir()
    const input = await makeJpeg(dir, 'a.jpg')
    const phases: Phase[] = []
    await imageEngine.convert(await job(input, 'webp', join(dir, 'a.webp')), (p) => phases.push(p))
    expect(phases).toEqual(['reading', 'decoding', 'encoding', 'writing'])
  })

  it('creates missing intermediate directories', async () => {
    const dir = await makeTempDir()
    const input = await makeJpeg(dir, 'a.jpg')
    const out = join(dir, 'deep', 'nested', 'a.webp')
    await imageEngine.convert(await job(input, 'webp', out), () => {})
    expect((await stat(out)).isFile()).toBe(true)
  })

  it('leaves no temp file behind when encoding fails', async () => {
    const dir = await makeTempDir()
    const good = await makeJpeg(dir, 'good.jpg')
    const source = await probe(good)
    const bad = await makeCorruptFile(dir, 'bad.bin')

    const doomed: Job = {
      source: { ...source, path: bad },
      target: 'webp',
      output: join(dir, 'out.webp'),
      options: { background: '#ffffff', keepMetadata: false },
    }

    await expect(imageEngine.convert(doomed, () => {})).rejects.toSatisfy(isForgeError)
    const leftovers = (await readdir(dir)).filter((f) => f.includes('.forge-tmp'))
    expect(leftovers).toEqual([])
  })
})
```

- [ ] **Step 2: Run and confirm it fails**

Run: `npx vitest run tests/engines/convert.test.ts`
Expected: FAIL — "not implemented until Task 7"

- [ ] **Step 3: Replace the stub `convert` in `src/engines/image.ts`**

Add these imports at the top of the file, alongside the existing ones:

```ts
import { randomBytes } from 'node:crypto'
import { mkdir, rename, rm } from 'node:fs/promises'
import type { Sharp } from 'sharp'
import { basename, dirname, join } from 'node:path'
import { conversionFailed, outputInvalid } from '../core/errors.js'
```

Then replace the stub with:

```ts
const DEFAULT_QUALITY: Partial<Record<FormatId, number>> = {
  jpeg: 82,
  webp: 80,
  avif: 50,
}

function encode(pipeline: Sharp, target: FormatId, quality?: number): Sharp {
  const q = quality ?? DEFAULT_QUALITY[target]
  switch (target) {
    case 'jpeg':
      return pipeline.jpeg({ quality: q, mozjpeg: true })
    case 'webp':
      return pipeline.webp({ quality: q })
    case 'avif':
      return pipeline.avif({ quality: q })
    case 'png':
      return pipeline.png({ effort: 7 })
    case 'gif':
      return pipeline.gif()
    case 'tiff':
      return pipeline.tiff()
    case 'heic':
      throw new Error('heic is not writable; the capability graph should have prevented this')
  }
}

/**
 * Writes via a sibling temp file and renames. A crash mid-encode can then never
 * leave a truncated file where a good one used to be, and overwriting in place
 * is safe because the original is only replaced once the new file is complete.
 */
async function writeAtomic(pipeline: Sharp, output: string): Promise<number> {
  const dir = dirname(output)
  try {
    await mkdir(dir, { recursive: true })
  } catch (cause) {
    throw outputInvalid(output, cause)
  }

  const temp = join(dir, `.forge-tmp-${randomBytes(6).toString('hex')}-${basename(output)}`)
  try {
    const info = await pipeline.toFile(temp)
    await rename(temp, output)
    return info.size
  } catch (cause) {
    await rm(temp, { force: true })
    throw cause
  }
}

async function convert(job: Job, onPhase: (phase: Phase) => void): Promise<Result> {
  onPhase('reading')
  onPhase('decoding')
  let pipeline = sharp(job.source.path)

  onPhase('encoding')
  pipeline = encode(pipeline, job.target, job.options.quality)

  onPhase('writing')
  try {
    const outputBytes = await writeAtomic(pipeline, job.output)
    return { job, outputBytes, warnings: [] }
  } catch (cause) {
    throw conversionFailed(job.source.path, cause)
  }
}
```

Note: `spec` is unused in this task and is consumed in Tasks 8 and 9. If the linter objects, leave the destructuring out until Task 8 adds its first use.

- [ ] **Step 4: Run and confirm the tests pass**

Run: `npx vitest run tests/engines/convert.test.ts`
Expected: PASS, 9 tests

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(engines): image conversion with atomic writes"
```

---

### Task 8: Correctness — EXIF orientation and alpha flattening

These two rules are the difference between a converter that works and one that quietly ruins files. Both failure modes were reproduced against sharp 0.35.3 before this plan was written.

**Files:**
- Modify: `src/engines/image.ts` (the `convert` pipeline)
- Test: `tests/engines/correctness.test.ts`

**Interfaces:**
- Consumes: everything from Task 7
- Produces: no new exports; behaviour change only

- [ ] **Step 1: Write the failing regression tests**

```ts
// tests/engines/correctness.test.ts
import { join } from 'node:path'
import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import type { FormatId, Job } from '../../src/core/types.js'
import { imageEngine } from '../../src/engines/image.js'
import { probe } from '../../src/engines/registry.js'
import {
  makeOrientedJpeg, makeTempDir, makeTransparentPng, pixelAt,
} from '../helpers/fixtures.js'

async function job(
  input: string,
  target: FormatId,
  output: string,
  options: Partial<Job['options']> = {},
): Promise<Job> {
  return {
    source: await probe(input),
    target,
    output,
    options: { background: '#ffffff', keepMetadata: false, ...options },
  }
}

describe('exif orientation', () => {
  it('rotates a 40x80 orientation-6 jpeg to 80x40, instead of leaving it sideways', async () => {
    const dir = await makeTempDir()
    const input = await makeOrientedJpeg(dir, 'rot.jpg', 6)
    const out = join(dir, 'rot.png')

    await imageEngine.convert(await job(input, 'png', out), () => {})

    const meta = await sharp(out).metadata()
    expect(meta.width).toBe(80)
    expect(meta.height).toBe(40)
  })

  it('leaves an unrotated image alone', async () => {
    const dir = await makeTempDir()
    const input = await makeOrientedJpeg(dir, 'plain.jpg', 1)
    const out = join(dir, 'plain.png')

    await imageEngine.convert(await job(input, 'png', out), () => {})

    const meta = await sharp(out).metadata()
    expect(meta.width).toBe(40)
    expect(meta.height).toBe(80)
  })
})

describe('alpha flattening', () => {
  it('turns transparency white when converting to jpeg, not black', async () => {
    const dir = await makeTempDir()
    const input = await makeTransparentPng(dir, 't.png')
    const out = join(dir, 't.jpg')

    await imageEngine.convert(await job(input, 'jpeg', out), () => {})

    const [r, g, b] = await pixelAt(out, 0, 0)
    expect(r).toBeGreaterThan(250)
    expect(g).toBeGreaterThan(250)
    expect(b).toBeGreaterThan(250)
  })

  it('honours a custom background colour', async () => {
    const dir = await makeTempDir()
    const input = await makeTransparentPng(dir, 't.png')
    const out = join(dir, 't-black.jpg')

    await imageEngine.convert(await job(input, 'jpeg', out, { background: '#000000' }), () => {})

    const [r, g, b] = await pixelAt(out, 0, 0)
    expect(r).toBeLessThan(5)
    expect(g).toBeLessThan(5)
    expect(b).toBeLessThan(5)
  })

  it('preserves transparency when the target can carry it', async () => {
    const dir = await makeTempDir()
    const input = await makeTransparentPng(dir, 't.png')
    const out = join(dir, 't.webp')

    await imageEngine.convert(await job(input, 'webp', out), () => {})

    expect((await sharp(out).metadata()).hasAlpha).toBe(true)
  })
})
```

- [ ] **Step 2: Run and confirm the first and third tests fail**

Run: `npx vitest run tests/engines/correctness.test.ts`
Expected: FAIL — orientation test reports 40x80, jpeg pixel test reports 0,0,0

- [ ] **Step 3: Add both rules to the pipeline in `src/engines/image.ts`**

First add the format registry import, which this task is the first to need:

```ts
import { FORMATS } from '../core/formats.js'
```

Then replace the opening of `convert`, up to `onPhase('encoding')`:

```ts
async function convert(job: Job, onPhase: (phase: Phase) => void): Promise<Result> {
  const spec = FORMATS[job.target]

  onPhase('reading')
  onPhase('decoding')
  let pipeline = sharp(job.source.path)

  // Rule 1: EXIF orientation, before anything else. Without this, photos from
  // phones emerge sideways — verified: a 40x80 orientation-6 jpeg stays 40x80.
  pipeline = pipeline.rotate()

  // Rule 2: JPEG has no alpha channel. Without an explicit flatten, sharp
  // composites transparent pixels onto black — verified: rgb(0,0,0).
  if (job.source.hasAlpha && !spec.hasAlpha) {
    pipeline = pipeline.flatten({ background: job.options.background })
  }
```

- [ ] **Step 4: Run and confirm all five pass**

Run: `npx vitest run tests/engines/correctness.test.ts`
Expected: PASS, 5 tests

- [ ] **Step 5: Run the whole suite to check nothing regressed**

Run: `npm test`
Expected: PASS, all tests

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "fix(engines): auto-orient from exif and flatten alpha for opaque targets"
```

---

### Task 9: Correctness — metadata and animation

**Files:**
- Modify: `src/engines/image.ts`
- Test: `tests/engines/metadata-animation.test.ts`

**Interfaces:**
- Consumes: everything from Task 8
- Produces: `Result.warnings` populated with `{ code: 'animation-flattened', message }`

- [ ] **Step 1: Write the failing test**

```ts
// tests/engines/metadata-animation.test.ts
import { join } from 'node:path'
import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import type { FormatId, Job } from '../../src/core/types.js'
import { imageEngine } from '../../src/engines/image.js'
import { probe } from '../../src/engines/registry.js'
import { makeAnimatedGif, makeOrientedJpeg, makeTempDir } from '../helpers/fixtures.js'

async function job(
  input: string,
  target: FormatId,
  output: string,
  options: Partial<Job['options']> = {},
): Promise<Job> {
  return {
    source: await probe(input),
    target,
    output,
    options: { background: '#ffffff', keepMetadata: false, ...options },
  }
}

describe('metadata', () => {
  it('strips exif by default, because phone photos carry gps coordinates', async () => {
    const dir = await makeTempDir()
    const input = await makeOrientedJpeg(dir, 'a.jpg', 6)
    const out = join(dir, 'a.webp')

    await imageEngine.convert(await job(input, 'webp', out), () => {})

    expect((await sharp(out).metadata()).exif).toBeUndefined()
  })

  it('preserves exif when asked', async () => {
    const dir = await makeTempDir()
    const input = await makeOrientedJpeg(dir, 'b.jpg', 6)
    const out = join(dir, 'b.webp')

    await imageEngine.convert(await job(input, 'webp', out, { keepMetadata: true }), () => {})

    expect((await sharp(out).metadata()).exif).toBeDefined()
  })
})

describe('animation', () => {
  it('keeps every frame when the target can animate', async () => {
    const dir = await makeTempDir()
    const input = await makeAnimatedGif(dir, 'a.gif', 3)
    const out = join(dir, 'a.webp')

    const result = await imageEngine.convert(await job(input, 'webp', out), () => {})

    expect((await sharp(out).metadata()).pages).toBe(3)
    expect(result.warnings).toEqual([])
  })

  it('warns rather than silently dropping frames when the target cannot animate', async () => {
    const dir = await makeTempDir()
    const input = await makeAnimatedGif(dir, 'b.gif', 3)
    const out = join(dir, 'b.png')

    const result = await imageEngine.convert(await job(input, 'png', out), () => {})

    expect(result.warnings).toHaveLength(1)
    expect(result.warnings[0]?.code).toBe('animation-flattened')
    expect(result.warnings[0]?.message).toContain('3 frames')
    expect(result.warnings[0]?.message).toContain('PNG')
  })

  it('says nothing about animation for a still image', async () => {
    const dir = await makeTempDir()
    const input = await makeOrientedJpeg(dir, 'c.jpg', 1)
    const result = await imageEngine.convert(await job(input, 'png', join(dir, 'c.png')), () => {})
    expect(result.warnings).toEqual([])
  })
})
```

- [ ] **Step 2: Run and confirm it fails**

Run: `npx vitest run tests/engines/metadata-animation.test.ts`
Expected: FAIL — keepMetadata test finds no exif; animation test finds 1 page and no warning

- [ ] **Step 3: Add both rules to `src/engines/image.ts`**

Add to the imports:

```ts
import type { Warning } from '../core/types.js'
```

Rewrite `convert` in full:

```ts
async function convert(job: Job, onPhase: (phase: Phase) => void): Promise<Result> {
  const spec = FORMATS[job.target]
  const warnings: Warning[] = []

  onPhase('reading')
  const isAnimated = job.source.frames > 1
  const keepFrames = isAnimated && spec.animatable

  // Rule 4: never drop frames silently.
  if (isAnimated && !spec.animatable) {
    warnings.push({
      code: 'animation-flattened',
      message:
        `${basename(job.source.path)} has ${job.source.frames} frames, ` +
        `and ${spec.label} cannot animate. Only the first frame was converted.`,
    })
  }

  onPhase('decoding')
  let pipeline = sharp(job.source.path, keepFrames ? { animated: true } : {})

  // Rule 1: EXIF orientation, before anything else. Verified safe on animated
  // input — page count survives.
  pipeline = pipeline.rotate()

  // Rule 2: composite onto a background when the target has no alpha channel.
  if (job.source.hasAlpha && !spec.hasAlpha) {
    pipeline = pipeline.flatten({ background: job.options.background })
  }

  // Rule 3: strip EXIF/GPS by default, always keep the colour profile so
  // colours do not shift on wide-gamut displays.
  pipeline = job.options.keepMetadata ? pipeline.keepMetadata() : pipeline.keepIccProfile()

  onPhase('encoding')
  pipeline = encode(pipeline, job.target, job.options.quality)

  onPhase('writing')
  try {
    const outputBytes = await writeAtomic(pipeline, job.output)
    return { job, outputBytes, warnings }
  } catch (cause) {
    throw conversionFailed(job.source.path, cause)
  }
}
```

- [ ] **Step 4: Run and confirm the tests pass**

Run: `npx vitest run tests/engines/metadata-animation.test.ts`
Expected: PASS, 5 tests

- [ ] **Step 5: Run everything**

Run: `npm test && npm run typecheck && npm run lint`
Expected: all green

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(engines): metadata policy and animation-aware conversion"
```

---

### Task 10: Output path resolution

**Files:**
- Create: `src/core/output-path.ts`
- Test: `tests/core/output-path.test.ts`

**Interfaces:**
- Consumes: `primaryExtension` from `core/formats.js`
- Produces:
  - `interface OutputRequest { sourcePath: string; target: FormatId; output?: string; sourceRoot?: string }`
  - `resolveOutputPath(req: OutputRequest): string`
  - `looksLikeDirectory(p: string): boolean`

- [ ] **Step 1: Write the failing test**

```ts
// tests/core/output-path.test.ts
import { mkdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveOutputPath } from '../../src/core/output-path.js'
import { makeTempDir } from '../helpers/fixtures.js'

describe('resolveOutputPath', () => {
  it('defaults to the source folder with a swapped extension', () => {
    expect(resolveOutputPath({ sourcePath: '/a/b/photo.jpg', target: 'webp' }))
      .toBe(resolve('/a/b/photo.webp'))
  })

  it('uses .jpg rather than .jpeg for the jpeg target', () => {
    expect(resolveOutputPath({ sourcePath: '/a/photo.png', target: 'jpeg' }))
      .toBe(resolve('/a/photo.jpg'))
  })

  it('treats a trailing slash as a directory', () => {
    expect(resolveOutputPath({ sourcePath: '/a/photo.jpg', target: 'webp', output: '/out/' }))
      .toBe(resolve('/out/photo.webp'))
  })

  it('treats an existing directory as a directory even without a trailing slash', async () => {
    const dir = await makeTempDir()
    expect(resolveOutputPath({ sourcePath: '/a/photo.jpg', target: 'webp', output: dir }))
      .toBe(join(dir, 'photo.webp'))
  })

  it('treats a path with an extension as an explicit filename', () => {
    expect(resolveOutputPath({ sourcePath: '/a/photo.jpg', target: 'webp', output: '/out/x.webp' }))
      .toBe(resolve('/out/x.webp'))
  })

  it('honours an explicit filename whose extension disagrees with the target', () => {
    expect(resolveOutputPath({ sourcePath: '/a/photo.jpg', target: 'webp', output: '/out/x.bin' }))
      .toBe(resolve('/out/x.bin'))
  })

  it('recreates the source tree under the output directory when a root is given', () => {
    expect(resolveOutputPath({
      sourcePath: '/src/deep/nested/photo.jpg',
      target: 'webp',
      output: '/out/',
      sourceRoot: '/src',
    })).toBe(resolve('/out/deep/nested/photo.webp'))
  })

  it('flattens into the output directory when no root is given', () => {
    expect(resolveOutputPath({
      sourcePath: '/src/deep/nested/photo.jpg',
      target: 'webp',
      output: '/out/',
    })).toBe(resolve('/out/photo.webp'))
  })

  it('keeps a filename that contains dots', () => {
    expect(resolveOutputPath({ sourcePath: '/a/my.holiday.photo.jpg', target: 'png' }))
      .toBe(resolve('/a/my.holiday.photo.png'))
  })
})
```

- [ ] **Step 2: Run and confirm it fails**

Run: `npx vitest run tests/core/output-path.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write `src/core/output-path.ts`**

```ts
import { existsSync, statSync } from 'node:fs'
import { basename, extname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { primaryExtension } from './formats.js'
import type { FormatId } from './types.js'

export interface OutputRequest {
  sourcePath: string
  target: FormatId
  /** A directory or an explicit filename. Absent means "beside the source". */
  output?: string
  /** When set with --recursive, the tree below this root is recreated. */
  sourceRoot?: string
}

/**
 * A trailing separator always means directory. An existing directory on disk
 * also means directory. Anything else with no extension is treated as a
 * directory too, because `-o dist` is far more often a folder than a file.
 */
export function looksLikeDirectory(p: string): boolean {
  if (p.endsWith('/') || p.endsWith(sep)) return true
  if (existsSync(p) && statSync(p).isDirectory()) return true
  return extname(p) === ''
}

function swapExtension(path: string, target: FormatId): string {
  const name = basename(path)
  const ext = extname(name)
  const stem = ext ? name.slice(0, -ext.length) : name
  return stem + primaryExtension(target)
}

export function resolveOutputPath(req: OutputRequest): string {
  const source = resolve(req.sourcePath)
  const filename = swapExtension(source, req.target)

  if (!req.output) return join(resolve(source, '..'), filename)

  const output = isAbsolute(req.output) ? req.output : resolve(req.output)

  if (!looksLikeDirectory(req.output)) return resolve(output)

  if (req.sourceRoot) {
    const root = resolve(req.sourceRoot)
    const rel = relative(root, resolve(source, '..'))
    if (rel && !rel.startsWith('..')) return join(output, rel, filename)
  }

  return join(output, filename)
}
```

- [ ] **Step 4: Run and confirm it passes**

Run: `npx vitest run tests/core/output-path.test.ts`
Expected: PASS, 9 tests

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(core): output path resolution"
```

---

### Task 11: Input resolution — files, globs and directories

**Files:**
- Create: `src/core/resolve.ts`
- Test: `tests/core/resolve.test.ts`

**Interfaces:**
- Consumes: `probe` from `engines/registry.js`; `FORMATS` from `core/formats.js`; `emptyDirectory` from `core/errors.js`
- Produces:
  - `interface ResolvedInput { sources: SourceInfo[]; failures: Array<{ path: string; error: ForgeError }>; roots: Map<string, string> }`
  - `resolveInputs(patterns: string[], opts: { recursive: boolean }): Promise<ResolvedInput>`

- [ ] **Step 1: Write the failing test**

```ts
// tests/core/resolve.test.ts
import { mkdir, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveInputs } from '../../src/core/resolve.js'
import { makeCorruptFile, makeJpeg, makePng, makeTempDir } from '../helpers/fixtures.js'

const names = (paths: { path: string }[]) => paths.map((s) => basename(s.path)).sort()

describe('resolveInputs', () => {
  it('resolves a single explicit file', async () => {
    const dir = await makeTempDir()
    const a = await makeJpeg(dir, 'a.jpg')
    const { sources } = await resolveInputs([a], { recursive: false })
    expect(names(sources)).toEqual(['a.jpg'])
  })

  it('resolves several explicit files', async () => {
    const dir = await makeTempDir()
    await makeJpeg(dir, 'a.jpg')
    await makePng(dir, 'b.png')
    const { sources } = await resolveInputs([join(dir, 'a.jpg'), join(dir, 'b.png')], { recursive: false })
    expect(names(sources)).toEqual(['a.jpg', 'b.png'])
  })

  it('expands a quoted glob itself', async () => {
    const dir = await makeTempDir()
    await makeJpeg(dir, 'a.jpg')
    await makeJpeg(dir, 'b.jpg')
    await makePng(dir, 'c.png')
    const { sources } = await resolveInputs([join(dir, '*.jpg')], { recursive: false })
    expect(names(sources)).toEqual(['a.jpg', 'b.jpg'])
  })

  it('scans a directory one level deep by default', async () => {
    const dir = await makeTempDir()
    await makeJpeg(dir, 'top.jpg')
    await mkdir(join(dir, 'sub'))
    await makeJpeg(join(dir, 'sub'), 'deep.jpg')
    const { sources } = await resolveInputs([dir], { recursive: false })
    expect(names(sources)).toEqual(['top.jpg'])
  })

  it('descends when recursive', async () => {
    const dir = await makeTempDir()
    await makeJpeg(dir, 'top.jpg')
    await mkdir(join(dir, 'sub'))
    await makeJpeg(join(dir, 'sub'), 'deep.jpg')
    const { sources } = await resolveInputs([dir], { recursive: true })
    expect(names(sources)).toEqual(['deep.jpg', 'top.jpg'])
  })

  it('records the scan root of a directory so the tree can be recreated', async () => {
    const dir = await makeTempDir()
    const a = await makeJpeg(dir, 'a.jpg')
    const { roots } = await resolveInputs([dir], { recursive: true })
    expect(roots.get(a)).toBe(dir)
  })

  it('skips non-images inside a directory without complaining', async () => {
    const dir = await makeTempDir()
    await makeJpeg(dir, 'a.jpg')
    await writeFile(join(dir, 'notes.txt'), 'hello')
    const { sources, failures } = await resolveInputs([dir], { recursive: false })
    expect(names(sources)).toEqual(['a.jpg'])
    expect(failures).toEqual([])
  })

  it('reports an explicitly named bad file as a failure and keeps going', async () => {
    const dir = await makeTempDir()
    const good = await makeJpeg(dir, 'good.jpg')
    const bad = await makeCorruptFile(dir, 'bad.jpg')
    const { sources, failures } = await resolveInputs([good, bad], { recursive: false })
    expect(names(sources)).toEqual(['good.jpg'])
    expect(failures).toHaveLength(1)
    expect(failures[0]?.error.code).toBe('corrupt-source')
  })

  it('raises empty-directory when a folder holds nothing convertible', async () => {
    const dir = await makeTempDir()
    await writeFile(join(dir, 'notes.txt'), 'hello')
    const { failures } = await resolveInputs([dir], { recursive: false })
    expect(failures[0]?.error.code).toBe('empty-directory')
  })

  it('deduplicates a file named twice', async () => {
    const dir = await makeTempDir()
    const a = await makeJpeg(dir, 'a.jpg')
    const { sources } = await resolveInputs([a, a], { recursive: false })
    expect(sources).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Run and confirm it fails**

Run: `npx vitest run tests/core/resolve.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write `src/core/resolve.ts`**

```ts
import { stat } from 'node:fs/promises'
import { resolve as resolvePath } from 'node:path'
import { glob } from 'tinyglobby'
import { probe } from '../engines/registry.js'
import { type ForgeError, emptyDirectory, fileNotFound, isForgeError } from './errors.js'
import { FORMATS } from './formats.js'
import type { SourceInfo } from './types.js'

export interface InputFailure {
  path: string
  error: ForgeError
}

export interface ResolvedInput {
  sources: SourceInfo[]
  failures: InputFailure[]
  /** source path -> the directory it was discovered under, for tree recreation. */
  roots: Map<string, string>
}

const IMAGE_EXTENSIONS = Object.values(FORMATS)
  .flatMap((f) => f.extensions)
  .map((e) => e.slice(1))

function isGlob(pattern: string): boolean {
  return /[*?[\]{}]/.test(pattern)
}

async function directoryEntries(dir: string, recursive: boolean): Promise<string[]> {
  const pattern = recursive ? `**/*.{${IMAGE_EXTENSIONS.join(',')}}` : `*.{${IMAGE_EXTENSIONS.join(',')}}`
  const found = await glob([pattern], { cwd: dir, absolute: true, onlyFiles: true, caseSensitiveMatch: false })
  return found.sort()
}

/**
 * Explicitly named files report their problems; files merely discovered by a
 * scan are skipped silently, because a stray .txt in a photo folder is not an
 * error the user asked about.
 */
export async function resolveInputs(
  patterns: string[],
  opts: { recursive: boolean },
): Promise<ResolvedInput> {
  const sources: SourceInfo[] = []
  const failures: InputFailure[] = []
  const roots = new Map<string, string>()
  const seen = new Set<string>()

  const add = async (path: string, root: string | undefined, explicit: boolean) => {
    const abs = resolvePath(path)
    if (seen.has(abs)) return
    seen.add(abs)
    try {
      sources.push(await probe(abs))
      if (root) roots.set(abs, root)
    } catch (e) {
      if (explicit && isForgeError(e)) failures.push({ path: abs, error: e })
      else if (explicit) throw e
    }
  }

  for (const pattern of patterns) {
    if (isGlob(pattern)) {
      const matches = await glob([pattern], { absolute: true, onlyFiles: true })
      for (const m of matches.sort()) await add(m, undefined, false)
      continue
    }

    const abs = resolvePath(pattern)
    let stats: Awaited<ReturnType<typeof stat>>
    try {
      stats = await stat(abs)
    } catch {
      failures.push({ path: abs, error: fileNotFound(abs) })
      continue
    }

    if (stats.isDirectory()) {
      const entries = await directoryEntries(abs, opts.recursive)
      if (entries.length === 0) {
        failures.push({ path: abs, error: emptyDirectory(abs) })
        continue
      }
      for (const entry of entries) await add(entry, abs, false)
      continue
    }

    await add(abs, undefined, true)
  }

  return { sources, failures, roots }
}
```

- [ ] **Step 4: Run and confirm it passes**

Run: `npx vitest run tests/core/resolve.test.ts`
Expected: PASS, 10 tests

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(core): resolve files, globs and directories into sources"
```

---

### Task 12: Job planning

**Files:**
- Create: `src/core/plan.ts`
- Test: `tests/core/plan.test.ts`

**Interfaces:**
- Consumes: `canConvert`, `targetIdsFor` from `core/capabilities.js`; `resolveOutputPath` from `core/output-path.js`; errors
- Produces:
  - `interface PlanRequest { resolved: ResolvedInput; target: FormatId; output?: string; options: ConvertOptions; force: boolean }`
  - `interface Plan { jobs: Job[]; failures: InputFailure[] }`
  - `buildPlan(req: PlanRequest): Promise<Plan>`

- [ ] **Step 1: Write the failing test**

```ts
// tests/core/plan.test.ts
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildPlan } from '../../src/core/plan.js'
import { resolveInputs } from '../../src/core/resolve.js'
import type { ConvertOptions } from '../../src/core/types.js'
import { makeJpeg, makePng, makeTempDir } from '../helpers/fixtures.js'

const options: ConvertOptions = { background: '#ffffff', keepMetadata: false }

describe('buildPlan', () => {
  it('produces one job per source with a default output beside it', async () => {
    const dir = await makeTempDir()
    const a = await makeJpeg(dir, 'a.jpg')
    const resolved = await resolveInputs([a], { recursive: false })
    const plan = await buildPlan({ resolved, target: 'webp', options, force: false })
    expect(plan.jobs).toHaveLength(1)
    expect(plan.jobs[0]?.output).toBe(join(dir, 'a.webp'))
  })

  it('rejects an impossible target and names the possible ones', async () => {
    const dir = await makeTempDir()
    const a = await makeJpeg(dir, 'a.jpg')
    const resolved = await resolveInputs([a], { recursive: false })
    const plan = await buildPlan({ resolved, target: 'heic', options, force: false })
    expect(plan.jobs).toHaveLength(0)
    expect(plan.failures[0]?.error.code).toBe('unsupported-target')
    expect(plan.failures[0]?.error.hint).toContain('webp')
  })

  it('refuses to overwrite an existing output without force', async () => {
    const dir = await makeTempDir()
    const a = await makeJpeg(dir, 'a.jpg')
    await makePng(dir, 'a.png')
    const resolved = await resolveInputs([a], { recursive: false })
    const plan = await buildPlan({ resolved, target: 'png', options, force: false })
    expect(plan.failures[0]?.error.code).toBe('output-exists')
  })

  it('allows the overwrite with force', async () => {
    const dir = await makeTempDir()
    const a = await makeJpeg(dir, 'a.jpg')
    await makePng(dir, 'a.png')
    const resolved = await resolveInputs([a], { recursive: false })
    const plan = await buildPlan({ resolved, target: 'png', options, force: true })
    expect(plan.jobs).toHaveLength(1)
  })

  it('refuses to write over its own input without force', async () => {
    const dir = await makeTempDir()
    const a = await makeJpeg(dir, 'a.jpg')
    const resolved = await resolveInputs([a], { recursive: false })
    const plan = await buildPlan({ resolved, target: 'jpeg', options, force: false })
    expect(plan.failures[0]?.error.code).toBe('output-is-input')
  })

  it('carries input failures through untouched', async () => {
    const dir = await makeTempDir()
    const resolved = await resolveInputs([join(dir, 'ghost.jpg')], { recursive: false })
    const plan = await buildPlan({ resolved, target: 'webp', options, force: false })
    expect(plan.failures[0]?.error.code).toBe('file-not-found')
  })
})
```

- [ ] **Step 2: Run and confirm it fails**

Run: `npx vitest run tests/core/plan.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write `src/core/plan.ts`**

```ts
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { targetIdsFor } from './capabilities.js'
import { outputExists, outputIsInput, unsupportedTarget } from './errors.js'
import { resolveOutputPath } from './output-path.js'
import type { InputFailure, ResolvedInput } from './resolve.js'
import type { ConvertOptions, FormatId, Job } from './types.js'

export interface PlanRequest {
  resolved: ResolvedInput
  target: FormatId
  output?: string
  options: ConvertOptions
  force: boolean
}

export interface Plan {
  jobs: Job[]
  failures: InputFailure[]
}

/**
 * Pure with respect to conversion — it decides what will happen and what will
 * not, so every refusal surfaces before a single byte is written.
 */
export async function buildPlan(req: PlanRequest): Promise<Plan> {
  const jobs: Job[] = []
  const failures: InputFailure[] = [...req.resolved.failures]

  for (const source of req.resolved.sources) {
    const available = targetIdsFor(source)
    if (!available.includes(req.target)) {
      failures.push({
        path: source.path,
        error: unsupportedTarget(source, req.target, available),
      })
      continue
    }

    const output = resolveOutputPath({
      sourcePath: source.path,
      target: req.target,
      output: req.output,
      sourceRoot: req.resolved.roots.get(source.path),
    })

    if (resolve(output) === resolve(source.path) && !req.force) {
      failures.push({ path: source.path, error: outputIsInput(output) })
      continue
    }

    if (existsSync(output) && !req.force) {
      failures.push({ path: source.path, error: outputExists(output) })
      continue
    }

    jobs.push({ source, target: req.target, output, options: req.options })
  }

  return { jobs, failures }
}
```

- [ ] **Step 4: Run and confirm it passes**

Run: `npx vitest run tests/core/plan.test.ts`
Expected: PASS, 6 tests

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(core): job planning with overwrite and capability guards"
```

---

### Task 13: Bounded batch runner

**Files:**
- Create: `src/core/run.ts`
- Test: `tests/core/run.test.ts`

**Interfaces:**
- Consumes: `Job`, `Result`, `Phase`; `engineForTarget` from `engines/registry.js`
- Produces:
  - `type RunEvent` — a discriminated union on `type`: `'job:start'|'job:phase'|'job:done'|'job:error'|'batch:done'`
  - `interface RunSummary { results: Result[]; failures: InputFailure[]; inputBytes: number; outputBytes: number }`
  - `runJobs(jobs: Job[], opts: { concurrency?: number; onEvent?: (e: RunEvent) => void }): Promise<RunSummary>`
  - `defaultConcurrency(): number`

- [ ] **Step 1: Write the failing test**

```ts
// tests/core/run.test.ts
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildPlan } from '../../src/core/plan.js'
import { resolveInputs } from '../../src/core/resolve.js'
import { type RunEvent, runJobs } from '../../src/core/run.js'
import type { ConvertOptions, Job } from '../../src/core/types.js'
import { makeCorruptFile, makeJpeg, makeTempDir } from '../helpers/fixtures.js'

const options: ConvertOptions = { background: '#ffffff', keepMetadata: false }

async function planFor(dir: string, count: number): Promise<Job[]> {
  for (let i = 0; i < count; i++) await makeJpeg(dir, `f${i}.jpg`)
  const resolved = await resolveInputs([dir], { recursive: false })
  const plan = await buildPlan({ resolved, target: 'webp', options, force: false })
  return plan.jobs
}

describe('runJobs', () => {
  it('converts every job and totals the byte counts', async () => {
    const dir = await makeTempDir()
    const summary = await runJobs(await planFor(dir, 5), {})
    expect(summary.results).toHaveLength(5)
    expect(summary.failures).toHaveLength(0)
    expect(summary.inputBytes).toBeGreaterThan(0)
    expect(summary.outputBytes).toBeGreaterThan(0)
  })

  it('emits real progress events, one done per job, ending with batch:done', async () => {
    const dir = await makeTempDir()
    const jobs = await planFor(dir, 4)
    const events: RunEvent[] = []
    await runJobs(jobs, { onEvent: (e) => events.push(e) })

    expect(events.filter((e) => e.type === 'job:start')).toHaveLength(4)
    expect(events.filter((e) => e.type === 'job:done')).toHaveLength(4)
    expect(events.at(-1)?.type).toBe('batch:done')
  })

  it('never exceeds the concurrency limit', async () => {
    const dir = await makeTempDir()
    const jobs = await planFor(dir, 12)
    let live = 0
    let peak = 0
    await runJobs(jobs, {
      concurrency: 3,
      onEvent: (e) => {
        if (e.type === 'job:start') peak = Math.max(peak, ++live)
        if (e.type === 'job:done' || e.type === 'job:error') live--
      },
    })
    expect(peak).toBeLessThanOrEqual(3)
  })

  it('keeps going after one job fails and reports it', async () => {
    const dir = await makeTempDir()
    const jobs = await planFor(dir, 3)
    const bad = await makeCorruptFile(dir, 'bad.bin')
    const broken: Job = { ...jobs[0]!, source: { ...jobs[0]!.source, path: bad }, output: join(dir, 'bad.webp') }

    const summary = await runJobs([...jobs, broken], {})
    expect(summary.results).toHaveLength(3)
    expect(summary.failures).toHaveLength(1)
    expect(summary.failures[0]?.error.code).toBe('conversion-failed')
  })

  it('returns an empty summary for no jobs', async () => {
    const summary = await runJobs([], {})
    expect(summary.results).toEqual([])
    expect(summary.outputBytes).toBe(0)
  })
})
```

- [ ] **Step 2: Run and confirm it fails**

Run: `npx vitest run tests/core/run.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write `src/core/run.ts`**

```ts
import { cpus } from 'node:os'
import { engineForTarget } from '../engines/registry.js'
import { conversionFailed, isForgeError } from './errors.js'
import type { InputFailure } from './resolve.js'
import type { Job, Phase, Result } from './types.js'

export type RunEvent =
  | { type: 'job:start'; job: Job; index: number; total: number }
  | { type: 'job:phase'; job: Job; phase: Phase }
  | { type: 'job:done'; job: Job; result: Result; completed: number; total: number }
  | { type: 'job:error'; job: Job; failure: InputFailure; completed: number; total: number }
  | { type: 'batch:done'; summary: RunSummary }

export interface RunSummary {
  results: Result[]
  failures: InputFailure[]
  inputBytes: number
  outputBytes: number
}

/** Sharp dispatches into libuv's threadpool; unbounded dispatch thrashes it. */
export function defaultConcurrency(): number {
  return Math.max(1, Math.min(cpus().length, 4))
}

export async function runJobs(
  jobs: Job[],
  opts: { concurrency?: number; onEvent?: (event: RunEvent) => void },
): Promise<RunSummary> {
  const emit = opts.onEvent ?? (() => {})
  const limit = Math.max(1, opts.concurrency ?? defaultConcurrency())
  const total = jobs.length

  const results: Result[] = []
  const failures: InputFailure[] = []
  let completed = 0
  let cursor = 0

  async function worker(): Promise<void> {
    while (cursor < total) {
      const index = cursor++
      const job = jobs[index]
      if (!job) return

      emit({ type: 'job:start', job, index, total })

      const engine = engineForTarget(job.target)
      if (!engine) {
        completed++
        failures.push({
          path: job.source.path,
          error: conversionFailed(job.source.path, new Error(`no engine writes ${job.target}`)),
        })
        continue
      }

      try {
        const result = await engine.convert(job, (phase) => emit({ type: 'job:phase', job, phase }))
        results.push(result)
        completed++
        emit({ type: 'job:done', job, result, completed, total })
      } catch (e) {
        completed++
        const error = isForgeError(e) ? e : conversionFailed(job.source.path, e)
        const failure: InputFailure = { path: job.source.path, error }
        failures.push(failure)
        emit({ type: 'job:error', job, failure, completed, total })
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, total) }, worker))

  const summary: RunSummary = {
    results,
    failures,
    inputBytes: results.reduce((n, r) => n + r.job.source.bytes, 0),
    outputBytes: results.reduce((n, r) => n + r.outputBytes, 0),
  }
  emit({ type: 'batch:done', summary })
  return summary
}
```

- [ ] **Step 4: Run and confirm it passes**

Run: `npx vitest run tests/core/run.test.ts`
Expected: PASS, 5 tests

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(core): bounded batch runner with real progress events"
```

---

### Task 14: CLI argument parsing

**Files:**
- Create: `src/cli/args.ts`
- Test: `tests/cli/args.test.ts`

**Interfaces:**
- Consumes: `formatById` from `core/formats.js`; `invalidArguments` from `core/errors.js`
- Produces:
  - `type Intent = { kind: 'convert'; inputs: string[]; target: FormatId; output?: string; options: ConvertOptions; force: boolean; recursive: boolean; concurrency?: number; debug: boolean } | { kind: 'formats' } | { kind: 'shell' }`
  - `parseArgs(argv: string[]): Intent` — throws `ForgeError` with code `invalid-arguments`

- [ ] **Step 1: Write the failing test**

```ts
// tests/cli/args.test.ts
import { describe, expect, it } from 'vitest'
import { parseArgs } from '../../src/cli/args.js'
import { isForgeError } from '../../src/core/errors.js'

function codeOf(argv: string[]): string {
  try {
    parseArgs(argv)
  } catch (e) {
    return isForgeError(e) ? e.code : `unexpected:${String(e)}`
  }
  return 'no-error'
}

describe('parseArgs', () => {
  it('parses a single file conversion', () => {
    const intent = parseArgs(['photo.jpg', '--to', 'webp'])
    expect(intent).toMatchObject({ kind: 'convert', inputs: ['photo.jpg'], target: 'webp' })
  })

  it('accepts the short flag', () => {
    expect(parseArgs(['a.jpg', '-t', 'png'])).toMatchObject({ target: 'png' })
  })

  it('accepts several inputs', () => {
    expect(parseArgs(['a.jpg', 'b.jpg', '--to', 'webp'])).toMatchObject({ inputs: ['a.jpg', 'b.jpg'] })
  })

  it('normalises jpg to jpeg', () => {
    expect(parseArgs(['a.png', '--to', 'jpg'])).toMatchObject({ target: 'jpeg' })
  })

  it('is case-insensitive about the target', () => {
    expect(parseArgs(['a.png', '--to', 'WebP'])).toMatchObject({ target: 'webp' })
  })

  it('reads the output, quality, background and boolean flags', () => {
    const intent = parseArgs([
      'a.jpg', '--to', 'webp', '--output', './dist/', '--quality', '70',
      '--background', '#000000', '--force', '--recursive', '--keep-metadata', '--debug',
    ])
    expect(intent).toMatchObject({
      output: './dist/',
      force: true,
      recursive: true,
      debug: true,
      options: { quality: 70, background: '#000000', keepMetadata: true },
    })
  })

  it('defaults background to white and keepMetadata to false', () => {
    expect(parseArgs(['a.jpg', '--to', 'webp'])).toMatchObject({
      options: { background: '#ffffff', keepMetadata: false },
    })
  })

  it('returns the formats intent', () => {
    expect(parseArgs(['--formats'])).toEqual({ kind: 'formats' })
  })

  it('returns the shell intent for no arguments', () => {
    expect(parseArgs([])).toEqual({ kind: 'shell' })
  })

  it('rejects inputs with no --to', () => {
    expect(codeOf(['a.jpg'])).toBe('invalid-arguments')
  })

  it('rejects --quality without --to, so the flag cannot change meaning later', () => {
    expect(codeOf(['a.jpg', '--quality', '70'])).toBe('invalid-arguments')
  })

  it('rejects an unknown target format', () => {
    expect(codeOf(['a.jpg', '--to', 'mp4'])).toBe('invalid-arguments')
  })

  it('rejects a quality outside 1-100', () => {
    expect(codeOf(['a.jpg', '--to', 'webp', '--quality', '0'])).toBe('invalid-arguments')
    expect(codeOf(['a.jpg', '--to', 'webp', '--quality', '101'])).toBe('invalid-arguments')
    expect(codeOf(['a.jpg', '--to', 'webp', '--quality', 'high'])).toBe('invalid-arguments')
  })

  it('rejects --to with no inputs', () => {
    expect(codeOf(['--to', 'webp'])).toBe('invalid-arguments')
  })
})
```

- [ ] **Step 2: Run and confirm it fails**

Run: `npx vitest run tests/cli/args.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write `src/cli/args.ts`**

```ts
import { Command } from 'commander'
import { invalidArguments } from '../core/errors.js'
import { formatById } from '../core/formats.js'
import type { ConvertOptions, FormatId } from '../core/types.js'

export type Intent =
  | {
      kind: 'convert'
      inputs: string[]
      target: FormatId
      output?: string
      options: ConvertOptions
      force: boolean
      recursive: boolean
      concurrency?: number
      debug: boolean
    }
  | { kind: 'formats' }
  | { kind: 'shell' }

const ALIASES: Record<string, string> = { jpg: 'jpeg', tif: 'tiff', heif: 'heic' }

function parseTarget(raw: string): FormatId {
  const key = raw.toLowerCase().replace(/^\./, '')
  const spec = formatById(ALIASES[key] ?? key)
  if (!spec) {
    throw invalidArguments(
      `${raw} is not a format Forge knows.`,
      'Run forge --formats to see what is available.',
    )
  }
  return spec.id
}

function parseQuality(raw: string): number {
  const n = Number(raw)
  if (!Number.isInteger(n) || n < 1 || n > 100) {
    throw invalidArguments(`Quality must be a whole number between 1 and 100, not ${raw}.`)
  }
  return n
}

export function parseArgs(argv: string[]): Intent {
  const program = new Command()
    .name('forge')
    .description('Convert — transform your files from the terminal')
    .argument('[inputs...]', 'files, folders or globs')
    .option('-t, --to <format>', 'target format')
    .option('-o, --output <path>', 'output file or directory')
    .option('-q, --quality <n>', 'quality for lossy formats, 1-100')
    .option('--background <colour>', 'fill colour when flattening transparency', '#ffffff')
    .option('--keep-metadata', 'preserve EXIF and GPS data', false)
    .option('--recursive', 'descend into subfolders', false)
    .option('--force', 'allow overwriting existing files', false)
    .option('--concurrency <n>', 'how many files to convert at once')
    .option('--debug', 'show underlying errors', false)
    .option('--formats', 'list supported formats', false)
    .helpOption('-h, --help', 'show this help')
    .version('0.1.0', '-V, --version', 'show the version')
    .exitOverride()
    .allowExcessArguments(false)

  program.parse(argv, { from: 'user' })

  const opts = program.opts()
  const inputs = program.args

  if (opts.formats) return { kind: 'formats' }
  if (inputs.length === 0 && !opts.to && opts.quality === undefined) return { kind: 'shell' }

  if (!opts.to) {
    throw invalidArguments(
      'No target format given.',
      'Add --to <format>, for example: forge photo.jpg --to webp',
    )
  }

  if (inputs.length === 0) {
    throw invalidArguments(
      'No files given.',
      'Name a file, a folder or a glob, for example: forge photo.jpg --to webp',
    )
  }

  const options: ConvertOptions = {
    background: String(opts.background),
    keepMetadata: Boolean(opts.keepMetadata),
  }
  if (opts.quality !== undefined) options.quality = parseQuality(String(opts.quality))

  const intent: Intent = {
    kind: 'convert',
    inputs,
    target: parseTarget(String(opts.to)),
    options,
    force: Boolean(opts.force),
    recursive: Boolean(opts.recursive),
    debug: Boolean(opts.debug),
  }
  if (opts.output !== undefined) intent.output = String(opts.output)
  if (opts.concurrency !== undefined) intent.concurrency = Number(opts.concurrency)
  return intent
}
```

- [ ] **Step 4: Run and confirm it passes**

Run: `npx vitest run tests/cli/args.test.ts`
Expected: PASS, 14 tests

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(cli): argument parsing with actionable validation"
```

---

### Task 15: CLI reporting

**Files:**
- Create: `src/cli/report.ts`
- Test: `tests/cli/report.test.ts`

**Interfaces:**
- Consumes: `formatBytes`, `percentChange` from `core/units.js`; `renderError` from `core/errors.js`; `RunSummary` from `core/run.js`; capability helpers
- Produces:
  - `reportSingle(summary: RunSummary): string[]`
  - `reportBatch(summary: RunSummary, output?: string): string[]`
  - `reportFailures(failures: InputFailure[], opts: { debug: boolean }): string[]`
  - `reportFormats(): string[]`

- [ ] **Step 1: Write the failing test**

```ts
// tests/cli/report.test.ts
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { reportBatch, reportFailures, reportFormats, reportSingle } from '../../src/cli/report.js'
import { fileNotFound } from '../../src/core/errors.js'
import { buildPlan } from '../../src/core/plan.js'
import { resolveInputs } from '../../src/core/resolve.js'
import { runJobs } from '../../src/core/run.js'
import type { ConvertOptions } from '../../src/core/types.js'
import { makeJpeg, makeTempDir } from '../helpers/fixtures.js'

const options: ConvertOptions = { background: '#ffffff', keepMetadata: false }

async function convertAll(dir: string, count: number) {
  for (let i = 0; i < count; i++) await makeJpeg(dir, `f${i}.jpg`)
  const resolved = await resolveInputs([dir], { recursive: false })
  const plan = await buildPlan({ resolved, target: 'webp', options, force: false })
  return runJobs(plan.jobs, {})
}

describe('reportSingle', () => {
  it('shows the arrow, both sizes and the change', async () => {
    const dir = await makeTempDir()
    const text = reportSingle(await convertAll(dir, 1)).join('\n')
    expect(text).toContain('✓')
    expect(text).toContain('→')
    expect(text).toMatch(/f0\.jpg/)
    expect(text).toMatch(/f0\.webp/)
    expect(text).toMatch(/smaller|larger|same size/)
  })
})

describe('reportBatch', () => {
  it('counts the conversions and totals the bytes', async () => {
    const dir = await makeTempDir()
    const text = reportBatch(await convertAll(dir, 4)).join('\n')
    expect(text).toContain('4 converted')
    expect(text).toContain('→')
  })

  it('names the output directory when one was given', async () => {
    const dir = await makeTempDir()
    const text = reportBatch(await convertAll(dir, 2), './dist/').join('\n')
    expect(text).toContain('./dist/')
  })
})

describe('reportFailures', () => {
  it('renders each failure with a symbol and a word, not colour alone', () => {
    const text = reportFailures([{ path: '/a/ghost.jpg', error: fileNotFound('/a/ghost.jpg') }], { debug: false }).join('\n')
    expect(text).toContain('✕ File not found')
    expect(text).toContain('ghost.jpg')
  })

  it('says nothing when there are no failures', () => {
    expect(reportFailures([], { debug: false })).toEqual([])
  })
})

describe('reportFormats', () => {
  it('lists what can be read and what can be written', () => {
    const text = reportFormats().join('\n')
    expect(text).toContain('HEIC')
    expect(text).toContain('WebP')
    expect(text.toLowerCase()).toContain('read')
    expect(text.toLowerCase()).toContain('write')
  })

  it('marks heic as read-only, since sharp cannot encode it', () => {
    const line = reportFormats().find((l) => l.includes('HEIC')) ?? ''
    expect(line.toLowerCase()).toContain('read only')
  })
})
```

- [ ] **Step 2: Run and confirm it fails**

Run: `npx vitest run tests/cli/report.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write `src/cli/report.ts`**

```ts
import { basename } from 'node:path'
import { readableFormats, writableFormats } from '../core/capabilities.js'
import { renderError } from '../core/errors.js'
import { FORMATS } from '../core/formats.js'
import type { InputFailure } from '../core/resolve.js'
import type { RunSummary } from '../core/run.js'
import { formatBytes, percentChange } from '../core/units.js'

function changePhrase(from: number, to: number): string {
  const { pct, direction } = percentChange(from, to)
  if (direction === 'same') return 'same size'
  return `${pct}% ${direction}`
}

export function reportSingle(summary: RunSummary): string[] {
  const result = summary.results[0]
  if (!result) return []

  const lines = [
    `✓ ${basename(result.job.source.path)} → ${basename(result.job.output)}`,
    `  ${formatBytes(result.job.source.bytes)} → ${formatBytes(result.outputBytes)} · ${changePhrase(result.job.source.bytes, result.outputBytes)}`,
  ]
  for (const warning of result.warnings) lines.push('', `⚠ ${warning.message}`)
  return lines
}

export function reportBatch(summary: RunSummary, output?: string): string[] {
  const lines = [
    `✓ ${summary.results.length} converted`,
    `  ${formatBytes(summary.inputBytes)} → ${formatBytes(summary.outputBytes)} · ${changePhrase(summary.inputBytes, summary.outputBytes)}`,
  ]

  const warnings = summary.results.flatMap((r) => r.warnings)
  if (warnings.length > 0) {
    lines.push('')
    for (const w of warnings) lines.push(`⚠ ${w.message}`)
  }

  if (output) lines.push('', `Output: ${output}`)
  return lines
}

export function reportFailures(failures: InputFailure[], opts: { debug: boolean }): string[] {
  if (failures.length === 0) return []
  const lines: string[] = []
  for (const failure of failures) {
    lines.push(...renderError(failure.error, { debug: opts.debug }), '')
  }
  return lines
}

export function reportFormats(): string[] {
  const readable = new Set(readableFormats())
  const writable = new Set(writableFormats())

  const lines = ['Formats', '']
  for (const id of readable) {
    const spec = FORMATS[id]
    const capability = writable.has(id) ? 'read and write' : 'read only'
    lines.push(`  ${spec.label.padEnd(6)} ${spec.extensions.join(' ').padEnd(12)} ${capability}`)
  }
  lines.push('', 'HEIC is read only because the image library cannot encode it.')
  return lines
}
```

- [ ] **Step 4: Run and confirm it passes**

Run: `npx vitest run tests/cli/report.test.ts`
Expected: PASS, 7 tests

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(cli): concise result and error reporting"
```

---

### Task 16: Wiring, TTY detection and exit codes

**Files:**
- Create: `src/cli/execute.ts`
- Modify: `src/index.ts`
- Test: `tests/cli/execute.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 11–15
- Produces:
  - `interface ExecuteResult { exitCode: 0 | 1 | 2; stdout: string[]; stderr: string[] }`
  - `execute(intent: Intent): Promise<ExecuteResult>`
  - `src/index.ts` gains a `main()` that reads `process.argv`, calls `execute`, prints, and sets `process.exitCode`

- [ ] **Step 1: Write the failing test**

```ts
// tests/cli/execute.test.ts
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseArgs } from '../../src/cli/args.js'
import { execute } from '../../src/cli/execute.js'
import { makeJpeg, makeTempDir } from '../helpers/fixtures.js'

describe('execute', () => {
  it('converts one file and exits 0', async () => {
    const dir = await makeTempDir()
    const a = await makeJpeg(dir, 'a.jpg')
    const out = await execute(parseArgs([a, '--to', 'webp']))
    expect(out.exitCode).toBe(0)
    expect(out.stdout.join('\n')).toContain('a.webp')
    expect(existsSync(join(dir, 'a.webp'))).toBe(true)
  })

  it('converts a folder and reports a batch', async () => {
    const dir = await makeTempDir()
    for (let i = 0; i < 3; i++) await makeJpeg(dir, `f${i}.jpg`)
    const out = await execute(parseArgs([dir, '--to', 'webp']))
    expect(out.exitCode).toBe(0)
    expect(out.stdout.join('\n')).toContain('3 converted')
  })

  it('exits 1 when a named file is missing, and says which', async () => {
    const dir = await makeTempDir()
    const out = await execute(parseArgs([join(dir, 'ghost.jpg'), '--to', 'webp']))
    expect(out.exitCode).toBe(1)
    expect(out.stderr.join('\n')).toContain('ghost.jpg')
  })

  it('exits 1 when some succeed and some fail', async () => {
    const dir = await makeTempDir()
    const a = await makeJpeg(dir, 'a.jpg')
    const out = await execute(parseArgs([a, join(dir, 'ghost.jpg'), '--to', 'webp']))
    expect(out.exitCode).toBe(1)
    expect(out.stdout.join('\n')).toContain('a.webp')
    expect(out.stderr.join('\n')).toContain('ghost.jpg')
  })

  it('refuses to overwrite, then allows it with force', async () => {
    const dir = await makeTempDir()
    const a = await makeJpeg(dir, 'a.jpg')
    expect((await execute(parseArgs([a, '--to', 'webp']))).exitCode).toBe(0)
    expect((await execute(parseArgs([a, '--to', 'webp']))).exitCode).toBe(1)
    expect((await execute(parseArgs([a, '--to', 'webp', '--force']))).exitCode).toBe(0)
  })

  it('prints the format table and exits 0', async () => {
    const out = await execute({ kind: 'formats' })
    expect(out.exitCode).toBe(0)
    expect(out.stdout.join('\n')).toContain('HEIC')
  })

  it('never leaks a stack trace without --debug', async () => {
    const dir = await makeTempDir()
    const out = await execute(parseArgs([join(dir, 'ghost.jpg'), '--to', 'webp']))
    expect(out.stderr.join('\n')).not.toContain('at ')
  })
})
```

- [ ] **Step 2: Run and confirm it fails**

Run: `npx vitest run tests/cli/execute.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write `src/cli/execute.ts`**

```ts
import { buildPlan } from '../core/plan.js'
import { resolveInputs } from '../core/resolve.js'
import { runJobs } from '../core/run.js'
import type { Intent } from './args.js'
import { reportBatch, reportFailures, reportFormats, reportSingle } from './report.js'

export interface ExecuteResult {
  exitCode: 0 | 1 | 2
  stdout: string[]
  stderr: string[]
}

export async function execute(intent: Intent): Promise<ExecuteResult> {
  if (intent.kind === 'formats') {
    return { exitCode: 0, stdout: reportFormats(), stderr: [] }
  }

  if (intent.kind === 'shell') {
    return {
      exitCode: 2,
      stdout: [],
      stderr: ['The interactive shell is not built yet. Use --to for now, or --help.'],
    }
  }

  const resolved = await resolveInputs(intent.inputs, { recursive: intent.recursive })

  const planRequest = {
    resolved,
    target: intent.target,
    options: intent.options,
    force: intent.force,
    ...(intent.output === undefined ? {} : { output: intent.output }),
  }
  const plan = await buildPlan(planRequest)

  const summary = await runJobs(
    plan.jobs,
    intent.concurrency === undefined ? {} : { concurrency: intent.concurrency },
  )

  const failures = [...plan.failures, ...summary.failures]

  const stdout =
    summary.results.length === 0
      ? []
      : summary.results.length === 1
        ? reportSingle(summary)
        : reportBatch(summary, intent.output)

  const stderr = reportFailures(failures, { debug: intent.debug })

  return { exitCode: failures.length > 0 ? 1 : 0, stdout, stderr }
}
```

- [ ] **Step 4: Rewrite `src/index.ts`**

```ts
#!/usr/bin/env node
import { parseArgs } from './cli/args.js'
import { execute } from './cli/execute.js'
import { isForgeError, renderError } from './core/errors.js'

export const VERSION = '0.1.0'

async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  const debug = argv.includes('--debug')

  try {
    const intent = parseArgs(argv)

    // The shell is only ever launched from a real terminal. Piped or scripted
    // invocations must never block waiting for a keypress.
    if (intent.kind === 'shell' && !process.stdout.isTTY) {
      process.stderr.write('Forge needs a file and a target format.\nTry: forge photo.jpg --to webp\n')
      process.exitCode = 2
      return
    }

    const result = await execute(intent)
    if (result.stdout.length > 0) process.stdout.write(`${result.stdout.join('\n')}\n`)
    if (result.stderr.length > 0) process.stderr.write(`${result.stderr.join('\n')}\n`)
    process.exitCode = result.exitCode
  } catch (e) {
    if (isForgeError(e)) {
      process.stderr.write(`${renderError(e, { debug }).join('\n')}\n`)
      process.exitCode = 2
      return
    }
    // Commander throws for --help and --version, having already printed.
    if (e instanceof Error && 'exitCode' in e) {
      process.exitCode = Number((e as { exitCode: unknown }).exitCode) || 0
      return
    }
    throw e
  }
}

await main()
```

- [ ] **Step 5: Run and confirm the tests pass**

Run: `npx vitest run tests/cli/execute.test.ts`
Expected: PASS, 7 tests

- [ ] **Step 5a: Delete `tests/smoke.test.ts`**

```bash
rm tests/smoke.test.ts
```

It was toolchain scaffolding for Task 1. Now that `src/index.ts` calls `main()`
at the top level, importing it from a test **executes the CLI** against vitest's
own argv — which writes to stderr and sets a non-zero `process.exitCode`,
failing the run. `tests/cli/execute.test.ts` covers everything it did and more.

- [ ] **Step 6: Run the whole suite plus type and lint checks**

Run: `npm test && npm run typecheck && npm run lint`
Expected: all green

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(cli): wire parsing, execution, tty detection and exit codes"
```

---

### Task 17: Package, link and verify by hand

**Files:**
- Modify: `README.md` (create)
- Test: manual verification, recorded below

**Interfaces:**
- Consumes: everything
- Produces: a `forge` command usable from any directory

- [ ] **Step 1: Build and link**

```bash
npm run build
chmod +x dist/index.js
npm link
```

- [ ] **Step 2: Verify the basics from a different directory**

```bash
cd /tmp && rm -rf forge-check && mkdir forge-check && cd forge-check
forge --version          # expect: 0.1.0
forge --help             # expect: usage, no crash
forge --formats          # expect: table with HEIC marked read only
```

- [ ] **Step 3: Verify a real conversion end to end**

```bash
cd /tmp/forge-check
cp ~/Desktop/*.jpg . 2>/dev/null || node -e "
require('sharp')({create:{width:800,height:600,channels:3,background:'#4488cc'}}).jpeg().toFile('sample.jpg')
"
forge sample.jpg --to webp
```

Expected output shape:

```
✓ sample.jpg → sample.webp
  24 KB → 3.1 KB · 87.1% smaller
```

- [ ] **Step 4: Verify the guards behave**

```bash
cd /tmp/forge-check
forge sample.jpg --to webp        ; echo "exit=$?"   # expect 1, "already exists", suggests --force
forge sample.jpg --to webp --force; echo "exit=$?"   # expect 0
forge ghost.jpg  --to webp        ; echo "exit=$?"   # expect 1, "File not found", no stack trace
forge sample.jpg --to mp4         ; echo "exit=$?"   # expect 2, 'mp4 is not a format Forge knows'
forge sample.jpg --to heic        ; echo "exit=$?"   # expect 1, known format but unwritable,
                                                    #   lists what IS available
forge sample.jpg                  ; echo "exit=$?"   # expect 2, asks for --to
forge --to webp                   ; echo "exit=$?"   # expect 2, asks for files
```

- [ ] **Step 5: Verify the non-interactive guard**

```bash
forge | cat ; echo "exit=$?"    # expect 2 and a hint — must not hang waiting for input
```

- [ ] **Step 6: Write `README.md`**

Cover, in this order: what Convert is and why it exists; installation; CLI examples taken verbatim from Step 3 and Step 4 output; supported formats including the HEIC read-only caveat; architecture (the layer diagram from the spec); development (`npm run build|test|lint|typecheck`); testing; roadmap (interactive shell, compress, resize, PDF and video engines). Note that the interactive shell is not yet built.

- [ ] **Step 7: Final verification**

```bash
cd "/Users/atharvanayak/Developer/Convert Terminal"
npm test && npm run typecheck && npm run lint && npm run build
```

Expected: all green.

- [ ] **Step 8: Commit and merge to main**

```bash
git add -A
git commit -m "docs: readme, and package for npm link"
git push -u origin dev

git switch main
git merge dev
git push
git switch dev
```

---

## Spec coverage

| Spec section | Covered by |
| --- | --- |
| §2 verified facts | Global Constraints table; Tasks 4, 5, 9 |
| §4 architecture | Task 1 layout; enforced by the core/engines import rule |
| §5 capability graph | Tasks 2, 5, 6 |
| §6 actions | Deferred — the shell plan introduces the action layer. The CLI has one implicit action, so `OptionSpec` earns nothing yet. |
| §7 correctness rules 1–5 | Tasks 8, 9 (rules 1–4), Task 13 (rule 5) |
| §8 safety | Task 7 (atomic write), Task 12 (overwrite, output-is-input), Task 11 (non-recursive default) |
| §9 CLI surface | Tasks 10, 14, 15, 16 |
| §10 interactive shell | **Deferred to the shell plan.** `execute` returns exit 2 with a clear message until then. |
| §11 errors | Task 3; mapping proven in Task 5 |
| §12 progress | Task 7 (phases), Task 13 (batch events) |
| §13 responsiveness and accessibility | Symbol+word pairing in Task 15. Width banding belongs to the shell plan. |
| §14 testing | Tasks 4–16, every task test-first |
| §15 stack | Task 1 |
| §16 phasing | Tasks 1–17 are spec phases 1–3 and 6-for-CLI |
| §17 out of scope | Nothing here implements compress, resize, or a non-image engine |

**Known deferral:** §6 (actions) and §10 (interactive shell) are the shell plan's subject. Everything else in the spec is implemented or explicitly justified above.
