import { render } from 'ink-testing-library'
import { describe, expect, it, vi } from 'vitest'
import { ModeHeader } from '../../src/shell/components/ModeHeader.js'
import { ThemeProvider } from '../../src/shell/ThemeContext.js'
import { DARK } from '../../src/shell/theme.js'

vi.hoisted(() => {
  process.env.FORCE_COLOR = '3'
  process.env.NO_COLOR = ''
})

const frame = (mode: 'convert' | 'compress' | 'pdf', width = 60) =>
  render(
    <ThemeProvider palette={DARK}>
      <ModeHeader
        mode={mode}
        title={mode === 'pdf' ? 'PDF operations' : `current mode: ${mode}`}
        width={width}
      />
    </ThemeProvider>,
  ).lastFrame() ?? ''

const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*[A-Za-z]`, 'g')

const rgb = (hex: string) => {
  const n = Number.parseInt(hex.slice(1), 16)
  return `${(n >> 16) & 255};${(n >> 8) & 255};${n & 255}`
}

describe('mode header', () => {
  it('uses distinct border styles and markers for each mode', () => {
    const convert = frame('convert')
    const compress = frame('compress')
    const pdf = frame('pdf')

    expect(convert).toContain('↔ current mode: convert')
    expect(convert).toContain('┌')
    expect(convert).toContain('┐')
    expect(compress).toContain('↓ current mode: compress')
    expect(compress).toContain('╭')
    expect(compress).toContain('╮')
    expect(pdf).toContain('▣ PDF operations')
    expect(pdf).toContain('╔')
    expect(pdf).toContain('╗')
  })

  it('uses a different semantic color for every mode', () => {
    const convert = frame('convert')
    const compress = frame('compress')
    const pdf = frame('pdf')

    expect(convert).toContain(rgb(DARK.modeConvert))
    expect(compress).toContain(rgb(DARK.modeCompress))
    expect(pdf).toContain(rgb(DARK.modePdf))
    expect(convert).not.toContain(rgb(DARK.modeCompress))
    expect(compress).not.toContain(rgb(DARK.modePdf))
    expect(pdf).not.toContain(rgb(DARK.modeConvert))
  })

  it('keeps the header within the requested terminal width', () => {
    for (const width of [20, 40, 60, 100]) {
      for (const mode of ['convert', 'compress', 'pdf'] as const) {
        for (const line of frame(mode, width).split('\n')) {
          expect(line.replace(ANSI, '').length).toBeLessThanOrEqual(width)
        }
      }
    }
  })
})
