import stringWidth from 'string-width'
import { onWhiteAndBlack } from '../../core/colour/contrast.js'
import { mix as mixColours } from '../../core/colour/mix.js'
import { parseColour } from '../../core/colour/parse.js'
import { parseHex, type Rgb, rgbToOklab, toHex } from '../../core/colour/space.js'
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

/* ---------------------------------------------------------------- grid */

export interface GridRow {
  name: string
  hexes: string[]
  /** The row of the colour typed; its reference cell is underlined. */
  yours: boolean
}

/** The names' column, before the swatches: as wide as the longest name and a space, from 10 to 14. */
export const NAME_COLUMN = 10
const MAX_NAME_COLUMN = 14
export const nameColumn = (names: string[]) =>
  Math.max(NAME_COLUMN, Math.min(MAX_NAME_COLUMN, Math.max(0, ...names.map((n) => n.length)) + 2))
const MAX_CELL = 8
const MAX_TALL = 3
/** The fewest rows a scrolled grid shows before its swatches go down to one line. */
const MIN_SHOWN = 4

/**
 * How the grid's cells fit in `columns`: as wide as fit, up to eight, with a
 * gap of one between them always (the gap carries the chosen cell's frame),
 * a frame column either side, and the scroll bar's two at the end.
 */
export function gridFit(columns: number, n: number, names = NAME_COLUMN): { cell: number; gap: 1 } {
  const room = columns - 5 - names - n
  return { cell: Math.max(1, Math.min(MAX_CELL, Math.floor(room / n))), gap: 1 }
}

/**
 * How tall the swatches are and how many rows show in `lines`: each row its
 * swatches and the gap line above, and one more gap under the last. Every
 * row shows when it can, growing up to three lines; otherwise the grid
 * scrolls, two lines a row while `MIN_SHOWN` rows still fit, one below that.
 */
export function gridLayout(lines: number, n: number): { tall: number; shown: number } {
  let tall = Math.max(1, Math.min(MAX_TALL, Math.floor((lines - 1) / Math.max(1, n)) - 1))
  if (tall < 2 && Math.floor((lines - 1) / 3) >= MIN_SHOWN) tall = 2
  return { tall, shown: Math.max(1, Math.min(n, Math.floor((lines - 1) / (tall + 1)))) }
}

/**
 * The grid (§12.6): the step numbers over it, a row per colour named down
 * the left, the neutral last. A swatch is whole cells, spaces on its colour:
 * a half block's glyph does not fill its cell in every terminal (Apple
 * Terminal draws it from the font) and left lines inside the swatches.
 * Rows have a gap line between them as columns have a gap column.
 *
 * The chosen cell has a thin frame round it in the gaps, eighth blocks
 * against its edges (`▁ ▕ ▏ ▔`), so no swatch is covered: white on a dark
 * swatch, near-black on a light one (2026-10-24). Your colour's reference
 * cell has a small dot in its middle, white, near-black on a light colour. When not every row fits in `lines`, the rows shown keep the
 * chosen one in the middle, and a bar at the right says where they are in
 * the list.
 */
