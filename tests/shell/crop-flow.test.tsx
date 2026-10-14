import { existsSync } from 'node:fs'
import { join } from 'node:path'
import chalk from 'chalk'
import { render } from 'ink-testing-library'
import sharp from 'sharp'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_PREFERENCES } from '../../src/config/preferences.js'
import { assetFor, CATALOG, offeredOn } from '../../src/extensions/catalog.js'
import type { ExtensionStatus } from '../../src/extensions/manager.js'
import { App } from '../../src/shell/App.js'
import type { EnhanceTools } from '../../src/shell/enhance.js'
import { makeTempDir } from '../helpers/fixtures.js'

const ESC = String.fromCharCode(27)
const DOWN = `${ESC}[B`
const UP = `${ESC}[A`
const LEFT = `${ESC}[D`
const RIGHT = `${ESC}[C`
const ENTER = String.fromCharCode(13)
const SGR = new RegExp(`${ESC}\\[[0-9;]*m`, 'g')
const settle = (ms = 250) => new Promise((r) => setTimeout(r, ms))
const until = async (cond: () => boolean) => {
  for (let i = 0; i < 1200 && !cond(); i++) await new Promise((r) => setTimeout(r, 25))
}

/** Not pinned (as resize-flow): Crop to shape is built in on both OSes. */
const WINDOWS = process.platform === 'win32'
/** Sharpen, Boost, Remove background on a Mac, Trim edges, Resize: Crop is the next row. */
const ROWS_ABOVE = WINDOWS ? 4 : 5

const tools: EnhanceTools = {
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

/** 1200 × 600 grey, a saturated red disc near the right: attention's square goes right. */
async function photo(dir: string): Promise<string> {
  const png = join(dir, 'photo.png')
  const disc = Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="600"><circle cx="1000" cy="300" r="150" fill="#e8201a"/></svg>',
  )
  await sharp({ create: { width: 1200, height: 600, channels: 3, background: '#808080' } })
    .composite([{ input: disc }])
    .png()
    .toFile(png)
  return png
}

const level = chalk.level
beforeEach(() => {
  chalk.level = 3 // a true-colour terminal: the suite's stdout is not a TTY
})
afterEach(() => {
  chalk.level = level
})

/** The picture's rows: those holding a half block or the hatch, under the title. */
const pictureOf = (raw: string) => {
  const lines = raw.split('\n')
  const title = lines.findIndex((l) => l.replace(SGR, '').includes('Crop to '))
  return lines.slice(title + 1).filter((l) => {
    const t = l.replace(SGR, '')
    return t.includes('▀') || t.includes('╱')
  })
}

