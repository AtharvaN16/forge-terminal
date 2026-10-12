import { render } from 'ink-testing-library'
import { describe, expect, it } from 'vitest'
import { DEFAULT_PREFERENCES } from '../../src/config/preferences.js'
import { App } from '../../src/shell/App.js'
import { makeGradientPng, makePdf, makeTempDir } from '../helpers/fixtures.js'

const ESC = String.fromCharCode(27)
const ENTER = '\r'
const CTRL_N = String.fromCharCode(14)
const settle = (ms = 250) => new Promise((r) => setTimeout(r, ms))
const SGR = new RegExp(`${ESC}\\[[0-9;]*m`, 'g')
const plain = (f: string | undefined) => (f ?? '').replace(SGR, '')
const lines = (f: string | undefined) => plain(f).split('\n')
const keyRow = (f: string | undefined) => lines(f).findLast((l) => l.trim() !== '') ?? ''
const tabRow = (f: string | undefined) => lines(f).find((l) => l.includes('/ commands')) ?? ''

async function waitFor(ok: () => boolean, ms = 10_000) {
  const start = Date.now()
  while (!ok() && Date.now() - start < ms) await settle(30)
}

/** 80 columns by default; with five tabs, the tab row's destination needs ~96. */
async function home(width = 80) {
  const dir = await makeTempDir()
  const app = render(
    <App
      initialWidth={width}
      initialHeight={24}
      prefs={{ ...DEFAULT_PREFERENCES, theme: 'dark', defaultOutput: dir }}
    />,
  )
  await settle()
  return { app, dir }
}

async function colourHome() {
  const h = await home()
  h.app.stdin.write('5')
  await waitFor(() => plain(h.app.lastFrame()).includes('the colours of an image'))
  await settle()
  return h
}

