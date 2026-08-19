import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

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
  const base = process.env.XDG_CONFIG_HOME
  const root = base !== undefined && base.length > 0 ? base : join(homedir(), '.config')
  return join(root, 'forge', 'config.json')
}

export function expandTilde(path: string): string {
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