export function gridRows({
  width: columns,
  palette: p,
  labels,
  rows: all,
  reference,
  sel,
  framed = true,
  lines,
}: {
  width: number
  palette: Palette
  labels: string[]
  rows: GridRow[]
  /** Which column is the colour itself (500, or Radix's 9). */
  reference: number
  /** The chosen cell; the rows shown follow its row. */
  sel: { row: number; col: number }
  /** Whether the chosen cell has its frame (not while a window is open over the grid). */
  framed?: boolean
  /** The lines the colours may take, under the step numbers. */
  lines: number
}): Row[] {
  const nameW = nameColumn(all.map((r) => r.name))
  const n = labels.length
  const { cell } = gridFit(columns, n, nameW)
  const gapped = gridLayout(lines, all.length)
  // When the rows, a line each with a gap line between, would not all show,
  // but a line each touching would (2026-10-24), every row shows and none
  // scrolls: the chosen cell is marked in the gaps either side of it.
  const gapless = gapped.shown < all.length && lines >= all.length
  const { tall, shown } = gapless ? { tall: 1, shown: all.length } : gapped
  const first = Math.max(0, Math.min(all.length - shown, sel.row - Math.floor((shown - 1) / 2)))
  // The chosen cell's frame (2026-10-24): the one of white and near-black
  // that stands off the canvas, so the thin line is seen against the gap it
  // is drawn in; the other only on a swatch too close to it to tell apart.
  const frame = frameOn(p, all[sel.row]?.hexes[sel.col])
  const C = (ch: string, fg?: string, bg?: string, bold = false): Cell => ({ ch, fg, bg, bold })

  const at = (i: number) => 2 + nameW + i * (cell + 1)
  // The cells, the right frame column, a blank, the bar.
  const W = at(n - 1) + cell + 3
  const line = (): Cell[] => Array.from({ length: W }, () => C(' '))

  // The step numbers: the chosen column's first, so it is never the one left out.
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
  const labelCells = line()
  for (const q of placed) {
    const on = q.i === sel.col
    const fg = on ? p.fg : q.i === reference ? p.accent : p.border
    ;[...(labels[q.i] as string)].forEach((ch, k) => {
      labelCells[q.from + k] = C(ch, lc(fg), undefined, on)
    })
  }

  /** The gap line above row `r`: the chosen cell's frame, top or bottom, where it is. */
  const gap = (r: number): Cell[] => {
    const cells = line()
    const top = r === sel.row
    // Eighth blocks against the swatch's edge, so the frame sits on the colour it reads on.
    if (framed && sel.col >= 0 && (top || r - 1 === sel.row)) {
      for (let c = 0; c < cell; c++) cells[at(sel.col) + c] = C(top ? '▁' : '▔', frame)
    }
    return cells
  }

  const body: Cell[][] = []
  for (let r = first; r < first + shown; r++) {
    const x = all[r] as GridRow
    if (!gapless) body.push(gap(r))
    for (let k = 0; k < tall; k++) {
      const cells = line()
      if (k === 0) {
        const fg = lc(x.yours ? p.accent : r === sel.row ? p.fg : p.dim)
        ;[...x.name.slice(0, nameW - 1)].forEach((ch, c) => {
          cells[2 + c] = C(ch, fg, undefined, r === sel.row || x.yours)
        })
      }
      x.hexes.forEach((h, i) => {
        for (let c = 0; c < cell; c++) cells[at(i) + c] = C(' ', undefined, lc(h))
      })
      // Your colour's reference cell (2026-10-24): a small dot in its middle.
      if (x.yours && reference >= 0 && reference < n) {
        if (k === Math.floor((tall - 1) / 2)) {
          const h = x.hexes[reference]
          cells[at(reference) + Math.floor((cell - 1) / 2)] = C(
            '•',
            readsOn(h, '#ffffff'),
            h ? lc(h) : undefined,
          )
        }
      }
      if (framed && r === sel.row && sel.col >= 0) {
        cells[at(sel.col) - 1] = C('▕', frame)
        cells[at(sel.col) + cell] = C('▏', frame)
      }
      body.push(cells)
    }
  }
  if (!gapless) body.push(gap(first + shown))

  // Where the rows shown are in the list: a thumb on a faint track, as the windows' bars.
  if (shown < all.length) {
    const h = body.length
    const thumb = Math.max(1, Math.round((h * shown) / all.length))
    const start = Math.round(((h - thumb) * first) / Math.max(1, all.length - shown))
    body.forEach((cells, k) => {
      cells[W - 1] = k >= start && k < start + thumb ? C('┃', lc(p.fg)) : C('│', lc(p.faint))
    })
  }

  const out: Row[] = [rowFrom(labelCells), ...body.map(rowFrom)]
  while (out.length < lines + 1) out.push([])
  return out
}

/** White on a dark swatch, near-black on a light one; `fallback` when there is no swatch. */
function readsOn(hex: string | undefined, fallback: string): string {
  const rgb = hex ? parseHex(hex) : undefined
  if (!rgb) return lc(fallback)
  const r = onWhiteAndBlack(rgb)
  return r.white >= r.black ? '#ffffff' : '#111111'
}

/** How far apart two lightnesses must be for a thin line between them to be seen. */
const APART = 0.2
const WHITE = '#ffffff'
const NEAR_BLACK = '#111111'
const lightness = (hex: string): number | undefined => {
  const rgb = parseHex(hex)
  return rgb ? rgbToOklab(rgb).L : undefined
}

/**
 * The frame's colour on `hex`: white on a dark canvas, near-black on a light
 * one; the other where the swatch is within `APART` of it. Not a contrast
 * ratio: by that, a mid-tone swatch takes near-black, which a dark canvas
 * swallows (2026-10-24, teal 600 #6F7C79).
 */
