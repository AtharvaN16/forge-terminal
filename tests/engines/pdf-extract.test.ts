import { basename, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { extractAction } from '../../src/core/actions/extract.js'
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

/**
 * The output names and the pages actually written have to come from one
 * ordering. `extractOutputPaths` names a file per selected page and the
 * engine copies the pages itself — a selection that arrives in any other
 * order (the shell's page grid appends in press order) previously named
 * files after pages they did not contain.
 */
describe('separate extract names and content agree', () => {
  it('names each output after the page it actually holds, whatever order the pages arrive in', async () => {
    const dir = await makeTempDir()
    // Page n carries mark n, so the mark read back from `doc-pN.pdf` must be N.
    const src = await makeMarkedPdf(dir, 'doc.pdf', MARKS)
    const planned = extractAction.plan([await doc(src)], { pages: [4, 1], separate: 'many' })
    const job = planned[0] as Job
    await pdfEngine.run(job, () => {})

    for (const output of job.outputs) {
      const claimed = Number(/-p(\d+)\.pdf$/.exec(basename(output))?.[1])
      expect(await pdfPageMarks(output)).toEqual([claimed])
    }
  })

  it('writes the pages in ascending order however `job.pages` is ordered', async () => {
    const dir = await makeTempDir()
    const src = await makeMarkedPdf(dir, 'doc.pdf', MARKS)
    const outputs = [join(dir, 'first.pdf'), join(dir, 'second.pdf')]
    const job: Job = {
      op: 'extract',
      sources: [await doc(src)],
      outputs,
      pages: [4, 1],
      separate: true,
    }
    await pdfEngine.run(job, () => {})
    // outputs[i] is the i-th page in ascending order, not the i-th pressed.
    expect(await pdfPageMarks(outputs[0] as string)).toEqual([2])
    expect(await pdfPageMarks(outputs[1] as string)).toEqual([5])
  })
})
