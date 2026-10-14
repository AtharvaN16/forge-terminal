import { render } from 'ink-testing-library'
import stringWidth from 'string-width'
import { describe, expect, it, vi } from 'vitest'
import { ColourFlow } from '../../src/shell/colour/ColourFlow.js'
import { ThemeProvider } from '../../src/shell/ThemeContext.js'
import { DARK, modePalette } from '../../src/shell/theme.js'
import { makeGradientPng, makePdf, makeTempDir } from '../helpers/fixtures.js'

vi.hoisted(() => {
  process.env.FORCE_COLOR = '3'
  process.env.NO_COLOR = ''
  process.env.FORGE_TRUECOLOR = '1'
})

const clipboard = vi.hoisted(() => ({ text: '' }))
vi.mock('../../src/shell/clipboard.js', () => ({
  copy: (t: string) => {
    clipboard.text = t
  },
  paste: () => clipboard.text,
}))

const ESC = String.fromCharCode(27)
const ENTER = '\r'
const UP = `${ESC}[A`
const DOWN = `${ESC}[B`
const RIGHT = `${ESC}[C`
const settle = (ms = 150) => new Promise((r) => setTimeout(r, ms))
const SGR = new RegExp(`${ESC}\\[[0-9;]*m`, 'g')
const plain = (f: string | undefined) => (f ?? '').replace(SGR, '')

async function waitFor(ok: () => boolean, ms = 8000) {
  const start = Date.now()
  while (!ok() && Date.now() - start < ms) await settle(30)
}

function flow(start: Parameters<typeof ColourFlow>[0]['start'], height = 24) {
  const onCancel = vi.fn()
  const onTrail = vi.fn()
  const app = render(
    <ThemeProvider palette={modePalette(DARK, 'colour')}>
      <ColourFlow start={start} width={80} height={height} onCancel={onCancel} onTrail={onTrail} />
    </ThemeProvider>,
  )
  return { app, onCancel, onTrail }
}

function fits(frame: string | undefined) {
  for (const line of plain(frame).split('\n'))
    expect(stringWidth(line), line).toBeLessThanOrEqual(80)
}

describe('the palette', () => {
  it('opens an image: the colours with whole percentages adding to 100', async () => {
    const dir = await makeTempDir()
    const { app } = flow({ palette: await makeGradientPng(dir, 'g.png', 64) })
    await waitFor(() => /\d+%/.test(plain(app.lastFrame())))
    const pcts = [...plain(app.lastFrame()).matchAll(/ (\d+)%\s*$/gm)].map((m) => Number(m[1]))
    expect(pcts.length).toBeGreaterThan(0)
    expect(pcts.reduce((a, b) => a + b, 0)).toBe(100)
    expect(plain(app.lastFrame())).toContain('› g.png')
    fits(app.lastFrame())
  })

  it('↓ ↵ copies the chosen hex; c copies the card; s opens its scale; esc comes back, then leaves', async () => {
    const dir = await makeTempDir()
    const { app, onCancel } = flow({ palette: await makeGradientPng(dir, 'g.png', 64) })
    await waitFor(() => /\d+%/.test(plain(app.lastFrame())))
    app.stdin.write(DOWN)
    await settle()
    app.stdin.write(ENTER)
    await settle()
    expect(clipboard.text).toMatch(/^#[0-9A-F]{6}$/)
    expect(plain(app.lastFrame())).toContain(`✓ copied ${clipboard.text}`)
    app.stdin.write('c')
    await settle()
    expect(clipboard.text.startsWith('<svg')).toBe(true)
    app.stdin.write(UP)
    await settle()
    app.stdin.write('s')
    await waitFor(() => plain(app.lastFrame()).includes('white text'))
    expect(plain(app.lastFrame())).toMatch(/\b500\b/)
    fits(app.lastFrame())
    app.stdin.write(ESC)
    await waitFor(() => !plain(app.lastFrame()).includes('white text'))
    expect(plain(app.lastFrame())).toContain('› g.png')
    await settle() // two escapes in one burst read as one key
    app.stdin.write(ESC)
    await waitFor(() => onCancel.mock.calls.length > 0)
    expect(onCancel).toHaveBeenCalled()
  })

  it('a PDF dropped on the palette is refused on the line under the field, its text kept', async () => {
    const dir = await makeTempDir()
    const pdf = await makePdf(dir, 'report.pdf')
    const { app } = flow('palette')
    await settle()
    app.stdin.write(pdf)
    await waitFor(() => plain(app.lastFrame()).includes('not an image'))
    expect(plain(app.lastFrame())).toContain('report.pdf is a PDF, not an image.')
    expect(plain(app.lastFrame())).toContain('report.pdf')
  })

  it('a mouse click or scroll on the palette changes nothing', async () => {
    const dir = await makeTempDir()
    const { app } = flow({ palette: await makeGradientPng(dir, 'g.png', 64) })
    await waitFor(() => /\d+%/.test(plain(app.lastFrame())))
    app.stdin.write(`${ESC}[<0;10;5M`)
    await settle(300)
    app.stdin.write(`${ESC}[<65;10;5M`)
    await settle(300)
    expect(plain(app.lastFrame())).toContain('› g.png')
    expect(plain(app.lastFrame())).not.toContain('could not be found')
  })

  it('drops the photo, not the list, on a short terminal', async () => {
    const dir = await makeTempDir()
    const { app } = flow({ palette: await makeGradientPng(dir, 'g.png', 64) }, 18)
    await waitFor(() => /\d+%/.test(plain(app.lastFrame())))
    expect(plain(app.lastFrame())).not.toContain('▀')
    expect(plain(app.lastFrame())).toMatch(/#[0-9A-F]{6}/)
  })
})

describe('the scale', () => {
  it('empty: a hint; a typed hex draws the ramp; r recentres', async () => {
    const { app, onTrail } = flow('scale')
    await settle()
    expect(plain(app.lastFrame())).toContain('type a hex, rgb(), hsl(), oklch() or a colour name')
    app.stdin.write('#6579FD')
    await waitFor(() => plain(app.lastFrame()).includes('white text'))
    app.stdin.write(ENTER)
    await settle()
    app.stdin.write(RIGHT)
    await settle()
    app.stdin.write(RIGHT)
    await settle()
    app.stdin.write('r')
    await waitFor(() => plain(app.lastFrame()).includes('was 700 of #6579FD'))
    expect(plain(app.lastFrame())).toContain('is now 500')
    expect(onTrail).toHaveBeenLastCalledWith({ answers: ['#6579FD'], current: 'Scale' })
    fits(app.lastFrame())
  })
})
