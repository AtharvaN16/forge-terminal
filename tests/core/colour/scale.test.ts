import { describe, expect, it } from 'vitest'
import {
  DEFAULT_STEPS,
  STEPS,
  type StepSpec,
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
  const TW = (start: number, end: number): StepSpec => ({ ...DEFAULT_STEPS, start, end })
  const EVEN = (start: number, end: number, count: number): StepSpec => ({
    set: 'even',
    start,
    end,
    count,
  })
  const RADIX: StepSpec = { ...DEFAULT_STEPS, set: 'radix' }
  const names = (spec: StepSpec) => scale(hex('#6579FD'), spec).map((s) => s.step)

  it('Tailwind: 50, 100 … 900, 950, its ends trimmed or extended in 50s', () => {
    expect(stepsOf(DEFAULT_STEPS)).toEqual([...STEPS])
    expect(stepsOf(TW(100, 900))).toEqual([100, 200, 300, 400, 500, 600, 700, 800, 900])
    expect(stepsOf(TW(0, 1000))).toEqual([0, 100, 200, 300, 400, 500, 600, 700, 800, 900, 1000])
  })

  it('Even: the count, spread from end to end, named by place to the 10, the colour always one', () => {
    expect(stepsOf(EVEN(0, 1000, 5))).toEqual([0, 250, 500, 750, 1000])
    expect(stepsOf(EVEN(0, 1000, 15))).toEqual([
      0, 70, 140, 210, 290, 360, 430, 500, 570, 640, 710, 790, 860, 930, 1000,
    ])
    expect(stepsOf(EVEN(0, 1000, 21))).toHaveLength(21)
    for (const count of [3, 4, 7, 12, 20, 21]) {
      for (const [start, end] of [
        [0, 1000],
        [100, 950],
        [450, 550],
        [0, 550],
      ] as const) {
        const s = scale(hex('#6579FD'), EVEN(start, end, count))
        expect(s, `${start}–${end} × ${count}`).toHaveLength(count)
        expect(s.filter((x) => x.reference)).toHaveLength(1)
        expect(new Set(s.map((x) => x.step)).size, `${start}–${end} × ${count}`).toBe(count)
      }
    }
  })

  it('Radix: twelve, numbered 1–12, the colour at 9', () => {
    const s = scale(hex('#6579FD'), RADIX)
    expect(s.map((x) => x.step)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])
    expect(s.find((x) => x.reference)?.step).toBe(9)
    expect(s.find((x) => x.step === 9)?.hex).toBe('#6579FD')
    expect(names(RADIX)).toHaveLength(12)
  })

  it('leaves the default scale exactly as it was, and Tailwind at 50 keeps today’s hexes', () => {
    for (const ref of ['#6579FD', '#343F96', '#F26E69', '#808080']) {
      expect(scale(hex(ref), DEFAULT_STEPS).map((s) => s.hex)).toEqual(
        scale(hex(ref)).map((s) => s.hex),
      )
    }
    const even11 = scale(hex('#6579FD'), EVEN(50, 950, 19))
    const byStep = new Map(even11.map((s) => [s.step, s.hex]))
    for (const s of scale(hex('#6579FD'))) expect(byStep.get(s.step)).toBe(s.hex)
  })

  it('never brightens, stays in sRGB, and keeps the reference exact, in every set', () => {
    for (const spec of [EVEN(0, 1000, 21), TW(0, 1000), RADIX]) {
      for (const ref of SWEEP_ALL) {
        const s = scale(hex(ref), spec)
        expect(s.find((x) => x.reference)?.hex).toBe(ref.toUpperCase())
        for (let i = 1; i < s.length; i++) {
          expect(inGamut(rgbToOklab((s[i] as { rgb: Rgb }).rgb))).toBe(true)
          expect(L((s[i] as { hex: string }).hex), `${ref} at ${s[i]?.step}`).toBeLessThanOrEqual(
            L((s[i - 1] as { hex: string }).hex) + 0.002,
          )
        }
      }
    }
  })

  it('a grey stays grey out to 0 and 1000', () => {
    for (const x of scale(hex('#808080'), EVEN(0, 1000, 11))) {
      expect(x.rgb.r).toBe(x.rgb.g)
      expect(x.rgb.g).toBe(x.rgb.b)
    }
  })

  it('says why a set of steps cannot be made', () => {
    expect(stepsProblem(DEFAULT_STEPS)).toBeUndefined()
    expect(stepsProblem(EVEN(0, 1000, 21))).toBeUndefined()
    expect(stepsProblem(RADIX)).toBeUndefined()
    expect(stepsProblem(TW(500, 950))).toMatch(/start/i)
    expect(stepsProblem(TW(50, 450))).toMatch(/end/i)
    expect(stepsProblem(TW(75, 950))).toMatch(/50/)
    expect(stepsProblem(EVEN(0, 1000, 2))).toMatch(/3 to 21/)
    expect(stepsProblem(EVEN(0, 1000, 22))).toMatch(/3 to 21/)
    expect(() => scale(hex('#6579FD'), EVEN(0, 1000, 40))).toThrow()
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
