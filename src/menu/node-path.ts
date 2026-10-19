import { realpathSync } from 'node:fs'
import { delimiter, join } from 'node:path'

/**
 * The Node path to write into the menu's launcher. `process.execPath` has
 * every link resolved: under Homebrew it is the versioned Cellar folder,
 * which `brew upgrade node` deletes while Forge itself carries on working.
 * The `node` on PATH that resolves to the same file (/opt/homebrew/bin/node)
 * survives an upgrade, so that is the one kept.
 */
export function stableNode(
  execPath: string,
  path: string | undefined,
  platform: NodeJS.Platform = process.platform,
): string {
  const real = (p: string) => {
    try {
      return realpathSync(p)
    } catch {
      return undefined
    }
  }
  const target = real(execPath) ?? execPath
  const name = platform === 'win32' ? 'node.exe' : 'node'
  for (const dir of (path ?? '').split(delimiter)) {
    if (dir === '') continue
    const candidate = join(dir, name)
    if (candidate !== execPath && real(candidate) === target) return candidate
  }
  return execPath
}
