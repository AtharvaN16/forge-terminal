import { loadPreferences, type Preferences } from '../config/preferences.js'
import type { ShellStart } from './launch.js'
import { paletteFor } from './theme.js'

/**
 * Getting from `forge` to a prompt.
 *
 * There used to be an intro here: the anvil banner, animated by hand before
 * Ink mounted, with the shell's import running underneath it. The home screen
 * (mockups/flow-parts-2026-10.html, tab 3) carries the brand itself now, as
 * part of a frame that fills the terminal, so a banner drawn first would only
 * be pushed straight up into scrollback by it.
 *
 * This module must stay React-free: index.ts imports it right after
 * `applyColourPreference()`, and anything here that reached Ink would fix
 * chalk's colour level too early. `launch.tsx` is only ever imported
 * dynamically, and its `ShellStart` is a type-only import that is erased.
 */
export interface BootDeps {
  loadPreferences: () => Promise<{ prefs: Preferences; warning?: string }>
  loadShell: () => Promise<{ launchShell: (start: ShellStart) => Promise<void> }>
}

const DEFAULTS: BootDeps = {
  loadPreferences,
  loadShell: () => import('./launch.js'),
}

/** What the right-click menu adds to a start: files to open with, and its first-run note. */
export type BootExtras = Pick<ShellStart, 'opened' | 'menuNote'>

export async function bootShell(deps: BootDeps = DEFAULTS, extras: BootExtras = {}): Promise<void> {
  // Both started at once: neither needs the other until launch.
  const shell = deps.loadShell()
  // Observed now, awaited below, so a rejection while the prefs are still
  // being read is not reported as unhandled first.
  shell.catch(() => {})
  const { prefs, warning } = await deps.loadPreferences()
  const palette = paletteFor(prefs.theme)
  const { launchShell } = await shell
  await launchShell({ prefs, palette, ...(warning === undefined ? {} : { warning }), ...extras })
}
