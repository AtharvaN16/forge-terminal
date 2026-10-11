import { configPath, loadPreferences, savePreferences } from '../config/preferences.js'
import { invalidArguments } from '../core/errors.js'
import type { Warning } from '../core/types.js'

export type ConfigKey = 'output' | 'theme' | 'quality'

export const CONFIG_KEYS: ConfigKey[] = ['output', 'theme', 'quality']

export type ConfigIntent =
  | { kind: 'config'; action: 'list' }
  | { kind: 'config'; action: 'path' }
  | { kind: 'config'; action: 'set'; key: ConfigKey; value: string }

export interface ConfigResult {
  stdout: string[]
  /** Always 0: a rejected value throws `invalid-arguments` instead (spec §3.4). */
  exitCode: 0
  /** The same facts as `stdout`, as data, for --json. */
  config: Record<string, string | number | null>
  warnings: Warning[]
}

/**
 * Returns lines rather than printing them, for the same reason the rest of
 * `cli/` does: the caller owns the streams, so this stays testable without
 * capturing stdout.
 *
 * Exit codes follow spec §3.4: a rejected value is a usage error, thrown as
 * invalid-arguments so it is printed on stderr with exit 2. A rejected value
 * writes nothing, so a typo never half-applies.
 */
export async function runConfig(intent: ConfigIntent): Promise<ConfigResult> {
  if (intent.action === 'path') {
    return { stdout: [configPath()], exitCode: 0, config: { path: configPath() }, warnings: [] }
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
    return {
      stdout: lines,
      exitCode: 0,
      config: {
        output: prefs.defaultOutput,
        theme: prefs.theme ?? null,
        quality: prefs.quality,
        path: configPath(),
      },
      warnings: warning === undefined ? [] : [{ code: 'config-unreadable', message: warning }],
    }
  }

  const { key, value } = intent

  if (key === 'theme') {
    if (value !== 'dark' && value !== 'light') {
      throw invalidArguments(`Theme must be dark or light, not ${value}.`)
    }
    await savePreferences({ theme: value })
    return {
      stdout: [`theme is now ${value}`],
      exitCode: 0,
      config: { theme: value },
      warnings: [],
    }
  }

  if (key === 'quality') {
    const n = Number(value)
    if (!Number.isInteger(n) || n < 1 || n > 100) {
      throw invalidArguments(`Quality must be a whole number between 1 and 100, not ${value}.`)
    }
    await savePreferences({ quality: n })
    return { stdout: [`quality is now ${n}`], exitCode: 0, config: { quality: n }, warnings: [] }
  }

  if (value.trim().length === 0) {
    throw invalidArguments('Output must be a folder path.')
  }
  await savePreferences({ defaultOutput: value })
  return {
    stdout: [`output is now ${value}`],
    exitCode: 0,
    config: { output: value },
    warnings: [],
  }
}
