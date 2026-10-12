import { FORMATS } from '../core/formats.js'
import type { InputFailure } from '../core/resolve.js'
import type { SourceInfo } from '../core/types.js'
import { formatBytes } from '../core/units.js'
import { displayName } from '../utils/display-path.js'
import type { ShellMode } from './theme.js'

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

/** One staged file as the drop zone draws it. */
export interface StagedFile {
  name: string
  /** The format's label, for the card's top edge: "PNG", "PDF". */
  tag: string
  size: string
  /** The card's second row: "2756×774 · 122 KB · transparent". */
  facts: string
}

/**
 * What the drop zone shows for the stage
 * (docs/superpowers/specs/2026-10-11-forge-drop-zone-design.md).
 */
export interface StagedView {
  files: StagedFile[]
  /** The list's headline: "3 images", "3 PDFs", "8 files". */
  headline: string
  /** Every staged file's size together. */
  total: string
  /** How many of the last `files` arrived in the latest drop and wear the band; 0 for none. */
  fresh: number
}

const allPdf = (sources: SourceInfo[]) => sources.every((s) => s.format === 'pdf')

/** A source's facts, as the file card says them. */
export function cardFacts(source: SourceInfo): string {
  return (
    source.kind === 'image'
      ? [
          `${source.width}×${source.height}`,
          formatBytes(source.bytes),
          // Only claimed when the source genuinely carries alpha — saying
          // "transparent" about an opaque JPEG would be a plain lie about the file.
          ...(source.hasAlpha ? ['transparent'] : []),
        ]
      : [
          // 0 means "unknown" (a `.doc` file, or a `.docx` that never cached a
          // page count) — showing "0 pages" would read as a real, wrong fact.
          ...(source.pages > 0 ? [`${source.pages} pages`] : []),
          formatBytes(source.bytes),
        ]
  ).join(' · ')
}

export function stagedView(stage: Stage, fresh: number): StagedView {
  const { sources } = stage
  const noun = sources.every((s) => s.kind === 'image')
    ? 'images'
    : allPdf(sources)
      ? 'PDFs'
      : 'files'
  return {
    files: sources.map((s) => ({
      name: displayName(s.path),
      tag: FORMATS[s.format].label,
      size: formatBytes(s.bytes),
      facts: cardFacts(s),
    })),
    headline: `${sources.length} ${noun}`,
    total: formatBytes(sources.reduce((n, s) => n + s.bytes, 0)),
    fresh: Math.max(0, Math.min(fresh, sources.length)),
  }
}

/** The one row under the home field while something is staged, if any. */
export type UnderField =
  | { kind: 'left-out'; count: number; name: string; reason: string; more: number }
  | { kind: 'note'; text: string }

/**
 * Files that could not be read win (R1, in `fail` red); otherwise several
 * files that ↵ cannot act on yet get the note saying batch is coming.
 */
export function underField(stage: Stage, mode: ShellMode): UnderField | undefined {
  const [first] = stage.failures
  if (first) {
    return {
      kind: 'left-out',
      count: stage.failures.length,
      name: displayName(first.path),
      reason: first.error.title.toLowerCase(),
      more: stage.failures.length - 1,
    }
  }
  if (stage.sources.length < 2 || stagedVerb(stage, mode) !== null) return undefined
  return {
    kind: 'note',
    text: `→ converting several files at once is coming${allPdf(stage.sources) ? ' · /pdf merges them' : ''}`,
  }
}

/**
 * What ↵ does on a home holding the stage, as the key row's word: the mode's
 * own verb for one file, "pdf" for several PDFs in pdf mode, and nothing for
 * several otherwise — until batch conversion exists.
 */
export function stagedVerb(stage: Stage, mode: ShellMode): string | null {
  if (stage.sources.length === 1) return mode
  if (mode === 'pdf' && stage.sources.length > 1 && allPdf(stage.sources)) return 'pdf'
  return null
}
