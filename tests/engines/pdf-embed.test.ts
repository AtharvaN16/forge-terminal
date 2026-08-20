import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { PDFDocument } from 'pdf-lib'
import { describe, expect, it } from 'vitest'
import type { DocumentInfo, ImageInfo, Job } from '../../src/core/types.js'
import { pdfEngine } from '../../src/engines/pdf.js'
import { probe } from '../../src/engines/registry.js'
import {
  makeAnimatedGif,
  makeAvif,
  makeJpeg,
  makeOrientedJpeg,
  makePdf,
  makePng,
  makeTempDir,
} from '../helpers/fixtures.js'

async function image(path: string): Promise<ImageInfo> {
  const info = await probe(path)
  if (info.kind !== 'image') throw new Error('expected an image')
  return info
}

async function doc(path: string): Promise<DocumentInfo> {
  const info = await probe(path)
  if (info.kind !== 'document') throw new Error('expected a document')
  return info
}

const options = { background: '#ffffff', keepMetadata: false }

describe('images to PDF', () => {
  it('makes a one-page PDF sized to the image', async () => {
    const dir = await makeTempDir()
    const src = await makeJpeg(dir, 'a.jpg')
    const out = join(dir, 'a.pdf')
    const info = await image(src)
    const job: Job = {
      op: 'convert',
      sources: [info],
      outputs: [out],
      target: 'pdf',
      options,
    }

    await pdfEngine.run(job, () => {})

    const doc = await PDFDocument.load(await readFile(out))
    expect(doc.getPageCount()).toBe(1)
    const { width, height } = doc.getPage(0).getSize()
    expect(Math.round(width)).toBe(info.width)
    expect(Math.round(height)).toBe(info.height)
  })

  it('embeds a PNG', async () => {
    const dir = await makeTempDir()
    const src = await makePng(dir, 'a.png')
    const out = join(dir, 'a.pdf')
    const info = await image(src)
    await pdfEngine.run(
      { op: 'convert', sources: [info], outputs: [out], target: 'pdf', options },
      () => {},
    )
    const doc = await PDFDocument.load(await readFile(out))
    expect(doc.getPageCount()).toBe(1)
    const { width, height } = doc.getPage(0).getSize()
    expect(Math.round(width)).toBe(info.width)
    expect(Math.round(height)).toBe(info.height)
  })

  it('decodes a format pdf-lib cannot embed directly', async () => {
    const dir = await makeTempDir()
    const src = await makeAvif(dir, 'a.avif')
    const out = join(dir, 'a.pdf')
    const info = await image(src)
    await pdfEngine.run(
      { op: 'convert', sources: [info], outputs: [out], target: 'pdf', options },
      () => {},
    )
    const doc = await PDFDocument.load(await readFile(out))
    expect(doc.getPageCount()).toBe(1)
    const { width, height } = doc.getPage(0).getSize()
    expect(Math.round(width)).toBe(info.width)
    expect(Math.round(height)).toBe(info.height)
  })
})

describe('exif orientation (invariant 4)', () => {
  it('rotates a 40x80 orientation-6 jpeg into an 80x40 page, instead of embedding it sideways', async () => {
    const dir = await makeTempDir()
    const src = await makeOrientedJpeg(dir, 'rot.jpg', 6)
    const out = join(dir, 'rot.pdf')
    const info = await image(src)
    // Stored (pre-rotation) dimensions, same as image.ts's probe reports —
    // the display-correct size is the swap of these.
    expect([info.width, info.height]).toEqual([40, 80])

    await pdfEngine.run(
      { op: 'convert', sources: [info], outputs: [out], target: 'pdf', options },
      () => {},
    )

    const doc = await PDFDocument.load(await readFile(out))
    const { width, height } = doc.getPage(0).getSize()
    expect(Math.round(width)).toBe(80)
    expect(Math.round(height)).toBe(40)
  })

  it('embeds an orientation-1 jpeg untouched, at its stored size', async () => {
    const dir = await makeTempDir()
    const src = await makeOrientedJpeg(dir, 'plain.jpg', 1)
    const out = join(dir, 'plain.pdf')
    const info = await image(src)

    await pdfEngine.run(
      { op: 'convert', sources: [info], outputs: [out], target: 'pdf', options },
      () => {},
    )

    const doc = await PDFDocument.load(await readFile(out))
    const { width, height } = doc.getPage(0).getSize()
    expect(Math.round(width)).toBe(40)
    expect(Math.round(height)).toBe(80)
  })
})

describe('animation (spec rule 4)', () => {
  it('warns and keeps only the first frame when the source animates', async () => {
    const dir = await makeTempDir()
    const src = await makeAnimatedGif(dir, 'anim.gif', 3)
    const out = join(dir, 'anim.pdf')
    const info = await image(src)
    expect(info.frames).toBe(3)

    const result = await pdfEngine.run(
      { op: 'convert', sources: [info], outputs: [out], target: 'pdf', options },
      () => {},
    )

    expect(result.warnings).toEqual([
      expect.objectContaining({
        code: 'animation-flattened',
        message: expect.stringContaining('3 frames'),
      }),
    ])
    const doc = await PDFDocument.load(await readFile(out))
    expect(doc.getPageCount()).toBe(1)
  })

  it('never warns for a still image', async () => {
    const dir = await makeTempDir()
    const src = await makeJpeg(dir, 'still.jpg')
    const out = join(dir, 'still.pdf')
    const result = await pdfEngine.run(
      { op: 'convert', sources: [await image(src)], outputs: [out], target: 'pdf', options },
      () => {},
    )
    expect(result.warnings).toEqual([])
  })
})

describe('document sources', () => {
  it('refuses to embed a PDF as though it were an image, rather than failing on a raw sharp decode error', async () => {
    const dir = await makeTempDir()
    const src = await makePdf(dir, 'a.pdf')
    const out = join(dir, 'b.pdf')
    const job: Job = {
      op: 'convert',
      sources: [await doc(src)],
      outputs: [out],
      target: 'pdf',
      options,
    }

    await expect(pdfEngine.run(job, () => {})).rejects.toThrow(/document source/i)
  })
})
