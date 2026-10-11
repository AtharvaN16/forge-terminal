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
      {
        op: 'convert',
        sources: [source],
        outputs: [output],
        target: 'docx',
        options: { background: '#ffffff', keepMetadata: false },
      },
      () => {},
    )
    const { value } = await mammoth.extractRawText({ path: output })
    expect(value).toContain('日本語のテキストです')
    expect(value).toContain('한국어 텍스트')
  })
})
