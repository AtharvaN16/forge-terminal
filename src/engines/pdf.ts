import { randomBytes } from 'node:crypto'
import { readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { PDFDocument } from 'pdf-lib'
import { encryptedSource } from '../core/errors.js'
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
      default:
        throw new Error(`pdf engine cannot ${job.op}`)
    }
  },
}
