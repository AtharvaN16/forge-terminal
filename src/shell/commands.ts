export interface Command {
  /** Without the leading slash. */
  name: string
  /** Shown beside the name in the palette. */
  description: string
  /** Whether the command needs a staged file to mean anything. */
  needsSource: boolean
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
  { name: 'convert', description: "change a file's format", needsSource: true },
  { name: 'compress', description: 'make a file smaller', needsSource: true },
  {
    name: 'remove-background',
    description: 'make an image background transparent',
    needsSource: true,
  },
  { name: 'pdf', description: 'page operations on a PDF', needsSource: true },
  { name: 'theme', description: 'switch between light and dark', needsSource: false },
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

/** Commands whose name begins with `fragment`, for the palette to list. */
export function matchCommands(fragment: string): Command[] {
  const needle = fragment.trim().toLowerCase()
  if (needle === '') return COMMANDS
  return COMMANDS.filter((c) => c.name.startsWith(needle))
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
