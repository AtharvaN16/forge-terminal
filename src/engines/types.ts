import type { FormatId, Job, Progress, Result, SourceInfo } from '../core/types.js'

/**
 * The seam that lets PDF, video and audio engines arrive later without the
 * UI changing. Everything the UI knows about capability comes from reads/writes.
 */
export interface Engine {
  id: string
  reads: ReadonlySet<FormatId>
  writes: ReadonlySet<FormatId>
  /** Which operations this engine implements. */
  ops: ReadonlySet<Job['op']>
  probe(path: string): Promise<SourceInfo>
  run(job: Job, onPhase: (progress: Progress) => void): Promise<Result>
}
