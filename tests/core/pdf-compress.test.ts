import { readFile } from 'node:fs/promises'
import {
  concatTransformationMatrix,
  drawObject,
  PDFDocument,
  PDFName,
  PDFNumber,
  PDFRawStream,
  popGraphicsState,
  pushGraphicsState,
} from 'pdf-lib'
import sharp from 'sharp'
import { describe, expect, it, vi } from 'vitest'
import { compressPdf, surveyPdfImages } from '../../src/core/pdf-compress.js'
import { probe } from '../../src/engines/registry.js'
import { makePdf, makeScannedPdf, makeTempDir } from '../helpers/fixtures.js'

/** ASCII85, written out here so the decoder under test is not checking itself. */
function ascii85(data: Uint8Array): string {
  let out = ''
  for (let i = 0; i < data.length; i += 4) {
    const chunk = data.subarray(i, i + 4)
    let n = 0
    for (let j = 0; j < 4; j++) n = n * 256 + (chunk[j] ?? 0)
    if (chunk.length === 4 && n === 0) {
      out += 'z'
      continue
    }
    const digits: string[] = []
    for (let j = 0; j < 5; j++) {
      digits.unshift(String.fromCharCode((n % 85) + 33))
      n = Math.floor(n / 85)
    }
    out += digits.slice(0, chunk.length + 1).join('')
  }
  return `${out}~>`
}

/**
 * Re-stores every image's data behind ASCII85, as `[/ASCII85Decode <filter>]`.
 * That is how some exporters write a brochure, and it is what made a PDF that
 * was mostly JPEG read as "not a kind Forge can re-encode".
 */
async function behindAscii85(path: string): Promise<Uint8Array> {
  const doc = await PDFDocument.load(await readFile(path))
  for (const [ref, obj] of doc.context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFRawStream)) continue
    if (obj.dict.get(PDFName.of('Subtype'))?.toString() !== '/Image') continue
    const text = Buffer.from(ascii85(obj.contents), 'latin1')
    const dict = obj.dict.clone()
    const inner = obj.dict.get(PDFName.of('Filter'))
    if (inner === undefined) continue
    dict.set(PDFName.of('Filter'), doc.context.obj([PDFName.of('ASCII85Decode'), inner]))
    dict.set(PDFName.of('Length'), doc.context.obj(text.byteLength))
    doc.context.assign(ref, PDFRawStream.of(dict, text))
  }
  return doc.save()
}

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

/** A one-page PDF holding `jpeg` as a /DCTDecode image declared as `colourSpace`. */
async function pdfWithJpeg(
  jpeg: Buffer,
  colourSpace: string,
  extra: Record<string, unknown> = {},
): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const page = doc.addPage([600, 400])
  const dict = doc.context.obj({
    Type: 'XObject',
    Subtype: 'Image',
    Width: 600,
    Height: 400,
    ColorSpace: colourSpace,
    BitsPerComponent: 8,
    Filter: 'DCTDecode',
    Length: jpeg.length,
    ...extra,
  })
  const ref = doc.context.register(PDFRawStream.of(dict as never, jpeg))
  page.node.setXObject(PDFName.of('Im0'), ref)
  page.pushOperators(
    pushGraphicsState(),
    concatTransformationMatrix(600, 0, 0, 400, 0, 0),
    drawObject('Im0'),
    popGraphicsState(),
  )
  return doc.save()
}

/** Noise, so the JPEG is big enough for re-encoding to shrink it. */
const noise = () => {
  const raw = Buffer.alloc(600 * 400 * 3)
  for (let i = 0; i < raw.length; i++) raw[i] = Math.floor(Math.random() * 256)
  return sharp(raw, { raw: { width: 600, height: 400, channels: 3 } })
}

