import { dirname, sep } from 'node:path'
import { displayName } from '../utils/display-path.js'
import type { InputFailure } from './resolve.js'
import type { Result } from './types.js'

/**
 * The notification a long run posts when it ends, for someone who went to
 * another app while it ran (decided 2026-10-25). Data only: posting it, and
 * whether the terminal is in front, is `menu/notify.ts`'s.
 *
 * The title is the mode and how it went ("Convert finished 10 of 12 files"),
 * the body what was made or the first thing that went wrong — the shape the
 * right-click menu's own notifications already have.
 */

/** A run you sat through needs no notice: only one this long gets one. */
export const NOTICE_AFTER_MS = 20_000

export const noticeWorthy = (elapsedMs: number) => elapsedMs >= NOTICE_AFTER_MS

export interface Finished {
  /** One entry per job that worked: the files it read, the files it wrote. */
  made: { from: string[]; to: string[] }[]
  /** One per input that failed or was refused; `path` is '' when it was no one file's. */
  failed: { path: string; message: string }[]
}

export interface Notice {
  title: string
  body: string
}

/** A run's results and failures, as `finishNotice` reads them. */
export function finishedOf(results: Result[], failures: InputFailure[]): Finished {
  return {
    made: results.map((r) => ({ from: r.job.sources.map((s) => s.path), to: r.job.outputs })),
    failed: failures.map((f) => ({ path: f.path, message: f.error.message })),
  }
}

const files = (paths: string[]) =>
  paths.length === 1 ? displayName(paths[0] as string) : `${paths.length} files`

/** The deepest folder every path is in. */
function sharedFolder(paths: string[]): string {
  const [first, ...rest] = paths.map((p) => dirname(p).split(sep))
  let parts = first ?? []
  for (const other of rest) {
    let i = 0
    while (i < parts.length && parts[i] === other[i]) i++
    parts = parts.slice(0, i)
  }
  return parts.join(sep) || sep
}

/** `verb` is the mode's name as home's tabs say it ("Convert", "PDF"), or a preset's. */
export function finishNotice(verb: string, run: Finished): Notice | undefined {
  const total = run.made.length + run.failed.length
  if (total === 0) return undefined
  const [failure] = run.failed
  const why = failure && (failure.path ? `${displayName(failure.path)}: ` : '') + failure.message
  if (total === 1) {
    const [one] = run.made
    if (one) return { title: `${verb} finished`, body: `${files(one.from)} → ${files(one.to)}` }
    return { title: `${verb} failed`, body: why ?? '' }
  }
  const title = `${verb} finished ${run.made.length} of ${total} files`
  if (why !== undefined) return { title, body: why }
  return {
    title,
    body: `Saved to ${displayName(sharedFolder(run.made.flatMap((m) => m.to)))}`,
  }
}
