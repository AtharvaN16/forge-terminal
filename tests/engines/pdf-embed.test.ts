import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { PDFDocument } from 'pdf-lib'
import { describe, expect, it } from 'vitest'
import type { ImageInfo, Job } from '../../src/core/types.js'
import { pdfEngine } from '../../src/engines/pdf.js'
import { probe } from '../../src/engines/registry.js'
import { makeAvif, makeJpeg, makePng, makeTempDir } from '../helpers/fixtures.js'

async function image(path: string): Promise<ImageInfo> {
  const info = await probe(path)
  if (info.kind !== 'image') throw new Error('expected an image')
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
    await pdfEngine.run(
      { op: 'convert', sources: [await image(src)], outputs: [out], target: 'pdf', options },
      () => {},
    )
    expect((await PDFDocument.load(await readFile(out))).getPageCount()).toBe(1)
  })

  it('decodes a format pdf-lib cannot embed directly', async () => {
    const dir = await makeTempDir()
    const src = await makeAvif(dir, 'a.avif')
    const out = join(dir, 'a.pdf')
    await pdfEngine.run(
      { op: 'convert', sources: [await image(src)], outputs: [out], target: 'pdf', options },
      () => {},
    )
    expect((await PDFDocument.load(await readFile(out))).getPageCount()).toBe(1)
  })
})
