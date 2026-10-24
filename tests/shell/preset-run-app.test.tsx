import { join } from 'node:path'
import { render } from 'ink-testing-library'
import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { DEFAULT_PREFERENCES } from '../../src/config/preferences.js'
import { App } from '../../src/shell/App.js'
import { makeGradientPng, makeTempDir } from '../helpers/fixtures.js'
import { unpaint } from '../helpers/unpaint.js'

/**
 * A saved preset, next time (decided, mockups/presets-ux-2026-10-round10.html):
 * stage a photo and the field offers p presets (N5), or Convert to has a
 * Presets tab (T11); either runs every step (R6) and lands on Done with the
 * chain and the preset's name on its button.
 */
const ESC = String.fromCharCode(27)
const ENTER = '\r'
const SGR = new RegExp(`${ESC}\\[[0-9;]*m`, 'g')
const settle = (ms = 250) => new Promise((r) => setTimeout(r, ms))
const plain = (f: string | undefined) => unpaint((f ?? '').replace(SGR, ''))

async function until(app: { lastFrame: () => string | undefined }, text: string) {
  const start = Date.now()
  while (!plain(app.lastFrame()).includes(text) && Date.now() - start < 15_000) await settle(30)
  if (!plain(app.lastFrame()).includes(text))
    throw new Error(`never showed "${text}":\n${plain(app.lastFrame())}`)
  await settle(100)
}

async function staged() {
  const dir = await makeTempDir()
  const file = await makeGradientPng(dir, 'test.png', 64)
  const prefs = {
    ...DEFAULT_PREFERENCES,
    theme: 'dark' as const,
    defaultOutput: dir,
    presets: [
      {
        name: 'webblog',
        steps: { to: 'jpeg' as const, quality: 80, resize: { width: 32 } },
        saveTo: 'same',
      },
    ],
  }
  const app = render(<App initialWidth={80} initialHeight={24} prefs={prefs} />)
  await settle()
  app.stdin.write(file)
  await until(app, 'test.png')
  return { app, dir }
}

describe('a saved preset, next time', () => {
  it('offers p presets in the field once a photo is staged; p lists them, ↵ runs it and lands on Done', async () => {
    const { app, dir } = await staged()
    await until(app, 'p presets')
    app.stdin.write('p')
    await until(app, '─ Presets ─')
    expect(plain(app.lastFrame())).toMatch(/› webblog +JPEG 80 ─▸ 32 wide/)
    app.stdin.write(ENTER)
    await until(app, '↵ Home')
    const all = plain(app.lastFrame())
    expect(all).toMatch(/PNG ─▸ JPEG 80 ─▸ 32 wide ─▸ {2}\+/)
    expect(all).toContain('p ✓ webblog')
    expect((await sharp(join(dir, 'test.jpg')).metadata()).width).toBe(32)
  }, 30_000)

  it('gives Convert to a Presets tab; tab shows it, ↵ runs the preset', async () => {
    const { app, dir } = await staged()
    app.stdin.write(ENTER)
    await until(app, 'Presets (1)')
    expect(plain(app.lastFrame())).toMatch(/Formats +Presets \(1\) +tab/)
    app.stdin.write('\t')
    await until(app, 'JPEG 80 ─▸ 32 wide')
    app.stdin.write(ENTER)
    await until(app, '↵ Home')
    expect((await sharp(join(dir, 'test.jpg')).metadata()).width).toBe(32)
  }, 30_000)
})
