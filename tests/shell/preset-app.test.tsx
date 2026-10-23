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
 * p saves what was done as a preset; e opens Continue editing over Done, and
 * ↵ there leaves Done showing the new file.
 */
const ESC = String.fromCharCode(27)
const ENTER = '\r'
const DOWN = `${ESC}[B`
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
  await until(app, '↵ Home')
  return { app, dir }
}

describe('presets, from Done', () => {
  it('offers Save as preset and Continue editing as buttons on Done', async () => {
    const { app } = await atDone()
    const all = plain(app.lastFrame())
    expect(all).toMatch(/p Save as preset +e Continue editing +↵ Home *$/m)
    expect(all).not.toMatch(/PNG → JPEG +p/)
  }, 30_000)

  it('saves what was done as a preset with p, and says so on Done', async () => {
    const { app, dir } = await atDone()
    app.stdin.write('p')
    await until(app, '─ Save as preset ─')
    // The chain it keeps, first, in its own block.
    expect(plain(app.lastFrame())).toMatch(/│ {5}PNG ─▸ JPEG 80 +│/)
    for (const ch of 'webblog') {
      app.stdin.write(ch)
      await settle(30)
    }
    app.stdin.write(ENTER)
    await until(app, 'p ✓ webblog')
    const { prefs } = await loadPreferences()
    const saved = prefs.presets?.find((p) => p.name === 'webblog')
    expect(saved).toEqual({ name: 'webblog', steps: { to: 'jpeg', quality: 80 }, saveTo: dir })
  }, 30_000)

  it('does one more thing with e — Resize, on its own screen — and comes back to Done, the chain one longer', async () => {
    const { app, dir } = await atDone()
    app.stdin.write('e')
    await until(app, 'Convert to another format')
    app.stdin.write(DOWN) // Resize, from Compress
    await settle(100)
    app.stdin.write(ENTER)
    await until(app, 'Resize to')
    app.stdin.write('#') // the exact size
    await settle(200)
    for (const ch of '32') {
      app.stdin.write(ch)
      await settle(30)
    }
    app.stdin.write(ENTER)
    await until(app, 'PNG ─▸ JPEG 80 ─▸ 32 wide ─▸')
    expect(plain(app.lastFrame())).toContain('↵ Home')
    expect((await sharp(join(dir, 'test.jpg')).metadata()).width).toBe(32)
    // And Continue editing now offers to undo it.
    app.stdin.write('e')
    await until(app, 'Undo 32 wide')
  }, 30_000)

  it('saves a /compress result as a preset that still compresses', async () => {
    const dir = await makeTempDir()
    const file = await makeGradientPng(dir, 'test.png', 64)
    const prefs = { ...DEFAULT_PREFERENCES, theme: 'dark' as const, defaultOutput: dir }
    const app = render(<App initialWidth={80} initialHeight={24} prefs={prefs} />)
    await settle()
    app.stdin.write('/compress')
    await settle()
    app.stdin.write(ENTER)
    await settle()
    app.stdin.write(file)
    await settle()
    app.stdin.write(ENTER)
    await until(app, 'By quality')
    app.stdin.write(ENTER) // By quality
    await settle(500)
    app.stdin.write(ENTER) // the slider's quality
    await until(app, 'Save as')
    app.stdin.write(ENTER)
    await until(app, '↵ Home')
    app.stdin.write('p')
    await until(app, '─ Save as preset ─')
    for (const ch of 'smaller') {
      app.stdin.write(ch)
      await settle(30)
    }
    app.stdin.write(ENTER)
    await until(app, 'p ✓ smaller')
    const saved = (await loadPreferences()).prefs.presets?.find((p) => p.name === 'smaller')
    expect(saved?.steps).toMatchObject({ to: 'png', compress: { dither: false } })
  }, 30_000)
})
