# Forge 0.2, Lean and Fast: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `forge` small and quick to start. That means no `pdf-parse`, engine libraries that load only when a command needs them, the intro animation overlapped with shell loading, `--max-size` searches running in parallel, `--to … --max-size` honoured, and one bundled file to publish. The spec's §3 targets are the acceptance criteria.

**Architecture:** `src/index.ts` parses arguments before it imports anything heavy. Each engine keeps its capability data static and loads its library through a cached loader in a new `src/engines/libs.ts`. PDF→DOCX text comes from pdfium (`extractPdfText` in `src/engines/pdfium.ts`). The target-size search runs through the same worker pool `runJobs` uses, and that pool is pulled out of `src/core/run.ts` as `pool()`. The shell boots from a new React-free module `src/shell/boot.ts`, which starts importing `launch.tsx` before the intro plays. The published package becomes one esbuild ESM bundle with lazy chunks. Only `sharp` and `@hyzyla/pdfium` stay external.

**Tech Stack:** TypeScript 7 (`tsc` typecheck only after Task 7), Node ≥ 20 (dev: 26), vitest 4, biome 2, Ink 7 / React 19, sharp 0.35, `@hyzyla/pdfium` 2.1, pdf-lib 1.17, esbuild 0.28, Swift (fixture generation only, one-off).

**Spec:** [docs/superpowers/specs/2026-10-11-forge-lean-and-fast-design.md](../specs/2026-10-11-forge-lean-and-fast-design.md). Read it and [CLAUDE.md](../../../CLAUDE.md) first. Background: the 4a spec ([2026-08-20-forge-phase-4a-pdf-pixels-design.md](../specs/2026-08-20-forge-phase-4a-pdf-pixels-design.md), the one-library-per-file rule and the "no native bindings beyond Sharp" property) and the word-conversion spec ([2026-08-26-forge-word-conversion-design.md](../specs/2026-08-26-forge-word-conversion-design.md)).

## Global Constraints

- Acceptance targets, from spec §3. Each is the median of ≥ 11 warm runs of a spawned process on the same machine:
  - Global install (`npm i -g` into an empty prefix, `du -sh`): **≤ 40 MB** (0.1.0: 188 MB)
  - `forge --version`: **≤ 60 ms** (0.1.0: 253 ms)
  - Load overhead for an image conversion: **≤ 100 ms** (0.1.0: ~230 ms)
  - Shell to first prompt, intro on: **≤ 600 ms** (0.1.0: 968 ms)
  - 50 JPEGs, `--max-size 50kb`: **≤ 12 s** (0.1.0: 36 s)
- "No conversion's output bytes change, except where §4.6 fixes a bug."
- CLAUDE.md invariants 1–7 are binding. In particular: `core/` and `engines/` never write to stdout (1). No hardcoded list of output formats; targets come from `targetsFor()` (2). Probing is by content and in the same engine order (3). `.rotate()` runs before any other Sharp operation (4). Progress is never fabricated (7).
- `applyColourPreference()` must still run before Ink or chalk is imported. Nothing moves ahead of it.
- `pdf-lib` stays: it is the only library here that writes PDFs (spec §2).
- §5 "Not changing" is off-limits: mozjpeg stays, PNG `compressionLevel: 9` stays, `docx` stays, the HEIC intermediate stays PNG.
- `engines.node` stays `>=20`. Anything newer (for example `module.enableCompileCache`, Node 22.1+) is optional-called.
- After Task 7, `dependencies` is exactly `sharp` and `@hyzyla/pdfium`. Everything else is bundled and moves to `devDependencies`. No source maps ship.
- A parallel session is redesigning the shell. Do not edit `src/shell/App.tsx` or any visual component. The single exception is the two-line `WORDMARK` move in `src/shell/components/Banner.tsx` (Task 3).
- `tsc` stays the typechecker (`npm run typecheck`). Tests run against source through vitest (`npm test`, about 100 s). Lint with `npm run lint` (biome). The code blocks in this plan are correct but not guaranteed to be biome-formatted. If `npm run lint` reports formatting differences only, run `npm run format` and lint again.
- Commits use the conventional style in `git log` and end with the line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Work on `dev` or a worktree branched from it, never on `main`.

## Review Focus

These are inputs the spec implies but never states. Each one gets a test in the task that owns the code.

1. **Cancelling (esc / Ctrl-C) while several `--max-size` searches run at once.** Nothing should be written. Every in-flight search should stop at its next encode boundary, and no encode should start after `runPlan` resolves. Owner: Task 5.
2. **One file's search throws partway through a batch** (a corrupt image, a HEIC that `sips` cannot decode). That file should be reported and the rest should still convert. Today a throw rejects the whole `runPlan`, and with parallel searches it would also orphan the other workers. Owner: Task 5.
3. **The shell's code fails to load while the intro is playing** (a broken chunk, a missing file). The error should surface once, after the intro, as an ordinary failure. It must not be an unhandled rejection mid-animation. Owner: Task 3.
4. **The installed bundle runs from a directory that is not the package's.** External `sharp` / `@hyzyla/pdfium` must resolve from the package's own `node_modules`, not from the caller's cwd. Owner: Task 7.
5. **A `--to <format> --max-size` batch mixing searchable and unsearchable files** (a JPEG and a PDF going to JPEG). The JPEG should fit the size, the PDF should be refused with a reason that names the target, the run should exit 1, and the refusal must not stop the JPEG. Owner: Task 4.

---

## Parallelism

```
          ┌──────────── Task 2 (pdfium text, §4.1) ─────────────┐
          │                                                      │
Task 1 ───┼──────────── Task 3 (intro overlap, §4.3) ────────────┼──► Task 7 (bundle, §4.5)
(§4.2)    │                                                      │
          ├── Task 4 (--to --max-size, §4.6) ──► Task 5 (§4.4) ──┤
          │                                                      │
Task 6 (bench script, §7) ─── independent, any time ─────────────┘
```

- **Task 1 lands on `dev` first, alone.** It is small and self-contained. The AI-native plan (`docs/superpowers/specs/2026-10-11-forge-ai-native-design.md`) also edits `src/index.ts` and `src/cli/execute.ts` and is written against Task 1's result.
- **After Task 1 merges, Tasks 2, 3 and 4 run concurrently, each in its own git worktree branched from `dev`.** Their file sets do not overlap:
  - Task 2: `src/engines/word.ts` (PDF branch of `extractPlainText` only), `src/engines/pdfium.ts` (new export), word tests, `tests/helpers/fixtures.ts` (append), `tests/fixtures/text/*`, `scripts/make-text-fixtures.swift`, `package.json`/`package-lock.json` (remove `pdf-parse`), the spec.
  - Task 3: `src/index.ts` (shell branch only), `src/shell/{boot.ts,launch.tsx,intro.ts,mark.ts}`, two lines of `src/shell/components/Banner.tsx`.
  - Task 4: `src/cli/{args.ts,execute.ts}`, `src/core/{errors.ts,execute-jobs.ts}` (one line), `src/engines/image.ts` (`measurer` only).
- **Task 5 runs after Task 4.** Both edit `imageEngine.measurer`, `runPlan`'s refusal line, and the `reportEvents` helper in `execute.ts` that Task 4 introduces. Task 5 can run concurrently with Tasks 2 and 3.
- **Task 6 is independent of everything.** It adds `scripts/bench.mjs` and one `package.json` script line. It can run in a worktree at any time, even before Task 1. Its `package.json` edit is one line in `scripts`; Task 2 edits `dependencies`, so git merges them cleanly.
- **Task 7 runs last, after 1–6 have merged.** It changes how everything above is packaged. It uses Task 6's bench to prove the install target, and Task 2's removal of `pdf-parse` is what makes the size reachable.
- Merge order back to `dev`: 1, then {2, 3, 4, 6} in any order, then 5, then 7. Run `npm test && npm run typecheck && npm run lint` on `dev` after each merge.

---

## File Structure

| File | Task | Responsibility |
| --- | --- | --- |
| `src/index.ts` | 1, 3 | Parse first. Answer `--version`/`--help` without importing anything else. Enable the compile cache. Import `execute.ts` only when there is work, and `shell/boot.ts` for the shell. |
| `src/engines/libs.ts` (new) | 1 | `lazy()` plus one cached loader per heavy library (`loadSharp`, `loadPdfLib`, `loadPdfium`, `loadMammoth`, `loadWordExtractor`, `loadAdmZip`, `loadCfb`, `loadDocx`). The only file in `engines/` that names those packages as runtime imports. |
| `src/engines/{image,pdf,pdfium,word}.ts` | 1 | Same capability data and probe order. Library calls go through `libs.ts`. |
| `src/engines/pdfium.ts` | 2 | Adds `extractPdfText(bytes)`, pdfium's per-page text. |
| `src/engines/word.ts` | 2 | The PDF branch of `extractPlainText` calls `extractPdfText`. |
| `scripts/make-text-fixtures.swift` (new) | 2 | One-off generator for the committed CoreText fixture PDFs. |
| `tests/fixtures/text/` (new) | 2 | `manifest.json` plus `columns/hebrew/arabic/cjk/ligatures.pdf`. |
| `tests/helpers/pdf-text.ts` (new) | 2 | The fixture cases and the extraction scorer, shared by the gate test and the permanent test. |
| `src/shell/boot.ts` (new) | 3 | React-free. Reads prefs, starts importing `launch.tsx`, plays the intro, then hands over. |
| `src/shell/launch.tsx` | 3 | Only renders. Takes a `ShellStart`. |
| `src/shell/mark.ts` | 3 | Gains `WORDMARK`, so `intro.ts` stops importing an Ink component. |
| `src/cli/args.ts` | 4 | `ConvertIntent.maxBytes`. `--quality`/`--max-size` are exclusive on both paths. |
| `src/cli/execute.ts` | 4, 5 | `reportEvents()` maps `PlanEvent`s to `onSearch`/`onProgress` on both paths. |
| `src/core/errors.ts` | 4 | `unsupportedCompress(source, target?)` names the target when it differs. |
| `src/core/run.ts` | 5 | `pool()` and `resolveConcurrency()`, shared by `runJobs` and `runPlan`. |
| `src/core/execute-jobs.ts` | 4, 5 | Searches run in the pool. Emits a new `search:settled` event. A throwing search becomes a failure. |
| `src/engines/image.ts` | 4, 5 | `measurer` declines lossless targets (4), reads the source once and decodes HEIC once (5). |
| `scripts/bench.mjs` (new) | 6 | Reproduces §3 from a packed tarball and prints each result against its target. |
| `scripts/build.mjs` (new) | 7 | The esbuild bundle and `third-party-licenses.txt`. |
| `scripts/stubs/react-devtools-core.mjs` (new) | 7 | Empty stand-in for Ink's optional devtools import. |
| `tests/bundle/bundle.test.ts` (new) | 7 | End-to-end tests against the built bundle. |
| `tests/core/licences.test.ts` | 7 | Checks licences over what ships (the import closure), not over `!dev`. |
| `tests/helpers/load-recorder.mjs`, `tests/helpers/load-log.ts` (new) | 1 | A module-load hook plus a spawn helper. Tasks 1, 3 and 7 use them. |

---

### Task 1: Load only what the command needs (§4.2)

**Files:**
- Create: `src/engines/libs.ts`
- Create: `tests/helpers/load-recorder.mjs`
- Create: `tests/helpers/load-log.ts`
- Create: `tests/cli/lazy-load.test.ts`
- Create: `tests/engines/libs.test.ts`
- Modify: `src/index.ts` (whole file, 102 lines)
- Modify: `src/engines/image.ts:5-6, 147-152, 269`
- Modify: `src/engines/pdfium.ts:1-23, 111`
- Modify: `src/engines/pdf.ts` (imports, `load`, `probe`, `embedBytes`, `imageToPdf`, `merge`, `split`, `pagesInto`, `rotate`, `compressDocument`, `measurer`)
- Modify: `src/engines/word.ts:6-11, 26-108, 200-222, 236-238, 277-322`

**Interfaces:**
- Consumes: nothing new.
- Produces (later tasks rely on these exact names):
  - `src/engines/libs.ts`: `export function lazy<T>(load: () => Promise<T>): () => Promise<T>`. Also `loadSharp(): Promise<typeof import('sharp').default>`, `loadPdfLib(): Promise<typeof import('pdf-lib')>`, `loadPdfium(): Promise<typeof import('@hyzyla/pdfium')>`, `loadMammoth()`, `loadWordExtractor()`, `loadAdmZip()`, `loadCfb()`, and `loadDocx(): Promise<typeof import('docx')>`.
  - `tests/helpers/load-log.ts`: `export async function modulesLoaded(args: string[], opts?: { tsx?: boolean; cwd?: string; env?: NodeJS.ProcessEnv }): Promise<{ exitCode: number; stdout: string; stderr: string; urls: string[] }>` and `export function packagesIn(urls: readonly string[]): Set<string>`.
  - `src/index.ts` still runs `await main()` at top level. The shell branch is unchanged here; Task 3 replaces it.
  - Every engine's exported signatures are unchanged: `imageEngine`, `encode`, `encodeToBuffer`, `pdfEngine`, `pdfiumEngine`, `openPdf`, `wordEngine`, `probe`, `extractPlainText`, `layoutAsPdf`, `buildDocx`, `PAGE_BREAK`, plus the LibreOffice test hooks.

- [ ] **Step 1: Write the load recorder and its spawn helper**

`tests/helpers/load-recorder.mjs`:

```js
// Preloaded with `node --import` by tests/helpers/load-log.ts. Records the URL
// of every module the process resolves and writes the list to the file named
// by FORGE_LOAD_LOG when the process exits. Verified to see modules resolved
// through tsx's own hooks, and modules loaded by plain node from a bundle.
import { writeFileSync } from 'node:fs'
import { registerHooks } from 'node:module'

const seen = new Set()

registerHooks({
  resolve(specifier, context, nextResolve) {
    const resolved = nextResolve(specifier, context)
    seen.add(resolved.url)
    return resolved
  },
})

process.on('exit', () => {
  const log = process.env.FORGE_LOAD_LOG
  if (log) writeFileSync(log, JSON.stringify([...seen]))
})
```

`tests/helpers/load-log.ts`:

```ts
import { execFile } from 'node:child_process'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'

const run = promisify(execFile)
const RECORDER = pathToFileURL(join(process.cwd(), 'tests', 'helpers', 'load-recorder.mjs')).href

export interface LoadRun {
  exitCode: number
  stdout: string
  stderr: string
  /** Every module URL the process resolved, `node:` built-ins included. */
  urls: string[]
}

/**
 * Runs `node <args>` with a resolve hook that records every module the
 * process loads.
 *
 * This is how a stray static import gets caught. Without it the import only
 * costs 100 ms, and nothing in the suite notices (spec §7). `tsx` is on by
 * default so source can be run directly, which needs cwd to be the repo root.
 * Pass `tsx: false` to run a built bundle with plain node.
 */
export async function modulesLoaded(
  args: string[],
  opts: { tsx?: boolean; cwd?: string; env?: NodeJS.ProcessEnv } = {},
): Promise<LoadRun> {
  const log = join(await mkdtemp(join(tmpdir(), 'forge-load-')), 'loaded.json')
  const preload = ['--import', RECORDER, ...(opts.tsx === false ? [] : ['--import', 'tsx'])]
  let exitCode = 0
  let stdout = ''
  let stderr = ''
  try {
    const result = await run(process.execPath, [...preload, ...args], {
      cwd: opts.cwd ?? process.cwd(),
      env: { ...process.env, ...opts.env, FORGE_LOAD_LOG: log },
    })
    stdout = result.stdout
    stderr = result.stderr
  } catch (e) {
    const err = e as { code?: number; stdout?: string; stderr?: string }
    exitCode = err.code ?? -1
    stdout = err.stdout ?? ''
    stderr = err.stderr ?? ''
  }
  const urls = JSON.parse(await readFile(log, 'utf8')) as string[]
  return { exitCode, stdout, stderr, urls }
}

/** Package names (`sharp`, `@hyzyla/pdfium`) among the URLs, read from each one's last `node_modules/` segment. */
export function packagesIn(urls: readonly string[]): Set<string> {
  const names = new Set<string>()
  for (const url of urls) {
    const at = url.lastIndexOf('/node_modules/')
    if (at === -1) continue
    const [first = '', second = ''] = url.slice(at + '/node_modules/'.length).split('/')
    names.add(first.startsWith('@') ? `${first}/${second}` : first)
  }
  return names
}
```

- [ ] **Step 2: Write the failing load-guard test**

`tests/cli/lazy-load.test.ts`:

```ts
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { makeJpeg, makeTempDir } from '../helpers/fixtures.js'
import { modulesLoaded, packagesIn } from '../helpers/load-log.js'

/**
 * Spec §4.2 and §7. A command pays only for the libraries it uses. These run
 * the real entrypoint through a module-load hook, so a stray static import
 * fails here instead of quietly costing every command 100 ms.
 */
const entry = join(process.cwd(), 'src', 'index.ts')

const ENGINE_LIBRARIES = [
  'sharp',
  'pdf-lib',
  '@hyzyla/pdfium',
  'mammoth',
  'word-extractor',
  'docx',
  'adm-zip',
  'cfb',
  'pdf-parse',
]
const SHELL_LIBRARIES = ['ink', 'react']

async function loadedBy(...args: string[]) {
  const run = await modulesLoaded([entry, ...args])
  return { ...run, packages: packagesIn(run.urls) }
}

const loadedExecute = (urls: string[]) => urls.some((u) => u.endsWith('/src/cli/execute.ts'))

describe('a command loads only what it needs', () => {
  it('--version loads no engine library, no part of the shell, and not execute.ts', async () => {
    const { exitCode, stdout, packages, urls } = await loadedBy('--version')
    expect(exitCode).toBe(0)
    expect(stdout.trim()).toBe('0.1.0')
    for (const name of [...ENGINE_LIBRARIES, ...SHELL_LIBRARIES]) {
      expect(packages, name).not.toContain(name)
    }
    expect(loadedExecute(urls)).toBe(false)
  })

  it('--help loads none of them either', async () => {
    const { exitCode, packages, urls } = await loadedBy('--help')
    expect(exitCode).toBe(0)
    for (const name of [...ENGINE_LIBRARIES, ...SHELL_LIBRARIES]) {
      expect(packages, name).not.toContain(name)
    }
    expect(loadedExecute(urls)).toBe(false)
  })

  it('a usage error is answered before anything heavy loads', async () => {
    const { exitCode, packages } = await loadedBy('--bogus')
    expect(exitCode).toBe(2)
    for (const name of [...ENGINE_LIBRARIES, ...SHELL_LIBRARIES]) {
      expect(packages, name).not.toContain(name)
    }
  })

  it('--formats reads every engine capability without loading a library', async () => {
    // Invariant 2 still holds: the list comes from every registered engine's
    // reads/writes. That data is static, so reading it costs no library.
    const { exitCode, stdout, packages } = await loadedBy('--formats')
    expect(exitCode).toBe(0)
    expect(stdout).toContain('HEIC')
    for (const name of [...ENGINE_LIBRARIES, ...SHELL_LIBRARIES]) {
      expect(packages, name).not.toContain(name)
    }
  })

  it('an image conversion loads sharp and no other engine library', async () => {
    const dir = await makeTempDir()
    const jpeg = await makeJpeg(dir, 'a.jpg')
    const { exitCode, packages } = await loadedBy(jpeg, '--to', 'webp')
    expect(exitCode).toBe(0)
    expect(packages).toContain('sharp')
    for (const name of ENGINE_LIBRARIES.filter((n) => n !== 'sharp')) {
      expect(packages, name).not.toContain(name)
    }
    for (const name of SHELL_LIBRARIES) expect(packages, name).not.toContain(name)
  })
})
```

