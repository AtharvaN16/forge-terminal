import { describe, expect, it } from 'vitest'
import {
  NEUTRAL_L,
  neutral,
  neutralRef,
  TINTS,
  type Tint,
} from '../../../src/core/colour/neutral.js'
import { DEFAULT_STEPS, STEPS, type StepSpec } from '../../../src/core/colour/scale.js'
import { parseHex, type Rgb, rgbToOklab, toLch } from '../../../src/core/colour/space.js'

const hex = (h: string) => parseHex(h) as Rgb
const lch = (c: Rgb) => toLch(rgbToOklab(c))
const hueOff = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180)
const ALL: Tint[] = ['none', 'faint', 'soft', 'strong']

describe('neutral', () => {
  it('measures its tints against Tailwind’s greys', () => {
    expect(TINTS).toEqual({ none: 0, faint: 0.012, soft: 0.024, strong: 0.04 })
    expect(NEUTRAL_L).toBe(0.553)
  })

  it('soft from #6579FD lands on Tailwind gray’s 500', () => {
    const s = neutral(hex('#6579FD'), 'soft')
    expect(s.map((x) => x.step)).toEqual([...STEPS])
    const mid = s.find((x) => x.reference) as { step: number; rgb: Rgb; hex: string }
    expect(mid.step).toBe(500)
    const want = hex('#6D7281')
    for (const k of ['r', 'g', 'b'] as const) {
      expect(Math.abs(mid.rgb[k] - want[k]), mid.hex).toBeLessThanOrEqual(1)
    }
    expect(neutralRef(hex('#6579FD'), 'soft')).toEqual(mid.rgb)
  })

  it('none is pure grey on every step, whatever the colour', () => {
    for (const ref of ['#6579FD', '#F26E69', '#ACE02C', '#808080']) {
      for (const x of neutral(hex(ref), 'none')) {
        expect(x.rgb.r, `${ref} → ${x.hex}`).toBe(x.rgb.g)
        expect(x.rgb.g, `${ref} → ${x.hex}`).toBe(x.rgb.b)
      }
    }
  })

  it('sits its 500 at the neutral lightness and the colour’s hue', () => {
    for (const ref of ['#6579FD', '#F26E69', '#ACE02C', '#FFF5B0', '#343F96']) {
      const h = lch(hex(ref)).h
      for (const tint of ['soft', 'strong'] as const) {
        const mid = lch(neutralRef(hex(ref), tint))
        expect(Math.abs(mid.L - NEUTRAL_L), `${ref} ${tint}`).toBeLessThan(0.005)
        expect(Math.abs(mid.C - TINTS[tint]), `${ref} ${tint}`).toBeLessThan(0.003)
        expect(hueOff(mid.h, h), `${ref} ${tint}`).toBeLessThanOrEqual(5)
      }
      // The darker steps carry enough chroma to show the hue past rounding.
      for (const x of neutral(hex(ref), 'strong').slice(5)) {
        expect(hueOff(lch(x.rgb).h, h), `${ref} → ${x.hex}`).toBeLessThanOrEqual(5)
      }
    }
  })

  it('gets darker from first step to last, in every tint and set', () => {
    const specs: StepSpec[] = [
      DEFAULT_STEPS,
      { set: 'even', start: 0, end: 1000, count: 21 },
      { ...DEFAULT_STEPS, set: 'radix' },
    ]
    for (const spec of specs) {
      for (const tint of ALL) {
        for (const ref of ['#6579FD', '#F26E69', '#FFFF00', '#000000']) {
          const ls = neutral(hex(ref), tint, spec).map((x) => lch(x.rgb).L)
          for (let i = 1; i < ls.length; i++) {
            expect(ls[i], `${ref} ${tint} ${spec.set} #${i}`).toBeLessThan(ls[i - 1] as number)
          }
        }
      }
    }
  })
})
