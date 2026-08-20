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

/**
 * The name spec §8's "keep both" choice writes to: ` (1)` before the
 * extension — `photo (1).webp`, never `photo.webp (1)`, so the file still
 * opens in the right application. The number counts up until it finds a name
 * nothing occupies, because keeping both twice must not overwrite the copy
 * kept the first time.
 *
 * Pure with respect to conversion, like the rest of this module: it decides a
 * name, it does not create anything. Nothing here closes the race between the
 * check and a later write — the atomic rename in `engines/image.ts` is what
 * bounds the damage if some other process claims the name in between.
 */
export function uniqueOutputPath(path: string): string {
  if (!existsSync(path)) return path

  const dir = resolve(path, '..')
  const name = basename(path)
  const ext = extname(name)
  const stem = ext ? name.slice(0, -ext.length) : name

  for (let n = 1; n < 10_000; n++) {
    const candidate = join(dir, `${stem} (${n})${ext}`)
    if (!existsSync(candidate)) return candidate
  }
  // Unreachable short of 10,000 copies of one file in one folder. Throwing
  // beats returning `path`, which the caller would dutifully overwrite.
  throw new Error(`no free name beside ${name}`)
}

function stemAndExt(path: string): { dir: string; stem: string; ext: string } {
  const dir = resolve(path, '..')
  const name = basename(path)
  const ext = extname(name)
  return { dir, stem: ext ? name.slice(0, -ext.length) : name, ext: ext || '.pdf' }
}

/** `report.pdf` + `trimmed` → `report-trimmed.pdf`, beside the source. */
export function suffixedOutputPath(sourcePath: string, suffix: string): string {
  const { dir, stem, ext } = stemAndExt(resolve(sourcePath))
  return join(dir, `${stem}-${suffix}${ext}`)
}

/**
 * Numbered outputs for a split.
 *
 * Zero-padded to the width of the count, so `-01`…`-12` sorts the way anyone
 * looking at the folder expects. Unpadded numbers put `-10` before `-2`.
 */
export function splitOutputPaths(sourcePath: string, count: number): string[] {
  const { dir, stem, ext } = stemAndExt(resolve(sourcePath))
  const width = String(count).length
  return Array.from({ length: count }, (_, i) =>
    join(dir, `${stem}-${String(i + 1).padStart(width, '0')}${ext}`),
  )
}

/**
 * Outputs for rasterising selected pages of a document to images — one file
 * per page in `pages`, in the order given (`core/actions/convert.ts` and the
 * CLI's execute path both hand this an already-`normalisePages`d list).
 *
 * Named by the page's own 1-based number, not its position in the
 * selection — rendering pages 2-3 of a document writes `doc-2.jpg` and
 * `doc-3.jpg`, never `doc-1.jpg`/`doc-2.jpg`, so a filename on disk always
 * says which page it holds. `splitOutputPaths`-style zero-padding, but against
 * the widest page *number* being written rather than the document's whole page
 * count — a 2-page selection out of a 300-page document gets `-2`/`-3`, not
 * `-002`/`-003`.
 *
 * Padding follows the largest page number, NOT how many pages were selected.
 * Those differ whenever the selection is sparse, and using the count writes
 * names that sort wrongly: pages 2 and 10 are two pages, so a count-derived
 * width of 1 gives `doc-2.jpg` and `doc-10.jpg`, which `ls` and Finder order
 * as `doc-10, doc-2`. That is the same defect `splitOutputPaths` above is
 * careful to avoid, and the page picker makes sparse selections easy to reach.
 */
export function rasterOutputPaths(
  sourcePath: string,
  pages: number[],
  target: FormatId,
  destination?: string,
): [string, ...string[]] {
  const { stem } = stemAndExt(resolve(sourcePath))
  const dir = destination ? resolve(destination) : resolve(sourcePath, '..')
  const ext = primaryExtension(target)
  const width = String(Math.max(1, ...pages.map((p) => p + 1))).length
  const names = pages.map((p) => join(dir, `${stem}-${String(p + 1).padStart(width, '0')}${ext}`))
  const [first, ...rest] = names
  if (first === undefined) {
    throw new Error('rasterOutputPaths requires at least one selected page')
  }
  return [first, ...rest]
}

/**
 * Outputs for an extract.
 *
 * Separate files are named by 1-based page number rather than sequence, so
 * the name says where the page came from — `report-p12.pdf` is page 12, not
 * the twelfth file.
 */
export function extractOutputPaths(
  sourcePath: string,
  pages: number[],
  separate: boolean,
): string[] {
  if (!separate) return [suffixedOutputPath(sourcePath, 'extract')]
  const { dir, stem, ext } = stemAndExt(resolve(sourcePath))
  return pages.map((p) => join(dir, `${stem}-p${p + 1}${ext}`))
}

/**
 * The output for a merge.
 *
 * Every other operation derives its name from its one source; merge has none.
 * The common parent folder is the best available answer — `~/invoices/*.pdf`
 * becomes `invoices-merged.pdf` in that folder. When the inputs span folders
 * there is no shared name worth using, so it falls back to the first file.
 */
export function mergeOutputPath(sourcePaths: string[]): string {
  const first = resolve(sourcePaths[0] ?? 'merged.pdf')
  const dirs = new Set(sourcePaths.map((p) => resolve(p, '..')))
  if (dirs.size === 1) {
    const dir = resolve(first, '..')
    return join(dir, `${basename(dir)}-merged.pdf`)
  }
  return suffixedOutputPath(first, 'merged')
}
