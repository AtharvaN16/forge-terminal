import { scrolledLines } from './about-art.js'
import type { Command } from './commands.js'
import { blank, HOME_MARGIN, type Row, type Run, width as runsWidth } from './home-art.js'
import { modeColours, type Palette } from './theme.js'

/**
 * The / menu's list (decided 2026-10-17, mockups/transcribe-2026-10-round2.html,
 * "/ menu" 1–7): the settings, then the modes, each group under a gold heading
 * with a faint rule to the edge and a blank row under it. Each command's name
 * sits in its own column, and the chosen one says what it does after it
 * (2026-10-18: only the chosen one). The chosen row is a band
 * across the width with a ▌ strip, the mode's colour for a mode and the
 * menu's gold for a setting. A window too short for all of it scrolls.
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
   * The rows there are for it. Short of them, the list scrolls with the chosen
   * row kept in view, a bar on its right and "↓ n more" under it, as About's
   * does; the gaps under the headings and between the groups stay.
   */
  rows?: number
}): Row[] {
  const full = listRows(o, o.width)
  if (o.rows === undefined || full.length <= o.rows) return full
  // The bar takes the last column and the note a row; the list is drawn two
  // columns narrower so the chosen band is not clipped.
  const room = Math.max(1, o.rows - 1)
  const lines = listRows(o, o.width - 2)
  const chosen = Math.max(
    0,
    lines.findIndex((r) => r[0]?.text === '▌'),
  )
  const start = Math.min(Math.max(0, chosen - Math.floor(room / 2)), lines.length - room)
  return scrolledLines({
    palette: o.palette,
    width: o.width + HOME_MARGIN,
    lines,
    start,
    room,
  })
}

function listRows(o: Parameters<typeof menuListRows>[0], w: number): Row[] {
  const { palette: p } = o
  const out: Row[] = []
  const groups = [
    ['Settings', o.items.filter((c) => c.group === 'settings')],
    ['Modes', o.items.filter((c) => c.group === 'modes')],
  ] as const
  for (const [label, members] of groups) {
    if (members.length === 0) continue
    if (out.length > 0) out.push([])
    out.push([
      blank(2),
      { text: label, fg: p.brand, bold: true },
      { text: ` ${'─'.repeat(Math.max(0, w - 3 - label.length))}`, fg: p.faint },
    ])
    out.push([])
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
      // Only the chosen row says what it does (2026-10-18).
      out.push(
        chosen
          ? pad(
              [
                ...pad([{ text: '▌', fg: strip }, blank(1), ...name], MENU_NAME_COLUMN),
                { text: what, fg: p.dim },
              ],
              w,
            ).map((r) => ({ ...r, bg: p.panelBand }))
          : [blank(2), ...name],
      )
    }
  }
  if (o.items.length === 0)
    out.push([blank(2), { text: `no command matches /${o.typed}`, fg: p.dim }])
  return out
}
