import { render } from 'ink'
import { loadPreferences } from '../config/preferences.js'
import { App } from './App.js'
import { playIntro } from './intro.js'
import { ThemeProvider } from './ThemeContext.js'
import { colourEnabled, paletteFor, VERSION } from './theme.js'

/**
 * Renders the shell and resolves when the user exits it.
 *
 * Preferences are read exactly once, here, at the edge — `core/` never
 * touches the config file, and the shell threads what it needs downward.
 * A config that could not be read is not fatal: `loadPreferences` hands back
 * defaults plus a sentence, and the shell shows that as history.
 */
export async function launchShell(): Promise<void> {
  const { prefs, warning } = await loadPreferences()
  const palette = paletteFor(prefs.theme)

  /**
   * The banner is drawn here, before Ink exists, so its loop can play and then
   * simply stop — the last frame becomes scrollback and Ink mounts underneath
   * it. See intro.ts for why it cannot be done inside Ink.
   *
   * Skipped on first run: the theme picker owns the screen until a theme is
   * chosen, and until then there is no palette to draw it in. App pushes a
   * still banner once the answer is in.
   */
  if (prefs.theme !== undefined) {
    await playIntro({
      width: process.stdout.columns ?? 80,
      palette,
      version: VERSION,
      defaultOutput: prefs.defaultOutput,
      colour: colourEnabled(),
    })
  }

  const instance = render(
    <ThemeProvider palette={palette}>
      <App prefs={prefs} {...(warning === undefined ? {} : { configWarning: warning })} />
    </ThemeProvider>,
  )
  await instance.waitUntilExit()
}
