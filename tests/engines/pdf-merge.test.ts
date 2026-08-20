import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { DocumentInfo, Job } from '../../src/core/types.js'
import { pdfEngine } from '../../src/engines/pdf.js'
import { probe } from '../../src/engines/registry.js'
import { makeMarkedPdf, makeTempDir, pdfPageCount, pdfPageMarks } from '../helpers/fixtures.js'

async function doc(path: string): Promise<DocumentInfo> {
  const info = await probe(path)
  if (info.kind !== 'document') throw new Error('expected a document')
  return info
}

describe('merge', () => {
  it('produces one document whose page count is the sum', async () => {
    const dir = await makeTempDir()
    const a = await makeMarkedPdf(dir, 'a.pdf', [1, 2, 3])
    const b = await makeMarkedPdf(dir, 'b.pdf', [4, 5])
    const out = join(dir, 'out.pdf')
    const job: Job = { op: 'merge', sources: [await doc(a), await doc(b)], outputs: [out] }

    const result = await pdfEngine.run(job, () => {})

    expect(await pdfPageCount(out)).toBe(5)
    expect(result.outputBytes).toBeGreaterThan(0)
  })

  it('keeps the pages in the order the sources were given', async () => {
    const dir = await makeTempDir()
    const a = await makeMarkedPdf(dir, 'a.pdf', [1, 2])
    const b = await makeMarkedPdf(dir, 'b.pdf', [3])
    const out = join(dir, 'out.pdf')
    const job: Job = { op: 'merge', sources: [await doc(b), await doc(a)], outputs: [out] }

    await pdfEngine.run(job, () => {})

    // b first, because that is the order the job listed them.
    expect(await pdfPageMarks(out)).toEqual([3, 1, 2])
  })

  it('merges a single document into a copy', async () => {
    const dir = await makeTempDir()
    const a = await makeMarkedPdf(dir, 'a.pdf', [1, 2])
    const out = join(dir, 'out.pdf')
    await pdfEngine.run({ op: 'merge', sources: [await doc(a)], outputs: [out] }, () => {})
    expect(await pdfPageMarks(out)).toEqual([1, 2])
  })

  it('reports each source as it is read', async () => {
    const dir = await makeTempDir()
    const a = await makeMarkedPdf(dir, 'a.pdf', [1])
    const b = await makeMarkedPdf(dir, 'b.pdf', [2])
    const out = join(dir, 'out.pdf')
    const seen: string[] = []
    await pdfEngine.run(
      { op: 'merge', sources: [await doc(a), await doc(b)], outputs: [out] },
      (p) => seen.push(p.phase),
    )
    expect(seen).toContain('reading')
    expect(seen).toContain('writing')
  })

  it('refuses an encrypted source with a message that names the fix', async () => {
    const dir = await makeTempDir()
    const a = await makeMarkedPdf(dir, 'a.pdf', [1])
    const info = await doc(a)
    const encrypted: DocumentInfo = { ...info, encrypted: true }
    const out = join(dir, 'out.pdf')
    await expect(
      pdfEngine.run({ op: 'merge', sources: [encrypted], outputs: [out] }, () => {}),
    ).rejects.toThrow(/password/i)
  })
})
