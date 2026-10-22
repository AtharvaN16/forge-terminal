import { render } from 'ink-testing-library'
import { describe, expect, it } from 'vitest'
import { DEFAULT_PREFERENCES } from '../../src/config/preferences.js'
import { App } from '../../src/shell/App.js'
import { makeGradientPng, makeTempDir } from '../helpers/fixtures.js'
import { unpaint } from '../helpers/unpaint.js'

const ESC = String.fromCharCode(27)
const ENTER = '\r'
const LEFT = `${ESC}[D`
const RIGHT = `${ESC}[C`
const settle = (ms = 250) => new Promise((r) => setTimeout(r, ms))
const SGR = new RegExp(`${ESC}\\[[0-9;]*m`, 'g')
const plain = (f: string | undefined) => unpaint((f ?? '').replace(SGR, ''))
const lines = (f: string | undefined) => plain(f).split('\n')

/**
 * Waits until the frame shows `text` (or, with `gone`, stops showing it),
 * then a beat more for the screen's keys to be listened for: on a busy
 * machine a fixed pause can send a key to the wrong screen.
 */
async function until(app: { lastFrame: () => string | undefined }, text: string, gone = false) {
  const ok = () => plain(app.lastFrame()).includes(text) !== gone
  const start = Date.now()
  while (!ok() && Date.now() - start < 15_000) await settle(30)
  if (!ok())
    throw new Error(`never ${gone ? 'lost' : 'showed'} "${text}":\n${plain(app.lastFrame())}`)
  await settle(100)
}

/** A PNG converted to JPEG at 80 × 24: drop, JPEG, the quality, Save as. */
async function atDone() {
  const dir = await makeTempDir()
  const file = await makeGradientPng(dir, 'test.png', 64)
  const prefs = { ...DEFAULT_PREFERENCES, theme: 'dark' as const, defaultOutput: dir }
  const app = render(<App initialWidth={80} initialHeight={24} prefs={prefs} />)
  await settle()
  app.stdin.write(file)
  await settle()
  app.stdin.write(ENTER) // the dropped path
  await until(app, 'Convert to')
  app.stdin.write(ENTER) // JPEG, the first target for a PNG
  await until(app, 'Quality')
  app.stdin.write(ENTER) // the quality as it opens
  await until(app, 'Save as')
  app.stdin.write(ENTER) // save
  await until(app, '↵ Home')
  return { app, dir }
}

describe('Done, in the flow', () => {
  it('fills the screen: the bar ending in Done on top, the keys on the bottom row', async () => {
    const { app } = await atDone()
    const out = lines(app.lastFrame())
    // The window's 24 rows, less the canvas's blank row on top.
    expect(out).toHaveLength(23)
    expect(out[0]).toMatch(/JPEG ╱ 80 ╱ .+ ╱ test\.jpg ╱ Done ╱╱ *$/)
    expect(out[22]).toMatch(/^ {3}←→ {2}choose {3}↵ {2}confirm +ctrl-c quit$/)
    const all = plain(app.lastFrame())
    // Round 25: the strip with the formats and the change, one bar with the
    // new file's name, the sizes stacked; the way on above the rule.
    expect(all).toMatch(/^ {3}PNG → JPEG +.*(\d+(\.\d)?% (smaller|larger)|same size) ?$/m)
    expect(all).toContain('✓ test.jpg')
    expect(all).toMatch(/^ {2}(now|was) +(now|was) ?$/m)
    expect(all).toMatch(/^ {3}o Open +f \S+ +p Save as preset +e Continue editing +↵ Home *$/m)
    // The rule sits on the app's margins (2026-10-20): two columns in, two short.
    expect(out[21]).toBe(`  ${'─'.repeat(72)}`)
    // Not today's receipt.
    expect(all).not.toContain('✓ DONE')
    expect(all).not.toContain('saved to')
  }, 20_000)

  it('keeps the run in the scrollback once it is left, above the separator', async () => {
    const { app } = await atDone()
    const before = app.frames.length
    app.stdin.write(ENTER)
    await until(app, '↵ Home', true)
    const after = plain(app.frames.slice(before).join('\n'))
    const bar = after.indexOf('Done ╱╱')
    const record = after.indexOf('✓ test.jpg')
    const separator = after.indexOf('╍ ╍')
    expect(bar).toBeGreaterThan(-1)
    expect(record).toBeGreaterThan(bar)
    expect(separator).toBeGreaterThan(record)
    // The record is the body alone: no keys.
    expect(after.slice(bar, separator)).not.toContain('↵ Home')
    // And the screen itself is gone: home is back.
    expect(plain(app.lastFrame())).toContain('Drop a file here')
  }, 20_000)

  it('goes home on esc too', async () => {
    const { app } = await atDone()
    app.stdin.write(ESC)
    await until(app, 'Drop a file here')
  }, 20_000)

  it('moves the selection with ←→ and runs the selected action on ↵', async () => {
    const { app } = await atDone()
    app.stdin.write(LEFT) // from Home to Continue editing
    await settle()
    app.stdin.write(RIGHT) // back to Home
    await settle()
    app.stdin.write(LEFT)
    await settle()
    app.stdin.write(ENTER)
    await until(app, '─ Continue editing ─')
  }, 20_000)

  it('opens Continue editing on e', async () => {
    const { app } = await atDone()
    app.stdin.write('e')
    await until(app, '─ Continue editing ─')
  }, 20_000)
})
