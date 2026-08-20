import { readFile, stat } from 'node:fs/promises'
import { PDFDocument } from 'pdf-lib'
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

export const pdfEngine: Engine = {
  id: 'pdf',
  reads: READS,
  writes: WRITES,
  ops: new Set<Job['op']>(['merge', 'split', 'extract', 'delete', 'rotate']),
  probe,
  // The five page operations are declared above so engineForJob routes to
  // this engine, but each one's actual implementation arrives in tasks 6-9.
  // Until then this engine exists to be probed with.
  async run(_job: Job, _onPhase: (p: Progress) => void): Promise<Result> {
    throw new Error('the pdf engine does not implement this operation yet')
  },
}
