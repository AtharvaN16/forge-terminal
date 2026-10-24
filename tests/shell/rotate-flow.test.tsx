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
const ROWS_BEFORE_ROTATE = (WINDOWS ? 2 : 3) + 1

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

describe('Rotate in Edit', () => {
  it('steps the turn with ←→, names the file by it and writes the turned picture', async () => {
    const dir = await makeTempDir()
    const png = join(dir, 'photo.png')
    await sharp({ create: { width: 400, height: 300, channels: 3, background: '#3080c0' } })
      .png()
      .toFile(png)

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
    app.stdin.write(png)
    await until(() => frame().includes('photo.png'))
    app.stdin.write(ENTER)
    await until(() => frame().includes('Edit PNG'))
    await settle(300)

    expect(frame()).toContain('Rotate')
    for (let i = 0; i < ROWS_BEFORE_ROTATE; i++) await press(DOWN)
    await until(() => frame().includes('‹ 90° right ›'))
    expect(frame()).toContain('becomes 300 × 400')
    expect(frame()).toMatch(/←→ +turn/)

    await settle(300) // ←→ attach once the pill shows
    await press(RIGHT)
    await until(() => frame().includes('same size · 400 × 300'))
    await press(RIGHT)
    await until(() => frame().includes('‹ 90° left ›'))

    app.stdin.write(ENTER)
    await until(() => frame().includes('Save as'))
    expect(frame()).toContain('photo-rotated-left')
    expect(frame()).toContain('Rotate 90° left')

    await settle(400) // let Save as's key handler attach
    app.stdin.write(ENTER)
    const out = join(dir, 'photo-rotated-left.png')
    await until(() => existsSync(out) && frame().includes('↵ Home'))
    const meta = await sharp(out).metadata()
    expect([meta.width, meta.height]).toEqual([300, 400])
    app.unmount()
  }, 60_000)
})
