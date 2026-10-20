import { spawn } from 'node:child_process'
import type { Dirent } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, join, sep } from 'node:path'
import { readableFormats } from '../core/capabilities.js'
import { FORMATS } from '../core/formats.js'
import type { Completion } from './complete.js'

/**
 * Files found by name, for the home field's suggestions when what is typed is
 * a name rather than a path (decided 2026-10-19, mockups/file-suggestions-2026-10.html, S2).
 *
 * On a Mac the name is looked up in Spotlight's index (`mdfind -name`, which
 * every Mac has: nothing is installed, indexed or kept running by Forge), and
 * Desktop and Downloads are also read directly, so a file saved a moment ago,
 * before Spotlight has it, is still found. Elsewhere only those folders and
 * Documents are read.
 *
 * What comes back is cut down to what someone would drop on Forge: folders,
 * and files of a kind Forge reads — never hidden folders, `node_modules`,
 * `Library` (bar iCloud Drive, which lives there), app bundles and the like.
 * Newest first, Desktop and Downloads before anywhere else.
 */

/** Names shorter than this match too much to be worth a search. */
export const NAME_MIN = 2
/** The most a search offers. */
const MAX = 50
/** Spotlight's answers read before the rest are let go: enough to sort, few enough to stat. */
const READ_AT_MOST = 400
/** How long Spotlight gets before what it has said is used as it stands. */
const SPOTLIGHT_MS = 1500

/** Whether `text` is a name to search for, not a path to walk: no slash, and not `~` or `.` first. */
export function isNameQuery(text: string, platform: NodeJS.Platform = process.platform): boolean {
  const t = text.trim()
  if ([...t].length < NAME_MIN) return false
  if (t.includes('/') || (platform === 'win32' && t.includes('\\'))) return false
  if (platform === 'win32' && /^[A-Za-z]:/.test(t)) return false
  return !/^[~.]/.test(t)
}

/** Folders that hold a whole thing, not files to pick from: an app, a library, a project. */
const PACKAGES = new Set([
  'app',
  'appex',
  'bundle',
  'framework',
  'plugin',
  'kext',
  'pkg',
  'photoslibrary',
  'musiclibrary',
  'tvlibrary',
  'imovielibrary',
  'fcpbundle',
  'xcodeproj',
  'xcworkspace',
  'xcassets',
  'lproj',
  'sparsebundle',
  'logicx',
  'band',
])

const ICLOUD = `${sep}Library${sep}Mobile Documents${sep}`

/** Whether a path is somewhere a file to convert could reasonably be. */
export function isOwnPlace(path: string, home: string): boolean {
  if (!path.startsWith(home + sep)) return false
  const parts = path.slice(home.length + 1).split(sep)
  const parents = parts.slice(0, -1)
  for (const part of parents) {
    if (part.startsWith('.') || part === 'node_modules') return false
    const dot = part.lastIndexOf('.')
    if (dot > 0 && PACKAGES.has(part.slice(dot + 1).toLowerCase())) return false
  }
  if (parents[0] === 'Library' && !path.includes(ICLOUD)) return false
  return !(parts.at(-1) ?? '').startsWith('.')
}

function readable(): Set<string> {
  const set = new Set<string>()
  for (const id of readableFormats())
    for (const ext of FORMATS[id].extensions) set.add(ext.toLowerCase())
  return set
}

/** Paths Spotlight has for `name` under `home`, as many as it says before `signal` or the time runs out. */
function spotlight(name: string, home: string, signal: AbortSignal | undefined): Promise<string[]> {
  return new Promise((resolve) => {
    const out: string[] = []
    let rest = ''
    let done = false
    const child = spawn('mdfind', ['-onlyin', home, '-name', name], {
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    const finish = () => {
      if (done) return
      done = true
      clearTimeout(timer)
      signal?.removeEventListener('abort', finish)
      child.kill()
      resolve(out)
    }
    const timer = setTimeout(finish, SPOTLIGHT_MS)
    signal?.addEventListener('abort', finish)
    child.on('error', finish)
    child.on('close', finish)
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      const lines = (rest + chunk).split('\n')
      rest = lines.pop() ?? ''
      for (const line of lines) if (line) out.push(line)
      if (out.length >= READ_AT_MOST) finish()
    })
  })
}

