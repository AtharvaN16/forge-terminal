import { isForgeError } from '../core/errors.js'
import type { FormatId, Job, SourceInfo } from '../core/types.js'
import { imageEngine } from './image.js'
import { pdfEngine } from './pdf.js'
import type { Engine } from './types.js'

export const ENGINES: Engine[] = [imageEngine, pdfEngine]

export function engineForSource(format: FormatId): Engine | undefined {
  return ENGINES.find((e) => e.reads.has(format))
}

export function engineForTarget(format: FormatId): Engine | undefined {
  return ENGINES.find((e) => e.writes.has(format))
}

/**
 * The engine that runs a job. Convert routes by target format; every other
 * operation routes by op, because a page operation has no target format.
 */
export function engineForJob(job: Job): Engine | undefined {
  if (job.op === 'convert') return ENGINES.find((e) => e.writes.has(job.target))
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
