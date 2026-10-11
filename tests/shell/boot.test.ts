import { afterEach, describe, expect, it } from 'vitest'
import { DEFAULT_PREFERENCES, type Preferences } from '../../src/config/preferences.js'
import { type BootDeps, bootShell } from '../../src/shell/boot.js'
import type { ShellStart } from '../../src/shell/launch.js'
import { DARK } from '../../src/shell/theme.js'
import { modulesLoaded, packagesIn } from '../helpers/load-log.js'

const later = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))
const themed: Preferences = { ...DEFAULT_PREFERENCES, theme: 'dark' }

/**
 * Stands in for the three slow things boot coordinates: the prefs read, the
 * intro animation and the shell's module graph. `events` records the order
 * they actually happened in.
 */
function harness(
  prefs: Preferences,
  opts: { introMs?: number; loadMs?: number; warning?: string; loadFails?: Error } = {},
) {
  const events: string[] = []
  const started: ShellStart[] = []
  const deps: BootDeps = {
    loadPreferences: async () => ({
      prefs,
      ...(opts.warning === undefined ? {} : { warning: opts.warning }),
    }),
    playIntro: async () => {
      events.push('intro:start')
      await later(opts.introMs ?? 40)
      events.push('intro:end')
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
    width: () => 120,
  }
  return { deps, events, started }
}

describe('bootShell', () => {
  it('starts the intro first, then loads the shell underneath it', async () => {
    const { deps, events } = harness(themed, { introMs: 40, loadMs: 20 })
    await bootShell(deps)
    expect(events).toEqual(['intro:start', 'load:start', 'load:end', 'intro:end', 'launch'])
  })

  it('waits for a slow load after a fast intro, and only then launches', async () => {
    const { deps, events } = harness(themed, { introMs: 10, loadMs: 60 })
    await bootShell(deps)
    expect(events).toEqual(['intro:start', 'load:start', 'intro:end', 'load:end', 'launch'])
  })

  it('skips the intro on first run, when no theme has been chosen, and still launches', async () => {
    const { deps, events, started } = harness(DEFAULT_PREFERENCES)
    await bootShell(deps)
    expect(events).toEqual(['load:start', 'load:end', 'launch'])
    expect(started[0]?.prefs.theme).toBeUndefined()
  })

  it('hands the shell its prefs, palette and config warning', async () => {
    const { deps, started } = harness(themed, { warning: 'Could not read config.json.' })
    await bootShell(deps)
    expect(started[0]?.prefs).toEqual(themed)
    expect(started[0]?.palette).toBe(DARK)
    expect(started[0]?.warning).toBe('Could not read config.json.')
  })

  describe('when the shell fails to load mid-intro', () => {
    const unhandled: unknown[] = []
    const record = (reason: unknown) => unhandled.push(reason)
    afterEach(() => {
      process.off('unhandledRejection', record)
    })

    it('finishes the intro, then rejects once, with no unhandled rejection', async () => {
      process.on('unhandledRejection', record)
      // The load fails at 20 ms, while the 40 ms intro is still drawing.
      const { deps, events } = harness(themed, {
        introMs: 40,
        loadMs: 20,
        loadFails: new Error('chunk missing'),
      })
      await expect(bootShell(deps)).rejects.toThrow('chunk missing')
      expect(events).toEqual(['intro:start', 'load:start', 'intro:end'])
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
