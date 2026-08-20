import { randomBytes } from 'node:crypto'
import { readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { PDFDocument } from 'pdf-lib'
import { emptySelection, encryptedSource } from '../core/errors.js'
import { cutsToRanges } from '../core/pages.js'
import type { DocumentInfo, FormatId, Job, Progress, Result } from '../core/types.js'
import type { Engine } from './types.js'

const READS: ReadonlySet<FormatId> = new Set<FormatId>(['pdf'])
const WRITES: ReadonlySet<FormatId> = new Set<FormatId>(['pdf'])

/**
 * Load a document for inspection.
 *
 * `ignoreEncryption` is deliberate: an encrypted PDF must probe successfully
 * and report `encrypted: true`, so the flow can refuse it with a message that
 * names the fix. Failing here instead would surface as "not a format Forge
 * reads", which is both wrong and unactionable.
 */
async function load(path: string): Promise<PDFDocument> {
  return PDFDocument.load(await readFile(path), { ignoreEncryption: true })
}

async function probe(path: string): Promise<DocumentInfo> {
  const doc = await load(path)
  const { size } = await stat(path)
  return {
    kind: 'document',
    path,
    format: 'pdf',
    bytes: size,
    pages: doc.getPageCount(),
    encrypted: doc.isEncrypted,
  }
}

/**
 * Invariant 6: temp file, then rename. Never a partial file at the real path.
 *
 * Shared by every page operation this engine implements — split, extract,
 * delete and rotate all write their output through this same function, so
 * its atomicity and its cleanup-on-failure only need to be correct once.
 */
async function writeAtomic(path: string, bytes: Uint8Array): Promise<number> {
  const temp = `${path}.${randomBytes(6).toString('hex')}.tmp`
  try {
    await writeFile(temp, bytes)
    await rename(temp, path)
    return bytes.byteLength
  } catch (e) {
    await rm(temp, { force: true })
    throw e
  }
}

/**
 * Refuses a password-protected source before any page operation touches it.
 * `probe` reports `encrypted` with `ignoreEncryption: true`, so this is the
 * one place that turns "known to be locked" into a refusal that names the
 * fix, rather than letting pdf-lib fail opaquely partway through a merge,
 * split, extract, delete or rotate.
 */
function assertUnencrypted(sources: readonly { path: string; encrypted?: boolean }[]): void {
  for (const s of sources) {
    if (s.encrypted) throw encryptedSource(s.path)
  }
}

async function merge(
  job: Extract<Job, { op: 'merge' }>,
  onPhase: (p: Progress) => void,
): Promise<Result> {
  assertUnencrypted(job.sources.filter((s) => s.kind === 'document'))
  const out = await PDFDocument.create()

  for (const source of job.sources) {
    onPhase({ phase: 'reading' })
    const src = await load(source.path)
    const pages = await out.copyPages(src, src.getPageIndices())
    for (const page of pages) out.addPage(page)
  }

  onPhase({ phase: 'writing' })
  const bytes = await out.save()
  const outputBytes = await writeAtomic(job.outputs[0], bytes)
  return { job, outputBytes, warnings: [] }
}

/**
 * `cutsToRanges` silently normalises its input (dedupes, sorts, drops
 * out-of-range cuts) rather than validating it, so a `cuts` list that arrived
 * unsorted or with duplicates still produces a correct partition here.
 *
 * Every output is written before any is kept. A split that fails half way
 * through must not leave a folder of partial results (invariant 6).
 */
async function split(
  job: Extract<Job, { op: 'split' }>,
  onPhase: (p: Progress) => void,
): Promise<Result> {
  const source = job.sources[0]
  assertUnencrypted([source])

  onPhase({ phase: 'reading' })
  const src = await load(source.path)
  const ranges = cutsToRanges(job.cuts, src.getPageCount())

  const written: string[] = []
  let outputBytes = 0
  try {
    for (const [i, range] of ranges.entries()) {
      const out = await PDFDocument.create()
      const indices = Array.from({ length: range.to - range.from + 1 }, (_, n) => range.from + n)
      const pages = await out.copyPages(src, indices)
      for (const page of pages) out.addPage(page)

      const path = job.outputs[i]
      if (path === undefined) {
        throw new Error(
          `split produced ${ranges.length} parts but was given ${job.outputs.length} outputs`,
        )
      }
      outputBytes += await writeAtomic(path, await out.save())
      written.push(path)
      onPhase({ phase: 'page', done: i + 1, total: ranges.length })
    }
  } catch (e) {
    await Promise.all(written.map((p) => rm(p, { force: true })))
    throw e
  }

  return { job, outputBytes, warnings: [] }
}

/** Copy an explicit page list into a new document, in the order given. */
async function pagesInto(src: PDFDocument, indices: number[]): Promise<Uint8Array> {
  const out = await PDFDocument.create()
  const pages = await out.copyPages(src, indices)
  for (const page of pages) out.addPage(page)
  return out.save()
}

async function extract(
  job: Extract<Job, { op: 'extract' }>,
  onPhase: (p: Progress) => void,
): Promise<Result> {
  const source = job.sources[0]
  assertUnencrypted([source])
  if (job.pages.length === 0) {
    throw emptySelection('That extract selects no pages.')
  }

  onPhase({ phase: 'reading' })
  const src = await load(source.path)
  const wanted = [...new Set(job.pages)].sort((a, b) => a - b)

  const written: string[] = []
  let outputBytes = 0
  try {
    if (!job.separate) {
      onPhase({ phase: 'writing' })
      const path = job.outputs[0] as string
      outputBytes = await writeAtomic(path, await pagesInto(src, wanted))
      written.push(path)
    } else {
      for (const [i, page] of wanted.entries()) {
        const path = job.outputs[i] as string
        outputBytes += await writeAtomic(path, await pagesInto(src, [page]))
        written.push(path)
        onPhase({ phase: 'page', done: i + 1, total: wanted.length })
      }
    }
  } catch (e) {
    await Promise.all(written.map((p) => rm(p, { force: true })))
    throw e
  }

  return { job, outputBytes, warnings: [] }
}

/**
 * Exact inverse of `extract`: the kept set is everything not in `job.pages`.
 * Refuses to write an empty document, the same way `extract` refuses an
 * empty selection — deleting every page is the delete-side of that case.
 */
async function deletePages(
  job: Extract<Job, { op: 'delete' }>,
  onPhase: (p: Progress) => void,
): Promise<Result> {
  const source = job.sources[0]
  assertUnencrypted([source])

  onPhase({ phase: 'reading' })
  const src = await load(source.path)
  const drop = new Set(job.pages)
  const keep = src.getPageIndices().filter((i) => !drop.has(i))
  if (keep.length === 0) {
    throw emptySelection('That would delete every page.')
  }

  onPhase({ phase: 'writing' })
  const outputBytes = await writeAtomic(job.outputs[0], await pagesInto(src, keep))
  return { job, outputBytes, warnings: [] }
}

export const pdfEngine: Engine = {
  id: 'pdf',
  reads: READS,
  writes: WRITES,
  ops: new Set<Job['op']>(['merge', 'split', 'extract', 'delete', 'rotate']),
  probe,
  async run(job: Job, onPhase: (p: Progress) => void): Promise<Result> {
    switch (job.op) {
      case 'merge':
        return merge(job, onPhase)
      case 'split':
        return split(job, onPhase)
      case 'extract':
        return extract(job, onPhase)
      case 'delete':
        return deletePages(job, onPhase)
      default:
        throw new Error(`pdf engine cannot ${job.op}`)
    }
  },
}
