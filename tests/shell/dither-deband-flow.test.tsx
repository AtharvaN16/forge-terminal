import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { render } from 'ink-testing-library'
import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { DEFAULT_PREFERENCES } from '../../src/config/preferences.js'
import { assetFor, CATALOG, offeredOn } from '../../src/extensions/catalog.js'
import type { ExtensionStatus } from '../../src/extensions/manager.js'
import { App } from '../../src/shell/App.js'
import type { EditTools } from '../../src/shell/edit.js'
import { makeTempDir } from '../helpers/fixtures.js'
import { pinPlatform } from '../helpers/platform.js'

// Edit's rows as a Mac has them (Boost's first), so the cursor counts hold off a Mac too.
pinPlatform('darwin')

const ESC = String.fromCharCode(27)
const DOWN = `${ESC}[B`
const RIGHT = `${ESC}[C`
const ENTER = String.fromCharCode(13)
const settle = (ms = 250) => new Promise((r) => setTimeout(r, ms))
const until = async (cond: () => boolean) => {
  for (let i = 0; i < 1200 && !cond(); i++) await new Promise((r) => setTimeout(r, 25))
}

const WINDOWS = process.platform === 'win32'
// Sharpen, Boost resolution and (on a Mac) Remove background, then Resize. Trim
// edges is dimmed for a plain picture, so the cursor steps over it.
const ROWS_BEFORE_DEBAND = (WINDOWS ? 2 : 3) + 4

const tools: EditTools = {
  async list() {
    return CATALOG.filter((entry) => offeredOn(entry)).map(
      (entry): ExtensionStatus => ({
        entry,
        installed: assetFor(entry, process.platform, WINDOWS ? process.arch : 'arm64')?.version,
        updateAvailable: false,
        supported: true,
        downloadBytes: 0,
      }),
    )
  },
  async install() {},
}

describe('Dither in Edit', () => {
  it('steps the colour count with ←→, names the file by it and writes a palette PNG', async () => {
    const dir = await makeTempDir()
    const jpg = join(dir, 'photo.jpg')
    const w = 64
    const data = Buffer.alloc(w * 16 * 3)
    for (let y = 0; y < 16; y++)
      for (let x = 0; x < w; x++)
        data.fill(Math.round((x / (w - 1)) * 255), (y * w + x) * 3, (y * w + x) * 3 + 3)
    await sharp(data, { raw: { width: w, height: 16, channels: 3 } })
      .jpeg()
      .toFile(jpg)

    const app = render(
      <App
        initialWidth={80}
        initialHeight={24}
        prefs={{ ...DEFAULT_PREFERENCES, theme: 'dark', defaultOutput: dir }}
        tools={tools}
      />,
    )
    const frame = () => app.lastFrame() ?? ''
    const press = async (key: string, ms = 80) => {
      app.stdin.write(key)
      await settle(ms)
    }

    await press('/edit', 250)
    await press(ENTER, 250)
    app.stdin.write(jpg)
    await until(() => frame().includes('photo.jpg'))
    app.stdin.write(ENTER)
    await until(() => frame().includes('Edit JPEG'))
    await settle(300)

    expect(frame()).toContain('Dither')
    for (let i = 0; i < ROWS_BEFORE_DEBAND + 1; i++) await press(DOWN)
    await until(() => frame().includes('‹ 16 colours ›'))
    expect(frame()).toContain('becomes 16 colours · as PNG')
    expect(frame()).toMatch(/←→ +colours/)

    await settle(300) // ←→ attach once the pill shows
    await press(RIGHT)
    await until(() => frame().includes('‹ 4 colours ›'))

    app.stdin.write(ENTER)
    await until(() => frame().includes('Save as'))
    expect(frame()).toContain('photo-dithered-4')
    expect(frame()).toContain('Dither 4 colours')

    await settle(400) // let Save as's key handler attach
    app.stdin.write(ENTER)
    const out = join(dir, 'photo-dithered-4.png')
    await until(() => existsSync(out) && frame().includes('↵ Home'))
    const meta = await sharp(out).metadata()
    expect(meta.format).toBe('png')
    const { data: pixels } = await sharp(out)
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true })
    const seen = new Set(
      Array.from({ length: pixels.length / 3 }, (_, i) => pixels.readUIntBE(i * 3, 3)),
    )
    expect(seen.size).toBeLessThanOrEqual(4)
    app.unmount()
  }, 60_000)
})

describe('Remove banding in Edit', () => {
  it('opens on Medium, steps the level with ←→, names the file by it and keeps a JPEG a JPEG', async () => {
    const dir = await makeTempDir()
    const jpg = join(dir, 'photo.jpg')
    const w = 64
    const data = Buffer.alloc(w * 16 * 3)
    for (let y = 0; y < 16; y++)
      for (let x = 0; x < w; x++)
        data.fill(Math.round((x / (w - 1)) * 255), (y * w + x) * 3, (y * w + x) * 3 + 3)
    await sharp(data, { raw: { width: w, height: 16, channels: 3 } })
      .jpeg()
      .toFile(jpg)

    const app = render(
      <App
        initialWidth={80}
        initialHeight={24}
        prefs={{ ...DEFAULT_PREFERENCES, theme: 'dark', defaultOutput: dir }}
        tools={tools}
      />,
    )
    const frame = () => app.lastFrame() ?? ''
    const press = async (key: string, ms = 80) => {
      app.stdin.write(key)
      await settle(ms)
    }

    await press('/edit', 250)
    await press(ENTER, 250)
    app.stdin.write(jpg)
    await until(() => frame().includes('photo.jpg'))
    app.stdin.write(ENTER)
    await until(() => frame().includes('Edit JPEG'))
    await settle(300)

    expect(frame()).toContain('Remove banding')
    for (let i = 0; i < ROWS_BEFORE_DEBAND; i++) await press(DOWN)
    await until(() => frame().includes('‹ Medium ›'))
    expect(frame()).toContain('same size · 64 × 16')
    expect(frame()).toMatch(/←→ +level/)

    await settle(300) // ←→ attach once the pill shows
    await press(RIGHT)
    await until(() => frame().includes('‹ Strong ›'))

    app.stdin.write(ENTER)
    await until(() => frame().includes('Save as'))
    expect(frame()).toContain('photo-debanded-strong')
    expect(frame()).toContain('Remove banding Strong')

    await settle(400) // let Save as's key handler attach
    app.stdin.write(ENTER)
    const out = join(dir, 'photo-debanded-strong.jpg')
    await until(() => existsSync(out) && frame().includes('↵ Home'))
    const meta = await sharp(out).metadata()
    expect(meta.format).toBe('jpeg')
    app.unmount()
  }, 60_000)
})
