import { describe, expect, it } from 'vitest'
import { paletteColumn } from '../../src/shell/colour/colour-art.js'
import { mix, type Row } from '../../src/shell/home-art.js'
import { DARK, modePalette } from '../../src/shell/theme.js'

/**
 * The palette's colours arriving in turn (M7, mockups/motion-2-2026-10.html):
 * each row fades up out of the background, by its own amount.
 */
const P = modePalette(DARK, 'colour')
const ITEMS = [
  { hex: '#6579fd', pct: 30 },
  { hex: '#ad95e9', pct: 18 },
  { hex: '#f26e69', pct: 5 },
]
const column = (arrive?: number[]) =>
  paletteColumn({ palette: P, items: ITEMS, selected: 0, ...(arrive ? { arrive } : {}) })
/** The colours a row is drawn in, fills and inks, in order. */
const colours = (row: Row | undefined) => (row ?? []).flatMap((r) => [r.fg, r.bg]).filter(Boolean)

describe('the palette’s colours arriving (M7)', () => {
  it('draws a colour that has not arrived as the background, and one that has as it rests', () => {
    const rest = column()
    const rows = column([1, 0, 0.5])
    expect(rows[0]).toEqual(rest[0])
    // Spaced every other row: item 1 is row 2.
    for (const c of colours(rows[2])) expect(c).toBe(P.canvas.toLowerCase())
    const half = colours(rows[4])
    const full = colours(rest[4])
    expect(half).toEqual(full.map((c) => mix(P.canvas.toLowerCase(), c as string, 0.5)))
  })

  it('is the resting list when every colour has arrived', () => {
    expect(column([1, 1, 1])).toEqual(column())
  })
})
