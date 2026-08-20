import type { InputFailure } from '../core/resolve.js'
import type { SourceInfo } from '../core/types.js'
import { formatBytes } from '../core/units.js'

export interface Stage {
  sources: SourceInfo[]
  failures: InputFailure[]
}

export function emptyStage(): Stage {
  return { sources: [], failures: [] }
}

export function clearStage(): Stage {
  return emptyStage()
}

/**
 * Drops accumulate.
 *
 * Building a merge list means adding files one at a time, so a second drop
 * has to append rather than replace. Converting `a.jpg` and then dropping
 * `b.jpg` still starts fresh, because completing an action clears the stage —
 * that is where the replace behaviour lives, not here.
 */
export function addToStage(stage: Stage, sources: SourceInfo[], failures: InputFailure[]): Stage {
  const seen = new Set(stage.sources.map((s) => s.path))
  const added = sources.filter((s) => !seen.has(s.path))
  return {
    sources: [...stage.sources, ...added],
    failures: [...stage.failures, ...failures],
  }
}

export function stageSummary(stage: Stage): string {
  const { sources } = stage
  const bytes = sources.reduce((n, s) => n + s.bytes, 0)
  const pages = sources.reduce((n, s) => n + (s.kind === 'document' ? s.pages : 0), 0)
  const parts = [`${sources.length} ${sources.length === 1 ? 'file' : 'files'}`]
  if (pages > 0) parts.push(`${pages} ${pages === 1 ? 'page' : 'pages'}`)
  parts.push(formatBytes(bytes))
  return parts.join(' · ')
}
