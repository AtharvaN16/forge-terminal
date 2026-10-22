import { existsSync } from 'node:fs'
import { mkdir, readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { render } from 'ink-testing-library'
import { describe, expect, it } from 'vitest'
import { DEFAULT_PREFERENCES } from '../../src/config/preferences.js'
import { App } from '../../src/shell/App.js'
import { makeGradientPng, makeJpeg, makePdf, makeTempDir } from '../helpers/fixtures.js'
import { unpaint } from '../helpers/unpaint.js'

const ESC = String.fromCharCode(27)
const ENTER = '\r'
const DOWN = `${ESC}[B`
const settle = (ms = 250) => new Promise((r) => setTimeout(r, ms))
const SGR = new RegExp(`${ESC}\\[[0-9;]*m`, 'g')
const plain = (f: string | undefined) => unpaint((f ?? '').replace(SGR, ''))
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
async function atSaveAs(name = 'test.png') {
  const dir = await makeTempDir()
  const file = await makeGradientPng(dir, name, 64)
  const app = render(<App initialWidth={80} initialHeight={24} prefs={prefsFor(dir)} />)
  await settle()
  app.stdin.write(file)
  await settle()
  // Each step waits for its title (on the app's margin since 2026-10-20), then a
  // beat: its key handler attaches just after.
  const reach = async (title: string) => {
    await waitFor(() => lines(app.lastFrame()).includes(title))
    await settle()
  }
  app.stdin.write(ENTER)
  await reach('  Convert to')
  app.stdin.write(ENTER) // JPEG, the first target for a PNG
  await waitFor(() => /^ {2}Quality/m.test(plain(app.lastFrame())))
  await settle()
  app.stdin.write(ENTER) // the quality as it opens
  await reach('  Save as')
  return { app, dir }
}

describe('Save as, in the flow', () => {
  it('follows Quality: its title, the bar saying where you are, the name and the folders', async () => {
    const { app } = await atSaveAs()
    const out = lines(app.lastFrame())
    expect(out).toContain('  Save as')
    expect(out.find((l) => l.includes('convert ╱'))).toMatch(/ JPEG ╱ 80 ╱ Save as ╱╱ *$/)
    // The default output is the file's own folder here.
    expect(plain(app.lastFrame())).toMatch(/name +test +\.jpg/)
    expect(plain(app.lastFrame())).toMatch(/▌ Same location/)
    expect(keyRow(app.lastFrame())).toMatch(
      /↵ {2}save {3}↑↓ {2}folder {3}tab {2}make default +esc back · ctrl-c quit/,
    )
  }, 20_000)

  it('in compress, New subfolder is a compressed folder beside the file, made as it saves', async () => {
    const dir = await makeTempDir()
    const file = await makeGradientPng(dir, 'test.png', 64)
    const app = render(<App initialWidth={80} initialHeight={24} prefs={prefsFor(dir)} />)
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
    app.stdin.write(ENTER) // the quality as it opens
    await waitFor(() => lines(app.lastFrame()).includes('  Save as'))
    await settle()
    for (let i = 0; i < 6 && !/▌ New subfolder/.test(plain(app.lastFrame())); i++) {
      app.stdin.write(DOWN)
      await settle(100)
    }
    expect(plain(app.lastFrame())).toMatch(/▌ New subfolder/)
    app.stdin.write(ENTER)
    await waitFor(() => existsSync(join(dir, 'compressed', 'test-small.png')))
    expect(await readdir(join(dir, 'compressed'))).toEqual(['test-small.png'])
    expect(existsSync(join(dir, 'converted'))).toBe(false)
  }, 20_000)

  it('/ then ↵ saves into a new converted folder, and remembers it as the last place saved', async () => {
    const saved = process.env.XDG_CONFIG_HOME
    process.env.XDG_CONFIG_HOME = await makeTempDir()
    try {
      const { app, dir } = await atSaveAs()
      app.stdin.write('/')
      await waitFor(() => plain(app.lastFrame()).includes('└ converted'))
      expect(plain(app.lastFrame())).toMatch(/└ converted +new folder$/m)
      app.stdin.write(ENTER)
      await waitFor(() => existsSync(join(dir, 'converted', 'test.jpg')))
      expect(await readdir(join(dir, 'converted'))).toEqual(['test.jpg'])
      await waitFor(() =>
        existsSync(join(process.env.XDG_CONFIG_HOME ?? '', 'forge', 'config.json')),
      )
      const config = JSON.parse(
        await readFile(join(process.env.XDG_CONFIG_HOME ?? '', 'forge', 'config.json'), 'utf8'),
      )
      expect(config.lastOutput).toBe(join(dir, 'converted'))
    } finally {
      if (saved === undefined) delete process.env.XDG_CONFIG_HOME
      else process.env.XDG_CONFIG_HOME = saved
    }
  }, 20_000)

  it('tags the folder the last file went to, when it is not the default', async () => {
    const dir = await makeTempDir()
    const elsewhere = join(dir, 'projects')
    await mkdir(elsewhere)
    const file = await makeGradientPng(dir, 'test.png', 64)
    const app = render(
      <App
        initialWidth={80}
        initialHeight={24}
        prefs={{ ...prefsFor(dir), lastOutput: elsewhere }}
      />,
    )
    await settle()
    app.stdin.write(file)
    await settle()
    app.stdin.write(ENTER)
    await waitFor(() => lines(app.lastFrame()).includes('  Convert to'))
    await settle()
    app.stdin.write(ENTER)
    await waitFor(() => /^ {2}Quality/m.test(plain(app.lastFrame())))
    await settle()
    app.stdin.write(ENTER)
    await waitFor(() => lines(app.lastFrame()).includes('  Save as'))
    expect(plain(app.lastFrame())).toMatch(/projects +last saved$/m)
  }, 20_000)

  it('saves under the name as typed, the extension added, in one ↵', async () => {
    const { app, dir } = await atSaveAs()
    app.stdin.write('-2')
    await settle()
    app.stdin.write(ENTER)
    await waitFor(() => existsSync(join(dir, 'test-2.jpg')))
    expect(existsSync(join(dir, 'test-2.jpg'))).toBe(true)
  }, 20_000)

  it('saves to a folder dropped on it, keeping the name', async () => {
    const { app, dir } = await atSaveAs()
    const other = join(dir, 'other')
    await mkdir(other)
    app.stdin.write('-x')
    await settle()
    app.stdin.write(other)
    await settle()
    expect(plain(app.lastFrame())).toMatch(/▌ other +/)
    app.stdin.write(ENTER)
    await waitFor(() => existsSync(join(other, 'test-x.jpg')))
    expect(existsSync(join(other, 'test-x.jpg'))).toBe(true)
  }, 20_000)

  it('keeps a typed name when another folder is chosen', async () => {
    const { app } = await atSaveAs()
    app.stdin.write('-mine')
    await settle()
    app.stdin.write(DOWN)
    await settle()
    expect(plain(app.lastFrame())).toMatch(/name +test-mine +\.jpg/)
    expect(plain(app.lastFrame())).not.toMatch(/▌ Same location/)
  }, 20_000)

  it('goes back to Quality on esc once the name is empty', async () => {
    const { app } = await atSaveAs()
    app.stdin.write(ESC) // clears the name
    await settle()
    expect(plain(app.lastFrame())).toContain('  Save as')
    app.stdin.write(ESC)
    await settle()
    expect(plain(app.lastFrame())).toMatch(/^ {2}Quality +JPEG$/m)
  }, 20_000)

  it('returns to Save as when the existing file question is cancelled', async () => {
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
    expect(out).toContain('  Save as')
    // The name as it was, the folder still chosen, esc back to Quality.
    expect(out).toMatch(/name +test +\.jpg/)
    expect(out).toMatch(/▌ Same location/)
    expect(keyRow(app.lastFrame())).toMatch(/esc back · ctrl-c quit/)
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
    expect(out).toMatch(/files {3}doc-1\.jpg … 2 files/)
    expect(keyRow(app.lastFrame())).toMatch(/esc back · ctrl-c quit/)
    app.stdin.write(ENTER)
    await waitFor(() => existsSync(join(dir, 'doc-2.jpg')))
    expect((await readdir(dir)).sort()).toEqual(['doc-1.jpg', 'doc-2.jpg', 'doc.pdf'])
  }, 30_000)
})

describe('Save as, with names that are easy to break', () => {
  it('keeps a name with a character it shows as ?, rather than saving the ?', async () => {
    // U+202E reverses the text after it, so it is shown as "?" (printable).
    const { app, dir } = await atSaveAs('a\u202eb.png')
    app.stdin.write(ENTER)
    await waitFor(() => existsSync(join(dir, 'a\u202eb.jpg')))
    expect((await readdir(dir)).sort()).toEqual(['a\u202eb.jpg', 'a\u202eb.png'])
  }, 20_000)

  it('does not add the extension twice when it is typed', async () => {
    const { app, dir } = await atSaveAs()
    app.stdin.write(ESC) // clears the name
    await settle()
    app.stdin.write('holiday.jpg')
    await settle()
    app.stdin.write(ENTER)
    await waitFor(() => existsSync(join(dir, 'holiday.jpg')))
    expect((await readdir(dir)).sort()).toEqual(['holiday.jpg', 'test.png'])
  }, 20_000)

  it('cuts a name too long for the folder, keeping the extension', async () => {
    const { app, dir } = await atSaveAs()
    app.stdin.write(ESC)
    await settle()
    app.stdin.write('x'.repeat(300))
    await settle()
    app.stdin.write(ENTER)
    const want = `${'x'.repeat(251)}.jpg`
    await waitFor(() => existsSync(join(dir, want)))
    console.log(
      'DBG',
      (await readdir(dir)).map((n) => n.length),
      plain(app.lastFrame()).slice(-900),
    )
    expect(existsSync(join(dir, want))).toBe(true)
  }, 20_000)
})
