/**
 * Tools a user may already have (2026-10-23, mockups/own-tools-2026-10-round11.html):
 * yt-dlp and ffmpeg are ordinary command-line tools, often installed with
 * Homebrew. When the Mac has one, Forge uses it instead of downloading its
 * own — and removes its own copy, so a tool is never on disk twice. If the
 * user's copy goes, Forge offers its download again.
 *
 * Where Forge looks: a path the user chose in /extensions, then the folders
 * the terminal searches (PATH), then Homebrew's two, which a terminal opened
 * from Finder can miss. "Check this Mac" looks deeper, in the usual user
 * folders too. A copy counts only if it runs and says its version.
 *
 * No UI here: everything returned is data (invariant 1).
 */
import { execFile } from 'node:child_process'
import { access, constants, mkdir, readFile, realpath, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, posix, sep, win32 } from 'node:path'
import { promisify } from 'node:util'
import { assetFor, catalogEntry } from './catalog.js'
import { extensionsRoot, installed } from './paths.js'

const execFileAsync = promisify(execFile)

/** The catalogue ids a user's own copy can stand in for. */
export type OwnableId = 'yt-dlp' | 'video'
export const OWNABLE: readonly OwnableId[] = ['yt-dlp', 'video']
export const isOwnable = (id: string): id is OwnableId =>
  (OWNABLE as readonly string[]).includes(id)

interface Tool {
  /** The file to look for. */
  binary: string
  /** What it is called in the shell's words: "yt-dlp", "ffmpeg". */
  name: string
  /** Its Homebrew formula, for `brew upgrade`. */
  formula: string
  versionArgs: string[]
  version(out: string): string | undefined
  /** Other files that must sit beside it: ffprobe beside ffmpeg. */
  beside?: string[]
}

const TOOLS: Record<OwnableId, Tool> = {
  'yt-dlp': {
    binary: 'yt-dlp',
    name: 'yt-dlp',
    formula: 'yt-dlp',
    versionArgs: ['--version'],
    version: (out) =>
      out
        .trim()
        .split('\n')[0]
        ?.match(/^\d+(\.\d+)+$/)?.[0],
  },
  video: {
    binary: 'ffmpeg',
    name: 'ffmpeg',
    formula: 'ffmpeg',
    versionArgs: ['-hide_banner', '-version'],
    version: (out) => out.match(/ffmpeg version (\S+)/)?.[1],
    beside: ['ffprobe'],
  },
}

export const toolName = (id: OwnableId) => TOOLS[id].name
export const toolFormula = (id: OwnableId) => TOOLS[id].formula

export interface OwnCopy {
  id: OwnableId
  /** The file, as found (not resolved through links): what the user would recognise. */
  path: string
  version: string
  /** Installed by Homebrew: its real file is in a Cellar. `brew upgrade` updates it. */
  homebrew: boolean
  /**
   * Older than the version this Forge is tested with (the catalogue's pinned
   * one): Forge's options may not exist in it yet, so it is not used.
   */
  tooOld: boolean
}

/** True when dotted version `a` is newer than `b`, compared part by part as numbers. */
export function newer(a: string, b: string): boolean {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? 0
    const y = pb[i] ?? 0
    if (Number.isNaN(x) || Number.isNaN(y)) return a > b
    if (x !== y) return x > y
  }
  return false
}

/** The version Forge's own copy is pinned to: the oldest of the user's it will use. */
function pinned(id: OwnableId): string | undefined {
  const entry = catalogEntry(id)
  return entry && (assetFor(entry)?.version ?? assetFor(entry, 'darwin', 'universal')?.version)
}

/**
 * The folders to look in, in order: PATH, then Homebrew's two on a Mac; the
 * deep look ("Check this Mac") adds the usual user folders.
 */
export function searchDirs({
  platform = process.platform,
  env = process.env,
  deep = false,
}: {
  platform?: NodeJS.Platform
  env?: Record<string, string | undefined>
  deep?: boolean
} = {}): string[] {
  const path = env.PATH ?? env.Path ?? ''
  // The OS asked about, not the one running: PATH's separator and its paths are its own.
  const dirs = path.split(platform === 'win32' ? ';' : ':').filter(Boolean)
  if (platform === 'darwin') dirs.push('/opt/homebrew/bin', '/usr/local/bin')
  if (deep) {
    const home = env.HOME ?? homedir()
    const { join: under } = platform === 'win32' ? win32 : posix
    dirs.push(under(home, '.local', 'bin'), under(home, 'bin'), '/opt/local/bin', '/usr/bin')
  }
  return [...new Set(dirs)]
}

