import { describe, expect, it } from 'vitest'
import { largestBox, zoomedBox } from '../../src/core/crop.js'
import {
  cropFactsRows,
  cropKeys,
  cropPictureRows,
  cropPictureSize,
  cropPositionRow,
  cropStep,
  dotBoxOf,
} from '../../src/shell/crop-art.js'
import { mix } from '../../src/shell/home-art.js'
import { DARK, LIGHT, modePalette } from '../../src/shell/theme.js'

/**
 * The crop preview (P3, mockups/crop-2026-10.html, drawn there by
 * scripts/crop-mockup.ts `picture()`): what is cut is ╱ over its own colour
 * faded towards the canvas; inside, the photo's own colours.
 */
const P = modePalette(DARK, 'enhance')
const L = modePalette(LIGHT, 'enhance')

/** 4 × 2 dots (one row of cells): every dot its own colour. */
const COLOURS = [
  '#ff0000',
  '#00ff00',
  '#0000ff',
  '#ffff00',
  '#00ffff',
  '#ff00ff',
  '#808080',
  '#ffffff',
]
const dots = {
  cols: 4,
  dotRows: 2,
  rgb: new Uint8Array(
    COLOURS.flatMap((c) => [1, 3, 5].map((i) => Number.parseInt(c.slice(i, i + 2), 16))),
  ),
}
const top = (x: number) => COLOURS[x] as string
const bottom = (x: number) => COLOURS[4 + x] as string

/** One cell per entry: glyph, fg, bg. */
const cellsOf = (row: { text: string; fg?: string; bg?: string }[]) =>
  row.flatMap((r) => [...r.text].map((ch) => ({ ch, fg: r.fg, bg: r.bg })))

describe('the crop picture (P3)', () => {
  it('hatches a cell wholly outside: ╱, its dots faded 72 % to the canvas, the line half way to border', () => {
    const [row] = cropPictureRows({ palette: P, dots, box: { x: 1, y: 0, w: 2, h: 2 } })
    const cells = cellsOf(row ?? [])
    const faded = (c: string) => mix(c, P.canvas, 0.72)
    expect(cells[0]).toEqual({
      ch: '╱',
      fg: mix(faded(top(0)), P.border, 0.5),
      bg: mix(faded(top(0)), faded(bottom(0)), 0.5),
    })
    expect(cells[3]?.ch).toBe('╱')
    // Inside: the photo's own two dots.
    expect(cells[1]).toEqual({ ch: '▀', fg: top(1), bg: bottom(1) })
    expect(cells[2]).toEqual({ ch: '▀', fg: top(2), bg: bottom(2) })
  })

  it('fades 70 % in light', () => {
    const [row] = cropPictureRows({ palette: L, dots, box: { x: 1, y: 0, w: 3, h: 2 } })
    const faded = (c: string) => mix(c, L.canvas, 0.7)
    expect(cellsOf(row ?? [])[0]?.bg).toBe(mix(faded(top(0)), faded(bottom(0)), 0.5))
  })

  it('keeps ▀ on a cell half inside, fading only its outside dot', () => {
    // The crop takes the bottom dot of the row only.
    const [row] = cropPictureRows({ palette: P, dots, box: { x: 0, y: 1, w: 4, h: 1 } })
    const cells = cellsOf(row ?? [])
    expect(cells[2]).toEqual({ ch: '▀', fg: mix(top(2), P.canvas, 0.72), bg: bottom(2) })
  })

  it('draws a run of cells in one colour as one run', () => {
    const flat = { cols: 4, dotRows: 2, rgb: new Uint8Array(4 * 2 * 3).fill(200) }
    const [row] = cropPictureRows({ palette: P, dots: flat, box: { x: 0, y: 0, w: 4, h: 2 } })
    expect(row).toHaveLength(1)
    expect(row?.[0]?.text).toBe('▀▀▀▀')
  })
})

describe('the crop’s place in dots, and one step', () => {
  const size = { width: 1200, height: 600 }
  it('maps the pixel box onto the drawn picture’s dots', () => {
    expect(
      dotBoxOf(size, { left: 300, top: 0, width: 600, height: 600 }, { cols: 40, dotRows: 20 }),
    ).toEqual({ x: 10, y: 0, w: 20, h: 20 })
  })

  it('moves one dot of the picture a press, at least a pixel', () => {
    expect(cropStep(size, { cols: 40, dotRows: 20 })).toEqual({ x: 30, y: 30 })
    expect(cropStep({ width: 10, height: 10 }, { cols: 40, dotRows: 40 })).toEqual({ x: 1, y: 1 })
  })

  it('fits the picture under the title with square dots, leaving a 26-column facts column', () => {
    // 11 rows: 22 dots tall, so a 2:1 photo is 44 dots wide.
    expect(cropPictureSize(size, 11, 80)).toEqual({ cols: 44, rows: 11 })
    // 60 columns leave 60 - 3 - 4 - 26 = 27 for the picture: it shrinks, still 2:1.
    expect(cropPictureSize(size, 11, 60)).toEqual({ cols: 24, rows: 6 })
    expect(cropPictureSize(size, 0, 80)).toBeUndefined()
  })
})

describe('the facts and the key row', () => {
  const size = { width: 1200, height: 600 }
  const guess = largestBox(size, { w: 1, h: 1 })

  it('says the size bold, the shape dim, then how much of the photo is kept', () => {
    const rows = cropFactsRows({ palette: P, box: guess, size, label: '1:1' })
    expect(rows.map((r) => r.map((run) => run.text).join(''))).toEqual([
      '600 × 600 · 1:1',
      'keeps 50 % of the photo',
    ])
    expect(rows[0]?.[0]).toMatchObject({ text: '600 × 600', fg: P.fg, bold: true })
    expect(rows[0]?.[1]).toMatchObject({ fg: P.dim })
    expect(rows[1]?.[0]).toMatchObject({ fg: P.dim })
  })

  it('offers only the arrows that move it: one pair at the largest, all four once zoomed', () => {
    expect(cropKeys({ size, box: guess, changed: false })).toEqual([
      ['←→', 'move'],
      ['+−', 'zoom'],
      ['↵', 'confirm'],
    ])
    const tall = largestBox({ width: 600, height: 1200 }, { w: 1, h: 1 })
    expect(cropKeys({ size: { width: 600, height: 1200 }, box: tall, changed: false })[0]).toEqual([
      '↑↓',
      'move',
    ])
    const zoomed = zoomedBox(size, { w: 1, h: 1 }, { x: 600, y: 300 }, 90)
    expect(cropKeys({ size, box: zoomed, changed: true })).toEqual([
      ['↑↓←→', 'move'],
      ['+−', 'zoom'],
      ['r', 'reset'],
      ['↵', 'confirm'],
    ])
  })

  it('says where the crop sits, for a terminal with no colour', () => {
    const row = cropPositionRow(P, { left: 1008, top: 0, width: 3024, height: 3024 })
    expect(row.map((r) => r.text).join('')).toBe('left 1,008 px · top 0 px')
    expect(row[0]?.fg).toBe(P.dim)
  })
})
