import { clockOf, stepLabel, timeOf } from '../core/timecode.js'
import { blank, mix, type Row, type Run, width as widthOf } from './home-art.js'
import type { Palette } from './theme.js'

/**
 * Trim's screen, drawn (video spec §3.4, mockups/video-2026-10-round3.html
 * "Edit · Trim"): the sound as peaks, the bar of what is kept, the I and O
 * chips under its handles, and the start and end fields. Pure: rows of runs.
 */

/** What the arrows move: the start (I), the end (O) or the range (space). */
export type Moving = 'start' | 'end' | 'range'

const PEAK_ROWS = 3
/** The column of `t` seconds on a bar `width` wide. */
const columnOf = (t: number, duration: number, width: number) =>
  duration > 0 ? Math.round((Math.max(0, Math.min(t, duration)) / duration) * (width - 1)) : 0

const moves = (active: Moving, end: 'start' | 'end') => active === end || active === 'range'

/**
 * The sound as peaks: a plain vertical line per column rising from the
 * bottom row, as tall as that moment is loud, its top in half cells (╷).
 * White where it is kept, grey where it is cut. `null`: no sound, a faint
 * flat line. `undefined`: still being read, nothing yet.
 */
export function peaksRows({
  palette,
  levels,
  start,
  end,
  duration,
  width,
}: {
  palette: Palette
  levels: readonly number[] | null | undefined
  start: number
  end: number
  duration: number
  width: number
}): Row[] {
  if (levels === undefined) return Array.from({ length: PEAK_ROWS }, () => [])
  if (levels === null) {
    return [
      ...Array.from({ length: PEAK_ROWS - 1 }, (): Row => [blank(width)]),
      [{ text: '·'.repeat(width), fg: palette.faint }],
    ]
  }
  const lo = columnOf(start, duration, width)
  const hi = columnOf(end, duration, width)
  return Array.from({ length: PEAK_ROWS }, (_, r): Row => {
    const up = PEAK_ROWS - 1 - r
    const row: Row = []
    for (let i = 0; i < width; i++) {
      const v = levels[Math.floor((i / width) * levels.length)] ?? 0
      const h = Math.max(1, Math.round(v * PEAK_ROWS * 2))
      const covered = Math.max(0, Math.min(2, h - 2 * up))
      const ch = covered === 2 ? '│' : covered === 1 ? '╷' : ' '
      const fg = i >= lo && i <= hi ? palette.fg : palette.faint
      const last = row[row.length - 1]
      if (last && last.fg === fg) last.text += ch
      else row.push({ text: ch, fg })
    }
    return row
  })
}

/**
 * What is kept, as a filled bar: the mode's tint (its colour mixed into the
 * canvas), cut in grey, a handle at each end in `colour`; a handle being
 * moved is the slider's white thumb. Orange (`larger`) for a GIF past 15 s.
 */
export function barRow({
  palette,
  start,
  end,
  duration,
  width,
  active,
  colour = palette.accent,
}: {
  palette: Palette
  start: number
  end: number
  duration: number
  width: number
  active: Moving
  colour?: string
}): Row {
  const lo = columnOf(start, duration, width)
  const hi = columnOf(end, duration, width)
  const tint = mix(palette.canvas, colour, 0.45)
  return Array.from({ length: width }, (_, i): Run => {
    if (i === lo || i === hi) {
      const on = (i === lo && moves(active, 'start')) || (i === hi && moves(active, 'end'))
      return { text: ' ', bg: on ? palette.thumb : colour }
    }
    return { text: ' ', bg: i > lo && i < hi ? tint : palette.track }
  })
}

/**
 * Under the bar: the I and O chips at their handles — in the mode's colour
 * when that end moves, grey when it does not — and the minutes, faint,
 * wherever a chip is not.
 */