describe('JPEGs whose colour Sharp would change', () => {
  // Sharp writes a 3-channel RGB JPEG. Declared as anything else, the page
  // renders scrambled — silently, with no error to catch.
  it('leaves a CMYK JPEG alone and counts it as skipped', async () => {
    const original = await pdfWithJpeg(
      await noise().toColourspace('cmyk').jpeg({ quality: 90 }).toBuffer(),
      'DeviceCMYK',
    )
    expect(await surveyPdfImages(original)).toMatchObject({ compressible: 0, skipped: 1 })
    const out = await compressPdf(original, { quality: 30 })
    expect(out).toMatchObject({ recompressed: 0, skipped: 1 })
  })

  it('leaves a JPEG with a /Decode array alone', async () => {
    const original = await pdfWithJpeg(
      await noise().jpeg({ quality: 90 }).toBuffer(),
      'DeviceRGB',
      { Decode: [1, 0, 1, 0, 1, 0] },
    )
    expect(await surveyPdfImages(original)).toMatchObject({ compressible: 0, skipped: 1 })
  })

  it('still compresses a greyscale JPEG', async () => {
    const original = await pdfWithJpeg(
      await noise().greyscale().jpeg({ quality: 90 }).toBuffer(),
      'DeviceGray',
    )
    expect(await surveyPdfImages(original)).toMatchObject({ compressible: 1, skipped: 0 })
    expect((await compressPdf(original, { quality: 30 })).recompressed).toBe(1)
  })
})

describe('a JPEG stored behind ASCII85', () => {
  it('counts as compressible, not skipped', async () => {
    const dir = await makeTempDir()
    const bytes = await behindAscii85(await makeScannedPdf(dir, 'scan.pdf'))
    expect(await surveyPdfImages(bytes)).toMatchObject({ compressible: 1, skipped: 0 })
  })

  it('is re-encoded, and comes out as a plain JPEG stream', async () => {
    const dir = await makeTempDir()
    const original = await behindAscii85(await makeScannedPdf(dir, 'scan.pdf', { pages: 2 }))
    const out = await compressPdf(original, { quality: 30 })
    expect(out.recompressed).toBe(1)
    expect(out.skipped).toBe(0)
    expect(out.bytes.byteLength).toBeLessThan(original.byteLength * 0.6)

    const doc = await PDFDocument.load(out.bytes)
    const filters = [...doc.context.enumerateIndirectObjects()]
      .map(([, o]) => o)
      .filter((o): o is PDFRawStream => o instanceof PDFRawStream)
      .filter((o) => o.dict.get(PDFName.of('Subtype'))?.toString() === '/Image')
      .map((o) => String(o.dict.get(PDFName.of('Filter'))))
    // Written as DCT alone: leaving ASCII85 in the chain would mean the new
    // bytes were not ASCII85 and the page would not decode.
    expect(filters).toEqual(['/DCTDecode'])
  })
})

describe('compressing a PDF', () => {
  it('makes a scanned PDF substantially smaller', async () => {
    const dir = await makeTempDir()
    const original = await readFile(await makeScannedPdf(dir, 'scan.pdf', { pages: 4 }))
    const out = await compressPdf(original, { quality: 30 })
    expect(out.bytes.byteLength).toBeLessThan(original.byteLength * 0.6)
    expect(out.recompressed).toBe(1)
    expect(out.skipped).toBe(0)
  })

  it('gets smaller as the quality drops', async () => {
    const dir = await makeTempDir()
    const original = await readFile(await makeScannedPdf(dir, 'scan.pdf'))
    const high = await compressPdf(original, { quality: 90 })
    const low = await compressPdf(original, { quality: 20 })
    expect(low.bytes.byteLength).toBeLessThan(high.bytes.byteLength)
  })

  it('always starts from the original, so quality is not applied twice', async () => {
    // The search calls this repeatedly. If each call compounded on the last,
    // the same quality would yield a different size depending on what ran
    // before it, and the bisection would converge on a lie.
    const dir = await makeTempDir()
    const original = await readFile(await makeScannedPdf(dir, 'scan.pdf'))
    // pdf-lib stamps ModDate on every save, inside a compressed object
    // stream, so two saves a second apart differ by a byte or two. The clock
    // is held still so only the images can make a difference.
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-01-01T00:00:00Z') })
    try {
      const first = await compressPdf(original, { quality: 50 })
      await compressPdf(original, { quality: 5 })
      const again = await compressPdf(original, { quality: 50 })
      expect(again.bytes.byteLength).toBe(first.bytes.byteLength)
    } finally {
      vi.useRealTimers()
    }
  })

  it('leaves a Flate image alone and says so rather than corrupting it', async () => {
    const dir = await makeTempDir()
    const original = await readFile(await makeScannedPdf(dir, 'shot.pdf', { filter: 'png' }))
    const out = await compressPdf(original, { quality: 30 })
    expect(out.recompressed).toBe(0)
    expect(out.skipped).toBe(1)
    // Still a readable PDF with its page intact.
    const reopened = await PDFDocument.load(out.bytes)
    expect(reopened.getPageCount()).toBe(3)
  })

  it('produces a file that still opens and renders', async () => {
    const dir = await makeTempDir()
    const original = await readFile(await makeScannedPdf(dir, 'scan.pdf', { pages: 2 }))
    const out = await compressPdf(original, { quality: 25 })
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
    expect(scan.images).toMatchObject({ compressible: 1, skipped: 0 })
    expect(text.images).toMatchObject({ compressible: 0, skipped: 0 })
  })

  it('reports a Flate image as skipped, so /compress can explain itself', async () => {
    const dir = await makeTempDir()
    const shot = await probe(await makeScannedPdf(dir, 'shot.pdf', { filter: 'png' }))
    if (shot.kind !== 'document') throw new Error('expected a document')
    expect(shot.images).toMatchObject({ compressible: 0, skipped: 1 })
  })
})

