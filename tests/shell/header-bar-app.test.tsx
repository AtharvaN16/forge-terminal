import { render } from 'ink-testing-library'
import { describe, expect, it } from 'vitest'
import { DEFAULT_PREFERENCES } from '../../src/config/preferences.js'
import { App } from '../../src/shell/App.js'
import { makeJpeg, makeTempDir } from '../helpers/fixtures.js'

const ESC = String.fromCharCode(27)
const ENTER = String.fromCharCode(13)
const settle = (ms = 250) => new Promise((r) => setTimeout(r, ms))
const SGR = new RegExp(`${ESC}\\[[0-9;]*m`, 'g')
const plain = (f: string | undefined) => (f ?? '').replace(SGR, '')
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

async function atFormat() {
  const dir = await makeTempDir()
  // A JPEG: it can be compressed as well as converted, so 1–4 have somewhere to go.
  const jpg = await makeJpeg(dir, 'test.jpg')
  const prefs = { ...DEFAULT_PREFERENCES, theme: 'dark' as const, defaultOutput: dir }
  const app = render(<App initialWidth={80} initialHeight={24} prefs={prefs} />)
  await settle()
  app.stdin.write(jpg)
  await settle()
  app.stdin.write(ENTER)
  await settle(400)
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
    const format = (app.lastFrame() ?? '').match(/▌ (\w+)/)?.[1] ?? ''
    expect(format).not.toBe('')
    app.stdin.write(ENTER)
    await settle(400)
    expect(barLine(app.lastFrame() ?? '')).toMatch(
      new RegExp(`convert ╱+ ${format} ╱ (Quality|Save as) ╱╱$`),
    )
  })
})

describe('1–4 switch mode on a screen with no text field', () => {
  it('says so on the key row of Format', async () => {
    const { app } = await atFormat()
    expect(keyRow(app.lastFrame() ?? '')).toMatch(/1–4 +mode/)
  })

  it('moves the file to compress with 2, and back to convert with 1', async () => {
    const { app } = await atFormat()
    app.stdin.write('2')
    await settle(400)
    let frame = app.lastFrame() ?? ''
    expect(barLine(frame)).toMatch(/compress ╱+ Method ╱╱$/)
    expect(plain(frame)).toContain('By quality')
    expect(keyRow(frame)).toMatch(/1–4 +mode/)

    app.stdin.write('1')
    await settle(400)
    frame = app.lastFrame() ?? ''
    expect(barLine(frame)).toMatch(/convert ╱+ Format ╱╱$/)
  })

  it('does nothing for the mode already on', async () => {
    const { app } = await atFormat()
    const before = plain(app.lastFrame())
    app.stdin.write('1')
    await settle()
    expect(plain(app.lastFrame())).toBe(before)
  })

  it('types the digit on a screen that takes text', async () => {
    const { app } = await atFormat()
    // The first target, then any quality, lands on Save as.
    app.stdin.write(ENTER)
    await settle(400)
    if (barLine(app.lastFrame() ?? '').includes('Quality')) {
      app.stdin.write(ENTER)
      await settle(400)
    }
    expect(barLine(app.lastFrame() ?? '')).toMatch(/Save as ╱╱$/)
    app.stdin.write('2')
    await settle()
    const frame = app.lastFrame() ?? ''
    expect(barLine(frame)).toMatch(/^ {2}\S* ?convert/)
    expect(barLine(frame)).toMatch(/Save as ╱╱$/)
    expect(keyRow(frame)).not.toMatch(/1–4 +mode/)
  })
})

describe('Done', () => {
  it('records the bar, ending in Done, above the result card', async () => {
    const { app } = await atFormat()
    for (let i = 0; i < 4 && !plain(app.lastFrame()).includes('saved to'); i++) {
      app.stdin.write(ENTER)
      await settle(600)
    }
    const all = plain(app.frames.join('\n'))
    const done = all.lastIndexOf('Done ╱╱')
    expect(done).toBeGreaterThan(-1)
    expect(all.indexOf('saved to', done)).toBeGreaterThan(done)
    expect(all.slice(0, done).split('\n').at(-1)).toMatch(/test\.\w+ ╱ $/)
  })
})
