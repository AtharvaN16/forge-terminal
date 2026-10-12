import { existsSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { render } from 'ink-testing-library'
import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_PREFERENCES } from '../../src/config/preferences.js'
import { App } from '../../src/shell/App.js'
import { DARK } from '../../src/shell/theme.js'
import { makeGradientPng, makeJpeg, makePdf, makeTempDir } from '../helpers/fixtures.js'

vi.hoisted(() => {
  process.env.FORCE_COLOR = '3'
  process.env.NO_COLOR = ''
})

const ESC = String.fromCharCode(27)
const ENTER = '\r'
const DOWN = `${ESC}[B`
const settle = (ms = 100) => new Promise((r) => setTimeout(r, ms))
const SGR = new RegExp(`${ESC}\\[[0-9;]*m`, 'g')
const plain = (f: string | undefined) => (f ?? '').replace(SGR, '')
type Shell = ReturnType<typeof render>
const keyRow = (app: Shell) => plain(app.lastFrame()).trimEnd().split('\n').at(-1) ?? ''
const bgOf = (hex: string) =>
  `48;2;${[1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16)).join(';')}`

/** Waits for the screen, then a beat for its keys to be listened for. */
async function until(app: Shell, text: string | RegExp, ms = 15_000) {
  const shown = () =>
    typeof text === 'string'
      ? plain(app.lastFrame()).includes(text)
      : text.test(plain(app.lastFrame()))
  const start = Date.now()
  while (!shown() && Date.now() - start < ms) await settle(30)
  if (!shown()) throw new Error(`never showed ${String(text)}:\n${plain(app.lastFrame())}`)
  await settle(120)
}

async function shell() {
  const dir = join(await makeTempDir(), 'Desktop')
  await mkdir(dir)
  const app = render(
    <App
      initialWidth={80}
      initialHeight={24}
      prefs={{ ...DEFAULT_PREFERENCES, theme: 'dark', defaultOutput: dir }}
    />,
  )
  await settle(200)
  return { app, dir }
}

describe('Convert, with the decided parts', () => {
  it('Format: "Convert to" in the mode’s colour, nothing at its right, F1 keys', async () => {
    const { app, dir } = await shell()
    app.stdin.write(await makeGradientPng(dir, 'test.png', 32))
    await settle()
    app.stdin.write(ENTER)
    await until(app, 'Convert to')
    expect(plain(app.lastFrame())).toMatch(/^ Convert to$/m)
    expect(keyRow(app)).toMatch(/1–5 mode · esc remove file · ctrl-c quit$/)
  }, 30_000)

  it('Pages and Resolution: titled, the file at their right; 150 dpi tagged as the default', async () => {
    const { app, dir } = await shell()
    app.stdin.write(await makePdf(dir, 'report.pdf', 3))
    await settle()
    app.stdin.write(ENTER)
    await until(app, 'Convert to')
    app.stdin.write(ENTER)
    await until(app, /^ Pages /m)
    expect(plain(app.lastFrame())).toMatch(/^ Pages +report\.pdf · 3 pages$/m)
    expect(keyRow(app)).toMatch(/1–5 mode · esc back · ctrl-c quit$/)
    app.stdin.write(ENTER)
    await until(app, /^ Resolution /m)
    const out = app.lastFrame() ?? ''
    expect(plain(out)).toMatch(/^ Resolution +report\.pdf$/m)
    const row = out.split('\n').find((l) => plain(l).includes('150 dpi')) ?? ''
    expect(plain(row)).toMatch(/150 dpi +default/)
    expect(row).toContain(bgOf(DARK.defaultTagBg))
  }, 30_000)
})

