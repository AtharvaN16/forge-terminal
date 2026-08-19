import { homedir } from 'node:os'
import { join } from 'node:path'

/**
 * Terminals paste a *shell-escaped* path when you drop a file on them.
 * iTerm2 backslash-escapes spaces; some terminals wrap the whole thing in
 * quotes. Inside quotes the backslashes are literal, so the two cases must
 * not both be applied.
 */
export function unescapePath(raw: string): string {
  let s = raw.trim()

  const quoted =
    (s.startsWith("'") && s.endsWith("'") && s.length > 1) ||
    (s.startsWith('"') && s.endsWith('"') && s.length > 1)

  if (quoted) s = s.slice(1, -1)
  else s = s.replace(/\\(.)/g, '$1')

  if (s === '~') return homedir()
  if (s.startsWith('~/')) return join(homedir(), s.slice(2))
  return s
}

/**
 * Splits a paste containing several paths on *unescaped* whitespace, so
 * "My\ Photo.jpg" stays one path. Each result is then unescaped.
 */
export function splitPastedPaths(raw: string): string[] {
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
  return out.map(unescapePath)
}
