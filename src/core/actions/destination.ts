import { dirname, join } from 'node:path'
import { expandTilde, type Preferences } from '../../config/preferences.js'
import { knownFolder } from '../../utils/known-folders.js'
import { lastSegment } from '../../utils/last-segment.js'
import type { SourceInfo } from '../types.js'
import type { OptionSpec, PathPreset } from './index.js'

/** The row for the folder the source is in. */
export const SAME_LOCATION = 'Same location'
/** The row for a `converted` folder beside the source (convert only). */
export const NEW_SUBFOLDER = 'New subfolder'

/**
 * Names a path the way the built-in presets do, so a hoisted default is not
 * shown as a bare path when it happens to be one of them. The source's own
 * folder is named for that first: on the Desktop, its row is Same location.
 */
function labelFor(path: string, sourceDir: string | undefined): string {
  if (path === sourceDir) return SAME_LOCATION
  if (path === knownFolder('Desktop')) return 'Desktop'
  if (path === knownFolder('Downloads')) return 'Downloads'
  if (sourceDir !== undefined && path === join(sourceDir, 'converted')) return NEW_SUBFOLDER
  return lastSegment(path) || path
}

/**
 * Where a result can go, as Save as lists it: the configured default first,
 * then where the last file was saved, Desktop, the source's own folder and
 * Downloads — and, for convert, a new subfolder beside the source. One list
 * for every action that writes, so convert, compress and the page operations
 * offer the same places.
 */
export function destinationOption(
  source: SourceInfo,
  prefs: Preferences,
  opts: { subfolder?: boolean } = {},
): Extract<OptionSpec, { kind: 'path' }> {
  return destinationAt(dirname(source.path), prefs, opts)
}

/**
 * The same list from the source's folder, or with none: a YouTube link has
 * no folder of its own, so it gets no Same location (or subfolder) row.
 */
export function destinationAt(
  here: string | undefined,
  prefs: Preferences,
  { subfolder = false }: { subfolder?: boolean } = {},
): Extract<OptionSpec, { kind: 'path' }> {
  const preferred = expandTilde(prefs.defaultOutput)
  const last = prefs.lastOutput ? expandTilde(prefs.lastOutput) : undefined
  const named = (path: string): PathPreset => ({ label: labelFor(path, here), path })

  // The configured default leads, listed explicitly so that a default
  // pointing somewhere none of the built-ins cover still appears at all. When
  // it *is* one of them, the dedupe below collapses the pair and this entry
  // wins — which is why it carries the built-in's label rather than a path.
  // Each named by `labelFor`, so the source's folder is Same location
  // wherever it lands, and wins the slot of the place it happens to be.
  const candidates: PathPreset[] = [
    named(preferred),
    ...(last ? [named(last)] : []),
    named(knownFolder('Desktop')),
    ...(here === undefined ? [] : [{ label: SAME_LOCATION, path: here }]),
    named(knownFolder('Downloads')),
    ...(subfolder && here !== undefined
      ? [{ label: NEW_SUBFOLDER, path: join(here, 'converted') }]
      : []),
  ]
  // Two presets can resolve to the identical folder — e.g. "Same folder" and
  // "Downloads" collide whenever the source file already lives in
  // ~/Downloads. Rows are keyed by path, so an undeduped collision is not
  // cosmetic: React treats it as two components sharing one identity and
  // refuses to render reliably. Keep the earlier (more specific) preset.
  const seen = new Set<string>()
  const presets = candidates.filter((preset) => {
    if (seen.has(preset.path)) return false
    seen.add(preset.path)
    return true
  })
  return {
    kind: 'path',
    id: 'destination',
    label: 'Save to',
    default: preferred,
    presets,
    ...(last && last !== preferred ? { last } : {}),
  }
}

/** A non-empty string answer, or nothing: how a page operation reads `destination` and `name`. */
export const answer = (v: unknown): string | undefined =>
  typeof v === 'string' && v !== '' ? v : undefined