/** Paths in `dir` and one level down whose names hold `needle`, read straight off the disk. */
async function nearby(dir: string, needle: string, depth = 2): Promise<string[]> {
  let entries: Dirent[]
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return []
  }
  const out: string[] = []
  for (const e of entries) {
    if (e.name.startsWith('.')) continue
    const path = join(dir, e.name)
    if (e.name.toLowerCase().includes(needle)) out.push(path)
    if (e.isDirectory() && depth > 1) out.push(...(await nearby(path, needle, depth - 1)))
  }
  return out
}

/** `path` with the home folder as `~`, as the suggestions show where a file is. */
export function tilde(path: string, home: string): string {
  return path === home ? '~' : path.startsWith(home + sep) ? `~${path.slice(home.length)}` : path
}

const escapeName = (s: string) => s.replace(/([ \\'"()&;!$`<>|*?#])/g, '\\$1')

/**
 * What `name` finds, newest first, Desktop and Downloads ahead: each with the
 * folder it is in. `signal` stops a search that a newer keystroke has made
 * stale.
 */
export async function findByName(
  name: string,
  opts: { home?: string; platform?: NodeJS.Platform; signal?: AbortSignal } = {},
): Promise<Completion[]> {
  // The test suite searches nothing real unless a test names its own home.
  if (process.env.FORGE_NO_FIND === '1' && opts.home === undefined) return []
  const home = opts.home ?? homedir()
  const platform = opts.platform ?? process.platform
  const needle = name.trim().toLowerCase()
  if ([...needle].length < NAME_MIN) return []
  const near = [join(home, 'Desktop'), join(home, 'Downloads')]
  const places = platform === 'darwin' ? near : [...near, join(home, 'Documents')]

  const [indexed, ...read] = await Promise.all([
    platform === 'darwin' ? spotlight(needle, home, opts.signal) : Promise.resolve([]),
    ...places.map((dir) => nearby(dir, needle, platform === 'darwin' ? 2 : 3)),
  ])
  if (opts.signal?.aborted) return []

  const allowed = readable()
  const seen = new Set<string>()
  const candidates: string[] = []
  for (const path of [...read.flat(), ...(indexed ?? [])]) {
    if (seen.has(path) || !isOwnPlace(path, home)) continue
    seen.add(path)
    candidates.push(path)
  }

  const found = await Promise.all(
    candidates.slice(0, READ_AT_MOST).map(async (path) => {
      try {
        const s = await stat(path)
        const dir = s.isDirectory()
        const dot = basename(path).lastIndexOf('.')
        const ext = dot > 0 ? basename(path).slice(dot).toLowerCase() : ''
        if (!dir && !allowed.has(ext)) return null
        return { path, dir, at: s.mtimeMs, near: near.some((d) => path.startsWith(d + sep)) }
      } catch {
        return null
      }
    }),
  )
  if (opts.signal?.aborted) return []

  return found
    .filter((f): f is NonNullable<typeof f> => f !== null)
    .sort((a, b) => Number(b.near) - Number(a.near) || b.at - a.at)
    .slice(0, MAX)
    .map((f) => {
      const shown = tilde(f.path, home)
      const slash = platform === 'win32' ? '\\' : '/'
      return {
        label: `${basename(f.path)}${f.dir ? slash : ''}`,
        where: tilde(dirname(f.path), home),
        // Windows reads a path whole, no escapes and no `~`: the full path.
        insert:
          platform === 'win32'
            ? `${f.path}${f.dir ? slash : ''}`
            : `${escapeName(shown)}${f.dir ? '/' : ''}`,
      }
    })
}
