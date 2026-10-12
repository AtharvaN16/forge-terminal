import stringWidth from 'string-width'
import type { Command } from './commands.js'
import {
  MODE_ORDER,
  modeColours,
  modeGradient,
  type Palette,
  type ShellMode,
  VERSION,
} from './theme.js'

/**
 * The home screen's drawn parts — the brand band, the mode tabs and the drop
 * surface — as rows of styled runs. Pure, so each one can be held to the
 * decided mockup (mockups/flow-parts-2026-10.html, tabs 2 and 3) cell for
 * cell; `Home.tsx` only lays the rows out.
 *
 * The colour arithmetic is the mockup's own, kept exactly: a dot's tint is a
 * function of its column, its row and its distance from the middle, and any
 * rounding done differently shows up as a different colour in every cell.
 */

export interface Run {
  text: string
  fg?: string | undefined
  bg?: string | undefined
  bold?: boolean | undefined
}
export type Row = Run[]

/** Columns kept clear either side of the block. */
export const HOME_MARGIN = 2

/** FORGE in half blocks, three rows tall. */
export const WORDMARK3 = [
  '█▀▀▀ █▀▀█ █▀▀▄ █▀▀▀ █▀▀▀',
  '█▀▀  █  █ █▀▀▄ █ ▀█ █▀▀ ',
  '▀    ▀▀▀▀ ▀  ▀ ▀▀▀▀ ▀▀▀▀',
]

const HEX = /^#[0-9a-f]{6}$/i

function channels(hex: string): number[] {
  return [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16))
}

/**
 * `a` moved `k` of the way to `b`. A colour that is not a hex value — the
 * first-run palette's ANSI names — cannot be mixed, so `b` is used as it is.
 */
export function mix(a: string, b: string, k: number): string {
  if (!HEX.test(a) || !HEX.test(b)) return b
  const t = Math.max(0, Math.min(1, k))
  const from = channels(a)
  const to = channels(b)
  return `#${from
    .map((v, i) =>
      Math.round(v + ((to[i] ?? v) - v) * t)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`
}

/** The colour at step `i` of `n` along `stops`. */
export function gradientAt(i: number, n: number, stops: readonly string[]): string {
  const first = stops[0] ?? ''
  const p = (Math.max(0, Math.min(n - 1, i)) / Math.max(1, n - 1)) * (stops.length - 1)
  const k = Math.floor(p)
  return mix(stops[k] ?? first, stops[Math.min(stops.length - 1, k + 1)] ?? first, p - k)
}

export const blank = (n: number): Run => ({ text: ' '.repeat(Math.max(0, n)) })
export const width = (row: Row) => row.reduce((n, run) => n + stringWidth(run.text), 0)

/** What the drop surface lists under "Drop a file here", by mode. */
export const MODE_KINDS: Record<ShellMode, string> = {
  convert: 'images · HEIC · PDF · Word',
  // Not "video": compress has no video engine, and the line is a promise.
  compress: 'images · PDF',
  pdf: 'split · merge · rotate',
  colour: 'palette · scale',
}

/**
 * Diagonal hatching whose colour follows the absolute column, `from` onwards,
 * so the three stacked rows line up into one band.
 */
export function hatch(
  from: number,
  n: number,
  row: number,
  span: number,
  stops: readonly string[],
): Run[] {
  const runs: Run[] = []
  for (let i = 0; i < n; i++) {
    runs.push({ text: '╱', fg: gradientAt(from + i + row * 2, span, stops) })
  }
  return runs
}

/**
 * FORGE knocked out of a band of hatching in the mode's gradient, with the
 * version knocked out of the bottom row at the right end, on the letters'
 * baseline. Empty when the terminal is too narrow for the word.
 */
export function brandRows({
  width: columns,
  palette,
  mode,
}: {
  width: number
  palette: Palette
  mode: ShellMode
}): Row[] {
  const M = HOME_MARGIN
  const W = columns - M * 2
  const stops = modeGradient(palette, mode)
  const span = columns + 8
  const word = WORDMARK3[0]?.length ?? 0
  // The hatching after the word: the block, less the lead-in hatch, the word
  // and a space either side of it.
  const after = W - word - 3
  if (after < 2) return []

  const version = `v${VERSION}`
  const tail = 2
  const room = after - tail - version.length - 2

  return WORDMARK3.map((letters, i) => {
    const row: Row = [
      blank(M),
      ...hatch(M, 1, i, span, stops),
      blank(1),
      { text: letters, fg: palette.fg, bold: true },
      blank(1),
    ]
    const c0 = M + word + 3
    if (i === WORDMARK3.length - 1 && room >= 1) {
      row.push(
        ...hatch(c0, room, i, span, stops),
        blank(1),
        { text: version, fg: palette.dim },
        blank(1),
        ...hatch(c0 + after - tail, tail, i, span, stops),
      )
    } else {
      row.push(...hatch(c0, after, i, span, stops))
    }
    return row
  })
}

