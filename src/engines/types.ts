import type { ConvertOptions, FormatId, Job, Progress, Result, SourceInfo } from '../core/types.js'

/**
 * How an engine can be searched toward a byte target.
 *
 * Two-phase on purpose. `measurer()` does the expensive setup once — reading a
 * scan off disk, say — and hands back a closure the search calls up to eight
 * times per rung against bytes already in memory. Collapsing it into a single
 * `measure(job, options)` would re-read the file on every attempt, which is
 * work the user waits through for nothing.
 */
export interface Measurer {
  /**
   * Settings to try, coarsest lever first. An image engine returns one rung
   * because an image has one lever; a document engine returns a resolution
   * ladder.
   */
  ladder: Array<Partial<ConvertOptions>>
  /** Encodes in memory at these settings and resolves the byte length. Writes nothing. */
  measure(options: ConvertOptions): Promise<number>
}

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
  /**
   * Present only on engines that can be searched toward a byte target.
   *
   * Absent means "cannot be compressed to a size", which `runPlan` turns into
   * a refusal rather than a crash. Returns `undefined` for a job this engine
   * could run but cannot measure — a page operation has no quality dial.
   */
  measurer?(job: Job): Promise<Measurer | undefined>
}
