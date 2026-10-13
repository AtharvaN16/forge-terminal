import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { afterCommand, noteLines } from '../../src/cli/update-note.js'
import { savePreferences } from '../../src/config/preferences.js'
import { DARK } from '../../src/shell/theme.js'
import { CHECK_EVERY_MS, readCache, writeCache } from '../../src/update/check.js'
import { makeTempDir } from '../helpers/fixtures.js'

// biome-ignore lint/suspicious/noControlCharactersInRegex: stripping SGR is the point
const plain = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '')

describe('noteLines (A6)', () => {
  it('says what is out, your version, and what to type in the terminal', () => {
    expect(noteLines('0.2.2', '0.2.1')).toEqual([
      ' ↑ Forge 0.2.2 is available · your version 0.2.1',
      '   In terminal: forge update',
    ])
  })

  it('in colour: the same words on the blue tint, the command bold', () => {
    const lines = noteLines('0.2.2', '0.2.1', DARK)
    expect(lines.map(plain).map((l) => l.trimEnd())).toEqual([
      ' ↑ Forge 0.2.2 is available · your version 0.2.1',
      '   In terminal: forge update',
    ])
    expect(lines[0]).toContain('\x1b[48;2;42;52;72m') // newTagBg #2a3448
    expect(lines[1]).toContain('\x1b[1m')
  })
})

describe('afterCommand', () => {
  let saved: string | undefined
  const NOW = 100 * CHECK_EVERY_MS
  beforeEach(async () => {
    saved = process.env.XDG_CONFIG_HOME
    process.env.XDG_CONFIG_HOME = await makeTempDir()
  })
  afterEach(() => {
    if (saved === undefined) delete process.env.XDG_CONFIG_HOME
    else process.env.XDG_CONFIG_HOME = saved
  })

  const quiet = () => {
    const refreshed: number[] = []
    return { refresh: () => refreshed.push(1), refreshed }
  }

  it('prints the note when a newer Forge is known, and not again the same day', async () => {
    await writeCache({ checkedAt: NOW - 1000, latest: '0.2.2' })
    const r = quiet()
    expect((await afterCommand('0.2.1', { now: NOW, env: {}, refresh: r.refresh })).length).toBe(2)
    expect((await readCache())?.notifiedAt).toBe(NOW)
    expect(await afterCommand('0.2.1', { now: NOW + 60_000, env: {}, refresh: r.refresh })).toEqual(
      [],
    )
    expect(
      (await afterCommand('0.2.1', { now: NOW + CHECK_EVERY_MS + 1, env: {}, refresh: r.refresh }))
        .length,
    ).toBe(2)
  })

  it('says nothing when this is the latest', async () => {
    await writeCache({ checkedAt: NOW - 1000, latest: '0.2.1' })
    expect(await afterCommand('0.2.1', { now: NOW, env: {}, refresh: quiet().refresh })).toEqual([])
  })

  it('refreshes in the background when the answer is more than a day old, and only then', async () => {
    const r = quiet()
    await afterCommand('0.2.1', { now: NOW, env: {}, refresh: r.refresh })
    expect(r.refreshed).toEqual([1])
    await writeCache({ checkedAt: NOW - 1000, latest: '0.2.1' })
    await afterCommand('0.2.1', { now: NOW, env: {}, refresh: r.refresh })
    expect(r.refreshed).toEqual([1])
  })

  it('does nothing at all when the check is off', async () => {
    await writeCache({ checkedAt: NOW - 1000, latest: '0.2.2' })
    await savePreferences({ updateCheck: false })
    const r = quiet()
    expect(await afterCommand('0.2.1', { now: NOW, env: {}, refresh: r.refresh })).toEqual([])
    expect(
      await afterCommand('0.2.1', { now: NOW, env: { CI: 'true' }, refresh: r.refresh }),
    ).toEqual([])
    expect(r.refreshed).toEqual([])
  })
})
