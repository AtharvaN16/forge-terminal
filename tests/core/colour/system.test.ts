import { describe, expect, it } from 'vitest'
import { referenceIndex, type StepSpec, scale } from '../../../src/core/colour/scale.js'
import { parseHex, type Rgb, rgbToOklab, toLch } from '../../../src/core/colour/space.js'
import {
  isTweaked,
  MODE_NAMES,
  MODES,
  NO_TWEAK,
  system,
  type Tweak,
} from '../../../src/core/colour/system.js'

const hex = (h: string) => parseHex(h) as Rgb
const lch = (c: Rgb) => toLch(rgbToOklab(c))
const gap = (a: number, b: number) => ((a - b + 540) % 360) - 180
const CHERRY = hex('#D2042D')
const BLUE = hex('#6579FD')
const ref = <T extends { reference: boolean }>(steps: T[]) => steps.find((s) => s.reference) as T
const tweak = (t: Partial<Tweak>): Tweak => ({ ...NO_TWEAK, ...t })

describe('modes', () => {
  it('has the seven modes, each named', () => {
    expect(MODES).toEqual(['full', 'mono', 'analogous', 'opposite', 'split', 'triad', 'pastel'])
    expect(MODES.map((m) => MODE_NAMES[m])).toEqual([
      'Full set',
      'Monochromatic',
      'Analogous',
      'Complementary',
      'Split complementary',
      'Triadic',
      'Pastel',
    ])
  })
})

