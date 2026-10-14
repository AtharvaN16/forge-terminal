import { describe, expect, it } from 'vitest'
import { alphaOf, BLACK, composite, WHITE } from '../../../src/core/colour/alpha.js'
import { DEFAULT_STEPS, scale } from '../../../src/core/colour/scale.js'
import { parseHex, type Rgb } from '../../../src/core/colour/space.js'

const hex = (h: string) => parseHex(h) as Rgb
const off = (a: Rgb, b: Rgb) =>
  Math.max(Math.abs(a.r - b.r), Math.abs(a.g - b.g), Math.abs(a.b - b.b))

/** A small seeded generator, so the random colours are the same every run. */
function lcg(seed: number): () => number {
  let s = seed
  return () => {
    s = (s * 1664525 + 1013904223) % 2 ** 32
    return s / 2 ** 32
  }
}

describe('alphaOf', () => {
  const targets: Rgb[] = []
  for (const ref of ['#6579FD', '#F26E69', '#ACE02C', '#71717A', '#000000', '#FFFFFF', '#343F96']) {
    for (const spec of [DEFAULT_STEPS, { ...DEFAULT_STEPS, set: 'radix' as const }]) {
      for (const s of scale(hex(ref), spec)) targets.push(s.rgb)
    }
  }
  const rand = lcg(7)
  for (let i = 0; i < 500; i++) {
    targets.push({
      r: Math.floor(rand() * 256),
      g: Math.floor(rand() * 256),
      b: Math.floor(rand() * 256),
    })
  }

  it('composites back to the target within 1 per channel, over white and over black', () => {
    for (const bg of [WHITE, BLACK, hex('#808080'), hex('#111111')]) {
      for (const t of targets) {
        const x = alphaOf(t, bg)
        expect(
          off(composite(x, bg), t),
          `${JSON.stringify(t)} over ${JSON.stringify(bg)}`,
        ).toBeLessThanOrEqual(1)
        expect(x.a).toBeGreaterThan(0)
        expect(x.a).toBeLessThanOrEqual(1)
        expect(Number.isInteger(Math.round(x.a * 255 * 1e9) / 1e9)).toBe(true)
      }
    }
  })

  it('is as see-through as reaching the target exactly allows', () => {
    // The least opacity at which every channel can reach the target before
    // rounding; a byte less leaves some channel short however far it is pushed.
    for (const bg of [WHITE, BLACK]) {
      for (const t of targets) {
        const A = Math.round(alphaOf(t, bg).a * 255)
        if (A <= 1) continue
        const need = Math.max(
          ...(['r', 'g', 'b'] as const).map((k) => {
            const d = t[k] - bg[k]
            return d > 0 ? d / (255 - bg[k]) : d < 0 ? -d / bg[k] : 0
          }),
        )
        expect((A - 1) / 255, JSON.stringify(t)).toBeLessThan(need)
      }
    }
  })

  it('writes #RRGGBBAA in capitals, and the opacity as a whole percentage', () => {
    const x = alphaOf(hex('#6579FD'), WHITE)
    expect(x.hex8).toMatch(/^#[0-9A-F]{8}$/)
    expect(Number.parseInt(x.hex8.slice(7), 16)).toBe(Math.round(x.a * 255))
    expect(x.hex8.slice(0, 7)).toBe(
      `#${[x.rgb.r, x.rgb.g, x.rgb.b].map((v) => v.toString(16).padStart(2, '0').toUpperCase()).join('')}`,
    )
    expect(x.pct).toBe(Math.round(x.a * 100))
  })

  it('makes #6579FD’s 50 about 4% over white, and a light step nearly solid over black', () => {
    const s = scale(hex('#6579FD'))
    const light = alphaOf((s[0] as { rgb: Rgb }).rgb, WHITE)
    expect(light.pct).toBeGreaterThanOrEqual(3)
    expect(light.pct).toBeLessThanOrEqual(5)
    expect(light.hex8).toBe('#002EFF0B')
    const solid = alphaOf((s[0] as { rgb: Rgb }).rgb, BLACK)
    expect(solid.pct).toBeGreaterThanOrEqual(99)
  })

  it('gives the background itself at the least opacity a byte can hold', () => {
    // Nothing to add, but no alpha is zero: a = 1/255 of the background's own colour.
    for (const bg of [WHITE, BLACK, hex('#6579FD')]) {
      const x = alphaOf(bg, bg)
      expect(x.a).toBe(1 / 255)
      expect(x.rgb).toEqual(bg)
      expect(x.pct).toBe(0)
      expect(composite(x, bg)).toEqual(bg)
    }
  })

  it('composite rounds each channel of a over b', () => {
    expect(composite({ rgb: { r: 255, g: 0, b: 100 }, a: 0.5, hex8: '', pct: 50 }, BLACK)).toEqual({
      r: 128,
      g: 0,
      b: 50,
    })
    expect(composite({ rgb: BLACK, a: 1, hex8: '', pct: 100 }, WHITE)).toEqual(BLACK)
  })
})