describe('downsampling the images inside a PDF', () => {
  /** Pixel width of the first image object in a PDF. */
  async function firstImageWidth(bytes: Uint8Array): Promise<number> {
    const doc = await PDFDocument.load(bytes)
    for (const [, obj] of doc.context.enumerateIndirectObjects()) {
      if (!(obj instanceof PDFRawStream)) continue
      if (obj.dict.get(PDFName.of('Subtype'))?.toString() !== '/Image') continue
      const width = obj.dict.get(PDFName.of('Width'))
      return width instanceof PDFNumber ? width.asNumber() : 0
    }
    return 0
  }

  it('reduces an image to the requested resolution', async () => {
    const dir = await makeTempDir()
    // 300 dpi on an A4 page: 2480px across 595pt.
    const original = await readFile(await makeScannedPdf(dir, 'scan.pdf', { dpi: 300 }))
    // (595 / 72) * 300 rounds to 2479.
    expect(await firstImageWidth(original)).toBe(2479)

    const out = await compressPdf(original, { quality: 60, dpi: 150 })
    // 150 dpi on the same page is half the pixels, give or take rounding.
    const width = await firstImageWidth(out.bytes)
    expect(width).toBeGreaterThan(1200)
    expect(width).toBeLessThan(1280)
  })

  it('is far smaller than re-encoding alone', async () => {
    const dir = await makeTempDir()
    const original = await readFile(await makeScannedPdf(dir, 'scan.pdf', { dpi: 300, pages: 3 }))
    const reencoded = await compressPdf(original, { quality: 40 })
    const downsampled = await compressPdf(original, { quality: 40, dpi: 150 })
    expect(downsampled.bytes.byteLength).toBeLessThan(reencoded.bytes.byteLength / 3)
  })

  it('never enlarges an image that is already below the target', async () => {
    // Upscaling a 72 dpi scan to 150 would add bytes and no detail — the
    // opposite of what compression promises.
    const dir = await makeTempDir()
    const original = await readFile(await makeScannedPdf(dir, 'low.pdf', { dpi: 72 }))
    const before = await firstImageWidth(original)
    const out = await compressPdf(original, { quality: 60, dpi: 150 })
    expect(await firstImageWidth(out.bytes)).toBe(before)
  })

  it('leaves resolution alone when no dpi is asked for', async () => {
    const dir = await makeTempDir()
    const original = await readFile(await makeScannedPdf(dir, 'scan.pdf', { dpi: 300 }))
    const out = await compressPdf(original, { quality: 60 })
    expect(await firstImageWidth(out.bytes)).toBe(2479)
  })

  it('reports the resolution it started from, so the change can be named', async () => {
    const dir = await makeTempDir()
    const original = await readFile(await makeScannedPdf(dir, 'scan.pdf', { dpi: 300 }))
    const survey = await surveyPdfImages(original)
    expect(survey.maxDpi).toBeGreaterThan(280)
    expect(survey.maxDpi).toBeLessThan(320)
  })

  it('keeps the page geometry and the picture intact', async () => {
    const dir = await makeTempDir()
    const original = await readFile(await makeScannedPdf(dir, 'scan.pdf', { dpi: 300, pages: 2 }))
    const out = await compressPdf(original, { quality: 50, dpi: 96 })
    const { PDFiumLibrary } = await import('@hyzyla/pdfium')
    const lib = await PDFiumLibrary.init()
    const doc = await lib.loadDocument(out.bytes)
    const page = await doc.getPage(0).render({ scale: 1, render: 'bitmap' })
    // The PAGE is still A4 even though the image inside it shrank.
    expect(page.width).toBe(595)
    expect(page.height).toBe(842)
    doc.destroy()
    lib.destroy()
  })
})