describe('system: full set', () => {
  const sys = system(CHERRY, 'full')

  it('is the eight families and a neutral', () => {
    expect(sys.rows.map((r) => r.name)).toEqual([
      'red',
      'orange',
      'yellow',
      'green',
      'teal',
      'blue',
      'purple',
      'pink',
    ])
    expect(sys.rows.length + 1).toBe(9)
    expect(sys.neutral).toHaveLength(11)
  })

  it("puts #D2042D in red's slot, exactly as scale() makes it", () => {
    const yours = sys.rows.filter((r) => r.yours)
    expect(yours.map((r) => r.name)).toEqual(['red'])
    expect(yours[0]?.steps).toEqual(scale(CHERRY))
  })

  it('gives the four roles', () => {
    expect(Object.fromEntries(sys.rows.filter((r) => r.role).map((r) => [r.name, r.role]))).toEqual(
      { red: 'danger', yellow: 'warning', green: 'success', blue: 'info' },
    )
  })

  it("puts a blue in blue's slot", () => {
    const yours = system(BLUE, 'full').rows.find((r) => r.yours)
    expect(yours?.name).toBe('blue')
  })

  it('pins the #D2042D full set', () => {
    expect(sys.rows.map((r) => ref(r.steps).hex)).toEqual(PINNED_500S)
    expect(sys.rows[5]?.steps.map((s) => s.hex)).toEqual(PINNED_BLUE)
    expect(sys.neutral.map((s) => s.hex)).toEqual(PINNED_NEUTRAL)
  })

  it('every row is a scale of its own 500', () => {
    for (const r of sys.rows) expect(r.steps).toEqual(scale(ref(r.steps).rgb))
  })

  it('keeps black and white from dividing by zero', () => {
    for (const c of ['#000000', '#FFFFFF', '#808080']) {
      for (const r of system(hex(c), 'full').rows)
        for (const s of r.steps) expect(s.hex).toMatch(/^#[0-9A-F]{6}$/)
    }
  })
})

describe('system: the neutral', () => {
  it('is L 0.553, C 0.024 at the colour’s hue', () => {
    const n = ref(system(BLUE, 'full').neutral)
    const c = lch(n.rgb)
    expect(c.L).toBeCloseTo(0.553, 2)
    expect(c.C).toBeCloseTo(0.024, 2)
    expect(Math.abs(gap(c.h, lch(BLUE).h))).toBeLessThan(4)
  })

  it('is the same in every mode', () => {
    const full = system(BLUE, 'full').neutral
    for (const m of MODES) expect(system(BLUE, m).neutral).toEqual(full)
  })
})

describe('system: harmonies', () => {
  it('has the right number of rows, yours first and exact', () => {
    const counts = { mono: 3, analogous: 3, opposite: 2, split: 3, triad: 3 } as const
    for (const [m, n] of Object.entries(counts)) {
      const sys = system(BLUE, m as keyof typeof counts)
      expect(sys.rows).toHaveLength(n)
      expect(sys.rows[0]?.yours).toBe(true)
      expect(sys.rows[0]?.steps).toEqual(scale(BLUE))
      expect(sys.rows.filter((r) => r.yours)).toHaveLength(1)
    }
  })

  it('puts each colour where the harmony says, round the wheel from yours', () => {
    const h0 = lch(BLUE).h
    const turns = { analogous: [-30, 30], opposite: [180], split: [150, 210], triad: [120, 240] }
    for (const [m, ts] of Object.entries(turns)) {
      const rows = system(BLUE, m as keyof typeof turns).rows.slice(1)
      const got = rows.map((r) => gap(lch(ref(r.steps).rgb).h, h0))
      ts.forEach((t, i) => {
        expect(Math.abs(gap(got[i] as number, t))).toBeLessThan(2)
      })
    }
  })

  it('names harmony rows by their family', () => {
    const rows = system(BLUE, 'opposite').rows
    expect(rows[0]?.name).toBe('blue')
    expect(['amber', 'yellow', 'orange']).toContain(rows[1]?.name)
  })

  it('mono is yours, a soft and a dusty one, same hue, less chroma', () => {
    const rows = system(CHERRY, 'mono').rows
    expect(rows.map((r) => r.name)).toEqual(['red', 'red soft', 'red dusty'])
    const [a, b, c] = rows.map((r) => lch(ref(r.steps).rgb)) as [
      ReturnType<typeof lch>,
      ReturnType<typeof lch>,
      ReturnType<typeof lch>,
    ]
    expect(b.C).toBeLessThan(a.C)
    expect(c.C).toBeLessThan(b.C)
    expect(Math.abs(gap(b.h, a.h))).toBeLessThan(3)
  })

  it('pastel is the full set made light and soft, yours included', () => {
    const rows = system(CHERRY, 'pastel').rows
    expect(rows.map((r) => r.name)).toEqual(system(CHERRY, 'full').rows.map((r) => r.name))
    expect(rows.find((r) => r.yours)?.name).toBe('red')
    for (const r of rows) {
      const c = lch(ref(r.steps).rgb)
      expect(c.L).toBeCloseTo(0.86, 1)
      // 0.1 × 0.85 at most, give or take 8-bit rounding.
      expect(c.C).toBeLessThan(0.088)
    }
  })
})

describe('system: tweaks', () => {
  it('NO_TWEAK is not a tweak and changes nothing', () => {
    expect(isTweaked(NO_TWEAK)).toBe(false)
    expect(isTweaked(tweak({ contrast: 5 }))).toBe(true)
    for (const m of MODES) expect(system(CHERRY, m, NO_TWEAK)).toEqual(system(CHERRY, m))
  })

  const reds = (t: Partial<Tweak>) => system(CHERRY, 'full', tweak(t))

  it('brightness: lighter 500s up, darker down, the neutral too', () => {
    const plain = reds({})
    for (const [k, more] of [
      [100, true],
      [-100, false],
    ] as const) {
      const sys = reds({ brightness: k })
      sys.rows.forEach((r, i) => {
        const was = lch(ref(plain.rows[i]?.steps ?? []).rgb).L
        const now = lch(ref(r.steps).rgb).L
        expect(now > was).toBe(more)
      })
      expect(lch(ref(sys.neutral).rgb).L > lch(ref(plain.neutral).rgb).L).toBe(more)
    }
    expect(lch(ref(reds({ brightness: 100 }).rows[0]?.steps ?? []).rgb).L).toBeCloseTo(0.98, 1)
  })

  it('saturation −100 is grey, +100 is more vivid', () => {
    const grey = reds({ saturation: -100 })
    for (const r of grey.rows) for (const s of r.steps) expect(lch(s.rgb).C).toBeLessThan(0.005)
    for (const s of grey.neutral) expect(lch(s.rgb).C).toBeLessThan(0.005)
    const plain = reds({})
    reds({ saturation: 100 }).rows.forEach((r, i) => {
      expect(lch(ref(r.steps).rgb).C).toBeGreaterThanOrEqual(
        lch(ref(plain.rows[i]?.steps ?? []).rgb).C - 0.005,
      )
    })
  })

  it('hue +180 turns every row half way round', () => {
    const plain = reds({})
    reds({ hue: 180 }).rows.forEach((r, i) => {
      const was = lch(ref(plain.rows[i]?.steps ?? []).rgb).h
      expect(Math.abs(gap(lch(ref(r.steps).rgb).h, was + 180))).toBeLessThan(3)
    })
  })

  it('contrast −100 draws every step to its reference', () => {
    const sys = reds({ contrast: -100 })
    for (const r of [...sys.rows.map((x) => x.steps), sys.neutral]) {
      const mid = lch(ref(r).rgb).L
      for (const s of r) expect(lch(s.rgb).L).toBeCloseTo(mid, 1)
    }
  })

  it('contrast +100 spreads the steps, clamped to 0.02 … 0.995', () => {
    const plain = reds({}).rows[0]?.steps ?? []
    const wide = reds({ contrast: 100 }).rows[0]?.steps ?? []
    expect(lch(wide[0]?.rgb as Rgb).L).toBeGreaterThanOrEqual(lch(plain[0]?.rgb as Rgb).L - 0.005)
    expect(lch(wide[10]?.rgb as Rgb).L).toBeLessThan(lch(plain[10]?.rgb as Rgb).L)
    expect(ref(wide)).toEqual(ref(plain))
  })

  it('moves your own row too, in every mode', () => {
    for (const m of MODES) {
      const plain = system(CHERRY, m).rows.find((r) => r.yours)
      const moved = system(CHERRY, m, tweak({ brightness: 40 })).rows.find((r) => r.yours)
      expect(ref(moved?.steps ?? []).hex).not.toBe(ref(plain?.steps ?? []).hex)
    }
  })
})

describe('system: chosen steps', () => {
  const radix: StepSpec = { set: 'radix', start: 50, end: 950, count: 11 }
  const even: StepSpec = { set: 'even', start: 100, end: 900, count: 7 }

  it('every row and the neutral have the spec’s steps, yours exact', () => {
    for (const spec of [radix, even]) {
      const sys = system(CHERRY, 'full', NO_TWEAK, spec)
      const n = scale(CHERRY, spec).length
      for (const r of sys.rows) expect(r.steps).toHaveLength(n)
      expect(sys.neutral).toHaveLength(n)
      expect(sys.rows[0]?.steps).toEqual(scale(CHERRY, spec))
      expect(sys.rows[0]?.steps[referenceIndex(spec)]?.hex).toBe('#D2042D')
    }
  })

  it('contrast holds the reference wherever the set puts it', () => {
    for (const spec of [radix, even]) {
      const sys = system(CHERRY, 'full', tweak({ contrast: -100 }), spec)
      const i = referenceIndex(spec)
      for (const r of sys.rows) {
        const mid = lch(r.steps[i]?.rgb as Rgb).L
        expect(r.steps[i]?.reference).toBe(true)
        for (const s of r.steps) expect(lch(s.rgb).L).toBeCloseTo(mid, 1)
      }
    }
  })

  it('pastel is spec-aware too', () => {
    const sys = system(CHERRY, 'pastel', NO_TWEAK, radix)
    for (const r of sys.rows) expect(lch(r.steps[8]?.rgb as Rgb).L).toBeCloseTo(0.86, 1)
  })
})

/** Each family's 500, red (yours) to pink, measured 2026-10-13. */
const PINNED_500S = [
  '#D2042D',
  '#D15205',
  '#C38F0C',
  '#06A338',
  '#089885',
  '#0065D9',
  '#9110E7',
  '#C72A7F',
]
const PINNED_BLUE = [
  '#F2F7FF',
  '#D2E4FE',
  '#A9CAFB',
  '#7AABF2',
  '#4687E5',
  '#0065D9',
  '#0155B8',
  '#004598',
  '#013579',
  '#00275C',
  '#001940',
]
const PINNED_NEUTRAL = [
  '#F9F6F6',
  '#E7E2E1',
  '#D1C8C8',
  '#B6AAA9',
  '#998988',
  '#806D6C',
  '#6C5B5A',
  '#594A49',
  '#463A39',
  '#342A29',
  '#231B1B',
]

describe('the neutral follows the hue tweak', () => {
  it('turns with the rest', () => {
    const base = { r: 0xd2, g: 0x04, b: 0x2d }
    const h0 = toLch(rgbToOklab((system(base, 'full').neutral[5] as { rgb: Rgb }).rgb)).h
    const h1 = toLch(rgbToOklab((system(base, 'full', { ...NO_TWEAK, hue: 90 }).neutral[5] as { rgb: Rgb }).rgb)).h
    const turned = ((h1 - h0 + 540) % 360) - 180
    expect(Math.abs(turned - 90)).toBeLessThan(6)
  })
})
