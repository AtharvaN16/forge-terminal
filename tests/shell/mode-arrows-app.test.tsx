import { render } from 'ink-testing-library'
import { describe, expect, it } from 'vitest'
import { DEFAULT_PREFERENCES } from '../../src/config/preferences.js'
import { App } from '../../src/shell/App.js'
import { tabStep } from '../../src/shell/theme.js'
import { makeTempDir } from '../helpers/fixtures.js'

/**
 * ←→ on home walk the tab row — the five modes, then "/ commands" — wrapping
 * at the ends, while nothing is typed (as 1–5 pick a mode). Colour's home uses
 * ←→ for its two cards, so there the arrows move between the cards first and
 * go on past them; on the commands tab they only switch while the field holds
 * the bare "/" (decided 2026-10-13).
 */
const ESC = String.fromCharCode(27)
const LEFT = `${ESC}[D`
const RIGHT = `${ESC}[C`
const SGR = new RegExp(`${ESC}\\[[0-9;]*m`, 'g')
const plain = (f: string | undefined) => (f ?? '').replace(SGR, '')
const settle = (ms = 200) => new Promise((r) => setTimeout(r, ms))

async function waitFor(ok: () => boolean, ms = 10_000) {
  const until = Date.now() + ms
  while (!ok()) {
    if (Date.now() > until) throw new Error('waitFor gave up')
    await settle(25)
  }
}

type Rendered = ReturnType<typeof render>
const frame = (app: Rendered) => plain(app.lastFrame())
/** Which tab the screen is on, told apart by what each one says. */
const on = {
  convert: (f: string) => f.includes('images · HEIC · PDF · Word') && !f.includes('modes ─'),
  compress: (f: string) => f.includes('images · PDF') && !f.includes('HEIC'),
  // enhance's line is the start of convert's, so convert's tail must be gone.
  enhance: (f: string) => f.includes('images · HEIC') && !f.includes('Word'),
  colour: (f: string) => f.includes('the colours of an image'),
  commands: (f: string) => f.includes('modes ─') && f.includes('/convert'),
}
const reach = (app: Rendered, tab: keyof typeof on) => waitFor(() => on[tab](frame(app)))

async function home() {
  const app = render(
    <App
      initialWidth={80}
      initialHeight={24}
      prefs={{ ...DEFAULT_PREFERENCES, theme: 'dark', defaultOutput: await makeTempDir() }}
    />,
  )
  await reach(app, 'convert')
  await settle()
  return app
}

describe('tabStep', () => {
  it('walks the modes, then commands, and wraps at both ends', () => {
    expect(tabStep('convert', 1)).toBe('compress')
    expect(tabStep('colour', 1)).toBe('commands')
    expect(tabStep('commands', 1)).toBe('convert')
    expect(tabStep('convert', -1)).toBe('commands')
    expect(tabStep('commands', -1)).toBe('colour')
  })
})

describe('←→ on home', () => {
  it('→ goes to the next mode and ← back, while the field is empty', async () => {
    const app = await home()
    app.stdin.write(RIGHT)
    await reach(app, 'compress')
    app.stdin.write(LEFT)
    await reach(app, 'convert')
  }, 20_000)

  it('← walks back through commands, colour’s two cards and on to enhance', async () => {
    const app = await home()
    app.stdin.write(LEFT)
    await reach(app, 'commands')
    await settle()
    app.stdin.write(LEFT)
    await reach(app, 'colour')
    // Arriving from the right lands on Scale: ← steps to Palette, then leaves.
    await settle()
    app.stdin.write(LEFT)
    await settle(300)
    expect(on.colour(frame(app))).toBe(true)
    app.stdin.write(LEFT)
    await reach(app, 'enhance')
  }, 20_000)

  it('→ past colour’s right card opens the commands, and → again wraps to convert', async () => {
    const app = await home()
    app.stdin.write('5')
    await reach(app, 'colour')
    await settle()
    app.stdin.write(RIGHT)
    await settle(300)
    expect(on.colour(frame(app))).toBe(true)
    app.stdin.write(RIGHT)
    await reach(app, 'commands')
    await settle()
    app.stdin.write(RIGHT)
    await reach(app, 'convert')
  }, 20_000)

  it('moves the cursor instead once something is typed, on a mode or on commands', async () => {
    const app = await home()
    app.stdin.write('ab')
    await settle()
    app.stdin.write(RIGHT)
    await settle(300)
    expect(on.convert(frame(app))).toBe(true)

    const filtered = await home()
    filtered.stdin.write('/co')
    await waitFor(() => frame(filtered).includes('/compress'))
    filtered.stdin.write(RIGHT)
    await settle(300)
    expect(frame(filtered)).toContain('/compress')
  }, 20_000)

  it('says so on the key row', async () => {
    const app = await home()
    expect(frame(app).split('\n').at(-1)).toMatch(/1–5 ←→ +mode/)
  }, 20_000)
})