`tests/engines/libs.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { lazy } from '../../src/engines/libs.js'

describe('lazy', () => {
  it('does not load until first asked', () => {
    let calls = 0
    lazy(async () => ++calls)
    expect(calls).toBe(0)
  })

  it('shares one load between concurrent first callers', async () => {
    let calls = 0
    const load = lazy(async () => {
      calls += 1
      await new Promise((r) => setTimeout(r, 10))
      return calls
    })
    const [a, b] = await Promise.all([load(), load()])
    expect(calls).toBe(1)
    expect(a).toBe(1)
    expect(b).toBe(1)
    expect(await load()).toBe(1)
  })
})
```

- [ ] **Step 3: Run the tests and confirm they fail for the right reason**

Run: `npx vitest run tests/cli/lazy-load.test.ts tests/engines/libs.test.ts`
Expected: `libs.test.ts` fails with "Failed to load url ../../src/engines/libs.js". In `lazy-load.test.ts`, the `--version`, `--help`, `--bogus` and `--formats` cases fail on `sharp: expected Set{…} not to contain 'sharp'`, and the image case fails on `pdf-lib`. This red step also checks the hook: if every case passes, the recorder is not seeing tsx-resolved modules, so stop and fix that before continuing.

- [ ] **Step 4: Create `src/engines/libs.ts`**

```ts
/**
 * The heavy libraries engines use, each loaded on first use and then cached
 * for the process.
 *
 * Engines declare what they can do (`reads`, `writes`, `ops`) as plain data
 * that costs nothing to import. They pay for a library only when a probe, a
 * run or a measurer actually needs it. On 0.1.0, loading every engine library
 * up front cost ~230 ms on every command, `forge --version` included (spec
 * §1, §4.2).
 *
 * The promise is cached rather than the module, so two concurrent first calls
 * share one import instead of racing two.
 */
export function lazy<T>(load: () => Promise<T>): () => Promise<T> {
  let loading: Promise<T> | undefined
  return () => {
    loading ??= load()
    return loading
  }
}

export const loadSharp = lazy(async () => (await import('sharp')).default)
export const loadPdfLib = lazy(() => import('pdf-lib'))
export const loadPdfium = lazy(() => import('@hyzyla/pdfium'))
export const loadMammoth = lazy(async () => (await import('mammoth')).default)
export const loadWordExtractor = lazy(async () => (await import('word-extractor')).default)
export const loadAdmZip = lazy(async () => (await import('adm-zip')).default)
export const loadCfb = lazy(() => import('cfb'))

type DocxModule = typeof import('docx')

/**
 * `docx` is imported with `globalThis.localStorage` hidden while it evaluates.
 *
 * Its bundle inlines the browser build of `util-deprecate`, whose
 * `deprecate()` probes `globalThis.localStorage` for `noDeprecation`, and
 * calls it at module top level (readable-stream's `_writableState.buffer`).
 * On Node 26 `localStorage` is a global getter that emits an
 * ExperimentalWarning on stderr when `--localstorage-file` is absent, so a
 * static import put that warning on every invocation, `--version` included.
 *
 * Loading lazily keeps the warning off every path that never writes a docx.
 * Hiding the getter for the duration of the import keeps it off the path that
 * does. Nothing is filtered: the warning is never raised, and every other Node
 * warning still prints. Without a backing file Node's `localStorage` is
 * unusable anyway, so `docx` sees exactly the "no localStorage" it would have
 * concluded, and nothing in Forge reads it while it is hidden.
 */
async function importWithoutLocalStorage(): Promise<DocxModule> {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  if (!descriptor?.configurable) return import('docx')
  Object.defineProperty(globalThis, 'localStorage', {
    value: undefined,
    configurable: true,
    enumerable: descriptor.enumerable ?? false,
    writable: true,
  })
  try {
    return await import('docx')
  } finally {
    Object.defineProperty(globalThis, 'localStorage', descriptor)
  }
}

export const loadDocx = lazy(importWithoutLocalStorage)
```

- [ ] **Step 5: Make `src/engines/image.ts` load Sharp lazily**

Replace lines 5–6:

```ts
import type { Metadata, Sharp } from 'sharp'
import sharp from 'sharp'
```

with:

```ts
import type { Metadata, Sharp } from 'sharp'
```

and add `import { loadSharp } from './libs.js'` beside the other `./` imports, before `import type { Engine, Measurer } from './types.js'`.

In `probe`, directly above `let meta: Metadata` (line 147), insert:

```ts
  // Loaded here, after the HEIC branch: a HEIC is measured with sips and
  // never needs Sharp to probe.
  const sharp = await loadSharp()
```

In `pipelineFor`, directly above `let pipeline = sharp(heic?.path ?? source.path, animated ? { animated: true } : {})` (line 269), insert:

```ts
  const sharp = await loadSharp()
```

`encode()` and the private `writeAtomic()` take a `Sharp` pipeline and need no module. Leave them unchanged.

- [ ] **Step 6: Make `src/engines/pdfium.ts` load pdfium and Sharp lazily**

Replace lines 1–23 with:

```ts
import { readFile, rm } from 'node:fs/promises'
import type { PDFiumDocument, PDFiumLibrary } from '@hyzyla/pdfium'
import { writeAtomic } from '../core/atomic.js'
import { encryptedSource } from '../core/errors.js'
import type { FormatId, Job, Progress, Result, SourceInfo } from '../core/types.js'
import { encode } from './image.js'
import { loadPdfium, loadSharp } from './libs.js'
import type { Engine } from './types.js'

const READS: ReadonlySet<FormatId> = new Set<FormatId>(['pdf'])
const WRITES: ReadonlySet<FormatId> = new Set<FormatId>(['jpeg', 'png'])
const OPS: ReadonlySet<Job['op']> = new Set<Job['op']>(['convert'])

// PDFiumLibrary.init() compiles the wasm module. It costs real time and there
// is no reason to pay it per file, so it is memoised for the process. The
// promise itself is cached, not the resolved value, so two concurrent callers
// share one initialisation rather than racing two. The library module itself
// loads on the same first call (libs.ts), so a command that never opens a PDF
// never reads the wasm.
let library: Promise<PDFiumLibrary> | undefined
function getLibrary(): Promise<PDFiumLibrary> {
  library ??= loadPdfium().then((pdfium) => pdfium.PDFiumLibrary.init())
  return library
}
```

In `run`, directly above `const doc = await openPdf(await readFile(source.path), job.options.password)` (line 111), insert:

```ts
    const sharp = await loadSharp()
```

- [ ] **Step 7: Make `src/engines/pdf.ts` load pdf-lib, Sharp and `core/pdf-compress` lazily**

`core/pdf-compress.ts` imports pdf-lib and Sharp at its top level, so `pdf.ts` loads that whole module lazily too. Replace lines 1–19 (the imports) with:

```ts
import { readFile, rm, stat } from 'node:fs/promises'
import { basename } from 'node:path'
import type { PDFDocument } from 'pdf-lib'
import { writeAtomic } from '../core/atomic.js'
import { emptySelection, encryptedSource } from '../core/errors.js'
import { FORMATS } from '../core/formats.js'
import { cutsToRanges, normalisePages } from '../core/pages.js'
import type {
  DocumentInfo,
  FormatId,
  ImageInfo,
  Job,
  Progress,
  Result,
  Warning,
} from '../core/types.js'
import { lazy, loadPdfLib, loadSharp } from './libs.js'
import type { Engine, Measurer } from './types.js'

/**
 * `compressPdf` and `surveyDocument` live in core but import pdf-lib and Sharp
 * at their own top level, so the module loads on first use, the same as the
 * libraries in libs.ts.
 */
const loadPdfCompress = lazy(() => import('../core/pdf-compress.js'))
```

Then make these edits. Each one replaces one expression and leaves behaviour unchanged:

```ts
// load(), line 40-42
async function load(path: string): Promise<PDFDocument> {
  const pdfLib = await loadPdfLib()
  return pdfLib.PDFDocument.load(await readFile(path), { ignoreEncryption: true })
}

// probe(), first line of the body
  const { surveyDocument } = await loadPdfCompress()

// embedBytes(), first line of the body
  const sharp = await loadSharp()

// imageToPdf(): replace `const doc = await PDFDocument.create()` with
  const pdfLib = await loadPdfLib()
  const doc = await pdfLib.PDFDocument.create()

// merge(): replace `const out = await PDFDocument.create()` with
  const pdfLib = await loadPdfLib()
  const out = await pdfLib.PDFDocument.create()

// split(): add `const pdfLib = await loadPdfLib()` directly under
// `assertUnencrypted([source])`, and inside the loop replace
// `const out = await PDFDocument.create()` with
      const out = await pdfLib.PDFDocument.create()

// pagesInto()
async function pagesInto(src: PDFDocument, indices: number[]): Promise<Uint8Array> {
  const pdfLib = await loadPdfLib()
  const out = await pdfLib.PDFDocument.create()
  const pages = await out.copyPages(src, indices)
  for (const page of pages) out.addPage(page)
  return out.save()
}

// rotate(): add `const pdfLib = await loadPdfLib()` directly under
// `assertUnencrypted([source])`, and replace `page.setRotation(degrees(next))` with
    page.setRotation(pdfLib.degrees(next))

// compressDocument(): add directly under `assertUnencrypted([source])`
  const { compressPdf } = await loadPdfCompress()

// measurer(): add directly under `if (source.kind !== 'document') return undefined`
  const { compressPdf } = await loadPdfCompress()
```

- [ ] **Step 8: Make `src/engines/word.ts` load its libraries lazily**

Replace lines 6–11:

```ts
import AdmZip from 'adm-zip'
import { find as cfbFind, parse as cfbParse } from 'cfb'
import mammoth from 'mammoth'
import { PDFDocument as PDFLibDocument, StandardFonts } from 'pdf-lib'
import { PDFParse } from 'pdf-parse'
import WordExtractor from 'word-extractor'
```

with nothing. Add `import { loadAdmZip, loadCfb, loadDocx, loadMammoth, loadPdfLib, loadWordExtractor } from './libs.js'` before `import type { Engine } from './types.js'`.

Replace `looksLikeDoc` and `readDocx` (lines 26–71) with async versions. The comments stay. The only change is that each loads its library after the cheap checks:

```ts
async function looksLikeDoc(bytes: Buffer): Promise<boolean> {
  if (bytes.length < OLE_MAGIC.length || !bytes.subarray(0, OLE_MAGIC.length).equals(OLE_MAGIC)) {
    return false
  }
  // Loaded only once the OLE magic matched: most files are not compound files.
  const cfb = await loadCfb()
  try {
    return cfb.find(cfb.parse(bytes), 'WordDocument') !== null
  } catch {
    return false
  }
}
```

```ts
async function readDocx(bytes: Buffer): Promise<DocxProbeResult | undefined> {
  const AdmZip = await loadAdmZip()
  // One try/catch around the whole read, matching `looksLikeDoc` above:
  // … (keep the existing comment block verbatim) …
  try {
    const zip = new AdmZip(bytes)
    if (!zip.getEntry('word/document.xml')) return undefined

    let pages = 0
    const appXml = zip.getEntry('docProps/app.xml')
    if (appXml) {
      const match = /<Pages>(\d+)<\/Pages>/.exec(zip.readAsText(appXml))
      if (match?.[1]) pages = Number(match[1])
    }
    return { pages }
  } catch {
    return undefined
  }
}
```

In `probe`, change `const docx = readDocx(bytes)` to `const docx = await readDocx(bytes)` and `if (looksLikeDoc(bytes)) {` to `if (await looksLikeDoc(bytes)) {`.

Replace the body of `extractPlainText` (lines 200–222) with:

```ts
export async function extractPlainText(source: DocumentInfo): Promise<string[]> {
  if (source.format === 'docx') {
    const mammoth = await loadMammoth()
    const { value } = await mammoth.extractRawText({ path: source.path })
    return splitParagraphs(value)
  }

  if (source.format === 'doc') {
    const WordExtractor = await loadWordExtractor()
    const extractor = new WordExtractor()
    const doc = await extractor.extract(source.path)
    return splitParagraphs(doc.getBody())
  }

  // source.format === 'pdf'
  const { PDFParse } = await import('pdf-parse')
  const parser = new PDFParse({ data: await readFile(source.path) })
  try {
    const { pages } = await parser.getText()
    return pages.flatMap((page, i) =>
      i === 0 ? splitParagraphs(page.text) : [PAGE_BREAK, ...splitParagraphs(page.text)],
    )
  } finally {
    await parser.destroy()
  }
}
```

(Task 2 replaces the PDF branch outright. Until then it is lazy like the rest, so it never loads Skia for `--version`.)

In `layoutAsPdf`, replace the first two lines of the body:

```ts
  const doc = await PDFLibDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
```

with:

```ts
  const { PDFDocument, StandardFonts } = await loadPdfLib()
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
```

Delete lines 277–318 (`type DocxModule`, `let docxModule`, the `loadDocx` doc comment, `function loadDocx`, `async function importWithoutLocalStorage`). They now live in `libs.ts`. `buildDocx` keeps calling `loadDocx()`, which is now the imported one.

- [ ] **Step 9: Parse first in `src/index.ts`, and enable the compile cache**

Replace the whole file with:

```ts
#!/usr/bin/env node
import * as nodeModule from 'node:module'
import { parseArgs } from './cli/args.js'
import type { BatchProgress } from './cli/execute.js'
import { type Spinner, startSpinner } from './cli/spinner.js'
import { isForgeError, renderError } from './core/errors.js'

/**
 * Node's on-disk compile cache for every module loaded after this line, which
 * is all of the heavy ones because they are imported dynamically below.
 * Measured at -25 ms per run (spec §4.2.3).
 *
 * A namespace import plus an optional call, never `import { enableCompileCache }`:
 * the function arrived in Node 22.1, `engines` allows 20, and a missing named
 * export from a built-in is a link error that would stop Forge from starting
 * at all.
 */
nodeModule.enableCompileCache?.()

/**
 * Prints "Converting N files" once, then a completion counter as jobs finish.
 * Only src/index.ts prints, so this is the sole consumer of execute()'s
 * progress callback, and only on a real TTY, so a piped or CI run stays
 * quiet. No live redraw: each update is its own line, not a bar to be built.
 */
function onProgress({ completed, total }: BatchProgress): void {
  if (completed === 0) {
    process.stderr.write(`Converting ${total} files\n`)
  } else {
    process.stderr.write(`  ${completed}/${total}\n`)
  }
}

// Re-exported, not redeclared: theme.ts owns the value so the shell can
// show it in the banner without importing the entrypoint and forming a cycle.
export { VERSION } from './shell/theme.js'

async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  const debug = argv.includes('--debug')

  try {
    // Parse first, import second (spec §4.2). `--version`, `--help` and every
    // usage error are answered inside parseArgs, by Commander, before any
    // engine, library or shell module is loaded.
    const intent = parseArgs(argv)

    // The shell is only ever launched from a real terminal. Piped or scripted
    // invocations must never block waiting for a keypress.
    //
    // Both streams are checked, not just stdout. `useInput` calls
    // `setRawMode(true)` on stdin, which throws when stdin is not a TTY — and
    // `forge < /dev/null`, a Makefile recipe, or an IDE run pane all give a
    // TTY stdout with a redirected stdin. Gating on stdout alone let those
    // through to Ink, whose ErrorBoundary then rendered the raw stack.
    if (intent.kind === 'shell') {
      if (!process.stdout.isTTY || !process.stdin.isTTY) {
        process.stderr.write(
          'Forge needs a file and a target format.\nTry: forge photo.jpg --to webp\n',
        )
        process.exitCode = 2
        return
      }
      // Before the shell — and therefore before Ink, and therefore before
      // chalk, which fixes its colour level at import time and never
      // reconsults the environment afterwards. See shell/theme.ts.
      const { applyColourPreference } = await import('./shell/theme.js')
      applyColourPreference()

      const { launchShell } = await import('./shell/launch.js')
      await launchShell()
      return
    }

    // Only now, with real work to do, is the engine layer loaded.
    const { execute } = await import('./cli/execute.js')

    /**
     * The spinner is created on the first search callback rather than up
     * front: most runs never search at all, and starting one for them would
     * flash a line for no reason. `execute` reports a position; only this
     * file decides to animate it, and only on a terminal.
     */
    let spinner: Spinner | undefined
    const result = await execute(intent, {
      onProgress: process.stderr.isTTY ? onProgress : undefined,
      ...(process.stderr.isTTY
        ? {
            onSearch: (status: string) => {
              spinner ??= startSpinner(process.stderr, 'finding the smallest that fits')
              spinner.update(status)
            },
          }
        : {}),
    })
    spinner?.stop()
    if (result.stdout.length > 0) process.stdout.write(`${result.stdout.join('\n')}\n`)
    if (result.stderr.length > 0) process.stderr.write(`${result.stderr.join('\n')}\n`)
    process.exitCode = result.exitCode
  } catch (e) {
    if (isForgeError(e)) {
      process.stderr.write(`${renderError(e, { debug }).join('\n')}\n`)
      process.exitCode = 2
      return
    }
    // Commander throws for --help, --version, and argument errors, having
    // already printed. Only help and version mean success — an unknown
    // option or a missing option argument is a usage error and must exit 2,
    // never Commander's own exitCode 1, which would collide with spec §9's
    // "1 = some files failed".
    if (e instanceof Error && 'code' in e && 'exitCode' in e) {
      const code = (e as { code?: unknown }).code
      process.exitCode = code === 'commander.helpDisplayed' || code === 'commander.version' ? 0 : 2
      return
    }
    throw e
  }
}

await main()
```

- [ ] **Step 10: Run the new tests and confirm they pass**

Run: `npx vitest run tests/cli/lazy-load.test.ts tests/engines/libs.test.ts`
Expected: all 7 tests PASS.

- [ ] **Step 11: Run the full suite, typecheck and lint**

Run: `npm test && npm run typecheck && npm run lint`
Expected: everything passes. The existing `tests/index.test.ts` "stderr hygiene" cases cover the moved docx loader. The `word-*`, `pdf-*` and `probe` suites cover the async `readDocx`/`looksLikeDoc` and every lazy pdf-lib call site.

- [ ] **Step 12: Commit**

