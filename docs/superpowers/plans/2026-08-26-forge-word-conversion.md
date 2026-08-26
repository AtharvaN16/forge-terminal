# PDF ⇄ Word (DOCX/DOC) Conversion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add PDF → DOCX, PDF → DOC-source-only reverse (DOC → PDF), and DOCX → PDF conversion to Forge, via a hybrid engine that uses LibreOffice when installed and always falls back to an npm-only path otherwise.

**Architecture:** One new engine, `src/engines/word.ts`, registered alongside the existing `image`/`pdf`/`pdfium` engines. It reads `docx`, `doc`, `pdf` and writes `docx`, `pdf`. Every conversion first checks for `soffice` (LibreOffice's CLI) on this machine; if found, it shells out to it exactly once per file (`--headless --convert-to`). If not found, it extracts plain text (`mammoth` for docx, `word-extractor` for doc, `pdf-parse` for pdf) and lays that text back out (`pdf-lib` for a PDF target, the `docx` package for a DOCX target), attaching a `Warning` that names the fidelity trade-off. Three existing files that quietly assumed "a document source" meant "a PDF" — `core/actions/convert.ts` and the four page-operation actions — get a small, targeted fix so a dropped `.docx` doesn't reach an engine that can't handle it.

**Tech Stack:** TypeScript strict/ESM, Vitest, `pdf-lib` (already a dependency) — plus six new pure-JS/WASM dependencies: `mammoth`, `docx`, `pdf-parse`, `word-extractor`, `cfb`, `adm-zip`.

**Spec:** [docs/superpowers/specs/2026-08-26-forge-word-conversion-design.md](../specs/2026-08-26-forge-word-conversion-design.md)

## Global Constraints

- macOS only, Node ≥20 (existing `package.json` floor) — no change.
- `core/` and `engines/` import no React, no Ink, no Chalk, and never write to stdout (invariant 1).
- No hardcoded list of output formats anywhere — targets come from `targetsFor(source)` (invariant 2).
- Sources are probed by content, never by file extension (invariant 3).
- Writes are atomic — temp file, then rename, via the existing `writeAtomic` helper (invariant 6).
- `doc` (legacy binary Word) is a read-only source — never a write target, at any layer.
- LibreOffice not being installed never blocks a conversion; it only routes to the npm fallback, which always succeeds or fails on its own merits. A `soffice` invocation that *is* attempted and fails (bad input, timeout) is a real `conversion-failed`, never a silent fallback trigger.
- The `word-basic-fidelity` warning is attached if and only if the npm fallback path ran — never when LibreOffice did the conversion.
- Every new dependency is pure JS/WASM — no native compilation step is added to `npm install`.

---

### Task 1: Format registry — DOCX/DOC types, the new warning code, and two knock-on fixes

**Files:**
- Modify: `src/core/types.ts`
- Modify: `src/core/formats.ts`
- Modify: `src/engines/image.ts`
- Modify: `src/shell/components/FileCard.tsx`
- Test: `tests/core/formats.test.ts`
- Test: `tests/shell/file-card.test.tsx` (new)

**Interfaces:**
- Consumes: nothing new — this task only extends existing types.
- Produces: `FormatId` now includes `'docx' | 'doc'`; `FORMATS.docx`/`FORMATS.doc`; `Warning['code']` now includes `'word-basic-fidelity'`. Every later task in this plan depends on these three additions existing.

- [ ] **Step 1: Write the failing test for the format registry**

Replace the `'knows all eight formats'` test in `tests/core/formats.test.ts` (it will need updating to ten regardless — do it now so the red/green cycle is meaningful):

```ts
  it('knows all ten formats', () => {
    expect(ALL_FORMAT_IDS.sort()).toEqual([
      'avif',
      'doc',
      'docx',
      'gif',
      'heic',
      'jpeg',
      'pdf',
      'png',
      'tiff',
      'webp',
    ])
  })
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/core/formats.test.ts`
Expected: FAIL — `ALL_FORMAT_IDS.sort()` is still the eight-entry list.

- [ ] **Step 3: Add the two FormatIds and their registry entries**

In `src/core/types.ts`, change:

```ts
export type FormatId = 'jpeg' | 'png' | 'webp' | 'avif' | 'heic' | 'gif' | 'tiff' | 'pdf'
```

to:

```ts
export type FormatId =
  | 'jpeg'
  | 'png'
  | 'webp'
  | 'avif'
  | 'heic'
  | 'gif'
  | 'tiff'
  | 'pdf'
  | 'docx'
  | 'doc'
```

In `src/core/formats.ts`, add two entries to the `FORMATS` object, after the `pdf` entry:

```ts
  docx: {
    id: 'docx',
    label: 'DOCX',
    extensions: ['.docx'],
    hasAlpha: false,
    animatable: false,
    lossy: false,
    hint: 'Word document',
  },
  doc: {
    id: 'doc',
    label: 'DOC',
    extensions: ['.doc'],
    hasAlpha: false,
    animatable: false,
    lossy: false,
    hint: 'legacy Word',
  },
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run tests/core/formats.test.ts`
Expected: PASS

- [ ] **Step 5: Add the new Warning code**

In `src/core/types.ts`, find the `Warning` interface's `code` union:

```ts
export interface Warning {
  code:
    | 'animation-flattened'
    /** A PDF held nothing this could re-encode, so its size barely moved. */
    | 'pdf-no-images'
    /** Some images were re-encoded and some were left alone. */
    | 'pdf-images-skipped'
    /** Image resolution was reduced, which is the loss worth naming. */
    | 'pdf-downsampled'
  message: string
}
```

Add one member:

```ts
export interface Warning {
  code:
    | 'animation-flattened'
    /** A PDF held nothing this could re-encode, so its size barely moved. */
    | 'pdf-no-images'
    /** Some images were re-encoded and some were left alone. */
    | 'pdf-images-skipped'
    /** Image resolution was reduced, which is the loss worth naming. */
    | 'pdf-downsampled'
    /** The npm fallback ran instead of LibreOffice — tables, images and layout were not preserved. */
    | 'word-basic-fidelity'
  message: string
}
```

- [ ] **Step 6: Run the typecheck to find every place that must now handle the new FormatIds**

Run: `npm run typecheck`
Expected: FAIL — `src/engines/image.ts`'s `encode()` switch is missing two cases (`noImplicitReturns` catches the two new `FormatId` members falling through with no return).

- [ ] **Step 7: Make `image.ts`'s switch exhaustive**

In `src/engines/image.ts`, find:

```ts
    case 'heic':
      throw new Error('heic is not writable; the capability graph should have prevented this')
    case 'pdf':
      throw new Error('pdf is not an image target; the capability graph should have prevented this')
  }
```

Change to:

```ts
    case 'heic':
      throw new Error('heic is not writable; the capability graph should have prevented this')
    case 'pdf':
      throw new Error('pdf is not an image target; the capability graph should have prevented this')
    case 'docx':
      throw new Error('docx is not an image target; the capability graph should have prevented this')
    case 'doc':
      throw new Error('doc is not an image target; the capability graph should have prevented this')
  }
```

- [ ] **Step 8: Run the typecheck again**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 9: Write the failing FileCard test**

`DocumentInfo.pages` can now legitimately be `0` (an unknown page count, for `.doc`), and `FileCard` currently always renders `` `${pages} pages` ``. Create `tests/shell/file-card.test.tsx`:

```tsx
import { render } from 'ink-testing-library'
import type { ReactElement } from 'react'
import { describe, expect, it } from 'vitest'
import { FileCard } from '../../src/shell/components/FileCard.js'
import { ThemeProvider } from '../../src/shell/ThemeContext.js'
import { DARK } from '../../src/shell/theme.js'
import type { DocumentInfo } from '../../src/core/types.js'

const frameOf = (node: ReactElement) =>
  render(<ThemeProvider palette={DARK}>{node}</ThemeProvider>).lastFrame() ?? ''

const doc = (over: Partial<DocumentInfo> = {}): DocumentInfo => ({
  kind: 'document',
  path: '/Users/me/report.pdf',
  format: 'pdf',
  bytes: 45_000,
  pages: 3,
  encrypted: false,
  ...over,
})

describe('FileCard page count', () => {
  it('shows the page count for a document with a known one', () => {
    const frame = frameOf(<FileCard source={doc({ pages: 3 })} width={100} />)
    expect(frame).toContain('3 pages')
  })

  it('omits the page count entirely for an unknown one, rather than showing "0 pages"', () => {
    const frame = frameOf(
      <FileCard source={doc({ path: '/Users/me/legacy.doc', format: 'doc', pages: 0 })} width={100} />,
    )
    expect(frame).not.toContain('0 pages')
    expect(frame).not.toContain('pages')
  })
})
```

- [ ] **Step 10: Run it to verify the second case fails**

Run: `npx vitest run tests/shell/file-card.test.tsx`
Expected: first test PASSES, second FAILS (frame contains `0 pages`).

- [ ] **Step 11: Fix FileCard**

In `src/shell/components/FileCard.tsx`, find:

```tsx
  const facts = (
    source.kind === 'image'
      ? [
          `${source.width}×${source.height}`,
          formatBytes(source.bytes),
          // Only claimed when the source genuinely carries alpha — saying
          // "transparent" about an opaque JPEG would be a plain lie about the file.
          ...(source.hasAlpha ? ['transparent'] : []),
        ]
      : [`${source.pages} pages`, formatBytes(source.bytes)]
  ).join(' · ')
```

Change the document branch:

```tsx
  const facts = (
    source.kind === 'image'
      ? [
          `${source.width}×${source.height}`,
          formatBytes(source.bytes),
          // Only claimed when the source genuinely carries alpha — saying
          // "transparent" about an opaque JPEG would be a plain lie about the file.
          ...(source.hasAlpha ? ['transparent'] : []),
        ]
      : [
          // 0 means "unknown" (a `.doc` file, or a `.docx` that never cached a
          // page count) — showing "0 pages" would read as a real, wrong fact.
          ...(source.pages > 0 ? [`${source.pages} pages`] : []),
          formatBytes(source.bytes),
        ]
  ).join(' · ')
```

- [ ] **Step 12: Run the FileCard test and the full suite**

Run: `npx vitest run tests/shell/file-card.test.tsx tests/core/formats.test.ts`
Expected: PASS

- [ ] **Step 13: Commit**

```bash
git add src/core/types.ts src/core/formats.ts src/engines/image.ts src/shell/components/FileCard.tsx tests/core/formats.test.ts tests/shell/file-card.test.tsx
git commit -m "feat(formats): add docx/doc to the format registry"
```

---

### Task 2: Dependencies + content-based probing for DOCX/DOC

**Files:**
- Modify: `package.json`
- Create: `src/engines/word.ts`
- Modify: `tests/helpers/fixtures.ts`
- Test: `tests/engines/word-probe.test.ts` (new)

**Interfaces:**
- Consumes: `FormatId` (Task 1), `DocumentInfo` (existing).
- Produces: `export async function probe(path: string): Promise<DocumentInfo>` from `src/engines/word.ts` — Task 7 wires this into the `wordEngine` object and the registry. `makeDocx`, `makeDoc`, `makeNonDocxZip` in `tests/helpers/fixtures.ts` — used by this task and every later word-engine test task.

- [ ] **Step 1: Add every new dependency and install**

In `package.json`, add to `"dependencies"` (alphabetical, matching the existing list's order):

```json
    "adm-zip": "^0.6.0",
    "cfb": "^1.2.2",
    "docx": "^9.7.1",
    "mammoth": "^1.12.1",
    "pdf-parse": "^2.4.5",
    "word-extractor": "^1.0.4",
```

And to `"devDependencies"`:

```json
    "@types/word-extractor": "^1.0.6",
```

Run: `npm install`
Expected: installs cleanly, no native build step for any of the six.

- [ ] **Step 2: Write the failing probe test**

Create `tests/engines/word-probe.test.ts`:

```ts
import { copyFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { probe } from '../../src/engines/word.js'
import {
  makeCorruptFile,
  makeDoc,
  makeDocx,
  makeNonDocxZip,
  makeTempDir,
} from '../helpers/fixtures.js'

describe('word engine probing', () => {
  it('identifies a docx by its content, not its extension', async () => {
    const dir = await makeTempDir()
    const path = await makeDocx(dir, 'report.docx', ['First paragraph.', 'Second paragraph.'])
    const source = await probe(path)
    expect(source.kind).toBe('document')
    expect(source.format).toBe('docx')
  })

  it('reads the cached page count out of docProps/app.xml when present', async () => {
    const dir = await makeTempDir()
    const path = await makeDocx(dir, 'report.docx', ['One page of text.'])
    const source = await probe(path)
    expect(source.pages).toBeGreaterThanOrEqual(1)
  })

  it('rejects a zip that looks like OOXML but is not a Word document', async () => {
    const dir = await makeTempDir()
    const path = await makeNonDocxZip(dir, 'spreadsheet.docx')
    await expect(probe(path)).rejects.toThrow()
  })

  it('rejects plain garbage', async () => {
    const dir = await makeTempDir()
    const path = await makeCorruptFile(dir, 'garbage.docx')
    await expect(probe(path)).rejects.toThrow()
  })

  it('identifies a legacy .doc by its OLE content, reporting an unknown (0) page count', async (ctx) => {
    const dir = await makeTempDir()
    const path = await makeDoc(dir, 'legacy.doc', 'Hello from a legacy Word file.')
    if (path === null) {
      ctx.skip('textutil unavailable — .doc fixture cannot be generated')
      return
    }
    const source = await probe(path)
    expect(source.kind).toBe('document')
    expect(source.format).toBe('doc')
    expect(source.pages).toBe(0)
    expect(source.encrypted).toBe(false)
  })

  it('never trusts the extension — a .doc renamed to .docx is still probed as doc', async (ctx) => {
    const dir = await makeTempDir()
    const realDoc = await makeDoc(dir, 'legacy.doc', 'Some legacy content.')
    if (realDoc === null) {
      ctx.skip('textutil unavailable — .doc fixture cannot be generated')
      return
    }
    const misnamed = join(dir, 'renamed.docx')
    await copyFile(realDoc, misnamed)
    const source = await probe(misnamed)
    expect(source.format).toBe('doc')
  })
})
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npx vitest run tests/engines/word-probe.test.ts`
Expected: FAIL — `src/engines/word.ts` does not exist yet, and the three fixture helpers don't exist yet either.

- [ ] **Step 4: Add the fixture helpers**

In `tests/helpers/fixtures.ts`, add near the top, alongside the existing imports (the file already imports `execFile`/`promisify` as `run`, `readFile`/`writeFile`, `PDFDocument`/`degrees`/`rgb` from `pdf-lib`, and `sharp`):

```ts
import AdmZip from 'adm-zip'
import { Document, Packer, Paragraph } from 'docx'
```

Then add the three helpers, near `makeHeic`/`makeCorruptHeic` (same "shell out to a system tool, return null on failure" shape for `.doc`):

```ts
/** A minimal, valid .docx — built by the `docx` package, never a committed binary. */
export async function makeDocx(
  dir: string,
  name: string,
  paragraphs: string[] = ['Hello from Forge.'],
): Promise<string> {
  const doc = new Document({ sections: [{ children: paragraphs.map((p) => new Paragraph(p)) }] })
  const path = join(dir, name)
  await writeFile(path, await Packer.toBuffer(doc))
  return path
}

/**
 * A genuine legacy-binary .doc, produced by macOS's built-in `textutil` —
 * the same "shell out to a system tool rather than commit a binary" move
 * `makeHeic` already makes for HEIC. Returns null where `textutil` is
 * unavailable so tests can skip cleanly.
 */
export async function makeDoc(dir: string, name: string, text = 'Hello from Forge.'): Promise<string | null> {
  const source = join(dir, `${name}.source.txt`)
  await writeFile(source, text)
  const path = join(dir, name)
  try {
    await run('textutil', ['-convert', 'doc', '-output', path, source])
    return path
  } catch {
    return null
  }
}

/**
 * A zip shaped like OOXML but without `word/document.xml` — the shape a
 * `.xlsx` or `.pptx` would have. Used to prove docx detection is content-based
 * (invariant 3), not "any zip with this extension."
 */
export async function makeNonDocxZip(dir: string, name: string): Promise<string> {
  const zip = new AdmZip()
  zip.addFile('not-a-word-document.txt', Buffer.from('nope'))
  const path = join(dir, name)
  zip.writeZip(path)
  return path
}
```

- [ ] **Step 5: Write `src/engines/word.ts`'s probing half**

```ts
import { readFile } from 'node:fs/promises'
import AdmZip from 'adm-zip'
import { find as cfbFind, parse as cfbParse } from 'cfb'
import type { DocumentInfo } from '../core/types.js'

const OLE_MAGIC = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])

/**
 * A `.doc` is an OLE2 compound file — a container format also used by
 * `.xls`, `.ppt` and `.msi`, so the magic bytes alone are not enough. The
 * `WordDocument` stream is what only a legacy Word document has.
 */
function looksLikeDoc(bytes: Buffer): boolean {
  if (bytes.length < OLE_MAGIC.length || !bytes.subarray(0, OLE_MAGIC.length).equals(OLE_MAGIC)) {
    return false
  }
  try {
    return cfbFind(cfbParse(bytes), 'WordDocument') !== null
  } catch {
    return false
  }
}

interface DocxProbeResult {
  pages: number
}

/**
 * A `.docx` is a zip — `word/document.xml` is the entry only a
 * WordprocessingML document has (`.xlsx` has `xl/workbook.xml`, `.pptx` has
 * `ppt/presentation.xml` — the same container, different content).
 *
 * `docProps/app.xml`'s cached `<Pages>` value, when present, is read with a
 * plain regex rather than a full XML parser — the same light-touch style
 * `heic.ts` already uses for one-off values (`pixelWidth`, `hasAlpha`).
 */
function readDocx(bytes: Buffer): DocxProbeResult | undefined {
  let zip: AdmZip
  try {
    zip = new AdmZip(bytes)
  } catch {
    return undefined
  }
  if (!zip.getEntry('word/document.xml')) return undefined

  let pages = 0
  const appXml = zip.getEntry('docProps/app.xml')
  if (appXml) {
    const match = /<Pages>(\d+)<\/Pages>/.exec(zip.readAsText(appXml))
    if (match?.[1]) pages = Number(match[1])
  }
  return { pages }
}

export async function probe(path: string): Promise<DocumentInfo> {
  const bytes = await readFile(path)

  const docx = readDocx(bytes)
  if (docx) {
    return {
      kind: 'document',
      path,
      format: 'docx',
      bytes: bytes.byteLength,
      pages: docx.pages,
      encrypted: false,
    }
  }

  if (looksLikeDoc(bytes)) {
    return {
      kind: 'document',
      path,
      format: 'doc',
      bytes: bytes.byteLength,
      // A legacy .doc's cached page count lives in the same OLE
      // SummaryInformation stream `word-extractor` would need a second full
      // parse to reach, for a number that is purely decorative in the file
      // card (spec §5) — not attempted.
      pages: 0,
      encrypted: false,
    }
  }

  // Reached only when an earlier engine hasn't already classified this file
  // with a real ForgeError (`registry.ts`'s `probe()` keeps the first one it
  // sees) — the same "defensive, expected to be shadowed" throw
  // `pdfiumEngine.probe()` uses for its own unreachable case.
  throw new Error(`${path} is not a Word document`)
}
```

- [ ] **Step 6: Run the probe test**

Run: `npx vitest run tests/engines/word-probe.test.ts`
Expected: PASS (the two `.doc` tests skip if `textutil` is somehow unavailable, but it ships with every macOS install).

- [ ] **Step 7: Run the full suite to confirm nothing else broke**

Run: `npx vitest run`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json src/engines/word.ts tests/helpers/fixtures.ts tests/engines/word-probe.test.ts
git commit -m "feat(word): add content-based docx/doc probing"
```

---

### Task 3: LibreOffice detection

**Files:**
- Modify: `src/engines/word.ts`
- Test: `tests/engines/word-libreoffice-detect.test.ts` (new)

**Interfaces:**
- Consumes: nothing new.
- Produces: `export async function libreOfficeAvailable(): Promise<string | undefined>` (resolves to the `soffice` binary path, or `undefined`), `export function resetLibreOfficeCache(): void`, and a test-only forcing pair, `forceLibreOfficeForTests`/`stopForcingLibreOfficeForTests`. Task 5's `run()` consumes `libreOfficeAvailable`. Task 6's tests consume `resetLibreOfficeCache`, mirroring `heic.ts`'s `heicDecodable()`/`resetHeicSupportCache()`. **Task 5's tests consume the forcing pair** — without it, whether Task 5's "npm fallback" tests actually exercise the fallback would depend on whether the machine running them happens to have LibreOffice installed, which is exactly the non-determinism a real test suite cannot have (mocking `word.ts` from its own test file cannot intercept `run()`'s in-module call to `libreOfficeAvailable()` — ES module bindings resolve lexically, not through the mock's replaced exports, so a `vi.mock` here would silently do nothing).

- [ ] **Step 1: Write the failing test**

Create `tests/engines/word-libreoffice-detect.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  forceLibreOfficeForTests,
  libreOfficeAvailable,
  resetLibreOfficeCache,
  stopForcingLibreOfficeForTests,
} from '../../src/engines/word.js'

describe('LibreOffice detection', () => {
  it('reports a path or undefined, and never throws', async () => {
    resetLibreOfficeCache()
    const path = await libreOfficeAvailable()
    expect(path === undefined || typeof path === 'string').toBe(true)
  })

  it('caches the result — a second call does not repeat the detection work', async () => {
    resetLibreOfficeCache()
    const first = await libreOfficeAvailable()
    const second = await libreOfficeAvailable()
    expect(second).toBe(first)
  })
})

describe('forcing an answer for tests', () => {
  it('overrides the real detection until stopped', async () => {
    forceLibreOfficeForTests('/fake/soffice')
    try {
      expect(await libreOfficeAvailable()).toBe('/fake/soffice')
      forceLibreOfficeForTests(undefined)
      expect(await libreOfficeAvailable()).toBeUndefined()
    } finally {
      stopForcingLibreOfficeForTests()
    }
  })

  it('restores real detection once stopped', async () => {
    forceLibreOfficeForTests('/fake/soffice')
    stopForcingLibreOfficeForTests()
    resetLibreOfficeCache()
    const real = await libreOfficeAvailable()
    expect(real).not.toBe('/fake/soffice')
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/engines/word-libreoffice-detect.test.ts`
Expected: FAIL — `libreOfficeAvailable`/`resetLibreOfficeCache` don't exist yet.

- [ ] **Step 3: Implement detection**

Add to `src/engines/word.ts`:

```ts
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

/**
 * A Homebrew cask install (`brew install --cask libreoffice`) puts
 * `LibreOffice.app` in `/Applications` but does not add `soffice` to `PATH`
 * — this is the fallback location when the PATH lookup below fails.
 */
const CASK_SOFFICE_PATH = '/Applications/LibreOffice.app/Contents/MacOS/soffice'

async function resolveSofficePath(): Promise<string | undefined> {
  try {
    await execFileAsync('soffice', ['--version'], { timeout: 5000 })
    return 'soffice'
  } catch {
    // Not on PATH — fall through to the fixed cask location.
  }
  try {
    await execFileAsync(CASK_SOFFICE_PATH, ['--version'], { timeout: 5000 })
    return CASK_SOFFICE_PATH
  } catch {
    return undefined
  }
}

let sofficePath: Promise<string | undefined> | undefined

/**
 * Whether LibreOffice's headless CLI is available here, and where. Cached
 * for the process, the same way `heic.ts`'s `heicDecodable()` caches its own
 * one-time shell probe — "install it and try again" naturally picks this up
 * on the next run, so no invalidation logic is needed.
 */
let forcing = false
let forcedValue: string | undefined

export async function libreOfficeAvailable(): Promise<string | undefined> {
  if (forcing) return forcedValue
  sofficePath ??= resolveSofficePath()
  return sofficePath
}

/** Only for tests, which need to exercise both the available and missing paths. */
export function resetLibreOfficeCache(): void {
  sofficePath = undefined
}

/**
 * Only for tests: forces `libreOfficeAvailable()`'s answer regardless of
 * what is actually installed. Needed because `run()`'s two dispatch
 * branches (LibreOffice vs. the npm fallback) must both be covered
 * deterministically — whether this machine happens to have LibreOffice
 * installed cannot be allowed to change which branch a test exercises.
 */
export function forceLibreOfficeForTests(path: string | undefined): void {
  forcing = true
  forcedValue = path
}

/** Only for tests: undoes `forceLibreOfficeForTests`, restoring real detection. */
export function stopForcingLibreOfficeForTests(): void {
  forcing = false
}
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run tests/engines/word-libreoffice-detect.test.ts`
Expected: PASS

- [ ] **Step 5: Run the full suite**

Run: `npx vitest run`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/engines/word.ts tests/engines/word-libreoffice-detect.test.ts
git commit -m "feat(word): detect an available LibreOffice install"
```

---

### Task 4: npm-fallback text extraction and layout

**Files:**
- Modify: `src/engines/word.ts`
- Modify: `tests/helpers/fixtures.ts`
- Test: `tests/engines/word-fallback-text.test.ts` (new)

**Interfaces:**
- Consumes: `DocumentInfo`/`SourceInfo` (existing).
- Produces: `export const PAGE_BREAK: string`, `export async function extractPlainText(source: DocumentInfo): Promise<string[]>`, `export async function layoutAsPdf(paragraphs: string[]): Promise<Uint8Array>`, `export async function buildDocx(paragraphs: string[]): Promise<Buffer>` — all consumed by Task 5's `run()`.

- [ ] **Step 1: Add the `makeTextPdf` fixture helper**

In `tests/helpers/fixtures.ts`, add `StandardFonts` to the existing `pdf-lib` import:

```ts
import { degrees, PDFDocument, rgb, StandardFonts } from 'pdf-lib'
```

Then add, near `makePdf`/`makeMarkedPdf`:

```ts
/** A PDF with real, extractable text on each page — unlike `makePdf`'s blank pages. */
export async function makeTextPdf(dir: string, name: string, pagesOfText: string[]): Promise<string> {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  for (const text of pagesOfText) {
    const page = doc.addPage([595, 842])
    page.drawText(text, { x: 50, y: 780, size: 14, font })
  }
  const path = join(dir, name)
  await writeFile(path, await doc.save())
  return path
}
```

- [ ] **Step 2: Write the failing test**

Create `tests/engines/word-fallback-text.test.ts`:

```ts
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import mammoth from 'mammoth'
import { describe, expect, it } from 'vitest'
import { probe } from '../../src/engines/registry.js'
import {
  buildDocx,
  extractPlainText,
  layoutAsPdf,
  PAGE_BREAK,
} from '../../src/engines/word.js'
import { makeDoc, makeDocx, makeTempDir, makeTextPdf, pdfPageCount } from '../helpers/fixtures.js'

describe('extractPlainText', () => {
  it('pulls paragraphs out of a docx', async () => {
    const dir = await makeTempDir()
    const path = await makeDocx(dir, 'a.docx', ['First paragraph.', 'Second paragraph.'])
    const source = await probe(path)
    if (source.kind !== 'document') throw new Error('expected a document')
    const paragraphs = await extractPlainText(source)
    expect(paragraphs).toContain('First paragraph.')
    expect(paragraphs).toContain('Second paragraph.')
  })

  it('pulls text out of a legacy doc', async (ctx) => {
    const dir = await makeTempDir()
    const path = await makeDoc(dir, 'a.doc', 'Legacy content here.')
    if (path === null) {
      ctx.skip('textutil unavailable — .doc fixture cannot be generated')
      return
    }
    const source = await probe(path)
    if (source.kind !== 'document') throw new Error('expected a document')
    const paragraphs = await extractPlainText(source)
    expect(paragraphs.join(' ')).toContain('Legacy content here.')
  })

  it('separates pdf pages with a page-break marker', async () => {
    const dir = await makeTempDir()
    const path = await makeTextPdf(dir, 'a.pdf', ['Page one text.', 'Page two text.'])
    const source = await probe(path)
    if (source.kind !== 'document') throw new Error('expected a document')
    const paragraphs = await extractPlainText(source)
    const breakIndex = paragraphs.indexOf(PAGE_BREAK)
    expect(breakIndex).toBeGreaterThan(-1)
    expect(paragraphs.slice(0, breakIndex).join(' ')).toContain('Page one text.')
    expect(paragraphs.slice(breakIndex + 1).join(' ')).toContain('Page two text.')
  })
})

describe('layoutAsPdf', () => {
  it('produces a one-page pdf for short text', async () => {
    const dir = await makeTempDir()
    const bytes = await layoutAsPdf(['A short line of text.'])
    const path = join(dir, 'short.pdf')
    await writeFile(path, bytes)
    expect(await pdfPageCount(path)).toBe(1)
  })

  it('paginates long text across more than one page', async () => {
    const dir = await makeTempDir()
    const longParagraph = Array.from({ length: 400 }, () => 'word').join(' ')
    const bytes = await layoutAsPdf([longParagraph])
    const path = join(dir, 'long.pdf')
    await writeFile(path, bytes)
    expect(await pdfPageCount(path)).toBeGreaterThan(1)
  })

  it('starts a new page at an explicit page-break marker', async () => {
    const dir = await makeTempDir()
    const bytes = await layoutAsPdf(['Page one.', PAGE_BREAK, 'Page two.'])
    const path = join(dir, 'two.pdf')
    await writeFile(path, bytes)
    expect(await pdfPageCount(path)).toBe(2)
  })
})

describe('buildDocx', () => {
  it('round-trips paragraph text through mammoth', async () => {
    const buffer = await buildDocx(['First paragraph.', 'Second paragraph.'])
    const { value } = await mammoth.extractRawText({ buffer })
    expect(value).toContain('First paragraph.')
    expect(value).toContain('Second paragraph.')
  })
})
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npx vitest run tests/engines/word-fallback-text.test.ts`
Expected: FAIL — none of `extractPlainText`/`layoutAsPdf`/`buildDocx`/`PAGE_BREAK` exist yet.

- [ ] **Step 4: Implement extraction and layout**

Add to `src/engines/word.ts`:

```ts
import mammoth from 'mammoth'
import { PDFParse } from 'pdf-parse'
import WordExtractor from 'word-extractor'
import { PDFDocument as PDFLibDocument, StandardFonts } from 'pdf-lib'
import { Document as DocxDocument, PageBreak, Packer, Paragraph } from 'docx'
```

(`DocumentInfo` — the only type this step needs — is already imported from Task 2's `import type { DocumentInfo } from '../core/types.js'`; no new type import line is needed here.)

```ts
/**
 * A sentinel paragraph meaning "force a page break here" — how a PDF's own
 * page boundaries survive into the plain-paragraph representation both
 * `layoutAsPdf` and `buildDocx` consume. `\f` (form feed) can never appear
 * in text `extractPlainText`'s own line-splitting produces, since that split
 * already breaks on newlines.
 */
export const PAGE_BREAK = '\f'

function splitParagraphs(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
}

/**
 * Plain paragraphs from any of the three formats this engine reads. The
 * per-format library differs, but the output shape is one flat list of
 * strings (with `PAGE_BREAK` sentinels for a paged source) that
 * `layoutAsPdf`/`buildDocx` can consume without knowing where it came from.
 */
export async function extractPlainText(source: DocumentInfo): Promise<string[]> {
  if (source.format === 'docx') {
    const { value } = await mammoth.extractRawText({ path: source.path })
    return splitParagraphs(value)
  }

  if (source.format === 'doc') {
    const extractor = new WordExtractor()
    const doc = await extractor.extract(source.path)
    return splitParagraphs(doc.getBody())
  }

  // source.format === 'pdf'
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

const PDF_PAGE_WIDTH = 612
const PDF_PAGE_HEIGHT = 792
const PDF_MARGIN = 54
const PDF_FONT_SIZE = 11
const PDF_LINE_HEIGHT = 14

/**
 * Lays plain paragraphs out on US Letter pages with one font, one size, no
 * headings, no lists — deliberately plain (spec §3's "genuinely plain"
 * decision). Word-wrapping measures real glyph widths via pdf-lib's
 * Helvetica metrics rather than guessing a character count per line.
 */
export async function layoutAsPdf(paragraphs: string[]): Promise<Uint8Array> {
  const doc = await PDFLibDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const maxWidth = PDF_PAGE_WIDTH - PDF_MARGIN * 2

  let page = doc.addPage([PDF_PAGE_WIDTH, PDF_PAGE_HEIGHT])
  let y = PDF_PAGE_HEIGHT - PDF_MARGIN

  const newPage = () => {
    page = doc.addPage([PDF_PAGE_WIDTH, PDF_PAGE_HEIGHT])
    y = PDF_PAGE_HEIGHT - PDF_MARGIN
  }

  for (const paragraph of paragraphs) {
    if (paragraph === PAGE_BREAK) {
      newPage()
      continue
    }

    let line = ''
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const candidate = line ? `${line} ${word}` : word
      if (line && font.widthOfTextAtSize(candidate, PDF_FONT_SIZE) > maxWidth) {
        if (y < PDF_MARGIN) newPage()
        page.drawText(line, { x: PDF_MARGIN, y, size: PDF_FONT_SIZE, font })
        y -= PDF_LINE_HEIGHT
        line = word
      } else {
        line = candidate
      }
    }
    if (line) {
      if (y < PDF_MARGIN) newPage()
      page.drawText(line, { x: PDF_MARGIN, y, size: PDF_FONT_SIZE, font })
      y -= PDF_LINE_HEIGHT
    }
  }

  return doc.save()
}

/** One docx paragraph per line, `PAGE_BREAK` sentinels becoming real page breaks. */
export async function buildDocx(paragraphs: string[]): Promise<Buffer> {
  const children = paragraphs.map((p) =>
    p === PAGE_BREAK ? new Paragraph({ children: [new PageBreak()] }) : new Paragraph(p),
  )
  const doc = new DocxDocument({ sections: [{ children }] })
  return Packer.toBuffer(doc)
}
```

Note: `readFile` is already imported at the top of `src/engines/word.ts` from Task 2. `PDFDocument` is aliased to `PDFLibDocument` and `docx`'s `Document` to `DocxDocument` to avoid a name collision between the two packages' identically-named exports in the same file.

- [ ] **Step 5: Run the test**

Run: `npx vitest run tests/engines/word-fallback-text.test.ts`
Expected: PASS

- [ ] **Step 6: Run the full suite**

Run: `npx vitest run`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/engines/word.ts tests/helpers/fixtures.ts tests/engines/word-fallback-text.test.ts
git commit -m "feat(word): add npm-fallback text extraction and layout"
```

---

### Task 5: `wordEngine.run()` — the dispatcher, and the assembled engine

**Files:**
- Modify: `src/engines/word.ts`
- Test: `tests/engines/word-convert.test.ts` (new)

**Interfaces:**
- Consumes: `libreOfficeAvailable`, `forceLibreOfficeForTests`, `stopForcingLibreOfficeForTests` (Task 3), `extractPlainText`/`layoutAsPdf`/`buildDocx`/`PAGE_BREAK` (Task 4), `probe` (Task 2), `writeAtomic` from `core/atomic.js`, `conversionFailed` from `core/errors.js`.
- Produces: `export const wordEngine: Engine` — the first point this plan assembles the full `Engine` object. Task 7 registers it.

- [ ] **Step 1: Write the failing test**

Create `tests/engines/word-convert.test.ts`. These exercise the npm-fallback path only — deterministically, via `forceLibreOfficeForTests(undefined)`, regardless of whether the machine running the suite actually has LibreOffice installed. LibreOffice-path coverage is Task 6.

```ts
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import mammoth from 'mammoth'
import { PDFParse } from 'pdf-parse'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { probe } from '../../src/engines/registry.js'
import {
  forceLibreOfficeForTests,
  stopForcingLibreOfficeForTests,
  wordEngine,
} from '../../src/engines/word.js'
import { makeCorruptFile, makeDoc, makeDocx, makeTempDir, makeTextPdf } from '../helpers/fixtures.js'

describe('wordEngine.run — npm fallback', () => {
  // Forced for every test in this file, so it always exercises the fallback
  // — never the real LibreOffice path, whatever this machine has installed.
  beforeEach(() => {
    forceLibreOfficeForTests(undefined)
  })
  afterEach(() => {
    stopForcingLibreOfficeForTests()
  })

  it('converts docx to pdf', async () => {
    const dir = await makeTempDir()
    const path = await makeDocx(dir, 'report.docx', ['Hello from a docx.'])
    const source = await probe(path)
    const output = join(dir, 'out.pdf')
    const result = await wordEngine.run(
      { op: 'convert', sources: [source], outputs: [output], target: 'pdf', options: { background: '#ffffff', keepMetadata: false } },
      () => {},
    )
    expect(result.outputBytes).toBeGreaterThan(0)
    expect(result.warnings.map((w) => w.code)).toContain('word-basic-fidelity')
    const parser = new PDFParse({ data: await readFile(output) })
    const { text } = await parser.getText()
    await parser.destroy()
    expect(text).toContain('Hello from a docx.')
  })

  it('converts doc to pdf', async (ctx) => {
    const dir = await makeTempDir()
    const path = await makeDoc(dir, 'legacy.doc', 'Hello from a legacy doc.')
    if (path === null) {
      ctx.skip('textutil unavailable — .doc fixture cannot be generated')
      return
    }
    const source = await probe(path)
    const output = join(dir, 'out.pdf')
    const result = await wordEngine.run(
      { op: 'convert', sources: [source], outputs: [output], target: 'pdf', options: { background: '#ffffff', keepMetadata: false } },
      () => {},
    )
    expect(result.outputBytes).toBeGreaterThan(0)
    const parser = new PDFParse({ data: await readFile(output) })
    const { text } = await parser.getText()
    await parser.destroy()
    expect(text).toContain('Hello from a legacy doc.')
  })

  it('converts pdf to docx', async () => {
    const dir = await makeTempDir()
    const path = await makeTextPdf(dir, 'report.pdf', ['Hello from a pdf.'])
    const source = await probe(path)
    const output = join(dir, 'out.docx')
    const result = await wordEngine.run(
      { op: 'convert', sources: [source], outputs: [output], target: 'docx', options: { background: '#ffffff', keepMetadata: false } },
      () => {},
    )
    expect(result.outputBytes).toBeGreaterThan(0)
    const { value } = await mammoth.extractRawText({ path: output })
    expect(value).toContain('Hello from a pdf.')
  })

  it('converts docx to docx (the CLI\'s own-format recompress path)', async () => {
    const dir = await makeTempDir()
    const path = await makeDocx(dir, 'a.docx', ['Round trip text.'])
    const source = await probe(path)
    const output = join(dir, 'out.docx')
    const result = await wordEngine.run(
      { op: 'convert', sources: [source], outputs: [output], target: 'docx', options: { background: '#ffffff', keepMetadata: false } },
      () => {},
    )
    expect(result.outputBytes).toBeGreaterThan(0)
    const { value } = await mammoth.extractRawText({ path: output })
    expect(value).toContain('Round trip text.')
  })

  it('reports conversion-failed for a corrupt docx rather than a raw throw', async () => {
    const dir = await makeTempDir()
    const path = await makeCorruptFile(dir, 'bad.docx')
    const source = {
      kind: 'document' as const,
      path,
      format: 'docx' as const,
      bytes: 10,
      pages: 0,
      encrypted: false,
    }
    const output = join(dir, 'out.pdf')
    await expect(
      wordEngine.run(
        { op: 'convert', sources: [source], outputs: [output], target: 'pdf', options: { background: '#ffffff', keepMetadata: false } },
        () => {},
      ),
    ).rejects.toMatchObject({ code: 'conversion-failed' })
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/engines/word-convert.test.ts`
Expected: FAIL — `wordEngine` doesn't exist yet.

- [ ] **Step 3: Implement `run()` and assemble `wordEngine`**

First, extend two import lines that already exist in the file rather than adding duplicates of the same module:

- Task 2's `import { readFile } from 'node:fs/promises'` becomes
  `import { mkdtemp, readFile, rm } from 'node:fs/promises'`.
- Task 2's `import type { DocumentInfo } from '../core/types.js'` becomes
  `import type { DocumentInfo, FormatId, Job, Progress, Result, Warning } from '../core/types.js'`.

Then add these new import lines alongside the others at the top of the file:

```ts
import { tmpdir } from 'node:os'
import { basename, extname, join } from 'node:path'
import { writeAtomic } from '../core/atomic.js'
import { conversionFailed } from '../core/errors.js'
import type { Engine } from './types.js'
```

Then add the rest of the implementation:

```ts
const READS: ReadonlySet<FormatId> = new Set<FormatId>(['docx', 'doc', 'pdf'])
const WRITES: ReadonlySet<FormatId> = new Set<FormatId>(['docx', 'pdf'])
const OPS: ReadonlySet<Job['op']> = new Set<Job['op']>(['convert'])

const BASIC_FIDELITY_WARNING: Warning = {
  code: 'word-basic-fidelity',
  message:
    "Converted with basic formatting only — tables, images, and complex layouts weren't preserved. " +
    'Install LibreOffice for full-fidelity conversion: brew install --cask libreoffice',
}

/**
 * Shells out to LibreOffice's headless converter. `--convert-to` takes the
 * extension name directly — 'pdf' and 'docx' both are exactly that, so no
 * mapping from `FormatId` is needed. LibreOffice names its own output after
 * the input's basename, which is why the produced file has to be found
 * rather than assumed to already be at `job.outputs[0]`.
 */
async function runSoffice(soffice: string, sourcePath: string, target: FormatId): Promise<Buffer> {
  const outDir = await mkdtemp(join(tmpdir(), 'forge-word-'))
  try {
    await execFileAsync(
      soffice,
      ['--headless', '--convert-to', target, '--outdir', outDir, sourcePath],
      { timeout: 120_000 },
    )
    const stem = basename(sourcePath, extname(sourcePath))
    return await readFile(join(outDir, `${stem}.${target}`))
  } finally {
    await rm(outDir, { recursive: true, force: true })
  }
}

async function run(job: Job, onPhase: (p: Progress) => void): Promise<Result> {
  if (job.op !== 'convert') throw new Error(`the word engine cannot ${job.op}`)
  const source = job.sources[0]
  if (source.kind !== 'document') {
    throw new Error('the word engine can only convert a document source')
  }

  onPhase({ phase: 'reading' })
  const soffice = await libreOfficeAvailable()

  onPhase({ phase: 'encoding' })
  const warnings: Warning[] = []
  let bytes: Uint8Array
  try {
    if (soffice !== undefined) {
      bytes = await runSoffice(soffice, source.path, job.target)
    } else {
      const paragraphs = await extractPlainText(source)
      bytes = job.target === 'pdf' ? await layoutAsPdf(paragraphs) : await buildDocx(paragraphs)
      warnings.push(BASIC_FIDELITY_WARNING)
    }
  } catch (e) {
    // A failed soffice invocation and a failed npm-fallback parse are both
    // real conversion failures, not a signal to silently retry the other
    // path — the spec's decision (§3) is that only "not installed at all"
    // routes to the fallback, never a per-file failure.
    throw conversionFailed(source.path, e)
  }

  onPhase({ phase: 'writing' })
  const outputBytes = await writeAtomic(job.outputs[0], bytes)
  return { job, outputBytes, warnings }
}

export const wordEngine: Engine = {
  id: 'word',
  reads: READS,
  writes: WRITES,
  ops: OPS,
  probe,
  run,
}
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run tests/engines/word-convert.test.ts`
Expected: PASS

- [ ] **Step 5: Run the full suite**

Run: `npx vitest run`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/engines/word.ts tests/engines/word-convert.test.ts
git commit -m "feat(word): implement wordEngine.run with LibreOffice/npm dispatch"
```

---

### Task 6: LibreOffice-path tests

**Files:**
- Test: `tests/engines/word-libreoffice-convert.test.ts` (new)

**Interfaces:**
- Consumes: `wordEngine` (Task 5), `libreOfficeAvailable` (Task 3) — no production code changes in this task.

- [ ] **Step 1: Write the tests**

These run for real against `soffice` when it's installed, and skip with a clear message otherwise (the exact pattern `heic.test.ts` uses for `sips`). This machine does not have LibreOffice installed, so expect these to report as skipped locally; they exist for CI environments or contributors that do have it.

Create `tests/engines/word-libreoffice-convert.test.ts`:

```ts
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { PDFParse } from 'pdf-parse'
import { describe, expect, it } from 'vitest'
import { probe } from '../../src/engines/registry.js'
import { libreOfficeAvailable, wordEngine } from '../../src/engines/word.js'
import { makeCorruptFile, makeDoc, makeDocx, makeTempDir, makeTextPdf } from '../helpers/fixtures.js'

async function requireLibreOffice(ctx: { skip: (reason: string) => void }) {
  const soffice = await libreOfficeAvailable()
  if (soffice === undefined) {
    ctx.skip('LibreOffice unavailable on this machine')
    return undefined
  }
  return soffice
}

describe('wordEngine.run — LibreOffice path', () => {
  it('converts docx to pdf with no basic-fidelity warning', async (ctx) => {
    if ((await requireLibreOffice(ctx)) === undefined) return
    const dir = await makeTempDir()
    const path = await makeDocx(dir, 'report.docx', ['Hello from LibreOffice.'])
    const source = await probe(path)
    const output = join(dir, 'out.pdf')
    const result = await wordEngine.run(
      { op: 'convert', sources: [source], outputs: [output], target: 'pdf', options: { background: '#ffffff', keepMetadata: false } },
      () => {},
    )
    expect(result.outputBytes).toBeGreaterThan(0)
    expect(result.warnings).toEqual([])
    const parser = new PDFParse({ data: await readFile(output) })
    const { text } = await parser.getText()
    await parser.destroy()
    expect(text).toContain('Hello from LibreOffice.')
  }, 30_000)

  it('converts doc to pdf', async (ctx) => {
    if ((await requireLibreOffice(ctx)) === undefined) return
    const dir = await makeTempDir()
    const path = await makeDoc(dir, 'legacy.doc', 'Hello from a legacy doc, via LibreOffice.')
    if (path === null) {
      ctx.skip('textutil unavailable — .doc fixture cannot be generated')
      return
    }
    const source = await probe(path)
    const output = join(dir, 'out.pdf')
    const result = await wordEngine.run(
      { op: 'convert', sources: [source], outputs: [output], target: 'pdf', options: { background: '#ffffff', keepMetadata: false } },
      () => {},
    )
    expect(result.outputBytes).toBeGreaterThan(0)
    expect(result.warnings).toEqual([])
  }, 30_000)

  it('converts pdf to docx', async (ctx) => {
    if ((await requireLibreOffice(ctx)) === undefined) return
    const dir = await makeTempDir()
    const path = await makeTextPdf(dir, 'report.pdf', ['Hello from a pdf, via LibreOffice.'])
    const source = await probe(path)
    const output = join(dir, 'out.docx')
    const result = await wordEngine.run(
      { op: 'convert', sources: [source], outputs: [output], target: 'docx', options: { background: '#ffffff', keepMetadata: false } },
      () => {},
    )
    expect(result.outputBytes).toBeGreaterThan(0)
    expect(result.warnings).toEqual([])
  }, 30_000)

  it('reports conversion-failed for a corrupt docx rather than silently degrading', async (ctx) => {
    if ((await requireLibreOffice(ctx)) === undefined) return
    const dir = await makeTempDir()
    const path = await makeCorruptFile(dir, 'bad.docx')
    const source = {
      kind: 'document' as const,
      path,
      format: 'docx' as const,
      bytes: 10,
      pages: 0,
      encrypted: false,
    }
    const output = join(dir, 'out.pdf')
    await expect(
      wordEngine.run(
        { op: 'convert', sources: [source], outputs: [output], target: 'pdf', options: { background: '#ffffff', keepMetadata: false } },
        () => {},
      ),
    ).rejects.toMatchObject({ code: 'conversion-failed' })
  }, 30_000)
})
```

- [ ] **Step 2: Run it**

Run: `npx vitest run tests/engines/word-libreoffice-convert.test.ts`
Expected: every test reports skipped (this machine has no LibreOffice) — none FAIL.

- [ ] **Step 3: Run the full suite**

Run: `npx vitest run`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add tests/engines/word-libreoffice-convert.test.ts
git commit -m "test(word): add LibreOffice-path coverage, skipped when unavailable"
```

---

### Task 7: Registry wiring

**Files:**
- Modify: `src/engines/registry.ts`
- Modify: `tests/engines/routing.test.ts`

**Interfaces:**
- Consumes: `wordEngine` (Task 5).
- Produces: `wordEngine` reachable through `probe()`, `engineForSource`, `engineForTarget`, `engineForJob` — every later consumer of the capability graph (Task 8, Task 9) relies on this.

- [ ] **Step 1: Write the failing routing tests**

Add to `tests/engines/routing.test.ts` (after the existing `doc`/`png` fixtures at the top, add a third):

```ts
const docx: DocumentInfo = {
  kind: 'document',
  path: '/tmp/a.docx',
  format: 'docx',
  bytes: 1,
  pages: 1,
  encrypted: false,
}
```

Then add a new `describe` block at the end of the file:

```ts
describe('engineForJob routes docx/doc conversions to the word engine', () => {
  it('sends docx -> pdf to the word engine', () => {
    const job: Job = {
      op: 'convert',
      sources: [docx],
      outputs: ['/tmp/a.pdf'],
      target: 'pdf',
      options,
    }
    expect(engineForJob(job)?.id).toBe('word')
  })

  it('sends pdf -> docx to the word engine, not the pdf engine', () => {
    const job: Job = {
      op: 'convert',
      sources: [doc],
      outputs: ['/tmp/a.docx'],
      target: 'docx',
      options,
    }
    expect(engineForJob(job)?.id).toBe('word')
  })

  it('still sends pdf -> pdf (recompression) to the pdf engine, not the word engine', () => {
    const job: Job = {
      op: 'convert',
      sources: [doc],
      outputs: ['/tmp/a.pdf'],
      target: 'pdf',
      options,
    }
    expect(engineForJob(job)?.id).toBe('pdf')
  })

  it('offers doc -> docx for free, from reading doc and writing docx', () => {
    const legacyDoc: DocumentInfo = { ...doc, path: '/tmp/a.doc', format: 'doc' }
    const job: Job = {
      op: 'convert',
      sources: [legacyDoc],
      outputs: ['/tmp/a.docx'],
      target: 'docx',
      options,
    }
    expect(engineForJob(job)?.id).toBe('word')
  })
})
```

At the top of the file, extend the type import: `import type { DocumentInfo, ImageInfo, Job } from '../../src/core/types.js'` (it already imports `DocumentInfo`, so only the new `docx` constant above is new).

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/engines/routing.test.ts`
Expected: FAIL — `wordEngine` is not yet in `ENGINES`, so `engineForJob` finds no match for the first two cases.

- [ ] **Step 3: Register `wordEngine`**

In `src/engines/registry.ts`, change:

```ts
import { isForgeError } from '../core/errors.js'
import type { FormatId, Job, SourceInfo } from '../core/types.js'
import { imageEngine } from './image.js'
import { pdfEngine } from './pdf.js'
import { pdfiumEngine } from './pdfium.js'
import type { Engine } from './types.js'

// Order matters: imageEngine declines a PDF quickly, pdfEngine probes it
// successfully, and pdfiumEngine never probes — it must stay last.
export const ENGINES: Engine[] = [imageEngine, pdfEngine, pdfiumEngine]
```

to:

```ts
import { isForgeError } from '../core/errors.js'
import type { FormatId, Job, SourceInfo } from '../core/types.js'
import { imageEngine } from './image.js'
import { pdfEngine } from './pdf.js'
import { pdfiumEngine } from './pdfium.js'
import type { Engine } from './types.js'
import { wordEngine } from './word.js'

/**
 * Order matters. `imageEngine` declines a PDF/docx/doc quickly, `pdfEngine`
 * probes a real PDF successfully, `wordEngine` probes a docx/doc, and
 * `pdfiumEngine` never probes at all — it must stay last.
 *
 * `pdfEngine` and `wordEngine` both declare `pdf` in `reads`/`writes` (the
 * latter needs to, to route `docx → pdf` and `doc → pdf` — see
 * `word.ts`), so `pdf → pdf` recompression could in principle match either.
 * `engineForJob` takes the first match, and `pdfEngine` is listed first, so
 * that ambiguity always resolves the same way it did before `wordEngine`
 * existed.
 */
export const ENGINES: Engine[] = [imageEngine, pdfEngine, wordEngine, pdfiumEngine]
```

- [ ] **Step 4: Run the routing test**

Run: `npx vitest run tests/engines/routing.test.ts`
Expected: PASS

- [ ] **Step 5: Run the full suite**

Run: `npx vitest run`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/engines/registry.ts tests/engines/routing.test.ts
git commit -m "feat(word): register the word engine"
```

---

### Task 8: Fix `convert.ts`'s rasterisation guard

**Files:**
- Modify: `src/core/capabilities.ts`
- Modify: `src/cli/execute.ts`
- Modify: `src/core/actions/convert.ts`
- Test: `tests/core/actions.test.ts`

**Interfaces:**
- Consumes: `pdfiumEngine` (existing).
- Produces: `export function rasterises(target: FormatId): boolean` from `core/capabilities.js`, replacing the private copy that used to live in `cli/execute.ts`.

- [ ] **Step 1: Write the failing test**

Add to `tests/core/actions.test.ts`, inside a new `describe` block (this file already has a `source()` factory for images and inline `doc` objects for documents — add a small `docx` document factory alongside them):

```ts
describe('convert action stays document-target-aware, not just document-kind-aware', () => {
  const pdfSource = {
    kind: 'document' as const,
    path: '/Users/me/report.pdf',
    format: 'pdf' as const,
    bytes: 1000,
    pages: 3,
    encrypted: false,
  }
  const docxSource = {
    kind: 'document' as const,
    path: '/Users/me/report.docx',
    format: 'docx' as const,
    bytes: 1000,
    pages: 3,
    encrypted: false,
  }

  it('still offers pages/dpi when a pdf targets an image (a real rasterisation)', () => {
    const specs = convertAction.options([pdfSource], { target: 'jpeg' }, DEFAULT_PREFERENCES)
    expect(specs.some((s) => s.id === 'pages')).toBe(true)
    expect(specs.some((s) => s.id === 'dpi')).toBe(true)
  })

  it('does not offer pages/dpi when a pdf targets docx — not a rasterisation', () => {
    const specs = convertAction.options([pdfSource], { target: 'docx' }, DEFAULT_PREFERENCES)
    expect(specs.some((s) => s.id === 'pages')).toBe(false)
    expect(specs.some((s) => s.id === 'dpi')).toBe(false)
  })

  it('does not offer pages/dpi for a docx source at all', () => {
    const specs = convertAction.options([docxSource], { target: 'pdf' }, DEFAULT_PREFERENCES)
    expect(specs.some((s) => s.id === 'pages')).toBe(false)
    expect(specs.some((s) => s.id === 'dpi')).toBe(false)
  })

  it('plans a single-output job for pdf -> docx, not a per-page raster job', () => {
    const [job] = convertAction.plan([pdfSource], { target: 'docx', destination: '/out' })
    if (job?.op !== 'convert') throw new Error('expected convert')
    expect(job.outputs).toEqual(['/out/report.docx'])
    expect(job.options.pages).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/core/actions.test.ts`
Expected: FAIL — the second, third, and fourth new tests fail, because `convert.ts` currently offers pages/dpi (and a per-page-named output) for *any* document source regardless of target.

- [ ] **Step 3: Export `rasterises` from `core/capabilities.ts`**

In `src/core/capabilities.ts`, add the import and the function:

```ts
import { pdfiumEngine } from '../engines/pdfium.js'
```

(alongside the existing `import { ENGINES } from '../engines/registry.js'`), then add at the end of the file:

```ts
/**
 * Whether a `convert` job targeting this format is a rasterisation — a
 * document source becoming pixels — versus a document-to-document
 * conversion (pdf/docx/doc). Read from pdfium's own declared `writes`
 * rather than a hardcoded `['jpeg', 'png']` (invariant 2): the only engine
 * that turns a page into an image is `pdfiumEngine`, so whatever it writes
 * *is* the definition of "rasterises."
 */
export function rasterises(target: FormatId): boolean {
  return pdfiumEngine.writes.has(target)
}
```

- [ ] **Step 4: Use it in `convert.ts`**

In `src/core/actions/convert.ts`, add `rasterises` to the existing capabilities import:

```ts
import { rasterises, targetsFor } from '../capabilities.js'
```

Then find, in `options()`:

```ts
    // A document's only real targets are jpeg and png (`targetSelect`
    // already filters 'pdf' out as a no-op), so reaching here with a chosen
    // target means a rasterisation, and it needs to know which pages and at
    // what resolution.
    if (source.kind === 'document') {
      specs.push(pagesSelect(source), dpiSelect())
    }
```

and change it to:

```ts
    // A document source only needs the pages/resolution pickers when the
    // chosen target actually rasterises it (jpeg/png, via pdfium) — a
    // target of pdf/docx/doc is a document-to-document conversion with no
    // pages or dpi concept at all.
    if (source.kind === 'document' && rasterises(target as FormatId)) {
      specs.push(pagesSelect(source), dpiSelect())
    }
```

Then find, in `plan()`:

```ts
    // A document source rasterises to one image per selected page rather
    // than one output for the whole source — `resolveOutputPath` below
    // assumes exactly the latter, so this branches before it rather than
    // trying to bend that function to a shape it was never built for.
    if (source.kind === 'document') {
```

and change it to:

```ts
    // A document source rasterises to one image per selected page rather
    // than one output for the whole source — `resolveOutputPath` below
    // assumes exactly the latter, so this branches before it rather than
    // trying to bend that function to a shape it was never built for. Only
    // true when the target actually rasterises (jpeg/png); pdf/docx/doc
    // fall through to the single-output path below like any other format.
    if (source.kind === 'document' && rasterises(target)) {
```

- [ ] **Step 5: Remove the now-duplicated `rasterises` from `cli/execute.ts`**

In `src/cli/execute.ts`, change the import:

```ts
import { openPdf, pdfiumEngine } from '../engines/pdfium.js'
```

to:

```ts
import { openPdf } from '../engines/pdfium.js'
```

and add `rasterises` to the existing import (there is currently no `core/capabilities.js` import in this file — add one):

```ts
import { rasterises } from '../core/capabilities.js'
```

Then delete the now-redundant local function:

```ts
/**
 * Whether a document source's `convert` job belongs to `pdfiumEngine` at all.
 * Read from the engine's own declared `writes`, not a hardcoded `['jpeg',
 * 'png']` — invariant 2. A document source targeting something pdfium does
 * not write (`--to pdf`, say) is left for `buildPlan`'s existing path, which
 * already reports `unsupportedTarget` or routes to whatever engine applies —
 * unchanged by this phase.
 */
function rasterises(target: FormatId): boolean {
  return pdfiumEngine.writes.has(target)
}
```

(delete this whole block — every call site further down in the file already calls `rasterises(...)`, and now resolves to the imported one instead.)

- [ ] **Step 6: Run the typecheck and the tests**

Run: `npm run typecheck && npx vitest run tests/core/actions.test.ts`
Expected: PASS

- [ ] **Step 7: Run the full suite**

Run: `npx vitest run`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add src/core/capabilities.ts src/cli/execute.ts src/core/actions/convert.ts tests/core/actions.test.ts
git commit -m "fix(convert): gate the pages/dpi pickers on the target, not just the source kind"
```

---

### Task 9: Fix the page-operation actions to stay PDF-only

**Files:**
- Modify: `src/core/actions/merge.ts`
- Modify: `src/core/actions/split.ts`
- Modify: `src/core/actions/extract.ts`
- Modify: `src/core/actions/rotate.ts`
- Test: `tests/core/actions-pages.test.ts`
- Test: `tests/core/actions-compress.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: nothing new — `mergeAction`/`splitAction`/`extractAction`/`deleteAction`/`rotateAction` keep their existing signatures; only their `appliesTo` behaviour narrows. `compressAction` needs no code change at all (confirmed by this task's last test) — it already reads `document?.images?.compressible ?? 0`, and Task 2's `word.ts` probe never sets `images`, so a docx/doc source already reads as "nothing to compress."

- [ ] **Step 1: Write the failing test**

Add to `tests/core/actions-pages.test.ts`, after the existing `doc`/`image` fixtures:

```ts
const docx: DocumentInfo = {
  kind: 'document',
  path: '/tmp/a.docx',
  format: 'docx',
  bytes: 1000,
  pages: 3,
  encrypted: false,
}
```

Then add a new test inside the existing `describe('appliesTo', ...)` block:

```ts
  it('never offers a page operation on a docx — those stay pdf-only', () => {
    expect(mergeAction.appliesTo([docx, docx])).toBe(false)
    for (const action of [splitAction, extractAction, deleteAction, rotateAction]) {
      expect(action.appliesTo([docx])).toBe(false)
    }
  })
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/core/actions-pages.test.ts`
Expected: FAIL — every one of these currently checks only `kind === 'document'`, so a docx passes.

- [ ] **Step 3: Fix `merge.ts`**

In `src/core/actions/merge.ts`, change:

```ts
const documents = (sources: SourceInfo[]) => sources.filter((s) => s.kind === 'document')
```

to:

```ts
// Page operations are pdf-only — a docx/doc has no fixed page tree to
// merge, split, extract from, delete from, or rotate.
const documents = (sources: SourceInfo[]) =>
  sources.filter((s) => s.kind === 'document' && s.format === 'pdf')
```

- [ ] **Step 4: Fix `split.ts`**

In `src/core/actions/split.ts`, change:

```ts
const soleDocument = (sources: SourceInfo[]): DocumentInfo | undefined =>
  sources.length === 1 && sources[0]?.kind === 'document' ? sources[0] : undefined
```

to:

```ts
// Page operations are pdf-only — see merge.ts's identical comment.
const soleDocument = (sources: SourceInfo[]): DocumentInfo | undefined =>
  sources.length === 1 && sources[0]?.kind === 'document' && sources[0].format === 'pdf'
    ? sources[0]
    : undefined
```

- [ ] **Step 5: Fix `extract.ts`**

In `src/core/actions/extract.ts`, apply the identical change to its own `soleDocument`:

```ts
// Page operations are pdf-only — see merge.ts's identical comment.
const soleDocument = (sources: SourceInfo[]): DocumentInfo | undefined =>
  sources.length === 1 && sources[0]?.kind === 'document' && sources[0].format === 'pdf'
    ? sources[0]
    : undefined
```

- [ ] **Step 6: Fix `rotate.ts`**

In `src/core/actions/rotate.ts`, apply the identical change to its own `soleDocument`:

```ts
// Page operations are pdf-only — see merge.ts's identical comment.
const soleDocument = (sources: SourceInfo[]): DocumentInfo | undefined =>
  sources.length === 1 && sources[0]?.kind === 'document' && sources[0].format === 'pdf'
    ? sources[0]
    : undefined
```

- [ ] **Step 7: Run the test**

Run: `npx vitest run tests/core/actions-pages.test.ts`
Expected: PASS

- [ ] **Step 8: Confirm compress already excludes docx, with no code change needed**

Add to `tests/core/actions-compress.test.ts`, inside the existing `describe('compress action', ...)` block:

```ts
  it('does not apply to a docx/doc source either — there is nothing to re-encode', () => {
    const docx: DocumentInfo = {
      kind: 'document',
      path: '/Users/me/report.docx',
      format: 'docx',
      bytes: 50_000,
      pages: 3,
      encrypted: false,
    }
    expect(compressAction.appliesTo([docx])).toBe(false)
  })
```

Run: `npx vitest run tests/core/actions-compress.test.ts`
Expected: PASS immediately — this test documents existing, already-correct behaviour (see this task's Interfaces note), so no production code changes here.

- [ ] **Step 9: Run the full suite**

Run: `npx vitest run`
Expected: PASS

- [ ] **Step 10: Commit**

```bash
git add src/core/actions/merge.ts src/core/actions/split.ts src/core/actions/extract.ts src/core/actions/rotate.ts tests/core/actions-pages.test.ts tests/core/actions-compress.test.ts
git commit -m "fix(pages): keep merge/split/extract/delete/rotate pdf-only"
```

---

### Task 10: README, full verification, and a manual CLI smoke test

**Files:**
- Modify: `README.md`

**Interfaces:**
- Consumes: everything above.
- Produces: nothing new — this is the wrap-up task.

- [ ] **Step 1: Update the README's format list**

In `README.md`, find:

```
Version 0.1 converts images: JPEG, PNG, WebP, AVIF, GIF, TIFF, and reads
HEIC. It runs correctly, not just fast — auto-orienting phone photos,
```

Change to:

```
Version 0.1 converts images: JPEG, PNG, WebP, AVIF, GIF, TIFF, and reads
HEIC. It also converts between PDF and Word documents (DOCX both ways, DOC
one way in) — install [LibreOffice](https://www.libreoffice.org/) for
full-fidelity results; without it, Forge still converts, using a plain-text
fallback and a note in the result saying so. It runs correctly, not just
fast — auto-orienting phone photos,
```

- [ ] **Step 2: Run the full check sequence**

Run: `npm run lint && npm run typecheck && npx vitest run`
Expected: all PASS.

- [ ] **Step 3: Build and smoke-test the CLI manually**

```bash
npm run build
chmod +x dist/index.js
```

Then, in the project directory, using files you create for this check (not committed):

```bash
echo "Hello from a manual smoke test." > /tmp/smoke.txt
textutil -convert docx -output /tmp/smoke.docx /tmp/smoke.txt
node dist/index.js /tmp/smoke.docx --to pdf --output /tmp/
node dist/index.js /tmp/smoke.pdf --to docx --output /tmp/
```

Expected: both commands print a `✓ converted` line (§9's success-output format) with a real byte count, and `/tmp/smoke.pdf` / a second `.docx` both exist and are non-empty. Since this machine has no LibreOffice installed, both results should also print the `word-basic-fidelity` warning line. Confirm the warning text matches what Task 5 wrote, and that opening `/tmp/smoke.pdf` (e.g. `open /tmp/smoke.pdf`) shows the smoke-test sentence as real, selectable text — not a blank page.

- [ ] **Step 4: Commit the README change**

```bash
git add README.md
git commit -m "docs: mention PDF/Word conversion and the LibreOffice fidelity note"
```
