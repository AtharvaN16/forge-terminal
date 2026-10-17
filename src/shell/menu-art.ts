import type { Command } from './commands.js'
import { blank, type Row, type Run, width as runsWidth } from './home-art.js'
import { modeColours, type Palette } from './theme.js'

/**
 * The / menu's list (decided 2026-10-17, mockups/transcribe-2026-10-round2.html,
 * "/ menu" 1–7): the settings, then the modes, each group under a gold heading
 * with a faint rule to the edge and a blank row under it. Each command's name
 * sits in its own column, what it does after it. The chosen row is a band
 * across the width with a ▌ strip, the mode's colour for a mode and the
 * menu's gold for a setting. Everything fits; nothing scrolls.
 */

/** Where each row's description starts: the strip, a space, the name, and room. */
export const MENU_NAME_COLUMN = 16

const pad = (row: Row, n: number, bg?: string): Row => {
  const w = runsWidth(row)
  return w >= n ? row : [...row, { text: ' '.repeat(n - w), ...(bg ? { bg } : {}) }]
}

export function menuListRows(o: {
  palette: Palette
  width: number
  items: Command[]
  /** What is typed after the slash, as far as it matches: drawn bright on each row. */
  query: string
  /** What is typed after the slash, as typed. */
  typed: string
  selected: number
  /**
   * The rows there are for it. Short of them, the list tightens rather than
   * scrolling or being cut: first the blank under each heading goes, then the
   * one between the groups (a window kept a row short by its painted margin,
   * or a sixth mode).
   */
  rows?: number
}): Row[] {
  const draw = (underHeading: boolean, between: boolean) => listRows(o, underHeading, between)
  const full = draw(true, true)
  if (o.rows === undefined || full.length <= o.rows) return full
  const tighter = draw(false, true)
  return tighter.length <= o.rows ? tighter : draw(false, false)
}

function listRows(
  o: Parameters<typeof menuListRows>[0],
  underHeading: boolean,
  between: boolean,
): Row[] {
  const { palette: p, width: w } = o
  const out: Row[] = []
  const groups = [
    ['Settings', o.items.filter((c) => c.group === 'settings')],
    ['Modes', o.items.filter((c) => c.group === 'modes')],
  ] as const
  for (const [label, members] of groups) {
    if (members.length === 0) continue
    if (out.length > 0 && between) out.push([])
    out.push([
      blank(2),
      { text: label, fg: p.brand, bold: true },
      { text: ` ${'─'.repeat(Math.max(0, w - 3 - label.length))}`, fg: p.faint },
    ])
    if (underHeading) out.push([])
    for (const c of members) {
      const chosen = o.items.indexOf(c) === o.selected
      const strip = c.mode ? modeColours(p, c.mode).fg : p.brand
      const room = Math.max(1, w - MENU_NAME_COLUMN)
      const what =
        c.description.length > room ? `${c.description.slice(0, room - 1)}…` : c.description
      const name: Run[] = [
        { text: `/${o.query}`, fg: p.fg, bold: true },
        { text: c.name.slice(o.query.length), fg: chosen ? p.fg : p.dim, bold: chosen },
      ]
      const row: Row = [
        ...pad([{ text: chosen ? '▌' : ' ', fg: strip }, blank(1), ...name], MENU_NAME_COLUMN),
        { text: what, fg: chosen ? p.dim : p.border },
      ]
      out.push(chosen ? pad(row, w).map((r) => ({ ...r, bg: p.panelBand })) : row)
    }
  }
  if (o.items.length === 0)
    out.push([blank(2), { text: `no command matches /${o.typed}`, fg: p.dim }])
  return out
}