describe("colour's home and screens", () => {
  it('offers Palette and Scale, with no field until something is typed', async () => {
    const { app } = await colourHome()
    const out = plain(app.lastFrame())
    expect(out).toContain('Palette')
    expect(out).toContain('50 to 950 from one colour')
    expect(out).not.toContain('or type a path')
    expect(keyRow(app.lastFrame())).toMatch(/←→ +choose +↵ +open/)
  }, 20_000)

  it('→ ↵ opens the scale; a typed colour draws it; the bar says Scale; esc esc is home again', async () => {
    const { app } = await colourHome()
    app.stdin.write(`${ESC}[C`)
    await settle()
    app.stdin.write(ENTER)
    await waitFor(() => plain(app.lastFrame()).includes('type a hex code'))
    app.stdin.write('6579FD')
    await waitFor(() => plain(app.lastFrame()).includes('white text'))
    expect(lines(app.lastFrame()).find((l) => l.includes('colour'))).toMatch(/Scale/)
    app.stdin.write(ESC)
    await settle(300)
    app.stdin.write(ESC)
    await waitFor(() => plain(app.lastFrame()).includes('the colours of an image'))
    expect(plain(app.lastFrame())).toContain('the colours of an image')
  }, 20_000)

  it('# on colour home opens the scale with # typed', async () => {
    const { app } = await colourHome()
    app.stdin.write('#')
    await waitFor(() => plain(app.lastFrame()).includes('› #'))
    expect(plain(app.lastFrame())).toContain('› #')
  }, 20_000)

  it('an image dropped on colour home opens its palette', async () => {
    const { app, dir } = await colourHome()
    app.stdin.write(await makeGradientPng(dir, 'g.png', 48))
    await waitFor(() => /\d+%\s*$/m.test(plain(app.lastFrame())))
    expect(plain(app.lastFrame())).toContain('› g.png')
  }, 20_000)

  it('a PDF dropped there is refused with its reason, and nothing quits', async () => {
    const { app, dir } = await colourHome()
    app.stdin.write(await makePdf(dir, 'report.pdf'))
    await waitFor(() => plain(app.lastFrame()).includes('not an image'))
    expect(plain(app.lastFrame())).toContain('report.pdf is a PDF, not an image.')
  }, 20_000)

  it('a mouse scroll or click on colour home is not a dropped path', async () => {
    const { app } = await colourHome()
    app.stdin.write(`${ESC}[<64;10;5M`)
    await settle(400)
    app.stdin.write(`${ESC}[<0;10;5M`)
    await settle(400)
    expect(plain(app.lastFrame())).toContain('the colours of an image')
    expect(plain(app.lastFrame())).not.toContain('could not be found')
  }, 20_000)

  // Only a POSIX path starts with the / that opens commands; `C:\…` never does.
  it.skipIf(process.platform === 'win32')(
    'a path typed after / opens its palette, not convert',
    async () => {
      const { app, dir } = await colourHome()
      const png = await makeGradientPng(dir, 'g.png', 48)
      app.stdin.write('/')
      await settle()
      app.stdin.write(png.slice(1))
      await settle()
      app.stdin.write(ENTER)
      await waitFor(() => /\d+%\s*$/m.test(plain(app.lastFrame())))
      expect(plain(app.lastFrame())).not.toContain('Convert PNG to')
      expect(plain(app.lastFrame())).toContain('› g.png')
    },
    20_000,
  )

  it('a hex pasted on colour home opens its scale', async () => {
    const { app } = await colourHome()
    app.stdin.write('#6579FD')
    await waitFor(() => plain(app.lastFrame()).includes('white text'))
    expect(plain(app.lastFrame())).toContain('#6579FD')
    expect(plain(app.lastFrame())).not.toContain('could not be found')
  }, 20_000)

  it('5 lets go of a staged file, as /colour does: colour neither shows it nor brings it back', async () => {
    const { app, dir } = await home()
    const png = await makeGradientPng(dir, 'g.png', 48)
    app.stdin.write(png)
    await waitFor(() => plain(app.lastFrame()).includes('drop more'))
    app.stdin.write('5')
    await waitFor(() => plain(app.lastFrame()).includes('the colours of an image'))
    await settle()
    expect(plain(app.lastFrame())).not.toContain('g.png')
    app.stdin.write('1')
    await waitFor(() => plain(app.lastFrame()).includes('or type a path'))
    expect(plain(app.lastFrame())).not.toContain('g.png')
    expect(plain(app.lastFrame())).not.toContain('drop more')
  }, 20_000)

  it('/ opens the commands in place, as on every home', async () => {
    const { app } = await colourHome()
    app.stdin.write('/')
    await waitFor(() => plain(app.lastFrame()).includes('/convert'))
    expect(plain(app.lastFrame())).toContain('/convert')
  }, 20_000)
})

describe('colour, the fifth mode', () => {
  it('5 on home makes colour the mode; results go to the clipboard', async () => {
    const { app } = await home(96)
    expect(tabRow(app.lastFrame())).toContain('5 colour')
    expect(keyRow(app.lastFrame())).toMatch(/1–5 +mode/)
    app.stdin.write('5')
    await waitFor(() => tabRow(app.lastFrame()).includes('clipboard'))
    expect(tabRow(app.lastFrame())).toContain('clipboard')
  }, 20_000)

  it('5 on a picker switches to colour, and ctrl-n goes back to convert', async () => {
    const { app, dir } = await home(96)
    app.stdin.write(await makeGradientPng(dir, 'a.png', 32))
    await settle()
    app.stdin.write(ENTER)
    await waitFor(() => plain(app.lastFrame()).includes('Convert PNG to'))
    await settle(300) // the picker's keys attach after its first frame
    expect(keyRow(app.lastFrame())).toMatch(/1–5 +mode/)
    app.stdin.write('5')
    await waitFor(() => tabRow(app.lastFrame()).includes('clipboard'))
    expect(tabRow(app.lastFrame())).toContain('clipboard')
    app.stdin.write(CTRL_N)
    await waitFor(
      () =>
        tabRow(app.lastFrame()).includes('~/') || !tabRow(app.lastFrame()).includes('clipboard'),
    )
    expect(tabRow(app.lastFrame())).not.toContain('clipboard')
  }, 20_000)
})
