import { isForgeError } from '../core/errors.js'
import type { FormatId, Job, SourceInfo } from '../core/types.js'
import { imageEngine } from './image.js'
import { mupdfEngine } from './mupdf.js'
import { pdfEngine } from './pdf.js'
import type { Engine } from './types.js'

// Order matters: imageEngine declines a PDF quickly, pdfEngine probes it
// successfully, and mupdfEngine never probes — it must stay last.
export const ENGINES: Engine[] = [imageEngine, pdfEngine, mupdfEngine]

export function engineForSource(format: FormatId): Engine | undefined {
  return ENGINES.find((e) => e.reads.has(format))
}

export function engineForTarget(format: FormatId): Engine | undefined {
  return ENGINES.find((e) => e.writes.has(format))
}

/**
 * The engine that runs a job.
 *
 * A conversion matches on **both ends**. Matching on the target alone was
 * correct while exactly one engine wrote each format; the moment a second
 * PDF-capable engine writes JPEG, `writes.has('jpeg')` stops identifying
 * anything — the image engine would win a PDF→JPEG job and then fail on a
 * source it cannot read. Every other operation still routes by `ops`,
 * because a page operation has no target format.
 */
export function engineForJob(job: Job): Engine | undefined {
  if (job.op === 'convert') {
    const from = job.sources[0].format
    return ENGINES.find((e) => e.reads.has(from) && e.writes.has(job.target))
  }
  return ENGINES.find((e) => e.ops.has(job.op))
}

/**
 * Probing is engine-agnostic: the first engine that can read the file wins.
 *
 * When every engine declines, the error that surfaces is the first
 * `ForgeError` seen rather than whichever engine happened to be last: only
 * `imageEngine` classifies generic path failures (missing, unreadable,
 * corrupt) into a specific, well-worded `ForgeError`, and it is tried first.
 * A later engine's unclassified error (e.g. `pdf-lib` throwing a raw parse
 * error on a non-PDF file) must not clobber that with something less useful.
 */
export async function probe(path: string): Promise<SourceInfo> {
  let lastError: unknown
  for (const engine of ENGINES) {
    try {
      return await engine.probe(path)
    } catch (e) {
      if (!isForgeError(lastError)) lastError = e
    }
  }
  throw lastError
}
