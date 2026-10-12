import { describe, expect, it } from 'vitest'
import {
  formatOklch,
  formatRgb,
  fromLch,
  inGamut,
  oklabToRgb,
  parseHex,
  rgbToOklab,
  toHex,
  toLch,
} from '../../../src/core/colour/space.js'

describe('parseHex', () => {
  it('reads six and three digits, with or without #, any case, trimmed', () => {
    expect(parseHex('#6579FD')).toEqual({ r: 101, g: 121, b: 253 })
    expect(parseHex('6579fd')).toEqual({ r: 101, g: 121, b: 253 })
    expect(parseHex('  #6579FD  ')).toEqual({ r: 101, g: 121, b: 253 })
    expect(parseHex('#abc')).toEqual({ r: 170, g: 187, b: 204 })
  })

  it('refuses anything else', () => {
    for (const bad of ['', '#', '#GGGGGG', '#12345', '#1234567', 'rgb(1 2 3)', 'blue']) {
      expect(parseHex(bad), bad).toBeUndefined()
    }
  })
})

describe('OKLab', () => {
  it('matches the reference values', () => {
    const red = rgbToOklab({ r: 255, g: 0, b: 0 })
    expect(red.L).toBeCloseTo(0.628, 3)
    expect(red.a).toBeCloseTo(0.2249, 3)
    expect(red.b).toBeCloseTo(0.1258, 3)
    expect(rgbToOklab({ r: 255, g: 255, b: 255 }).L).toBeCloseTo(1, 4)
    expect(rgbToOklab({ r: 0, g: 0, b: 0 }).L).toBeCloseTo(0, 6)
  })

  it('round-trips every 17th sRGB colour exactly', () => {
    for (let r = 0; r < 256; r += 17)
      for (let g = 0; g < 256; g += 17)
        for (let b = 0; b < 256; b += 17) {
          expect(oklabToRgb(rgbToOklab({ r, g, b }))).toEqual({ r, g, b })
        }
  })

  it('knows the sRGB gamut', () => {
    expect(inGamut(rgbToOklab({ r: 0, g: 0, b: 255 }))).toBe(true)
    expect(inGamut(fromLch({ L: 0.5, C: 0.4, h: 140 }))).toBe(false)
  })

  it('LCh is LCh: hue in degrees, 0 to 360', () => {
    const blue = toLch(rgbToOklab({ r: 0, g: 0, b: 255 }))
    expect(blue.h).toBeCloseTo(264.1, 1)
    expect(blue.C).toBeCloseTo(0.3132, 3)
  })
})

describe('formatting', () => {
  it('writes hex, rgb and oklch the one way', () => {
    expect(toHex({ r: 101, g: 121, b: 253 })).toBe('#6579FD')
    expect(formatRgb({ r: 53, g: 103, b: 35 })).toBe('rgb(53 103 35)')
    expect(formatOklch({ r: 101, g: 121, b: 253 })).toBe('oklch(63% 0.196 273)')
  })

  it('gives a grey no hue: there is none to give', () => {
    expect(formatOklch({ r: 119, g: 119, b: 119 })).toBe('oklch(57% 0.000 0)')
    expect(formatOklch({ r: 255, g: 255, b: 255 })).toBe('oklch(100% 0.000 0)')
  })
})
