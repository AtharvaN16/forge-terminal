import { homedir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Terminals paste a *shell-escaped* path when you drop a file on them.
 * Terminal.app, iTerm2 and Ghostty backslash-escape spaces and shell
 * characters; WezTerm escapes only spaces by default; some terminals wrap the
 * whole thing in quotes. A quoted path is read the way sh reads it: in single
 * quotes everything is literal, so a quote in the name comes as `'\''`; in
 * double quotes a backslash escapes only `$`, `` ` ``, `"` and `\`. A path
 * that doesn't start with a quote has every backslash removed, so a quote
 * typed bare in the middle of a name (`it's.png`) stays.
 *
 * A dropped `file://` URL is read as the path it names, percent-escapes and
 * all.
 *
 * On Windows a backslash is the path separator, not an escape, and Windows
 * Terminal pastes a dropped path double-quoted when it contains a space — so
 * that branch only strips one matched pair of quotes.
 */
export function unescapePath(raw: string, platform: NodeJS.Platform = process.platform): string {
  let s = trimPasted(raw, platform)

  if (platform === 'win32') {
    const q = s[0]
    if (s.length > 1 && (q === '"' || q === "'") && s.endsWith(q)) s = s.slice(1, -1)
    if (s === '~') return homedir()
    // Either separator after `~`: `~\Pictures` is as natural to type here as `~/Pictures`.
    if (s.startsWith('~/') || s.startsWith('~\\')) return join(homedir(), s.slice(2))
    return s
  }

  const q = s.charAt(0)
  const word = q === "'" || q === '"' ? shellWord(s) : undefined
  if (word !== undefined) s = word
  // A terminal that wraps in quotes without escaping a quote inside the name.
  else if ((q === "'" || q === '"') && s.length > 1 && s.endsWith(q)) s = s.slice(1, -1)
  else s = s.replace(/\\(.)/g, '$1')

  // Some terminals drop a file as its URL: `file:///Users/me/My%20Photo.jpg`.
  if (s.startsWith('file://')) {
    try {
      return fileURLToPath(s, { windows: false })
    } catch {
      return s
    }
  }

  if (s === '~') return homedir()
  if (s.startsWith('~/')) return join(homedir(), s.slice(2))
  return s
}

/**
 * A paste without the whitespace around it, except an escaped space that ends
 * a name (`name\ `), which is the name's own; the space a terminal adds
 * after a drop is not. On Windows a backslash is a separator, so it escapes
 * nothing there.
 */
export function trimPasted(raw: string, platform: NodeJS.Platform = process.platform): string {
  const start = raw.trimStart()
  const end = start.trimEnd()
  if (platform === 'win32' || end.length === start.length) return end
  const slashes = end.length - end.replace(/\\+$/, '').length
  return slashes % 2 === 1 ? end + start.charAt(end.length) : end
}

/** One shell word with sh's quoting taken off, or undefined if a quote never closes. */
function shellWord(s: string): string | undefined {
  let out = ''
  let quote: string | null = null
  for (let i = 0; i < s.length; i++) {
    const c = s.charAt(i)
    const next = s.charAt(i + 1)
    if (quote === "'") {
      if (c === "'") quote = null
      else out += c
    } else if (quote === '"') {
      if (c === '"') quote = null
      else if (c === '\\' && '$`"\\\n'.includes(next) && next !== '') {
        out += next
        i++
      } else out += c
    } else if (c === "'" || c === '"') quote = c
    else if (c === '\\' && next !== '') {
      out += next
      i++
    } else out += c
  }
  return quote ? undefined : out
}

/**
 * Splits a paste containing several paths on *unescaped* whitespace, so
 * "My\ Photo.jpg" stays one path. Each result is then unescaped.
 *
 * The interactive shell runs it on a drop that names nothing as a whole
 * (`resolveDrop`): several files dropped at once arrive on one line.
 */
export function splitPastedPaths(
  raw: string,
  platform: NodeJS.Platform = process.platform,
): string[] {
  const out: string[] = []
  let current = ''
  let quote: string | null = null

  for (let i = 0; i < raw.length; i++) {
    const c = raw[i]
    if (c === undefined) break

    if (quote) {
      current += c
      // In double quotes `\"` is a quote in the name, not the closing one.
      if (quote === '"' && c === '\\' && platform !== 'win32') {
        current += raw[i + 1] ?? ''
        i++
      } else if (c === quote) quote = null
      continue
    }
    if (c === "'" || c === '"') {
      quote = c
      current += c
      continue
    }
    if (c === '\\') {
      current += c + (raw[i + 1] ?? '')
      i++
      continue
    }
    // ASCII whitespace only: `\s` also matches U+202F, which macOS puts
    // before "PM" in a screenshot's or recording's name.
    if (/[ \t\r\n]/.test(c)) {
      if (current) {
        out.push(current)
        current = ''
      }
      continue
    }
    current += c
  }

  if (current) out.push(current)
  // Arrow, not a bare reference: map would pass the index as `platform`.
  return out.map((p) => unescapePath(p, platform))
}

/**
 * True when a paste starts the way a dropped path does: a terminal drops
 * absolute paths (`/…`, or `C:\…` and `\\server\…` on Windows), escaped,
 * quoted or as a `file://` URL. `~/…` and `./…` count too, since a path
 * pasted by hand can be either. Words, a hex, a bare file name do not, so
 * they are typing, not something to read off the disk first.
 */
export function startsLikePath(raw: string, platform: NodeJS.Platform = process.platform): boolean {
  const [first = ''] = splitPastedPaths(raw, platform)
  return (platform === 'win32' ? /^(?:[~/.\\]|[A-Za-z]:[\\/])/ : /^[~/.]/).test(first)
}
