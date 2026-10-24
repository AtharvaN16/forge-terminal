import { basename, dirname, extname, join } from 'node:path'
import { uniqueOutputPath } from '../core/output-path.js'
import type { MenuAction } from './items.js'
import { shellQuote } from './mac.js'

/**
 * What a right-click item does, once the launcher has found Forge
 * (`forge menu run <action> <files…>`).
 *
 * Sharpen runs here, with no window, and says how it went in one
 * notification, then selects what it made. Everything else opens Forge in a
 * terminal window: the one the user last ran Forge in, since a menu item has
 * no terminal of its own to borrow.
 */

export interface RunDeps {
  platform: NodeJS.Platform
  /** How to start Forge again: Node, its flags, Forge's entry script. */
  self: string[]
  /** The terminal Forge was last run in: TERM_PROGRAM on a Mac, 'wt' for Windows Terminal. */
  terminal: string | undefined
  /** Starts a program and leaves it running. */
  launch: (cmd: string, args: string[]) => Promise<void>
  /** Sharpens one file: the file it wrote, or why not, in Forge's words. */
  sharpen: (path: string) => Promise<SharpenResult>
  notify: (title: string, body: string) => Promise<void>
  reveal: (path: string) => Promise<void>
  /** Linux: whether a program is on PATH, to find a terminal that is installed. */
  has?: (cmd: string) => boolean
}

/**
 * How each Linux terminal is told to run a command in a new window: the
 * arguments that go before it. Known by the name rememberTerminal keeps.
 */
const LINUX_TERMINALS: Record<string, string[]> = {
  'gnome-terminal': ['--'],
  konsole: ['-e'],
  'xfce4-terminal': ['-x'],
  kitty: [],
  alacritty: ['-e'],
  wezterm: ['start', '--'],
  ghostty: ['-e'],
  xterm: ['-e'],
  // Debian's and Ubuntu's choice of terminal, which takes -e by policy.
  'x-terminal-emulator': ['-e'],
  // The freedesktop way to the user's chosen terminal, where it is installed.
  'xdg-terminal-exec': [],
}

/** Tried in this order when the terminal Forge was last run in is not known, or not there. */
const LINUX_FALLBACK = [
  'xdg-terminal-exec',
  'x-terminal-emulator',
  'gnome-terminal',
  'konsole',
  'xfce4-terminal',
  'kitty',
  'alacritty',
  'wezterm',
  'ghostty',
  'xterm',
]

/**
 * The Linux terminal to open `argv` in: the one Forge was last run in if it
 * is still installed, else the first installed of the usual ones. Undefined
 * when there is none.
 */
export function linuxTerminalCommand(
  terminal: string | undefined,
  argv: string[],
  has: (cmd: string) => boolean,
): [string, string[]] | undefined {
  const known = terminal !== undefined && terminal in LINUX_TERMINALS ? [terminal] : []
  const found = [...known, ...LINUX_FALLBACK].find(has)
  return found === undefined ? undefined : [found, [...(LINUX_TERMINALS[found] ?? []), ...argv]]
}

export type SharpenResult = { output: string } | { input?: string; error: string }

/** The program and arguments that open `terminal` running `argv`, on `platform`. */
export function terminalCommand(
  terminal: string | undefined,
  argv: string[],
  platform: NodeJS.Platform,
): [string, string[]] {
  if (platform === 'linux')
    return linuxTerminalCommand(terminal, argv, () => true) ?? ['xterm', ['-e', ...argv]]
  if (platform === 'win32') {
    if (terminal === 'wt') return ['wt.exe', ['-w', 'new', ...argv]]
    // Not Node itself, detached: that gets no console at all (DETACHED_PROCESS),
    // and the menu's own process runs under a hidden one. conhost opens a window.
    return ['conhost.exe', argv]
  }
  if (terminal === 'ghostty') return ['/usr/bin/open', ['-na', 'Ghostty', '--args', '-e', ...argv]]
  // `exec`, so quitting Forge ends the shell too and the window can close.
  const line = `exec ${argv.map(shellQuote).join(' ')}`
  const script =
    terminal === 'iTerm.app'
      ? [
          'tell application "iTerm"',
          'create window with default profile',
          'tell current session of current window to write text (item 1 of argv)',
          'activate',
          'end tell',
        ]
      : // Launching Terminal opens a window of its own; `do script` alone would
        // open a second one beside it, so a cold start uses that first window.
        [
          'if application "Terminal" is running then',
          'tell application "Terminal" to do script (item 1 of argv)',
          'else',
          'tell application "Terminal" to do script (item 1 of argv) in window 1',
          'end if',
          'tell application "Terminal" to activate',
        ]
  return [
    '/usr/bin/osascript',
    [...['on run argv', ...script, 'end run'].flatMap((l) => ['-e', l]), line],
  ]
}

/**
 * Where Sharpen writes, beside the original: `photo-sharp.png` as the CLI
 * names it, or `photo-sharp (1).png` when that is taken. A menu click has no
 * one to ask Replace or Keep both, so it keeps both, as decided.
 */
export function freeSharpName(source: string): string {
  const stem = basename(source, extname(source))
  return uniqueOutputPath(join(dirname(source), `${stem}-sharp.png`))
}

/** The notification for a Sharpen run: what it made, or what went wrong. */
export function sharpenSummary(results: SharpenResult[]): { title: string; body: string } {
  const made = results.flatMap((r) => ('output' in r ? [r.output] : []))
  const failed = results.flatMap((r) => ('error' in r ? [r] : []))
  const [first] = failed
  if (first === undefined)
    return {
      title: made.length === 1 ? basename(made[0] as string) : `${made.length} files`,
      body: 'Sharpened',
    }
  const name = first.input ? basename(first.input) : 'file'
  if (results.length === 1) return { title: `${name} not sharpened`, body: first.error }
  return {
    title: `${made.length} of ${results.length} files sharpened`,
    body: `${name}: ${first.error}`,
  }
}

export async function runMenuAction(
  action: MenuAction,
  paths: string[],
  d: RunDeps,
): Promise<void> {
  if (action === 'sharpen') {
    const results: SharpenResult[] = []
    for (const path of paths) {
      const r = await d.sharpen(path)
      results.push('error' in r ? { input: path, ...r } : r)
    }
    const { title, body } = sharpenSummary(results)
    await d.notify(title, body)
    const made = results.flatMap((r) => ('output' in r ? [r.output] : []))
    const last = made.at(-1)
    if (last !== undefined) await d.reveal(last)
    return
  }
  // Open Forge opens the app as it starts; the file clicked is not brought in.
  const files = action === 'open' ? [] : paths
  const argv = [...d.self, 'menu', 'open', action, ...files]
  const command =
    d.platform === 'linux'
      ? linuxTerminalCommand(d.terminal, argv, d.has ?? (() => true))
      : terminalCommand(d.terminal, argv, d.platform)
  if (command === undefined) return d.notify(NO_TERMINAL_TITLE, NO_TERMINAL_BODY)
  await d.launch(...command)
}

const NO_TERMINAL_TITLE = 'Forge could not open'
const NO_TERMINAL_BODY = 'No terminal was found to open it in.'
