import { statSync } from 'node:fs'
import { dirname } from 'node:path'
import { expandTilde } from '../config/preferences.js'
import type { Choice, PathPreset } from '../core/actions/index.js'
import { FORMATS } from '../core/formats.js'
import { fitName } from '../core/output-path.js'
import { displayName } from '../utils/display-path.js'
import { unescapePath } from '../utils/unescape-path.js'

/** The value of the one row that says nothing matched. Never a folder. */
export const NO_MATCH = '__no-match__'

/**
 * Text that names a place rather than filtering the list: what a drag from
 * Finder pastes (`/…`), a home-relative path (`~/…`), or a relative one.
 */
const PATHLIKE = /^[~/.]/

/**
 * The same on Windows, plus what a path looks like there: a drive (`C:\…`,
 * `C:/…`), a UNC share (`\\server\…`) or a root-relative path (`\…`).`unescapePath` has
 * already stripped the quotes Windows Terminal puts round a dropped path and
 * expanded `~`, so `~/out` arrives here as `C:\Users\…\out`.
 */
const PATHLIKE_WIN32 = /^(?:[~/.\\]|[A-Za-z]:[\\/])/

const pathLike = (query: string, platform: NodeJS.Platform) =>
  (platform === 'win32' ? PATHLIKE_WIN32 : PATHLIKE).test(query)

// biome-ignore lint/suspicious/noControlCharactersInRegex: removing them is the point
const CONTROL = /[\u0000-\u001f\u007f]/g

/** Windows' device names, which can't name a file whatever the extension. */
const DEVICE = /^(?:con|prn|aux|nul|com[0-9]|lpt[0-9])$/i

/**
 * Save as's typed name, made a file name: trimmed, and a `/` becomes `-`
 * (it would name a folder). On Windows the same goes for `\` (a folder too),
 * `:` (an alternate data stream) and `* ? " < > |` (refused outright).
 *
 * Given the extension Forge adds (`ext`), a name typed with it (or a sibling,
 * `.jpeg` for `.jpg`) loses it, so `holiday.jpg` isn't saved as
 * `holiday.jpg.jpg`; and a name too long for the folder is cut to fit.
 * Control characters, which a paste can carry, go. On Windows, trailing dots
 * and spaces, which it drops without a word, go too, and a device name
 * (`CON`, `NUL`) gets a `-`.
 */
export function safeStem(
  typed: string,
  platform: NodeJS.Platform = process.platform,
  ext = '',
): string {
  let stem = typed.replace(CONTROL, '').trim().replace(/\//g, '-')
  const lower = stem.toLowerCase()
  const typedExt = siblingExtensions(ext).find((e) => lower.endsWith(e) && lower.length > e.length)
  if (typedExt) stem = stem.slice(0, -typedExt.length)
  if (stem === '.' || stem === '..') return ''
  if (platform === 'win32') {
    stem = stem.replace(/[\\:*?"<>|]/g, '-').replace(/[. ]+$/, '')
    if (DEVICE.test(stem)) stem = `${stem}-`
  }
  if (!stem) return ''
  const fitted = fitName(stem, ext, platform)
  return fitted.slice(0, fitted.length - ext.length)
}

/** `ext` and the other extensions of the format(s) that write it, lower case. */
function siblingExtensions(ext: string): string[] {
  if (!ext) return []
  const e = ext.toLowerCase()
  const formats = Object.values(FORMATS).filter((f) => f.extensions.includes(e))
  return [...new Set([e, ...formats.flatMap((f) => f.extensions)])]
}

/** True when `text` names a place rather than filtering the list. */
export function isPathQuery(text: string, platform: NodeJS.Platform = process.platform): boolean {
  return pathLike(unescapePath(text.trim(), platform), platform)
}

/**
 * The folders Save as lists for `text` (spec 2026-10-11 picker §3).
 *
 * A path gets exactly one row. A dropped *file* means "save next to it", so
 * its row saves to the file's folder; anything else — a folder, or a path
 * that does not exist yet — is the folder to save into. Any other text
 * filters the places by name. When nothing matches, one disabled row says
 * so: disabled, so Enter does nothing, but still a row, so the list keeps
 * its keys (escape still clears the text).
 */
export function destinationRows(
  text: string,
  presets: PathPreset[],
  defaultPath: string,
  preview: (path: string) => string,
  platform: NodeJS.Platform = process.platform,
): Choice[] {
  const query = unescapePath(text.trim(), platform)
  if (pathLike(query, platform)) {
    let isFile = false
    try {
      isFile = statSync(expandTilde(query)).isFile()
    } catch {
      // Not there yet, or not readable: it can still be the folder to create.
    }
    const folder = isFile ? dirname(query) : query
    return [
      {
        value: folder,
        label: isFile ? `Next to ${displayName(query)}` : 'Use this folder',
        hint: preview(folder),
      },
    ]
  }

  const q = query.toLowerCase()
  const hits = presets.filter((p) => p.label.toLowerCase().includes(q))
  if (hits.length === 0) {
    return [
      { value: NO_MATCH, label: 'no match', hint: 'type a path, or drop a file', disabled: true },
    ]
  }
  return hits.map((p) => ({
    value: p.path,
    label: p.label,
    hint: preview(p.path),
    ...(p.path === defaultPath ? { badge: 'default' } : {}),
  }))
}
