import { describe, expect, it } from 'vitest'
import { STEPS, scale } from '../../../src/core/colour/scale.js'
import { inGamut, parseHex, rgbToOklab, toLch } from '../../../src/core/colour/space.js'

const hex = (h: string) => parseHex(h) as NonNullable<ReturnType<typeof parseHex>>
const L = (h: string) => rgbToOklab(hex(h)).L

describe('scale', () => {
  it('pins the measured #6579FD scale, the reference exact at 500', () => {
    const s = scale(hex('#6579FD'))
    expect(s.map((x) => x.step)).toEqual([...STEPS])
    expect(s.map((x) => x.hex)).toEqual([
      '#F4F6FF',
      '#DFE6FE',
      '#C4D0FE',
      '#A3B6FF',
      '#8297FE',
      '#6579FD',
      '#5465DA',
      '#4351B7',
      '#343F96',
      '#252D76',
      '#161B58',
    ])
    expect(s.filter((x) => x.reference).map((x) => x.step)).toEqual([500])
  })

  it('pins #343F96 made the centre (the r key)', () => {
    expect(scale(hex('#343F96')).map((x) => x.hex)).toEqual([
      '#F4F6FF',
      '#D5DCF4',
      '#B0BAE1',
      '#8492CA',
      '#5867AF',
      '#343F96',
      '#2A3380',
      '#21286B',
      '#181D57',
      '#0F1344',
      '#070931',
    ])
  })

  const SWEEP = [
    '#FFFFFF',
    '#000000',
    '#808080',
    '#0000FF',
    '#00FF00',
    '#FF0000',
    '#FFFF00',
    '#00FFFF',
    '#FF00FF',
    '#E8B44C',
    '#F26E69',
    '#356723',
    '#F4F6FF',
    '#070931',
    '#7F7F80',
  ]

  it('never brightens from 50 to 950, for any reference', () => {
    for (const ref of SWEEP) {
      const ls = scale(hex(ref)).map((x) => L(x.hex))
      for (let i = 1; i < ls.length; i++) {
        expect(ls[i], `${ref} step ${STEPS[i]}`).toBeLessThanOrEqual((ls[i - 1] as number) + 0.002)
      }
    }
  })

  it('keeps every step in sRGB and the hue of the reference', () => {
    for (const ref of SWEEP) {
      const refLch = toLch(rgbToOklab(hex(ref)))
      for (const x of scale(hex(ref))) {
        expect(inGamut(rgbToOklab(x.rgb))).toBe(true)
        const lch = toLch(rgbToOklab(x.rgb))
        if (refLch.C >= 0.015 && lch.C >= 0.03) {
          const d = Math.abs(((lch.h - refLch.h + 540) % 360) - 180)
          expect(d, `${ref} → ${x.hex}`).toBeLessThanOrEqual(2)
        }
      }
    }
  })

  it('a grey reference gives a grey scale', () => {
    for (const x of scale(hex('#808080'))) {
      expect(x.rgb.r).toBe(x.rgb.g)
      expect(x.rgb.g).toBe(x.rgb.b)
    }
  })
})
