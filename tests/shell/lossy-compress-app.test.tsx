import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { cleanup, render } from 'ink-testing-library'
import sharp from 'sharp'
import { afterEach, describe, expect, it } from 'vitest'
import { DEFAULT_PREFERENCES } from '../../src/config/preferences.js'
import { App } from '../../src/shell/App.js'
import { makeJpeg, makeTempDir } from '../helpers/fixtures.js'
import { unpaint } from '../helpers/unpaint.js'

const ESC = String.fromCharCode(27)
const ENTER = '\r'
const LEFT = `${ESC}[D`
const RIGHT = `${ESC}[C`
const SGR = new RegExp(`${ESC}\\[[0-9;]*m`, 'g')
const settle = (ms = 250) => new Promise((r) => setTimeout(r, ms))
const plain = (f: string | undefined) => unpaint((f ?? '').replace(SGR, ''))
const OFF = 'Use dithering for smoother colours — the file gets bigger.'

afterEach(() => cleanup())

async function waitFor(lastFrame: () => string | undefined, ok: (f: string) => boolean) {
  const start = Date.now()
  while (!ok(plain(lastFrame())) && Date.now() - start < 10_000) await settle(30)
  return plain(lastFrame())
}

/** Something like a photo: far more than 256 colours, so a palette has work to do. */
async function makeSoftPng(dir: string, name: string): Promise<string> {
  const path = join(dir, name)
  const noise = { type: 'gaussian' as const, mean: 128, sigma: 80 }
  await sharp({ create: { width: 160, height: 120, channels: 3, background: '#808080', noise } })
    .blur(4)
    .png()
    .toFile(path)
  return path
}

/** `/compress`, the file, By quality: the slider. */
async function atQuality(file: string, dir: string) {
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
  await settle(500)
  app.stdin.write(ENTER) // By quality
  await settle(300)
  return app
}

describe('/compress on a PNG', () => {
  it('opens on 100, the point at or above the usual 80, and stops at 65 and 30', async () => {
    const dir = await makeTempDir()
    const app = await atQuality(await makeSoftPng(dir, 'soft.png'), dir)
    expect(plain(app.lastFrame())).toMatch(/^ +•.* 100\s*$/m)
    app.stdin.write(LEFT)
    await settle()
    expect(plain(app.lastFrame())).toMatch(/^ +•.* 65 .*•/m)
    app.stdin.write(LEFT)
    await settle()
    expect(plain(app.lastFrame())).toMatch(/^ +30 .*•.*•/m)
  }, 30_000)

  it('offers dithering where it changes the file, and d turns it on', async () => {
    const dir = await makeTempDir()
    const app = await atQuality(await makeSoftPng(dir, 'soft.png'), dir)
    // At 100 this picture comes out the same either way: nothing is said.
    await waitFor(app.lastFrame, (f) => /smaller/.test(f))
    await settle(600)
    expect(plain(app.lastFrame())).not.toContain(OFF)

    app.stdin.write(LEFT)
    const offered = await waitFor(app.lastFrame, (f) => f.includes(OFF))
    expect(offered).toContain(OFF)

    app.stdin.write('d')
    const on = await waitFor(app.lastFrame, (f) => f.includes('Dithering on'))
    expect(on).toContain(' d  Dithering on')
  }, 30_000)

  it('writes a palette PNG, smaller than the original', async () => {
    const dir = await makeTempDir()
    const file = await makeSoftPng(dir, 'soft.png')
    const app = await atQuality(file, dir)
    app.stdin.write(LEFT)
    await waitFor(app.lastFrame, (f) => /smaller/.test(f))
    app.stdin.write(ENTER) // 65
    await settle(300)
    app.stdin.write(ENTER) // Save as, the proposed name
    await waitFor(app.lastFrame, (f) => f.includes('soft-small.png'))
    await settle(1200)

    const written = (await readdir(dir)).find((f) => f.includes('-small'))
    expect(written).toBe('soft-small.png')
    const meta = await sharp(join(dir, written ?? '')).metadata()
    expect(meta.format).toBe('png')
    expect(meta.isPalette).toBe(true)
  }, 30_000)
})

describe('cannot compress more (E3)', () => {
  it('says so on the size line and ↵ stays on the slider', async () => {
    const dir = await makeTempDir()
    // A 40×20 flat JPEG asked for 100 only grows.
    const app = await atQuality(await makeJpeg(dir, 'tiny.jpg'), dir)
    for (let i = 0; i < 4; i++) {
      app.stdin.write(RIGHT)
      await settle(60)
    }
    const frame = await waitFor(app.lastFrame, (f) => f.includes('cannot compress more'))
    expect(frame).toMatch(/^ +100\s*$/m)
    expect(frame).toContain('cannot compress more')

    app.stdin.write(ENTER)
    await settle(400)
    expect(plain(app.lastFrame())).toContain('cannot compress more')
    expect(plain(app.lastFrame())).toMatch(/^ Quality/m)
    expect((await readdir(dir)).filter((f) => f.includes('-small'))).toEqual([])
  }, 30_000)
})