describe('Crop to shape in Enhance', () => {
  it('previews attention’s crop, moves, zooms and resets it, and writes the square', async () => {
    const dir = await makeTempDir()
    const png = await photo(dir)
    const app = render(
      <App
        initialWidth={80}
        initialHeight={24}
        prefs={{ ...DEFAULT_PREFERENCES, theme: 'dark', defaultOutput: dir }}
        tools={tools}
      />,
    )
    const raw = () => app.lastFrame() ?? ''
    const frame = () => raw().replace(SGR, '')
    const keyRow = () => frame().trimEnd().split('\n').at(-1) ?? ''
    const press = async (key: string, ms = 80) => {
      app.stdin.write(key)
      await settle(ms)
    }

    await press('/enhance', 250)
    await press(ENTER, 250)
    app.stdin.write(png)
    await until(() => frame().includes('photo.png'))
    app.stdin.write(ENTER)
    await until(() => frame().includes('Enhance PNG'))
    await settle(300)

    for (let i = 0; i < ROWS_ABOVE; i++) await press(DOWN)
    await until(() => frame().includes('‹ 1:1 ›'))
    expect(frame()).toContain('becomes 600 × 600')

    // 4:5 first, then back: esc keeps the shape on the pill.
    await press(RIGHT)
    await until(() => frame().includes('‹ 4:5 ›'))
    await press(ENTER)
    await until(() => frame().includes('Crop to 4:5'))
    await press(ESC)
    await until(() => frame().includes('Enhance PNG'))
    expect(frame()).toMatch(/▌ Crop to shape +‹ 4:5 ›/)
    await press(LEFT)
    await until(() => frame().includes('‹ 1:1 ›'))
    await press(ENTER)
    await until(() => frame().includes('Crop to 1:1'))

    // The header bar's trail, the facts, and — once the photo is read — the picture.
    expect(frame().split('\n').slice(0, 3).join(' ')).toMatch(/Crop to shape ╱ 1:1/)
    await until(() => pictureOf(raw()).length > 0)
    expect(frame()).toMatch(/600 × 600 · 1:1/)
    expect(frame()).toContain('keeps 50 % of the photo')
    expect(keyRow()).toMatch(/←→ +move +\+− +zoom +↵ +confirm/)
    expect(keyRow()).not.toContain('↑↓')
    expect(keyRow()).not.toContain('reset')
    // The guess is on the disc: the left half is what is cut.
    const guess = pictureOf(raw())
    const firstRow = guess[0]?.replace(SGR, '') ?? ''
    // Hatch, then the photo (a cell of one colour is a space on it).
    expect(firstRow.trimStart()).toMatch(/^╱+[ ▀]/)

    // ← moves it one dot of the picture: the hatch moves; r reset appears.
    await press(LEFT)
    await until(() => keyRow().includes('reset'))
    expect(pictureOf(raw())).not.toEqual(guess)
    expect(keyRow()).toMatch(/\+− +zoom +r +reset +↵ +confirm/)
    await press('r')
    await until(() => !keyRow().includes('reset'))
    expect(pictureOf(raw())).toEqual(guess)

    // + zooms in: the crop no longer spans the height, so ↑↓ move it too.
    await press('+')
    await until(() => keyRow().includes('↑↓←→'))
    expect(frame()).toContain('540 × 540 · 1:1')
    expect(frame()).toContain('keeps 41 % of the photo')
    expect(keyRow()).toContain('reset')
    await press(UP)
    await press('-')
    await until(() => frame().includes('600 × 600 · 1:1'))
    expect(keyRow()).toMatch(/^ *←→ +move/)
    await press('r')
    await until(() => !keyRow().includes('reset'))

    await press(ENTER)
    await until(() => frame().includes('Save as'))
    expect(frame()).toContain('photo-cropped-1x1')
    await settle(400) // let Save as's key handler attach
    app.stdin.write(ENTER)
    const out = join(dir, 'photo-cropped-1x1.png')
    await until(() => existsSync(out) && frame().includes('enhance another'))
    const meta = await sharp(out).metadata()
    expect([meta.width, meta.height]).toEqual([600, 600])
    // The square is the disc's side: its middle pixel is red.
    const { data } = await sharp(out)
      .extract({ left: 400, top: 300, width: 1, height: 1 })
      .raw()
      .toBuffer({ resolveWithObject: true })
    expect(data[0]).toBeGreaterThan(200)
    app.unmount()
  }, 60_000)

  it('with no colour, draws no picture and says where the crop sits', async () => {
    chalk.level = 0
    const dir = await makeTempDir()
    const png = await photo(dir)
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
    await press('/enhance', 250)
    await press(ENTER, 250)
    app.stdin.write(png)
    await until(() => frame().includes('photo.png'))
    app.stdin.write(ENTER)
    await until(() => frame().includes('Enhance PNG'))
    await settle(300)
    for (let i = 0; i < ROWS_ABOVE; i++) await press(DOWN)
    await press(ENTER)
    await until(() => /left [\d,]+ px · top 0 px/.test(frame()))
    expect(frame()).toMatch(/left 600 px · top 0 px +600 × 600 · 1:1/)
    // Under the title, over the rule: no half block, no hatch.
    const lines = frame().split('\n')
    const body = lines.slice(lines.findIndex((l) => l.includes('Crop to 1:1')) + 1, -2).join('\n')
    expect(body).not.toContain('▀')
    expect(body).not.toContain('╱')
    await press(LEFT)
    await until(() => !frame().includes('left 600 px'))
    expect(frame()).toMatch(/left 5\d\d px · top 0 px/)
    app.unmount()
  }, 60_000)
})
