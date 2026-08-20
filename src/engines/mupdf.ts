import { readFile } from 'node:fs/promises'
import * as mupdf from 'mupdf'
import type { FormatId, Job, Progress, Result, SourceInfo } from '../core/types.js'
import type { Engine } from './types.js'

const READS: ReadonlySet<FormatId> = new Set<FormatId>(['pdf'])
const WRITES: ReadonlySet<FormatId> = new Set<FormatId>(['jpeg', 'png'])
/**
 * `'unlock'` is not yet a member of `Job['op']` — that lands with the Job
 * union change in the unlock task. The cast declares the capability this
 * engine will have once that lands, without adding an op literal here that
 * isn't this task's to add. No behaviour depends on it: `run` below throws
 * unconditionally regardless of which op a job carries.
 */
const OPS = new Set(['convert', 'unlock']) as ReadonlySet<Job['op']>

/**
 * Open a document for rendering.
 *
 * Shared by rasterisation and unlock so both reach mupdf the same way. A
 * password is supplied only by unlock; rendering an encrypted document is
 * refused before it gets here, by the action layer.
 */
export async function openPdf(path: string, password?: string) {
  const doc = mupdf.Document.openDocument(await readFile(path), 'application/pdf')
  if (password !== undefined && doc.needsPassword()) {
    doc.authenticatePassword(password)
  }
  return doc
}

export const mupdfEngine: Engine = {
  id: 'mupdf',
  reads: READS,
  writes: WRITES,
  ops: OPS,
  // Probing is handled by `engines/pdf.ts`, which is registered first and
  // already recognises a PDF by content. The registry takes the first engine
  // whose probe succeeds, so a second PDF prober would never run.
  probe(): Promise<SourceInfo> {
    throw new Error('the mupdf engine does not probe; engines/pdf.ts does')
  },
  async run(_job: Job, _onPhase: (p: Progress) => void): Promise<Result> {
    throw new Error('not implemented until task 3')
  },
}
