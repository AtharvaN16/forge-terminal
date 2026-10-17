import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { installMenu, type MenuEnv, readState } from './install.js'

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
export async function ensureMenu(e: MenuEnv, o: { global: boolean }): Promise<string | undefined> {
  if (!o.global || (e.platform !== 'darwin' && e.platform !== 'win32')) return undefined
  const state = readState(e)
  if (state !== undefined && state.version === e.version && state.forge === e.forge)
    return undefined
  await installMenu(e)
  if (state !== undefined) return undefined
  return e.platform === 'darwin'
    ? 'Added Forge to Finder’s Quick Actions'
    : 'Added Forge to the right-click menu'
}

/**
 * After an extension is added or removed: Sharpen comes and goes with Boost.
 * Only a menu already set up is touched, and it keeps the Forge, Node and
 * version it was set up with: an extension added from a source checkout must
 * not point Finder at the checkout, and the next start still sees it as current.
 */
export async function resync(e: MenuEnv): Promise<void> {
  const state = readState(e)
  if (state === undefined) return
  await installMenu({ ...e, ...state })
}

const terminalFile = (e: Pick<MenuEnv, 'menuDir'>) => join(e.menuDir, 'terminal')

/**
 * Keeps the terminal Forge is running in, so a menu item that opens Forge
 * opens it there next time. On a Mac that is TERM_PROGRAM; on Windows,
 * Windows Terminal sets WT_SESSION. A terminal that says neither keeps the
 * last one known.
 */
export function rememberTerminal(e: Pick<MenuEnv, 'menuDir' | 'platform'>, env: NodeJS.ProcessEnv) {
  const terminal = e.platform === 'win32' ? (env.WT_SESSION ? 'wt' : undefined) : env.TERM_PROGRAM
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
