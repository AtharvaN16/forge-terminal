import { execFileSync } from 'node:child_process'
import { homedir } from 'node:os'
import { join } from 'node:path'

export type KnownFolder = 'Desktop' | 'Downloads'

const SHELL_FOLDERS =
  'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\User Shell Folders'

// Downloads has no friendly value name; Windows stores it under its folder GUID.
const VALUE_NAME: Record<KnownFolder, string> = {
  Desktop: 'Desktop',
  Downloads: '{374DE290-123F-4565-9164-39C4925E467B}',
}

/** The value from `reg query ... /v <name>` output, or undefined if there is none. */
export function parseRegQuery(output: string, valueName: string): string | undefined {
  for (const line of output.split(/\r?\n/)) {
    const m = /^\s+(.+?)\s+REG_(?:EXPAND_)?SZ\s+(.*?)\s*$/.exec(line)
    if (m?.[1] === valueName && m[2] !== undefined && m[2].length > 0) return m[2]
  }
  return undefined
}

function regQuery(valueName: string): string | undefined {
  try {
    const out = execFileSync('reg.exe', ['query', SHELL_FOLDERS, '/v', valueName], {
      encoding: 'utf8',
      timeout: 2000,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    return parseRegQuery(out, valueName)
  } catch {
    return undefined
  }
}

const cache = new Map<KnownFolder, string>()

/** Test seam: the cache would otherwise carry one case's answer into the next. */
export function resetKnownFoldersForTests(): void {
  cache.clear()
}

/**
 * Where the user's Desktop or Downloads really is. `<home>/Desktop` on macOS
 * and Linux. On Windows those folders can be redirected (OneDrive's folder
 * backup is common) and the registry is the only place that says so; spawning
 * reg.exe is slow enough to be worth doing once per name.
 */
export function knownFolder(
  name: KnownFolder,
  platform: NodeJS.Platform = process.platform,
  query: (valueName: string) => string | undefined = regQuery,
): string {
  if (platform !== 'win32') return join(homedir(), name)
  const hit = cache.get(name)
  if (hit !== undefined) return hit

  const raw = query(VALUE_NAME[name])
  const expanded = raw?.replace(/%([^%]+)%/g, (whole, v: string) => process.env[v] ?? whole)
  // An unexpandable %VAR% would make a path no one can write to; fall back.
  const resolved = expanded !== undefined && !expanded.includes('%') ? expanded : undefined
  const out = resolved ?? join(homedir(), name)
  cache.set(name, out)
  return out
}
