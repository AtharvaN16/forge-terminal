import { render } from 'ink-testing-library'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ColourFlow } from '../../src/shell/colour/ColourFlow.js'
import { ThemeProvider } from '../../src/shell/ThemeContext.js'
import { DARK, modePalette, NEUTRAL, type Palette } from '../../src/shell/theme.js'
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

function flow(palette: Palette, start: Parameters<typeof ColourFlow>[0]['start']) {
  return render(
    <ThemeProvider palette={modePalette(palette, 'colour')}>
      <ColourFlow start={start} width={80} height={24} onCancel={() => {}} />
    </ThemeProvider>,
  )
}

afterEach(() => {
  delete process.env.FORGE_TRUECOLOR
})

describe('without colour (NO_COLOR, the neutral palette)', () => {
  it('the palette is rows of hex and share, with no photo', async () => {
    const dir = await makeTempDir()
    const app = flow(NEUTRAL, { palette: await makeGradientPng(dir, 'g.png', 48) })
    await waitFor(() => /\d+%/.test(plain(app.lastFrame())))
    const rows = plain(app.lastFrame())
      .split('\n')
      .filter((l) => /#[0-9A-F]{6}\s+\d+%\s*$/.test(l))
    expect(rows.length).toBeGreaterThan(0)
    expect(plain(app.lastFrame())).not.toContain('▀')
    expect(plain(app.lastFrame())).not.toContain('█')
  })

  it('the scale is rows of step, hex and how text reads on it', async () => {
    const app = flow(NEUTRAL, { scale: { r: 101, g: 121, b: 253 } })
    await waitFor(() => plain(app.lastFrame()).includes('#6579FD'))
    expect(plain(app.lastFrame())).toContain(' 500  #6579FD  white 3.6 large · black 5.7 AA')
    expect(plain(app.lastFrame())).toContain('  50  #F4F6FF')
  })
})

describe('without true colour', () => {
  it('says the swatches are approximate', async () => {
    process.env.FORGE_TRUECOLOR = '0'
    const app = flow(DARK, { scale: { r: 101, g: 121, b: 253 } })
    await waitFor(() => plain(app.lastFrame()).includes('white text'))
    expect(plain(app.lastFrame())).toContain(
      'colours shown approximately · this terminal has 256 colours',
    )
  })

  it('and says nothing of the kind where it is true colour', async () => {
    process.env.FORGE_TRUECOLOR = '1'
    const app = flow(DARK, { scale: { r: 101, g: 121, b: 253 } })
    await waitFor(() => plain(app.lastFrame()).includes('white text'))
    expect(plain(app.lastFrame())).not.toContain('colours shown approximately')
  })
})
