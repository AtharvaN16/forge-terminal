import { render } from 'ink-testing-library'
import { describe, expect, it } from 'vitest'
import { DEFAULT_PREFERENCES } from '../../src/config/preferences.js'
import { App } from '../../src/shell/App.js'
import { makeJpeg, makeTempDir } from '../helpers/fixtures.js'
import { unpaint } from '../helpers/unpaint.js'

const ESC = String.fromCharCode(27)
const ENTER = String.fromCharCode(13)
const settle = (ms = 250) => new Promise((r) => setTimeout(r, ms))
const SGR = new RegExp(`${ESC}\\[[0-9;]*m`, 'g')
const plain = (f: string | undefined) => unpaint((f ?? '').replace(SGR, ''))
/** The header bar: the one line drawn in ╱ hatching that names a mode. */
const barLine = (frame: string) =>
  plain(frame)
    .split('\n')
    .find((l) => l.includes('╱╱') && /convert|compress|pdf/.test(l)) ?? ''
/** The key row: the last line with anything on it. */
const keyRow = (frame: string) =>
  plain(frame)
    .split('\n')
    .findLast((l) => l.trim() !== '') ?? ''

/** Polls for `ok`, up to 10 s: a busy CI runner can take seconds to probe or render. */
async function waitFor(ok: () => boolean, ms = 10_000) {
  const start = Date.now()
  while (!ok() && Date.now() - start < ms) await settle(30)
}

/** Format on screen, a target highlighted, and its keys attached. */
async function atFormat() {
  const dir = await makeTempDir()
  // A JPEG: it can be compressed as well as converted, so 1–6 have somewhere to go.
  const jpg = await makeJpeg(dir, 'test.jpg')
  const prefs = { ...DEFAULT_PREFERENCES, theme: 'dark' as const, defaultOutput: dir }
  const app = render(<App initialWidth={80} initialHeight={24} prefs={prefs} />)
  await settle()
  app.stdin.write(jpg)
  await settle()
  app.stdin.write(ENTER)
  const frame = () => app.lastFrame() ?? ''
  await waitFor(() => /Format ╱╱$/.test(barLine(frame())) && /❯ \w/.test(plain(frame())))
  // A step's key handler attaches just after its first frame.
  await settle()
  return { app, dir }
}

describe('the header bar in the flow', () => {
  it('heads Format with the mode and the question, and no FORGE or folder', async () => {
    const { app, dir } = await atFormat()
    const bar = barLine(app.lastFrame() ?? '')
    expect(bar).toMatch(/convert ╱+ Format ╱╱$/)
    expect(bar).not.toContain('FORGE')
    expect(bar).not.toContain(dir)
  })

  it('grows the trail leftward as questions are answered', async () => {
    const { app } = await atFormat()
    const format = (app.lastFrame() ?? '').match(/❯ (\w+)/)?.[1] ?? ''
    expect(format).not.toBe('')
    app.stdin.write(ENTER)
    await waitFor(() => /(Quality|Save as) ╱╱$/.test(barLine(app.lastFrame() ?? '')))
    expect(barLine(app.lastFrame() ?? '')).toMatch(
      new RegExp(`convert ╱+ ${format} ╱ (Quality|Save as) ╱╱$`),
    )
  }, 60_000)
})

describe('mode keys belong to home (2026-10-21)', () => {
  it('does not offer 1–6 on the key row of Format', async () => {
    const { app } = await atFormat()
    expect(keyRow(app.lastFrame() ?? '')).not.toMatch(/1–6/)
  })

  it('leaves the mode alone when a digit is pressed on a picker', async () => {
    const { app } = await atFormat()
    app.stdin.write('2')
    await settle(400)
    expect(barLine(app.lastFrame() ?? '')).toMatch(/convert ╱+ Format ╱╱$/)
  })

  it('does nothing for the mode already on', async () => {
    const { app } = await atFormat()
    // The highlighted row measures its size in the background; let that land
    // first, or the frame changes under the test for a reason of its own.
    const start = Date.now()
    while (plain(app.lastFrame()).includes('measuring…') && Date.now() - start < 10_000) {
      await settle(30)
    }
    const before = plain(app.lastFrame())
    app.stdin.write('1')
    await settle()
    expect(plain(app.lastFrame())).toBe(before)
  })

  it('types the digit on a screen that takes text', async () => {
    const { app } = await atFormat()
    // The first target, then any quality, lands on Save as.
    const bar = () => barLine(app.lastFrame() ?? '')
    app.stdin.write(ENTER)
    await waitFor(() => /(Quality|Save as) ╱╱$/.test(bar()))
    if (bar().includes('Quality')) {
      await settle()
      app.stdin.write(ENTER)
      await waitFor(() => /Save as ╱╱$/.test(bar()))
    }
    expect(bar()).toMatch(/Save as ╱╱$/)
    await settle()
    app.stdin.write('2')
    await settle()
    const frame = app.lastFrame() ?? ''
    expect(barLine(frame)).toMatch(/^ {2}\S* ?convert/)
    expect(barLine(frame)).toMatch(/Save as ╱╱$/)
    expect(keyRow(frame)).not.toMatch(/1–6 +mode/)
  }, 60_000)
})

describe('Done', () => {
  it('heads its screen with the bar, the trail ending in Done', async () => {
    const { app } = await atFormat()
    for (let i = 0; i < 4 && !plain(app.lastFrame()).includes('↵ Home'); i++) {
      app.stdin.write(ENTER)
      await settle(600)
    }
    const frame = app.lastFrame() ?? ''
    expect(plain(frame).split('\n')[0]).toBe(barLine(frame))
    expect(barLine(frame)).toMatch(/ ╱ test\.\w+ ╱ Done ╱╱$/)
  })
})