export function handlesRow({
  palette,
  start,
  end,
  duration,
  width,
  active,
}: {
  palette: Palette
  start: number
  end: number
  duration: number
  width: number
  active: Moving
}): Row {
  type Cell = { ch: string; fg?: string; bg?: string; bold?: boolean; own?: boolean }
  const cells: Cell[] = Array.from({ length: width }, () => ({ ch: ' ' }))
  const put = (x: number, text: string, style: Omit<Cell, 'ch'>) => {
    ;[...text].forEach((ch, k) => {
      const c = cells[x + k]
      if (c) Object.assign(c, { ch, ...style })
    })
  }
  const free = (x: number, n: number) =>
    x >= 0 && x + n <= width && cells.slice(x, x + n).every((c) => !c.own)
  const chip = (on: boolean) => ({
    fg: on ? palette.ink : palette.fg,
    bg: on ? palette.accent : palette.keycapBg,
    bold: true,
    own: true,
  })
  const ix = Math.max(0, columnOf(start, duration, width) - 1)
  // Two handles closer than their chips: O's sits just after I's.
  const ox = Math.min(width - 3, Math.max(ix + 3, columnOf(end, duration, width) - 1))
  put(ix, ' I ', chip(moves(active, 'start')))
  put(ox, ' O ', chip(moves(active, 'end')))
  // A mark every minute, or every ten for an hour or more; the end always.
  const every = duration >= 3600 ? 600 : duration >= 600 ? 300 : duration >= 120 ? 30 : 10
  for (let t = 0; t <= duration; t += every) {
    const label = clockOf(t)
    const x = t === 0 ? 0 : columnOf(t, duration, width) - 1
    if (free(Math.max(0, x - 1), label.length + 2)) put(x, label, { fg: palette.faint })
  }
  const last = clockOf(duration)
  if (free(width - last.length - 1, last.length + 1)) {
    put(width - last.length, last, { fg: palette.faint })
  }
  const row: Row = []
  for (const c of cells) {
    const prev = row[row.length - 1]
    if (prev && prev.fg === c.fg && prev.bg === c.bg && !!prev.bold === !!c.bold) prev.text += c.ch
    else row.push({ text: c.ch, fg: c.fg, bg: c.bg, bold: c.bold })
  }
  return row
}

/**
 * Above the key row: `start` and `end`, both white, the time that moves on a
 * chip in the mode's tint (both for the range), the other plain grey; the
 * grey `tab` cap at the far right. `typed` replaces the chosen time while a
 * time is being typed.
 */
export function fieldsRow({
  palette,
  start,
  end,
  width,
  active,
  typed,
}: {
  palette: Palette
  start: number
  end: number
  width: number
  active: Moving
  typed?: string | undefined
}): Row {
  const tint = mix(palette.canvas, palette.accent, 0.45)
  const field = (label: string, t: number, on: boolean): Row => {
    const shown = on && typed !== undefined && active !== 'range' ? typed : timeOf(t)
    return [
      { text: label, fg: palette.fg },
      blank(2),
      on
        ? { text: ` ${shown.padEnd(6)} `, fg: palette.fg, bg: tint, bold: true }
        : { text: ` ${shown.padEnd(6)} `, fg: palette.dim },
    ]
  }
  const left: Row = [
    ...field('start', start, moves(active, 'start')),
    blank(4),
    ...field('end', end, moves(active, 'end')),
  ]
  const tab: Run = { text: ' tab ', fg: palette.dim, bg: palette.keycapBg }
  return [...left, blank(Math.max(1, width - widthOf(left) - 5)), tab]
}

/** `step ‹ 1 s ›`: how far ←→ moves; [ ] change it. An end with no step that way is faint. */
export function stepRow({
  palette,
  seconds,
  canDown,
  canUp,
}: {
  palette: Palette
  seconds: number
  canDown: boolean
  canUp: boolean
}): Row {
  return [
    { text: 'step  ', fg: palette.dim },
    { text: '‹ ', fg: canDown ? palette.dim : palette.faint },
    { text: stepLabel(seconds), fg: palette.fg, bold: true },
    { text: ' ›', fg: canUp ? palette.dim : palette.faint },
  ]
}
