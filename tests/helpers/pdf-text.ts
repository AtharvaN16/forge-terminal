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
