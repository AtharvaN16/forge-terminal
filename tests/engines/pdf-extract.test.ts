import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { DocumentInfo, Job } from '../../src/core/types.js'
import { pdfEngine } from '../../src/engines/pdf.js'
import { probe } from '../../src/engines/registry.js'
import { makeMarkedPdf, makeTempDir, pdfPageMarks } from '../helpers/fixtures.js'

async function doc(path: string): Promise<DocumentInfo> {
  const info = await probe(path)
  if (info.kind !== 'document') throw new Error('expected a document')
  return info
}

const MARKS = [1, 2, 3, 4, 5]

describe('extract', () => {
  it('keeps only the selected pages, in document order', async () => {
    const dir = await makeTempDir()
    const src = await makeMarkedPdf(dir, 'doc.pdf', MARKS)
    const out = join(dir, 'out.pdf')
    const job: Job = {
      op: 'extract',
      sources: [await doc(src)],
      outputs: [out],
      pages: [0, 2, 4],
      separate: false,
    }
    await pdfEngine.run(job, () => {})
    expect(await pdfPageMarks(out)).toEqual([1, 3, 5])
  })

  it('writes one file per page when separating', async () => {
    const dir = await makeTempDir()
    const src = await makeMarkedPdf(dir, 'doc.pdf', MARKS)
    const outputs = [join(dir, 'a.pdf'), join(dir, 'b.pdf')]
    const job: Job = {
      op: 'extract',
      sources: [await doc(src)],
      outputs,
      pages: [1, 3],
      separate: true,
    }
    await pdfEngine.run(job, () => {})
    expect(await pdfPageMarks(outputs[0] as string)).toEqual([2])
    expect(await pdfPageMarks(outputs[1] as string)).toEqual([4])
  })

  it('refuses an empty selection rather than writing an empty document', async () => {
    const dir = await makeTempDir()
    const src = await makeMarkedPdf(dir, 'doc.pdf', MARKS)
    const job: Job = {
      op: 'extract',
      sources: [await doc(src)],
      outputs: [join(dir, 'out.pdf')],
      pages: [],
      separate: false,
    }
    await expect(pdfEngine.run(job, () => {})).rejects.toThrow(/no pages/i)
  })
})

describe('delete', () => {
  it('keeps everything except the selected pages', async () => {
    const dir = await makeTempDir()
    const src = await makeMarkedPdf(dir, 'doc.pdf', MARKS)
    const out = join(dir, 'out.pdf')
    const job: Job = {
      op: 'delete',
      sources: [await doc(src)],
      outputs: [out],
      pages: [1, 3],
    }
    await pdfEngine.run(job, () => {})
    expect(await pdfPageMarks(out)).toEqual([1, 3, 5])
  })

  it('is the exact inverse of extract', async () => {
    const dir = await makeTempDir()
    const src = await makeMarkedPdf(dir, 'doc.pdf', MARKS)
    const kept = join(dir, 'kept.pdf')
    const dropped = join(dir, 'dropped.pdf')
    const pages = [0, 3]
    const info = await doc(src)
    await pdfEngine.run(
      { op: 'extract', sources: [info], outputs: [kept], pages, separate: false },
      () => {},
    )
    await pdfEngine.run({ op: 'delete', sources: [info], outputs: [dropped], pages }, () => {})

    const a = await pdfPageMarks(kept)
    const b = await pdfPageMarks(dropped)
    expect([...a, ...b].sort()).toEqual([...MARKS].sort())
    expect(a.filter((l) => b.includes(l))).toEqual([])
  })

  it('refuses to delete every page', async () => {
    const dir = await makeTempDir()
    const src = await makeMarkedPdf(dir, 'doc.pdf', MARKS)
    const job: Job = {
      op: 'delete',
      sources: [await doc(src)],
      outputs: [join(dir, 'out.pdf')],
      pages: [0, 1, 2, 3, 4],
    }
    await expect(pdfEngine.run(job, () => {})).rejects.toThrow(/every page/i)
  })
})
