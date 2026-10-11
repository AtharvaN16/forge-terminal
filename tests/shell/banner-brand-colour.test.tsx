import { render } from 'ink-testing-library'
import { describe, expect, it, vi } from 'vitest'
import { Banner } from '../../src/shell/components/Banner.js'
import { ThemeProvider } from '../../src/shell/ThemeContext.js'
import { DARK, modePalette } from '../../src/shell/theme.js'

vi.hoisted(() => {
  process.env.FORCE_COLOR = '3'
  process.env.NO_COLOR = ''
})

const rgb = (hex: string) => {
  const n = Number.parseInt(hex.slice(1), 16)
  return `${(n >> 16) & 255};${(n >> 8) & 255};${n & 255}`
}

describe('the logo keeps the brand colour in every mode', () => {
  it('draws the wordmark edge in brand, not the mode colour', () => {
    const frame =
      render(
        <ThemeProvider palette={modePalette(DARK, 'compress')}>
          <Banner width={100} version="0.1.0" defaultOutput="~/Desktop" />
        </ThemeProvider>,
      ).lastFrame() ?? ''
    expect(frame).toContain(rgb(DARK.brand))
    expect(frame).not.toContain(rgb(DARK.modeCompress))
  })
})
