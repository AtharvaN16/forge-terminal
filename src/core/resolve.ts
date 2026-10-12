import { existsSync } from 'node:fs'
import { stat } from 'node:fs/promises'
import { resolve as resolvePath } from 'node:path'
import { glob } from 'tinyglobby'
import { probe } from '../engines/registry.js'
import { emptyDirectory, type ForgeError, fileNotFound, isForgeError } from './errors.js'
import { FORMATS } from './formats.js'
import type { SourceInfo } from './types.js'

export interface InputFailure {
  path: string
  error: ForgeError
}

export interface ResolvedInput {
  sources: SourceInfo[]
  failures: InputFailure[]
  /** source path -> the directory it was discovered under, for tree recreation. */
  roots: Map<string, string>
}

const IMAGE_EXTENSIONS = Object.values(FORMATS)
  .flatMap((f) => f.extensions)
  .map((e) => e.slice(1))

function isGlob(pattern: string): boolean {
  return /[*?[\]{}]/.test(pattern)
}

async function directoryEntries(dir: string, recursive: boolean): Promise<string[]> {
  const pattern = recursive
    ? `**/*.{${IMAGE_EXTENSIONS.join(',')}}`
    : `*.{${IMAGE_EXTENSIONS.join(',')}}`
  const found = await glob([pattern], {
    cwd: dir,
    absolute: true,
    onlyFiles: true,
    caseSensitiveMatch: false,
  })
  return found.sort()
}

/**
 * Every file that fails to probe is reported, whether it was named explicitly
 * or discovered by a directory scan or glob — the scan glob already filters
 * to known image extensions, so anything reaching probe() here looked like a
 * file the user expected converted (spec §8: failures are reported, not
 * fatal; a batch continues and reports them at the end). A non-ForgeError is
 * still rethrown for an explicitly named path, since that is an unanticipated
 * failure shape rather than a plain "this file could not be read".
 */
async function addDirectory(
  dir: string,
  recursive: boolean,
  failures: InputFailure[],
  add: (path: string, root: string, explicit: boolean) => Promise<void>,
): Promise<void> {
  const entries = await directoryEntries(dir, recursive)
  if (entries.length === 0) {
    failures.push({ path: dir, error: emptyDirectory(dir) })
    return
  }
  for (const entry of entries) await add(entry, dir, false)
}

/**
 * Every file a directory holds, probed — the directory branch of
 * `resolveInputs` on its own.
 *
 * For a caller that already knows its path is a directory and must not have
 * it read as a glob: `resolveInputs` treats any `[`, `{`, `*` or `?` in a
 * pattern as glob syntax, and a folder named `Photos [2024]` would match
 * nothing. The interactive shell resolves a dropped folder through this.
 */
export async function resolveDirectory(
  dir: string,
  opts: { recursive: boolean },
): Promise<ResolvedInput> {
  const sources: SourceInfo[] = []
  const failures: InputFailure[] = []
  const roots = new Map<string, string>()
  const abs = resolvePath(dir)
  await addDirectory(abs, opts.recursive, failures, async (path, root) => {
    try {
      sources.push(await probe(path))
      roots.set(path, root)
    } catch (e) {
      if (isForgeError(e)) failures.push({ path, error: e })
    }
  })
  return { sources, failures, roots }
}

export async function resolveInputs(
  patterns: string[],
  opts: { recursive: boolean; platform?: NodeJS.Platform },
): Promise<ResolvedInput> {
  const sources: SourceInfo[] = []
  const failures: InputFailure[] = []
  const roots = new Map<string, string>()
  const seen = new Set<string>()

  const add = async (path: string, root: string | undefined, explicit: boolean) => {
    const abs = resolvePath(path)
    if (seen.has(abs)) return
    seen.add(abs)
    try {
      sources.push(await probe(abs))
      if (root) roots.set(abs, root)
    } catch (e) {
      if (isForgeError(e)) failures.push({ path: abs, error: e })
      else if (explicit) throw e
    }
  }

  for (const pattern of patterns) {
    const abs = resolvePath(pattern)

    /**
     * A name that exists on disk is that file or folder, even when it contains
     * glob characters. `Scan [2024].pdf` is a real file, and reading it as a
     * character class matched nothing and reported nothing, so the run looked
     * like a success. Only a pattern that names nothing literally gets expanded.
     */
    if (isGlob(pattern) && !existsSync(abs)) {
      // The glob library reads `\` as an escape, so `C:\Pictures\*.jpg`
      // matched nothing. In a Windows path a backslash is only ever a
      // separator, and cmd and PowerShell leave globbing to the program, so
      // this is the only way a Windows user gets a batch at all.
      const spec =
        (opts.platform ?? process.platform) === 'win32' ? pattern.replaceAll('\\', '/') : pattern
      const matches = await glob([spec], { absolute: true, onlyFiles: true })
      // A glob that matches nothing is reported, not skipped. A run that did
      // nothing must not read as success (spec §3.2: ok only if every input
      // succeeded).
      if (matches.length === 0) failures.push({ path: abs, error: fileNotFound(abs) })
      for (const m of matches.sort()) await add(m, undefined, false)
      continue
    }
    let stats: Awaited<ReturnType<typeof stat>>
    try {
      stats = await stat(abs)
    } catch {
      failures.push({ path: abs, error: fileNotFound(abs) })
      continue
    }

    if (stats.isDirectory()) {
      await addDirectory(abs, opts.recursive, failures, add)
      continue
    }

    await add(abs, undefined, true)
  }

  return { sources, failures, roots }
}
