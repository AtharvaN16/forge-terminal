import { type Box, type Dots, keptShare, movableAxes } from '../core/crop.js'
import type { Size } from '../core/size.js'
import { blank, mix, type Row, type Run } from './home-art.js'
import type { Palette } from './theme.js'

/**
 * Crop to shape's preview (spec 2026-10-13 §2.2–2.3, mockups/crop-2026-10.html
 * P3, drawn there by scripts/crop-mockup.ts): the whole photo in half blocks
 * with what the crop cuts hatched, the facts beside it, and the keys a state
 * offers. Pure rows; the component (CropStep) only lays them out.
 */

/** The crop in dots of the drawn picture. */
export interface DotBox {
  x: number
  y: number
  w: number
  h: number
}

/** Where the picture starts: two columns in from the title (which has its own lead of one). */
export const PICTURE_LEFT = 3
/** Between the picture and the facts. */
export const FACTS_GAP = 4
/** The facts column the picture always leaves room for. */
export const FACTS_WIDTH = 26

const HEX = /^#[0-9a-f]{6}$/i
/** A colour to fade towards: the palette's, or black where it has none (the first-run palette). */
const solid = (c: string, fallback: string) => (HEX.test(c) ? c : fallback)

const hexOf = (rgb: Uint8Array, i: number) =>
  `#${[rgb[i] ?? 0, rgb[i + 1] ?? 0, rgb[i + 2] ?? 0].map((v) => v.toString(16).padStart(2, '0')).join('')}`

/**
 * The picture's rows. A cell is two dots (`▀`: fg the top, bg the bottom). A
 * dot outside the crop is faded towards the canvas (72 % in dark, 70 % in
 * light); a cell with both dots outside is `╱` over the mean of the two, the
 * line that mixed half way to `border` (P3, the hatch Forge uses for what
 * goes away). Cells alike are one run.
 */
export function cropPictureRows({
  palette,
  dots,
  box,
}: {
  palette: Palette
  dots: Dots
  box: DotBox
}): Row[] {
  const canvas = solid(palette.canvas, '#000000')
  const border = solid(palette.border, '#808080')
  const fade = palette.name === 'light' ? 0.7 : 0.72
  const inside = (x: number, y: number) =>
    x >= box.x && x < box.x + box.w && y >= box.y && y < box.y + box.h
  const shown = (x: number, y: number) => {
    const c = hexOf(dots.rgb, (y * dots.cols + x) * 3)
    return inside(x, y) ? c : mix(c, canvas, fade)
  }
  const rows: Row[] = []
  for (let r = 0; r * 2 + 1 < dots.dotRows; r++) {
    const row: Run[] = []
    const yt = r * 2
    const yb = yt + 1
    for (let x = 0; x < dots.cols; x++) {
      const t = shown(x, yt)
      const b = shown(x, yb)
      const cut = !inside(x, yt) && !inside(x, yb)
      const cell: Run = cut
        ? { text: '╱', fg: mix(t, border, 0.5), bg: mix(t, b, 0.5) }
        : { text: '▀', fg: t, bg: b }
      const last = row.at(-1)
      if (last && last.fg === cell.fg && last.bg === cell.bg && last.text.endsWith(cell.text)) {
        last.text += cell.text
      } else row.push(cell)
    }
    rows.push(row)
  }
  return rows
}

/** The pixel box on a picture of `dots`: each side scaled to dots and rounded. */
export function dotBoxOf(size: Size, box: Box, dots: { cols: number; dotRows: number }): DotBox {
  const sx = dots.cols / size.width
  const sy = dots.dotRows / size.height
  return {
    x: Math.round(box.left * sx),
    y: Math.round(box.top * sy),
    w: Math.round(box.width * sx),
    h: Math.round(box.height * sy),
  }
}

/** One press of an arrow: one dot of the drawn picture along that axis, in pixels, at least one. */
export function cropStep(size: Size, dots: { cols: number; dotRows: number }) {
  return {
    x: Math.max(1, Math.round(size.width / dots.cols)),
    y: Math.max(1, Math.round(size.height / dots.dotRows)),
  }
}

/**
 * The picture's size in cells: `rows` tall where it can be, as wide as the
 * photo's shape makes it (a dot is square: a cell is one dot across, two
 * down), and narrower — so shorter — when the facts column would not fit
 * beside it in `width`. Undefined when there is no room for a picture.
 */
export function cropPictureSize(
  size: Size,
  rows: number,
  width: number,
): { cols: number; rows: number } | undefined {
  const most = width - PICTURE_LEFT - FACTS_GAP - FACTS_WIDTH
  const across = (r: number) => Math.round((r * 2 * size.width) / size.height)
  let r = Math.max(0, rows)
  if (across(r) > most) r = Math.floor((most * size.height) / (2 * size.width))
  const cols = Math.min(most, across(r))
  return r >= 1 && cols >= 1 ? { cols, rows: r } : undefined
}

const dims = (b: Box) => `${b.width} × ${b.height}`
const grouped = (n: number) => n.toLocaleString('en-US')

/** `3024 × 3024` bold, ` · 1:1` dim; under it `keeps 75 % of the photo` dim. Nothing else. */
export function cropFactsRows({
  palette,
  box,
  size,
  label,
}: {
  palette: Palette
  box: Box
  size: Size
  label: string
}): Row[] {
  return [
    [
      { text: dims(box), fg: palette.fg, bold: true },
      { text: ` · ${label}`, fg: palette.dim },
    ],
    [{ text: `keeps ${keptShare(size, box)} % of the photo`, fg: palette.dim }],
  ]
}

/** Where the crop sits, said where the picture would be when there is no colour to draw one. */
export function cropPositionRow(palette: Palette, box: Box): Row {
  return [{ text: `left ${grouped(box.left)} px · top ${grouped(box.top)} px`, fg: palette.dim }]
}

/**
 * The key row's main keys: only the arrows that can move the crop (one pair
 * at the largest, all four once zoomed), zoom always, reset once the crop is
 * no longer the guess, confirm.
 */
export function cropKeys({
  size,
  box,
  changed,
}: {
  size: Size
  box: Box
  /** Moved or zoomed away from the guess. */
  changed: boolean
}): Array<[string, string]> {
  const can = movableAxes(size, box)
  const arrows = can.x && can.y ? '↑↓←→' : can.x ? '←→' : can.y ? '↑↓' : undefined
  return [
    ...(arrows ? ([[arrows, 'move']] as Array<[string, string]>) : []),
    ['+−', 'zoom'],
    ...(changed ? ([['r', 'reset']] as Array<[string, string]>) : []),
    ['↵', 'confirm'],
  ]
}

/** A row of the preview: the picture's (or its stand-in's) part, padded to `cols`, the gap, then a fact. */
export function besideRow(left: Row, cols: number, fact: Row | undefined): Row {
  const used = left.reduce((n, r) => n + [...r.text].length, 0)
  return [blank(PICTURE_LEFT), ...left, ...(fact ? [blank(cols - used + FACTS_GAP), ...fact] : [])]
}
