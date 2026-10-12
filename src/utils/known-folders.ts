import { execFileSync } from 'node:child_process'
import { homedir } from 'node:os'
import { join } from 'node:path'

export type KnownFolder = 'Desktop' | 'Downloads'

/**
 * PowerShell, not `reg.exe`: reg.exe writes to a pipe in the console's OEM
 * code page, so a OneDrive root named after the organisation (`OneDrive -
 * Société Générale`) or a localised folder came back as mojibake — and then
 * became a new, wrongly named folder. Forcing PowerShell's output to UTF-8
 * avoids the code page altogether.
 *
 * Desktop has a .NET special folder. Downloads does not, so it is read from
 * the registry under its folder GUID; `Get-ItemProperty` expands the
 * `%USERPROFILE%` a REG_EXPAND_SZ value holds.
 */
const SCRIPT: Record<KnownFolder, string> = {
  Desktop: "[Environment]::GetFolderPath('Desktop')",
  Downloads:
    "(Get-ItemProperty 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\User Shell Folders')." +
    "'{374DE290-123F-4565-9164-39C4925E467B}'",
}

function powershellQuery(name: KnownFolder): string | undefined {
  try {
    const out = execFileSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `[Console]::OutputEncoding=[Text.Encoding]::UTF8; ${SCRIPT[name]}`,
      ],
      // A cold PowerShell start can take a second or more.
      { encoding: 'buffer', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] },
    )
    const value = out.toString('utf8').trim()
    return value.length > 0 ? value : undefined
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
 * backup is common) and only Windows itself can say so; starting PowerShell
 * is slow enough to be worth doing once per name.
 */
export function knownFolder(
  name: KnownFolder,
  platform: NodeJS.Platform = process.platform,
  query: (name: KnownFolder) => string | undefined = powershellQuery,
): string {
  if (platform !== 'win32') return join(homedir(), name)
  const hit = cache.get(name)
  if (hit !== undefined) return hit

  const raw = query(name)
  const expanded = raw?.replace(/%([^%]+)%/g, (whole, v: string) => process.env[v] ?? whole)
  // An unexpandable %VAR% would make a path no one can write to; fall back.
  const resolved = expanded !== undefined && !expanded.includes('%') ? expanded : undefined
  const out = resolved ?? join(homedir(), name)
  cache.set(name, out)
  return out
}
