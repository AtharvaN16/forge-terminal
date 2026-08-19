import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { render } from 'ink-testing-library'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_PREFERENCES, loadPreferences } from '../../src/config/preferences.js'
import { App } from '../../src/shell/App.js'
import { makeJpeg, makeTempDir } from '../helpers/fixtures.js'

const ESC = String.fromCharCode(27)
const DOWN = `${ESC}[B`
const ENTER = String.fromCharCode(13)
const settle = (ms = 150) => new Promise((r) => setTimeout(r, ms))

let cfg: string
const saved = process.env.XDG_CONFIG_HOME

beforeEach(async () => {
  cfg = await mkdtemp(join(tmpdir(), 'forge-def-'))
  process.env.XDG_CONFIG_HOME = cfg
})

afterEach(() => {
  if (saved === undefined) delete process.env.XDG_CONFIG_HOME
  else process.env.XDG_CONFIG_HOME = saved
})

/** Drives the shell as far as the destination step, inside its own temp dir. */
async function toDestination() {
  const dir = await makeTempDir()
  const jpg = await makeJpeg(dir, 'photo.jpg')
  const prefs = { ...DEFAULT_PREFERENCES, theme: 'dark' as const, defaultOutput: dir }
  const app = render(<App initialWidth={100} prefs={prefs} />)
  app.stdin.write(jpg)
  await settle()
  app.stdin.write(ENTER) // submit path
  await settle(400)
  // jpeg is excluded (same-format is a no-op), so targets run png, webp,
  // avif. One DOWN reaches webp, which is lossy and therefore does raise the
  // quality step — landing on the destination step rather than past it.
  app.stdin.write(DOWN)
  await settle()
  app.stdin.write(ENTER) // target = webp
  await settle()
  app.stdin.write(ENTER) // accept the quality slider
  await settle(200)
  return { ...app, dir }
}

describe('making a destination the default', () => {
  it('marks the current default in the list', async () => {
    const { lastFrame } = await toDestination()
    expect(lastFrame() ?? '').toContain('default')
  })

  it('offers the key in the hints', async () => {
    const { lastFrame } = await toDestination()
    expect(lastFrame() ?? '').toContain('make default')
  })

  it('d writes the highlighted folder to config', async () => {
    const { stdin, dir } = await toDestination()
    stdin.write(DOWN)
    await settle()
    stdin.write('d')
    await settle(400)
    const stored = (await loadPreferences()).prefs.defaultOutput
    expect(stored).not.toBe(dir)
    expect(stored.length).toBeGreaterThan(0)
  })

  it('does not advance the flow — the user is still choosing', async () => {
    const { stdin, lastFrame } = await toDestination()
    stdin.write(DOWN)
    await settle()
    stdin.write('d')
    await settle(400)
    expect(lastFrame() ?? '').toContain('Save to')
  })

  it('commits a note saying what changed', async () => {
    const { stdin, lastFrame } = await toDestination()
    stdin.write(DOWN)
    await settle()
    stdin.write('d')
    await settle(400)
    expect(lastFrame() ?? '').toMatch(/default output is now/i)
  })

  it('moves the tag onto the new default', async () => {
    const { stdin, lastFrame } = await toDestination()
    stdin.write(DOWN)
    await settle()
    stdin.write('d')
    await settle(400)
    // Exactly one *preset row* carries the tag, wherever it has moved to.
    // Matching on the trailing tag rather than the word: the keyboard hint
    // ("d make default") and the confirmation note both say "default" too.
    // The tag is set off by three spaces; the keyboard hint reads
    // "d make default" with one. Matching the spacing is what separates the
    // preset row from every other line that happens to say the word.
    const tagged = (lastFrame() ?? '').split('\n').filter((l) => / {3}default$/.test(l.trimEnd()))
    expect(tagged.length).toBe(1)
  })

  it('d on the row that is already default is a no-op, not an error', async () => {
    const { stdin, lastFrame } = await toDestination()
    stdin.write('d')
    await settle(300)
    stdin.write('d')
    await settle(300)
    expect(lastFrame() ?? '').not.toContain('✕')
  })

  it('the banner follows the change without waiting for a relaunch', async () => {
    const { stdin, lastFrame } = await toDestination()
    stdin.write(DOWN)
    await settle()
    stdin.write('d')
    await settle(400)
    const stored = (await loadPreferences()).prefs.defaultOutput
    expect(lastFrame() ?? '').toContain(stored.split('/').pop() ?? stored)
  })
})
