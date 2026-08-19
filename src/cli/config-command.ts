import { configPath, loadPreferences, savePreferences } from '../config/preferences.js'

export type ConfigKey = 'output' | 'theme' | 'quality'

export const CONFIG_KEYS: ConfigKey[] = ['output', 'theme', 'quality']

export type ConfigIntent =
  | { kind: 'config'; action: 'list' }
  | { kind: 'config'; action: 'path' }
  | { kind: 'config'; action: 'set'; key: ConfigKey; value: string }

export interface ConfigResult {
  stdout: string[]
  exitCode: number
}

/**
 * Returns lines rather than printing them, for the same reason the rest of
 * `cli/` does: the caller owns the streams, so this stays testable without
 * capturing stdout.
 *
 * Exit codes follow spec §9 — 0 for success, 2 for a usage error. A rejected
 * value writes nothing, so a typo never half-applies.
 */
export async function runConfig(intent: ConfigIntent): Promise<ConfigResult> {
  if (intent.action === 'path') {
    return { stdout: [configPath()], exitCode: 0 }
  }

  if (intent.action === 'list') {
    const { prefs, warning } = await loadPreferences()
    const lines = [
      `output    ${prefs.defaultOutput}`,
      `theme     ${prefs.theme ?? 'not set'}`,
      `quality   ${prefs.quality}`,
      '',
      configPath(),
    ]
    // A config that could not be read is reported here rather than swallowed:
    // this is the one command whose whole job is to say what the settings are.
    if (warning !== undefined) lines.unshift(`⚠ ${warning}`, '')
    return { stdout: lines, exitCode: 0 }
  }

  const { key, value } = intent

  if (key === 'theme') {
    if (value !== 'dark' && value !== 'light') {
      return { stdout: [`Theme must be dark or light, not ${value}.`], exitCode: 2 }
    }
    await savePreferences({ theme: value })
    return { stdout: [`theme is now ${value}`], exitCode: 0 }
  }

  if (key === 'quality') {
    const n = Number(value)
    if (!Number.isInteger(n) || n < 1 || n > 100) {
      return {
        stdout: [`Quality must be a whole number between 1 and 100, not ${value}.`],
        exitCode: 2,
      }
    }
    await savePreferences({ quality: n })
    return { stdout: [`quality is now ${n}`], exitCode: 0 }
  }

  if (value.trim().length === 0) {
    return { stdout: ['Output must be a folder path.'], exitCode: 2 }
  }
  await savePreferences({ defaultOutput: value })
  return { stdout: [`output is now ${value}`], exitCode: 0 }
}
