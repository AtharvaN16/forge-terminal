import { mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import type { DocumentInfo, Job, Progress } from '../../src/core/types.js'
import { pdfiumEngine } from '../../src/engines/pdfium.js'
import { probe } from '../../src/engines/registry.js'
import {
  makeColouredPdf,
  makeMarkedPdf,
  makePartiallyPaintedPdf,
  makeTempDir,
  pixelAt,
} from '../helpers/fixtures.js'

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

  it('rasterises every page when none are named, not zero', async () => {
    // "Convert this PDF" with no page selection means all of it. Defaulting
    // to an empty selection would make the loop body never run: a job whose
    // `outputs` promises at least one file would report success — a real
    // `Result` with `outputBytes: 0` — while writing nothing at all.
    const dir = await makeTempDir()
    const src = await makeMarkedPdf(dir, 'doc.pdf', [1, 2, 3])
    const outputs: [string, string, string] = [
      join(dir, '1.jpg'),
      join(dir, '2.jpg'),
      join(dir, '3.jpg'),
    ]
    const job: Job = {
      op: 'convert',
      sources: [await doc(src)],
      outputs,
      target: 'jpeg',
      options: { ...options, dpi: 72 }, // no `pages` at all
    }

    const result = await pdfiumEngine.run(job, () => {})

    expect(result.outputBytes).toBeGreaterThan(0)
    for (const [i, out] of outputs.entries()) {
      // marks [1,2,3] → widths 601,602,603, in page order
      const width = (await sharp(await readFile(out)).metadata()).width
      expect(width).toBe(601 + i)
    }
  })

  it('never reorders pages internally, even when they are not given ascending', async () => {
    // The "renders the pages it was given, in the order it was given them"
    // test above uses pages [1, 3] — already ascending, so an internal
    // `.sort()` would be a no-op against it and the test would pass for the
    // wrong reason. This uses descending order specifically to distinguish
    // "preserved as given" from "coincidentally already sorted". Whoever
    // builds the job (`core/pages.ts`'s `normalisePages`) owns sorting; an
    // engine-side sort would silently reproduce phase 3's worst defect — the
    // engine reordering while the output naming did not.
    const dir = await makeTempDir()
    const src = await makeMarkedPdf(dir, 'doc.pdf', [1, 2, 3, 4, 5])
    const outputs: [string, string] = [join(dir, 'first.jpg'), join(dir, 'second.jpg')]
    const job: Job = {
      op: 'convert',
      sources: [await doc(src)],
      outputs,
      target: 'jpeg',
      options: { ...options, dpi: 72, pages: [3, 1] }, // descending
    }

    await pdfiumEngine.run(job, () => {})

    // index 3 is 604pt wide, index 1 is 602pt. A sort would swap these.
    expect((await sharp(await readFile(outputs[0])).metadata()).width).toBe(604)
    expect((await sharp(await readFile(outputs[1])).metadata()).width).toBe(602)
  })

  it('refuses a pages/outputs count mismatch rather than writing a partial set', async () => {
    // A caller bug (whatever built the job promised one output per page and
    // didn't), not a user-facing condition — so a plain throw, and nothing
    // written at all rather than the first two pages landing on disk.
    const dir = await makeTempDir()
    const src = await makeMarkedPdf(dir, 'doc.pdf', [1, 2, 3])
    const out1 = join(dir, '1.jpg')
    const out2 = join(dir, '2.jpg')
    const job: Job = {
      op: 'convert',
      sources: [await doc(src)],
      outputs: [out1, out2], // 2 outputs
      target: 'jpeg',
      options: { ...options, dpi: 72, pages: [0, 1, 2] }, // 3 pages
    }

    await expect(pdfiumEngine.run(job, () => {})).rejects.toThrow(/3 pages.*2 outputs/)
    await expect(readFile(out1)).rejects.toThrow()
    await expect(readFile(out2)).rejects.toThrow()
  })

  it('paints unpainted page area with the requested background, not opaque white', async () => {
    // pdfium's render() defaults to transparent: false, which pre-fills the
    // bitmap with opaque white before painting anything — so a naive
    // flatten() onto that bitmap is a no-op and `--background` silently does
    // nothing. makePartiallyPaintedPdf paints only its bottom-left quarter,
    // leaving the rest genuinely unpainted; sampling the far corner proves
    // the background option actually reached the page.
    const dir = await makeTempDir()
    const src = await makePartiallyPaintedPdf(dir, 'partial.pdf', { r: 20, g: 20, b: 20 })
    const out = join(dir, 'partial.png')
    await pdfiumEngine.run(
      {
        op: 'convert',
        sources: [await doc(src)],
        outputs: [out],
        target: 'png',
        options: { ...options, background: '#ff8000', dpi: 72, pages: [0] },
      },
      () => {},
    )

    // Top-right corner: far from the bottom-left painted square.
    const [r, g, b] = await pixelAt(out, 195, 5)
    expect(r).toBeGreaterThan(200) // #ff8000's red channel, ~255
    expect(g).toBeGreaterThan(100) // ~128, well above 0
    expect(g).toBeLessThan(200) // and well below white's 255
    expect(b).toBeLessThan(50) // ~0, not white's 255
  })

  it('reports the true total for a subset selection, not the whole document', async () => {
    // The "reports progress once per page" test above selects all 3 pages of
    // a 3-page document, so `total: pages.length` and a hypothetical (wrong)
    // `total: source.pages` are indistinguishable there. A 5-page document
    // with only 2 pages selected tells them apart: progress must reach its
    // own total, not stall partway through a bigger number that was never
    // the job's total to begin with (invariant 7).
    const dir = await makeTempDir()
    const src = await makeMarkedPdf(dir, 'doc.pdf', [1, 2, 3, 4, 5])
    const seen: Array<{ done: number; total: number }> = []
    await pdfiumEngine.run(
      {
        op: 'convert',
        sources: [await doc(src)],
        target: 'jpeg',
        outputs: [join(dir, '1.jpg'), join(dir, '2.jpg')],
        options: { ...options, dpi: 72, pages: [0, 2] },
      },
      (p: Progress) => {
        if (p.phase === 'page') seen.push({ done: p.done, total: p.total })
      },
    )

    expect(seen).toEqual([
      { done: 1, total: 2 },
      { done: 2, total: 2 },
    ])
  })

  it('rolls back every output when a later page fails to write', async () => {
    // pages: [0, 1] are both in range (the bounds check above wouldn't
    // reject this job), so the failure has to come from something that goes
    // wrong mid-loop, after at least one output has already been written —
    // exactly the invariant-6 case the try/catch/rm exists for. A directory
    // sitting at the second output's path forces writeAtomic's rename to
    // fail (EISDIR) deterministically, without touching the filesystem in
    // any exotic way.
    const dir = await makeTempDir()
    const src = await makeMarkedPdf(dir, 'doc.pdf', [1, 2, 3])
    const good = join(dir, 'good.jpg')
    const blocked = join(dir, 'blocked.jpg')
    await mkdir(blocked)
    const job: Job = {
      op: 'convert',
      sources: [await doc(src)],
      outputs: [good, blocked],
      target: 'jpeg',
      options: { ...options, dpi: 72, pages: [0, 1] },
    }

    await expect(pdfiumEngine.run(job, () => {})).rejects.toThrow()
    await expect(readFile(good)).rejects.toThrow()
  })
})
