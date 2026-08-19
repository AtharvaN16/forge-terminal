import { existsSync, statSync } from 'node:fs'
import { basename, extname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { primaryExtension } from './formats.js'
import type { FormatId } from './types.js'

export interface OutputRequest {
  sourcePath: string
  target: FormatId
  /** A directory or an explicit filename. Absent means "beside the source". */
  output?: string
  /** When set with --recursive, the tree below this root is recreated. */
  sourceRoot?: string
}

/**
 * A trailing separator always means directory. An existing directory on disk
 * also means directory. Anything else with no extension is treated as a
 * directory too, because `-o dist` is far more often a folder than a file.
 */
export function looksLikeDirectory(p: string): boolean {
  if (p.endsWith('/') || p.endsWith(sep)) return true
  if (existsSync(p) && statSync(p).isDirectory()) return true
  return extname(p) === ''
}

function swapExtension(path: string, target: FormatId): string {
  const name = basename(path)
  const ext = extname(name)
  const stem = ext ? name.slice(0, -ext.length) : name
  return stem + primaryExtension(target)
}

export function resolveOutputPath(req: OutputRequest): string {
  const source = resolve(req.sourcePath)
  const filename = swapExtension(source, req.target)

  if (!req.output) return join(resolve(source, '..'), filename)

  const output = isAbsolute(req.output) ? req.output : resolve(req.output)

  if (!looksLikeDirectory(req.output)) return resolve(output)

  if (req.sourceRoot) {
    const root = resolve(req.sourceRoot)
    const rel = relative(root, resolve(source, '..'))
    if (rel && !rel.startsWith('..')) return join(output, rel, filename)
  }

  return join(output, filename)
}
