import { pathToFileURL } from 'node:url'
import supportsHyperlinks from 'supports-hyperlinks'

const ESC = String.fromCharCode(27)
const BEL = String.fromCharCode(7)

/**
 * OSC 8 turns a word into a click target. iTerm2, Ghostty, WezTerm, Kitty and
 * VS Code's terminal support it; macOS Terminal.app does not — and there a
 * bare file:// URL is still cmd+clickable, so that is the fallback rather
 * than dropping the affordance entirely.
 */
export function fileLink(label: string, path: string, opts: { supported?: boolean } = {}): string {
  const url = pathToFileURL(path).href
  const supported = opts.supported ?? supportsHyperlinks.stdout
  if (!supported) return url
  return `${ESC}]8;;${url}${BEL}${label}${ESC}]8;;${BEL}`
}
