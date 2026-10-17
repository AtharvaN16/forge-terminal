import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { render } from 'ink-testing-library'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_PREFERENCES } from '../../src/config/preferences.js'
import { App } from '../../src/shell/App.js'
import { makeJpeg, makePdf, makeTempDir } from '../helpers/fixtures.js'

const ESC = String.fromCharCode(27)
const DOWN = `${ESC}[B`
const ENTER = String.fromCharCode(13)
const TAB = '\t'
const ROWS = 24
const SGR = new RegExp(`${ESC}\\[[0-9;]*m`, 'g')
const settle = (ms = 250) => new Promise((r) => setTimeout(r, ms))
const until = async (cond: () => boolean) => {
  for (let i = 0; i < 400 && !cond(); i++) await new Promise((r) => setTimeout(r, 25))
}

let cfg: string
const saved = process.env.XDG_CONFIG_HOME
beforeEach(async () => {
  cfg = await mkdtemp(join(tmpdir(), 'forge-notices-'))
  process.env.XDG_CONFIG_HOME = cfg
})
afterEach(() => {
  if (saved === undefined) delete process.env.XDG_CONFIG_HOME
  else process.env.XDG_CONFIG_HOME = saved
})

/** The App at ROWS rows, and its window: the frame's last ROWS lines, under any scrollback. */
async function shell(columns = 100) {
  const dir = await makeTempDir()
  const app = render(
    <App
      initialWidth={columns}
      initialHeight={ROWS}
      prefs={{ ...DEFAULT_PREFERENCES, theme: 'dark', defaultOutput: dir }}
    />,
  )
  const frame = () => (app.lastFrame() ?? '').replace(SGR, '')
  const window = () => frame().split('\n').slice(-ROWS)
  /** The window's row holding `text`, -1 when it is not on screen. */
  const row = (text: string | RegExp) =>
    window().findIndex((l) => (typeof text === 'string' ? l.includes(text) : text.test(l)))
  return { ...app, dir, frame, window, row }
}

/**
 * Every screen fills the window, so a line `<Static>` prints lands above it,
 * off the top of the screen. What the shell says is held on screen instead:
 * under home's field, above every other screen's keys.
 */
describe('what the shell says is on screen, not only in the scrollback', () => {
  it('home: a command it does not know, under the field', async () => {
    const app = await shell()
    app.stdin.write('/nope')
    await settle()
    app.stdin.write(ENTER)
    await until(() => app.row('no command matches') >= 0)
    expect(app.row('no command matches')).toBeGreaterThan(app.row('type a path'))
    expect(app.row('ctrl-c quit')).toBe(ROWS - 1)
  })

  it('home: a /pdf rotate says what it wrote and where', async () => {
    const app = await shell()
    const file = await makePdf(app.dir, 'doc.pdf', 3)
    app.stdin.write(file)
    await settle()
    app.stdin.write(ENTER)
    await settle(400)
    app.stdin.write(ESC) // off the convert picker, the file kept
    await settle(200)
    app.stdin.write('/pdf')
    await settle()
    app.stdin.write(ENTER)
    await until(() => app.frame().includes('Choose an operation'))
    app.stdin.write(DOWN + DOWN + DOWN) // Rotate
    await settle()
    app.stdin.write(ENTER)
    await until(() => app.frame().includes('Turn'))
    app.stdin.write(ENTER) // 90°
    await until(() => app.frame().includes('Rotate 90'))
    app.stdin.write(ENTER) // run
    await until(() => app.row('rotated 90°') >= 0)
    expect(app.row('Drop a file here')).toBeGreaterThanOrEqual(0)
    expect(app.row('saved to')).toBeGreaterThan(app.row('rotated 90°'))
    expect(app.row('ctrl-c quit')).toBe(ROWS - 1)
  }, 20_000)

  it('Save as, which fills 80 × 24: making a folder the default says so in one line, above the keys', async () => {
    const app = await shell(80)
    const jpg = await makeJpeg(app.dir, 'photo.jpg')
    app.stdin.write(jpg)
    await settle()
    app.stdin.write(ENTER)
    await until(() => /Format ╱╱\s*$/m.test(app.frame()))
    await settle()
    app.stdin.write(DOWN) // webp, which asks Quality
    await settle()
    app.stdin.write(ENTER)
    await until(() => /Quality ╱╱\s*$/m.test(app.frame()))
    await settle()
    app.stdin.write(ENTER)
    await until(() => /Save as ╱╱\s*$/m.test(app.frame()))
    await settle()
    app.stdin.write(DOWN)
    await settle()
    app.stdin.write(TAB)
    await until(() => app.row(/default output is now/i) >= 0)
    expect(app.row('Same location')).toBeGreaterThanOrEqual(0) // still choosing
    // On the screen, under its bar — not in the scrollback above it.
    expect(app.row(/default output is now/i)).toBeGreaterThan(app.row('Same location'))
    expect(app.row(/default output is now/i)).toBeLessThan(app.row('ctrl-c quit'))
    expect(app.row('ctrl-c quit')).toBe(ROWS - 1)
    // No rows to spare: the line takes the blank row over the rule, and
    // nothing is pushed off the top.
    expect(app.row('╭─ JPEG')).toBeGreaterThanOrEqual(0)
  }, 20_000)

  it('another screen: edit sent a PDF says why it is converting instead', async () => {
    const app = await shell()
    const file = await makePdf(app.dir, 'doc.pdf', 1)
    app.stdin.write('4') // edit
    await settle()
    app.stdin.write(file)
    await settle()
    app.stdin.write(ENTER)
    await until(() => app.row('Edit works on images') >= 0)
    // On the screen it went to, under its bar — not in the scrollback above it.
    expect(app.row('Edit works on images')).toBeGreaterThan(app.row(/╱╱\s*$/))
    expect(app.row('ctrl-c quit')).toBe(ROWS - 1)
  })
})