const exe = (name: string, platform = process.platform) =>
  platform === 'win32' ? `${name}.exe` : name

async function runnable(path: string): Promise<boolean> {
  try {
    await access(path, constants.X_OK)
    return true
  } catch {
    return false
  }
}

/** What the file at `path` is, if it is the tool and it runs; undefined otherwise. Never throws. */
export async function probeOwn(id: OwnableId, path: string): Promise<OwnCopy | undefined> {
  const tool = TOOLS[id]
  if (!(await runnable(path))) return undefined
  for (const other of tool.beside ?? []) {
    if (!(await runnable(join(dirname(path), exe(other))))) return undefined
  }
  try {
    const { stdout } = await execFileAsync(path, tool.versionArgs, { timeout: 5000 })
    const version = tool.version(stdout)
    if (version === undefined) return undefined
    const real = await realpath(path).catch(() => path)
    const floor = pinned(id)
    return {
      id,
      path,
      version,
      homebrew: real.includes(`${sep}Cellar${sep}`),
      tooOld: id === 'yt-dlp' && floor !== undefined && newer(floor, version),
    }
  } catch {
    return undefined
  }
}

/* ------------------------------------------------- the chosen path */

const choicesPath = () => join(extensionsRoot(), 'own.json')

async function choices(): Promise<Partial<Record<OwnableId, string>>> {
  try {
    const raw: unknown = JSON.parse(await readFile(choicesPath(), 'utf8'))
    return typeof raw === 'object' && raw !== null
      ? (raw as Partial<Record<OwnableId, string>>)
      : {}
  } catch {
    return {}
  }
}

/** The file the user pointed Forge to in /extensions, if any. */
export async function chosenPath(id: OwnableId): Promise<string | undefined> {
  const path = (await choices())[id]
  return typeof path === 'string' && path !== '' ? path : undefined
}

/** Keeps (or, with undefined, forgets) the file the user pointed Forge to. */
export async function setChosenPath(id: OwnableId, path: string | undefined): Promise<void> {
  const all = await choices()
  if (path === undefined) delete all[id]
  else all[id] = path
  await mkdir(extensionsRoot(), { recursive: true })
  await writeFile(choicesPath(), `${JSON.stringify(all, null, 2)}\n`)
}

/* ------------------------------------------------------- finding */

export interface FindOptions {
  /** Look here instead of PATH and Homebrew (tests; the deep look passes its own). */
  dirs?: string[]
  /** "Check this Mac": the usual user folders too. */
  deep?: boolean
}

/**
 * The user's own copy of `id`: the chosen file first, then the folders in
 * order. The test suite switches the folder search off (FORGE_NO_OWN_TOOLS)
 * unless a test passes its own folders, so no result depends on the machine.
 */
export async function findOwn(id: OwnableId, opts: FindOptions = {}): Promise<OwnCopy | undefined> {
  const chosen = await chosenPath(id)
  if (chosen !== undefined) {
    const copy = await probeOwn(id, chosen)
    if (copy) return copy
  }
  const off = process.env.FORGE_NO_OWN_TOOLS === '1' && opts.dirs === undefined
  const dirs = off ? [] : (opts.dirs ?? searchDirs({ deep: opts.deep ?? false }))
  for (const dir of dirs) {
    const copy = await probeOwn(id, join(dir, exe(TOOLS[id].binary)))
    if (copy) return copy
  }
  return undefined
}

/**
 * Forge's own copy goes once the user's is used: one copy of a tool, always.
 * Returns the bytes it freed (0 when there was none). Never throws — if
 * another forge is running it, it stays until next time.
 */
export async function removeForgeCopy(id: OwnableId): Promise<number> {
  if ((await installed(id)) === undefined) return 0
  try {
    const { removeExtension, extensionBytes } = await import('./manager.js')
    const bytes = await extensionBytes(id)
    return (await removeExtension(id)) ? bytes : 0
  } catch {
    return 0
  }
}

