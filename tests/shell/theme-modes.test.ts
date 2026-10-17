import { describe, expect, it } from 'vitest'
import { trueColour } from '../../src/shell/glyphs.js'
import { DARK, LIGHT, MODE_ORDER, modeColours, modeGradient } from '../../src/shell/theme.js'

const lin = (v: number) => {
  const c = v / 255
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}
const Y = (h: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => Number.parseInt(h.slice(i, i + 2), 16)) as [
    number,
    number,
    number,
  ]
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}
const contrast = (a: string, b: string) => {
  const [x, y] = [Y(a), Y(b)].sort((p, q) => q - p) as [number, number]
  return (x + 0.05) / (y + 0.05)
}

describe('colour is the fifth mode', () => {
  it('comes last, after edit', () => {
    expect(MODE_ORDER).toEqual(['convert', 'compress', 'pdf', 'edit', 'colour'])
  })

  it('has its own colour and fill', () => {
    expect(modeColours(DARK, 'colour')).toEqual({ fg: '#f27ba8', bg: '#3a1e2b' })
    expect(contrast(modeColours(LIGHT, 'colour').fg, '#ffffff')).toBeGreaterThanOrEqual(4.5)
  })

  it('hatches through a spectrum; the other modes keep their two stops', () => {
    expect(modeGradient(DARK, 'colour')).toEqual([
      '#f26e69',
      '#e5a23c',
      '#ace02c',
      '#55c7d9',
      '#6579fd',
      '#ad95e9',
    ])
    expect(modeGradient(DARK, 'convert')).toEqual([DARK.modeConvert, DARK.violet])
  })
})

describe('trueColour', () => {
  it('is on where the terminal says so, or is known to draw it', () => {
    expect(trueColour({ COLORTERM: 'truecolor' })).toBe(true)
    expect(trueColour({ COLORTERM: '24bit' })).toBe(true)
    expect(trueColour({ TERM_PROGRAM: 'iTerm.app' })).toBe(true)
    expect(trueColour({})).toBe(false)
  })

  it('is off under NO_COLOR, and FORGE_TRUECOLOR settles it', () => {
    expect(trueColour({ NO_COLOR: '1', COLORTERM: 'truecolor' })).toBe(false)
    expect(trueColour({ FORGE_TRUECOLOR: '0', COLORTERM: 'truecolor' })).toBe(false)
    expect(trueColour({ FORGE_TRUECOLOR: '1' })).toBe(true)
  })
})
