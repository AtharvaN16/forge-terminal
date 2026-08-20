import { readFile, rm } from 'node:fs/promises'
import type { PDFiumDocument } from '@hyzyla/pdfium'
import { PDFiumLibrary } from '@hyzyla/pdfium'
import sharp from 'sharp'
import { writeAtomic } from '../core/atomic.js'
import { FORMATS } from '../core/formats.js'
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
  /**
   * Rasterises the selected pages of a PDF to JPEG or PNG, one output file
   * per page.
   *
   * `job.options.pages` is 0-based, ascending and already deduped by
   * whatever built the job (`core/pages.ts`'s `normalisePages`) — this loop
   * writes `outputs[i]` from `pages[i]` verbatim and never sorts or dedupes.
   * Phase 3's worst defect was exactly that shape: the engine reordering
   * while the output naming did not, so a requested page silently became a
   * different one on disk.
   *
   * A fresh `doc.getPage(index)` is taken for every render rather than
   * reused: a `PDFiumPage` is single-use, and calling `.render()` twice on
   * the same page object corrupts the wasm heap (`RuntimeError: table index
   * is out of bounds`) instead of raising a catchable error.
   */
  async run(job: Job, onPhase: (p: Progress) => void): Promise<Result> {
    if (job.op !== 'convert') throw new Error(`pdfium cannot ${job.op}`)
    const source = job.sources[0]
    if (source.kind !== 'document') {
      throw new Error('the pdfium engine can only rasterise a document source')
    }
    const dpi = job.options.dpi ?? 150
    // No `pages` means "convert this PDF" — read as every page. `outputs`
    // promises at least one file ([string, ...string[]]); defaulting to an
    // empty selection would report success while writing nothing.
    const pages = job.options.pages ?? Array.from({ length: source.pages }, (_, i) => i)
    // A programmer error, not a user error: whatever built this job promised
    // one output per page and didn't keep that promise. Throwing here rather
    // than truncating to the shorter length is what stops `job.outputs[i]`
    // from silently reading past the end of a too-short array.
    if (pages.length !== job.outputs.length) {
      throw new Error(`pdfium was given ${pages.length} pages but ${job.outputs.length} outputs`)
    }
    const quality = job.options.quality ?? FORMATS[job.target].defaultQuality

    const doc = await openPdf(await readFile(source.path), job.options.password)
    try {
      const written: string[] = []
      let outputBytes = 0
      try {
        for (const [i, index] of pages.entries()) {
          // render({ render: 'bitmap' }) returns RGBA, not BGRA — measured by
          // spiking the library: a page painted R=51 G=102 B=229 produces
          // first pixel [51,102,230,255]. bitmap.data is handed to Sharp's
          // raw input unswapped; swapping the channels yields a visibly
          // wrong image that still passes every width/height assertion.
          const bitmap = await doc.getPage(index).render({ scale: dpi / 72, render: 'bitmap' })
          const image = sharp(Buffer.from(bitmap.data), {
            raw: { width: bitmap.width, height: bitmap.height, channels: 4 },
          })
          const bytes =
            job.target === 'png'
              ? await image.png().toBuffer()
              : await image
                  .flatten({ background: job.options.background })
                  .jpeg({ quality, mozjpeg: true })
                  .toBuffer()

          // The arity guard above proves this index is in range, but
          // TypeScript can't carry that fact through a runtime-computed
          // index into a `[string, ...string[]]` tuple — under
          // `noUncheckedIndexedAccess` a non-literal index still widens to
          // `string | undefined`. The cast is what the guard buys back.
          const out = job.outputs[i] as string
          outputBytes += await writeAtomic(out, bytes)
          written.push(out)
          onPhase({ phase: 'page', done: i + 1, total: pages.length })
        }
      } catch (e) {
        // Invariant 6, extended for this phase: a multi-output job is
        // all-or-nothing. A rasterisation that fails at page 200 of 248
        // must not leave the first 199 behind — the same rule split() and
        // extract()'s separate mode already apply in engines/pdf.ts.
        await Promise.all(written.map((p) => rm(p, { force: true })))
        throw e
      }
      return { job, outputBytes, warnings: [] }
    } finally {
      // Frees the wasm document. Skipping it leaks the page buffers.
      doc.destroy()
    }
  },
}
