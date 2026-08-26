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
  probe as probeWordDocument,
} from '../../src/engines/word.js'
import { makeDoc, makeDocx, makeTempDir, makeTextPdf, pdfPageCount } from '../helpers/fixtures.js'

describe('extractPlainText', () => {
  it('pulls paragraphs out of a docx', async () => {
    const dir = await makeTempDir()
    const path = await makeDocx(dir, 'a.docx', ['First paragraph.', 'Second paragraph.'])
    const source = await probeWordDocument(path)
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
    const source = await probeWordDocument(path)
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
    const longParagraph = Array.from({ length: 1200 }, () => 'word').join(' ')
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
