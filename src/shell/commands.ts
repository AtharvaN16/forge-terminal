import type { ShellMode } from './theme.js'

export interface Command {
  /** Without the leading slash. */
  name: string
  /** Shown beside the name in the list. */
  description: string
  /** Whether the command needs a staged file to mean anything. */
  needsSource: boolean
  /** The mode it switches to, for the modes; its row's strip is that mode's colour. */
  mode?: ShellMode
  /** Which heading it sits under in the list. `undefined`: not listed at all. */
  group?: 'modes' | 'settings'
}

/**
 * Every command the shell knows, in the order the palette lists them.
 *
 * A list rather than a switch: the palette renders it, `/help` prints it, and
 * a new action adds one entry instead of touching three places. This is where
 * `/merge` and `/split` land when the PDF engine arrives, which is the reason
 * commands were chosen over an action menu in the first place.
 */
export const COMMANDS: Command[] = [
  {
    name: 'convert',
    description: "change a file's format",
    needsSource: true,
    mode: 'convert',
    group: 'modes',
  },
  {
    name: 'compress',
    description: 'make a file smaller',
    needsSource: true,
    mode: 'compress',
    group: 'modes',
  },
  {
    name: 'pdf',
    description: 'page operations on a PDF',
    needsSource: true,
    mode: 'pdf',
    group: 'modes',
  },
  {
    name: 'colour',
    description: 'palettes from images, scales from a colour',
    needsSource: false,
    mode: 'colour',
    group: 'modes',
  },
  {
    name: 'enhance',
    description: 'sharpen, boost resolution, remove background',
    needsSource: true,
    mode: 'enhance',
    group: 'modes',
  },
  {
    name: 'theme',
    description: 'switch between light and dark',
    needsSource: false,
    group: 'settings',
  },
  {
    name: 'extensions',
    description: 'install and remove the AI tools',
    needsSource: false,
    group: 'settings',
  },
  {
    name: 'update',
    description: 'check for a new version',
    needsSource: false,
    group: 'settings',
  },
  {
    name: 'about',
    description: 'who made Forge, and what it is built on',
    needsSource: false,
    group: 'settings',
  },
  // Not a row: the American spelling, so it works when typed.
  {
    name: 'color',
    description: 'palettes from images, scales from a colour',
    needsSource: false,
    mode: 'colour',
  },
  // Not a row: the list is the help. Typed, it opens the list (`listCommands`).
  { name: 'help', description: 'list these commands', needsSource: false },
]

/**
 * Whether what has been typed is the start of a command rather than a path.
 *
 * A leading slash alone is not enough: `/Users/me/photo.png` is an absolute
 * path and the most common thing anyone types at this prompt. A command has
 * no further slashes and no spaces, which no absolute path to a real file can
 * satisfy — and a dragged path arrives with its spaces escaped, so it carries
 * both.
 */
export function isCommandBuffer(text: string): boolean {
  if (!text.startsWith('/')) return false
  const rest = text.slice(1)
  return !rest.includes('/') && !rest.includes(' ')
}

export interface CommandList {
  /** The listed commands that match, modes before settings. */
  items: Command[]
  /** What is typed after the slash, as far as it matches: drawn bright on each row. */
  query: string
  /** What is typed after the slash, as typed. */
  typed: string
}

/**
 * What the list shows for `fragment`, the text after the slash: every listed
 * command whose name begins with it. `/help`, or the start of it, names no
 * row — the list is the help — so it shows the whole list.
 */
export function listCommands(fragment: string): CommandList {
  const typed = fragment.trim()
  const needle = typed.toLowerCase()
  const listed = COMMANDS.filter((c) => c.group !== undefined)
  const items = listed.filter((c) => c.name.startsWith(needle))
  if (items.length === 0 && needle !== '' && 'help'.startsWith(needle))
    return { items: listed, query: '', typed }
  return { items, query: needle, typed }
}

/**
 * The command a fully typed input names, exactly. Prefixes are deliberately
 * not resolved here — the palette disambiguates by highlighting, and guessing
 * which of `/convert` and `/compress` someone meant by `/co` is exactly the
 * kind of silent choice that surprises people.
 */
export function parseCommand(input: string): Command | undefined {
  const trimmed = input.trim().toLowerCase()
  if (!trimmed.startsWith('/')) return undefined
  const name = trimmed.slice(1)
  return COMMANDS.find((c) => c.name === name)
}
