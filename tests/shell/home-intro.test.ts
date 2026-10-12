import { describe, expect, it } from 'vitest'
import { brandIntro, brandRows, type Row } from '../../src/shell/home-art.js'
import { DARK } from '../../src/shell/theme.js'

/**
 * The launch (M8b, mockups/motion-2-2026-10.html): the FORGE band draws
 * itself in, left to right, behind a bright edge; letters appear as it
 * reaches them.
 */
const brand = brandRows({ width: 80, palette: DARK, mode: 'convert' })
const text = (row: Row | undefined) => (row ?? []).map((r) => r.text).join('')

describe('the band drawing itself in (M8b)', () => {
  it('is blank before it starts, and the band as it rests once it has run', () => {
    for (const row of brandIntro(brand, -1, DARK)) expect(text(row).trim()).toBe('')
    expect(brandIntro(brand, 200, DARK)).toEqual(brand)
  })

  it('has drawn what is left of its front and nothing past it', () => {
    const half = brandIntro(brand, 30, DARK)
    half.forEach((row, r) => {
      const full = text(brand[r])
      const drawn = text(row)
      expect(drawn).toHaveLength(full.length)
      // The front leans with the hatching: two columns further on each row down.
      const front = 30 - r * 2
      expect(drawn.slice(0, front + 1)).toBe(full.slice(0, front + 1))
      expect(drawn.slice(front + 1).trim()).toBe('')
    })
  })

  it('brightens the hatching just behind its front', () => {
    const cell = (rows: Row[], r: number, c: number) => {
      let at = 0
      for (const run of rows[r] ?? []) {
        if (c < at + [...run.text].length) return run
        at += [...run.text].length
      }
    }
    const lit = cell(brandIntro(brand, 40, DARK), 0, 40)
    const rest = cell(brand, 0, 40)
    expect(lit?.text).toContain('╱')
    expect(lit?.fg).not.toBe(rest?.fg)
  })
})
