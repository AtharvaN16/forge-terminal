import { homedir } from 'node:os'
import { join } from 'node:path'

/**
 * The directory that holds `forge/` (settings and extensions). XDG_CONFIG_HOME
 * wins everywhere; otherwise `~/.config` on macOS and Linux, and %APPDATA% on
 * Windows. Read at call time, not at module load: tests set the environment
 * per case, and a value captured at import would pin every case to the first.
 */
export function configBase(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const xdg = env.XDG_CONFIG_HOME
  if (xdg !== undefined && xdg.length > 0) return xdg
  if (platform === 'win32') {
    const appData = env.APPDATA
    return appData !== undefined && appData.length > 0
      ? appData
      : join(homedir(), 'AppData', 'Roaming')
  }
  return join(homedir(), '.config')
}
