import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import type { ConvertOptions, DocumentInfo, Job } from '../../src/core/types.js'
import { pdfEngine } from '../../src/engines/pdf.js'
import { probe } from '../../src/engines/registry.js'
import { makeScannedPdf, makeTempDir } from '../helpers/fixtures.js'

let dir: string
let scan: DocumentInfo

beforeAll(async () => {
  dir = await makeTempDir()
  scan = (await probe(await makeScannedPdf(dir, 'scan.pdf', { dpi: 300 }))) as DocumentInfo
})

const jobFor = (options: Partial<ConvertOptions> = {}, output = '/unused.pdf'): Job => ({
  op: 'convert',
  sources: [scan],
  outputs: [output],
  target: 'pdf',
  options: { background: '#ffffff', keepMetadata: false, ...options },
})

describe('pdfEngine.measurer', () => {
  /**
   * A PDF has two levers, so the search has two dimensions. The rungs live
   * here because this is the only module that knows why these numbers.
   */
  it('offers a resolution ladder', async () => {
    const m = await pdfEngine.measurer?.(jobFor())

    expect(m?.ladder.map((rung) => rung.dpi)).toEqual([150, 120, 96, 72])
  })

  /** `--dpi 300` means "keep every pixel", so the search must start there. */
  it('honours an explicit dpi as the first rung', async () => {
    const m = await pdfEngine.measurer?.(jobFor({ dpi: 300 }))

    expect(m?.ladder[0]?.dpi).toBe(300)
  })

  it('measures smaller at a lower rung', async () => {
    const m = await pdfEngine.measurer?.(jobFor())
    const base = { background: '#ffffff', keepMetadata: false, quality: 60 }

    const coarse = await m?.measure({ ...base, dpi: 72 })
    const fine = await m?.measure({ ...base, dpi: 300 })

    expect(coarse).toBeLessThan(fine as number)
  })

  it('writes nothing', async () => {
    const output = join(dir, 'must-not-exist.pdf')
    const m = await pdfEngine.measurer?.(jobFor({}, output))
    expect(m).toBeDefined()

    await m?.measure({ background: '#ffffff', keepMetadata: false, quality: 40, dpi: 96 })

    expect(existsSync(output)).toBe(false)
  })

  /**
   * An image going to PDF is an embedding, not a compression — there is no
   * resolution ladder to walk, so it declines rather than inventing one.
   */
  it('declines for a non-document source', async () => {
    const image = { ...scan, kind: 'image' as const }
    const job = { ...jobFor(), sources: [image] } as unknown as Job

    expect(await pdfEngine.measurer?.(job)).toBeUndefined()
  })
})
