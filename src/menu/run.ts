import { basename, dirname, extname, join } from 'node:path'
import { uniqueOutputPath } from '../core/output-path.js'
import type { MenuAction } from './items.js'
import { shellQuote } from './mac.js'

/**
 * What a right-click item does, once the launcher has found Forge
 * (`forge menu run <action> <files…>`).
 *
 * Sharpen and each preset's item run here, with no window, and say how it
 * went in one notification, then select what they made. Everything else opens Forge in a
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
  /** Runs a saved preset on one file: the file it wrote and the steps it took, or why not. */
  runPreset?: (name: string, path: string) => Promise<PresetRunResult>
  notify: (title: string, body: string) => Promise<void>
  reveal: (path: string) => Promise<void>
}

export type SharpenResult = { output: string } | { input?: string; error: string }
export type PresetRunResult =
  | { output: string; chain: string[] }
  | { input?: string; error: string }

/** The program and arguments that open `terminal` running `argv`, on `platform`. */
export function terminalCommand(
  terminal: string | undefined,
  argv: string[],
  platform: NodeJS.Platform,
): [string, string[]] {
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

/**
 * The notification for a preset's run (decided, quick-actions round one):
 * the file it made, then the preset and its steps — or that it didn't
 * finish, with the file and Forge's own reason.
 */
export function presetSummary(
  name: string,
  results: PresetRunResult[],
): { title: string; body: string } {
  const made = results.flatMap((r) => ('output' in r ? [r] : []))
  const failed = results.flatMap((r) => ('error' in r ? [r] : []))
  const [first] = failed
  if (first === undefined) {
    const steps = made[0]?.chain ?? []
    return {
      title: made.length === 1 ? basename(made[0]?.output ?? '') : `${made.length} files`,
      body: [name, ...(steps.length > 0 ? [steps.join(' ─▸ ')] : [])].join(' · '),
    }
  }
  const file = first.input ? basename(first.input) : 'file'
  if (results.length === 1)
    return { title: `${name} didn’t finish`, body: `${file}: ${first.error}` }
  return {
    title: `${name} finished ${made.length} of ${results.length} files`,
    body: `${file}: ${first.error}`,
  }
}

export async function runMenuAction(
  action: MenuAction,
  paths: string[],
  d: RunDeps,
  preset?: string,
): Promise<void> {
  if (action === 'preset') {
    if (preset === undefined || d.runPreset === undefined) return
    const results: PresetRunResult[] = []
    for (const path of paths) {
      const r = await d.runPreset(preset, path)
      results.push('error' in r ? { input: path, ...r } : r)
    }
    const { title, body } = presetSummary(preset, results)
    await d.notify(title, body)
    const last = results.flatMap((r) => ('output' in r ? [r.output] : [])).at(-1)
    if (last !== undefined) await d.reveal(last)
    return
  }
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
  const [cmd, args] = terminalCommand(
    d.terminal,
    [...d.self, 'menu', 'open', action, ...files],
    d.platform,
  )
  await d.launch(cmd, args)
}
