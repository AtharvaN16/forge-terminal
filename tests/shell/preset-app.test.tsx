import { join } from 'node:path'
import { render } from 'ink-testing-library'
import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { DEFAULT_PREFERENCES, loadPreferences } from '../../src/config/preferences.js'
import { App } from '../../src/shell/App.js'
import { makeGradientPng, makeTempDir } from '../helpers/fixtures.js'
import { unpaint } from '../helpers/unpaint.js'

/**
 * Presets in the flow (mockups/presets-2026-10.html, round 9): from Done,
 * p saves what was done as a preset; → opens Continue editing over Done, and
 * ↵ there leaves Done showing the new file.
 */
const ESC = String.fromCharCode(27)
const ENTER = '\r'
const DOWN = `${ESC}[B`
const RIGHT = `${ESC}[C`
const settle = (ms = 250) => new Promise((r) => setTimeout(r, ms))
const SGR = new RegExp(`${ESC}\\[[0-9;]*m`, 'g')
const plain = (f: string | undefined) => unpaint((f ?? '').replace(SGR, ''))

async function until(app: { lastFrame: () => string | undefined }, text: string, gone = false) {
  const ok = () => plain(app.lastFrame()).includes(text) !== gone
  const start = Date.now()
  while (!ok() && Date.now() - start < 15_000) await settle(30)
  if (!ok())
    throw new Error(`never ${gone ? 'lost' : 'showed'} "${text}":\n${plain(app.lastFrame())}`)
  await settle(100)
}

async function atDone() {
  const dir = await makeTempDir()
  const file = await makeGradientPng(dir, 'test.png', 64)
  const prefs = { ...DEFAULT_PREFERENCES, theme: 'dark' as const, defaultOutput: dir }
  const app = render(<App initialWidth={80} initialHeight={24} prefs={prefs} />)
  await settle()
  app.stdin.write(file)
  await settle()
  app.stdin.write(ENTER)
  await until(app, 'Convert to')
  app.stdin.write(ENTER) // JPEG
  await until(app, 'Quality')
  app.stdin.write(ENTER)
  await until(app, 'Save as')
  app.stdin.write(ENTER)
  await until(app, 'convert another')
  return { app, dir }
}

describe('presets, from Done', () => {
  it('offers p save as preset and → continue editing on Done', async () => {
    const { app } = await atDone()
    const all = plain(app.lastFrame())
    expect(all).toMatch(/^ {2}p save as preset +→ {2}continue editing ?$/m)
    expect(all).not.toMatch(/PNG → JPEG +p/)
  }, 30_000)

  it('saves what was done as a preset with p, and says so on Done', async () => {
    const { app, dir } = await atDone()
    app.stdin.write('p')
    await until(app, 'Save as preset')
    for (const ch of 'webblog') {
      app.stdin.write(ch)
      await settle(30)
    }
    app.stdin.write(ENTER)
    await until(app, '✓ saved as webblog')
    const { prefs } = await loadPreferences()
    const saved = prefs.presets?.find((p) => p.name === 'webblog')
    expect(saved).toEqual({ name: 'webblog', steps: { to: 'jpeg', quality: 80 }, saveTo: dir })
  }, 30_000)

  it('opens Continue editing with →, and ↵ leaves Done showing the new file', async () => {
    const { app, dir } = await atDone()
    app.stdin.write(RIGHT)
    await until(app, 'Continue editing')
    app.stdin.write(DOWN) // Resize, from Compress
    await settle(100)
    app.stdin.write(RIGHT)
    await until(app, '─ Resize ─')
    for (const ch of '32') {
      app.stdin.write(ch)
      await settle(30)
    }
    app.stdin.write(ENTER) // confirm the width
    await until(app, '32 wide')
    await until(app, 'now ') // the rerun
    await settle(800)
    app.stdin.write(ENTER) // done
    await until(app, 'Continue editing', true)
    await until(app, '32 wide')
    expect((await sharp(join(dir, 'test.jpg')).metadata()).width).toBe(32)
  }, 30_000)
})