describe('Compress, with the decided parts', () => {
  async function compress() {
    const { app, dir } = await shell()
    app.stdin.write('/compress')
    await settle(200)
    app.stdin.write(ENTER)
    await settle(300)
    app.stdin.write(await makeJpeg(dir, 'photo.jpg'))
    await settle()
    app.stdin.write(ENTER)
    await until(app, 'By quality')
    return app
  }

  it('Method: the step’s own name, the file at its right, esc says it removes the file', async () => {
    const app = await compress()
    expect(plain(app.lastFrame())).toMatch(/^ Method +photo\.jpg$/m)
    expect(keyRow(app)).toMatch(/1–5 mode · esc remove file · ctrl-c quit$/)
  }, 30_000)

  it('Target size: the unit inside the filled field, no row of its own and no echo below', async () => {
    const app = await compress()
    app.stdin.write(DOWN + ENTER)
    await until(app, /^ Target size /m)
    app.stdin.write('500')
    await settle(200)
    const out = plain(app.lastFrame())
    expect(out).toMatch(/^ Target size +photo\.jpg · \d/m)
    expect(out).toMatch(/› 500 +B {2,}KB {2,}MB {2,}GB/)
    expect(out).not.toMatch(/→ 500 KB/)
    expect(keyRow(app)).toMatch(/esc back · ctrl-c quit$/)
  }, 30_000)

  it('Can’t get that small: the sentence as the title, what each answer does, esc cancel', async () => {
    const app = await compress()
    app.stdin.write(DOWN + ENTER)
    await until(app, /^ Target size /m)
    app.stdin.write('1b')
    await settle(200)
    app.stdin.write(ENTER)
    await until(app, 'Save as')
    app.stdin.write(ENTER)
    await until(app, 'Try a different target size', 30_000)
    const out = plain(app.lastFrame())
    expect(out).toMatch(/^ photo\.jpg can't get below \d+ B +asked for 1 B$/m)
    expect(out).toMatch(/▌ Use \d+ B anyway +saves it at \d+ B/)
    expect(keyRow(app)).toMatch(/esc cancel · ctrl-c quit$/)
    // The trail ends at the size: the folder and name came after it.
    expect(out.split('\n')[0]).toMatch(/To a target size ╱ 1b ╱ Size ╱╱ *$/)
  }, 60_000)
})

describe('a file staged, back at home', () => {
  it('draws home’s key row: quit, never "close app"', async () => {
    const { app, dir } = await shell()
    app.stdin.write(await makePdf(dir, 'report.pdf', 3))
    await settle()
    app.stdin.write(ENTER)
    await until(app, 'Convert to')
    app.stdin.write(ESC)
    await until(app, 'drop more')
    expect(keyRow(app)).toMatch(/ctrl-c quit$/)
    expect(plain(app.lastFrame())).not.toContain('close app')
  }, 30_000)
})

describe('Name taken (L1), everywhere', () => {
  it('asks it in convert: the title with the old file’s size and age, Keep both first', async () => {
    const { app, dir } = await shell()
    const png = await makeGradientPng(dir, 'test.png', 32)
    await makeJpeg(dir, 'test.jpg')
    app.stdin.write(png)
    await settle()
    app.stdin.write(ENTER)
    await until(app, 'Convert to')
    app.stdin.write(ENTER)
    await until(app, 'sharper')
    app.stdin.write(ENTER)
    await until(app, /^ Save as/m)
    app.stdin.write(ENTER)
    await until(app, 'already exists')
    const out = plain(app.lastFrame())
    expect(out).toMatch(/^ test\.jpg already exists +[\d.]+ (B|KB) · today, \d\d:\d\d$/m)
    expect(out).toMatch(/▌ Keep both +saves yours as test \(1\)\.jpg/)
    expect(out.split('\n')[0]).toMatch(/Name taken ╱╱ *$/)
    app.stdin.write(ENTER)
    await until(app, 'convert another', 20_000)
    expect(existsSync(join(dir, 'test (1).jpg'))).toBe(true)
  }, 60_000)

  it('asks it in /pdf too, where Keep both writes yours beside the one there', async () => {
    const { app, dir } = await shell()
    const pdf = await makePdf(dir, 'report.pdf', 3)
    await makePdf(dir, 'report-rotated.pdf', 1)
    app.stdin.write(pdf)
    await settle()
    app.stdin.write(ENTER)
    await until(app, 'Convert to')
    app.stdin.write(ESC)
    await until(app, 'drop more')
    app.stdin.write('/pdf')
    await settle(200)
    app.stdin.write(ENTER)
    await until(app, /choose an operation/i)
    app.stdin.write(DOWN + DOWN + DOWN + ENTER) // Rotate
    await until(app, '90° right')
    app.stdin.write(ENTER)
    await until(app, /Rotate/)
    // Today's confirm, or Save as once /pdf ends on it: ↵ runs either way.
    app.stdin.write(ENTER)
    await until(app, 'already exists')
    const out = plain(app.lastFrame())
    expect(out).toMatch(/^ report-rotated\.pdf already exists +[\d.]+ (B|KB) · today/m)
    // The trail says what Save as was told, as convert's does: the folder, then the name.
    expect(out.split('\n')[0]).toMatch(
      /90° right ╱ Desktop ╱ report-rotated\.pdf ╱ Name taken ╱╱ *$/,
    )
    expect(out).not.toContain('✕')
    expect(out).toMatch(/▌ Keep both +saves yours as report-rotated \(1\)\.pdf/)
    app.stdin.write(ENTER)
    const start = Date.now()
    while (!existsSync(join(dir, 'report-rotated (1).pdf')) && Date.now() - start < 15_000)
      await settle(50)
    expect(existsSync(join(dir, 'report-rotated (1).pdf'))).toBe(true)
  }, 60_000)
})

describe('esc says what it does', () => {
  it('says “remove file” where esc removes it: Method, and an image’s Format', async () => {
    const { app, dir } = await shell()
    app.stdin.write('/compress')
    await settle(200)
    app.stdin.write(ENTER)
    await settle(300)
    app.stdin.write(await makeJpeg(dir, 'photo.jpg'))
    await settle()
    app.stdin.write(ENTER)
    await until(app, 'By quality')
    expect(keyRow(app)).toMatch(/esc remove file/)
    const image = await shell()
    image.app.stdin.write(await makeGradientPng(image.dir, 'test.png', 32))
    await settle()
    image.app.stdin.write(ENTER)
    await until(image.app, 'Convert to')
    expect(keyRow(image.app)).toMatch(/esc remove file/)
  }, 30_000)

  it('says “back” on a PDF’s Format, where esc keeps the file staged', async () => {
    const { app, dir } = await shell()
    app.stdin.write(await makePdf(dir, 'report.pdf', 3))
    await settle()
    app.stdin.write(ENTER)
    await until(app, 'Convert to')
    expect(keyRow(app)).toMatch(/esc back/)
  }, 30_000)
})
