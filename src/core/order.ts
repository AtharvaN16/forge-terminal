import { basename } from 'node:path'
import type { SourceInfo } from './types.js'

export type SortMode = 'dropped' | 'name' | 'newest' | 'oldest'

const CYCLE: SortMode[] = ['dropped', 'name', 'newest', 'oldest']

export function nextSortMode(mode: SortMode): SortMode {
  return CYCLE[(CYCLE.indexOf(mode) + 1) % CYCLE.length] as SortMode
}

/**
 * Move one item to a new position, clamping at both ends.
 *
 * Clamping rather than wrapping: a row dragged past the top should stop
 * there, not reappear at the bottom, which is what every list in every other
 * application does.
 */
export function moveItem<T>(list: T[], from: number, to: number): T[] {
  const target = Math.min(Math.max(to, 0), list.length - 1)
  if (from === target || from < 0 || from >= list.length) return [...list]
  const next = [...list]
  const [item] = next.splice(from, 1)
  if (item === undefined) return [...list]
  next.splice(target, 0, item)
  return next
}

/**
 * Order for merge.
 *
 * Hand-reordering thirty scans is not a thing anyone should do, and a glob
 * already arrives in name order — this makes that explicit and reversible.
 * `dropped` is identity, which is what makes the cycle safe to spin through.
 */
export function sortSources(
  sources: SourceInfo[],
  mode: SortMode,
  mtimes: Map<string, number>,
): SourceInfo[] {
  const time = (s: SourceInfo) => mtimes.get(s.path) ?? 0
  switch (mode) {
    case 'dropped':
      return [...sources]
    case 'name':
      return [...sources].sort((a, b) => basename(a.path).localeCompare(basename(b.path)))
    case 'newest':
      return [...sources].sort((a, b) => time(b) - time(a))
    case 'oldest':
      return [...sources].sort((a, b) => time(a) - time(b))
  }
}