```bash
git add src/index.ts src/engines/libs.ts src/engines/image.ts src/engines/pdf.ts src/engines/pdfium.ts src/engines/word.ts tests/helpers/load-recorder.mjs tests/helpers/load-log.ts tests/cli/lazy-load.test.ts tests/engines/libs.test.ts
git commit -m "$(cat <<'EOF'
perf: parse first and load engine libraries on demand

--version, --help and usage errors no longer import execute.ts, and
each engine loads sharp, pdf-lib, pdfium, mammoth, word-extractor,
adm-zip, cfb and docx through a cached loader in engines/libs.ts.
Capability data stays static, so targetsFor() and probe order are
unchanged. The compile cache is enabled when Node has it.

A module-load hook test keeps a stray static import from creeping back.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Replace `pdf-parse` with pdfium's text extraction (§4.1)

**Files:**
- Create: `scripts/make-text-fixtures.swift`
- Create: `tests/fixtures/text/manifest.json` and the five generated PDFs in `tests/fixtures/text/`
- Create: `tests/helpers/pdf-text.ts`
- Create: `tests/engines/pdf-text-compare.test.ts` (temporary: deleted in Step 9 of this task)
- Create: `tests/engines/pdf-text.test.ts`
- Modify: `tests/helpers/fixtures.ts` (append `makeType3Pdf`)
- Modify: `src/engines/pdfium.ts` (append `extractPdfText`)
- Modify: `src/engines/word.ts` (PDF branch of `extractPlainText`, and the comment at the encrypted refusal in `run`)
- Modify: `tests/engines/word-convert.test.ts:4, 48-51, 74-77`
- Modify: `tests/engines/word-fallback-text.test.ts:5, 105-108`
- Modify: `tests/engines/word-libreoffice-convert.test.ts:3, 47-50`
- Modify: `tests/fixtures/README.md` (append a section)
- Modify: `package.json`, `package-lock.json` (remove `pdf-parse`)
- Modify: `docs/superpowers/specs/2026-10-11-forge-lean-and-fast-design.md` (§4.1 results)

**Interfaces:**
- Consumes (Task 1): `openPdf(bytes, password?)` in `src/engines/pdfium.ts`, which now loads pdfium lazily.
- Produces: `export async function extractPdfText(bytes: Uint8Array): Promise<string[]>` in `src/engines/pdfium.ts`. It returns one string per page, in page order, with pdfium's `\r\n` line endings. It rejects for an encrypted PDF (there is no password parameter: `word.ts` refuses encrypted sources before calling it). Also `makeType3Pdf(dir: string, name: string, text: string): Promise<string>` in `tests/helpers/fixtures.ts`.

- [ ] **Step 1: Write the fixture generator and generate the committed fixtures**

`scripts/make-text-fixtures.swift`:

```swift
// Generates the PDF text-extraction fixtures from a manifest, through
// CoreText, which lays out right-to-left scripts, CJK and ligatures the way a
// real Mac app's "Save as PDF" does. One-off: the PDFs are committed, so the
// test suite never needs Swift.
//
//   swift scripts/make-text-fixtures.swift tests/fixtures/text/manifest.json tests/fixtures/text
import CoreGraphics
import CoreText
import Foundation

struct Fixture: Decodable {
  let file: String
  let columns: Int
  let font: String
  let lines: [String]
}

let args = CommandLine.arguments
guard args.count == 3 else {
  FileHandle.standardError.write("usage: make-text-fixtures.swift <manifest.json> <outdir>\n".data(using: .utf8)!)
  exit(2)
}
let manifest = try JSONDecoder().decode(
  [Fixture].self, from: Data(contentsOf: URL(fileURLWithPath: args[1])))
let outDir = URL(fileURLWithPath: args[2])

let pageWidth: CGFloat = 612
let pageHeight: CGFloat = 792
let margin: CGFloat = 54
let gutter: CGFloat = 24

for fixture in manifest {
  var box = CGRect(x: 0, y: 0, width: pageWidth, height: pageHeight)
  let url = outDir.appendingPathComponent(fixture.file)
  guard let ctx = CGContext(url as CFURL, mediaBox: &box, nil) else {
    FileHandle.standardError.write("cannot create \(url.path)\n".data(using: .utf8)!)
    exit(1)
  }
  ctx.beginPDFPage(nil)
  let font = CTFontCreateWithName(fixture.font as CFString, 12, nil)
  let text = NSAttributedString(
    string: fixture.lines.joined(separator: "\n"),
    attributes: [NSAttributedString.Key(kCTFontAttributeName as String): font]
  )
  let setter = CTFramesetterCreateWithAttributedString(text)
  let columns = CGFloat(fixture.columns)
  let width = (pageWidth - margin * 2 - gutter * (columns - 1)) / columns
  var start = 0
  for c in 0..<fixture.columns {
    let rect = CGRect(
      x: margin + CGFloat(c) * (width + gutter), y: margin,
      width: width, height: pageHeight - margin * 2)
    let frame = CTFramesetterCreateFrame(
      setter, CFRange(location: start, length: 0), CGPath(rect: rect, transform: nil), nil)
    CTFrameDraw(frame, ctx)
    start += CTFrameGetVisibleStringRange(frame).length
  }
  ctx.endPDFPage()
  ctx.closePDF()
  print("wrote \(url.path)")
}
```

Generate the manifest and the PDFs:

```bash
mkdir -p tests/fixtures/text
node -e '
const sentences = Array.from({ length: 90 }, (_, i) => `Column text sentence number ${i + 1}.`).join(" ")
const manifest = [
  { file: "columns.pdf", columns: 2, font: "Helvetica", lines: [sentences] },
  { file: "hebrew.pdf", columns: 1, font: "Arial Hebrew", lines: ["שלום עולם וברוכים הבאים"] },
  { file: "arabic.pdf", columns: 1, font: "Geeza Pro", lines: ["مرحبا بالعالم", "النص العربي"] },
  { file: "cjk.pdf", columns: 1, font: "Hiragino Sans", lines: ["日本語のテキストです", "中文文本示例", "한국어 텍스트"] },
  { file: "ligatures.pdf", columns: 1, font: "Hoefler Text", lines: ["office affine flight waffle efficient"] },
]
require("fs").writeFileSync("tests/fixtures/text/manifest.json", JSON.stringify(manifest, null, 2) + "\n")'
npx biome format --write tests/fixtures/text/manifest.json
swift scripts/make-text-fixtures.swift tests/fixtures/text/manifest.json tests/fixtures/text
```

Expected: five `wrote …/tests/fixtures/text/<name>.pdf` lines, each file 7–15 KB. Ninety sentences overflow the first column, which is what makes `columns.pdf` genuinely two-column. Hoefler Text gets standard ligatures by default in CoreText, so `fi`/`ffi` are drawn as ligature glyphs.

- [ ] **Step 2: Add the Type3 fixture builder to `tests/helpers/fixtures.ts`**

Append:

```ts
/**
 * A one-page PDF whose only font is Type3: glyphs drawn by content-stream
 * procedures rather than an embedded font program, the way TeX bitmap fonts
 * and some report generators ship text. Every letter is the same filled
 * square. A ToUnicode CMap is what makes the text extractable, as it is in
 * real Type3 PDFs.
 *
 * Hand-assembled because pdf-lib cannot write a Type3 font. `text` must be
 * uppercase A-Z and spaces.
 */
export async function makeType3Pdf(dir: string, name: string, text: string): Promise<string> {
  if (!/^[A-Z ]+$/.test(text)) throw new Error('makeType3Pdf draws only A-Z and spaces')
  const letters = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ']
  const stream = (body: string) =>
    `<< /Length ${Buffer.byteLength(body, 'latin1')} >>\nstream\n${body}\nendstream`
  const cmap = [
    '/CIDInit /ProcSet findresource begin',
    '12 dict begin',
    'begincmap',
    '/CMapName /ForgeType3 def',
    '/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def',
    '1 begincodespacerange <00> <FF> endcodespacerange',
    '1 beginbfrange <20> <5A> <0020> endbfrange',
    'endcmap',
    'CMapName currentdict /CMap defineresource pop',
    'end',
    'end',
  ].join('\n')
  const widths = Array.from({ length: 0x5a - 0x20 + 1 }, (_, i) => (i === 0 ? 500 : 1000)).join(' ')
  const procs = ['/space 6 0 R', ...letters.map((l) => `/${l} 7 0 R`)].join(' ')
  const differences = `[32 /space 65 ${letters.map((l) => `/${l}`).join(' ')}]`
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    stream(`BT /F1 24 Tf 72 700 Td (${text}) Tj ET`),
    `<< /Type /Font /Subtype /Type3 /FontBBox [0 0 750 750] /FontMatrix [0.001 0 0 0.001 0 0] /CharProcs << ${procs} >> /Encoding << /Type /Encoding /Differences ${differences} >> /FirstChar 32 /LastChar 90 /Widths [${widths}] /Resources << >> /ToUnicode 8 0 R >>`,
    stream('500 0 d0'),
    stream('1000 0 0 0 750 750 d1 0 0 750 750 re f'),
    stream(cmap),
  ]
  let pdf = '%PDF-1.4\n'
  const offsets: number[] = []
  for (const [i, body] of objects.entries()) {
    offsets.push(Buffer.byteLength(pdf, 'latin1'))
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`
  }
  const xref = Buffer.byteLength(pdf, 'latin1')
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (const offset of offsets) pdf += `${String(offset).padStart(10, '0')} 00000 n \n`
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  const path = join(dir, name)
  await writeFile(path, Buffer.from(pdf, 'latin1'))
  return path
}
```

- [ ] **Step 3: Write the shared cases and scorer, `tests/helpers/pdf-text.ts`**

```ts
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { makeScannedPdf, makeTempDir, makeType3Pdf } from './fixtures.js'

export interface TextCase {
  name: string
  path: () => Promise<string>
  /** What a reader sees on the page, in reading order. '' for a scan. */
  expected: string
}

interface ManifestEntry {
  file: string
  columns: number
  font: string
  lines: string[]
}

const FIXTURES = join(process.cwd(), 'tests', 'fixtures', 'text')
const TYPE3_TEXT = 'TYPE THREE GLYPHS READ BACK'

/**
 * The spec §4.1 fixture set: multi-column, right-to-left (Hebrew and Arabic),
 * CJK, ligatures, a Type3 font and a scanned (image-only) page.
 */
export async function textCases(): Promise<TextCase[]> {
  const manifest = JSON.parse(
    await readFile(join(FIXTURES, 'manifest.json'), 'utf8'),
  ) as ManifestEntry[]
  const dir = await makeTempDir()
  return [
    ...manifest.map((m) => ({
      name: m.file.replace(/\.pdf$/, ''),
      path: async () => join(FIXTURES, m.file),
      expected: m.lines.join('\n'),
    })),
    { name: 'type3', path: () => makeType3Pdf(dir, 'type3.pdf', TYPE3_TEXT), expected: TYPE3_TEXT },
    {
      name: 'scanned',
      path: () => makeScannedPdf(dir, 'scanned.pdf', { pages: 1 }),
      expected: '',
    },
  ]
}

/**
 * NFKC folds Arabic presentation forms and ligature code points (U+FB01 'ﬁ')
 * back to the letters a reader typed. Whitespace runs collapse because the
 * extractors break lines differently (pdfium '\r\n', pdf.js '\n').
 */
export function normalise(text: string): string {
  return text.normalize('NFKC').replace(/\s+/g, ' ').trim()
}

export interface Score {
  /** Share of the expected words present anywhere in the extraction. */
  recall: number
  /** The whole expected text appears, in reading order. */
  inOrder: boolean
  /** Text was produced where the page has none (a scan). */
  invented: boolean
}

export function score(extracted: string, expected: string): Score {
  const got = normalise(extracted)
  const want = normalise(expected)
  const words = want === '' ? [] : want.split(' ')
  const found = words.filter((w) => got.includes(w)).length
  return {
    recall: words.length === 0 ? 1 : found / words.length,
    inOrder: got.includes(want),
    invented: want === '' && got !== '',
  }
}
```

- [ ] **Step 4: Write the comparison gate test (temporary) and the permanent test, and watch both fail**

`tests/engines/pdf-text-compare.test.ts`:

```ts
import { readFile } from 'node:fs/promises'
import { PDFParse } from 'pdf-parse'
import { describe, expect, it } from 'vitest'
import { extractPdfText } from '../../src/engines/pdfium.js'
import { score, textCases } from '../helpers/pdf-text.js'

/**
 * Spec §4.1: the switch proceeds only if pdfium is at least as good as
 * pdf-parse on every fixture. This file is the gate. It is deleted in the
 * same task, once pdf-parse is uninstalled, after its results are recorded in
 * the spec.
 */
const cases = await textCases()

describe('pdfium against pdf-parse', () => {
  it.each(cases.map((c) => [c.name, c] as const))('%s', async (name, c) => {
    const bytes = await readFile(await c.path())
    const parser = new PDFParse({ data: new Uint8Array(bytes) })
    let pdfjs: string
    try {
      pdfjs = (await parser.getText()).pages.map((p) => p.text).join('\n')
    } finally {
      await parser.destroy()
    }
    const pdfium = (await extractPdfText(bytes)).join('\n')

    const before = score(pdfjs, c.expected)
    const after = score(pdfium, c.expected)
    console.info(`[§4.1] ${name}: pdf-parse ${JSON.stringify(before)} pdfium ${JSON.stringify(after)}`)

    expect(after.recall).toBeGreaterThanOrEqual(before.recall)
    if (before.inOrder) expect(after.inOrder).toBe(true)
    if (!before.invented) expect(after.invented).toBe(false)
  })
})
```

`tests/engines/pdf-text.test.ts`:

```ts
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import mammoth from 'mammoth'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { extractPdfText } from '../../src/engines/pdfium.js'
import { probe } from '../../src/engines/registry.js'
import {
  forceLibreOfficeForTests,
  stopForcingLibreOfficeForTests,
  wordEngine,
} from '../../src/engines/word.js'
import { makeTempDir, makeTextPdf } from '../helpers/fixtures.js'
import { score, textCases } from '../helpers/pdf-text.js'

const cases = await textCases()
const LOCKED = join(process.cwd(), 'tests', 'fixtures', 'locked-hunter2.pdf')

describe('extractPdfText', () => {
  it.each(cases.map((c) => [c.name, c] as const))(
    '%s reads back complete, in reading order, inventing nothing',
    async (_name, c) => {
      const pages = await extractPdfText(await readFile(await c.path()))
      expect(score(pages.join('\n'), c.expected)).toEqual({
        recall: 1,
        inOrder: true,
        invented: false,
      })
    },
  )

  it('returns one string per page, in page order', async () => {
    const dir = await makeTempDir()
    const path = await makeTextPdf(dir, 'three.pdf', ['First page.', 'Second page.', 'Third page.'])
    const pages = await extractPdfText(await readFile(path))
    expect(pages).toHaveLength(3)
    expect(pages[0]).toContain('First page.')
    expect(pages[1]).toContain('Second page.')
    expect(pages[2]).toContain('Third page.')
  })

  it('rejects an encrypted PDF rather than returning empty text', async () => {
    await expect(extractPdfText(await readFile(LOCKED))).rejects.toThrow()
  })
})

describe('PDF to DOCX without LibreOffice', () => {
  beforeEach(() => forceLibreOfficeForTests(undefined))
  afterEach(() => stopForcingLibreOfficeForTests())

  it('carries CJK text through to the docx, which pdf-parse dropped entirely', async () => {
    const dir = await makeTempDir()
    const source = await probe(join(process.cwd(), 'tests', 'fixtures', 'text', 'cjk.pdf'))
    const output = join(dir, 'cjk.docx')
    await wordEngine.run(
      { op: 'convert', sources: [source], outputs: [output], target: 'docx', options: { background: '#ffffff', keepMetadata: false } },
      () => {},
    )
    const { value } = await mammoth.extractRawText({ path: output })
    expect(value).toContain('日本語のテキストです')
    expect(value).toContain('한국어 텍스트')
  })
})
```

Run: `npx vitest run tests/engines/pdf-text-compare.test.ts tests/engines/pdf-text.test.ts`
Expected: both FAIL on `extractPdfText is not a function` (or "does not provide an export named 'extractPdfText'"). The CJK→DOCX case fails on `expected '' to contain '日本語のテキストです'`, because `word.ts` still uses pdf-parse.

- [ ] **Step 5: Add `extractPdfText` to `src/engines/pdfium.ts`**

Append after `openPdf`:

```ts
/**
 * The text of every page, in page order, one string per page, with pdfium's
 * own `\r\n` line breaks (word.ts's `splitParagraphs` already splits on them).
 *
 * Replaces pdf-parse, which cost 83 MB installed and loaded Skia through
 * pdf.js's canvas binding (spec §4.1). Measured against it on the §4.1
 * fixture set, pdfium was as good or better on every one.
 *
 * Unlocked documents only: word.ts refuses an encrypted source before this
 * is reached, and a locked one rejects here instead of reading as blank.
 * A fresh `getPage` per index, as in `run` below: a `PDFiumPage` is not
 * reused.
 */
export async function extractPdfText(bytes: Uint8Array): Promise<string[]> {
  const doc = await openPdf(bytes)
  try {
    const pages: string[] = []
    for (let i = 0; i < doc.getPageCount(); i++) pages.push(doc.getPage(i).getText())
    return pages
  } finally {
    doc.destroy()
  }
}
```

- [ ] **Step 6: Switch `word.ts` to it**

Add `import { extractPdfText } from './pdfium.js'` to `src/engines/word.ts` (after `./libs.js`). Replace the PDF branch of `extractPlainText` with:

```ts
  // source.format === 'pdf'
  const pages = await extractPdfText(await readFile(source.path))
  return pages.flatMap((text, i) =>
    i === 0 ? splitParagraphs(text) : [PAGE_BREAK, ...splitParagraphs(text)],
  )
```

In `run`, change the comment line `// rather than letting pdf-parse throw and surfacing a generic` to `// rather than letting pdfium's load fail and surfacing a generic`.

Run: `npx vitest run tests/engines/pdf-text-compare.test.ts tests/engines/pdf-text.test.ts tests/engines/word-fallback-text.test.ts`
Expected: PASS. The `[§4.1]` lines printed by the gate should read as follows (measured during planning; record whatever the run actually prints):

| Fixture | pdf-parse recall / in order | pdfium recall / in order |
| --- | --- | --- |
| columns | 1 / yes | 1 / yes |
| hebrew | 1 / **no** (words reversed) | 1 / yes |
| arabic | 1 / **no** (words reversed) | 1 / yes |
| cjk | **0** / no (nothing extracted) | 1 / yes |
| ligatures | 1 / yes | 1 / yes |
| type3 | **0.8** / no ("BACK" truncated to "BA") | 1 / yes |
| scanned | 1 / yes, nothing invented | 1 / yes, nothing invented |

If any row shows pdfium worse, stop. Per spec §4.1 that regression blocks the change or must be recorded as a known limitation, which is a decision for the human partner, not the implementer.

- [ ] **Step 7: Swap the three oracles**

In each of `tests/engines/word-convert.test.ts`, `tests/engines/word-fallback-text.test.ts` and `tests/engines/word-libreoffice-convert.test.ts`, replace `import { PDFParse } from 'pdf-parse'` with:

```ts
import { extractPdfText } from '../../src/engines/pdfium.js'
```

and replace every block of this shape (two in `word-convert`, one in each of the others):

```ts
    const parser = new PDFParse({ data: await readFile(output) })
    const { text } = await parser.getText()
    await parser.destroy()
```

with (using `path` in place of `output` in `word-fallback-text.test.ts`, matching the variable already there):

```ts
    const text = (await extractPdfText(await readFile(output))).join('\n')
```

The `expect(text).toContain(...)` lines that follow stay unchanged.

- [ ] **Step 8: Record the results in the spec, then remove `pdf-parse`**

Append to §4.1 of `docs/superpowers/specs/2026-10-11-forge-lean-and-fast-design.md`, after the last bullet:

```markdown
**Comparison results** (`tests/engines/pdf-text-compare.test.ts`, run before
the switch, then removed with pdf-parse). Recall is the share of expected
words found. "In order" means the whole text appears in reading order.

| Fixture | pdf-parse | pdfium |
| --- | --- | --- |
| two-column layout | 1.0, in order | 1.0, in order |
| Hebrew (RTL) | 1.0, words reversed | 1.0, in order |
| Arabic (RTL) | 1.0, words reversed | 1.0, in order |
| CJK (ja/zh/ko) | 0.0, nothing extracted | 1.0, in order |
| ligatures (fi, ffi) | 1.0, in order | 1.0, in order |
| Type3 font | 0.8, last glyphs dropped | 1.0, in order |
| scanned, image-only | empty, nothing invented | empty, nothing invented |

pdfium is at least as good on every fixture, so the switch proceeds with no
known limitation. A scanned PDF still converts to an empty document; OCR is
out of scope.
```

(Use the numbers your run printed if they differ from these.)

Then:

```bash
git rm tests/engines/pdf-text-compare.test.ts
npm uninstall pdf-parse
grep -rn "pdf-parse\|PDFParse" src tests package.json
```

Expected: `npm uninstall` removes `pdf-parse` from `dependencies` and the lockfile. The grep finds only the doc comment on `extractPdfText` ("Replaces pdf-parse, …") and the history comment in `tests/cli/lazy-load.test.ts`'s `ENGINE_LIBRARIES`. Delete `'pdf-parse',` from that array: a removed package needs no guard.

Append to `tests/fixtures/README.md`:

```markdown
## `text/`

PDF text-extraction fixtures for spec §4.1: `columns.pdf`, `hebrew.pdf`,
`arabic.pdf`, `cjk.pdf` and `ligatures.pdf`, each one page. The text drawn on
each page is in `manifest.json`, which the tests read as ground truth.

Generated once on macOS by CoreText, which lays out right-to-left scripts,
CJK and ligatures the way a Mac app's "Save as PDF" does:

    swift scripts/make-text-fixtures.swift tests/fixtures/text/manifest.json tests/fixtures/text

They embed subsets of macOS system fonts, as any PDF saved on a Mac does.
They are test data only and never ship (`files` in package.json is `dist`).
The Type3 and scanned cases are built at test time instead
(`makeType3Pdf`, `makeScannedPdf` in `tests/helpers/fixtures.ts`).
```

- [ ] **Step 9: Run the full suite, typecheck and lint**

Run: `npm test && npm run typecheck && npm run lint`
Expected: everything passes. Also run `npx tsx src/index.ts tests/fixtures/text/arabic.pdf --to docx -o /tmp/forge-arabic/`. Expected: `✓ arabic.pdf → /tmp/forge-arabic/arabic.docx` and the basic-formatting warning. Nothing else on stderr.

- [ ] **Step 10: Commit**

```bash
git add scripts/make-text-fixtures.swift tests/fixtures/text tests/fixtures/README.md tests/helpers/fixtures.ts tests/helpers/pdf-text.ts tests/engines/pdf-text.test.ts tests/engines/word-convert.test.ts tests/engines/word-fallback-text.test.ts tests/engines/word-libreoffice-convert.test.ts tests/cli/lazy-load.test.ts src/engines/pdfium.ts src/engines/word.ts package.json package-lock.json docs/superpowers/specs/2026-10-11-forge-lean-and-fast-design.md
git commit -m "$(cat <<'EOF'
perf(word): read PDF text with pdfium and drop pdf-parse

pdf-parse cost 83 MB installed and loaded Skia through pdf.js's canvas
binding. pdfium's getText() matched or beat it on every fixture in the
spec §4.1 set: two-column, Hebrew, Arabic, CJK, ligatures, a Type3
font and a scan. pdf.js reversed RTL word order, dropped CJK entirely
and truncated the Type3 text. Results are recorded in the spec.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: The shell's intro overlaps loading (§4.3)

**Files:**
- Create: `src/shell/boot.ts`
- Create: `tests/shell/boot.test.ts`
- Modify: `src/shell/mark.ts` (append `WORDMARK`)
- Modify: `src/shell/components/Banner.tsx:7-24` (the `WORDMARK` declaration becomes an import plus a re-export; nothing else)
- Modify: `src/shell/intro.ts:1` (import `WORDMARK` from `./mark.js`)
- Modify: `src/shell/launch.tsx` (whole file)
- Modify: `src/index.ts` (shell branch only)

**Interfaces:**
- Consumes (Task 1): `modulesLoaded`, `packagesIn` from `tests/helpers/load-log.ts`, and the parse-first `src/index.ts`.
- Produces:
  - `src/shell/launch.tsx`: `export interface ShellStart { prefs: Preferences; palette: Palette; warning?: string }` and `export async function launchShell(start: ShellStart): Promise<void>`. The old zero-argument signature is gone.
  - `src/shell/boot.ts`: `export interface BootDeps { loadPreferences: () => Promise<{ prefs: Preferences; warning?: string }>; playIntro: (opts: IntroOptions) => Promise<void>; loadShell: () => Promise<{ launchShell: (start: ShellStart) => Promise<void> }>; width: () => number }` and `export async function bootShell(deps?: BootDeps): Promise<void>`.
  - `src/shell/mark.ts`: `export const WORDMARK` (same value as before). `Banner.tsx` still exports `WORDMARK` by re-export, so `tests/shell/banner.test.tsx` is untouched.

- [ ] **Step 1: Write the failing tests**

`tests/shell/boot.test.ts`:

```ts
import { afterEach, describe, expect, it } from 'vitest'
import { DEFAULT_PREFERENCES, type Preferences } from '../../src/config/preferences.js'
import { type BootDeps, bootShell } from '../../src/shell/boot.js'
import type { ShellStart } from '../../src/shell/launch.js'
import { DARK } from '../../src/shell/theme.js'
import { modulesLoaded, packagesIn } from '../helpers/load-log.js'

const later = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))
const themed: Preferences = { ...DEFAULT_PREFERENCES, theme: 'dark' }

