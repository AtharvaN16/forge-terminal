import { randomBytes } from 'node:crypto'
import { copyFile, mkdir, readdir, readFile, rename, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { extname, join } from 'node:path'
import type { Pasteboard } from '../utils/pasteboard.js'
import { renameAtomic, writeAtomic } from './atomic.js'
import { uniqueOutputPath } from './output-path.js'
import type { FormatId } from './types.js'

/**
 * A copied image as a source and its result as the destination: the app's
 * ⌘V, `forge clip` and the MCP `forge_clip` tool all go through here.
 *
 * Everything lives in one workspace folder in the system's temp folder:
 *
 *   <root>/<id>/in/Copied image        the source, as read from the clipboard
 *   <root>/<id>/out/                   where its result is written
 *   <root>/last/Copied image.png       the last original, for undo
 *
 * The result has to stay on disk after it is put back: the clipboard carries
 * a reference to the file as well as its bytes, and an app that attaches the
 * file reads it when you paste, which can be much later. So old runs are not
 * deleted straight away; only the most recent few are kept.
 */

export function clipRoot(): string {
  return join(tmpdir(), 'forge-clip')
}

/** Runs kept for pasting later; older ones are removed when a new one starts. */
const KEEP_RUNS = 5

export interface Taken {
  /** The copied image, as a file named `Copied image`, with no extension. */
  source: string
  /** Where the result goes. Never the source's own folder. */
  outDir: string
  /** The clipboard's change count when the image was read. */
  changeCount: number
}

const FORMAT_BY_EXT: Record<string, FormatId> = {
  '.png': 'png',
  '.jpg': 'jpeg',
  '.jpeg': 'jpeg',
  '.webp': 'webp',
  '.heic': 'heic',
  '.avif': 'avif',
  '.gif': 'gif',
  '.tiff': 'tiff',
}

/** Reads the copied image into a new run folder; null when no image is copied. */
export async function takeImage(pb: Pasteboard, root: string = clipRoot()): Promise<Taken | null> {
  const id = `${Date.now().toString(36)}-${randomBytes(3).toString('hex')}`
  const run = join(root, id)
  const got = await pb.read(join(run, 'in'))
  if (!got) {
    await rm(run, { recursive: true, force: true })
    return null
  }
  const outDir = join(run, 'out')
  await mkdir(outDir, { recursive: true })
  await keepOriginal(root, got.path)
  // No extension: every screen and line that names the source by its file
  // name then says "Copied image". Sources are read by content, never by
  // extension (invariant 3), and outputs take theirs from the format.
  const source = join(run, 'in', 'Copied image')
  await rename(got.path, source)
  await pruneRuns(root, id)
  return { source, outDir, changeCount: got.changeCount }
}

/** Replaces the kept original with this one: undo only ever goes back one step. */
async function keepOriginal(root: string, path: string): Promise<void> {
  const last = join(root, 'last')
  const name = `Copied image${extname(path)}`
  const temp = join(root, `.last-${randomBytes(4).toString('hex')}`)
  await mkdir(temp, { recursive: true })
  await copyFile(path, join(temp, name))
  await rm(last, { recursive: true, force: true })
  await renameAtomic(temp, last)
}

async function pruneRuns(root: string, keep: string): Promise<void> {
  const entries = await readdir(root, { withFileTypes: true }).catch(() => [])
  const runs = await Promise.all(
    entries
      .filter((e) => e.isDirectory() && e.name !== 'last' && !e.name.startsWith('.'))
      .map(async (e) => ({
        name: e.name,
        at: (await stat(join(root, e.name)).catch(() => null))?.mtimeMs ?? 0,
      })),
  )
  const old = runs
    .filter((r) => r.name !== keep)
    .sort((a, b) => b.at - a.at)
    .slice(KEEP_RUNS - 1)
  await Promise.all(old.map((r) => rm(join(root, r.name), { recursive: true, force: true })))
}

/** The kept original, if there is one. */
export async function lastOriginal(
  root: string = clipRoot(),
): Promise<{ path: string; format: FormatId } | null> {
  const last = join(root, 'last')
  const name = (await readdir(last).catch(() => [] as string[])).find(
    (n) => FORMAT_BY_EXT[extname(n).toLowerCase()] !== undefined,
  )
  if (name === undefined) return null
  return { path: join(last, name), format: FORMAT_BY_EXT[extname(name).toLowerCase()] as FormatId }
}

/**
 * Puts a result on the clipboard, unless something else was copied since the
 * image was read: that newer copy is the person's, and is left alone.
 */
export async function putBack(
  pb: Pasteboard,
  taken: Pick<Taken, 'changeCount'>,
  output: string,
  format: FormatId,
): Promise<'placed' | 'changed'> {
  const { changeCount } = await pb.peek()
  if (changeCount !== taken.changeCount) return 'changed'
  await pb.write(output, format)
  return 'placed'
}

/** Puts the last original back on the clipboard. False when none is kept. */
export async function undoClip(pb: Pasteboard, root: string = clipRoot()): Promise<boolean> {
  const last = await lastOriginal(root)
  if (!last) return false
  await pb.write(last.path, last.format)
  return true
}

/** Copies a result into a folder under a name nothing there has. */
export async function saveCopy(result: string, folder: string): Promise<string> {
  const path = uniqueOutputPath(join(folder, `Copied image${extname(result)}`))
  await writeAtomic(path, await readFile(result))
  return path
}