/**
 * The numbered modes, then "/ commands". The active one is a folder tab — a
 * half-cell lip on the row above, and its label on the panel's fill — so it
 * reads as part of the surface below it. "/ commands" is always there, dim
 * at rest; while the field holds a command it is the active tab, and no mode
 * is. Where the output goes sits at the right end of the row: in full
 * ("saves to ~/Desktop") when there is room, the destination alone when
 * there is not (four tabs fill most of 80 columns), and nothing when even
 * that would collide with the tabs.
 */
export function tabRows({
  width: columns,
  palette,
  mode,
  savesTo,
  right = { label: 'saves to', value: savesTo },
  commands = false,
}: {
  width: number
  palette: Palette
  mode: ShellMode
  savesTo: string
  /** Where results go, when not a folder: colour mode copies to the clipboard. */
  right?: { label: string; value: string }
  /** The command list is open: "/ commands" is the active tab. */
  commands?: boolean
}): Row[] {
  const M = HOME_MARGIN
  const W = columns - M * 2
  const fill = palette.selectionBg
  const top: Row = [blank(M)]
  const tabs: Row = []
  const tab = (key: string, keyColour: string, name: string, active: boolean) => {
    const w = key.length + name.length + 3
    if (active) {
      top.push({ text: '▄'.repeat(w), fg: fill })
      tabs.push(
        { text: ' ', bg: fill },
        { text: key, fg: keyColour, bg: fill, bold: true },
        { text: ' ', bg: fill },
        { text: name, fg: palette.fg, bg: fill, bold: true },
        { text: ' ', bg: fill },
      )
    } else {
      top.push(blank(w))
      tabs.push(
        blank(1),
        { text: key, fg: palette.border, bold: key === '/' },
        blank(1),
        { text: name, fg: palette.dim },
        blank(1),
      )
    }
    top.push(blank(1))
    tabs.push(blank(1))
  }
  MODE_ORDER.forEach((m, i) => {
    tab(String(i + 1), modeColours(palette, m).fg, m, !commands && m === mode)
  })
  tab('/', modeColours(palette, mode).fg, 'commands', commands)

  const full: Row = [
    { text: right.label, fg: palette.border },
    blank(1),
    { text: right.value, fg: palette.dim },
    blank(1),
  ]
  const short: Row = [{ text: right.value, fg: palette.dim }, blank(1)]
  const row: Row = [blank(M), ...tabs]
  const saves = [full, short].find((r) => W - width(tabs) - width(r) >= 1)
  if (saves) row.push(blank(W - width(tabs) - width(saves)), ...saves)
  return [top, row]
}

/** How wide a command's name column is, slash included. */
const NAME_COLUMN = 12

/**
 * The commands, drawn on the drop surface's fill in place of its dots: the
 * modes, then the settings, each under a dim heading and only when something
 * in it matches. A row is the slash, what has been typed (bright), the rest
 * of the name and its description. The chosen row is the picker's — a band
 * with a `▌` strip — and the strip takes the colour of the mode the command
 * would switch to.
 *
 * At least `rows` tall, so it takes the surface's place exactly; taller when
 * the list needs it, up to `max`, past which the rows scroll to keep the
 * chosen one in view.
 */
