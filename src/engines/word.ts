import { readFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import AdmZip from 'adm-zip'
import { find as cfbFind, parse as cfbParse } from 'cfb'
import { Document as DocxDocument, PageBreak, Packer, Paragraph } from 'docx'
import mammoth from 'mammoth'
import { PDFDocument as PDFLibDocument, StandardFonts } from 'pdf-lib'
import { PDFParse } from 'pdf-parse'
import WordExtractor from 'word-extractor'
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

let resolveCallCountForTests = 0

async function resolveSofficePath(): Promise<string | undefined> {
  resolveCallCountForTests++
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
let forcing = false
let forcedValue: string | undefined

/**
 * Whether LibreOffice's headless CLI is available here, and where. Cached
 * for the process, the same way `heic.ts`'s `heicDecodable()` caches its own
 * one-time shell probe — "install it and try again" naturally picks this up
 * on the next run, so no invalidation logic is needed.
 */
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

/** Only for tests: counts real (uncached, unforced) detection attempts, to prove caching actually avoids repeat work. */
export function getResolveCallCountForTests(): number {
  return resolveCallCountForTests
}

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
