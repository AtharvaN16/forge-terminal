import { describe, expect, it } from 'vitest'
import { stagedCardRows } from '../../src/shell/home-art.js'
import { DARK, modeColours, modePalette } from '../../src/shell/theme.js'

/**
 * A file landing on home (M2a, mockups/motion-2-2026-10.html): one ring in
 * the mode's colour runs out through the card's stepped-back dots, once.
 */
const P = modePalette(DARK, 'convert')
const FILE = { name: 'Id card.png', tag: 'PNG', size: '1.9 MB', facts: '2480×1748 · 1.9 MB' }
const card = (ring?: number) =>
  stagedCardRows({
    width: 80,
    rows: 8,
    palette: P,
    mode: 'convert',
    file: FILE,
    ...(ring === undefined ? {} : { ring }),
  })

/** Every dot on the panel, with its column, row and colour. */
const dotsOf = (rows: ReturnType<typeof card>) =>
  rows.flatMap((row, r) => {
    let c = 0
    return row.flatMap((run) => {
      const out = [...run.text].flatMap((ch, i) =>
        ch === '·' ? [{ c: c + i, r, fg: run.fg }] : [],
      )
      c += [...run.text].length
      return out
    })
  })

describe('the drop ring on the staged card (M2a)', () => {
  it('lights the dots the ring is passing in the mode’s colour, and only those', () => {
    const rest = dotsOf(card())
    const mid = dotsOf(card(0.4))
    expect(mid.map(({ c, r }) => [c, r])).toEqual(rest.map(({ c, r }) => [c, r]))
    const lit = mid.filter((d, i) => d.fg !== rest[i]?.fg)
    expect(lit.length).toBeGreaterThan(4)
    expect(lit.length).toBeLessThan(rest.length)
    // Lit dots lean to the mode's colour: nearer it than the dot at rest.
    const accent = modeColours(P, 'convert').fg
    const dist = (a = '', b = '') =>
      [1, 3, 5].reduce(
        (n, i) =>
          n +
          Math.abs(Number.parseInt(a.slice(i, i + 2), 16) - Number.parseInt(b.slice(i, i + 2), 16)),
        0,
      )
    for (const d of lit) {
      const before = rest.find((x) => x.c === d.c && x.r === d.r)
      expect(dist(d.fg, accent)).toBeLessThan(dist(before?.fg, accent))
    }
  })

  it('is the card at rest before it starts and once it has run', () => {
    expect(card(1)).toEqual(card())
  })
})
