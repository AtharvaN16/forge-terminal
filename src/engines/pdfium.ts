import type { PDFiumDocument } from '@hyzyla/pdfium'
import { PDFiumLibrary } from '@hyzyla/pdfium'
import type { FormatId, Job, Progress, Result, SourceInfo } from '../core/types.js'
import type { Engine } from './types.js'

const READS: ReadonlySet<FormatId> = new Set<FormatId>(['pdf'])
const WRITES: ReadonlySet<FormatId> = new Set<FormatId>(['jpeg', 'png'])
const OPS: ReadonlySet<Job['op']> = new Set<Job['op']>(['convert'])

// PDFiumLibrary.init() compiles the wasm module. It costs real time and there
// is no reason to pay it per file, so it is memoised for the process. The
// promise itself is cached, not the resolved value, so two concurrent callers
// share one initialisation rather than racing two.
let library: Promise<Awaited<ReturnType<typeof PDFiumLibrary.init>>> | undefined
function getLibrary() {
  library ??= PDFiumLibrary.init()
  return library
}

/**
 * Open a PDF for reading.
 *
 * `password` is for ENCRYPTED SOURCES ONLY — PDFium can read a locked document
 * but cannot write one, so there is no unlock feature here (ruling R7). The
 * value must never be logged, returned, or attached to an error (invariant 8).
 */
export async function openPdf(bytes: Uint8Array, password?: string): Promise<PDFiumDocument> {
  const lib = await getLibrary()
  return await lib.loadDocument(bytes, password)
}

export const pdfiumEngine: Engine = {
  id: 'pdfium',
  reads: READS,
  writes: WRITES,
  ops: OPS,
  probe(): Promise<SourceInfo> {
    // engines/pdf.ts already classifies PDFs by content and is registered
    // first, so this is never reached. It throws rather than returning a
    // wrong answer if the registration order is ever changed.
    throw new Error('pdfium does not probe; engines/pdf.ts classifies PDFs')
  },
  async run(_job: Job, _onProgress: (p: Progress) => void): Promise<Result> {
    throw new Error('not implemented') // Task 3
  },
}
