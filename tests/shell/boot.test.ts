import { afterEach, describe, expect, it } from 'vitest'
import { DEFAULT_PREFERENCES, type Preferences } from '../../src/config/preferences.js'
import { type BootDeps, bootShell } from '../../src/shell/boot.js'
import type { ShellStart } from '../../src/shell/launch.js'
import { DARK } from '../../src/shell/theme.js'
import { modulesLoaded, packagesIn } from '../helpers/load-log.js'

const later = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))
const themed: Preferences = { ...DEFAULT_PREFERENCES, theme: 'dark' }

/**
 * Stands in for the two slow things boot coordinates: the prefs read and the
 * shell's module graph. `events` records the order they actually happened in.
 */
function harness(
  prefs: Preferences,
  opts: { prefsMs?: number; loadMs?: number; warning?: string; loadFails?: Error } = {},
) {
  const events: string[] = []
  const started: ShellStart[] = []
  const deps: BootDeps = {
    loadPreferences: async () => {
      events.push('prefs:start')
      await later(opts.prefsMs ?? 10)
      events.push('prefs:end')
      return { prefs, ...(opts.warning === undefined ? {} : { warning: opts.warning }) }
    },
    loadShell: async () => {
      events.push('load:start')
      await later(opts.loadMs ?? 20)
      if (opts.loadFails) throw opts.loadFails
      events.push('load:end')
      return {
        launchShell: async (start: ShellStart) => {
          events.push('launch')
          started.push(start)
        },
      }
    },
  }
  return { deps, events, started }
}

describe('bootShell', () => {
  it('reads the prefs while the shell loads, and launches once both are in', async () => {
    const { deps, events } = harness(themed, { prefsMs: 10, loadMs: 30 })
    await bootShell(deps)
    expect(events).toEqual(['load:start', 'prefs:start', 'prefs:end', 'load:end', 'launch'])
  })

  it('launches on first run too, with no theme chosen yet', async () => {
    const { deps, started } = harness(DEFAULT_PREFERENCES)
    await bootShell(deps)
    expect(started[0]?.prefs.theme).toBeUndefined()
  })

  it('hands the shell its prefs, palette and config warning', async () => {
    const { deps, started } = harness(themed, { warning: 'Could not read config.json.' })
    await bootShell(deps)
    expect(started[0]?.prefs).toEqual(themed)
    expect(started[0]?.palette).toBe(DARK)
    expect(started[0]?.warning).toBe('Could not read config.json.')
  })

  describe('when the shell fails to load before the prefs are read', () => {
    const unhandled: unknown[] = []
    const record = (reason: unknown) => unhandled.push(reason)
    afterEach(() => {
      process.off('unhandledRejection', record)
    })

    it('rejects once, with no unhandled rejection', async () => {
      process.on('unhandledRejection', record)
      const { deps } = harness(themed, {
        prefsMs: 40,
        loadMs: 5,
        loadFails: new Error('chunk missing'),
      })
      await expect(bootShell(deps)).rejects.toThrow('chunk missing')
      await later(10)
      expect(unhandled).toEqual([])
    })
  })

  it('pulls in neither Ink nor React just by being imported', async () => {
    // applyColourPreference must run before chalk, which Ink imports. boot.ts
    // is imported right after it, so boot.ts itself must not reach Ink.
    const { exitCode, urls } = await modulesLoaded([
      '--input-type=module',
      '-e',
      "await import('./src/shell/boot.ts')",
    ])
    expect(exitCode).toBe(0)
    const packages = packagesIn(urls)
    expect(packages).not.toContain('ink')
    expect(packages).not.toContain('react')
    expect(packages).not.toContain('chalk')
  })
})
