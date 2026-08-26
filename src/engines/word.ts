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
