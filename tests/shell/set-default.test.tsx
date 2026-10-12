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
/** Tab, not d: letters type into Save as's search for a folder. */
const TAB = '\t'
const settle = (ms = 150) => new Promise((r) => setTimeout(r, ms))
const SGR = new RegExp(`${ESC}\\[[0-9;]*m`, 'g')
/**
 * The rows that carry the default's tag: a folder in the list ends in it.
 * Not the key row ("tab make default") or the note ("default output is
 * now…"), which say the word too.
 */
const tagged = (frame: string | undefined) =>
  (frame ?? '')
    .replace(SGR, '')
    .split('\n')
    .filter((l) => / default$/.test(l.trimEnd()) && !l.includes('make default'))

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

/** Polls until the header bar ends in `step`, up to 10 s: a busy CI runner can take seconds. */
async function waitForStep(frame: () => string | undefined, step: string) {
  const at = new RegExp(`${step} ╱╱\\s*$`, 'm')
  const start = Date.now()
  while (!at.test((frame() ?? '').replace(SGR, '')) && Date.now() - start < 10_000) await settle(30)
  // A step's key handler attaches just after its first frame.
  await settle()
}

/** Drives the shell as far as Save as's folders, inside its own temp dir. */
async function toDestination() {
  const dir = await makeTempDir()
  const jpg = await makeJpeg(dir, 'photo.jpg')
  const prefs = { ...DEFAULT_PREFERENCES, theme: 'dark' as const, defaultOutput: dir }
  const app = render(<App initialWidth={100} prefs={prefs} />)
  app.stdin.write(jpg)
  await settle()
  app.stdin.write(ENTER) // submit path
  await waitForStep(app.lastFrame, 'Format')
  // jpeg is excluded (same-format is a no-op), so targets run png, webp,
  // avif. One DOWN reaches webp, which is lossy and therefore does raise the
  // quality step — landing on the destination step rather than past it.
  app.stdin.write(DOWN)
  await settle()
  app.stdin.write(ENTER) // target = webp
  await waitForStep(app.lastFrame, 'Quality')
  app.stdin.write(ENTER) // accept the quality slider -> Save as: the name, the folders under it
  await waitForStep(app.lastFrame, 'Save as')
  return { ...app, dir }
}

describe('making a destination the default', () => {
  it('marks the current default in the list', async () => {
    const { lastFrame } = await toDestination()
    expect(tagged(lastFrame())).toHaveLength(1)
  })

  it('offers the key in the hints', async () => {
    const { lastFrame } = await toDestination()
    expect(lastFrame() ?? '').toContain('make default')
  })

  it('tab writes the highlighted folder to config', async () => {
    const { stdin, dir } = await toDestination()
    stdin.write(DOWN)
    await settle()
    stdin.write(TAB)
    await settle(400)
    const stored = (await loadPreferences()).prefs.defaultOutput
    expect(stored).not.toBe(dir)
    expect(stored.length).toBeGreaterThan(0)
  })

  it('does not advance the flow — the user is still choosing', async () => {
    const { stdin, lastFrame } = await toDestination()
    stdin.write(DOWN)
    await settle()
    stdin.write(TAB)
    await settle(400)
    expect(lastFrame() ?? '').toContain('Save as')
    expect(lastFrame() ?? '').toContain('Same folder') // the list still open
  })

  it('commits a note saying what changed', async () => {
    const { stdin, lastFrame } = await toDestination()
    stdin.write(DOWN)
    await settle()
    stdin.write(TAB)
    await settle(400)
    expect(lastFrame() ?? '').toMatch(/default output is now/i)
  })

  it('moves the tag onto the new default', async () => {
    const { stdin, lastFrame } = await toDestination()
    stdin.write(DOWN)
    await settle()
    stdin.write(TAB)
    await settle(400)
    // Exactly one *place* carries the tag, wherever it has moved to: the
    // highlighted one, which tab just made the default.
    const rows = tagged(lastFrame())
    expect(rows).toHaveLength(1)
    expect(rows[0]).toContain('▌')
  })

  it('tab on the row that is already default is a no-op, not an error', async () => {
    const { stdin, lastFrame } = await toDestination()
    stdin.write(TAB)
    await settle(300)
    stdin.write(TAB)
    await settle(300)
    expect(lastFrame() ?? '').not.toMatch(/^\s+failed\s*$/m)
  })

  it('the banner follows the change without waiting for a relaunch', async () => {
    const { stdin, lastFrame } = await toDestination()
    stdin.write(DOWN)
    await settle()
    stdin.write(TAB)
    await settle(400)
    const stored = (await loadPreferences()).prefs.defaultOutput
    expect(lastFrame() ?? '').toContain(stored.split(/[\\/]/).pop() ?? stored)
  })
})
