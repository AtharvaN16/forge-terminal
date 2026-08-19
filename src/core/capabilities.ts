import { ENGINES } from '../engines/registry.js'
import { FORMATS } from './formats.js'
import type { FormatId, SourceInfo } from './types.js'

export interface Target {
  id: FormatId
  label: string
  hint: string
  lossy: boolean
}

function sortByRegistryOrder(ids: FormatId[]): FormatId[] {
  const order = Object.keys(FORMATS) as FormatId[]
  return [...ids].sort((a, b) => order.indexOf(a) - order.indexOf(b))
}

/**
 * The single source of truth for "what can this file become". Nothing else in
 * the codebase may hardcode a format list — a new engine has to change the
 * menu everywhere at once, and this is how that happens.
 */
export function targetIdsFor(source: SourceInfo): FormatId[] {
  const ids = new Set<FormatId>()
  for (const engine of ENGINES) {
    if (!engine.reads.has(source.format)) continue
    for (const id of engine.writes) ids.add(id)
  }
  return sortByRegistryOrder([...ids])
}

export function targetsFor(source: SourceInfo): Target[] {
  return targetIdsFor(source).map((id) => ({
    id,
    label: FORMATS[id].label,
    hint: FORMATS[id].hint,
    lossy: FORMATS[id].lossy,
  }))
}

export function canConvert(source: SourceInfo, target: FormatId): boolean {
  return targetIdsFor(source).includes(target)
}

export function readableFormats(): FormatId[] {
  const ids = new Set<FormatId>()
  for (const engine of ENGINES) for (const id of engine.reads) ids.add(id)
  return sortByRegistryOrder([...ids])
}

export function writableFormats(): FormatId[] {
  const ids = new Set<FormatId>()
  for (const engine of ENGINES) for (const id of engine.writes) ids.add(id)
  return sortByRegistryOrder([...ids])
}
