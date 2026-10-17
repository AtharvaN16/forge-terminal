import { describe, expect, it } from 'vitest'
import { CHECKER } from '../../src/core/closeup.js'
import { CROP_SHAPES, centreOf, largestBox, movedBox, zoomedBox } from '../../src/core/crop.js'
import {
  cropFactsRows,
  cropKeys,
  cropPicturePixels,
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
const P = modePalette(DARK, 'edit')
const L = modePalette(LIGHT, 'edit')

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
  it('draws the hatch in the edge colour where there is one, so what goes reads as gone', () => {
    const edge = '#a78bfa'
    const [row] = cropPictureRows({ palette: P, dots, box: { x: 1, y: 0, w: 2, h: 2 }, edge })
    const faded = (c: string) => mix(c, P.canvas, 0.72)
    expect(cellsOf(row ?? [])[0]).toEqual({
      ch: '╱',
      fg: mix(faded(top(0)), edge, 0.65),
      bg: mix(faded(top(0)), faded(bottom(0)), 0.5),
    })
  })

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

  it('draws transparency on Done’s checkerboard, not as the black under it', () => {
    // 4 × 4 dots, every one transparent black: two rows of cells.
    const clear = {
      cols: 4,
      dotRows: 4,
      rgb: new Uint8Array(4 * 4 * 3),
      alpha: new Uint8Array(4 * 4),
    }
    const rows = cropPictureRows({ palette: P, dots: clear, box: { x: 0, y: 0, w: 4, h: 4 } })
    const [a, b] = CHECKER.map((v) => `#${v.toString(16).padStart(2, '0').repeat(3)}`)
    // A square is two cells across, one down, so each cell is one colour (as Done's).
    expect(cellsOf(rows[0] ?? []).map((c) => [c.fg, c.bg])).toEqual([
      [a, a],
      [a, a],
      [b, b],
      [b, b],
    ])
    expect(cellsOf(rows[1] ?? []).map((c) => c.fg)).toEqual([b, b, a, a])
    // Half seen: the colour laid half over the check.
    const half = {
      ...clear,
      rgb: new Uint8Array(4 * 4 * 3).fill(255),
      alpha: new Uint8Array(16).fill(128),
    }
    const [row] = cropPictureRows({ palette: P, dots: half, box: { x: 0, y: 0, w: 4, h: 4 } })
    expect(cellsOf(row ?? [])[0]?.fg).toBe(mix(a as string, '#ffffff', 128 / 255))
  })

  it('marks the crop’s corners with brackets inside it, in whole cells of the edge colour (G)', () => {
    // 10 × 10 dots of one grey, the crop 8 × 8 from (1, 1): arms two dots
    // long (a quarter of the shorter side, at least two). A half block's
    // glyph does not fill its cell in every terminal (Apple Terminal draws it
    // from the font), so the background showed round it as a second line:
    // the brackets are spaces on the edge colour, in the cells wholly inside.
    const flat = { cols: 10, dotRows: 10, rgb: new Uint8Array(10 * 10 * 3).fill(200) }
    const edge = '#cc66ff'
    const rows = cropPictureRows({ palette: P, dots: flat, box: { x: 1, y: 1, w: 8, h: 8 }, edge })
    const grey = '#c8c8c8'
    const faded = mix(grey, P.canvas, 0.72)
    const half = { ch: '▀', fg: faded, bg: grey }
    const E = { ch: ' ', fg: edge, bg: edge }
    const G = { ch: ' ', fg: grey, bg: grey }
    const at = (i: number) => cellsOf(rows[i] ?? []).slice(1, 9)
    // Row 0 holds dots 0–1: the crop's top edge is its bottom half, so no arm there.
    expect(at(0)).toEqual(Array(8).fill(half))
    // Row 1, the first wholly inside: the top arms across.
    expect(at(1)).toEqual([E, E, G, G, G, G, E, E])
    // Row 2: the side arms down (two dots: one row).
    expect(at(2)).toEqual([G, G, G, G, G, G, G, G])
    // Row 3, the last wholly inside: the bottom arms.
    expect(at(3)).toEqual([E, E, G, G, G, G, E, E])
  })

  it('runs the side arms down as many rows as the arm is long', () => {
    const flat = { cols: 16, dotRows: 16, rgb: new Uint8Array(16 * 16 * 3).fill(200) }
    const edge = '#cc66ff'
    const rows = cropPictureRows({
      palette: P,
      dots: flat,
      box: { x: 2, y: 2, w: 12, h: 12 },
      edge,
    })
    const isEdge = (i: number) => cellsOf(rows[i] ?? []).map((c) => c.bg === edge)
    // Arms three dots long: three cells across, two rows down.
    const across = [false, false, true, true, true, false, false, false]
    expect(isEdge(1)).toEqual([...across, ...[...across].reverse()])
    // Two columns wide: a row is two dots tall, a column one across.
    const side = [false, false, true, true, ...Array(8).fill(false), true, true, false, false]
    expect(isEdge(2)).toEqual(side)
    expect(isEdge(3)).toEqual(Array(16).fill(false))
  })

  it('draws a cell of one colour as a space on it: no glyph, so no seam', () => {
    const [row] = cropPictureRows({
      palette: P,
      dots: { cols: 2, dotRows: 2, rgb: new Uint8Array([9, 9, 9, 1, 2, 3, 9, 9, 9, 4, 5, 6]) },
      box: { x: 0, y: 0, w: 2, h: 2 },
    })
    const cells = cellsOf(row ?? [])
    expect(cells[0]).toEqual({ ch: ' ', fg: '#090909', bg: '#090909' })
    expect(cells[1]?.ch).toBe('▀')
  })

  it('draws no brackets without an edge colour', () => {
    const flat = { cols: 4, dotRows: 4, rgb: new Uint8Array(4 * 4 * 3).fill(200) }
    const rows = cropPictureRows({ palette: P, dots: flat, box: { x: 0, y: 0, w: 4, h: 4 } })
    expect(cellsOf(rows.flat()).every((c) => c.fg === '#c8c8c8' && c.bg === '#c8c8c8')).toBe(true)
  })

  it('draws a run of cells in one colour as one run', () => {
    const flat = { cols: 4, dotRows: 2, rgb: new Uint8Array(4 * 2 * 3).fill(200) }
    const [row] = cropPictureRows({ palette: P, dots: flat, box: { x: 0, y: 0, w: 4, h: 2 } })
    expect(row).toHaveLength(1)
    expect(row?.[0]?.text).toBe('    ')
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

  it('visibly moves the hatch on every press that is not stopped by an edge', () => {
    const photos = [
      { width: 1920, height: 1080 },
      { width: 4032, height: 3024 },
      { width: 3024, height: 4032 },
      { width: 1200, height: 600 },
      { width: 641, height: 479 },
      { width: 1000, height: 1000 },
      { width: 7000, height: 1000 },
    ]
    const screens = [
      [60, 10],
      [80, 19],
      [120, 30],
      [160, 40],
      [200, 45],
    ] as const
    for (const photo of photos) {
      for (const [width, rows] of screens) {
        const grid = cropPictureSize(photo, rows, width)
        if (!grid) continue
        const dots = { cols: grid.cols, dotRows: grid.rows * 2 }
        const step = cropStep(photo, dots)
        for (const shape of CROP_SHAPES) {
          const largest = largestBox(photo, shape)
          for (const start of [largest, zoomedBox(photo, shape, centreOf(largest), 60)]) {
            for (const [dx, dy] of [
              [step.x, 0],
              [-step.x, 0],
              [0, step.y],
              [0, -step.y],
            ] as const) {
              let box = start
              for (let press = 0; press < 400; press++) {
                const next = movedBox(photo, box, dx, dy)
                const at = `${shape.label} on ${photo.width}×${photo.height}, ${width}×${rows}, ${box.left},${box.top} by ${dx},${dy}`
                const whole = next.left - box.left === dx && next.top - box.top === dy
                if (whole) {
                  expect(dotBoxOf(photo, next, dots), at).not.toEqual(dotBoxOf(photo, box, dots))
                }
                if (next.left === box.left && next.top === box.top) {
                  // At the edge: the press does nothing.
                  expect(movedBox(photo, next, dx, dy), at).toEqual(next)
                  break
                }
                box = next
              }
            }
          }
        }
      }
    }
  })

  it('moved the hatch on the press that used to leave it still (1920 × 1080, 160 × 45, 1:1 at 240)', () => {
    const photo = { width: 1920, height: 1080 }
    const grid = cropPictureSize(photo, 40, 160)
    if (!grid) throw new Error('no picture')
    const dots = { cols: grid.cols, dotRows: grid.rows * 2 }
    const box = { left: 240, top: 0, width: 1080, height: 1080 }
    const next = movedBox(photo, box, cropStep(photo, dots).x, 0)
    expect(dotBoxOf(photo, next, dots)).not.toEqual(dotBoxOf(photo, box, dots))
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

describe('the crop picture as pixels, for a terminal that draws pictures', () => {
  const edge = '#a78bfa'
  const grey = (cols: number, dotRows: number) => ({
    cols,
    dotRows,
    rgb: new Uint8Array(cols * dotRows * 3).fill(0x80),
  })
  const px = (g: { width: number; rgba: Uint8Array }, x: number, y: number) => {
    const i = (y * g.width + x) * 4
    return `#${[...g.rgba.subarray(i, i + 3)].map((v) => v.toString(16).padStart(2, '0')).join('')}`
  }

  it('is the dots, one pixel each, opaque', () => {
    const g = cropPicturePixels({
      palette: P,
      dots: grey(40, 40),
      box: { x: 0, y: 0, w: 40, h: 40 },
      edge,
    })
    expect([g.width, g.height]).toEqual([40, 40])
    expect(g.rgba.filter((_, i) => i % 4 === 3).every((a) => a === 255)).toBe(true)
  })

  it('keeps the crop as it is, and fades what is cut, hatched in the edge colour', () => {
    const g = cropPicturePixels({
      palette: P,
      dots: grey(64, 64),
      box: { x: 32, y: 0, w: 32, h: 64 },
      edge,
    })
    // The middle of the crop, clear of its brackets: the photo.
    expect(px(g, 48, 32)).toBe('#808080')
    // Outside: the faded photo, or a stroke of the hatch over it.
    const faded = mix('#808080', P.canvas, 0.72)
    const stroke = mix(faded, edge, 0.65)
    const seen = new Set(Array.from({ length: 32 }, (_, x) => px(g, x, 20)))
    expect(seen).toEqual(new Set([faded, stroke]))
  })

  it('puts the brackets on the crop’s corners, inside it, in the edge colour', () => {
    const g = cropPicturePixels({
      palette: P,
      dots: grey(64, 64),
      box: { x: 0, y: 0, w: 64, h: 64 },
      edge,
    })
    expect(px(g, 0, 0)).toBe(edge)
    expect(px(g, 63, 63)).toBe(edge)
    expect(px(g, 10, 0)).toBe(edge)
    expect(px(g, 32, 0)).toBe('#808080')
  })
})
