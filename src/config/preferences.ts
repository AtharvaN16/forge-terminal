import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { type Preset, parsePreset } from '../core/preset.js'
import { knownFolder } from '../utils/known-folders.js'
import { configBase } from './config-base.js'

export interface Preferences {
  /**
   * Undefined means no theme has ever been chosen — the shell shows the
   * first-run picker. It is the only field that can legitimately be absent.
   */
  theme?: 'dark' | 'light'
  /** Stored with `~` unexpanded so the file survives being copied between machines. */
  defaultOutput: string
  /** The value the quality slider opens on for lossy targets. */
  quality: number
  /** The once-a-day check for a newer Forge. Absent means on (src/update/check.ts). */
  updateCheck?: boolean
  /**
   * Forge in Finder's Quick Actions / Explorer's right-click menu. Absent
   * means on (src/menu/setup.ts); false is /right-click switched off, and
   * Forge then leaves the menu out on every start until it is switched on.
   */
  rightClickMenu?: boolean
  /**
   * Typing a name searches the Mac for it (src/shell/find-files.ts). Absent
   * means not yet asked: the first name typed asks first (2026-10-19, P2).
   */
  searchMac?: boolean
  /** The folder the last file was saved to: Save as lists it after the default. */
  lastOutput?: string
  /** Saved from Done's Save as preset; run with `--preset name`. */
  presets?: Preset[]
}

export const DEFAULT_PREFERENCES: Preferences = {
  defaultOutput: '~/Desktop',
  quality: 80,
}

/**
 * Read at call time, not at module load: tests set XDG_CONFIG_HOME per case,
 * and a value captured at import would pin every case to whichever ran first.
 */
export function configPath(): string {
  return join(configBase(), 'forge', 'config.json')
}

export function expandTilde(path: string, platform: NodeJS.Platform = process.platform): string {
  // The default preference is `~/Desktop`; on Windows the real Desktop may be
  // redirected (OneDrive), and `<home>\Desktop` would be a new empty folder.
  if (platform === 'win32') {
    if (path === '~/Desktop') return knownFolder('Desktop', platform)
    if (path === '~/Downloads') return knownFolder('Downloads', platform)
  }
  if (path === '~') return homedir()
  if (path.startsWith('~/')) return join(homedir(), path.slice(2))
  return path
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/**
 * Validates field by field rather than all-or-nothing: one bad key should not
 * cost the user the settings that are fine. Collects what it rejected so the
 * caller can say so once, then proceeds.
 */
function validate(raw: Record<string, unknown>): { prefs: Preferences; rejected: string[] } {
  const prefs: Preferences = { ...DEFAULT_PREFERENCES }
  const rejected: string[] = []

  if (raw.theme !== undefined) {
    if (raw.theme === 'dark' || raw.theme === 'light') prefs.theme = raw.theme
    else rejected.push('theme')
  }

  if (raw.defaultOutput !== undefined) {
    if (typeof raw.defaultOutput === 'string' && raw.defaultOutput.trim().length > 0) {
      prefs.defaultOutput = raw.defaultOutput
    } else {
      rejected.push('defaultOutput')
    }
  }

  if (raw.quality !== undefined) {
    const q = raw.quality
    if (typeof q === 'number' && Number.isInteger(q) && q >= 1 && q <= 100) prefs.quality = q
    else rejected.push('quality')
  }

  if (raw.updateCheck !== undefined) {
    if (typeof raw.updateCheck === 'boolean') prefs.updateCheck = raw.updateCheck
    else rejected.push('updateCheck')
  }

  if (raw.rightClickMenu !== undefined) {
    if (typeof raw.rightClickMenu === 'boolean') prefs.rightClickMenu = raw.rightClickMenu
    else rejected.push('rightClickMenu')
  }

  if (raw.searchMac !== undefined) {
    if (typeof raw.searchMac === 'boolean') prefs.searchMac = raw.searchMac
    else rejected.push('searchMac')
  }

  if (raw.lastOutput !== undefined) {
    if (typeof raw.lastOutput === 'string' && raw.lastOutput.trim().length > 0) {
      prefs.lastOutput = raw.lastOutput
    } else {
      rejected.push('lastOutput')
    }
  }

  if (raw.presets !== undefined) {
    // One bad preset costs only itself; the key is still reported once.
    if (Array.isArray(raw.presets)) {
      const presets = raw.presets.map(parsePreset)
      prefs.presets = presets.filter((p): p is Preset => p !== undefined)
      if (prefs.presets.length < presets.length) rejected.push('presets')
    } else {
      rejected.push('presets')
    }
  }

  return { prefs, rejected }
}

/** The parsed file, or undefined if it is missing, unreadable, or not an object. */
async function readRaw(): Promise<Record<string, unknown> | undefined> {
  let text: string
  try {
    text = await readFile(configPath(), 'utf8')
  } catch {
    return undefined
  }
  try {
    const parsed: unknown = JSON.parse(text)
    return isRecord(parsed) ? parsed : undefined
  } catch {
    return undefined
  }
}

/**
 * Never throws, and never blocks a conversion. A missing file is the normal
 * first-run case and is silent; anything else that goes wrong yields defaults
 * plus one sentence the caller renders once as history.
 */
export async function loadPreferences(): Promise<{ prefs: Preferences; warning?: string }> {
  const path = configPath()

  let text: string
  try {
    text = await readFile(path, 'utf8')
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return { prefs: DEFAULT_PREFERENCES }
    return {
      prefs: DEFAULT_PREFERENCES,
      warning: `Could not read the config at ${path} — using defaults.`,
    }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return {
      prefs: DEFAULT_PREFERENCES,
      warning: `The config at ${path} is not valid JSON — using defaults.`,
    }
  }

  if (!isRecord(parsed)) {
    return {
      prefs: DEFAULT_PREFERENCES,
      warning: `The config at ${path} is not an object — using defaults.`,
    }
  }

  const { prefs, rejected } = validate(parsed)
  if (rejected.length === 0) return { prefs }
  return {
    prefs,
    warning: `Ignored invalid config ${
      rejected.length === 1 ? 'setting' : 'settings'
    }: ${rejected.join(', ')}.`,
  }
}

/**
 * Merges `patch` over whatever is on disk and writes atomically (invariant 6).
 * Re-reading rather than serialising a whole in-memory object is what
 * preserves keys a later version of Forge may have written — an older binary
 * must not silently destroy a newer one's settings.
 */
export async function savePreferences(patch: Partial<Preferences>): Promise<void> {
  const path = configPath()
  await mkdir(dirname(path), { recursive: true })

  const existing = (await readRaw()) ?? {}
  const merged: Record<string, unknown> = { ...existing }
  for (const [key, value] of Object.entries(patch)) {
    if (value !== undefined) merged[key] = value
  }

  const temp = `${path}.${process.pid}.tmp`
  try {
    await writeFile(temp, `${JSON.stringify(merged, null, 2)}\n`, 'utf8')
    await rename(temp, path)
  } catch (e) {
    await unlink(temp).catch(() => {})
    throw e
  }
}
