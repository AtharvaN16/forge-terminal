import { render } from 'ink-testing-library'
import { describe, expect, it } from 'vitest'
import { DEFAULT_PREFERENCES } from '../../src/config/preferences.js'
import { App } from '../../src/shell/App.js'
import { MODE_ORDER, modeStep } from '../../src/shell/theme.js'
import { makeTempDir } from '../helpers/fixtures.js'

/**
 * ←→ on home step through the modes in tab order, wrapping at the ends, while
 * the field is empty (as 1–5 do). Colour's home uses ←→ for its two cards, so
 * there the arrows move between the cards first and leave colour past them
 * (decided 2026-10-13).
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

/** What each mode's home says, to tell them apart in plain text. */
const SAYS = {
  convert: 'images · HEIC · PDF · Word',
  compress: 'images · PDF',
  enhance: 'images · HEIC',
  colour: 'the colours of an image',
} as const

async function home() {
  const app = render(
    <App
      initialWidth={80}
      initialHeight={24}
      prefs={{ ...DEFAULT_PREFERENCES, theme: 'dark', defaultOutput: await makeTempDir() }}
    />,
  )
  await waitFor(() => plain(app.lastFrame()).includes(SAYS.convert))
  await settle()
  return app
}

describe('modeStep', () => {
  it('steps in tab order and wraps at both ends', () => {
    expect(modeStep('convert', 1)).toBe('compress')
    expect(modeStep(MODE_ORDER.at(-1) as (typeof MODE_ORDER)[number], 1)).toBe('convert')
    expect(modeStep('convert', -1)).toBe(MODE_ORDER.at(-1))
  })
})

describe('←→ on home', () => {
  it('→ goes to the next mode and ← back, while the field is empty', async () => {
    const app = await home()
    app.stdin.write(RIGHT)
    await waitFor(() => plain(app.lastFrame()).includes(SAYS.compress))
    app.stdin.write(LEFT)
    await waitFor(() => plain(app.lastFrame()).includes(SAYS.convert))
  }, 20_000)

  it('← on convert wraps to colour, landing on its right card', async () => {
    const app = await home()
    app.stdin.write(LEFT)
    await waitFor(() => plain(app.lastFrame()).includes(SAYS.colour))
    // Scale is chosen, so ← steps to Palette before it leaves colour.
    await settle()
    app.stdin.write(LEFT)
    await settle(300)
    expect(plain(app.lastFrame())).toContain(SAYS.colour)
    app.stdin.write(LEFT)
    // enhance's line is the start of convert's, so convert's tail must be gone.
    await waitFor(() => {
      const f = plain(app.lastFrame())
      return f.includes(SAYS.enhance) && !f.includes(SAYS.convert)
    })
  }, 20_000)

  it('→ past colour’s right card wraps to convert', async () => {
    const app = await home()
    app.stdin.write('5')
    await waitFor(() => plain(app.lastFrame()).includes(SAYS.colour))
    await settle()
    app.stdin.write(RIGHT)
    await settle(300)
    expect(plain(app.lastFrame())).toContain(SAYS.colour)
    app.stdin.write(RIGHT)
    await waitFor(() => plain(app.lastFrame()).includes(SAYS.convert))
  }, 20_000)

  it('moves the cursor instead once something is typed', async () => {
    const app = await home()
    app.stdin.write('ab')
    await settle()
    app.stdin.write(RIGHT)
    await settle(300)
    expect(plain(app.lastFrame())).toContain(SAYS.convert)
    expect(plain(app.lastFrame())).not.toContain(SAYS.compress)
  }, 20_000)

  it('says so on the key row', async () => {
    const app = await home()
    expect(plain(app.lastFrame()).split('\n').at(-1)).toMatch(/1–5 ←→ +mode/)
  }, 20_000)
})
