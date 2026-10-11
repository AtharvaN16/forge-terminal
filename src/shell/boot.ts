import { loadPreferences, type Preferences } from '../config/preferences.js'
import { type IntroOptions, playIntro } from './intro.js'
import type { ShellStart } from './launch.js'
import { colourEnabled, paletteFor, VERSION } from './theme.js'

/**
 * Getting from `forge` to a prompt, with the intro and the shell's loading
 * running at the same time.
 *
 * The intro starts first. `playIntro` writes its first frame synchronously and
 * only yields at its frame timer, so the banner is on screen at once and the
 * import of `launch.tsx` (Ink, React, the whole shell) is started underneath
 * it (spec §4.3). Only the import's I/O and parse overlap the animation:
 * module evaluation is synchronous and still runs on the same thread, so it
 * delays a frame rather than hiding behind one. Measured: the prompt arrives
 * about 100 ms sooner than when the import ran first, and the banner's first
 * frame is on screen at once instead of after the import's blocking work.
 *
 * This module must stay React-free: index.ts imports it right after
 * `applyColourPreference()`, and anything here that reached Ink would fix
 * chalk's colour level too early. `launch.tsx` is only ever imported
 * dynamically, and its `ShellStart` is a type-only import that is erased.
 */
export interface BootDeps {
  loadPreferences: () => Promise<{ prefs: Preferences; warning?: string }>
  playIntro: (opts: IntroOptions) => Promise<void>
  loadShell: () => Promise<{ launchShell: (start: ShellStart) => Promise<void> }>
  width: () => number
}

const DEFAULTS: BootDeps = {
  loadPreferences,
  playIntro,
  loadShell: () => import('./launch.js'),
  width: () => process.stdout.columns ?? 80,
}

export async function bootShell(deps: BootDeps = DEFAULTS): Promise<void> {
  const { prefs, warning } = await deps.loadPreferences()
  const palette = paletteFor(prefs.theme)

  // Skipped on first run: the theme picker owns the screen until a theme is
  // chosen, and until then there is no palette to draw it in. App pushes a
  // still banner once the answer is in. Not awaited yet: the first frame is
  // already written when this returns a promise.
  const intro =
    prefs.theme === undefined
      ? Promise.resolve()
      : deps.playIntro({
          width: deps.width(),
          palette,
          version: VERSION,
          defaultOutput: prefs.defaultOutput,
          colour: colourEnabled(),
        })
  const shell = deps.loadShell()
  // Observed now, awaited later. A rejection while the other is still pending
  // would otherwise be reported as unhandled. Each still reaches the caller
  // through its await below, the intro's first, the shell's once it has ended.
  intro.catch(() => {})
  shell.catch(() => {})

  await intro
  const { launchShell } = await shell
  await launchShell({ prefs, palette, ...(warning === undefined ? {} : { warning }) })
}