/**
 * Stands in for the three slow things boot coordinates: the prefs read, the
 * intro animation and the shell's module graph. `events` records the order
 * they actually happened in.
 */
function harness(
  prefs: Preferences,
  opts: { introMs?: number; loadMs?: number; warning?: string; loadFails?: Error } = {},
) {
  const events: string[] = []
  const started: ShellStart[] = []
  const deps: BootDeps = {
    loadPreferences: async () => ({
      prefs,
      ...(opts.warning === undefined ? {} : { warning: opts.warning }),
    }),
    playIntro: async () => {
      events.push('intro:start')
      await later(opts.introMs ?? 40)
      events.push('intro:end')
    },
    loadShell: async () => {
      events.push('load:start')
      await later(opts.loadMs ?? 20)
      if (opts.loadFails) throw opts.loadFails
      events.push('load:end')
      return {
        launchShell: async (start: ShellStart) => {
          events.push('launch')
          started.push(start)
        },
      }
    },
    width: () => 120,
  }
  return { deps, events, started }
}

describe('bootShell', () => {
  it('starts loading the shell before the intro plays, so the two overlap', async () => {
    const { deps, events } = harness(themed, { introMs: 40, loadMs: 20 })
    await bootShell(deps)
    expect(events).toEqual(['load:start', 'intro:start', 'load:end', 'intro:end', 'launch'])
  })

  it('waits for a slow load after a fast intro, and only then launches', async () => {
    const { deps, events } = harness(themed, { introMs: 10, loadMs: 60 })
    await bootShell(deps)
    expect(events).toEqual(['load:start', 'intro:start', 'intro:end', 'load:end', 'launch'])
  })

  it('skips the intro on first run, when no theme has been chosen, and still launches', async () => {
    const { deps, events, started } = harness(DEFAULT_PREFERENCES)
    await bootShell(deps)
    expect(events).toEqual(['load:start', 'load:end', 'launch'])
    expect(started[0]?.prefs.theme).toBeUndefined()
  })

  it('hands the shell its prefs, palette and config warning', async () => {
    const { deps, started } = harness(themed, { warning: 'Could not read config.json.' })
    await bootShell(deps)
    expect(started[0]?.prefs).toEqual(themed)
    expect(started[0]?.palette).toBe(DARK)
    expect(started[0]?.warning).toBe('Could not read config.json.')
  })

  describe('when the shell fails to load mid-intro', () => {
    const unhandled: unknown[] = []
    const record = (reason: unknown) => unhandled.push(reason)
    afterEach(() => {
      process.off('unhandledRejection', record)
    })

    it('finishes the intro, then rejects once, with no unhandled rejection', async () => {
      process.on('unhandledRejection', record)
      // The load fails at 20 ms, while the 40 ms intro is still drawing.
      const { deps, events } = harness(themed, {
        introMs: 40,
        loadMs: 20,
        loadFails: new Error('chunk missing'),
      })
      await expect(bootShell(deps)).rejects.toThrow('chunk missing')
      expect(events).toEqual(['load:start', 'intro:start', 'intro:end'])
      await later(10)
      expect(unhandled).toEqual([])
    })
  })

  it('pulls in neither Ink nor React just by being imported', async () => {
    // applyColourPreference must run before chalk, which Ink imports. boot.ts
    // is imported right after it, so boot.ts itself must not reach Ink.
    const { exitCode, urls } = await modulesLoaded([
      '--input-type=module',
      '-e',
      "await import('./src/shell/boot.ts')",
    ])
    expect(exitCode).toBe(0)
    const packages = packagesIn(urls)
    expect(packages).not.toContain('ink')
    expect(packages).not.toContain('react')
    expect(packages).not.toContain('chalk')
  })
})
```

Run: `npx vitest run tests/shell/boot.test.ts`
Expected: FAIL, "Failed to load url ../../src/shell/boot.js".

- [ ] **Step 2: Move `WORDMARK` out of the Ink component**

Append to `src/shell/mark.ts`:

```ts
/**
 * `█` is the letter face; `╔═╗║╚╝` is its edge. The edge is the whole point:
 * solid-slab block letters leave O and G, and E and F, with near-identical
 * silhouettes at this size, and the outline is what tells them apart. Six
 * rows rather than five, because five does not leave enough vertical room to
 * describe a letterform.
 *
 * Every row must be exactly the same length or the letters shear. Trailing
 * spaces are therefore significant, and a test pins it.
 *
 * Lives here, not in `components/Banner.tsx`, so `intro.ts`, which plays
 * before Ink exists, can draw it without importing Ink (spec §4.3).
 */
export const WORDMARK = [
  '███████╗ ██████╗ ██████╗  ██████╗ ███████╗',
  '██╔════╝██╔═══██╗██╔══██╗██╔════╝ ██╔════╝',
  '█████╗  ██║   ██║██████╔╝██║  ███╗█████╗  ',
  '██╔══╝  ██║   ██║██╔══██╗██║   ██║██╔══╝  ',
  '██║     ╚██████╔╝██║  ██║╚██████╔╝███████╗',
  '╚═╝      ╚═════╝ ╚═╝  ╚═╝ ╚═════╝ ╚══════╝',
] as const
```

In `src/shell/components/Banner.tsx`, delete the `WORDMARK` doc comment and `export const WORDMARK = [ … ] as const` (lines 7–24). Change line 2 to:

```ts
import { glyphColour, HEAT, MARK_AT_REST, MARK_WIDTH, REST_STEP, WORDMARK } from '../mark.js'
```

and add, directly after the imports:

```ts
/** Re-exported: the wordmark's data lives in mark.ts, beside the mark's. */
export { WORDMARK }
```

Nothing else in `Banner.tsx` changes. If the parallel shell redesign has already rewritten this file, apply the same two-line change to whatever declares `WORDMARK` there, and take nothing else from the conflict.

In `src/shell/intro.ts`, delete line 1 (`import { WORDMARK } from './components/Banner.js'`) and add `WORDMARK` to the existing `./mark.js` import list (alphabetical, after `type SwingStep`).

- [ ] **Step 3: Make `launch.tsx` only render**

Replace `src/shell/launch.tsx` with:

```tsx
import { render } from 'ink'
import type { Preferences } from '../config/preferences.js'
import { App } from './App.js'
import { ThemeProvider } from './ThemeContext.js'
import type { Palette } from './theme.js'

/** What `boot.ts` hands over once preferences are read and the intro has played. */
export interface ShellStart {
  prefs: Preferences
  palette: Palette
  /** A config file that could not be read, phrased for the shell's history. */
  warning?: string
}

/**
 * Renders the shell and resolves when the user exits it.
 *
 * Preferences are read once, at the edge, by `boot.ts`: `core/` never touches
 * the config file, and the shell threads what it needs downward. A config that
 * could not be read is not fatal. `loadPreferences` hands back defaults plus a
 * sentence, and the shell shows that as history.
 *
 * The banner has already been drawn by the time this runs (see intro.ts and
 * boot.ts). This module is the expensive one: importing it pulls in Ink, React
 * and the whole shell, which is why boot.ts imports it during the animation
 * rather than after.
 */
export async function launchShell(start: ShellStart): Promise<void> {
  const { prefs, palette, warning } = start
  const instance = render(
    <ThemeProvider palette={palette}>
      <App
        prefs={prefs}
        introShown={prefs.theme !== undefined}
        {...(warning === undefined ? {} : { configWarning: warning })}
      />
    </ThemeProvider>,
    {
      /* keep the existing kittyKeyboard comment block from the current file verbatim */
      kittyKeyboard: {
        mode: 'auto',
        flags: ['disambiguateEscapeCodes', 'reportEventTypes'],
      },
    },
  )
  await instance.waitUntilExit()
}
```

Copy the long `kittyKeyboard` comment (current lines 48–77) back in where the placeholder comment sits. It is unchanged.

- [ ] **Step 4: Write `src/shell/boot.ts`**

```ts
import { loadPreferences, type Preferences } from '../config/preferences.js'
import { type IntroOptions, playIntro } from './intro.js'
import type { ShellStart } from './launch.js'
import { colourEnabled, paletteFor, VERSION } from './theme.js'

/**
 * Getting from `forge` to a prompt, with the intro and the shell's loading
 * running at the same time.
 *
 * The intro is four frames at 130 ms. Importing `launch.tsx`, which means
 * Ink, React and the whole shell, takes ~370 ms. Run one after the other they
 * add up. Here the import starts first and runs underneath the animation, so
 * the prompt appears at max(animation, import) instead of their sum (spec
 * §4.3).
 *
 * This module must stay React-free: index.ts imports it right after
 * `applyColourPreference()`, and anything here that reached Ink would fix
 * chalk's colour level too early. `launch.tsx` is only ever imported
 * dynamically, and its `ShellStart` is a type-only import that is erased.
 */
export interface BootDeps {
  loadPreferences: () => Promise<{ prefs: Preferences; warning?: string }>
  playIntro: (opts: IntroOptions) => Promise<void>
  loadShell: () => Promise<{ launchShell: (start: ShellStart) => Promise<void> }>
  width: () => number
}

const DEFAULTS: BootDeps = {
  loadPreferences,
  playIntro,
  loadShell: () => import('./launch.js'),
  width: () => process.stdout.columns ?? 80,
}

export async function bootShell(deps: BootDeps = DEFAULTS): Promise<void> {
  const shell = deps.loadShell()
  // Observed now, awaited later. If the import fails while the intro is still
  // drawing, the rejection would otherwise sit unobserved until the await
  // below and be reported as unhandled. The same rejection still reaches the
  // caller through that await.
  shell.catch(() => {})

  const { prefs, warning } = await deps.loadPreferences()
  const palette = paletteFor(prefs.theme)

  // Skipped on first run: the theme picker owns the screen until a theme is
  // chosen, and until then there is no palette to draw it in. App pushes a
  // still banner once the answer is in.
  if (prefs.theme !== undefined) {
    await deps.playIntro({
      width: deps.width(),
      palette,
      version: VERSION,
      defaultOutput: prefs.defaultOutput,
      colour: colourEnabled(),
    })
  }

  const { launchShell } = await shell
  await launchShell({ prefs, palette, ...(warning === undefined ? {} : { warning }) })
}
```

- [ ] **Step 5: Point `src/index.ts` at it**

In the shell branch, replace:

```ts
      const { launchShell } = await import('./shell/launch.js')
      await launchShell()
      return
```

with:

```ts
      // boot.ts starts importing the shell and plays the intro at the same
      // time. It is React-free, so nothing here gets ahead of the line above.
      const { bootShell } = await import('./shell/boot.js')
      await bootShell()
      return
```

- [ ] **Step 6: Run the tests and confirm they pass**

Run: `npx vitest run tests/shell/boot.test.ts tests/shell/banner.test.tsx tests/shell/theme-colour.test.tsx tests/index.test.ts`
Expected: PASS. `banner.test.tsx` still finds `WORDMARK` through the re-export, and the tty-gate case in `index.test.ts` still prints the hint.

- [ ] **Step 7: Check it by hand in a real terminal**

Run: `npx tsx src/index.ts` in a colour terminal with a theme already chosen.
Expected: the four-frame intro plays, the status line prints, and the prompt (`›`) appears straight after. Watch whether a frame visibly stalls. The shell's module graph evaluates synchronously at some point during the animation, so one frame can be delayed by roughly that evaluation time. A delay of one frame is expected and accepted by the spec ("max(animation, import)"). A frozen or garbled intro is not. Report what you saw in the task summary. Task 6's bench measures the time to prompt.

- [ ] **Step 8: Run the full suite, typecheck and lint**

Run: `npm test && npm run typecheck && npm run lint`
Expected: everything passes.

- [ ] **Step 9: Commit**

```bash
git add src/shell/boot.ts src/shell/launch.tsx src/shell/mark.ts src/shell/intro.ts src/shell/components/Banner.tsx src/index.ts tests/shell/boot.test.ts
git commit -m "$(cat <<'EOF'
perf(shell): load the shell while the intro plays

boot.ts starts importing launch.tsx (Ink, React, the whole shell)
before the intro's first frame, so the prompt appears at
max(animation, import) instead of their sum. WORDMARK moves to mark.ts
so the intro no longer imports an Ink component, and boot.ts stays
React-free so applyColourPreference still runs before chalk loads.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: `--to <format> --max-size` applies the size (§4.6)

**Files:**
- Create: `tests/cli/convert-max-size.test.ts`
- Modify: `src/cli/args.ts` (`ConvertIntent`, new `parseMaxSize`, the quality/max-size exclusivity check, the compress and convert branches)
- Modify: `src/cli/execute.ts` (new `reportEvents`, compress path `onEvent`, convert path `runPlan` call and `failures`)
- Modify: `src/core/errors.ts:179` (`unsupportedCompress` gains `target?`)
- Modify: `src/core/execute-jobs.ts:133` (passes `job.target`)
- Modify: `src/engines/image.ts:374-381` (`measurer` declines a lossless target)
- Modify: `tests/cli/args.test.ts`, `tests/core/errors.test.ts`, `tests/engines/image-measurer.test.ts`

