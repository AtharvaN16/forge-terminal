import { homedir } from 'node:os'
import { basename, isAbsolute, relative, sep } from 'node:path'
import { printable } from './printable.js'

/** `path` relative to `base` when it is `base` or inside it, else undefined. */
function inside(path: string, base: string): string | undefined {
  const rel = relative(base, path)
  if (rel === '') return ''
  if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return undefined
  return rel
}

/**
 * An absolute path the way a person would type it back: relative to `cwd`
 * when it lies inside it (the CLI, where `out/photo.png` is what was asked
 * for), `~`-abbreviated when it lies inside home, and untouched otherwise.
 *
 * Never climbs out of `cwd` with `..` — `../../Pictures/a.png` is harder to
 * read than the `~/Pictures/a.png` it stands for.
 */
export function displayPath(path: string, opts: { home?: string; cwd?: string } = {}): string {
  return printable(shortPath(path, opts))
}

function shortPath(path: string, opts: { home?: string; cwd?: string }): string {
  if (opts.cwd !== undefined) {
    const rel = inside(path, opts.cwd)
    if (rel !== undefined) return rel === '' ? '.' : rel
  }
  const rel = inside(path, opts.home ?? homedir())
  if (rel !== undefined) return rel === '' ? '~' : `~/${rel}`
  return path
}

/** A file's own name, for showing: `basename`, made printable. */
export function displayName(path: string): string {
  return printable(basename(path))
}
