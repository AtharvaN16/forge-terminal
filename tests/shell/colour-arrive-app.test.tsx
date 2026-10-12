import { render } from 'ink-testing-library'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ColourFlow } from '../../src/shell/colour/ColourFlow.js'
import { setMotionForTests } from '../../src/shell/motion.js'
import { ThemeProvider } from '../../src/shell/ThemeContext.js'
import { DARK, modePalette } from '../../src/shell/theme.js'
import { makeGradientPng, makeTempDir } from '../helpers/fixtures.js'

vi.hoisted(() => {
  process.env.FORCE_COLOR = '3'
  process.env.NO_COLOR = ''
})

const SGR = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g')
const plain = (f: string | undefined) => (f ?? '').replace(SGR, '')
const settle = (ms: number) => new Promise((r) => setTimeout(r, ms))
async function waitFor(ok: () => boolean, ms = 10_000) {
  const start = Date.now()
  while (!ok() && Date.now() - start < ms) await settle(30)
}
/** Ink's truecolor ink for a hex colour. */
const ink = (hex: string) =>
  `38;2;${[1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16)).join(';')}m`
/** The rows of the list: each ends in its share. */
const listRows = (f: string | undefined) =>
  (f ?? '').split('\n').filter((l) => /\d+%\s*$/.test(plain(l)))

afterEach(() => {
  vi.useRealTimers()
  setMotionForTests(undefined)
})

describe('a palette coming in (M7)', () => {
  it('brings its colours up out of the background in turn, then rests', async () => {
    const dir = await makeTempDir()
    const png = await makeGradientPng(dir, 'g.png', 48)
    // The clock stands still once the palette is in, so the first frame of its arrival can be read.
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] })
    setMotionForTests(true)
    const app = render(
      <ThemeProvider palette={modePalette(DARK, 'colour')}>
        <ColourFlow start={{ palette: png }} width={80} height={24} onCancel={() => {}} />
      </ThemeProvider>,
    )
    await waitFor(() => listRows(app.lastFrame()).length > 1)
    const canvas = ink(DARK.canvas)
    const first = listRows(app.lastFrame())
    // Nothing has had time to come in: every share is still the background.
    for (const row of first) expect(row).toContain(canvas)
    vi.advanceTimersByTime(1000)
    await settle(60)
    // Ink spaces its redraws by the clock, which is held: let one more through.
    vi.advanceTimersByTime(100)
    await settle(60)
    const rest = listRows(app.lastFrame())
    expect(rest.map(plain)).toEqual(first.map(plain))
    expect(rest.join('\n')).not.toBe(first.join('\n'))
    app.unmount()
  }, 20_000)
})
