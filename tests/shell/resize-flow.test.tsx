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

const ESC = String.fromCharCode(27)
const DOWN = `${ESC}[B`
const LEFT = `${ESC}[D`
const ENTER = String.fromCharCode(13)
const settle = (ms = 250) => new Promise((r) => setTimeout(r, ms))
const until = async (cond: () => boolean) => {
  for (let i = 0; i < 1200 && !cond(); i++) await new Promise((r) => setTimeout(r, 25))
}

/**
 * Not pinned: Trim and Resize are on both OSes, and the result's name is
 * split the way this OS splits a path. Only the AI rows above them differ:
 * the blank row follows Remove background on a Mac, Boost on Windows.
 */
const WINDOWS = process.platform === 'win32'
const LAST_AI_ROW = WINDOWS ? 'Boost resolution' : 'Remove background'
const AI_ROWS = WINDOWS ? 2 : 3

/** Every extension this OS offers, installed: Trim and Resize must not depend on any. */
const tools: EditTools = {
  async list() {
    return CATALOG.filter((entry) => offeredOn(entry)).map(
      (entry): ExtensionStatus => ({
        entry,
        // The Mac's boost is Apple Silicon only.
        installed: assetFor(entry, process.platform, WINDOWS ? process.arch : 'arm64')?.version,
        updateAvailable: false,
        supported: true,
        downloadBytes: 0,
      }),
    )
  },
  async install() {},
}

describe('Trim edges and Resize in Edit', () => {
  it('measures the trim, then resizes by the slider and the exact pair through to Done', async () => {
    // 400 × 300, transparent but for a 200 × 100 block: a trim leaves the block.
    const dir = await makeTempDir()
    const png = join(dir, 'photo.png')
    const block = await sharp({
      create: { width: 200, height: 100, channels: 4, background: '#3080c0ff' },
    })
      .png()
      .toBuffer()
    await sharp({
      create: { width: 400, height: 300, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
    })
      .composite([{ input: block, left: 100, top: 100 }])
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

    // E3: one blank row between the AI tools and the plain ones — blank on
    // the list's side of the line (S1's pane runs on beside it).
    const lines = frame().split('\n')
    const at = lines.findIndex((l) => l.includes(LAST_AI_ROW))
    expect(lines[at + 1]?.split('│')[0]?.trim()).toBe('')
    expect(lines[at + 2]).toContain('Trim edges')
    expect(lines[at + 3]).toContain('Resize')

    // Sharpen, Boost resolution (one row), Remove background on a Mac, then Trim.
    for (let i = 0; i < AI_ROWS; i++) await press(DOWN)
    await until(() => frame().includes('empty edges off · 200 × 100'))
    expect(frame()).toContain('empty edges off · 200 × 100')

    await press(DOWN)
    await until(() => frame().includes('you choose the size next'))
    expect(frame()).toContain('Any size, no new detail.')
    await press(ENTER)
    await until(() => frame().includes('Resize to'))
    expect(frame()).toContain('same size · 400 × 300')
    expect(frame()).toContain('type an exact size')

    for (let i = 0; i < 10; i++) await press(LEFT, 30)
    await until(() => frame().includes('becomes 200 × 150'))
    expect(frame()).toContain(' 50% ')

    await press('#')
    await until(() => frame().includes('Exact size'))
    expect(frame()).toMatch(/W {2}200.*H {2}150/)

    // The width starts selected: the first digit replaces it, the height follows.
    for (const d of '100') await press(d)
    await until(() => /H {2}75 /.test(frame()))
    expect(frame()).toMatch(/W {2}100.*H {2}75 /)

    await press(ESC)
    await until(() => frame().includes('Resize to'))
    expect(frame()).toContain('becomes 200 × 150')

    await press('#')
    await until(() => frame().includes('Exact size'))
    for (const d of '100') await press(d)
    await press(ENTER)
    await until(() => frame().includes('Save as'))
    expect(frame()).toContain('photo-100x75')

    await settle(400) // let Save as's key handler attach
    app.stdin.write(ENTER)
    const out = join(dir, 'photo-100x75.png')
    await until(() => existsSync(out) && frame().includes('↵ Home'))
    expect(frame()).toContain('photo-100x75.png')
    const meta = await sharp(out).metadata()
    expect([meta.width, meta.height]).toEqual([100, 75])
    app.unmount()
  }, 60_000)
})
