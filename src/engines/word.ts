import { readFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import AdmZip from 'adm-zip'
import { find as cfbFind, parse as cfbParse } from 'cfb'
import type { DocumentInfo } from '../core/types.js'

const execFileAsync = promisify(execFile)

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
  // One try/catch around the whole read, matching `looksLikeDoc` above:
  // `adm-zip` only validates the fixed-size End Of Central Directory record
  // at construction — it defers parsing the central directory itself to the
  // first `getEntry()`/`getEntries()` call, so a zip-shaped-but-corrupted
  // file can throw from `getEntry` or `readAsText` just as easily as from
  // `new AdmZip()`.
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
