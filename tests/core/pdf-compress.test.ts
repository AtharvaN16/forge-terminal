import { readFile } from 'node:fs/promises'
import { PDFDocument, PDFName, PDFRawStream } from 'pdf-lib'
import { describe, expect, it } from 'vitest'
import { compressPdf, surveyPdfImages } from '../../src/core/pdf-compress.js'
import { probe } from '../../src/engines/registry.js'
import { makePdf, makeScannedPdf, makeTempDir } from '../helpers/fixtures.js'

/** The PDF filter each image object is stored under, in document order. */
async function filtersIn(path: string): Promise<string[]> {
  const doc = await PDFDocument.load(await readFile(path))
  const out: string[] = []
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFRawStream)) continue
    if (obj.dict.get(PDFName.of('Subtype'))?.toString() !== '/Image') continue
    out.push(String(obj.dict.get(PDFName.of('Filter'))))
  }
  return out
}

describe('the scanned-PDF fixture is what it claims to be', () => {
  // Guarding the fixture before trusting any result measured with it. A
  // fixture that quietly embedded nothing, or embedded a flat colour, would
  // make every compression assertion below pass against no compression at
  // all — which is exactly how this project shipped a page-order bug once.
  it('embeds a JPEG as /DCTDecode', async () => {
    const dir = await makeTempDir()
    expect(await filtersIn(await makeScannedPdf(dir, 'scan.pdf'))).toEqual(['/DCTDecode'])
  })

  it('embeds a PNG as /FlateDecode', async () => {
    const dir = await makeTempDir()
    const p = await makeScannedPdf(dir, 'shot.pdf', { filter: 'png' })
    expect(await filtersIn(p)).toEqual(['/FlateDecode'])
  })

  it('is photographic, not a flat fill that would compress for free', async () => {
    const dir = await makeTempDir()
    const p = await makeScannedPdf(dir, 'scan.pdf')
    // A flat fill lands in a few hundred bytes at q95; noise cannot.
    expect((await readFile(p)).byteLength).toBeGreaterThan(50_000)
  })
})

describe('surveying what can be compressed', () => {
  it('counts JPEG images as compressible', async () => {
    const dir = await makeTempDir()
    const bytes = await readFile(await makeScannedPdf(dir, 'scan.pdf'))
    const survey = await surveyPdfImages(bytes)
    expect(survey.compressible).toBe(1)
    expect(survey.skipped).toBe(0)
  })

  it('counts a Flate image as present but skipped, not as absent', async () => {
    // The distinction matters to the user: "nothing to compress" and "this
    // PDF's images are a kind I cannot re-encode" are different answers.
    const dir = await makeTempDir()
    const bytes = await readFile(await makeScannedPdf(dir, 'shot.pdf', { filter: 'png' }))
    const survey = await surveyPdfImages(bytes)
    expect(survey.compressible).toBe(0)
    expect(survey.skipped).toBe(1)
  })

  it('reports a text-only PDF as having no images at all', async () => {
    const dir = await makeTempDir()
    const bytes = await readFile(await makePdf(dir, 'text.pdf', 4))
    const survey = await surveyPdfImages(bytes)
    expect(survey.compressible).toBe(0)
    expect(survey.skipped).toBe(0)
  })
})

describe('compressing a PDF', () => {
  it('makes a scanned PDF substantially smaller', async () => {
    const dir = await makeTempDir()
    const original = await readFile(await makeScannedPdf(dir, 'scan.pdf', { pages: 4 }))
    const out = await compressPdf(original, 30)
    expect(out.bytes.byteLength).toBeLessThan(original.byteLength * 0.6)
    expect(out.recompressed).toBe(1)
    expect(out.skipped).toBe(0)
  })

  it('gets smaller as the quality drops', async () => {
    const dir = await makeTempDir()
    const original = await readFile(await makeScannedPdf(dir, 'scan.pdf'))
    const high = await compressPdf(original, 90)
    const low = await compressPdf(original, 20)
    expect(low.bytes.byteLength).toBeLessThan(high.bytes.byteLength)
  })

  it('always starts from the original, so quality is not applied twice', async () => {
    // The search calls this repeatedly. If each call compounded on the last,
    // the same quality would yield a different size depending on what ran
    // before it, and the bisection would converge on a lie.
    const dir = await makeTempDir()
    const original = await readFile(await makeScannedPdf(dir, 'scan.pdf'))
    const first = await compressPdf(original, 50)
    await compressPdf(original, 5)
    const again = await compressPdf(original, 50)
    expect(again.bytes.byteLength).toBe(first.bytes.byteLength)
  })

  it('leaves a Flate image alone and says so rather than corrupting it', async () => {
    const dir = await makeTempDir()
    const original = await readFile(await makeScannedPdf(dir, 'shot.pdf', { filter: 'png' }))
    const out = await compressPdf(original, 30)
    expect(out.recompressed).toBe(0)
    expect(out.skipped).toBe(1)
    // Still a readable PDF with its page intact.
    const reopened = await PDFDocument.load(out.bytes)
    expect(reopened.getPageCount()).toBe(3)
  })

  it('produces a file that still opens and renders', async () => {
    const dir = await makeTempDir()
    const original = await readFile(await makeScannedPdf(dir, 'scan.pdf', { pages: 2 }))
    const out = await compressPdf(original, 25)
    const { PDFiumLibrary } = await import('@hyzyla/pdfium')
    const lib = await PDFiumLibrary.init()
    const doc = await lib.loadDocument(out.bytes)
    expect(doc.getPageCount()).toBe(2)
    const page = await doc.getPage(0).render({ scale: 1, render: 'bitmap' })
    expect(page.width).toBeGreaterThan(0)
    doc.destroy()
    lib.destroy()
  })
})

describe('probing reports what a PDF offers', () => {
  it('tells a scanned PDF apart from a text one', async () => {
    const dir = await makeTempDir()
    const scan = await probe(await makeScannedPdf(dir, 'scan.pdf'))
    const text = await probe(await makePdf(dir, 'text.pdf', 2))
    expect(scan.kind).toBe('document')
    expect(text.kind).toBe('document')
    if (scan.kind !== 'document' || text.kind !== 'document') return
    expect(scan.images).toEqual({ compressible: 1, skipped: 0 })
    expect(text.images).toEqual({ compressible: 0, skipped: 0 })
  })

  it('reports a Flate image as skipped, so /compress can explain itself', async () => {
    const dir = await makeTempDir()
    const shot = await probe(await makeScannedPdf(dir, 'shot.pdf', { filter: 'png' }))
    if (shot.kind !== 'document') throw new Error('expected a document')
    expect(shot.images).toEqual({ compressible: 0, skipped: 1 })
  })
})