**Interfaces:**
- Consumes (Task 1): lazy engines. No signatures change.
- Produces (Task 5 relies on these):
  - `ConvertIntent.maxBytes?: number` in `src/cli/args.ts`.
  - `function reportEvents(opts: ExecuteOptions, batch: boolean): (event: PlanEvent) => void`, private to `src/cli/execute.ts`. Both `runPlan` calls on the compress and convert paths use it.
  - `export function unsupportedCompress(source: SourceInfo, target?: FormatId): ForgeError`. When `target` is given and differs from `source.format`, the wording names the target. The code stays `'unsupported-compress'`.
  - `imageEngine.measurer(job)` returns `undefined` when `FORMATS[job.target].lossy` is false.
  - `runPlan` refuses an unmeasurable job with `unsupportedCompress(job.sources[0], job.target)`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/cli/args.test.ts` (it already imports `parseArgs`; add `isForgeError` from `../../src/core/errors.js` if it is not imported):

```ts
describe('--max-size with --to', () => {
  const codeOf = (fn: () => unknown): string | undefined => {
    try {
      fn()
    } catch (e) {
      return isForgeError(e) ? e.code : 'unknown'
    }
    return undefined
  }

  it('is a conversion that carries the size', () => {
    const intent = parseArgs(['a.jpg', '--to', 'jpeg', '--max-size', '50kb'])
    if (intent.kind !== 'convert') throw new Error('expected convert')
    expect(intent.target).toBe('jpeg')
    expect(intent.maxBytes).toBe(50_000)
  })

  it('refuses --quality alongside it, as compression already does', () => {
    expect(codeOf(() => parseArgs(['a.jpg', '--to', 'webp', '--quality', '60', '--max-size', '1mb']))).toBe(
      'invalid-arguments',
    )
  })

  it('refuses a size it cannot read', () => {
    expect(codeOf(() => parseArgs(['a.jpg', '--to', 'jpeg', '--max-size', 'banana']))).toBe(
      'invalid-arguments',
    )
  })

  it('leaves maxBytes unset when --max-size is absent', () => {
    const intent = parseArgs(['a.jpg', '--to', 'jpeg'])
    if (intent.kind !== 'convert') throw new Error('expected convert')
    expect(intent.maxBytes).toBeUndefined()
  })
})
```

Append to the `describe('refusing to compress', …)` block in `tests/core/errors.test.ts`:

```ts
  const jpeg = { ...png, path: '/tmp/photo.jpg', format: 'jpeg' as const }

  it('names a lossless target, not the source, when the size applies to a conversion', () => {
    const e = unsupportedCompress(jpeg, 'png')
    expect(e.code).toBe('unsupported-compress')
    expect(e.detail).toContain('PNG is lossless')
    expect(e.detail).toContain('photo.jpg')
    expect(e.detail).not.toContain('JPEG')
  })

  it('says a lossy target cannot be searched yet, rather than calling it lossless', () => {
    const e = unsupportedCompress(pdf, 'jpeg')
    expect(e.detail).not.toContain('lossless')
    expect(e.detail).toContain('brochure.pdf')
    expect(e.detail).toContain('JPEG')
  })

  it('keeps the old wording when the target is the source format', () => {
    expect(unsupportedCompress(png, 'png').detail).toBe(unsupportedCompress(png).detail)
  })
```

Append to `tests/engines/image-measurer.test.ts`, inside `describe('imageEngine.measurer', …)`:

```ts
  it('declines a lossless target, which has no quality to search', async () => {
    const job: Job = {
      op: 'convert',
      sources: [source],
      outputs: ['/unused.png'],
      target: 'png',
      options: { background: '#ffffff', keepMetadata: false },
    }
    expect(await imageEngine.measurer?.(job)).toBeUndefined()
  })
```

`tests/cli/convert-max-size.test.ts`:

```ts
import { existsSync } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseArgs } from '../../src/cli/args.js'
import { execute } from '../../src/cli/execute.js'
import { makeNoisyOrientedJpeg, makeTempDir, makeTextPdf } from '../helpers/fixtures.js'

/**
 * Spec §4.6. `--to jpeg --max-size 50kb` used to produce a 75.5 KB file with
 * no warning: the size was parsed and then dropped. A size given with --to
 * now applies to that target, through the same search compression uses.
 */
async function defaultSize(source: string, target: string, dir: string): Promise<number> {
  const out = join(dir, `default.${target}`)
  const result = await execute(parseArgs([source, '--to', target, '-o', out]))
  expect(result.exitCode).toBe(0)
  return (await stat(out)).size
}

describe('--to <format> --max-size', () => {
  it.each(['jpeg', 'webp'])('fits a %s conversion under the size it was given', async (target) => {
    const dir = await makeTempDir()
    const source = await makeNoisyOrientedJpeg(dir, 'photo.jpg')
    const limit = Math.floor((await defaultSize(source, target, dir)) * 0.6)

    const out = join(dir, `fitted.${target}`)
    const result = await execute(
      parseArgs([source, '--to', target, '--max-size', `${limit}b`, '-o', out]),
    )

    expect(result.exitCode).toBe(0)
    expect((await stat(out)).size).toBeLessThanOrEqual(limit)
  })

  it('refuses a lossless target instead of ignoring the size, and writes nothing', async () => {
    const dir = await makeTempDir()
    const source = await makeNoisyOrientedJpeg(dir, 'photo.jpg')
    const out = join(dir, 'photo.png')
    const result = await execute(parseArgs([source, '--to', 'png', '--max-size', '10kb', '-o', out]))

    expect(result.exitCode).toBe(1)
    expect(result.stderr.join('\n')).toContain('PNG is lossless')
    expect(existsSync(out)).toBe(false)
  })

  it('reports a size no quality can reach, and writes nothing', async () => {
    const dir = await makeTempDir()
    const source = await makeNoisyOrientedJpeg(dir, 'photo.jpg')
    const out = join(dir, 'tiny.jpg')
    const result = await execute(parseArgs([source, '--to', 'jpeg', '--max-size', '100b', '-o', out]))

    expect(result.exitCode).toBe(1)
    expect(result.stderr.join('\n')).toContain('Cannot get that small')
    expect(existsSync(out)).toBe(false)
  })

  // Review Focus 5.
  it('in a mixed batch, fits what it can and refuses what it cannot, naming the target', async () => {
    const dir = await makeTempDir()
    const photo = await makeNoisyOrientedJpeg(dir, 'photo.jpg')
    await makeTextPdf(dir, 'notes.pdf', ['A page of text.'])
    const limit = Math.floor((await defaultSize(photo, 'jpeg', await makeTempDir())) * 0.6)
    const outDir = join(dir, 'out')

    const result = await execute(
      parseArgs([dir, '--to', 'jpeg', '--max-size', `${limit}b`, '-o', `${outDir}/`]),
    )

    expect(result.exitCode).toBe(1)
    const written = await readdir(outDir)
    expect(written).toEqual(['photo.jpg'])
    expect((await stat(join(outDir, 'photo.jpg'))).size).toBeLessThanOrEqual(limit)
    const stderr = result.stderr.join('\n')
    expect(stderr).toContain('notes.pdf')
    expect(stderr).toContain('JPEG')
  })
})
```

Run: `npx vitest run tests/cli/args.test.ts tests/core/errors.test.ts tests/engines/image-measurer.test.ts tests/cli/convert-max-size.test.ts`
Expected: FAIL. `intent.maxBytes` is `undefined`. The `--quality` + `--max-size` + `--to` case returns `undefined` (no throw). The errors tests fail on wording. The measurer returns a measurer for PNG. The fitted output is larger than `limit`.

- [ ] **Step 2: Parse `--max-size` on the convert path (`src/cli/args.ts`)**

Add to `ConvertIntent`, after `passwordStdin`:

```ts
  /**
   * Set by --max-size alongside --to: the converted file must fit this many
   * bytes, and the search decides the quality. It used to be parsed and then
   * dropped on this path (spec §4.6).
   */
  maxBytes?: number
```

Add after `parseConcurrency`:

```ts
function parseMaxSize(raw: unknown): number {
  const bytes = parseSize(String(raw))
  if (bytes === undefined) {
    throw invalidArguments(
      `${raw} is not a size.`,
      'Try a number with a unit, for example 500kb, 2mb or 1.5mb.',
    )
  }
  return bytes
}
```

Move the exclusivity check out of the compress branch so it covers both paths. Delete it from inside `if (!opts.to && (…))` and insert it directly above that `if`, after the `return { kind: 'shell' }` block:

```ts
  // Both paths: they answer the same question two ways, with or without --to.
  if (opts.quality !== undefined && opts.maxSize !== undefined) {
    throw invalidArguments(
      'Use either --quality or --max-size, not both.',
      'They are two ways of asking for the same thing, and Forge will not guess which wins.',
    )
  }
```

In the compress branch, replace:

```ts
    const maxBytes = opts.maxSize === undefined ? undefined : parseSize(String(opts.maxSize))
    if (opts.maxSize !== undefined && maxBytes === undefined) {
      throw invalidArguments(
        `${opts.maxSize} is not a size.`,
        'Try a number with a unit, for example 500kb, 2mb or 1.5mb.',
      )
    }
```

with nothing, and replace `if (maxBytes !== undefined) compress.maxBytes = maxBytes` with:

```ts
    if (opts.maxSize !== undefined) compress.maxBytes = parseMaxSize(opts.maxSize)
```

In the convert branch, after `if (opts.pages !== undefined) intent.pages = String(opts.pages)`, add:

```ts
  if (opts.maxSize !== undefined) intent.maxBytes = parseMaxSize(opts.maxSize)
```

- [ ] **Step 3: Name the target in the refusal (`src/core/errors.ts`)**

Change the signature to `export function unsupportedCompress(source: SourceInfo, target?: FormatId): ForgeError`, and insert directly after `const name = basename(source.path)`:

```ts
  /**
   * A conversion asked to fit a size. The size applies to the target, so the
   * refusal must name the target: telling `photo.jpg --to png --max-size`
   * that photo.jpg is lossless would be false. Same code as the compression
   * refusals below, because it is the same refusal with a different subject.
   */
  if (target !== undefined && target !== source.format) {
    const label = FORMATS[target].label
    if (!FORMATS[target].lossy) {
      return new ForgeError({
        code: 'unsupported-compress',
        title: 'Cannot fit that to a size',
        detail: `${label} is lossless — there is no quality to trade away, so ${name} cannot be made to fit as ${label}.`,
        hint: 'Drop --max-size, or choose a lossy target. forge --formats lists them.',
        shellHint: 'Choose a lossy target to aim for a size.',
      })
    }
    return new ForgeError({
      code: 'unsupported-compress',
      title: 'Cannot fit that to a size',
      detail: `Forge cannot search ${name} → ${label} toward a size yet.`,
      hint: 'Convert it first, then compress the result with --max-size.',
      shellHint: 'Convert it first, then /compress the result to a size.',
    })
  }
```

In `src/core/execute-jobs.ts`, change the refusal line (currently 133) to:

```ts
      refusals.push({
        path: job.sources[0].path,
        error: unsupportedCompress(job.sources[0], job.target),
      })
```

(`job.op === 'convert'` is already established above it, so `job.target` exists.)

- [ ] **Step 4: Decline a lossless target in `imageEngine.measurer` (`src/engines/image.ts`)**

Replace `measurer` with:

```ts
async function measurer(job: Job): Promise<Measurer | undefined> {
  if (job.op !== 'convert') return undefined
  // A lossless target has no quality to search: `encode` ignores quality for
  // PNG, GIF and TIFF, so every attempt would measure the same bytes.
  // Declining makes `runPlan` refuse with a reason instead of "searching" a
  // dial that is not connected to anything.
  if (!FORMATS[job.target].lossy) return undefined
  const source = job.sources[0]
  return {
    ladder: [{}],
    measure: async (options) => (await encodeToBuffer(source, job.target, options)).length,
  }
}
```

- [ ] **Step 5: Route the size through the convert path (`src/cli/execute.ts`)**

Add `import type { PlanEvent } from '../core/execute-jobs.js'` beside the existing `runPlan` import, merging the two: `import { type PlanEvent, runPlan } from '../core/execute-jobs.js'`.

Add above `export async function execute`:

```ts
/**
 * Turns `runPlan`'s events into the two callbacks `src/index.ts` draws from.
 * Shared by the compress and convert paths, so a target-size search reports
 * the same way whichever flag asked for it. The rung is named as well as the
 * attempt: without it a search that drops from 150 to 120 dpi looks like the
 * counter restarting for no reason.
 */
function reportEvents(opts: ExecuteOptions, batch: boolean): (event: PlanEvent) => void {
  return (event) => {
    if (event.type === 'search:attempt') {
      opts.onSearch?.(
        event.rung.dpi === undefined
          ? `attempt ${event.attempt} of ${event.of}`
          : `${event.rung.dpi} dpi · attempt ${event.attempt} of ${event.of}`,
      )
      return
    }
    if (batch && (event.type === 'job:done' || event.type === 'job:error')) {
      opts.onProgress?.({ completed: event.completed, total: event.total })
    }
  }
}
```

On the compress path, replace the whole inline `onEvent: (event) => { … },` with:

```ts
      onEvent: reportEvents(opts, batch),
```

On the convert path, replace the `runPlan(allJobs, { … })` call and the `failures` array after it with:

```ts
  const outcome = await runPlan(allJobs, {
    force: intent.force,
    ...(intent.concurrency === undefined ? {} : { concurrency: intent.concurrency }),
    ...(intent.maxBytes === undefined ? {} : { targetBytes: intent.maxBytes }),
    onEvent: reportEvents(opts, isBatch),
  })

  const failures = [
    ...resolved.failures,
    ...documentFailures,
    ...plan.failures,
    ...outcome.refusals,
    ...outcome.unreachable.map((u) => ({ path: u.job.sources[0].path, error: u.error })),
    ...outcome.failures,
  ]
```

- [ ] **Step 6: Run the tests and confirm they pass**

Run: `npx vitest run tests/cli/args.test.ts tests/core/errors.test.ts tests/engines/image-measurer.test.ts tests/cli/convert-max-size.test.ts tests/cli/compress-args.test.ts tests/cli/pdf-compress.test.ts`
Expected: PASS. `compress-args` and `pdf-compress` are the regression check for the moved exclusivity check and the shared `reportEvents`.

- [ ] **Step 7: Run the full suite, typecheck and lint**

Run: `npm test && npm run typecheck && npm run lint`
Expected: everything passes.

- [ ] **Step 8: Commit**

```bash
git add src/cli/args.ts src/cli/execute.ts src/core/errors.ts src/core/execute-jobs.ts src/engines/image.ts tests/cli/args.test.ts tests/cli/convert-max-size.test.ts tests/core/errors.test.ts tests/engines/image-measurer.test.ts
git commit -m "$(cat <<'EOF'
fix(cli): apply --max-size to a --to conversion instead of ignoring it

--to jpeg --max-size 50kb produced a 75.5 KB file with no warning: the
convert intent had nowhere to put the size. It now goes through the
same search compression uses. A lossless target, or one no engine can
search, is refused with a reason that names the target, and a size no
quality reaches is reported, not written.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: `--max-size` searches run in parallel (§4.4)

**Files:**
- Modify: `src/core/run.ts` (add `pool`, `resolveConcurrency`; `runJobs` uses them)
- Modify: `src/core/execute-jobs.ts` (`PlanEvent` gains `search:settled`; `runPlan` searches through `pool`; new private `searchJob`)
- Modify: `src/engines/image.ts` (`pipelineFor` takes an optional in-memory input; new private `readOnce`; `measurer` reads once)
- Modify: `src/cli/execute.ts` (`reportEvents` reports per-file completion in a batch)
- Modify: `tests/core/run.test.ts`, `tests/core/execute-jobs.test.ts`, `tests/engines/image-measurer.test.ts`, `tests/cli/compress-output.test.ts` (or a new `tests/cli/search-status.test.ts`; see Step 1)

**Interfaces:**
- Consumes (Task 4): `reportEvents(opts, batch)` in `execute.ts`. `imageEngine.measurer` declines lossless targets. `unsupportedCompress(source, target?)`.
- Produces:
  - `src/core/run.ts`: `export async function pool<T>(items: readonly T[], limit: number, task: (item: T, index: number) => Promise<void>): Promise<void>` and `export function resolveConcurrency(requested?: number): number`.
  - `src/core/execute-jobs.ts`: `PlanEvent` adds `{ type: 'search:settled'; job: Job; completed: number; total: number }`. `runPlan`'s signature and `RunOutcome` are unchanged. A search that throws now lands in `outcome.failures` instead of rejecting `runPlan`.
  - `imageEngine.measurer` reads the source once per job (and decodes a HEIC once). Its returned `measure(options)` gives byte counts identical to `encodeToBuffer(source, target, options).length`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/core/run.test.ts` (add `pool, resolveConcurrency` to the `run.js` import):

```ts
describe('pool', () => {
  it('runs at most `limit` tasks at once and every item exactly once', async () => {
    let inFlight = 0
    let peak = 0
    const seen: number[] = []
    await pool([0, 1, 2, 3, 4, 5, 6, 7], 3, async (item) => {
      inFlight += 1
      peak = Math.max(peak, inFlight)
      await new Promise((r) => setTimeout(r, 5))
      seen.push(item)
      inFlight -= 1
    })
    expect(peak).toBe(3)
    expect([...seen].sort()).toEqual([0, 1, 2, 3, 4, 5, 6, 7])
  })

  it('does nothing for no items', async () => {
    let calls = 0
    await pool([], 4, async () => {
      calls += 1
    })
    expect(calls).toBe(0)
  })
})

