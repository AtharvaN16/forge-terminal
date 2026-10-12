import { existsSync } from 'node:fs'
import { mkdir, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { render } from 'ink-testing-library'
import { describe, expect, it } from 'vitest'
import { DEFAULT_PREFERENCES } from '../../src/config/preferences.js'
import { App } from '../../src/shell/App.js'
import { makeGradientPng, makeJpeg, makePdf, makeTempDir } from '../helpers/fixtures.js'

const ESC = String.fromCharCode(27)
const ENTER = '\r'
const TAB = '\t'
const DOWN = `${ESC}[B`
const settle = (ms = 250) => new Promise((r) => setTimeout(r, ms))
const SGR = new RegExp(`${ESC}\\[[0-9;]*m`, 'g')
const plain = (f: string | undefined) => (f ?? '').replace(SGR, '')
const lines = (f: string | undefined) => plain(f).split('\n')
const keyRow = (f: string | undefined) => lines(f).findLast((l) => l.trim() !== '') ?? ''

async function waitFor(ok: () => boolean, ms = 10_000) {
  const start = Date.now()
  while (!ok() && Date.now() - start < ms) await settle(30)
}

const prefsFor = (dir: string) => ({
  ...DEFAULT_PREFERENCES,
  theme: 'dark' as const,
  defaultOutput: dir,
})

/** A PNG converting to JPEG, at Save as: drop, JPEG, the quality as it opens. */
async function atSaveAs() {
  const dir = await makeTempDir()
  const file = await makeGradientPng(dir, 'test.png', 64)
  const app = render(<App initialWidth={80} initialHeight={24} prefs={prefsFor(dir)} />)
  await settle()
  app.stdin.write(file)
  await settle()
  app.stdin.write(ENTER)
  await settle(400)
  app.stdin.write(ENTER) // JPEG, the first target for a PNG
  await settle(300)
  app.stdin.write(ENTER) // the quality as it opens
  await settle(300)
  return { app, dir }
}

describe('Save as, in the flow', () => {
  it('follows Quality: its title, the bar saying where you are, the sentence in the field', async () => {
    const { app } = await atSaveAs()
    const out = lines(app.lastFrame())
    expect(out).toContain(' Save as')
    expect(out.find((l) => l.includes('convert ╱'))).toMatch(/ JPEG ╱ 80 ╱ Save as ╱╱ *$/)
    // The default output is the file's own folder here.
    expect(plain(app.lastFrame())).toContain('› test.jpg   in  Same folder ▾')
    expect(keyRow(app.lastFrame())).toMatch(/↵ {2}save {3}tab {2}folder +esc back · ctrl-c quit/)
  }, 20_000)

  it('saves under the name as typed, the extension added, in one ↵', async () => {
    const { app, dir } = await atSaveAs()
    app.stdin.write('-2')
    await settle()
    app.stdin.write(ENTER)
    await waitFor(() => existsSync(join(dir, 'test-2.jpg')))
    expect(existsSync(join(dir, 'test-2.jpg'))).toBe(true)
  }, 20_000)

  it('saves to a folder typed in the list, keeping the name', async () => {
    const { app, dir } = await atSaveAs()
    const other = join(dir, 'other')
    await mkdir(other)
    app.stdin.write('-x')
    await settle()
    app.stdin.write(TAB)
    await settle()
    app.stdin.write(other)
    await settle()
    expect(plain(app.lastFrame())).toContain('Use this folder')
    app.stdin.write(ENTER)
    await waitFor(() => existsSync(join(other, 'test-x.jpg')))
    expect(existsSync(join(other, 'test-x.jpg'))).toBe(true)
  }, 20_000)

  it('keeps a typed name when another folder is chosen', async () => {
    const { app, dir } = await atSaveAs()
    app.stdin.write('-mine')
    await settle()
    app.stdin.write(TAB)
    await settle()
    app.stdin.write(join(dir, 'elsewhere'))
    await settle()
    app.stdin.write(ESC) // clears what was typed to find a folder
    await settle()
    app.stdin.write(DOWN)
    await settle()
    app.stdin.write(ESC) // back to the name
    await settle()
    expect(plain(app.lastFrame())).toContain('› test-mine.jpg   in ')
    expect(plain(app.lastFrame())).not.toContain('in  Same folder ▾')
  }, 20_000)

  it('goes back to Quality on esc once the name is empty', async () => {
    const { app } = await atSaveAs()
    app.stdin.write(ESC) // clears the name
    await settle()
    expect(plain(app.lastFrame())).toContain(' Save as')
    app.stdin.write(ESC)
    await settle()
    expect(plain(app.lastFrame())).toMatch(/^ Quality +JPEG$/m)
  }, 20_000)

  it('returns to Save as on the folder when the existing file question is cancelled', async () => {
    const { app, dir } = await atSaveAs()
    await makeJpeg(dir, 'test.jpg')
    app.stdin.write(ENTER)
    await settle(400)
    expect(plain(app.lastFrame())).toContain('test.jpg already exists')
    app.stdin.write(DOWN)
    app.stdin.write(DOWN)
    await settle()
    app.stdin.write(ENTER) // Cancel
    await settle()
    const out = plain(app.lastFrame())
    expect(out).toContain(' Save as')
    // The folder focused: the list is open, and esc goes to the name.
    expect(out).toContain('› test.jpg   in  Same folder')
    expect(keyRow(app.lastFrame())).toMatch(/esc name · ctrl-c quit/)
    expect((await readdir(dir)).sort()).toEqual(['test.jpg', 'test.png'])
  }, 20_000)
})

describe('Save as, a document rasterised to many files', () => {
  it('opens on the folder, says what will be written, and saves there', async () => {
    const dir = await makeTempDir()
    const file = await makePdf(dir, 'doc.pdf', 2)
    const app = render(<App initialWidth={100} initialHeight={24} prefs={prefsFor(dir)} />)
    await settle()
    app.stdin.write(file)
    await settle()
    app.stdin.write(ENTER)
    await settle(400)
    app.stdin.write(ENTER) // JPEG -> pages
    await settle(300)
    app.stdin.write(ENTER) // all pages -> resolution
    await settle(300)
    app.stdin.write(ENTER) // the resolution -> quality
    await settle(300)
    app.stdin.write(ENTER) // the quality -> Save as
    await settle(300)
    const out = plain(app.lastFrame())
    expect(out).toContain('› doc-1.jpg … 2 files   in  Same folder')
    expect(keyRow(app.lastFrame())).toMatch(/esc back · ctrl-c quit/)
    app.stdin.write(ENTER)
    await waitFor(() => existsSync(join(dir, 'doc-2.jpg')))
    expect((await readdir(dir)).sort()).toEqual(['doc-1.jpg', 'doc-2.jpg', 'doc.pdf'])
  }, 30_000)
})
