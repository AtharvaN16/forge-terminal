import { homedir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Terminals paste a *shell-escaped* path when you drop a file on them.
 * iTerm2 backslash-escapes spaces; some terminals wrap the whole thing in
 * quotes. Inside quotes the backslashes are literal, so the two cases must
 * not both be applied.
 *
 * A dropped `file://` URL is read as the path it names, percent-escapes and
 * all.
 *
 * On Windows a backslash is the path separator, not an escape, and Windows
 * Terminal pastes a dropped path double-quoted when it contains a space — so
 * that branch only strips one matched pair of quotes.
 */
export function unescapePath(raw: string, platform: NodeJS.Platform = process.platform): string {
  let s = raw.trim()

  if (platform === 'win32') {
    const q = s[0]
    if (s.length > 1 && (q === '"' || q === "'") && s.endsWith(q)) s = s.slice(1, -1)
    if (s === '~') return homedir()
    // Either separator after `~`: `~\Pictures` is as natural to type here as `~/Pictures`.
    if (s.startsWith('~/') || s.startsWith('~\\')) return join(homedir(), s.slice(2))
    return s
  }

  const quoted =
    (s.startsWith("'") && s.endsWith("'") && s.length > 1) ||
    (s.startsWith('"') && s.endsWith('"') && s.length > 1)

  if (quoted) s = s.slice(1, -1)
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
 * Splits a paste containing several paths on *unescaped* whitespace, so
 * "My\ Photo.jpg" stays one path. Each result is then unescaped.
 *
 * Deliberately uncalled: the shell is single-file from probe to result (spec
 * §10), and wiring this in would be the batch feature, not a fix. Retained,
 * with its tests, for when that lands.
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
      if (c === quote) quote = null
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
    if (/\s/.test(c)) {
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
