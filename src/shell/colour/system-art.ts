import stringWidth from 'string-width'
import { onWhiteAndBlack } from '../../core/colour/contrast.js'
import { parseHex } from '../../core/colour/space.js'
import { blank, mix, type Row, type Run, width } from '../home-art.js'
import { sliderRow } from '../quality-art.js'
import type { Palette } from '../theme.js'

/**
 * Palette's screen (colour spec §12.6) as rows of runs: the grid of a
 * palette from one colour, the lines round it, and the Mode and Tweak
 * windows drawn over it (W1). Data, as `colour-art.ts` is, so it can be held
 * cell for cell to mockups/colour-more-2026-10.html without Ink.
 */

const lc = (h: string): string => h.toLowerCase()
const ink = (text: string, fg: string, bold = false): Run => ({ text, fg: lc(fg), bold })

/** One character cell; a row is built from these where cells must be placed exactly. */
interface Cell {
  ch: string
  fg?: string | undefined
  bg?: string | undefined
  bold?: boolean | undefined
}

/** A row as cells, `n` wide. */
function cellsOf(row: Row, n: number): Cell[] {
  const out: Cell[] = []
  for (const run of row) {
    for (const ch of run.text) out.push({ ch, fg: run.fg, bg: run.bg, bold: run.bold })
  }
  while (out.length < n) out.push({ ch: ' ' })
  return out.slice(0, n)
}

/** Cells back into runs, neighbours of one style joined. */
function rowFrom(cells: Cell[]): Row {
  const out: Run[] = []
  for (const c of cells) {
    const last = out[out.length - 1]
    if (last && last.fg === c.fg && last.bg === c.bg && !!last.bold === !!c.bold) last.text += c.ch
    else {
      const run: Run = { text: c.ch }
      if (c.fg !== undefined) run.fg = c.fg
      if (c.bg !== undefined) run.bg = c.bg
      if (c.bold) run.bold = true
      out.push(run)
    }
  }
  return out
}

/** White or near-black, whichever reads on `hex`. */
function readsOn(hex: string): string {
  const rgb = parseHex(hex)
  if (!rgb) return '#ffffff'
  const r = onWhiteAndBlack(rgb)
  return r.white >= r.black ? '#ffffff' : '#111111'
}

/* ---------------------------------------------------------------- grid */

export interface GridRow {
  name: string
  hexes: string[]
  /** The row of the colour typed; its reference cell gets the ◤. */
  yours: boolean
}

/** The names' column, before the swatches. */
export const NAME_COLUMN = 10
const MAX_CELL = 4

/**
 * How the grid's cells fit in `columns`: as wide as fit, up to four, with a
 * gap of one between them always (the gap carries the chosen cell's stroke).
 */
export function gridFit(columns: number, n: number): { cell: number; gap: 1 } {
  const room = columns - 4 - NAME_COLUMN
  return { cell: Math.max(1, Math.min(MAX_CELL, Math.floor((room - (n - 1)) / n))), gap: 1 }
}

/**
 * The grid (§12.6): the step numbers over it, a row per colour named down
 * the left, the neutral last. Rows have a gap between them as columns do:
 * each row's swatches fill the lower half of its first line. With fewer
 * colours rows grow, up to three lines, to fill `lines`.
 *
 * The chosen cell is wider, half a column into each gap, with a stroke all
 * round in the text colour: the gap columns are half stroke, half cell; the
 * half line above it and the half line under it are stroke. Your colour's
 * reference cell has ◤ in its top-left corner, or a small ▖ where a cell is
 * one line and a triangle cannot fit.
 */