describe('resolveConcurrency', () => {
  it('never collapses to zero workers', () => {
    expect(resolveConcurrency(Number.NaN)).toBeGreaterThanOrEqual(1)
    expect(resolveConcurrency(0)).toBe(1)
    expect(resolveConcurrency(Number.POSITIVE_INFINITY)).toBeGreaterThanOrEqual(1)
    expect(resolveConcurrency(3)).toBe(3)
  })
})
```

Append to `tests/core/execute-jobs.test.ts`:

```ts
describe('runPlan searches in parallel', () => {
  /** A stub whose `measure` waits, so overlapping searches are observable. */
  const slowEngine = (fitsAt: number, onMeasure: () => void = () => {}) => {
    let inFlight = 0
    const stats = { peak: 0, measures: 0 }
    const engine: Engine = {
      id: 'slow',
      reads: new Set(['pdf']),
      writes: new Set(['pdf']),
      ops: new Set<Job['op']>(['convert']),
      probe: vi.fn(),
      run: vi.fn(async (job: Job) => ({ job, outputBytes: 1, warnings: [] })),
      measurer: vi.fn(async () => ({
        ladder: [{}],
        measure: async (options: ConvertOptions) => {
          inFlight += 1
          stats.peak = Math.max(stats.peak, inFlight)
          stats.measures += 1
          onMeasure()
          await new Promise((r) => setTimeout(r, 5))
          inFlight -= 1
          return (options.quality ?? 100) <= fitsAt ? 100 : 1_000_000
        },
      })),
    }
    return { engine, stats }
  }

  it('searches up to `concurrency` files at once', async () => {
    const { engine, stats } = slowEngine(50)
    const jobs = [jobFor(), jobFor(), jobFor(), jobFor()]
    const outcome = await runPlan(jobs, {
      force: true,
      targetBytes: 500,
      concurrency: 4,
      engineFor: () => engine,
    })
    expect(stats.peak).toBe(4)
    expect(outcome.results).toHaveLength(4)
  })

  it('runs the settled jobs in their original order, whichever search finished first', async () => {
    const { engine } = slowEngine(50)
    const jobs = [jobFor(), jobFor(), jobFor()]
    await runPlan(jobs, { force: true, targetBytes: 500, concurrency: 3, engineFor: () => engine })
    const ran = (engine.run as ReturnType<typeof vi.fn>).mock.calls.map(
      (c) => (c[0] as Job).outputs[0],
    )
    expect(ran).toEqual(jobs.map((j) => j.outputs[0]))
  })

  it('reports each finished search as a real count, never a percentage', async () => {
    const { engine } = slowEngine(50)
    const settled: Array<{ completed: number; total: number }> = []
    await runPlan([jobFor(), jobFor(), jobFor()], {
      force: true,
      targetBytes: 500,
      engineFor: () => engine,
      onEvent: (event) => {
        if (event.type === 'search:settled') {
          settled.push({ completed: event.completed, total: event.total })
        }
      },
    })
    expect(settled.map((s) => s.completed)).toEqual([1, 2, 3])
    expect(settled.every((s) => s.total === 3)).toBe(true)
  })

  it('refuses unsafe writes before any search starts', async () => {
    const d = await makeTempDir()
    const existing = join(d, 'taken.pdf')
    await writeFile(existing, 'already here')
    const { engine } = slowEngine(50)
    const outcome = await runPlan([jobFor(existing), jobFor()], {
      force: false,
      targetBytes: 500,
      engineFor: () => engine,
    })
    expect(outcome.refusals.map((r) => r.error.code)).toEqual(['output-exists'])
    // One measurer: the refused job was never searched.
    expect(engine.measurer).toHaveBeenCalledTimes(1)
  })

  // Review Focus 1.
  it('on cancel, writes nothing and starts no encode after it resolves', async () => {
    const controller = new AbortController()
    const { engine, stats } = slowEngine(0, () => {
      // Abort on the third measure. Four searches are in flight by then.
      if (stats.measures === 3) controller.abort()
    })
    const outcome = await runPlan([jobFor(), jobFor(), jobFor(), jobFor(), jobFor(), jobFor()], {
      force: true,
      targetBytes: 500,
      concurrency: 4,
      engineFor: () => engine,
      signal: controller.signal,
    })
    expect(outcome.cancelled).toBe(true)
    expect(outcome.results).toEqual([])
    expect(engine.run).not.toHaveBeenCalled()
    const atResolve = stats.measures
    await new Promise((r) => setTimeout(r, 30))
    expect(stats.measures).toBe(atResolve)
  })

  // Review Focus 2.
  it('reports a search that throws as that file failing, and still runs the rest', async () => {
    const good = stubEngine([{}], ({ quality }) => ((quality ?? 100) <= 50 ? 100 : 1_000_000))
    const bad: Engine = {
      ...good,
      measurer: vi.fn(async () => ({
        ladder: [{}],
        measure: async () => {
          throw new Error('decoder blew up')
        },
      })),
    }
    const broken = jobFor()
    const fine = jobFor()
    const outcome = await runPlan([broken, fine], {
      force: true,
      targetBytes: 500,
      engineFor: (job) => (job === broken ? bad : good),
    })
    expect(outcome.failures).toHaveLength(1)
    expect(outcome.failures[0]?.error.code).toBe('conversion-failed')
    expect(outcome.results.map((r) => r.job)).toEqual([fine])
  })
})
```

Append to `tests/engines/image-measurer.test.ts` (add `rm` from `node:fs/promises`, `encodeToBuffer` from `../../src/engines/image.js`, and `makeHeic, makeNoisyOrientedJpeg, makeTransparentPng` to the fixtures import):

```ts
describe('imageEngine.measurer reads its source once', () => {
  const base = { background: '#ffffff', keepMetadata: false }

  async function measurerFor(path: string, target: 'jpeg' | 'webp' | 'avif') {
    const source = (await probe(path)) as ImageInfo
    const job: Job = { op: 'convert', sources: [source], outputs: ['/unused'], target, options: base }
    const m = await imageEngine.measurer?.(job)
    if (!m) throw new Error('expected a measurer')
    return { m, source }
  }

  it.each([
    ['an oriented photo to JPEG', 'noisy.jpg', 'jpeg', false],
    ['an oriented photo to WebP, keeping metadata', 'noisy.jpg', 'webp', true],
    ['a transparent PNG flattened to JPEG', 'clear.png', 'jpeg', false],
  ] as const)('measures %s exactly as the real encode would', async (_label, name, target, keepMetadata) => {
    const d = await makeTempDir()
    const path = name.endsWith('.png')
      ? await makeTransparentPng(d, name)
      : await makeNoisyOrientedJpeg(d, name)
    const { m, source } = await measurerFor(path, target)
    for (const quality of [10, 50, 90]) {
      const options = { ...base, keepMetadata, quality }
      // Byte-identical, so the quality the search settles on cannot move:
      // spec §3, "no conversion's output bytes change".
      expect(await m.measure(options)).toBe((await encodeToBuffer(source, target, options)).length)
    }
  })

  it('keeps measuring after the file is gone, because it never rereads it', async () => {
    const d = await makeTempDir()
    const path = await makeNoisyOrientedJpeg(d, 'gone.jpg')
    const { m } = await measurerFor(path, 'jpeg')
    await rm(path)
    expect(await m.measure({ ...base, quality: 40 })).toBeGreaterThan(0)
  })

  it('decodes a HEIC once, not once per attempt', async (ctx) => {
    const d = await makeTempDir()
    const path = await makeHeic(d, 'photo.heic')
    if (path === null) {
      ctx.skip('sips unavailable — HEIC fixture cannot be generated')
      return
    }
    const { m, source } = await measurerFor(path, 'jpeg')
    const expected = (await encodeToBuffer(source, 'jpeg', { ...base, quality: 60 })).length
    await rm(path)
    expect(await m.measure({ ...base, quality: 60 })).toBe(expected)
  })
})
```

Create `tests/cli/search-status.test.ts`:

```ts
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseArgs } from '../../src/cli/args.js'
import { execute } from '../../src/cli/execute.js'
import { makeNoisyOrientedJpeg, makeTempDir } from '../helpers/fixtures.js'

describe('a batch search reports per file', () => {
  it('counts finished files, since several searches run at once', async () => {
    const dir = await makeTempDir()
    for (const n of [1, 2, 3]) await makeNoisyOrientedJpeg(dir, `p${n}.jpg`)
    const seen: string[] = []
    const result = await execute(
      parseArgs([dir, '--max-size', '6kb', '-o', `${join(dir, 'out')}/`]),
      { onSearch: (status) => seen.push(status) },
    )
    expect(result.exitCode).toBe(0)
    // Interleaved per-attempt counters from three files would read as one
    // counter jumping around. A batch reports completed files instead.
    expect(seen).toEqual(['1 of 3 searched', '2 of 3 searched', '3 of 3 searched'])
  })
})
```

(`makeNoisyOrientedJpeg`'s default 240×180 noisy photo sits well above 6 KB at quality 100 and well below it at low quality. If the first assertion fails on exit code 1 with "Cannot get that small", raise the limit to `10kb`. The fixture is random noise, so do not tune it any finer.)

Run: `npx vitest run tests/core/run.test.ts tests/core/execute-jobs.test.ts tests/engines/image-measurer.test.ts tests/cli/search-status.test.ts`
Expected: FAIL. `pool` and `resolveConcurrency` are not exported. `stats.peak` is `1`, not `4`. There are no `search:settled` events. The throwing search rejects `runPlan` ("decoder blew up"). The deleted-file measure throws ENOENT. `seen` holds `attempt n of 8` strings.

- [ ] **Step 2: Extract the pool (`src/core/run.ts`)**

Add above `runJobs`:

```ts
/**
 * A worker count from what the caller asked for. A value that is not a
 * finite number (NaN from a bad parse, Infinity, …) must never collapse the
 * pool to zero, which would silently do nothing while still resolving.
 */
export function resolveConcurrency(requested?: number): number {
  const finite = requested !== undefined && Number.isFinite(requested) ? requested : undefined
  return Math.max(1, finite ?? defaultConcurrency())
}

/**
 * Runs `task` once per item, at most `limit` at a time, starting them in
 * order. The one concurrency pool in Forge: conversions (`runJobs`) and
 * target-size searches (`runPlan`) both go through it, so a search cannot
 * oversubscribe the libuv threadpool that Sharp already shares with them.
 *
 * `task` must not throw. A rejection would leave the other workers running
 * with nobody waiting for them.
 */
