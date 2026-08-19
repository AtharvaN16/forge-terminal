import type { FormatId, Job, Phase, Result, SourceInfo } from '../core/types.js'

/**
 * The seam that lets PDF, video and audio engines arrive later without the
 * UI changing. Everything the UI knows about capability comes from reads/writes.
 */
export interface Engine {
  id: string
  reads: ReadonlySet<FormatId>
  writes: ReadonlySet<FormatId>
  probe(path: string): Promise<SourceInfo>
  convert(job: Job, onPhase: (phase: Phase) => void): Promise<Result>
}