export function gridRows({
  width: columns,
  palette: p,
  labels,
  rows: all,
  reference,
  sel,
  lines,
}: {
  width: number
  palette: Palette
  labels: string[]
  rows: GridRow[]
  /** Which column is the colour itself (500, or Radix's 9). */
  reference: number
  sel: { row: number; col: number }
  /** The lines the colours may take, under the step numbers. */
  lines: number
}): Row[] {
  const { cell } = gridFit(columns, labels.length)
  const canvas = lc(p.canvas)
  const frame = lc(p.fg)
  const tall = Math.max(1, Math.min(3, Math.floor(lines / Math.max(1, all.length))))
  const C = (ch: string, fg?: string, bg?: string, bold = false): Cell => ({ ch, fg, bg, bold })
  const isSel = (r: number) => r === sel.row
  const isBelow = (r: number) => r === sel.row + 1

  // The step numbers: the chosen column's first, so it is never the one left out.
  const at = (i: number) => 2 + NAME_COLUMN + i * (cell + 1)
  const placed: { from: number; to: number; i: number }[] = []
  const place = (i: number) => {
    const t = labels[i] as string
    const from = at(i) + Math.floor((cell - stringWidth(t)) / 2)
    const to = from + stringWidth(t)
    if (placed.some((q) => from < q.to + 1 && to + 1 > q.from)) return
    placed.push({ from, to, i })
  }
  if (sel.col >= 0) place(sel.col)
  labels.forEach((_, i) => {
    if (i !== sel.col) place(i)
  })
  const labelCells: Cell[] = Array.from({ length: at(labels.length - 1) + cell + 1 }, () => C(' '))
  for (const q of placed) {
    const on = q.i === sel.col
    const fg = on ? p.fg : q.i === reference ? p.accent : p.border
    ;[...(labels[q.i] as string)].forEach((ch, k) => {
      labelCells[q.from + k] = C(ch, lc(fg), undefined, on)
    })
  }
  const out: Row[] = [rowFrom(labelCells)]

  /** The gap column before cell `i` on line `k` of row `r`. */
  const gap = (r: number, k: number, i: number, hexes: string[]): Cell => {
    const chosen = lc(hexes[sel.col] ?? canvas)
    if (isSel(r) && i === sel.col) {
      return k === 0 ? C('▗', lc(hexes[i] as string), frame) : C('▐', lc(hexes[i] as string), frame)
    }
    if (isSel(r) && i === sel.col + 1)
      return k === 0 ? C('▖', chosen, frame) : C('▌', chosen, frame)
    if (isBelow(r) && k === 0 && (i === sel.col || i === sel.col + 1)) return C('▀', frame, canvas)
    return C(' ')
  }

  all.forEach((x, r) => {
    for (let k = 0; k < tall; k++) {
      const cells: Cell[] = [C(' '), C(' ')]
      const name = k === 0 ? x.name : ''
      const nameFg = lc(x.yours ? p.accent : isSel(r) ? p.fg : p.dim)
      for (let c = 0; c < NAME_COLUMN; c++) {
        cells.push(C(name[c] ?? ' ', name[c] ? nameFg : undefined, undefined, isSel(r) || x.yours))
      }
      x.hexes.forEach((h, i) => {
        const g = gap(r, k, i, x.hexes)
        if (i > 0) cells.push(g)
        else if (g.ch !== ' ') cells[cells.length - 1] = g
        const strokeTop = k === 0 && (isSel(r) || isBelow(r)) && i === sel.col
        const mine = x.yours && i === reference
        for (let c = 0; c < cell; c++) {
          if (k === 0) {
            if (mine && c === 0 && tall === 1)
              cells.push(C('▖', lc(readsOn(h)), strokeTop ? frame : canvas))
            else cells.push(C('▄', lc(h), strokeTop ? frame : canvas))
          } else if (mine && c === 0 && k === 1) cells.push(C('◤', lc(readsOn(h)), lc(h)))
          else cells.push(C(' ', undefined, lc(h)))
        }
      })
      const end = gap(r, k, x.hexes.length, x.hexes)
      if (end.ch !== ' ') cells.push(end)
      out.push(rowFrom(cells))
    }
  })
  // The half line under the last row: the stroke's bottom, when the chosen cell is there.
  if (sel.row === all.length - 1) {
    const cells: Cell[] = Array.from({ length: 2 + NAME_COLUMN }, () => C(' '))
    labels.forEach((_, i) => {
      const edge = i === sel.col || i === sel.col + 1
      if (i > 0) cells.push(edge ? C('▀', frame) : C(' '))
      else if (sel.col === 0) cells[cells.length - 1] = C('▀', frame)
      for (let c = 0; c < cell; c++) cells.push(i === sel.col ? C('▀', frame) : C(' '))
    })
    if (sel.col === labels.length - 1) cells.push(C('▀', frame))
    out.push(rowFrom(cells))
  }
  while (out.length < lines + 1) out.push([])
  return out
}

