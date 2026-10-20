import { describe, expect, it } from 'vitest'
import { endsRow, sliderRow, titleRow } from '../../src/shell/quality-art.js'
import { DARK, LIGHT, modeColours } from '../../src/shell/theme.js'
import {
  type Cell,
  describeRow,
  type FixtureFrame,
  fixtureRow,
  loadFixture,
  runsRow,
  shifted,
} from './home-cells.js'

type QualityFrame = FixtureFrame & { q: number }
const G1 = loadFixture('quality-mockup.json') as QualityFrame[]
const text = (cells: Cell[]) => cells.map((c) => c.ch).join('')

// The kit draws step rows three cells in; the app draws them on its margin
// (two cells in, 2026-10-20), so each mockup row is held one cell to the left.
const onMargin = (cells: Cell[]) => shifted(cells, 1)

describe('the quality slider, against the decided G1, on the app’s margin (2026-10-20)', () => {
  for (const frame of G1) {
    it(`at ${frame.q}`, () => {
      const row = sliderRow({ palette: DARK, value: frame.q, min: 1, max: 100 })
      expect(describeRow(runsRow(row), onMargin(fixtureRow(frame, 1)))).toBe('equal')
    })
  }

  it('says which end is which under the band', () => {
    const frame = G1[0] as QualityFrame
    expect(describeRow(runsRow(endsRow({ palette: DARK })), onMargin(fixtureRow(frame, 2)))).toBe(
      'equal',
    )
  })

  it('titles the question in the mode’s colour, with what it is for at the right', () => {
    const frame = G1[0] as QualityFrame
    const row = titleRow({ palette: DARK, mode: 'convert', title: 'Quality', aside: 'JPEG' })
    expect(describeRow(runsRow(row), onMargin(fixtureRow(frame, 0)))).toBe('equal')
  })

  it('carries no mode colour in the slider', () => {
    const modes = (['convert', 'compress', 'pdf'] as const).map((m) => modeColours(DARK, m).fg)
    for (const value of [1, 40, 80, 100]) {
      const cells = runsRow(sliderRow({ palette: DARK, value, min: 1, max: 100 }))
      for (const cell of cells) {
        expect(modes).not.toContain(cell.fg)
        expect(modes).not.toContain(cell.bg)
      }
    }
  })

  it('draws in the theme’s slider colours, in light too', () => {
    const cells = runsRow(sliderRow({ palette: LIGHT, value: 50, min: 1, max: 100 }))
    expect(cells[2]?.bg).toBe(LIGHT.trackFill)
    expect(cells.find((c) => c.ch === '5')).toMatchObject({
      fg: LIGHT.ink,
      bg: LIGHT.thumb,
      b: true,
    })
    expect(cells[49]?.bg).toBe(LIGHT.track)
  })

  it('is 48 cells wide from column 3 (the margin) at every value', () => {
    for (let q = 1; q <= 100; q++) {
      const cells = runsRow(sliderRow({ palette: DARK, value: q, min: 1, max: 100 }))
      expect(cells.slice(0, 2).every((c) => c.bg === null)).toBe(true)
      expect(cells.slice(2, 50).every((c) => c.bg !== null)).toBe(true)
      expect(cells[50]?.bg).toBeNull()
    }
  })

  it('without fills (NO_COLOR, first run), still shows where the value is by shape', () => {
    const plain = { ...DARK, trackFill: '', track: '', thumb: '' }
    const row = text(runsRow(sliderRow({ palette: plain, value: 80, min: 1, max: 100 })))
    expect(row).toMatch(/^ {2}━+ 80 ─+ *$/)
    expect(row.trimEnd()).toHaveLength(50)
  })
})

describe('the three-point slider (A3·a, W1)', () => {
  const at = (value: number, palette = DARK) =>
    runsRow(
      sliderRow({ palette, value, min: 30, max: 100, marks: [30, 65, 100], warn: value === 30 }),
    )

  it('marks the other points with a dot in the middle of where their thumb would be', () => {
    const cells = at(65)
    expect(text(cells).trimEnd()).toBe(`    •${' '.repeat(19)} 65 ${' '.repeat(20)}•`)
    // Before the thumb a dot sits on the fill, after it on the track.
    expect(cells[4]).toMatchObject({ fg: DARK.track, bg: DARK.trackFill })
    expect(cells[48]).toMatchObject({ fg: DARK.trackFill, bg: DARK.track })
  })

  it('keeps the band 48 cells wide at every point', () => {
    for (const value of [30, 65, 100]) {
      const cells = at(value)
      expect(cells.slice(0, 2).every((c) => c.bg === null)).toBe(true)
      expect(cells.slice(2, 50).every((c) => c.bg !== null)).toBe(true)
      expect(cells[50]?.bg).toBeNull()
    }
  })

  it('turns orange at 30: the thumb, and the band in a dark orange tint, no word', () => {
    const cells = at(30)
    expect(cells.find((c) => c.ch === '3')).toMatchObject({
      fg: DARK.ink,
      bg: DARK.larger,
      b: true,
    })
    const rest = cells.slice(6, 50)
    expect(rest.every((c) => c.bg === DARK.defaultTagBg)).toBe(true)
    expect(rest.filter((c) => c.ch === '•').every((c) => c.fg === DARK.defaultTag)).toBe(true)
    expect(text(cells).trim()).toBe(`30${' '.repeat(21)}•${' '.repeat(21)}•`)
  })

  it('without fills, marks the points in the rule', () => {
    const plain = { ...DARK, trackFill: '', track: '', thumb: '' }
    const row = text(
      runsRow(sliderRow({ palette: plain, value: 65, min: 30, max: 100, marks: [30, 65, 100] })),
    )
    expect(row).toMatch(/^ {2}━━•━+ 65 ─+•─ *$/)
  })
})
