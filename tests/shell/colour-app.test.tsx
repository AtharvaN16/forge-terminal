import { render } from 'ink-testing-library'
import { describe, expect, it } from 'vitest'
import { DEFAULT_PREFERENCES } from '../../src/config/preferences.js'
import { App } from '../../src/shell/App.js'
import { makeGradientPng, makePdf, makeTempDir } from '../helpers/fixtures.js'
import { unpaint } from '../helpers/unpaint.js'

const ESC = String.fromCharCode(27)
const ENTER = '\r'
const settle = (ms = 250) => new Promise((r) => setTimeout(r, ms))
const SGR = new RegExp(`${ESC}\\[[0-9;]*m`, 'g')
const plain = (f: string | undefined) => (f ?? '').replace(SGR, '')
const lines = (f: string | undefined) => plain(f).split('\n')
const keyRow = (f: string | undefined) => lines(f).findLast((l) => l.trim() !== '') ?? ''
const tabRow = (f: string | undefined) => lines(f).find((l) => l.includes('1 convert')) ?? ''

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
  h.app.stdin.write('6')
  await waitFor(() => plain(h.app.lastFrame()).includes('extract colours'))
  await settle()
  return h
}

describe("colour's home and screens", () => {
  it('offers Palette and Scale, with no field until something is typed', async () => {
    const { app } = await colourHome()
    const out = plain(app.lastFrame())
    expect(out).toContain('Palette')
    expect(out).toContain('create shades')
    expect(out).not.toContain('OR search or enter a file path…')
    expect(keyRow(app.lastFrame())).toMatch(/A S D +open/)
    // Each card carries its key.
    expect(plain(app.lastFrame())).toMatch(/A Extract +S Scale +D Palette/)
  }, 20_000)

  it('A S D open Extract, Scale and Palette at once, in either case', async () => {
    const first = await colourHome()
    first.app.stdin.write('a')
    await waitFor(() => plain(first.app.lastFrame()).includes('type an image path'))
    expect(plain(first.app.lastFrame())).toContain('type an image path')
    const second = await colourHome()
    // The Palette card opens Scale on its Palette tab (2026-10-24).
    second.app.stdin.write('D')
    await waitFor(() => plain(second.app.lastFrame()).includes('type a hex'))
    expect(lines(second.app.lastFrame()).find((l) => l.includes('colour'))).toMatch(/Scale/)
    expect(plain(second.app.lastFrame())).toMatch(/50 +100 +200/)
  }, 20_000)

  it('s opens the scale; a typed colour draws it; the bar says Scale; esc esc is home again', async () => {
    const { app } = await colourHome()
    app.stdin.write('s')
    await waitFor(() => plain(app.lastFrame()).includes('type a hex'))
    app.stdin.write('6579FD')
    await waitFor(() => plain(app.lastFrame()).includes('normal  large'))
    expect(lines(app.lastFrame()).find((l) => l.includes('colour'))).toMatch(/Scale/)
    app.stdin.write(ESC)
    await settle(300)
    app.stdin.write(ESC)
    await waitFor(() => plain(app.lastFrame()).includes('extract colours'))
    expect(plain(app.lastFrame())).toContain('extract colours')
  }, 20_000)

  it('s changes the steps on the line under the ramp; ↵ done keeps them for the session', async () => {
    const { app } = await colourHome()
    app.stdin.write('s')
    await waitFor(() => plain(app.lastFrame()).includes('type a hex'))
    app.stdin.write('6579FD')
    await settle()
    await waitFor(() => plain(app.lastFrame()).includes('Tailwind  50 – 950'))
    // Tweak and Steps are in More, over the rule; # new colour is at the field's far end.
    expect(plain(app.lastFrame())).toMatch(/11 steps\s*\n/)
    expect(plain(app.lastFrame())).toMatch(/ m {2}more\s*\n/)
    expect(plain(app.lastFrame())).toMatch(/#6579FD .* # new colour/)
    expect(keyRow(app.lastFrame())).toMatch(/r make centre · esc back/)
    expect(lines(app.lastFrame())).toHaveLength(24)

    app.stdin.write('s')
    await waitFor(() => plain(app.lastFrame()).includes('‹ Tailwind ›'))
    // tab next on the steps' line, not in the key row; the tab row's cap hides (2026-10-24).
    expect(plain(app.lastFrame())).toMatch(/‹ Tailwind ›.* tab +↵ +done\s*\n/)
    expect(keyRow(app.lastFrame())).toMatch(/^ *←→ +change +esc cancel/)
    expect(plain(app.lastFrame())).toMatch(/Palette\s*\n/)
    app.stdin.write(`${ESC}[C`)
    await waitFor(() => plain(app.lastFrame()).includes('‹ Even ›'))
    // Radix has only the set to change: no tab.
    app.stdin.write(`${ESC}[C`)
    await waitFor(() => plain(app.lastFrame()).includes('‹ Radix ›'))
    expect(plain(app.lastFrame())).toMatch(/‹ Radix ›.* {3}↵ +done\s*\n/)
    app.stdin.write(`${ESC}[D`)
    await waitFor(() => plain(app.lastFrame()).includes('‹ Even ›'))
    for (let i = 0; i < 3; i++) {
      app.stdin.write('\t')
      await settle(100)
    }
    for (let i = 0; i < 4; i++) {
      app.stdin.write(`${ESC}[C`)
      await settle(100)
    }
    await waitFor(() => plain(app.lastFrame()).includes('‹ 15 ›'))
    app.stdin.write(ENTER)
    await waitFor(() => plain(app.lastFrame()).includes('Even  50 – 950  ·  15 steps'))
    expect(lines(app.lastFrame())).toHaveLength(24)

    // Out to colour's home and back with another colour: the steps are still Even, 15.
    app.stdin.write(ESC)
    await waitFor(() => plain(app.lastFrame()).includes('create shades'))
    await settle(300)
    app.stdin.write('#F26E69')
    await waitFor(() => plain(app.lastFrame()).includes('15 steps'))
    expect(plain(app.lastFrame())).toContain('Even  50 – 950  ·  15 steps')
  }, 30_000)

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

  it('the palette: the photo in a frame, → go deeper beside the values, not in the key row', async () => {
    const { app, dir } = await colourHome()
    app.stdin.write(await makeGradientPng(dir, 'g.png', 48))
    await waitFor(() => /\d+%\s*$/m.test(plain(app.lastFrame())))
    await settle()
    // Read in layout columns: the painted canvas's margin taken off.
    const rows = unpaint(plain(app.lastFrame())).split('\n')
    // The frame's corners, at the photo's left edge, four cells in.
    const top = rows.findIndex((l) => l.startsWith('    ┌'))
    const bottom = rows.findIndex((l) => l.startsWith('    └'))
    expect(top).toBeGreaterThan(-1)
    expect(bottom).toBeGreaterThan(top)
    expect(rows[top]).toMatch(/^ {4}┌─+┐/)
    expect(rows[bottom]).toMatch(/^ {4}└─+┘/)
    for (const row of rows.slice(top + 1, bottom)) expect(row).toMatch(/^ {4}│.+│/)
    // The values, then the key at the line's far end.
    const detail = rows.find((l) => /^ {4}#[0-9A-F]{6} {2}rgb\(/.test(l)) ?? ''
    expect(detail).toMatch(/oklch\(.+\) +→ +go deeper$/)
    expect(keyRow(app.lastFrame())).not.toContain('open')
    expect(keyRow(app.lastFrame())).toMatch(/↑↓ +choose +↵ +copy +c +copy all/)
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
    expect(plain(app.lastFrame())).toContain('extract colours')
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

  it('an image dropped whole, bracketed, on colour home opens its palette', async () => {
    const { app, dir } = await colourHome()
    const png = await makeGradientPng(dir, 'g.png', 48)
    app.stdin.write(`${ESC}[200~${png.slice(0, 5)}`)
    app.stdin.write(`${png.slice(5)}${ESC}[201~`)
    await waitFor(() => /\d+%\s*$/m.test(plain(app.lastFrame())))
    expect(plain(app.lastFrame())).toContain('› g.png')
  }, 20_000)

  it('a bracketed hex paste on colour home opens its scale', async () => {
    const { app } = await colourHome()
    app.stdin.write(`${ESC}[200~#6579FD${ESC}[201~`)
    await waitFor(() => plain(app.lastFrame()).includes('normal  large'))
    expect(plain(app.lastFrame())).toContain('#6579FD')
  }, 20_000)

  it('a hex pasted on colour home opens its scale', async () => {
    const { app } = await colourHome()
    app.stdin.write('#6579FD')
    await waitFor(() => plain(app.lastFrame()).includes('normal  large'))
    expect(plain(app.lastFrame())).toContain('#6579FD')
    expect(plain(app.lastFrame())).not.toContain('could not be found')
  }, 20_000)

  it('5 lets go of a staged file, as /colour does: colour neither shows it nor brings it back', async () => {
    const { app, dir } = await home()
    const png = await makeGradientPng(dir, 'g.png', 48)
    app.stdin.write(png)
    await waitFor(() => plain(app.lastFrame()).includes('drop more'))
    app.stdin.write('6')
    await waitFor(() => plain(app.lastFrame()).includes('extract colours'))
    await settle()
    expect(plain(app.lastFrame())).not.toContain('g.png')
    app.stdin.write('1')
    await waitFor(() => plain(app.lastFrame()).includes('OR search or enter a file path…'))
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

describe('colour, the sixth mode', () => {
  it('6 on home makes colour the mode', async () => {
    const { app } = await home(96)
    expect(tabRow(app.lastFrame())).toContain('6 colour')
    expect(keyRow(app.lastFrame())).toMatch(/1–6 ←→ +mode/)
    app.stdin.write('6')
    await waitFor(() => plain(app.lastFrame()).includes('extract colours'))
    expect(plain(app.lastFrame())).toContain('extract colours')
    // The tab row says nothing of where results go (2026-10-13).
    expect(tabRow(app.lastFrame())).not.toContain('clipboard')
  }, 20_000)

  it('6 on a picker does nothing: modes change on home only', async () => {
    const { app, dir } = await home(96)
    app.stdin.write(await makeGradientPng(dir, 'a.png', 32))
    await settle()
    app.stdin.write(ENTER)
    await waitFor(() => plain(app.lastFrame()).includes('Convert to'))
    await settle(300) // the picker's keys attach after its first frame
    expect(keyRow(app.lastFrame())).not.toMatch(/1–6/)
    app.stdin.write('6')
    await settle(300)
    expect(plain(app.lastFrame())).toContain('Convert to')
    expect(plain(app.lastFrame())).not.toContain('extract colours')
  }, 20_000)
})