/** Before a colour: the step numbers faint, the swatches as outlines on every other line. */
export function emptyGridRows({
  width: columns,
  palette: p,
  labels,
  lines,
}: {
  width: number
  palette: Palette
  labels: string[]
  lines: number
}): Row[] {
  const { cell } = gridFit(columns, labels.length)
  const lead: Row = [blank(2 + NAME_COLUMN)]
  const top: Row = [...lead]
  labels.forEach((n, i) => {
    if (i) top.push(blank(1))
    const left = Math.max(0, Math.floor((cell - stringWidth(n)) / 2))
    const fits = stringWidth(n) <= cell + 1
    top.push(
      blank(left),
      ink(fits ? n : '', p.faint),
      blank(Math.max(0, cell - left - (fits ? stringWidth(n) : 0))),
    )
  })
  const outline: Row = [...lead]
  labels.forEach((_, i) => {
    if (i) outline.push(blank(1))
    outline.push(ink('╌'.repeat(cell), p.faint))
  })
  const out: Row[] = [top]
  for (let k = 0; k < lines; k++) out.push(k % 2 === 0 ? outline : [])
  return out
}

/** The chosen swatch, above the grid: `blue 700  #004598  oklch(41% 0.149 258)`. */
export function chosenRow(p: Palette, name: string, step: string, hex: string, oklch: string): Row {
  return [
    blank(2),
    ink(`${name} ${step}`, p.fg, true),
    blank(2),
    ink(hex, p.fg, true),
    blank(2),
    ink(oklch, p.dim),
  ]
}

/** The keys at the line's far end, drawn as the key row's caps. */
function withKeys(p: Palette, row: Row, pairs: [string, string][], w: number): Row {
  const tail: Row = []
  pairs.forEach(([k, word], i) => {
    if (i) tail.push(blank(2))
    tail.push(
      p.keycapBg === ''
        ? { text: `[${k}]`, fg: p.fg, bold: true }
        : { text: ` ${k} `, fg: p.fg, bg: p.keycapBg, bold: true },
      ink(` ${word}`, p.dim),
    )
  })
  const gap = w - 1 - width(row) - width(tail)
  return gap < 2 ? row : [...row, blank(gap), ...tail]
}

/** The line under the grid: the mode's name, and `m mode  t tweak  s steps`. */
export function modeRow(p: Palette, columns: number, modeName: string): Row {
  return withKeys(
    p,
    [blank(2), ink(modeName, p.fg, true)],
    [
      ['m', 'mode'],
      ['t', 'tweak'],
      ['s', 'steps'],
    ],
    columns - 1,
  )
}

/* -------------------------------------------------------------- windows */

/**
 * A framed window drawn over `under` (the screen's body), which fades behind
 * it so the window is plainly on top (W1). Rounded corners in the border
 * grey, filled with the field's grey, the title in the top edge. `scroll`
 * draws a bar in the right edge for a list longer than the window.
 */
