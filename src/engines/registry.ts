import type { FormatId, SourceInfo } from '../core/types.js'
import { imageEngine } from './image.js'
import type { Engine } from './types.js'

export const ENGINES: Engine[] = [imageEngine]

export function engineForSource(format: FormatId): Engine | undefined {
  return ENGINES.find((e) => e.reads.has(format))
}

export function engineForTarget(format: FormatId): Engine | undefined {
  return ENGINES.find((e) => e.writes.has(format))
}

/** Probing is engine-agnostic: the first engine that can read the file wins. */
export async function probe(path: string): Promise<SourceInfo> {
  let lastError: unknown
  for (const engine of ENGINES) {
    try {
      return await engine.probe(path)
    } catch (e) {
      lastError = e
    }
  }
  throw lastError
}
