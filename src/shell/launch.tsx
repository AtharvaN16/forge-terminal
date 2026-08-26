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
    {
      /**
       * The kitty keyboard protocol, which is the only way Cmd ever reaches a
       * terminal app on macOS.
       *
       * Without it a terminal reports modifiers by prefixing ESC, which cannot
       * express Command at all — Terminal.app's key-mapping UI does not even
       * offer it as a modifier. With it, the terminal reports each key as a
       * structured event carrying a modifier bitmask, and Cmd arrives as
       * `key.super`. That is what makes Cmd+Left and Cmd+Backspace possible in
       * iTerm2, Ghostty, WezTerm, kitty and VS Code's terminal.
       *
       * `auto` rather than `enabled`: Ink probes with `CSI ? u` and waits
       * 200ms for a reply, so a terminal that does not implement the protocol
       * — Terminal.app among them — is left exactly as it was rather than
       * being sent sequences it would print as text. The shell keeps working
       * there; it simply falls back to Option and the Ctrl bindings.
       *
       * `reportEventTypes` is what makes Cmd legible on the *arrow* keys, and
       * it is not optional for that. Measured against Ink 7.1.1: with only
       * `disambiguateEscapeCodes`, Cmd+Left arrives as the legacy `CSI 1;9D`,
       * which Ink's pre-kitty parser folds into `key.meta` — indistinguishable
       * from Option, so Cmd+Left would move by word instead of to the line
       * start. With event types on it arrives as `CSI 1;9:1D` and reports
       * `key.super` correctly.
       *
       * The cost is that the terminal then reports every key going up as well
       * as down. `useKeys` drops those releases in one place; nothing in this
       * app may call Ink's `useInput` directly, or it will fire twice per
       * keystroke.
       */
      kittyKeyboard: {
        mode: 'auto',
        flags: ['disambiguateEscapeCodes', 'reportEventTypes'],
      },
    },
  )
  await instance.waitUntilExit()
}
