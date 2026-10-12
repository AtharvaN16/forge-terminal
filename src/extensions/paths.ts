import { access, readFile } from 'node:fs/promises'
import { join, sep } from 'node:path'
import { configBase } from '../config/config-base.js'
import { catalogEntry, type ExtensionId } from './catalog.js'

/** `<configDir>/forge/extensions`; the base is read at call time, as configPath() does. */
export function extensionsRoot(): string {
  return join(configBase(), 'forge', 'extensions')
}

export interface Installed {
  id: ExtensionId
  version: string
  dir: string
  /** Absolute path of the file to run. */
  entry: string
  kind: 'node' | 'exec'
}

/** A version string safe to use as a directory name. */
export const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

/** Reads `current` and the manifest. Undefined when absent or invalid — never throws. */
export async function installed(id: ExtensionId): Promise<Installed | undefined> {
  if (catalogEntry(id) === undefined) return undefined
  try {
    const base = join(extensionsRoot(), id)
    const version = (await readFile(join(base, 'current'), 'utf8')).trim()
    if (!SAFE_NAME.test(version)) return undefined
    const dir = join(base, version)
    const m: unknown = JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8'))
    if (typeof m !== 'object' || m === null) return undefined
    const { id: mid, version: mver, entry, kind, files } = m as Record<string, unknown>
    if (mid !== id || mver !== version) return undefined
    if (kind !== 'node' && kind !== 'exec') return undefined
    if (typeof entry !== 'string' || typeof files !== 'object' || files === null) return undefined
    if (!(entry in files)) return undefined
    const path = join(dir, entry)
    // `sep`, not '/': join() builds with backslashes on Windows.
    if (!path.startsWith(`${dir}${sep}`)) return undefined
    await access(path)
    return { id, version, dir, entry: path, kind }
  } catch {
    return undefined
  }
}
