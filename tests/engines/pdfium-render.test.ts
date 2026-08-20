import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import type { DocumentInfo, Job, Progress } from '../../src/core/types.js'
import { pdfiumEngine } from '../../src/engines/pdfium.js'
import { probe } from '../../src/engines/registry.js'
import { makeColouredPdf, makeMarkedPdf, makeTempDir } from '../helpers/fixtures.js'

async function doc(path: string): Promise<DocumentInfo> {
  const info = await probe(path)
  if (info.kind !== 'document') throw new Error('expected a document')
  return info
}

const options = { background: '#ffffff', keepMetadata: false }

describe('rasterising', () => {
  it('renders the pages it was given, in the order it was given them', async () => {
    const dir = await makeTempDir()
    // page n is 600 + n points wide, so an image's width identifies which page
    // it came from — not merely that a file appeared.
    const src = await makeMarkedPdf(dir, 'doc.pdf', [1, 2, 3, 4, 5])
    const outputs: [string, string] = [join(dir, 'a.jpg'), join(dir, 'b.jpg')]
    const job: Job = {
      op: 'convert',
      sources: [await doc(src)],
      outputs,
      target: 'jpeg',
      options: { ...options, dpi: 72, pages: [1, 3] },
    }

    await pdfiumEngine.run(job, () => {})

    // page index 1 is 602pt wide, index 3 is 604pt — at 72dpi, 1pt = 1px
    expect((await sharp(await readFile(outputs[0])).metadata()).width).toBe(602)
    expect((await sharp(await readFile(outputs[1])).metadata()).width).toBe(604)
  })

  it("writes the page's real colours, not a channel-swapped copy", async () => {
    // Guards the RGBA/BGRA trap. makeColouredPdf paints a deliberately
    // asymmetric colour: a symmetric one cannot tell RGBA from BGRA apart.
    const dir = await makeTempDir()
    const src = await makeColouredPdf(dir, 'c.pdf', { r: 51, g: 102, b: 229 })
    const out = join(dir, 'c.png')
    await pdfiumEngine.run(
      {
        op: 'convert',
        sources: [await doc(src)],
        outputs: [out],
        target: 'png',
        options: { ...options, dpi: 72, pages: [0] },
      },
      () => {},
    )

    const { dominant } = await sharp(await readFile(out)).stats()
    expect(dominant.r).toBeGreaterThan(200 - 160) // ~51, not ~232
    expect(dominant.b).toBeGreaterThan(200) // ~229, not ~56
    expect(dominant.b).toBeGreaterThan(dominant.r) // the ordering is the point
  })

  it('scales with the requested resolution', async () => {
    const dir = await makeTempDir()
    const src = await makeMarkedPdf(dir, 'doc.pdf', [1])
    const at = async (dpi: number) => {
      const out = join(dir, `${dpi}.jpg`)
      await pdfiumEngine.run(
        {
          op: 'convert',
          sources: [await doc(src)],
          outputs: [out],
          target: 'jpeg',
          options: { ...options, dpi, pages: [0] },
        },
        () => {},
      )
      return (await sharp(await readFile(out)).metadata()).width as number
    }
    expect(await at(144)).toBe((await at(72)) * 2)
  })

  it('reports progress once per page, never fabricating a total', async () => {
    const dir = await makeTempDir()
    const src = await makeMarkedPdf(dir, 'doc.pdf', [1, 2, 3])
    const seen: Array<{ done: number; total: number }> = []
    await pdfiumEngine.run(
      {
        op: 'convert',
        sources: [await doc(src)],
        target: 'jpeg',
        outputs: [join(dir, '1.jpg'), join(dir, '2.jpg'), join(dir, '3.jpg')],
        options: { ...options, dpi: 72, pages: [0, 1, 2] },
      },
      (p: Progress) => {
        if (p.phase === 'page') seen.push({ done: p.done, total: p.total })
      },
    )

    expect(seen.map((s) => s.done)).toEqual([1, 2, 3])
    expect(seen.every((s) => s.total === 3)).toBe(true)
  })
})