export async function pool<T>(
  items: readonly T[],
  limit: number,
  task: (item: T, index: number) => Promise<void>,
): Promise<void> {
  let cursor = 0
  const worker = async (): Promise<void> => {
    while (cursor < items.length) {
      const index = cursor++
      await task(items[index] as T, index)
    }
  }
  await Promise.all(Array.from({ length: Math.min(Math.max(1, limit), items.length) }, worker))
}
```

In `runJobs`, replace the three lines computing `requested` and `limit` (and their comment) with `const limit = resolveConcurrency(opts.concurrency)`. Delete `let cursor = 0`. Replace `async function worker() { while (cursor < total) { const index = cursor++; const job = jobs[index]; if (!job) return …` and the `await Promise.all(…worker)` line with:

```ts
  await pool(jobs, limit, async (job, index) => {
    emit({ type: 'job:start', job, index, total })

    const engine = resolveEngine(job)
    if (!engine) {
      completed++
      const path = job.sources[0].path
      const failure: InputFailure = {
        path,
        error: conversionFailed(path, new Error(`no engine runs ${job.op}`)),
      }
      failures.push(failure)
      emit({ type: 'job:error', job, failure, completed, total })
      return
    }

    try {
      const result = await engine.run(job, (progress) =>
        emit({ type: 'job:phase', job, progress }),
      )
      results.push(result)
      completed++
      emit({ type: 'job:done', job, result, completed, total })
    } catch (e) {
      completed++
      const path = job.sources[0].path
      const error = isForgeError(e) ? e : conversionFailed(path, e)
      const failure: InputFailure = { path, error }
      failures.push(failure)
      emit({ type: 'job:error', job, failure, completed, total })
    }
  })
```

- [ ] **Step 3: Search through the pool (`src/core/execute-jobs.ts`)**

Replace the imports with:

```ts
import { engineForJob } from '../engines/registry.js'
import type { Engine, Measurer } from '../engines/types.js'
import { findQuality } from './compress.js'
import {
  conversionFailed,
  type ForgeError,
  isForgeError,
  targetUnreachable,
  unsupportedCompress,
} from './errors.js'
import type { InputFailure } from './resolve.js'
import { pool, type RunEvent, resolveConcurrency, runJobs } from './run.js'
import type { ConvertOptions, Job, Result } from './types.js'
import { checkWriteSafety } from './write-safety.js'
```

Add a third member to the `PlanEvent` union, after the `search:attempt` member:

```ts
  | {
      type: 'search:settled'
      job: Job
      /** Searches finished so far, this one included. */
      completed: number
      /**
       * How many jobs this run searches. Known before the first starts, so it
       * is a real denominator (invariant 7). Several searches run at once, so
       * this, not one job's attempt counter, is what a batch reports.
       */
      total: number
    }
```

Add above `runPlan`:

```ts
/** What one job's search came to. */
type Searched =
  | { kind: 'ready' }
  | { kind: 'refused'; failure: InputFailure }
  | { kind: 'unreachable'; entry: UnreachableTarget }
  | { kind: 'failed'; failure: InputFailure }
  | { kind: 'cancelled' }

/**
 * Resolves one convert job's settings by search, walking the engine's ladder
 * coarsest lever first.
 *
 * Never throws. A measurer or an encode that fails becomes this job's
 * failure, so one bad file in a batch neither rejects the whole run nor
 * leaves the other searches running with nobody waiting for them.
 */
async function searchJob(
  job: Extract<Job, { op: 'convert' }>,
  targetBytes: number,
  resolveEngine: (job: Job) => Engine | undefined,
  emit: (event: PlanEvent) => void,
  signal: AbortSignal | undefined,
): Promise<Searched> {
  const path = job.sources[0].path
  const failed = (e: unknown): Searched => ({
    kind: 'failed',
    failure: { path, error: isForgeError(e) ? e : conversionFailed(path, e) },
  })

  let measurer: Measurer | undefined
  try {
    measurer = await resolveEngine(job)?.measurer?.(job)
  } catch (e) {
    return failed(e)
  }
  if (!measurer || measurer.ladder.length === 0) {
    return {
      kind: 'refused',
      failure: { path, error: unsupportedCompress(job.sources[0], job.target) },
    }
  }
  const m = measurer

  let smallest = Number.POSITIVE_INFINITY
  let closest: (Partial<ConvertOptions> & { quality: number }) | undefined
  try {
    for (const rung of m.ladder) {
      const found = await findQuality({
        encode: (quality) => m.measure({ ...job.options, ...rung, quality }),
        targetBytes,
        onAttempt: (attempt, of) => emit({ type: 'search:attempt', job, attempt, of, rung }),
        ...(signal === undefined ? {} : { signal }),
      })

      // A cancelled search has no answer: not a settled quality, and not a
      // measured floor to offer as "use it anyway" either, since the ladder
      // was abandoned partway. So this job neither runs nor becomes a
      // question. It simply stops.
      if (found.cancelled) return { kind: 'cancelled' }

      if (found.bytes < smallest) {
        smallest = found.bytes
        closest = { ...rung, quality: found.quality }
      }

      if (!found.missed) {
        Object.assign(job.options, rung, { quality: found.quality })
        return { kind: 'ready' }
      }
    }
  } catch (e) {
    return failed(e)
  }

  const settings = closest ?? { quality: 1 }
  return {
    kind: 'unreachable',
    entry: {
      job,
      smallest,
      settings,
      error: targetUnreachable(job.sources[0], targetBytes, smallest),
    },
  }
}
```

Replace `runPlan`'s body. Keep its doc comment, and add the paragraph shown below to it:

```ts
export async function runPlan(jobs: Job[], policy: RunPolicy): Promise<RunOutcome> {
  const emit = policy.onEvent ?? (() => {})
  const resolveEngine = policy.engineFor ?? engineForJob
  const targetBytes = policy.targetBytes

  /**
   * Write safety first. It is a few `existsSync` calls; the search below is up
   * to thirty-two encodes. Checking first means a job that will be refused is
   * never searched for half a minute. Safe to reorder because resolution
   * changes `options`, never `outputs`, so the answer cannot depend on it.
   */
  const safe = checkWriteSafety(jobs, { force: policy.force })

  /**
   * Searches run through the same pool as conversions (spec §4.4): one file's
   * eight encodes no longer wait for the previous file's. Each search's outcome
   * is slotted by index, so the jobs that run, and the order they are reported
   * in, are the same as if the searches had run one at a time.
   */
  const searching =
    targetBytes === undefined ? 0 : safe.jobs.filter((job) => job.op === 'convert').length
  const searched: Searched[] = []
  let settled = 0

  await pool(safe.jobs, resolveConcurrency(policy.concurrency), async (job, index) => {
    // Only `convert` carries `ConvertOptions`; a page operation has no quality
    // dial, so a target size is simply not applicable to one.
    if (targetBytes === undefined || job.op !== 'convert') {
      searched[index] = { kind: 'ready' }
      return
    }
    // Checked before starting: after a cancel, no new search begins.
    if (policy.signal?.aborted) {
      searched[index] = { kind: 'cancelled' }
      return
    }
    const outcome = await searchJob(job, targetBytes, resolveEngine, emit, policy.signal)
    searched[index] = outcome
    if (outcome.kind !== 'cancelled') {
      settled += 1
      emit({ type: 'search:settled', job, completed: settled, total: searching })
    }
  })

  const refusals: InputFailure[] = [...safe.failures]
  const unreachable: UnreachableTarget[] = []
  const searchFailures: InputFailure[] = []
  const ready: Job[] = []
  let cancelled = false

  for (const [index, job] of safe.jobs.entries()) {
    const outcome: Searched = searched[index] ?? { kind: 'ready' }
    if (outcome.kind === 'ready') ready.push(job)
    else if (outcome.kind === 'refused') refusals.push(outcome.failure)
    else if (outcome.kind === 'failed') searchFailures.push(outcome.failure)
    else if (outcome.kind === 'unreachable') unreachable.push(outcome.entry)
    else cancelled = true
  }

  if (cancelled) {
    return {
      results: [],
      refusals,
      unreachable: [],
      failures: [],
      inputBytes: 0,
      outputBytes: 0,
      cancelled: true,
    }
  }

  const done = await runJobs(ready, {
    ...(policy.concurrency === undefined ? {} : { concurrency: policy.concurrency }),
    ...(policy.engineFor === undefined ? {} : { engineFor: policy.engineFor }),
    onEvent: emit,
  })

  return {
    results: done.results,
    refusals,
    unreachable,
    failures: [...searchFailures, ...done.failures],
    inputBytes: done.inputBytes,
    outputBytes: done.outputBytes,
  }
}
```

Note the deliberate behaviour change: an empty ladder used to drop the job silently (neither ready nor unreachable). It is now a `refused` with `unsupportedCompress`. No engine returns an empty ladder today, so no test changes because of it.

- [ ] **Step 4: Read once in `imageEngine.measurer` (`src/engines/image.ts`)**

Add `readFile` to the `node:fs/promises` import, and `ImageInfo` to the `../core/types.js` type import.

Give `pipelineFor` a fifth parameter and use it:

```ts
async function pipelineFor(
  source: SourceInfo,
  target: FormatId,
  options: ConvertOptions,
  animated: boolean,
  /**
   * The source already in memory, for the target-size search, which encodes
   * from the same bytes up to eight times. A HEIC arrives here already
   * decoded to PNG (see `readOnce`), so it skips the sips step.
   */
  input?: Buffer,
): Promise<{ pipeline: Sharp; cleanup: () => Promise<void> }> {
```

and change the HEIC lines plus the `sharp(…)` call to:

```ts
  if (input === undefined && source.format === 'heic' && !(await heicDecodable())) {
    throw heicDecoderUnavailable(source.path)
  }
  const heic =
    input === undefined && source.format === 'heic' ? await decodeHeic(source.path) : undefined
  const cleanup = async () => {
    await heic?.cleanup()
  }

  const sharp = await loadSharp()
  let pipeline = sharp(input ?? heic?.path ?? source.path, animated ? { animated: true } : {})
```

Everything after that (`.rotate()` first, flatten, metadata) is unchanged, so invariants 4 and 5 hold for the in-memory path too.

Add above `measurer`:

```ts
/**
 * The source's bytes, read once for a search that encodes from them
 * repeatedly. A HEIC is decoded through sips here, once, and handed on as the
 * decoded PNG. Per attempt that decode was the most expensive step.
 *
 * Bytes rather than decoded pixels on purpose: encoding from a buffer runs
 * the same libvips decode as encoding from the file, so every measured size
 * is byte-identical to the real encode, and the quality the search settles on
 * cannot move (spec §3).
 */
async function readOnce(source: ImageInfo): Promise<Buffer> {
  if (source.format !== 'heic') return readFile(source.path)
  if (!(await heicDecodable())) throw heicDecoderUnavailable(source.path)
  const decoded = await decodeHeic(source.path)
  try {
    return await readFile(decoded.path)
  } finally {
    await decoded.cleanup()
  }
}
```

Replace `measurer` with:

```ts
async function measurer(job: Job): Promise<Measurer | undefined> {
  if (job.op !== 'convert') return undefined
  // A lossless target has no quality to search: `encode` ignores quality for
  // PNG, GIF and TIFF, so every attempt would measure the same bytes.
  // Declining makes `runPlan` refuse with a reason instead of "searching" a
  // dial that is not connected to anything.
  if (!FORMATS[job.target].lossy) return undefined
  const source = job.sources[0]
  if (source.kind !== 'image') return undefined

  const input = await readOnce(source)
  return {
    ladder: [{}],
    measure: async (options) => {
      const { pipeline } = await pipelineFor(source, job.target, options, false, input)
      return (await encode(pipeline, job.target, options.quality).toBuffer()).length
    },
  }
}
```

(`cleanup` is a no-op when `input` is given, because no HEIC temp file was made. That is why `measure` can ignore it.)

- [ ] **Step 5: Report a batch search per file (`src/cli/execute.ts`)**

In `reportEvents`, replace the `search:attempt` branch with these two branches:

```ts
    if (event.type === 'search:attempt') {
      // A single file's search reports its real position. In a batch several
      // searches run at once (spec §4.4), and their attempt counters would
      // interleave into one number jumping about, so a batch reports finished
      // files instead (below).
      if (!batch) {
        opts.onSearch?.(
          event.rung.dpi === undefined
            ? `attempt ${event.attempt} of ${event.of}`
            : `${event.rung.dpi} dpi · attempt ${event.attempt} of ${event.of}`,
        )
      }
      return
    }
    if (event.type === 'search:settled') {
      if (batch) opts.onSearch?.(`${event.completed} of ${event.total} searched`)
      return
    }
```

Also update the `onSearch` doc comment in `ExecuteOptions`: after "e.g. `150 dpi · attempt 3 of 8`", add ", or `3 of 50 searched` for a batch".

- [ ] **Step 6: Run the tests and confirm they pass**

Run: `npx vitest run tests/core/run.test.ts tests/core/execute-jobs.test.ts tests/engines/image-measurer.test.ts tests/cli/search-status.test.ts tests/cli/pdf-compress.test.ts tests/cli/convert-max-size.test.ts tests/shell/compress-search-cancel.test.tsx tests/shell/compress-pdf-target-size.test.tsx`
Expected: PASS. The two shell suites check that the shell's single-file search and its esc-to-cancel behave as before.

- [ ] **Step 7: Run the full suite, typecheck and lint**

Run: `npm test && npm run typecheck && npm run lint`
Expected: everything passes.

- [ ] **Step 8: Measure the speedup by hand**

```bash
mkdir -p /tmp/forge-batch && sips -s format jpeg "Test Images/test.png" --out /tmp/forge-batch/sample.jpg >/dev/null
for i in $(seq -w 1 50); do cp /tmp/forge-batch/sample.jpg /tmp/forge-batch/img$i.jpg; done; rm /tmp/forge-batch/sample.jpg
time npx tsx src/index.ts /tmp/forge-batch --max-size 50kb -o /tmp/forge-batch-out/ --force
```

Expected: exit 0 and 50 `-small.jpg` files. Wall time is around a third of the 0.1.0 baseline of 36 s (spec estimate 9–10 s; tsx adds a little). Record the number in the task summary. Task 6's bench is the authoritative measurement.

- [ ] **Step 9: Commit**

```bash
git add src/core/run.ts src/core/execute-jobs.ts src/engines/image.ts src/cli/execute.ts tests/core/run.test.ts tests/core/execute-jobs.test.ts tests/engines/image-measurer.test.ts tests/cli/search-status.test.ts
git commit -m "$(cat <<'EOF'
perf(core): run --max-size searches through the conversion pool

Each file's quality search ran one at a time, rereading (and for HEIC
re-decoding) the source on every attempt. Searches now share runJobs'
worker pool, and an image search reads its source once. Write safety
still runs first, cancel still writes nothing, and a batch reports
finished files rather than an interleaved attempt counter. A search
that throws now fails its own file instead of the whole run.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: A bench script for the §3 targets (§7)

**Files:**
- Create: `scripts/bench.mjs`
- Modify: `package.json` (`scripts.bench`)

**Interfaces:**
- Consumes: nothing from other tasks. It measures whatever `npm run build` + `npm pack` produce, so it works on today's `tsc` output and on Task 7's bundle.
- Produces: `npm run bench`. It prints one row per spec §3 target (baseline, measured, target, `ok`/`MISSED`) and exits 1 if any target is missed. Flags: `--runs N` (default 11), `--shell-runs N` (7), `--batch-runs N` (3), `--skip install,version,overhead,shell,batch`, `--no-build`, `--prompt-marker <text>` (default `›`), `--keep` (leave the temp dir).

This task produces a script, not library code. It is checked by running it (Step 3), not with a vitest suite: wall-clock assertions in CI are flaky (spec §7), and a `.mjs` under `scripts/` is not part of the typechecked graph.

- [ ] **Step 1: Write `scripts/bench.mjs`**

```js
#!/usr/bin/env node
/**
 * Reproduces the lean-and-fast spec's §3 measurements against the package as
 * a user gets it: packed, installed globally into an empty prefix, run as
 * `forge`. Prints each against its target and exits 1 if any is missed.
 *
 * Run on demand and before a release. Never in the unit suite, where
 * wall-clock assertions would be flaky (spec §7).
 *
 *   node scripts/bench.mjs [--runs 11] [--shell-runs 7] [--batch-runs 3]
 *                          [--skip install,version,overhead,shell,batch]
 *                          [--no-build] [--prompt-marker ›] [--keep]
 *
 * Each figure is a median, after one discarded warm-up run. The sample photo
 * is `Test Images/test.png` converted by `sips`, byte-identical to the one
 * the spec's baseline was measured with (152,033 bytes, 2756×774). Installing
 * needs the npm registry, because sharp and pdfium are real dependencies.
 * The shell figure needs tmux (`brew install tmux`) and is skipped without it.
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'

const ROOT = resolve(import.meta.dirname, '..')
const { values } = parseArgs({
  options: {
    runs: { type: 'string', default: '11' },
    'shell-runs': { type: 'string', default: '7' },
    'batch-runs': { type: 'string', default: '3' },
    skip: { type: 'string', default: '' },
    'no-build': { type: 'boolean', default: false },
    'prompt-marker': { type: 'string', default: '›' },
    keep: { type: 'boolean', default: false },
  },
})
const skip = new Set(values.skip.split(',').filter(Boolean))
const runs = Number(values.runs)
const shellRuns = Number(values['shell-runs'])
const batchRuns = Number(values['batch-runs'])
const marker = values['prompt-marker']

/** Spec §3. `baseline` is 0.1.0 as measured; `target` is the acceptance bar. */
const TARGETS = {
  install: { label: 'Global install', unit: 'MB', baseline: 188, target: 40 },
  version: { label: 'forge --version', unit: 'ms', baseline: 253, target: 60 },
  overhead: { label: 'Load overhead, image conversion', unit: 'ms', baseline: 230, target: 100 },
  shell: { label: 'Shell to first prompt, intro on', unit: 'ms', baseline: 968, target: 600 },
  batch: { label: '50 JPEGs, --max-size 50kb', unit: 's', baseline: 36, target: 12 },
}

const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** Median wall time of `n` spawned runs, after one discarded warm-up. */
function timed(n, cmd, args, opts = {}) {
  const samples = []
  for (let i = 0; i <= n; i++) {
    const start = process.hrtime.bigint()
    const r = spawnSync(cmd, args, {
      stdio: ['ignore', 'ignore', 'pipe'],
      env: opts.env ?? process.env,
      cwd: opts.cwd,
    })
    const ms = Number(process.hrtime.bigint() - start) / 1e6
    if (r.status !== 0) {
      throw new Error(`${cmd} ${args.join(' ')} exited ${r.status}\n${r.stderr?.toString()}`)
    }
    if (i > 0) samples.push(ms)
  }
  return median(samples)
}

/** Milliseconds from starting `command` in a fresh tmux pane to `marker` appearing in it. */
async function untilVisible(command) {
  const session = `forge-bench-${process.pid}-${Math.random().toString(36).slice(2, 7)}`
  const start = performance.now()
  execFileSync('tmux', ['new-session', '-d', '-s', session, '-x', '120', '-y', '40', command])
  try {
    while (performance.now() - start < 10_000) {
      const pane = spawnSync('tmux', ['capture-pane', '-p', '-t', session], { encoding: 'utf8' })
      if (pane.stdout.includes(marker)) return performance.now() - start
      await sleep(2)
    }
    throw new Error(`"${marker}" did not appear within 10 s: ${command}`)
  } finally {
    spawnSync('tmux', ['kill-session', '-t', session])
    await sleep(100)
  }
}

async function medianVisible(n, command) {
  const samples = []
  for (let i = 0; i <= n; i++) {
    const ms = await untilVisible(command)
    if (i > 0) samples.push(ms)
  }
  return median(samples)
}

const work = mkdtempSync(join(tmpdir(), 'forge-bench-'))
const results = {}
const notes = []

try {
  if (!values['no-build']) execFileSync('npm', ['run', 'build'], { cwd: ROOT, stdio: 'inherit' })
  const [packed] = JSON.parse(
    execFileSync('npm', ['pack', '--json', '--pack-destination', work], {
      cwd: ROOT,
      encoding: 'utf8',
    }),
  )
  const prefix = join(work, 'prefix')
  execFileSync(
    'npm',
    ['install', '--global', '--prefix', prefix, '--no-audit', '--no-fund', join(work, packed.filename)],
    { stdio: 'inherit' },
  )
  const forge = join(prefix, 'bin', 'forge')
  const installed = join(prefix, 'lib', 'node_modules', 'forge-terminal')

  if (!skip.has('install')) {
    const kb = Number(execFileSync('du', ['-sk', prefix], { encoding: 'utf8' }).split('\t')[0])
    results.install = kb / 1024
  }

  if (!skip.has('version')) results.version = timed(runs, forge, ['--version'])

  const sample = join(work, 'sample.jpg')
  execFileSync('sips', ['-s', 'format', 'jpeg', join(ROOT, 'Test Images', 'test.png'), '--out', sample], {
    stdio: 'ignore',
  })

  if (!skip.has('overhead')) {
    // Forge's conversion minus the same Sharp pipeline run directly, from the
    // same installed Sharp, in a bare node process: what is left is Forge's
    // own load and plumbing.
    const out = join(work, 'overhead')
    mkdirSync(out)
    const forgeMs = timed(runs, forge, [sample, '--to', 'webp', '-o', join(out, 'forge.webp'), '--force'])
    const raw = join(work, 'raw-sharp.mjs')
    writeFileSync(
      raw,
      `import { createRequire } from 'node:module'
const require = createRequire(${JSON.stringify(join(installed, 'package.json'))})
const sharp = require('sharp')
await sharp(process.argv[2]).rotate().keepIccProfile().webp({ quality: 80 }).toFile(process.argv[3])
`,
    )
    const rawMs = timed(runs, process.execPath, [raw, sample, join(out, 'raw.webp')])
    results.overhead = forgeMs - rawMs
    notes.push(`overhead = forge ${forgeMs.toFixed(0)} ms − raw sharp ${rawMs.toFixed(0)} ms`)
  }

  if (!skip.has('shell')) {
    if (spawnSync('tmux', ['-V']).status !== 0) {
      notes.push('shell: skipped, tmux not found')
    } else {
      const xdg = join(work, 'xdg')
      mkdirSync(join(xdg, 'forge'), { recursive: true })
      writeFileSync(join(xdg, 'forge', 'config.json'), JSON.stringify({ theme: 'dark' }))
      const env = `env XDG_CONFIG_HOME='${xdg}' TERM=xterm-256color COLORTERM=truecolor`
      // tmux's own start-up is subtracted: a pane that prints the marker at
      // once measures what the harness itself costs.
      const calibration = await medianVisible(shellRuns, `printf 'ready${marker}\\n'; sleep 30`)
      const shell = await medianVisible(shellRuns, `${env} '${forge}'`)
      results.shell = shell - calibration
      notes.push(`shell = ${shell.toFixed(0)} ms − tmux calibration ${calibration.toFixed(0)} ms`)
    }
  }

  if (!skip.has('batch')) {
    const batch = join(work, 'batch')
    const out = join(work, 'batch-out')
    mkdirSync(batch)
    mkdirSync(out)
    for (let i = 1; i <= 50; i++) copyFileSync(sample, join(batch, `img${String(i).padStart(2, '0')}.jpg`))
    results.batch = timed(batchRuns, forge, [batch, '--max-size', '50kb', '-o', `${out}/`, '--force']) / 1000
  }
} finally {
  if (values.keep) console.log(`\nkept ${work}`)
  else rmSync(work, { recursive: true, force: true })
}

const cell = (v, unit) => `${unit === 's' ? v.toFixed(1) : v.toFixed(0)} ${unit}`.padStart(11)
let missed = 0
console.log(`\n${'measure'.padEnd(34)}${'0.1.0'.padStart(11)}${'now'.padStart(11)}${'target'.padStart(11)}`)
for (const [key, t] of Object.entries(TARGETS)) {
  const v = results[key]
  if (v === undefined) {
    console.log(`${t.label.padEnd(34)}${'skipped'.padStart(22)}`)
    continue
  }
  const ok = v <= t.target
  if (!ok) missed += 1
  console.log(`${t.label.padEnd(34)}${cell(t.baseline, t.unit)}${cell(v, t.unit)}${cell(t.target, t.unit)}  ${ok ? 'ok' : 'MISSED'}`)
}
for (const note of notes) console.log(`  ${note}`)
process.exitCode = missed > 0 ? 1 : 0
```

- [ ] **Step 2: Add the script entry**

In `package.json` `scripts`, add after `"dev"`:

```json
    "bench": "node scripts/bench.mjs",
```

- [ ] **Step 3: Run it**

Run: `npm run bench -- --batch-runs 1`
Expected: it builds, packs, installs into a temp prefix, then prints the five-row table and the notes. On a pre-Task-7 build, expect install around 188 MB or less (less if Task 2 has merged) and `MISSED` on install. Exit code is 1 while any target is missed. That is correct behaviour, not a failure of this task. The task is done when the table prints with numbers in every row (or `skipped` for shell without tmux) and no exception. Paste the table into the task summary.

- [ ] **Step 4: Lint and commit**

Run: `npx biome check scripts/bench.mjs`
Expected: no errors. (Task 7 adds `scripts` to `npm run lint`.)

```bash
git add scripts/bench.mjs package.json
git commit -m "$(cat <<'EOF'
chore: bench script for the lean-and-fast targets

scripts/bench.mjs packs Forge, installs it into an empty prefix and
measures install size, --version, image-conversion load overhead,
time to the shell's first prompt (tmux) and the 50-JPEG --max-size
batch, each against its spec §3 target. On demand, never in CI.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Ship one bundled file (§4.5)

**Files:**
- Create: `scripts/build.mjs`
- Create: `scripts/stubs/react-devtools-core.mjs`
- Create: `tests/bundle/bundle.test.ts`
- Modify: `package.json` (scripts, dependencies → devDependencies, add `esbuild`)
- Modify: `package-lock.json` (via npm)
- Modify: `.gitignore` (add `.bundle-test/`)
- Modify: `tests/core/licences.test.ts` (check what ships, not `!dev`)

**Interfaces:**
- Consumes: everything above, already merged on `dev`. Task 1's `lazy` loaders become chunks. Task 3's `boot.ts` → `launch.tsx` dynamic import becomes the shell chunk. Task 6's `npm run bench` verifies the targets. Task 1's `modulesLoaded`/`packagesIn` with `tsx: false`.
- Produces: `npm run build` → `dist/index.js` (with the shebang) + `dist/chunks/*.js` + `dist/third-party-licenses.txt`. `node scripts/build.mjs --outdir <dir> [--metafile]` writes `<dir>/meta.json` when `--metafile` is given. `dependencies` becomes `{ "@hyzyla/pdfium", "sharp" }`.

- [ ] **Step 1: Write the failing end-to-end suite**

`tests/bundle/bundle.test.ts`:

```ts
import { execFile } from 'node:child_process'
import { mkdtemp, readdir, readFile } from 'node:fs/promises'
import * as nodeModule from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import mammoth from 'mammoth'
import { beforeAll, describe, expect, it } from 'vitest'
import { extractPdfText } from '../../src/engines/pdfium.js'
import { VERSION } from '../../src/shell/theme.js'
import { makeDoc, makeDocx, makeJpeg, makeTempDir, makeTextPdf } from '../helpers/fixtures.js'
import { modulesLoaded, packagesIn } from '../helpers/load-log.js'

/**
 * Spec §4.5: one suite runs against the built bundle, so a bundling mistake
 * (a missed external, a broken dynamic import, a chunk that cannot load)
 * fails here rather than for a user. Built into .bundle-test/ inside the
 * repo, so the externals resolve from the repo's node_modules the way they
 * will from the installed package's. Every command runs from an unrelated
 * cwd (Review Focus 4).
 */
const run = promisify(execFile)
const root = process.cwd()
const outdir = join(root, '.bundle-test')
const bin = join(outdir, 'index.js')

interface Meta {
  outputs: Record<
    string,
    { entryPoint?: string; imports: Array<{ path: string; kind: string; external?: boolean }> }
  >
}
let meta: Meta
let elsewhere: string

beforeAll(async () => {
  await run(process.execPath, [join(root, 'scripts', 'build.mjs'), '--outdir', '.bundle-test', '--metafile'], {
    cwd: root,
  })
  meta = JSON.parse(await readFile(join(outdir, 'meta.json'), 'utf8')) as Meta
  elsewhere = await mkdtemp(join(tmpdir(), 'forge-elsewhere-'))
}, 120_000)

async function forge(args: string[], env: NodeJS.ProcessEnv = {}) {
  try {
    const { stdout, stderr } = await run(process.execPath, [bin, ...args], {
      cwd: elsewhere,
      env: { ...process.env, ...env },
    })
    return { exitCode: 0, stdout, stderr }
  } catch (e) {
    const err = e as { code?: number; stdout?: string; stderr?: string }
    return { exitCode: err.code ?? -1, stdout: err.stdout ?? '', stderr: err.stderr ?? '' }
  }
}

/** The bundle's output file for a source module that was split into its own chunk. */
function chunkFor(entryPoint: string): string {
  const found = Object.entries(meta.outputs).find(([, o]) => o.entryPoint === entryPoint)
  if (!found) throw new Error(`no chunk for ${entryPoint}`)
  return found[0]
}

const packageOf = (specifier: string) => {
  const [first = '', second = ''] = specifier.split('/')
  return first.startsWith('@') ? `${first}/${second}` : first
}

describe('the bundle', () => {
  it('reaches outside itself only for Node built-ins and its declared dependencies', async () => {
    const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')) as {
      dependencies: Record<string, string>
    }
    const builtins = new Set(nodeModule.builtinModules)
    const externals = new Set<string>()
    for (const output of Object.values(meta.outputs)) {
      for (const imp of output.imports) {
        if (!imp.external || imp.path.startsWith('node:')) continue
        if (builtins.has(imp.path) || builtins.has(packageOf(imp.path))) continue
        externals.add(packageOf(imp.path))
      }
    }
    expect([...externals].sort()).toEqual(Object.keys(pkg.dependencies).sort())
  })

  it('ships no source maps', async () => {
    const files = (await readdir(outdir, { recursive: true })) as string[]
    expect(files.filter((f) => f.endsWith('.map'))).toEqual([])
    for (const file of files.filter((f) => f.endsWith('.js'))) {
      expect(await readFile(join(outdir, file), 'utf8'), file).not.toContain('sourceMappingURL')
    }
  })

  it('ships the licences of what it inlines', async () => {
    const text = await readFile(join(outdir, 'third-party-licenses.txt'), 'utf8')
    expect(text).toContain('ink@')
    expect(text).toContain('pdf-lib@')
    expect(text).not.toContain('sharp@')
  })

  it('answers --version with nothing on stderr', async () => {
    const result = await forge(['--version'])
    expect(result).toEqual({ exitCode: 0, stdout: `${VERSION}\n`, stderr: '' })
  })

  it('answers --version without loading an external or the execute or shell chunks', async () => {
    const { exitCode, urls } = await modulesLoaded([bin, '--version'], { tsx: false, cwd: elsewhere })
    expect(exitCode).toBe(0)
    const packages = packagesIn(urls)
    expect(packages).not.toContain('sharp')
    expect(packages).not.toContain('@hyzyla/pdfium')
    for (const entry of ['src/cli/execute.ts', 'src/shell/boot.ts', 'src/shell/launch.tsx']) {
      expect(urls.some((u) => u.endsWith(chunkFor(entry))), entry).toBe(false)
    }
  })

  it('fills Node’s compile cache when Node has one', async (ctx) => {
    if (typeof nodeModule.enableCompileCache !== 'function') {
      ctx.skip('this Node has no compile cache')
      return
    }
    const cache = await mkdtemp(join(tmpdir(), 'forge-cache-'))
    await forge(['--formats'], { NODE_COMPILE_CACHE: cache })
    expect((await readdir(cache, { recursive: true })).length).toBeGreaterThan(0)
  })

  it('converts a JPEG to WebP', async () => {
    const dir = await makeTempDir()
    const jpeg = await makeJpeg(dir, 'a.jpg')
    const result = await forge([jpeg, '--to', 'webp'])
    expect(result.exitCode).toBe(0)
    expect(await readdir(dir)).toContain('a.webp')
  })

  it('rasterises a PDF to PNG through pdfium', async () => {
    const dir = await makeTempDir()
    const pdf = await makeTextPdf(dir, 'doc.pdf', ['Rendered.'])
    const result = await forge([pdf, '--to', 'png'])
    expect(result.exitCode).toBe(0)
    expect(await readdir(dir)).toContain('doc-1.png')
  })

  it('converts a PDF to DOCX, text intact, nothing on stderr', async () => {
    const dir = await makeTempDir()
    const pdf = await makeTextPdf(dir, 'notes.pdf', ['Hello from the bundle.'])
    const result = await forge([pdf, '--to', 'docx'])
    expect(result.exitCode).toBe(0)
    expect(result.stderr).toBe('')
    const { value } = await mammoth.extractRawText({ path: join(dir, 'notes.docx') })
    expect(value).toContain('Hello from the bundle.')
  })

  it('converts a DOCX to PDF through mammoth', async () => {
    const dir = await makeTempDir()
    const docx = await makeDocx(dir, 'letter.docx', ['Dear reader.'])
    const result = await forge([docx, '--to', 'pdf'])
    expect(result.exitCode).toBe(0)
    const pages = await extractPdfText(await readFile(join(dir, 'letter.pdf')))
    expect(pages.join('\n')).toContain('Dear reader.')
  })

  it('converts a legacy DOC to PDF through word-extractor', async (ctx) => {
    const dir = await makeTempDir()
    const doc = await makeDoc(dir, 'old.doc', 'Legacy words.')
    if (doc === null) {
      ctx.skip('textutil unavailable — .doc fixture cannot be generated')
      return
    }
    const result = await forge([doc, '--to', 'pdf'])
    expect(result.exitCode).toBe(0)
  })

  it('loads the shell chunk: Ink, React and yoga', async () => {
    const launch = join(root, chunkFor('src/shell/launch.tsx'))
    const { stdout } = await run(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        'const m = await import(process.argv[1]); console.log(typeof m.launchShell)',
        launch,
      ],
      { cwd: elsewhere, env: { ...process.env, FORCE_COLOR: '0' } },
    )
    expect(stdout.trim()).toBe('function')
  })

  it('refuses to open the shell without a terminal, from the bundle too', async () => {
    const result = await forge([])
    expect(result.exitCode).toBe(2)
    expect(result.stderr).toContain('Forge needs a file and a target format.')
  })
})
```

Run: `npx vitest run tests/bundle/bundle.test.ts`
Expected: FAIL in `beforeAll` with `Cannot find module '…/scripts/build.mjs'`.

- [ ] **Step 2: Write the stub and the build script**

`scripts/stubs/react-devtools-core.mjs`:

```js
// Ink imports react-devtools-core only when DEV=true and the package is
// installed (ink/build/reconciler.js). It is neither shipped nor wanted, so
// the bundle aliases it to this.
export default { connectToDevTools() {} }
```

`scripts/build.mjs`:

```js
#!/usr/bin/env node
/**
 * Builds the published package: one esbuild ESM bundle (spec §4.5).
 *
 * - The externals are exactly package.json `dependencies`, today sharp and
 *   @hyzyla/pdfium, which carry a native binary or a wasm file and must be
 *   installed, not inlined. Everything else is bundled, so its maps, type
 *   declarations and duplicate builds never reach a user's disk.
 * - `splitting` keeps every dynamic import (engines' libraries, execute.ts,
 *   the shell) as its own chunk, so bundling does not undo lazy loading.
 * - No source maps. `--debug` stack traces point at bundle lines.
 * - The `require` banner gives bundled CommonJS a real `require` for Node
 *   built-ins under ESM.
 * - The licences of everything inlined go into third-party-licenses.txt,
 *   since their own LICENSE files no longer ship.
 *
 *   node scripts/build.mjs [--outdir dist] [--metafile]
 */
import { readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { build } from 'esbuild'

const ROOT = resolve(import.meta.dirname, '..')
const { values } = parseArgs({
  options: {
    outdir: { type: 'string', default: 'dist' },
    metafile: { type: 'boolean', default: false },
  },
})
const outdir = resolve(ROOT, values.outdir)
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))

rmSync(outdir, { recursive: true, force: true })

const result = await build({
  absWorkingDir: ROOT,
  entryPoints: ['src/index.ts'],
  outdir,
  bundle: true,
  splitting: true,
  format: 'esm',
  platform: 'node',
  target: 'node20',
  external: Object.keys(pkg.dependencies ?? {}),
  alias: { 'react-devtools-core': './scripts/stubs/react-devtools-core.mjs' },
  banner: {
    js: "import { createRequire as __forgeCreateRequire } from 'node:module';\nconst require = __forgeCreateRequire(import.meta.url);",
  },
  define: { 'process.env.NODE_ENV': '"production"' },
  jsx: 'automatic',
  minify: true,
  sourcemap: false,
  legalComments: 'none',
  chunkNames: 'chunks/[name]-[hash]',
  metafile: true,
  logLevel: 'warning',
})

writeFileSync(join(outdir, 'third-party-licenses.txt'), licences(result.metafile))
if (values.metafile) writeFileSync(join(outdir, 'meta.json'), JSON.stringify(result.metafile))

/** One section per package the bundle inlines: name, version, licence, and its licence text. */
function licences(metafile) {
  const packages = new Map()
  for (const input of Object.keys(metafile.inputs)) {
    const at = input.lastIndexOf('node_modules/')
    if (at === -1) continue
    const [first, second] = input.slice(at + 'node_modules/'.length).split('/')
    const name = first.startsWith('@') ? `${first}/${second}` : first
    packages.set(join(ROOT, input.slice(0, at), 'node_modules', name), name)
  }
  const sections = [...packages]
    .sort((a, b) => a[1].localeCompare(b[1]))
    .map(([dir, name]) => {
      const meta = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
      const licence = typeof meta.license === 'string' ? meta.license : (meta.license?.type ?? 'UNKNOWN')
      const file = readdirSync(dir).find((f) => /^(licen[cs]e|copying)/i.test(f))
      const text = file === undefined ? `(no licence file in the package; package.json says ${licence})` : readFileSync(join(dir, file), 'utf8').trim()
      return `${name}@${meta.version} — ${licence}\n\n${text}`
    })
  return `Forge bundles the following packages.\n\n${sections.join(`\n\n${'-'.repeat(72)}\n\n`)}\n`
}
```

- [ ] **Step 3: Move bundled packages to `devDependencies` and wire the scripts**

```bash
npm install --save-dev adm-zip@^0.6.0 cfb@^1.2.2 commander@^15.0.0 docx@^9.7.1 ink@^7.1.1 mammoth@^1.12.1 pdf-lib@^1.17.1 react@^19.2.8 string-width@^8.2.2 supports-hyperlinks@^4.5.0 tinyglobby@^0.2.17 word-extractor@^1.0.4 esbuild@^0.28.2
```

Expected: `package.json` `dependencies` is now exactly `"@hyzyla/pdfium"` and `"sharp"`. If npm left a duplicate in `dependencies`, delete it by hand and run `npm install` again.

In `package.json` `scripts`, set:

```json
    "build": "node scripts/build.mjs",
    "lint": "biome check src tests scripts",
    "format": "biome format --write src tests scripts",
    "prepublishOnly": "npm run build && npm run typecheck && npm run lint && npm test"
```

(`prepublishOnly` drops `rm -rf dist`, because the build script clears its outdir itself.) Leave `bin`, `files`, `engines` and `os` unchanged.

Add to `.gitignore`, after `dist/`:

```
.bundle-test/
```

- [ ] **Step 4: Check licences over what ships, not over `!dev`**

After Step 3, Ink, React, pdf-lib and the rest are `dev: true` in the lockfile but still ship, inlined. A `!meta.dev` filter would stop checking them. In `tests/core/licences.test.ts`, change `import { readFile } from 'node:fs/promises'` to `import { readdir, readFile } from 'node:fs/promises'`, add `import { join } from 'node:path'`, and replace `type LockPackage`, `type Lock` and `productionPackages()` with:

```ts
type LockPackage = {
  license?: string
  dev?: boolean
  dependencies?: Record<string, string>
  optionalDependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
}
type Lock = { packages?: Record<string, LockPackage> }

const srcDir = fileURLToPath(new URL('../../src', import.meta.url))

/** Package names Forge's own source imports, statically, dynamically or as a type. */
async function importedPackages(): Promise<Set<string>> {
  const names = new Set<string>()
  const files = (await readdir(srcDir, { recursive: true })) as string[]
  for (const file of files.filter((f) => /\.tsx?$/.test(f))) {
    const text = await readFile(join(srcDir, file), 'utf8')
    for (const [, specifier] of text.matchAll(/(?:from|import\()\s*'([^'.][^']*)'/g)) {
      if (specifier === undefined || specifier.startsWith('node:')) continue
      const [first = '', second = ''] = specifier.split('/')
      names.add(first.startsWith('@') ? `${first}/${second}` : first)
    }
  }
  return names
}

/**
 * Every lockfile package Forge ships: the closure of what `src/` imports,
 * resolved the way Node resolves it. Inlined into the bundle or installed
 * beside it, it is distributed either way. `dev: true` stopped meaning "not
 * shipped" once the bundle inlined devDependencies (spec §4.5).
 */
async function shippedPackages(): Promise<Array<[string, LockPackage]>> {
  const lock = JSON.parse(await readFile(lockPath, 'utf8')) as Lock
  const packages = lock.packages ?? {}
  const shipped = new Map<string, LockPackage>()

  const visit = (name: string, from: string): void => {
    let base = from
    for (;;) {
      const path = `${base === '' ? '' : `${base}/`}node_modules/${name}`
      const meta = packages[path]
      if (meta !== undefined) {
        if (shipped.has(path)) return
        shipped.set(path, meta)
        const deps = { ...meta.dependencies, ...meta.optionalDependencies, ...meta.peerDependencies }
        for (const dep of Object.keys(deps)) visit(dep, path)
        return
      }
      if (base === '') return
      const at = base.lastIndexOf('/node_modules/')
      base = at === -1 ? '' : base.slice(0, at)
    }
  }

  for (const name of await importedPackages()) visit(name, '')
  return [...shipped]
}
```

Replace both calls to `productionPackages()` with `shippedPackages()`. Add, inside `describe('dependency licences', …)`:

```ts
  it('counts bundled packages as shipped, and the toolchain as not', async () => {
    const paths = (await shippedPackages()).map(([path]) => path)
    // Inlined by the bundle, so shipped, though now devDependencies.
    expect(paths).toContain('node_modules/ink')
    expect(paths).toContain('node_modules/pdf-lib')
    // Installed beside it.
    expect(paths).toContain('node_modules/sharp')
    // Never imported by src/.
    expect(paths).not.toContain('node_modules/vitest')
    expect(paths).not.toContain('node_modules/typescript')
    expect(paths).not.toContain('node_modules/esbuild')
  })
```

- [ ] **Step 5: Build, then run the bundle suite and the licence suite**

Run: `npm run build && ls dist dist/chunks | head -30 && npx vitest run tests/bundle/bundle.test.ts tests/core/licences.test.ts`
Expected: `dist/` holds `index.js`, `chunks/` and `third-party-licenses.txt`. There are no `.map` files and no `cli/`/`core/` directories. All bundle tests pass (the DOC case may skip without textutil), and the licence tests pass. If the externals test lists an extra package, the bundle reached a package that is only a devDependency at runtime. Decide whether it belongs in `dependencies` (native or wasm) or should be bundled; do not just add it to the expected list.

- [ ] **Step 6: Run the full suite, typecheck and lint**

Run: `npm test && npm run typecheck && npm run lint`
Expected: everything passes. `npm run typecheck` still uses `tsc -p tsconfig.typecheck.json`. `tsconfig.json`'s `outDir`/`sourceMap` are now unused by the build and are left alone.

- [ ] **Step 7: Measure against the targets**

Run: `npm run bench`
Expected: every row `ok` and exit code 0. In particular, install ≤ 40 MB (spec estimate ~33 MB: a 2–3 MB bundle plus 30.7 MB of sharp and pdfium). If a target is missed, do not tune numbers to pass. Report the table to the human partner: per spec §3 these are acceptance criteria, and missing one is a finding.

- [ ] **Step 8: Try the installed shell by hand**

The bench leaves no install behind, so reinstall: `npm pack && npm i -g --prefix /tmp/forge-try ./forge-terminal-0.1.0.tgz && /tmp/forge-try/bin/forge`.
Expected: the intro plays, the prompt appears, a dropped JPEG converts, and `/pdf` on a PDF works. Remove `/tmp/forge-try` and the `.tgz` afterwards.

- [ ] **Step 9: Commit**

```bash
git add scripts/build.mjs scripts/stubs/react-devtools-core.mjs tests/bundle/bundle.test.ts tests/core/licences.test.ts package.json package-lock.json .gitignore
git commit -m "$(cat <<'EOF'
build: publish one esbuild bundle instead of tsc output

dist/ is now a minified ESM bundle with a chunk per dynamic import, so
lazy loading survives bundling. Only sharp and @hyzyla/pdfium stay
dependencies; everything else is inlined and moves to devDependencies,
taking its source maps, type declarations and duplicate builds off
users' disks. Licences of inlined packages ship in
third-party-licenses.txt, and the licence test now checks the import
closure rather than the dev flag. An end-to-end suite runs against the
built bundle from an unrelated cwd.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

## Self-Review

**Spec coverage**

| Spec | Task |
| --- | --- |
| §4.1 replace pdf-parse; widen the evidence first (multi-column, RTL, CJK, ligatures, Type3, scanned); export from `pdfium.ts`; encrypted refusal unaffected; three oracle swaps; remove dependency | Task 2 (Steps 1–8). The encrypted case is in `pdf-text.test.ts`. |
| §4.2.1 parse first, import second | Task 1 Step 9 |
| §4.2.2 static capability data, cached `load()` per engine; invariants 2 and 3 | Task 1 Steps 4–8. `--formats` and image-conversion load tests. |
| §4.2.3 compile cache, guarded | Task 1 Step 9. Tested against the bundle in Task 7. |
| §4.3 intro overlaps import; colour preference first; look unchanged | Task 3 |
| §4.4 searches through the pool; decode once; safety first; cancel unchanged; real progress | Task 5. See ambiguity 2 below about "decode once". |
| §4.5 bundle; externals; devDependencies; chunks; devtools stub; no maps; `tsc` still typechecks; e2e suite | Task 7 |
| §4.6 `--to … --max-size` honoured; lossless refused | Task 4 |
| §7 bench script, load-guard unit test, §4.1 fixtures, §4.4 behaviour, §4.6 regression | Tasks 6, 1, 2, 5, 4 |
| §8 order | Parallelism section |

**Placeholders:** none. The only deferred content is the measured comparison table in Task 2 Step 8. It is pre-filled with the planning-time measurements, and the implementer is told to substitute their own run's numbers if they differ. In Task 3 Step 3, the kitty comment is "copy back verbatim", not new content.

**Type consistency:** `extractPdfText(bytes: Uint8Array): Promise<string[]>` is used the same way in Tasks 2 and 7. `ShellStart`, `BootDeps` and `bootShell` match between `boot.ts`, `launch.tsx` and the test. `reportEvents(opts, batch)` is introduced in Task 4 and extended in Task 5. `unsupportedCompress(source, target?)` is called in Tasks 4 and 5. `pool`/`resolveConcurrency` are defined and used in Task 5. `modulesLoaded`/`packagesIn` are defined in Task 1 and used in Tasks 3 and 7.

**Review Focus:** all five items have tests in their owning tasks: 1 and 2 in Task 5 Step 1, 3 in Task 3 Step 1, 4 in Task 7 Step 1 (every command runs from `elsewhere`), 5 in Task 4 Step 1.