export interface Resolved {
  /** The file to run. */
  entry: string
  /** The user's own copy: Forge never runs `--update` on it. */
  own: boolean
}

/**
 * The yt-dlp to run: the user's when it is new enough (removing Forge's
 * copy), else Forge's, else nothing — the caller offers the download.
 */
export async function resolveYtDlp(opts: FindOptions = {}): Promise<Resolved | undefined> {
  const own = await findOwn('yt-dlp', opts)
  if (own && !own.tooOld) {
    await removeForgeCopy('yt-dlp')
    return { entry: own.path, own: true }
  }
  const forge = await installed('yt-dlp')
  return forge ? { entry: forge.entry, own: false } : undefined
}

/* ------------------------------------------------------- updating */

export interface BrewOptions {
  /** The brew to run (tests); found in Homebrew's folders or on PATH otherwise. */
  brew?: string
  signal?: AbortSignal
}

/** Homebrew's own command, where it is. */
async function brewPath(opts: BrewOptions): Promise<string | undefined> {
  if (opts.brew !== undefined) return (await runnable(opts.brew)) ? opts.brew : undefined
  for (const dir of searchDirs({ env: { PATH: process.env.PATH ?? '' } })) {
    const path = join(dir, 'brew')
    if (await runnable(path)) return path
  }
  return undefined
}

/**
 * A newer version of the user's copy, when there is one Forge can install:
 * Homebrew's answer for its own copy (without updating Homebrew itself, so
 * it is quick), the pinned version for a yt-dlp older than it. Null when
 * Homebrew answered that there is none — the copy is the latest — and
 * undefined when nobody could say, so "latest" is never claimed unasked.
 */
export async function ownUpdate(
  copy: OwnCopy,
  opts: BrewOptions = {},
): Promise<string | null | undefined> {
  if (copy.tooOld) return pinned(copy.id)
  if (!copy.homebrew) return undefined
  const brew = await brewPath(opts)
  if (brew === undefined) return undefined
  try {
    const { stdout } = await execFileAsync(
      brew,
      ['outdated', '--json=v2', '--formula', TOOLS[copy.id].formula],
      { timeout: 15_000, env: { ...process.env, HOMEBREW_NO_AUTO_UPDATE: '1' } },
    )
    const raw = JSON.parse(stdout) as { formulae?: Array<{ current_version?: unknown }> }
    if (!Array.isArray(raw.formulae)) return undefined
    const current = raw.formulae[0]?.current_version
    return typeof current === 'string' ? current : null
  } catch {
    return undefined
  }
}

/** Who updates the user's copy, in the shell's words: "Homebrew", or the tool itself. */
export const updater = (copy: OwnCopy): string | undefined =>
  copy.homebrew ? 'Homebrew' : copy.id === 'yt-dlp' ? 'yt-dlp' : undefined

/**
 * Updates the user's copy the way it was installed: `brew upgrade` for
 * Homebrew's, `yt-dlp --update` for any other yt-dlp. Rejects with the
 * tool's own last words when it fails.
 */
export async function updateOwn(copy: OwnCopy, opts: BrewOptions = {}): Promise<void> {
  let file: string
  let args: string[]
  if (copy.homebrew) {
    const brew = await brewPath(opts)
    if (brew === undefined) throw new Error('Homebrew was not found')
    file = brew
    args = ['upgrade', TOOLS[copy.id].formula]
  } else if (copy.id === 'yt-dlp') {
    file = copy.path
    args = ['--update']
  } else throw new Error(`${TOOLS[copy.id].name} cannot update itself`)
  try {
    await execFileAsync(file, args, {
      timeout: 10 * 60_000,
      maxBuffer: 8 << 20,
      ...(opts.signal ? { signal: opts.signal } : {}),
    })
  } catch (e) {
    if (opts.signal?.aborted) throw opts.signal.reason ?? e
    const err = e as { stderr?: string; message?: string }
    const last = (err.stderr ?? '')
      .trim()
      .split('\n')
      .filter(Boolean)
      .at(-1)
      ?.replace(/^Error:\s*/, '')
    throw new Error(last || err.message || 'the update failed')
  }
}
