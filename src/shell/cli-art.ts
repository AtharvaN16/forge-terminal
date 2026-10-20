import stringWidth from 'string-width'
import type { CliItem, CliTab } from '../core/cli-reference.js'
import { blank, clip, HOME_MARGIN, type Row, type Run, width as runsWidth } from './home-art.js'
import type { Palette } from './theme.js'

/**
 * /cli's drawing (decided 2026-10-19, mockups/cli-2026-10.html, option C):
 * the categories on a rule, every row a flag and what it does with the chosen
 * one banded as the menu's is, its example on a shelf under the list, and the
 * menu's scroll bar when there are more rows than room.
 */

/** Where each row's meaning starts, counted from the block's left edge. */
const NAME = 28

const pad = (row: Row, n: number, bg?: string): Row => {
  const w = runsWidth(row)
  return w >= n ? row : [...row, { text: ' '.repeat(n - w), ...(bg ? { bg } : {}) }]
}
const onBand = (row: Row, bg: string): Row => row.map((r) => ({ ...r, bg: r.bg ?? bg }))
const run = (text: string, fg?: string, bg?: string, bold = false): Run => ({
  text,
  ...(fg ? { fg } : {}),
  ...(bg ? { bg } : {}),
  ...(bold ? { bold: true } : {}),
})

/**
 * The category bar: each name with room either side, on a rule the width of
 * the block, heavy and gold under the chosen one. /about's, with the names
 * given.
 */
export function cliTabRows({
  palette: p,
  width: columns,
  tabs,
  at,
}: {
  palette: Palette
  width: number
  tabs: readonly CliTab[]
  at: number
}): Row[] {
  const names: Row = [blank(HOME_MARGIN)]
  const rule: Row = [blank(HOME_MARGIN)]
  let used = 0
  tabs.forEach((tab, i) => {
    const on = i === at
    const w = tab.name.length + 4
    names.push({ text: `  ${tab.name}  `, fg: on ? p.fg : p.dim, bold: on })
    rule.push({ text: (on ? '━' : '─').repeat(w), fg: on ? p.brand : p.faint })
    used += w
  })
  rule.push({ text: '─'.repeat(Math.max(0, columns - HOME_MARGIN * 2 - used)), fg: p.faint })
  return [names, rule]
}

/** One row: the menu's band and ▌ strip when chosen, the meaning after the name. */
function itemRow(p: Palette, item: CliItem, chosen: boolean, columns: number): Row {
  const room = Math.max(1, columns - 2 - NAME)
  if (chosen) {
    return onBand(
      pad(
        [
          run('▌', p.brand),
          blank(1),
          run(item.name.padEnd(NAME), p.fg, undefined, true),
          run(clip(item.does, room), p.dim),
        ],
        columns,
      ),
      p.panelBand,
    )
  }
  return [blank(2), run(item.name.padEnd(NAME), p.dim), run(clip(item.does, room), p.border)]
}

/**
 * `room` rows from `start`, then one row for "↓ n more" (only what is still
 * below) — and the scroll bar on the last column when not everything fits.
 */
export function cliListRows({
  palette: p,
  width: columns,
  items,
  at,
  start,
  room,
}: {
  palette: Palette
  width: number
  items: readonly CliItem[]
  at: number
  start: number
  room: number
}): Row[] {
  const scrolls = items.length > room
  // The bar takes the last two columns: one of room, one of its own.
  const w = scrolls ? columns - 2 : columns
  const shown = items.slice(start, start + room)
  const rows = shown.map((item, i) => itemRow(p, item, start + i === at, w))
  if (!scrolls) return [...rows, ...Array.from({ length: room - rows.length }, (): Row => []), []]
  const thumb = Math.max(1, Math.round((room * room) / items.length))
  const top = Math.round((start / (items.length - room)) * (room - thumb))
  const out = rows.map((row, i): Row => {
    const bar: Run = i >= top && i < top + thumb ? run('┃', p.dim) : run('│', p.faint)
    return [...pad(row, columns - 1), bar]
  })
  const below = items.length - start - room
  const note = `↓ ${below} more`
  out.push(below > 0 ? [blank(columns - 1 - stringWidth(note)), run(note, p.dim)] : [])
  return out
}

/**
 * The chosen row's example on a shelf like the home field's, a blank row
 * clear of the list. `copied` puts the confirmation at the shelf's far end.
 */
export function cliExampleRows({
  palette: p,
  width: columns,
  item,
  copied,
}: {
  palette: Palette
  width: number
  item: CliItem
  copied: boolean
}): Row[] {
  const bg = p.shelf === '' ? p.keycapBg : p.shelf
  const inner = columns - HOME_MARGIN * 2
  const left: Row = [blank(2), run('$ ', p.brand, bg, true), run(item.ex, p.fg, bg)]
  const done = copied ? '✓ copied' : ''
  const gap = Math.max(1, inner - runsWidth(left) - stringWidth(done) - 2)
  const shelf: Row = onBand(
    pad([...left, blank(gap), ...(copied ? [run(done, p.ok, bg, true)] : [])], inner, bg),
    bg,
  )
  return [[], [blank(HOME_MARGIN), ...shelf]]
}
