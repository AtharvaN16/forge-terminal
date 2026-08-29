import type { Job, Result, Warning } from './types.js'

export interface FileRef {
  path: string
  bytes: number
}

/**
 * What happened, as data.
 *
 * Rendered by `cli/report.ts` as lines and by `shell/blocks.tsx` as React, so
 * neither front end decides for itself what a result means. The two used to,
 * and disagreed: `report.ts` handled every `op` while the shell's
 * `describePdfResult` had no `convert` case, so a twenty-page render reported
 * a single filename.
 */
export interface ResultView {
  /**
   * Past tense, one word.
   *
   * Display text in `core/` deliberately: the alternative hands back `op` and
   * lets each front end map it to a word, which is the two-place switch this
   * type exists to remove. Safe here in a way a `hint` is not — both front
   * ends say "converted", but only one of them has a `--force` flag.
   */
  verb: string
  sources: FileRef[]
  /**
   * Every path written — twenty entries for a twenty-page render, not just the
   * first.
   *
   * Paths, not `FileRef`s: `Result` carries one `outputBytes` total and no
   * per-file breakdown, so pairing each path with a size would mean inventing
   * numbers. Callers that want a total read `outputBytes`.
   */
  outputs: string[]
  outputBytes: number
  /** Only when one source became one output, so a ratio means something. */
  size?: { from: number; to: number }
  warnings: Warning[]
}

/**
 * `compressAction.plan()` emits `op: 'convert'` jobs — `cli/execute.ts` asserts
 * exactly that before using one — so compress and convert are the same
 * operation and cannot be told apart by `op`. What separates them is whether
 * the target format is the source's own: a compress re-encodes in place, a
 * convert does not. `/convert jpeg → jpeg` at a lower quality therefore reads
 * as "compressed", which is accurate rather than a mislabelling.
 */
function verbFor(job: Job): string {
  switch (job.op) {
    case 'convert':
      return job.target === job.sources[0].format ? 'compressed' : 'converted'
    case 'remove-background':
      return 'background removed'
    case 'merge':
      return 'merged'
    case 'split':
      return 'split'
    case 'extract':
      return 'extracted'
    case 'delete':
      return 'deleted from'
    case 'rotate':
      return 'rotated'
    default: {
      /**
       * A new `op` fails to compile here, in one place, rather than silently
       * mislabelling in whichever front end forgot it. This is what lets
       * `shell/blocks.tsx` drop its "cannot render a result yet" throw.
       */
      const unhandled: never = job
      throw new Error(`describeResult has no verb for ${JSON.stringify(unhandled)}`)
    }
  }
}

export function describeResult(result: Result): ResultView {
  const { job } = result
  const sources = job.sources.map((s) => ({ path: s.path, bytes: s.bytes }))

  // A ratio only means something when one file became one file. A twenty-page
  // render has no "before" to compare each output against.
  const only = sources.length === 1 && job.outputs.length === 1 ? sources[0] : undefined

  return {
    verb: verbFor(job),
    sources,
    outputs: [...job.outputs],
    outputBytes: result.outputBytes,
    ...(only ? { size: { from: only.bytes, to: result.outputBytes } } : {}),
    warnings: result.warnings,
  }
}
