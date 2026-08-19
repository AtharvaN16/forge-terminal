import { render } from 'ink'
import { loadPreferences } from '../config/preferences.js'
import { App } from './App.js'
import { ThemeProvider } from './ThemeContext.js'
import { paletteFor } from './theme.js'

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
  const instance = render(
    <ThemeProvider palette={paletteFor(prefs.theme)}>
      <App prefs={prefs} {...(warning === undefined ? {} : { configWarning: warning })} />
    </ThemeProvider>,
  )
  await instance.waitUntilExit()
}