export function windowOver(
  p: Palette,
  under: Row[],
  win: {
    title: string
    lines: Row[]
    width: number
    columns: number
    top: number
    scroll?: { at: number; of: number } | undefined
  },
): Row[] {
  const canvas = lc(p.canvas)
  const fade = (h?: string) => (h && /^#[0-9a-f]{6}$/i.test(h) ? mix(lc(h), canvas, 0.7) : h)
  const rows = Array.from(
    { length: Math.max(under.length, win.top + win.lines.length + 2) },
    (_, i) =>
      cellsOf(under[i] ?? [], win.columns).map((c) => ({
        ...c,
        fg: fade(c.fg),
        bg: fade(c.bg),
        bold: false,
      })),
  )
  const W = win.width
  const left = Math.max(0, Math.floor((win.columns - W) / 2))
  const fill = p.selectionBg === '' ? undefined : lc(p.selectionBg)
  const edge = lc(p.border)
  const inner = W - 2
  const h = win.lines.length
  const bar = (k: number): boolean => {
    if (!win.scroll) return false
    const thumb = Math.max(1, Math.round((h * h) / win.scroll.of))
    const start = Math.round(((h - thumb) * win.scroll.at) / Math.max(1, win.scroll.of - h))
    return k >= start && k < start + thumb
  }
  const title = ` ${win.title} `
  const top: Cell[] = [
    { ch: '╭', fg: edge, bg: fill },
    { ch: '─', fg: edge, bg: fill },
    ...[...title].map((ch) => ({ ch, fg: lc(p.fg), bg: fill, bold: true })),
    ...Array.from({ length: Math.max(0, inner - 1 - title.length) }, () => ({
      ch: '─',
      fg: edge,
      bg: fill,
    })),
    { ch: '╮', fg: edge, bg: fill },
  ]
  const bottom: Cell[] = [
    { ch: '╰', fg: edge, bg: fill },
    ...Array.from({ length: inner }, () => ({ ch: '─', fg: edge, bg: fill })),
    { ch: '╯', fg: edge, bg: fill },
  ]
  const body = win.lines.map((line, k): Cell[] => [
    { ch: '│', fg: edge, bg: fill },
    ...cellsOf(line, inner).map((c) => ({ ...c, bg: c.bg ?? fill })),
    bar(k) ? { ch: '┃', fg: lc(p.fg), bg: fill } : { ch: '│', fg: edge, bg: fill },
  ])
  ;[top, ...body, bottom].forEach((cells, k) => {
    const row = rows[win.top + k] as Cell[]
    cells.forEach((c, j) => {
      row[left + j] = c
    })
  })
  return rows.map(rowFrom)
}

/** A list row in a window: the one in hand on the band, with › in the mode colour. */
function listRow(
  p: Palette,
  name: string,
  on: boolean,
  inner: number,
  nameW: number,
  after: Row,
): Row {
  const band = on && p.panelBand !== '' ? lc(p.panelBand) : undefined
  const row: Row = [
    { text: on ? ' › ' : '   ', fg: lc(p.accent), bold: true, ...(band ? { bg: band } : {}) },
    { ...ink(name, on ? p.fg : p.dim, on), ...(band ? { bg: band } : {}) },
  ]
  row.push({ text: ' '.repeat(Math.max(1, nameW + 3 - width(row))), ...(band ? { bg: band } : {}) })
  row.push(...after.map((r) => (band ? { ...r, bg: band } : r)))
  row.push({ text: ' '.repeat(Math.max(0, inner - width(row))), ...(band ? { bg: band } : {}) })
  return row
}

/** A palette's colours as chips: half-height so one row's don't run into the next's. */
function chips(hexes: string[]): Row {
  const out: Row = []
  hexes.forEach((h, i) => {
    if (i) out.push(blank(1))
    out.push(ink('▄▄', h))
  })
  return out
}

export const MODE_WINDOW_WIDTH = 56

/**
 * The Mode window's lines: each mode with its colours as chips (its 500s,
 * then the neutral's), the one in hand on the band; `↓ n more` under the
 * list when the window shows only part of it.
 */
export function modeLines(
  p: Palette,
  modes: { name: string; hexes: string[] }[],
  current: number,
  first: number,
  visible: number,
): Row[] {
  const inner = MODE_WINDOW_WIDTH - 2
  const shown = modes.slice(first, first + visible)
  const lines: Row[] = [[]]
  shown.forEach((m, k) => {
    lines.push(listRow(p, m.name, first + k === current, inner, 21, chips(m.hexes)))
  })
  const more = modes.length - (first + shown.length)
  lines.push(more > 0 ? [blank(3), ink(`↓ ${more} more`, p.border)] : [])
  return lines
}

export const TWEAK_WINDOW_WIDTH = 56

export interface Slider {
  label: string
  value: number
  max: number
  unit: string
}

const signed = (n: number) => (n > 0 ? `+${n}` : n < 0 ? `−${-n}` : '0')

/**
 * The Tweak window's lines: the four sliders, drawn as the quality screen's
 * (grey band, white pill with the value), the one in hand named bright; then
 * a strip of the palette's colours, which changes as they move.
 */
export function tweakLines(p: Palette, sliders: Slider[], focus: number, hexes: string[]): Row[] {
  const lines: Row[] = [[]]
  sliders.forEach((s, i) => {
    if (i) lines.push([])
    const on = i === focus
    const label = `${signed(s.value)}${s.unit}`
    const bar = sliderRow({ palette: p, value: s.value, min: -s.max, max: s.max, width: 36 }).map(
      (r) => (r.text.trim() === String(s.value) ? { ...r, text: ` ${label} ` } : r),
    )
    lines.push([blank(1), ink(s.label.padEnd(12), on ? p.fg : p.dim, on), ...bar])
  })
  const strip: Row = [blank(13)]
  hexes.forEach((h, i) => {
    if (i) strip.push(blank(1))
    strip.push({ text: '   ', bg: lc(h) })
  })
  lines.push([], strip)
  return lines
}
