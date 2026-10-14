import { describe, expect, it } from 'vitest'
import { MIX_COUNTS, type MixSpace, mix, mixSteps } from '../../../src/core/colour/mix.js'
import {
  inGamut,
  parseHex,
  type Rgb,
  rgbToOklab,
  toHex,
  toLch,
} from '../../../src/core/colour/space.js'
import { ForgeError } from '../../../src/core/errors.js'

const hex = (h: string) => parseHex(h) as Rgb
const SPACES: MixSpace[] = ['oklab', 'oklch']
const PAIRS: [string, string][] = [
  ['#6579FD', '#F26E69'],
  ['#000000', '#FFFFFF'],
  ['#0000FF', '#FFFF00'],
  ['#808080', '#ACE02C'],
  ['#F4F6FF', '#070931'],
]

describe('mix', () => {
  it('returns each end exactly', () => {
    for (const space of SPACES) {
      for (const [a, b] of PAIRS) {
        expect(toHex(mix(hex(a), hex(b), 0, space))).toBe(a)
        expect(toHex(mix(hex(a), hex(b), 1, space))).toBe(b)
      }
    }
  })

  it('pins the midpoint of #6579FD and #F26E69 in each space', () => {
    expect(toHex(mix(hex('#6579FD'), hex('#F26E69'), 0.5, 'oklab'))).toBe('#B07EB9')
    expect(toHex(mix(hex('#6579FD'), hex('#F26E69'), 0.5, 'oklch'))).toBe('#CC64C9')
    expect(toHex(mix(hex('#000000'), hex('#FFFFFF'), 0.5, 'oklab'))).toBe('#636363')
  })

  it('OKLCH goes round the short way, and a grey end takes the other’s hue', () => {
    // Red (h ≈ 29) to magenta (h ≈ 328): the short way passes through pinks, not greens.
    const h = toLch(rgbToOklab(mix(hex('#FF0000'), hex('#FF00FF'), 0.5, 'oklch'))).h
    expect(h > 328 || h < 29).toBe(true)
    const ref = toLch(rgbToOklab(hex('#ACE02C'))).h
    for (const t of [0.25, 0.5, 0.75]) {
      const c = toLch(rgbToOklab(mix(hex('#808080'), hex('#ACE02C'), t, 'oklch')))
      expect(Math.abs(((c.h - ref + 540) % 360) - 180), `t ${t}`).toBeLessThanOrEqual(3)
    }
  })

  it('stays in sRGB', () => {
    for (const space of SPACES) {
      for (const [a, b] of [...PAIRS, ['#00FF00', '#FF00FF'] as [string, string]]) {
        for (let i = 0; i <= 20; i++) {
          expect(inGamut(rgbToOklab(mix(hex(a), hex(b), i / 20, space)))).toBe(true)
        }
      }
    }
  })
})

describe('mixSteps', () => {
  it('labels the steps by percentage, the two ends the references', () => {
    const s = mixSteps(hex('#6579FD'), hex('#F26E69'), 9, 'oklab')
    expect(s.map((x) => x.step)).toEqual([0, 13, 25, 38, 50, 63, 75, 88, 100])
    expect(s.map((x) => x.at)).toEqual([0, 0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875, 1])
    expect(s.filter((x) => x.reference).map((x) => x.step)).toEqual([0, 100])
    expect(s[0]?.hex).toBe('#6579FD')
    expect(s[8]?.hex).toBe('#F26E69')
    for (const x of s) expect(x.hex).toBe(toHex(x.rgb))
  })

  it('moves steadily from one end to the other', () => {
    for (const space of SPACES) {
      const ls = mixSteps(hex('#000000'), hex('#FFFFFF'), 11, space).map((x) => rgbToOklab(x.rgb).L)
      for (let i = 1; i < ls.length; i++) expect(ls[i]).toBeGreaterThan(ls[i - 1] as number)
      const as = mixSteps(hex('#6579FD'), hex('#F26E69'), 11, space).map((x) => x.rgb.r)
      for (let i = 1; i < as.length; i++) expect(as[i]).toBeGreaterThanOrEqual(as[i - 1] as number)
    }
  })

  it('has 3 to 21 steps, and refuses any other count', () => {
    expect(MIX_COUNTS).toEqual(Array.from({ length: 19 }, (_, i) => i + 3))
    for (const n of MIX_COUNTS)
      expect(mixSteps(hex('#6579FD'), hex('#F26E69'), n, 'oklch')).toHaveLength(n)
    for (const n of [0, 2, 22, 4.5, Number.NaN]) {
      expect(() => mixSteps(hex('#6579FD'), hex('#F26E69'), n, 'oklab'), `${n}`).toThrow(ForgeError)
    }
  })
})