function frameOn(p: Palette, hex: string | undefined): string {
  const canvas = lightness(p.canvas) ?? 0
  const [line, other] = canvas < 0.5 ? [WHITE, NEAR_BLACK] : [NEAR_BLACK, WHITE]
  const L = hex ? lightness(hex) : undefined
  if (L === undefined) return lc(p.fg)
  return Math.abs((lightness(line) as number) - L) < APART ? other : line
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

/** The line under the grid: the mode's name. Mode, Tweak and Steps are in More (2026-10-24). */
export function modeRow(p: Palette, _columns: number, modeName: string): Row {
  return [blank(2), ink(modeName, p.fg, true)]
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
    /** Where its left edge goes; centred when absent. A row's own window opens under its row. */
    left?: number | undefined
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
  const left = win.left ?? Math.max(0, Math.floor((win.columns - W) / 2))
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

/** A list row in a window: the one in hand on the band, with a plain ❯ in the text colour. */
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
    { text: on ? ' ❯ ' : '   ', fg: lc(p.fg), bold: true, ...(band ? { bg: band } : {}) },
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
  // Three cells a chip, a cell apart, narrower when there are more than fit
  // (a scale's eleven, an even set's up to 21); touching at one cell a chip.
  const room = TWEAK_WINDOW_WIDTH - 2 - 13 - 1
  const n = Math.max(1, hexes.length)
  const spaced = Math.floor((room + 1) / n) - 1
  const [chip, gap] =
    spaced >= 1 ? [Math.min(3, spaced), 1] : [Math.max(1, Math.floor(room / n)), 0]
  const strip: Row = [blank(13)]
  hexes.forEach((h, i) => {
    if (i && gap) strip.push(blank(gap))
    strip.push({ text: ' '.repeat(chip), bg: lc(h) })
  })
  lines.push([], strip)
  return lines
}

/* ------------------------------------------------------- More, Gradient */

export const MORE_WINDOW_WIDTH = 56

/** More's items as they read, each with the key that opens it at once (Mode has none: m is More). */
const MORE_NAMES: Record<string, [string, string]> = {
  gradient: ['Gradient', '⇧→'],
  tweak: ['Tweak', 't'],
  steps: ['Steps', 's'],
  mode: ['Mode', ''],
}

/**
 * More's window (2026-10-24): its items as the Mode list's rows, the one in
 * hand on the band with ›, each with its key at the right.
 */
export function moreLines(p: Palette, items: readonly string[], at: number): Row[] {
  const inner = MORE_WINDOW_WIDTH - 2
  const rows = items.map((item, i) => {
    const [name, key] = MORE_NAMES[item] ?? [item, '']
    return listRow(p, name, i === at, inner, inner - 3 - 6, [ink(key.padEnd(3), p.border)])
  })
  return [[], ...rows, []]
}

export const GRADIENT_WINDOW_WIDTH = 56

/** `n` cells evenly along `stops`, as the gradient they make (one colour: all of it). */
function strip(stops: readonly Rgb[], n: number): string[] {
  return Array.from({ length: n }, (_, i) => {
    if (stops.length < 2) return toHex(stops[0] ?? { r: 0, g: 0, b: 0 })
    const x = (i / Math.max(1, n - 1)) * (stops.length - 1)
    const k = Math.min(stops.length - 2, Math.floor(x))
    return toHex(mixColours(stops[k] as Rgb, stops[k + 1] as Rgb, x - k, 'oklab'))
  })
}

/**
 * The Gradient window (2026-10-24): the colours so far, numbered, each with
 * its swatch and hex, the one in hand on the band; then the box for the next,
 * on the field's grey, its swatch once whole, "wrong input" at its end when
 * what was typed is no colour; then the gradient they make, as one strip.
 */
export function gradientLines(
  p: Palette,
  win: { stops: readonly Rgb[]; at: number; text: string; wrong?: boolean },
): Row[] {
  const inner = GRADIENT_WINDOW_WIDTH - 2
  const band = p.panelBand === '' ? undefined : lc(p.panelBand)
  // The box on the shelf's grey, a step down from the window's, so it reads as a box.
  const field = p.shelf === '' ? undefined : lc(p.shelf)
  const on =
    (bg: string | undefined) =>
    (r: Run): Run =>
      bg ? { ...r, bg: r.bg ?? bg } : r
  const stops = win.stops.map((c, i): Row => {
    const chosen = i === win.at
    const row: Row = [
      { text: chosen ? ' ❯ ' : '   ', fg: lc(p.fg), bold: true },
      ink(String(i + 1), chosen ? p.fg : p.border, chosen),
      blank(3),
      { text: '    ', bg: lc(toHex(c)) },
      blank(2),
      ink(toHex(c), chosen ? p.fg : p.dim, chosen),
    ]
    row.push(blank(Math.max(0, inner - width(row))))
    return chosen ? row.map(on(band)) : row
  })
  const inHand = win.at === win.stops.length
  const typed = parseColour(win.text.trim())?.rgb
  const boxW = inner - 6 - 3
  const inside: Row = [
    blank(1),
    ink(inHand ? '❯' : '›', inHand ? p.fg : p.border, true),
    blank(1),
    ink(win.text, win.wrong ? p.fail : p.fg),
    ...(typed && !win.wrong ? [blank(2), { text: '    ', bg: lc(toHex(typed)) }] : []),
  ]
  const tail: Row = win.wrong ? [ink('wrong input', p.border), blank(2)] : []
  const fill = Math.max(1, boxW - width(inside) - width(tail))
  const box: Row = [
    { text: '   ' },
    ink(String(win.stops.length + 1), inHand ? p.fg : p.border, inHand),
    blank(2),
    ...[...inside, blank(fill), ...tail].map(on(field)),
  ]
  const cells = strip(win.stops, inner - 6).map((h): Run => ({ text: ' ', bg: lc(h) }))
  return [[], ...stops, box, [], [blank(3), ...cells], []]
}
