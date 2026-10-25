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
    for (const ref of ['#808080', '#000000', '#FFFFFF', '#333333', '#C0C0C0']) {
      for (const x of scale(hex(ref))) {
        expect(x.rgb.r, `${ref} → ${x.hex}`).toBe(x.rgb.g)
        expect(x.rgb.g, `${ref} → ${x.hex}`).toBe(x.rgb.b)
      }
    }
  })

  it('pins other colours’ scales, unchanged by the grey fix', () => {
    const pinned: Record<string, string[]> = {
      '#F26E69': [
        '#FFF4F3',
        '#FFE2DF',
        '#FFCBC6',
        '#FFADA6',
        '#F98D86',
        '#F26E69',
        '#CF5B57',
        '#AE4845',
        '#8D3634',
        '#6E2423',
        '#501414',
      ],
      '#ACE02C': [
        '#F3FAE9',
        '#E9F7D4',
        '#DCF3B8',
        '#CCED95',
        '#BBE768',
        '#ACE02C',
        '#91BE18',
        '#779E04',
        '#5E7E01',
        '#475F03',
        '#304301',
      ],
      '#64748B': [
        '#F5F7FA',
        '#DFE4EA',
        '#C4CBD6',
        '#A4AEBD',
        '#828FA3',
        '#64748B',
        '#536176',
        '#434F61',
        '#343E4D',
        '#252E3A',
        '#171E28',
      ],
    }
    for (const [ref, hexes] of Object.entries(pinned)) {
      expect(
        scale(hex(ref)).map((x) => x.hex),
        ref,
      ).toEqual(hexes)
    }
  })

  it('a nearly grey colour keeps its tint on every step, never more than its own', () => {
    // Tailwind zinc and stone 500: under chroma 0.015, once flattened to grey.
    for (const ref of ['#71717A', '#78716C']) {
      const r = toLch(rgbToOklab(hex(ref)))
      const s = scale(hex(ref))
      const off = (x: Rgb) => Math.abs(((toLch(rgbToOklab(x)).h - r.h + 540) % 360) - 180)
      const s50 = s[0] as { rgb: Rgb; hex: string }
      const s950 = s[10] as { rgb: Rgb; hex: string }
      expect(toLch(rgbToOklab(s50.rgb)).C, `${ref} → ${s50.hex}`).toBeGreaterThan(0)
      expect(toLch(rgbToOklab(s950.rgb)).C, `${ref} → ${s950.hex}`).toBeGreaterThan(0.005)
      expect(off(s950.rgb), `${ref} → ${s950.hex}`).toBeLessThanOrEqual(3)
      // At 50 the chroma is about 0.001, one byte's worth, so the hue can
      // only lean the right way; the maths holds it before rounding.
      expect(off(s50.rgb), `${ref} → ${s50.hex}`).toBeLessThanOrEqual(45)
      for (const x of s) {
        expect(toLch(rgbToOklab(x.rgb)).C, `${ref} → ${x.hex}`).toBeLessThanOrEqual(r.C + 0.002)
      }
    }
    expect(scale(hex('#71717A')).map((x) => x.hex)).toEqual([
      '#F6F7F8',
      '#E3E3E5',
      '#CACACE',
      '#ACACB2',
      '#8D8D94',
      '#71717A',
      '#5F5F67',
      '#4D4D54',
      '#3C3C42',
      '#2C2C31',
      '#1D1D21',
    ])
    expect(scale(hex('#78716C')).map((x) => x.hex)).toEqual([
      '#F7F6F6',
      '#E5E3E1',
      '#CDCAC8',
      '#B1ACA9',
      '#938D88',
      '#78716C',
      '#655F5A',
      '#534D49',
      '#413C39',
      '#302C29',
      '#201D1B',
    ])
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

  it('a range that ends at 1000 darkens evenly: its last column drops as far as the ones before it (2026-10-25)', () => {
    const drops = (ref: string, spec: StepSpec) => {
      const s = scale(hex(ref), spec)
      return s.slice(1).map((x, i) => L((s[i] as { hex: string }).hex) - L(x.hex))
    }
    for (const ref of ['#4FA25A', '#3B82F6', '#808080', '#F26E69']) {
      for (const spec of [TW(100, 1000), TW(0, 1000), EVEN(0, 1000, 15), EVEN(0, 1000, 21)]) {
        // From the colour on down: the lights have their own ladder.
        const s = scale(hex(ref), spec)
        const dark = drops(ref, spec).slice(s.findIndex((x) => x.reference))
        const last = dark[dark.length - 1] as number
        const median = [...dark].sort((a, b) => a - b)[Math.floor(dark.length / 2)] as number
        expect(last, `${ref} ${spec.set} ${spec.start}–${spec.end}`).toBeLessThan(median * 1.3)
        expect(last, `${ref} ${spec.set} ${spec.start}–${spec.end}`).toBeGreaterThan(median * 0.7)
      }
    }
  })

  it('1000 is where the default’s 950 is, and the default and its 950 are as they were', () => {
    for (const ref of ['#6579FD', '#F26E69', '#808080']) {
      const end1000 = scale(hex(ref), TW(100, 1000))
      const dflt = scale(hex(ref), DEFAULT_STEPS)
      expect(end1000[end1000.length - 1]?.hex).toBe(dflt[dflt.length - 1]?.hex)
    }
    expect(scale(hex('#6579FD'), DEFAULT_STEPS)[10]?.hex).toBe('#161B58')
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
