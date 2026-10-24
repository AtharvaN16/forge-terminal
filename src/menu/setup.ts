import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  hasMenu,
  installMenu,
  type MenuEnv,
  readState,
  removeMenu,
  stateMatches,
} from './install.js'

/**
 * Setting the menu up as the shell starts. Decided: the menu is the same for
 * everyone and Forge adds it on first run, saying so once. After an update,
 * or when Forge has moved, it is written again so the launcher points at the
 * Forge that is installed; nothing is said then.
 *
 * Only for a Forge installed with `npm install -g`. A source checkout run
 * with `npm run dev` leaves the menu alone, so a Finder item never ends up
 * pointing at someone's working copy (`forge menu install` does it by hand).
 */
export async function ensureMenu(
  e: MenuEnv,
  o: {
    global: boolean
    /** /right-click's switch; absent is on. Off keeps the menu out, and takes it out if it is there. */
    enabled?: boolean
  },
): Promise<string | undefined> {
  if (!o.global || !hasMenu(e.platform)) return undefined
  const state = readState(e)
  if (o.enabled === false) {
    if (state !== undefined) await removeMenu(e)
    return undefined
  }
  if (state !== undefined && stateMatches(state, e)) return undefined
  await installMenu(e)
  if (state !== undefined) return undefined
  return e.platform === 'darwin'
    ? 'Added Forge to Finder’s Quick Actions'
    : 'Added Forge to the right-click menu'
}

/**
 * After an extension is added or removed: Sharpen comes and goes with Boost;
 * after a preset is turned on or off in /right-click, its item does.
 * Only a menu already set up is touched, and it keeps the Forge, Node and
 * version it was set up with: an extension added from a source checkout must
 * not point Finder at the checkout, and the next start still sees it as current.
 */
export async function resync(e: MenuEnv): Promise<void> {
  const state = readState(e)
  if (state === undefined) return
  const { xdgConfigHome: _current, ...rest } = e
  // The presets are this moment's: a resync is how /right-click puts one in or takes one out.
  await installMenu({ ...rest, ...state, presets: e.presets ?? [] })
}

const terminalFile = (e: Pick<MenuEnv, 'menuDir'>) => join(e.menuDir, 'terminal')
const MAC_TERMINALS = new Set(['Apple_Terminal', 'iTerm.app', 'ghostty'])

/** The terminals that say so in TERM_PROGRAM on Linux, by the name run.ts opens them by. */
const LINUX_TERM_PROGRAMS: Record<string, string> = {
  WezTerm: 'wezterm',
  ghostty: 'ghostty',
  kitty: 'kitty',
}

/**
 * The Linux terminal Forge is running in, by the variable each sets for its
 * shell. Inside VS Code or tmux (TERM_PROGRAM says some other name) those
 * may be left over from wherever that was started, so nothing is read.
 */
function linuxTerminal(env: NodeJS.ProcessEnv): string | undefined {
  if (env.TERM_PROGRAM) return LINUX_TERM_PROGRAMS[env.TERM_PROGRAM]
  if (env.TMUX) return undefined
  if (env.KITTY_WINDOW_ID) return 'kitty'
  if (env.ALACRITTY_WINDOW_ID || env.ALACRITTY_SOCKET) return 'alacritty'
  if (env.KONSOLE_VERSION) return 'konsole'
  if (env.GNOME_TERMINAL_SCREEN || env.GNOME_TERMINAL_SERVICE) return 'gnome-terminal'
  if (env.XTERM_VERSION) return 'xterm'
  return undefined
}

/**
 * Keeps the terminal Forge is running in, so a menu item that opens Forge
 * opens it there next time. On a Mac that is TERM_PROGRAM; on Windows,
 * Windows Terminal sets WT_SESSION; on Linux, each terminal's own variable.
 * A terminal that says none of these keeps the last one known.
 */
export function rememberTerminal(e: Pick<MenuEnv, 'menuDir' | 'platform'>, env: NodeJS.ProcessEnv) {
  // Only terminals the menu knows how to open (run.ts): one inside VS Code or
  // tmux says nothing useful about where to open a window.
  const terminal =
    e.platform === 'win32'
      ? env.WT_SESSION
        ? 'wt'
        : 'console'
      : e.platform === 'linux'
        ? linuxTerminal(env)
        : MAC_TERMINALS.has(env.TERM_PROGRAM ?? '')
          ? env.TERM_PROGRAM
          : undefined
  if (!terminal) return
  try {
    mkdirSync(e.menuDir, { recursive: true })
    writeFileSync(terminalFile(e), terminal)
  } catch {}
}

export function rememberedTerminal(e: Pick<MenuEnv, 'menuDir'>): string | undefined {
  try {
    return readFileSync(terminalFile(e), 'utf8').trim() || undefined
  } catch {
    return undefined
  }
}
