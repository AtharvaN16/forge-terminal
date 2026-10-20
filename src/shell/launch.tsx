import { render } from 'ink'
import type { Preferences } from '../config/preferences.js'
import type { Opened } from '../menu/command.js'
import { clipboardSupported, macPasteboard } from '../utils/pasteboard.js'
import { App } from './App.js'
// Loaded now, not when the shell exits: by then /update may have replaced
// the bundle's chunks, whose names change with every release.
import { relaunch, restartRequested } from './restart.js'
import { ThemeProvider } from './ThemeContext.js'
import type { Palette } from './theme.js'

/** What `boot.ts` hands over once preferences are read and the intro has played. */
export interface ShellStart {
  prefs: Preferences
  palette: Palette
  /** A config file that could not be read, phrased for the shell's history. */
  warning?: string
  /** Opened from the right-click menu: what to stage, in which mode. */
  opened?: Opened
  /** Sets the right-click menu up in the background; its first-run note. */
  menuNote?: () => Promise<string | undefined>
}

/**
 * Renders the shell and resolves when the user exits it.
 *
 * Preferences are read once, at the edge, by `boot.ts`: `core/` never touches
 * the config file, and the shell threads what it needs downward. A config that
 * could not be read is not fatal. `loadPreferences` hands back defaults plus a
 * sentence, and the shell shows that as history.
 *
 * The banner has already been drawn by the time this runs (see intro.ts and
 * boot.ts). This module is the expensive one: importing it pulls in Ink, React
 * and the whole shell, which is why boot.ts imports it during the animation
 * rather than after.
 */
export async function launchShell(start: ShellStart): Promise<void> {
  const { prefs, palette, warning, opened, menuNote } = start
  const instance = render(
    <ThemeProvider palette={palette}>
      <App
        prefs={prefs}
        pasteboard={clipboardSupported() ? macPasteboard() : null}
        {...(warning === undefined ? {} : { configWarning: warning })}
        {...(opened === undefined ? {} : { opened })}
        {...(menuNote === undefined ? {} : { menuNote })}
      />
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
      /**
       * Only the lines that changed are written, each over itself. Without
       * it Ink erases the whole frame and writes it again on every render —
       * 30 rows erased per frame of a mode change's fade, measured. A
       * terminal that honours synchronized output (Ghostty) hides that; one
       * that does not (Apple Terminal) shows the blank between, and the
       * screen flashed on every mode change (2026-10-14).
       */
      incrementalRendering: true,
    },
  )
  await instance.waitUntilExit()
  if (restartRequested()) relaunch()
}
