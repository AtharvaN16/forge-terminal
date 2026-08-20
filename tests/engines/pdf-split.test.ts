import { readdir } from 'node:fs/promises'
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

const MARKS = [1, 2, 3, 4, 5, 6, 7]

describe('split', () => {
  it('partitions the document at the cut points', async () => {
    const dir = await makeTempDir()
    const src = await makeMarkedPdf(dir, 'doc.pdf', MARKS)
    const outputs = [join(dir, 'o1.pdf'), join(dir, 'o2.pdf'), join(dir, 'o3.pdf')]
    const job: Job = { op: 'split', sources: [await doc(src)], outputs, cuts: [0, 3] }

    await pdfEngine.run(job, () => {})

    expect(await pdfPageMarks(outputs[0] as string)).toEqual([1])
    expect(await pdfPageMarks(outputs[1] as string)).toEqual([2, 3, 4])
    expect(await pdfPageMarks(outputs[2] as string)).toEqual([5, 6, 7])
  })

  it('loses no page and duplicates none', async () => {
    const dir = await makeTempDir()
    const src = await makeMarkedPdf(dir, 'doc.pdf', MARKS)
    const outputs = [join(dir, 'o1.pdf'), join(dir, 'o2.pdf')]
    await pdfEngine.run({ op: 'split', sources: [await doc(src)], outputs, cuts: [2] }, () => {})
    const all = [
      ...(await pdfPageMarks(outputs[0] as string)),
      ...(await pdfPageMarks(outputs[1] as string)),
    ]
    expect(all).toEqual(MARKS)
  })

  it('splits into single pages when every gap is cut', async () => {
    const dir = await makeTempDir()
    const src = await makeMarkedPdf(dir, 'doc.pdf', MARKS)
    const outputs = MARKS.map((_, i) => join(dir, `o${i}.pdf`))
    await pdfEngine.run(
      { op: 'split', sources: [await doc(src)], outputs, cuts: [0, 1, 2, 3, 4, 5] },
      () => {},
    )
    for (const [i, mark] of MARKS.entries()) {
      expect(await pdfPageMarks(outputs[i] as string)).toEqual([mark])
    }
  })

  it('reports real per-page progress', async () => {
    const dir = await makeTempDir()
    const src = await makeMarkedPdf(dir, 'doc.pdf', MARKS)
    const outputs = [join(dir, 'o1.pdf'), join(dir, 'o2.pdf')]
    const totals: number[] = []
    await pdfEngine.run({ op: 'split', sources: [await doc(src)], outputs, cuts: [2] }, (p) => {
      if (p.phase === 'page') totals.push(p.done)
    })
    expect(totals).toEqual([1, 2])
  })

  it('leaves nothing behind when an output cannot be written', async () => {
    const dir = await makeTempDir()
    const src = await makeMarkedPdf(dir, 'doc.pdf', MARKS)
    const outputs = [join(dir, 'o1.pdf'), join(dir, 'nope', 'o2.pdf')]
    await expect(
      pdfEngine.run({ op: 'split', sources: [await doc(src)], outputs, cuts: [2] }, () => {}),
    ).rejects.toThrow()
    expect(await readdir(dir)).toEqual(['doc.pdf'])
  })

  it('normalises an unsorted cut list with duplicates', async () => {
    const dir = await makeTempDir()
    const src = await makeMarkedPdf(dir, 'doc.pdf', MARKS)
    const outputs = [join(dir, 'o1.pdf'), join(dir, 'o2.pdf'), join(dir, 'o3.pdf')]
    // Same partition as the first test (cuts after page 1 and page 4),
    // but unsorted, duplicated, and containing an out-of-range cut.
    const job: Job = { op: 'split', sources: [await doc(src)], outputs, cuts: [3, 0, 3, 99] }

    await pdfEngine.run(job, () => {})

    expect(await pdfPageMarks(outputs[0] as string)).toEqual([1])
    expect(await pdfPageMarks(outputs[1] as string)).toEqual([2, 3, 4])
    expect(await pdfPageMarks(outputs[2] as string)).toEqual([5, 6, 7])
  })
})
