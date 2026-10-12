import { homedir } from 'node:os'
import { posix, win32 } from 'node:path'
import { printable } from './printable.js'

/** `path` relative to `base` when it is `base` or inside it, else undefined. */
function inside(path: string, base: string, p: typeof posix): string | undefined {
  const rel = p.relative(base, path)
  if (rel === '') return ''
  if (rel === '..' || rel.startsWith(`..${p.sep}`) || p.isAbsolute(rel)) return undefined
  return rel
}

/**
 * An absolute path the way a person would type it back: relative to `cwd`
 * when it lies inside it (the CLI, where `out/photo.png` is what was asked
 * for), `~`-abbreviated when it lies inside home, and untouched otherwise.
 *
 * Never climbs out of `cwd` with `..` — `../../Pictures/a.png` is harder to
 * read than the `~/Pictures/a.png` it stands for.
 *
 * On Windows the separator after `~` is a backslash like the rest, and the
 * relative part comes out in backslashes even when the path was built with
 * a `/` in it (`~\OneDrive\Desktop\photo.png`, not `~/OneDrive\Desktop/…`).
 */
export function displayPath(
  path: string,
  opts: { home?: string; cwd?: string; platform?: NodeJS.Platform } = {},
): string {
  return printable(shortPath(path, opts))
}

function shortPath(
  path: string,
  opts: { home?: string; cwd?: string; platform?: NodeJS.Platform },
): string {
  const p = (opts.platform ?? process.platform) === 'win32' ? win32 : posix
  if (opts.cwd !== undefined) {
    const rel = inside(path, opts.cwd, p)
    if (rel !== undefined) return rel === '' ? '.' : rel
  }
  const rel = inside(path, opts.home ?? homedir(), p)
  if (rel !== undefined) return rel === '' ? '~' : `~${p.sep}${rel}`
  return path
}

/**
 * A file's own name, for showing: `basename`, made printable. Windows splits
 * on either slash (`win32.basename`), so a path built with a `/` still names
 * its file.
 */
export function displayName(path: string, platform: NodeJS.Platform = process.platform): string {
  return printable((platform === 'win32' ? win32 : posix).basename(path))
}
