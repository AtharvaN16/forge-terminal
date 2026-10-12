import { dirname, join } from 'node:path'
import { expandTilde, type Preferences } from '../../config/preferences.js'
import { knownFolder } from '../../utils/known-folders.js'
import { lastSegment } from '../../utils/last-segment.js'
import type { SourceInfo } from '../types.js'
import type { OptionSpec, PathPreset } from './index.js'

/**
 * Names a path the way the built-in presets do, so a hoisted default is not
 * shown as a bare path when it happens to be one of them.
 */
function labelFor(path: string, sourceDir: string): string {
  if (path === sourceDir) return 'Same folder'
  if (path === knownFolder('Desktop')) return 'Desktop'
  if (path === knownFolder('Downloads')) return 'Downloads'
  if (path === join(sourceDir, 'converted')) return 'New subfolder'
  return lastSegment(path) || path
}

/**
 * Where a result can go, as Save as lists it: the configured default first,
 * then Desktop, the source's own folder and Downloads — and, for convert, a
 * new subfolder beside the source. One list for every action that writes, so
 * convert, compress and the page operations offer the same places.
 */
export function destinationOption(
  source: SourceInfo,
  prefs: Preferences,
  { subfolder = false }: { subfolder?: boolean } = {},
): Extract<OptionSpec, { kind: 'path' }> {
  const here = dirname(source.path)
  const preferred = expandTilde(prefs.defaultOutput)

  // The configured default leads, listed explicitly so that a default
  // pointing somewhere none of the built-ins cover still appears at all. When
  // it *is* one of them, the dedupe below collapses the pair and this entry
  // wins — which is why it carries the built-in's label rather than a path.
  const candidates: PathPreset[] = [
    { label: labelFor(preferred, here), path: preferred },
    { label: 'Desktop', path: knownFolder('Desktop') },
    { label: 'Same folder', path: here },
    { label: 'Downloads', path: knownFolder('Downloads') },
    ...(subfolder ? [{ label: 'New subfolder', path: join(here, 'converted') }] : []),
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
  return { kind: 'path', id: 'destination', label: 'Save to', default: preferred, presets }
}

/** A non-empty string answer, or nothing: how a page operation reads `destination` and `name`. */
export const answer = (v: unknown): string | undefined =>
  typeof v === 'string' && v !== '' ? v : undefined
