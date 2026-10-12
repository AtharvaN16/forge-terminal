import { win32 } from 'node:path'

/**
 * A path's file (or folder) name, for a label. Windows splits on either
 * slash. Everywhere else it is exactly the `split('/').pop()` the labels used
 * before the port — `basename` would differ on a trailing slash
 * (`~/Pictures/` names itself `''`, then each call site's fallback, where
 * `basename` would say `Pictures`).
 */
export function lastSegment(
  path: string,
  platform: NodeJS.Platform = process.platform,
): string | undefined {
  return platform === 'win32' ? win32.basename(path) : path.split('/').pop()
}
