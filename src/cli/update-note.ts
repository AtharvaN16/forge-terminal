import { spawn } from 'node:child_process'
import { loadPreferences } from '../config/preferences.js'
import { DARK, LIGHT, type Palette } from '../shell/theme.js'
import {
  CHECK_EVERY_MS,
  isNewer,
  isStale,
  readCache,
  updateChecksEnabled,
  writeCache,
} from '../update/check.js'

/**
 * A6 (mockups/update-check-2026-10.html): after a one-off command, when a
 * newer Forge is out, two rows on the blue tint of "new". The terminal is
 * where `forge update` works, so that is what it names; /update is the app's.
 * Lines, not printing: src/index.ts decides whether anyone is there to read
 * them.
 */
const WIDTH = 60

function sgr(hex: string, ground: 38 | 48): string {
  const n = Number.parseInt(hex.slice(1), 16)
  return `\x1b[${ground};2;${(n >> 16) & 255};${(n >> 8) & 255};${n & 255}m`
}

export function noteLines(latest: string, current: string, palette?: Palette): string[] {
  const first = [' ↑ ', `Forge ${latest} is available`, ` · your version ${current}`]
  const second = ['   In terminal: ', 'forge update']
  if (palette === undefined) return [first.join(''), second.join('')]

  const bg = sgr(palette.newTagBg, 48)
  const fg = (hex: string) => sgr(hex, 38)
  const B = '\x1b[1m'
  const R = '\x1b[0m'
  const fill = (used: string[]) => ' '.repeat(Math.max(0, WIDTH - used.join('').length))
  return [
    `${bg}${fg(palette.newTag)}${B}${first[0]}${fg(palette.fg)}${first[1]}${R}${bg}${fg(palette.dim)}${first[2]}${fill(first)}${R}`,
    `${bg}${fg(palette.dim)}${second[0]}${fg(palette.fg)}${B}${second[1]}${R}${bg}${fill(second)}${R}`,
  ]
}

/**
 * What to print after a command, and the day's bookkeeping. From the cache
 * only — the command has already answered, and must not wait on a network.
 * When the cache is more than a day old, `refresh` is called to ask the
 * registry in the background, so the next command knows.
 */
export async function afterCommand(
  current: string,
  opts: {
    now?: number
    env?: NodeJS.ProcessEnv
    refresh: () => void
    /** Whether the terminal takes true colour; the theme comes from the config. */
    colour?: boolean
  },
): Promise<string[]> {
  const now = opts.now ?? Date.now()
  const { prefs } = await loadPreferences()
  if (!updateChecksEnabled(prefs, opts.env ?? process.env)) return []
  const cache = await readCache()
  if (isStale(cache, now)) opts.refresh()
  const latest = cache?.latest
  if (cache === undefined || latest === undefined || !isNewer(latest, current)) return []
  const shown = cache.notifiedAt
  if (shown !== undefined && shown <= now && now - shown <= CHECK_EVERY_MS) return []
  await writeCache({ ...cache, notifiedAt: now }).catch(() => {})
  const palette = opts.colour ? (prefs.theme === 'light' ? LIGHT : DARK) : undefined
  return noteLines(latest, current, palette)
}

/**
 * Asks the registry in a detached process that outlives this one, so the
 * command that triggered it exits at once. `__update-check` is src/index.ts's
 * hidden entry for it. Any failure to start is silent: the next command tries.
 */
export function spawnRefresh(script: string | undefined): void {
  if (script === undefined) return
  try {
    spawn(process.execPath, [...process.execArgv, script, '__update-check'], {
      detached: true,
      stdio: 'ignore',
    }).unref()
  } catch {
    // Nothing to do: no note today.
  }
}
