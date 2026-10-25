import type { Dirent } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { readableFormats } from '../core/capabilities.js'
import { FORMATS } from '../core/formats.js'

/** One path the home screen's field could become. */
export interface Completion {
  /** As the list shows it: readable, spaces as spaces. */
  label: string
  /** What Tab puts in the field: escaped the way a Finder drop is, so it is sent whole. */
  insert: string
  /** The folder it is in, as shown at the row's far end; left out, it is read off `label`. */
  where?: string
}

/** More than this and the list is a directory listing, not a suggestion. */
const MAX = 50

/**
 * Derived from the capability graph, never a hardcoded list (invariant 2).
 *
 * An advisory display filter only. Sources are still probed by content
 * (invariant 3), so a file this hides can be typed in full and converted —
 * the filter only keeps the list from offering a `.txt` the next step would
 * reject.
 */
function readableExtensions(): Set<string> {
  const set = new Set<string>()
  for (const id of readableFormats()) {
    for (const ext of FORMATS[id].extensions) set.add(ext.toLowerCase())
  }
  return set
}

const unescapeName = (s: string) => s.replace(/\\(.)/g, '$1')
const escapeName = (s: string) => s.replace(/([ \\'"()&;!$`<>|*?#])/g, '\\$1')

interface Entry {
  name: string
  dir: boolean
}

/**
 * Names in the order `localeCompare` with these options gives, from one
 * collator made once: `localeCompare` makes a new one for every comparison,
 * which was most of a keystroke's time in a folder of thousands.
 */
const byName = new Intl.Collator(undefined, { sensitivity: 'base' }).compare

async function list(dir: string, stem: string, allowed: Set<string>): Promise<Entry[]> {
  // Typed explicitly: inferring from `readdir` picks its Buffer overload.
  let entries: Dirent[]
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    // A folder that is not there, or not readable: nothing to offer, which is
    // the right answer while someone is still typing.
    return []
  }
  const lower = stem.toLowerCase()
  return entries
    .filter((e) => stem.startsWith('.') || !e.name.startsWith('.'))
    .filter((e) => e.name.toLowerCase().startsWith(lower))
    .filter((e) => {
      if (e.isDirectory()) return true
      const dot = e.name.lastIndexOf('.')
      return dot > 0 && allowed.has(e.name.slice(dot).toLowerCase())
    })
    .map((e) => ({ name: e.name, dir: e.isDirectory() }))
    .sort((a, b) => byName(a.name, b.name))
}

/**
 * The paths `text` could be completed to, for the list under the home
 * screen's field.
 *
 * Reads one folder — the one the text is in — and matches names by prefix,
 * ignoring case as the macOS filesystem does. When that leaves a single
 * folder, its contents follow it, so the list is already one step ahead of
 * the Tab that would open it.
 *
 * Everything up to the last slash is kept exactly as typed, `~` and all, so a
 * completion only ever adds to what is in the field.
 */
export async function completePath(
  text: string,
  opts: { home?: string; cwd?: string; platform?: NodeJS.Platform } = {},
): Promise<Completion[]> {
  if (text.trim() === '') return []
  const home = opts.home ?? homedir()
  const cwd = opts.cwd ?? process.cwd()
  if ((opts.platform ?? process.platform) === 'win32') return completeWin32(text, home, cwd)

  const slash = text.lastIndexOf('/')
  const typedDir = slash === -1 ? '' : text.slice(0, slash + 1)
  const stem = unescapeName(text.slice(slash + 1))

  const dirPath = unescapeName(typedDir)
  const absDir =
    dirPath === '~/' || dirPath.startsWith('~/')
      ? join(home, dirPath.slice(2))
      : resolve(cwd, dirPath === '' ? '.' : dirPath)

  const allowed = readableExtensions()
  const found = await list(absDir, stem, allowed)

  const out: Completion[] = []
  const add = (label: string, insert: string) => {
    if (out.length < MAX) out.push({ label, insert })
  }
  const shown = (e: Entry) => `${e.name}${e.dir ? '/' : ''}`
  const sent = (e: Entry) => `${escapeName(e.name)}${e.dir ? '/' : ''}`

  for (const e of found) add(`${dirPath}${shown(e)}`, `${typedDir}${sent(e)}`)

  const only = found[0]
  if (found.length === 1 && only?.dir) {
    for (const child of await list(join(absDir, only.name), '', allowed)) {
      add(`${dirPath}${shown(only)}${shown(child)}`, `${typedDir}${sent(only)}${sent(child)}`)
    }
  }
  return out
}

/** Whether a completion is a folder (ends in its separator), for Save as's ghost text. */
export function isFolderCompletion(
  insert: string,
  platform: NodeJS.Platform = process.platform,
): boolean {
  return insert.endsWith('/') || (platform === 'win32' && insert.endsWith('\\'))
}

/**
 * `completePath` on Windows. Either slash separates, and a backslash is never
 * an escape, so a name goes in exactly as it is: the field is read whole
 * (`unescapePath`), and `My\ Photo.png` there would name a folder `My\`. A
 * folder gets the separator the user is already typing, `\` by default.
 */
async function completeWin32(text: string, home: string, cwd: string): Promise<Completion[]> {
  const cut = Math.max(text.lastIndexOf('/'), text.lastIndexOf('\\'))
  const typedDir = cut === -1 ? '' : text.slice(0, cut + 1)
  const stem = text.slice(cut + 1)
  const slash = cut === -1 ? '\\' : (text[cut] as string)

  // Windows reads `/` as a separator too, so one form serves every lookup.
  const dirPath = typedDir.replaceAll('\\', '/')
  const absDir = dirPath.startsWith('~/')
    ? join(home, dirPath.slice(2))
    : resolve(cwd, dirPath === '' ? '.' : dirPath)

  const allowed = readableExtensions()
  const found = await list(absDir, stem, allowed)

  const out: Completion[] = []
  const add = (path: string) => {
    if (out.length < MAX) out.push({ label: path, insert: path })
  }
  const named = (e: Entry) => `${e.name}${e.dir ? slash : ''}`

  for (const e of found) add(`${typedDir}${named(e)}`)

  const only = found[0]
  if (found.length === 1 && only?.dir) {
    for (const child of await list(join(absDir, only.name), '', allowed)) {
      add(`${typedDir}${named(only)}${named(child)}`)
    }
  }
  return out
}