export function commandRows({
  width: columns,
  rows: h,
  max = h,
  palette,
  items,
  query,
  typed,
  selected,
  panel = true,
}: {
  width: number
  rows: number
  max?: number
  palette: Palette
  items: Command[]
  query: string
  typed: string
  selected: number
  /**
   * On the drop surface's fill (home), or on the terminal's own background
   * under a field that has no surface to swap it into.
   */
  panel?: boolean
}): Row[] {
  const M = HOME_MARGIN
  const W = columns - M * 2
  const fill = panel ? palette.selectionBg : ''
  const band = panel ? palette.panelBand : palette.listBand
  const line = (runs: Run[]): Row => {
    const row = runs.map((run) => ({ ...run, bg: run.bg ?? fill }))
    return [blank(M), ...row, { text: ' '.repeat(Math.max(0, W - width(row))), bg: fill }]
  }

  const lines: Row[] = []
  let chosenLine = 0
  for (const group of ['modes', 'settings'] as const) {
    const members = items.filter((c) => c.group === group)
    if (members.length === 0) continue
    if (lines.length > 0) lines.push(line([]))
    lines.push(line([{ text: '    ' }, { text: group, fg: palette.border }]))
    for (const c of members) {
      const chosen = items.indexOf(c) === selected
      const rest = c.name.slice(query.length)
      const name: Run[] = [
        { text: `/${query}`, fg: palette.fg, bold: true },
        { text: rest, fg: chosen ? palette.fg : palette.dim, bold: chosen },
        { text: ' '.repeat(Math.max(1, NAME_COLUMN - 1 - c.name.length)) },
      ]
      if (!chosen) {
        lines.push(line([{ text: '    ' }, ...name, { text: c.description, fg: palette.border }]))
        continue
      }
      chosenLine = lines.length
      const strip = c.mode ? modeColours(palette, c.mode).fg : palette.fg
      const inner: Run[] = [
        { text: '▌', fg: strip },
        { text: ' ' },
        ...name,
        { text: c.description, fg: palette.dim },
      ].map((run) => ({ ...run, bg: band }))
      const bandWidth = Math.max(0, W - 4)
      lines.push(
        line([
          { text: '  ' },
          ...inner,
          { text: ' '.repeat(Math.max(0, bandWidth - width(inner))), bg: band },
        ]),
      )
    }
  }
  if (items.length === 0) {
    lines.push(line([{ text: '    ' }, { text: `no command matches /${typed}`, fg: palette.dim }]))
  }

  const room = Math.max(1, max - 2)
  const start = Math.min(Math.max(0, chosenLine - room + 1), Math.max(0, lines.length - room))
  const shown = lines.slice(start, start + room)
  const out = [line([]), ...shown, line([])]
  while (out.length < h) out.push(line([]))
  return out
}

/** Shortens `text` to `max` columns with a trailing ellipsis. */
export function clip(text: string, max: number): string {
  if (stringWidth(text) <= max) return text
  let out = ''
  for (const ch of text) {
    if (stringWidth(`${out}${ch}…`) > max) break
    out += ch
  }
  return `${out}…`
}

/**
 * The drop surface: a filled panel with a grid of dots, one every third
 * column, tinted by the mode's gradient — fainter towards the middle — and the
 * words centred in one clean rectangle cut out of the dots. The cut-out is
 * widened until each side meets a dot, so the gap is even either side.
 *
 * While a path is being typed the whole surface steps back, so the field
 * below it leads.
 */
export function surfaceRows({
  width: columns,
  rows: h,
  palette,
  mode,
  typing,
  kinds,
}: {
  width: number
  rows: number
  palette: Palette
  mode: ShellMode
  typing: boolean
  kinds: string
}): Row[] {
  const M = HOME_MARGIN
  const W = columns - M * 2
  const fill = palette.selectionBg
  const stops = modeGradient(palette, mode)
  const accent = modeColours(palette, mode).fg

  const title: Row = [
    { text: '↓', fg: typing ? palette.border : accent, bold: true },
    blank(2),
    { text: 'Drop a file here', fg: typing ? palette.dim : palette.fg, bold: true },
  ]
  const sub: Row = [
    { text: clip(kinds, Math.max(1, W - 2)), fg: typing ? palette.faint : palette.dim },
  ]
  const lines = [title, sub]

  const isDot = (c: number) => c % 3 === 0 && c >= 3 && c <= W - 4
  const mid = (h - 1) / 2
  const dot = (c: number, r: number) => {
    const tint = gradientAt(c + r * 2, W + 14, stops)
    const dx = Math.abs(c - W / 2) / (W / 2)
    const dy = mid === 0 ? 0 : Math.abs(r - mid) / mid
    const k = 0.3 + 0.45 * Math.min(1, Math.hypot(dx, dy * 0.6))
    return mix(fill, tint, typing ? k * 0.45 : k)
  }

  const top = Math.floor((h - lines.length) / 2)
  const words = Math.max(...lines.map(width))
  let a = Math.max(0, Math.floor((W - words - 8) / 2))
  let b = W - a
  while (a > 0 && !isDot(a - 1)) a--
  while (b < W && !isDot(b)) b++
  const cut = b - a

  const out: Row[] = []
  for (let r = 0; r < h; r++) {
    const line = lines[r - top]
    const row: Row = [blank(M)]
    let c = 0
    while (c < W) {
      if (line && c === a) {
        const left = Math.floor((cut - width(line)) / 2)
        row.push(
          { text: ' '.repeat(Math.max(0, left)), bg: fill },
          ...line.map((run) => ({ ...run, bg: fill })),
          { text: ' '.repeat(Math.max(0, cut - left - width(line))), bg: fill },
        )
        c += cut
        continue
      }
      const lit = r >= 1 && r <= h - 2 && isDot(c)
      row.push(lit ? { text: '·', fg: dot(c, r), bg: fill } : { text: ' ', bg: fill })
      c++
    }
    out.push(row)
  }
  return out
}
