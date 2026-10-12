import { render } from 'ink-testing-library'
import { describe, expect, it, vi } from 'vitest'
import { ColourFlow } from '../../src/shell/colour/ColourFlow.js'
import { ThemeProvider } from '../../src/shell/ThemeContext.js'
import { DARK, modePalette } from '../../src/shell/theme.js'
import { makeGradientPng, makeTempDir } from '../helpers/fixtures.js'

vi.hoisted(() => {
  process.env.FORCE_COLOR = '3'
  process.env.NO_COLOR = ''
})

/** samplePixels, held back by `delay.ms` so the wait can be seen. */
const delay = vi.hoisted(() => ({ ms: 0 }))
vi.mock('../../src/engines/pixels.js', async (importActual) => {
  const real = await importActual<typeof import('../../src/engines/pixels.js')>()
  return {
    samplePixels: async (path: string) => {
      await new Promise((r) => setTimeout(r, delay.ms))
      return real.samplePixels(path)
    },
  }
})

const SGR = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g')
const plain = (f: string | undefined) => (f ?? '').replace(SGR, '')
const settle = (ms: number) => new Promise((r) => setTimeout(r, ms))
async function waitFor(ok: () => boolean, ms = 10_000) {
  const start = Date.now()
  while (!ok() && Date.now() - start < ms) await settle(30)
}

describe('cancelling an open', () => {
  it('esc while a dropped image is read: it never lands', async () => {
    delay.ms = 1200
    const dir = await makeTempDir()
    const png = await makeGradientPng(dir, 'g.png', 48)
    const app = render(
      <ThemeProvider palette={modePalette(DARK, 'colour')}>
        <ColourFlow start="palette" width={80} height={24} onCancel={() => {}} />
      </ThemeProvider>,
    )
    await settle(200)
    app.stdin.write(png)
    await settle(200)
    app.stdin.write(String.fromCharCode(27))
    await settle(2000)
    expect(plain(app.lastFrame())).not.toMatch(/\d+%/)
    expect(plain(app.lastFrame())).toContain('type an image path')
  }, 20_000)
})

describe('finding colours', () => {
  it('is not said at once; is said while a slow image is read; is gone when the palette is there', async () => {
    delay.ms = 2000
    const dir = await makeTempDir()
    const app = render(
      <ThemeProvider palette={modePalette(DARK, 'colour')}>
        <ColourFlow
          start={{ palette: await makeGradientPng(dir, 'g.png', 48) }}
          width={80}
          height={24}
          onCancel={() => {}}
        />
      </ThemeProvider>,
    )
    // The first frame comes before the 0.3 s wait can have passed.
    expect(plain(app.lastFrame())).not.toContain('Finding colours')
    await waitFor(() => plain(app.lastFrame()).includes('Finding colours'))
    expect(plain(app.lastFrame())).toContain('Finding colours')
    expect(plain(app.lastFrame())).not.toMatch(/\d+%/)
    await waitFor(() => /\d+%/.test(plain(app.lastFrame())))
    expect(plain(app.lastFrame())).not.toContain('Finding colours')
  }, 20_000)
})
