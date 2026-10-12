import { describe, expect, it } from 'vitest'
import {
  canOpen,
  inside,
  OUTSIDE,
  type Pixels,
  palette,
  photoMap,
  TRANSPARENT,
  wholePercents,
} from '../../../src/core/colour/palette.js'

/** w × h pixels, each from paint(x, y) → [r, g, b, a]. */
function pixels(w: number, h: number, paint: (x: number, y: number) => number[]): Pixels {
  const rgba = new Uint8Array(w * h * 4)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) rgba.set(paint(x, y), (y * w + x) * 4)
  return { width: w, height: h, rgba }
}

const quadrants = pixels(40, 40, (x, y) =>
  x < 20
    ? y < 20
      ? [230, 30, 30, 255]
      : [30, 160, 60, 255]
    : y < 20
      ? [40, 70, 220, 255]
      : [240, 200, 40, 255],
)

describe('palette', () => {
  it('finds the four colours of a quadrant image, a quarter each', () => {
    const g = palette(quadrants)
    expect(g.map((x) => x.hex).sort()).toEqual(['#1EA03C', '#2846DC', '#E61E1E', '#F0C828'])
    for (const x of g) expect(x.share).toBeCloseTo(0.25, 5)
  })

  it('one flat colour is one group', () => {
    const g = palette(pixels(30, 30, () => [10, 20, 30, 255]))
    expect(g).toHaveLength(1)
    expect(g[0]?.share).toBe(1)
  })

  it('a tiny image never yields NaN or empty groups', () => {
    for (const p of [
      pixels(1, 1, () => [1, 2, 3, 255]),
      pixels(3, 1, (x) => [x * 100, 0, 0, 255]),
    ]) {
      const g = palette(p)
      expect(g.length).toBeGreaterThan(0)
      expect(g.reduce((s, x) => s + x.share, 0)).toBeCloseTo(1, 9)
      for (const x of g) expect(x.members.length).toBeGreaterThan(0)
    }
  })

  it('leaves transparent pixels out; a fully transparent image has no palette', () => {
    const half = pixels(20, 20, (x) => (x < 10 ? [200, 0, 0, 255] : [0, 0, 200, 0]))
    expect(palette(half).map((x) => x.hex)).toEqual(['#C80000'])
    expect(palette(pixels(5, 5, () => [9, 9, 9, 0]))).toEqual([])
  })

  it('is deterministic', () => {
    const noisy = pixels(64, 64, (x, y) => [
      (x * 37 + y * 11) % 256,
      (x * 5) % 256,
      (y * 9) % 256,
      255,
    ])
    expect(palette(noisy).map((x) => x.hex)).toEqual(palette(noisy).map((x) => x.hex))
  })

  it('reports a colour that is really in the image', () => {
    const grad = pixels(64, 8, (x) => [x * 4, 100, 255 - x * 4, 255])
    const present = new Set<string>()
    for (let i = 0; i < grad.rgba.length; i += 4) {
      present.add([grad.rgba[i], grad.rgba[i + 1], grad.rgba[i + 2]].join())
    }
    for (const g of palette(grad)) {
      expect(present.has([g.rgb.r, g.rgb.g, g.rgb.b].join()), `${g.hex} is a pixel`).toBe(true)
    }
  })
})

describe('inside', () => {
  it('splits a group the palette merged back into its two colours', () => {
    // ΔE_OK between these two reds is 0.042: under the palette's 0.06 merge
    // (one colour at the top) and over the inside 0.03 (two shades within).
    const twoReds = pixels(40, 40, (x, y) =>
      x < 20 ? (y < 30 ? [230, 30, 30, 255] : [210, 25, 25, 255]) : [20, 20, 200, 255],
    )
    const top = palette(twoReds)
    expect(top).toHaveLength(2)
    const red = top.find((g) => g.rgb.r > 100) ?? expect.fail('no red group')
    const shades = inside(twoReds, red)
    expect(shades.map((s) => s.hex).sort()).toEqual(['#D21919', '#E61E1E'])
    expect(shades.reduce((s, x) => s + x.share, 0)).toBeCloseTo(1, 9)
    expect(canOpen(twoReds, red)).toBe(true)
  })

  it('a flat group cannot be opened', () => {
    const flat = pixels(20, 20, () => [5, 5, 5, 255])
    const only = palette(flat)[0] ?? expect.fail('no group')
    expect(canOpen(flat, only)).toBe(false)
  })
})

describe('wholePercents', () => {
  it('adds up to the rounded total by largest remainder', () => {
    expect(wholePercents([0.333, 0.333, 0.334])).toEqual([33, 33, 34])
    // floors 19 19 17 16 15 11 = 97; the three largest remainders (.9 .8 .7) get one each.
    expect(wholePercents([0.196, 0.19, 0.177, 0.169, 0.15, 0.118])).toEqual([
      19, 19, 18, 17, 15, 12,
    ])
    expect(wholePercents([1 / 3, 1 / 3, 1 / 3]).reduce((a, b) => a + b, 0)).toBe(100)
    expect(wholePercents([0.68, 0.126, 0.101, 0.093])).toEqual([68, 13, 10, 9])
  })
})

describe('photoMap', () => {
  it('keeps the aspect, at most 24 a side, transparent cells marked', () => {
    const wide = pixels(96, 48, (x) => (x < 48 ? [200, 0, 0, 255] : [0, 0, 200, 0]))
    const map = photoMap(wide, palette(wide))
    expect(map).toHaveLength(12)
    expect(map[0]).toHaveLength(24)
    expect(map[0]?.[0]).toBe(0)
    expect(map[0]?.[23]).toBe(TRANSPARENT)
  })

  it('cells outside the given groups are OUTSIDE', () => {
    const first = palette(quadrants)[0] ?? expect.fail('no group')
    const map = photoMap(quadrants, inside(quadrants, first))
    expect(map.flat().filter((c) => c === OUTSIDE).length).toBeGreaterThan(0)
    expect(map.flat().filter((c) => c >= 0).length).toBeGreaterThan(0)
  })
})
