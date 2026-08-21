import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { DocumentInfo, Job } from '../../src/core/types.js'
import { pdfEngine } from '../../src/engines/pdf.js'
import { engineForJob, probe } from '../../src/engines/registry.js'
import { makePdf, makeScannedPdf, makeTempDir } from '../helpers/fixtures.js'

async function compressJob(dir: string, source: DocumentInfo, quality: number): Promise<Job> {
  return {
    op: 'convert',
    sources: [source],
    target: 'pdf',
    outputs: [join(dir, 'out.pdf')],
    options: { background: '#ffffff', keepMetadata: false, quality },
  }
}

describe('compressing a PDF through the engine', () => {
  it('routes a PDF-to-PDF job to the pdf engine, not the rasteriser', async () => {
    // pdfium also reads pdf, so this is the routing case that phase 4a's
    // engineForJob fix exists for: source AND target must both match.
    const dir = await makeTempDir()
    const source = (await probe(await makeScannedPdf(dir, 'scan.pdf'))) as DocumentInfo
    expect(engineForJob(await compressJob(dir, source, 40))?.id).toBe('pdf')
  })

  it('writes a smaller file and reports the bytes it actually wrote', async () => {
    const dir = await makeTempDir()
    const path = await makeScannedPdf(dir, 'scan.pdf', { pages: 3 })
    const source = (await probe(path)) as DocumentInfo
    const job = await compressJob(dir, source, 30)

    const result = await pdfEngine.run(job, () => {})
    const written = await stat(join(dir, 'out.pdf'))

    expect(written.size).toBeLessThan(source.bytes * 0.6)
    // outputBytes must be what is on disk, not an estimate.
    expect(result.outputBytes).toBe(written.size)
  })

  it('still produces a readable PDF with every page intact', async () => {
    const dir = await makeTempDir()
    const source = (await probe(
      await makeScannedPdf(dir, 'scan.pdf', { pages: 5 }),
    )) as DocumentInfo
    await pdfEngine.run(await compressJob(dir, source, 25), () => {})

    const { PDFiumLibrary } = await import('@hyzyla/pdfium')
    const lib = await PDFiumLibrary.init()
    const doc = await lib.loadDocument(await readFile(join(dir, 'out.pdf')))
    expect(doc.getPageCount()).toBe(5)
    doc.destroy()
    lib.destroy()
  })

  it('warns rather than lying when it could not touch anything', async () => {
    // A text-only PDF has nothing to re-encode. Writing a byte-identical
    // copy and reporting success would be a promise broken; the result has
    // to say so.
    const dir = await makeTempDir()
    const source = (await probe(await makePdf(dir, 'text.pdf', 3))) as DocumentInfo
    const result = await pdfEngine.run(await compressJob(dir, source, 30), () => {})
    expect(result.warnings.map((w) => w.code)).toContain('pdf-no-images')
    expect(result.warnings.map((w) => w.message).join(' ')).toMatch(/no images/i)
  })

  it('names the reason when none of the images are a kind it can re-encode', async () => {
    const dir = await makeTempDir()
    const source = (await probe(
      await makeScannedPdf(dir, 'shot.pdf', { filter: 'png' }),
    )) as DocumentInfo
    const result = await pdfEngine.run(await compressJob(dir, source, 30), () => {})
    expect(result.warnings.map((w) => w.code)).toContain('pdf-no-images')
    // One Flate image: nothing could be re-encoded, and the message names
    // the reason rather than leaving the user to guess.
    expect(result.warnings.map((w) => w.message).join(' ')).toMatch(/not JPEG/i)
  })

  it('reports both counts when some images are re-encoded and some are not', async () => {
    // The mixed case, which the test above does NOT cover despite what its
    // name used to claim: a JPEG photo and a Flate chart in one document.
    const dir = await makeTempDir()
    const source = (await probe(
      await makeScannedPdf(dir, 'report.pdf', { filter: 'mixed' }),
    )) as DocumentInfo
    expect(source.images).toEqual({ compressible: 1, skipped: 1 })

    const result = await pdfEngine.run(await compressJob(dir, source, 30), () => {})
    expect(result.warnings.map((w) => w.code)).toContain('pdf-images-skipped')
    expect(result.warnings.map((w) => w.message).join(' ')).toMatch(
      /1 image recompressed, 1 skipped/i,
    )
  })
})
