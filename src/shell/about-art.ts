import stringWidth from 'string-width'
import type { CreditSection } from '../core/attributions.js'
import { blank, clip, HOME_MARGIN, type Row, type Run, width } from './home-art.js'
import type { Palette } from './theme.js'

/** Where /about's content starts: two in from the margin, under the tabs' words. */
export const ABOUT_INDENT = HOME_MARGIN + 2

export interface AboutLink {
  label: string
  url: string
  /** The address as the page shows it, without the scheme. */
  shown: string
}

export const ABOUT_LINKS: readonly AboutLink[] = [
  { label: 'GitHub', url: 'https://github.com/AtharvaN16', shown: 'github.com/AtharvaN16' },
  { label: 'Portfolio', url: 'https://atharvanayak.design/', shown: 'atharvanayak.design' },
  {
    label: 'Report a bug',
    url: 'https://github.com/AtharvaN16/forge-terminal/issues',
    shown: 'github.com/AtharvaN16/forge-terminal/issues',
  },
]

export const ABOUT_TABS = ['About', 'Attributions'] as const

/**
 * The tab bar (L2, mockup round 3): each name with room either side, on a
 * rule the width of the block, heavy and gold under the active one. Under
 * NO_COLOR the active name keeps its bold and the rule its weight.
 */
export function aboutTabRows({
  palette,
  width: columns,
  at,
}: {
  palette: Palette
  width: number
  at: number
}): Row[] {
  const M = HOME_MARGIN
  const names: Row = [blank(M)]
  const rule: Row = [blank(M)]
  let used = 0
  ABOUT_TABS.forEach((name, i) => {
    const on = i === at
    const w = name.length + 4
    names.push({ text: `  ${name}  `, fg: on ? palette.fg : palette.dim, bold: on })
    rule.push({ text: (on ? '━' : '─').repeat(w), fg: on ? palette.brand : palette.faint })
    used += w
  })
  rule.push({ text: '─'.repeat(Math.max(0, columns - M * 2 - used)), fg: palette.faint })
  return [names, rule]
}

/**
 * The links as small pills in one row (K4, mockup round 4), shaped like
 * /update's ↵ update: the chosen one in the pill's white, the rest on the
 * key caps' grey. Without fills (NO_COLOR, first-run neutral) the chosen
 * one is bracketed instead.
 */
export function aboutPillRow({
  palette,
  at,
  plain = false,
}: {
  palette: Palette
  at: number
  /** NO_COLOR: no fills to tell the chosen pill by. */
  plain?: boolean
}): Row {
  const filled = !plain && palette.pill !== '' && palette.keycapBg !== ''
  const row: Row = [blank(ABOUT_INDENT)]
  ABOUT_LINKS.forEach((link, i) => {
    if (i > 0) row.push(blank(2))
    const on = i === at
    const text = ` ${link.label} ↗ `
    if (filled)
      row.push(
        on
          ? { text, fg: palette.ink, bg: palette.pill, bold: true }
          : { text, fg: palette.fg, bg: palette.keycapBg, bold: true },
      )
    else row.push({ text: on ? `[${text.trim()}]` : ` ${text.trim()} `, fg: palette.fg, bold: on })
  })
  return row
}

/** Name, licence and what it does: the columns of Attributions. */
const NAME = 30
const LICENCE = 24

/**
 * Every line of Attributions, unscrolled (T1, mockup round 3): each section's
 * title in the menu's gold on a faint rule, as the menu heads its
 * groups, a blank line, then a row per part, and a blank line before each
 * section but the first. The main parts are bright and say what they do; the rest are dim.
 */
export function creditLines({
  palette,
  width: columns,
  sections,
}: {
  palette: Palette
  width: number
  sections: CreditSection[]
}): Row[] {
  const W = columns - ABOUT_INDENT - HOME_MARGIN
  const lines: Row[] = []
  sections.forEach((section, i) => {
    if (i > 0) lines.push([])
    lines.push([
      blank(ABOUT_INDENT),
      { text: section.title, fg: palette.brand, bold: true },
      {
        // Two short of the width: a row that reaches the scroll bar's column is
        // clipped to plain text, which drew the heading white on a bright rule.
        text: ` ${'─'.repeat(Math.max(0, W - stringWidth(section.title) - 4))}`,
        fg: palette.faint,
      },
    ])
    lines.push([])
    for (const c of section.credits) {
      const main = c.does !== undefined
      lines.push([
        blank(ABOUT_INDENT),
        {
          text: clip(c.name, NAME - 2).padEnd(NAME),
          fg: main ? palette.fg : palette.dim,
          bold: main,
        },
        { text: clip(c.licence, LICENCE - 2).padEnd(LICENCE), fg: palette.dim },
        ...(main ? [{ text: clip(c.does ?? '', W - NAME - LICENCE), fg: palette.border }] : []),
      ])
    }
  })
  return lines
}

/**
 * `room` lines from `start`, with the commands list's scroll bar on the
 * block's last column (S2) and, under them, "↓ n more" for only what is
 * still below — or nothing, at the end.
 */
export function scrolledLines({
  palette,
  width: columns,
  lines,
  start,
  room,
}: {
  palette: Palette
  width: number
  lines: Row[]
  start: number
  room: number
}): Row[] {
  const end = columns - HOME_MARGIN
  const shown = lines.slice(start, start + room)
  if (lines.length <= room) return [...shown, []]
  const thumb = Math.max(1, Math.round((room * room) / lines.length))
  const at = Math.round((start / (lines.length - room)) * (room - thumb))
  const out = shown.map((row, i): Row => {
    const fitted: Row = width(row) >= end - 1 ? [{ text: clip(text(row), end - 2) }] : row
    const bar: Run =
      i >= at && i < at + thumb ? { text: '┃', fg: palette.dim } : { text: '│', fg: palette.faint }
    return [...fitted, blank(end - 1 - width(fitted)), bar]
  })
  const below = lines.length - start - room
  const note = `↓ ${below} more`
  out.push(below > 0 ? [blank(end - stringWidth(note)), { text: note, fg: palette.dim }] : [])
  return out
}

const text = (row: Row) => row.map((r) => r.text).join('')

/** The furthest `start` can go: the last line at the bottom of the window. */
export const lastStart = (lines: number, room: number) => Math.max(0, lines - room)
