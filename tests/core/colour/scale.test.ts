import { describe, expect, it } from 'vitest'
import {
  DEFAULT_STEPS,
  STEPS,
  scale,
  stepsOf,
  stepsProblem,
} from '../../../src/core/colour/scale.js'
import { inGamut, parseHex, type Rgb, rgbToOklab, toLch } from '../../../src/core/colour/space.js'

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
    '#0A0A2A',
    '#00000A',
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

  it('a very dark reference still gets darker steps below it', () => {
    for (const ref of ['#0A0A2A', '#00000A', '#140000']) {
      const s = scale(hex(ref))
      expect(L((s[10] as { hex: string }).hex), ref).toBeLessThan(L(ref))
    }
  })

  it('a grey reference gives a grey scale', () => {
    for (const x of scale(hex('#808080'))) {
      expect(x.rgb.r).toBe(x.rgb.g)
      expect(x.rgb.g).toBe(x.rgb.b)
    }
  })
})

describe('scale with chosen steps', () => {
  it('lists the start, the end, and every multiple between, with 500 always one', () => {
    expect(stepsOf(DEFAULT_STEPS)).toEqual([...STEPS])
    expect(stepsOf({ start: 100, end: 900, every: 100 })).toEqual([
      100, 200, 300, 400, 500, 600, 700, 800, 900,
    ])
    expect(stepsOf({ start: 100, end: 900, every: 50 })).toHaveLength(17)
    expect(stepsOf({ start: 0, end: 1000, every: 50 })).toHaveLength(21)
    expect(stepsOf({ start: 50, end: 950, every: 250 })).toEqual([50, 250, 500, 750, 950])
  })

  it('leaves the default scale exactly as it was', () => {
    for (const ref of ['#6579FD', '#343F96', '#F26E69', '#808080']) {
      expect(scale(hex(ref), DEFAULT_STEPS)).toEqual(scale(hex(ref)))
    }
  })

  it('a step between two of the default ones sits between them, on the same curve', () => {
    const every50 = scale(hex('#6579FD'), { start: 50, end: 950, every: 50 })
    const byStep = new Map(every50.map((s) => [s.step, s.hex]))
    for (const s of scale(hex('#6579FD'))) expect(byStep.get(s.step)).toBe(s.hex)
    const l = (step: number) => L(byStep.get(step) as string)
    expect(l(150)).toBeLessThan(l(100))
    expect(l(150)).toBeGreaterThan(l(200))
  })

  it('0 to 1000 never brightens, stays in sRGB, and keeps the reference at 500', () => {
    for (const ref of SWEEP_ALL) {
      const s = scale(hex(ref), { start: 0, end: 1000, every: 50 })
      expect(s.find((x) => x.reference)?.step).toBe(500)
      expect(s.find((x) => x.step === 500)?.hex).toBe(ref.toUpperCase())
      for (let i = 1; i < s.length; i++) {
        expect(inGamut(rgbToOklab((s[i] as { rgb: Rgb }).rgb))).toBe(true)
        expect(L((s[i] as { hex: string }).hex), `${ref} at ${s[i]?.step}`).toBeLessThanOrEqual(
          L((s[i - 1] as { hex: string }).hex) + 0.002,
        )
      }
    }
  })

  it('a grey stays grey out to 0 and 1000', () => {
    for (const x of scale(hex('#808080'), { start: 0, end: 1000, every: 100 })) {
      expect(x.rgb.r).toBe(x.rgb.g)
      expect(x.rgb.g).toBe(x.rgb.b)
    }
  })

  it('says why a set of steps cannot be made', () => {
    expect(stepsProblem(DEFAULT_STEPS)).toBeUndefined()
    expect(stepsProblem({ start: 0, end: 1000, every: 50 })).toBeUndefined()
    expect(stepsProblem({ start: 500, end: 950, every: 100 })).toMatch(/start/i)
    expect(stepsProblem({ start: 50, end: 450, every: 100 })).toMatch(/end/i)
    expect(stepsProblem({ start: 75, end: 950, every: 100 })).toMatch(/50/)
    expect(stepsProblem({ start: 50, end: 950, every: 25 })).toMatch(/every/i)
    expect(() => scale(hex('#6579FD'), { start: 50, end: 950, every: 25 })).toThrow()
  })
})

const SWEEP_ALL = [
  '#6579FD',
  '#0A0A2A',
  '#00000A',
  '#FFFFFF',
  '#000000',
  '#808080',
  '#FFFF00',
  '#F26E69',
  '#F4F6FF',
  '#070931',
  '#71717A',
]
