import { describe, expect, it } from 'vitest'
import {
  HOME_MARGIN,
  RIPPLE,
  type Row,
  rippleLevel,
  surfaceRows,
} from '../../src/shell/home-art.js'
import { DARK, modePalette } from '../../src/shell/theme.js'

/**
 * The drop surface's ripple (M1, decided 2026-10-12 on
 * mockups/dots-motion-2026-10.html): from an empty surface a soft ring spreads
 * out from the words and the dots appear as it reaches them; the full field
 * rests, fades out together, stays empty a moment, and the ring comes again.
 */

const KINDS = 'images · HEIC · PDF · Word'
const surface = (ripple?: number) =>
  surfaceRows({
    width: 80,
    rows: 8,
    palette: modePalette(DARK, 'convert'),
    mode: 'convert',
    typing: false,
    kinds: KINDS,
    ...(ripple === undefined ? {} : { ripple }),
  })

/** Each row as its characters, inside the margin. */
const text = (rows: Row[]) =>
  rows.map((r) =>
    r
      .map((run) => run.text)
      .join('')
      .slice(HOME_MARGIN),
  )
/** The dots of the grid: the words' own `·` separators are not dots. */
const dots = (rows: Row[]) =>
  text(rows)
    .map((row) => row.replace(KINDS, ' '.repeat(KINDS.length)))
    .join('')
    .split('·').length - 1

describe('the drop surface’s ripple', () => {
  const still = surface()
  const all = dots(still)

  it('starts each loop from an empty surface, words and all kept', () => {
    const rows = surface(0)
    expect(dots(rows)).toBe(0)
    expect(text(rows).join('\n')).toContain('Drop a file here')
    expect(text(rows).join('\n')).toContain(KINDS)
  })

  it('has revealed every dot, exactly as the still surface draws them, once the ring has crossed', () => {
    expect(surface(RIPPLE.ring + RIPPLE.hold / 2)).toEqual(still)
  })

  it('reveals the dots outward from the words', () => {
    const counts = [0.15, 0.35, 0.6].map((k) => dots(surface(RIPPLE.ring * k)))
    expect(counts[0]).toBeGreaterThan(0)
    expect(counts[1]).toBeGreaterThan(counts[0] ?? 0)
    expect(counts[2]).toBeGreaterThan(counts[1] ?? 0)
    expect(counts[2]).toBeLessThanOrEqual(all)
  })

  it('is empty again in the gap before the next ring', () => {
    expect(dots(surface(RIPPLE.length - RIPPLE.gap / 2))).toBe(0)
  })

  it('loops: a moment one length later is the same moment', () => {
    const t = RIPPLE.ring * 0.4
    expect(surface(t + RIPPLE.length)).toEqual(surface(t))
  })

  it('spreads evenly either side of the words', () => {
    for (const k of [0.2, 0.4]) {
      const rows = text(surface(RIPPLE.ring * k)).map((row) =>
        row.replace(KINDS, ' '.repeat(KINDS.length)),
      )
      // The dot columns at 80 wide: every third, 3 to 72.
      const first = 3
      const last = 72
      for (const row of rows) {
        for (let c = first; c <= last; c += 3) {
          expect(row[c] === '·', `column ${c} mirrors ${first + last - c}`).toBe(
            row[first + last - c] === '·',
          )
        }
      }
    }
  })
})

describe('how far the ripple lifts a dot', () => {
  const reach = 60
  const moments = Array.from({ length: 200 }, (_, i) => (i / 200) * RIPPLE.length)

  it('never by more than 0.3, and never past the dot’s own colour', () => {
    for (const rest of [0.5, 0.7, 0.9]) {
      let top = 0
      for (const t of moments)
        for (let d = 0; d <= 40; d += 2) {
          const k = rippleLevel(t, d, rest, reach)
          expect(k).toBeGreaterThanOrEqual(0)
          expect(k).toBeLessThanOrEqual(Math.min(1, rest + 0.3) + 1e-9)
          top = Math.max(top, k)
        }
      // The brightest moment is just behind the ring's edge, once the dot has
      // faded in: a lift of about 0.2 — visible, and gentle.
      expect(top, `rest ${rest}`).toBeGreaterThanOrEqual(Math.min(1, rest + 0.15))
    }
  })

  it('leaves a dot the ring has not reached undrawn', () => {
    expect(rippleLevel(RIPPLE.ring * 0.1, 40, 0.5, reach)).toBe(0)
  })
})
