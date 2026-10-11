import { loadPreferences, type Preferences } from '../config/preferences.js'
import { type IntroOptions, playIntro } from './intro.js'
import type { ShellStart } from './launch.js'
import { colourEnabled, paletteFor, VERSION } from './theme.js'

/**
 * Getting from `forge` to a prompt, with the intro and the shell's loading
 * running at the same time.
 *
 * The intro is four frames at 130 ms. Importing `launch.tsx`, which means
 * Ink, React and the whole shell, takes ~370 ms. Run one after the other they
 * add up. Here the import starts first and runs underneath the animation, so
 * the prompt appears at max(animation, import) instead of their sum (spec
 * §4.3).
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
  const shell = deps.loadShell()
  // Observed now, awaited later. If the import fails while the intro is still
  // drawing, the rejection would otherwise sit unobserved until the await
  // below and be reported as unhandled. The same rejection still reaches the
  // caller through that await.
  shell.catch(() => {})

  const { prefs, warning } = await deps.loadPreferences()
  const palette = paletteFor(prefs.theme)

  // Skipped on first run: the theme picker owns the screen until a theme is
  // chosen, and until then there is no palette to draw it in. App pushes a
  // still banner once the answer is in.
  if (prefs.theme !== undefined) {
    await deps.playIntro({
      width: deps.width(),
      palette,
      version: VERSION,
      defaultOutput: prefs.defaultOutput,
      colour: colourEnabled(),
    })
  }

  const { launchShell } = await shell
  await launchShell({ prefs, palette, ...(warning === undefined ? {} : { warning }) })
}
