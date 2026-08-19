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
export async function resolveInputs(
  patterns: string[],
  opts: { recursive: boolean },
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
    if (isGlob(pattern)) {
      const matches = await glob([pattern], { absolute: true, onlyFiles: true })
      for (const m of matches.sort()) await add(m, undefined, false)
      continue
    }

    const abs = resolvePath(pattern)
    let stats: Awaited<ReturnType<typeof stat>>
    try {
      stats = await stat(abs)
    } catch {
      failures.push({ path: abs, error: fileNotFound(abs) })
      continue
    }

    if (stats.isDirectory()) {
      const entries = await directoryEntries(abs, opts.recursive)
      if (entries.length === 0) {
        failures.push({ path: abs, error: emptyDirectory(abs) })
        continue
      }
      for (const entry of entries) await add(entry, abs, false)
      continue
    }

    await add(abs, undefined, true)
  }

  return { sources, failures, roots }
}
