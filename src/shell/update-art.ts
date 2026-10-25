import stringWidth from 'string-width'
import type { ReleaseNote } from '../update/check.js'
import { wrapWords } from './done-art.js'
import { blank, clip, type Row, type Run, width as rowWidth } from './home-art.js'
import type { Palette } from './theme.js'

/**
 * /update's what's new card (U4, mockups/whatsnew-2026-10.html): the
 * release's notes on a grey card under a grey "what's new" chip, each name
 * bold in a column of its own and its sentence beside it in grey. Past its
 * room the card scrolls a note at a time, with the commands list's bar (S2)
 * on its last column and "↓ n more" under it.
 */

/** Room around the notes inside the card: two columns before, the bar and one after. */
const PAD = 2
const GAP = 2
const AFTER = 1
/** The card's columns that are not the notes': `noteLines` gets the rest. */
export const CARD_CHROME = PAD + GAP + 1 + AFTER
/** The card's rows that are not the notes': the chip, the gap under it, the "more" row. */
export const CARD_ROWS = 3

/** The notes' lines, and for each line which note it belongs to. */
export interface NoteLayout {
  rows: Row[]
  items: number[]
}

/** The names' column: as wide as the longest, three columns before the sentences. */
export function noteLines({
  palette,
  notes,
  width,
}: {
  palette: Palette
  notes: readonly ReleaseNote[]
  width: number
}): NoteLayout {
  const nameCol = Math.max(0, ...notes.map((n) => stringWidth(n.title))) + 3
  const textWidth = Math.max(8, width - nameCol)
  const rows: Row[] = []
  const items: number[] = []
  notes.forEach((n, item) => {
    if (item > 0) {
      rows.push([])
      items.push(item - 1)
    }
    wrapWords(n.text, textWidth).forEach((line, k) => {
      const name = clip(n.title, nameCol - 3)
      rows.push([
        k === 0
          ? { text: name + ' '.repeat(nameCol - stringWidth(name)), fg: palette.fg, bold: true }
          : blank(nameCol),
        { text: line, fg: palette.dim },
      ])
      items.push(item)
    })
  })
  return { rows, items }
}

/** Each note's first line: where a scroll can stop. */
export function noteStarts(items: readonly number[]): number[] {
  return items.flatMap((item, k) => (k === 0 || items[k - 1] !== item ? [k] : []))
}

/** The furthest a scroll goes: the first note from which the rest fits, so it ends on a whole note. */
export function lastNoteStart(items: readonly number[], room: number): number {
  const starts = noteStarts(items)
  return starts.find((k) => items.length - k <= room) ?? starts.at(-1) ?? 0
}

/**
 * The card, `width` wide and `room` + CARD_ROWS tall, the notes shown from
 * line `start`. `lit` while the notes are chosen: the thumb turns from grey
 * to white. Only what is still below is counted: notes scrolled off the top
 * were already read (the commands list's rule, 2026-10-13).
 */
export function noteCard({
  palette,
  version,
  laid,
  width,
  start,
  room,
  lit,
}: {
  palette: Palette
  version: string
  laid: NoteLayout
  width: number
  start: number
  room: number
  lit: boolean
}): Row[] {
  // The popup's darker grey, as /extensions' frame: `band` takes the mode's
  // tint, and the card was blue-green when the menu was opened from compress.
  const bg = palette.shelf
  const card = (row: Row): Row => {
    const runs = row.map((r): Run => ({ ...r, bg: r.bg ?? bg }))
    return [...runs, { text: ' '.repeat(Math.max(0, width - rowWidth(runs))), bg }]
  }
  const { rows, items } = laid
  const inner = width - CARD_CHROME
  const scrolls = rows.length > room
  const shown = rows.slice(start, start + room)
  const thumb = Math.max(1, Math.round((room * room) / Math.max(1, rows.length)))
  const at = scrolls ? Math.round((start / (rows.length - room)) * (room - thumb)) : 0

  const body = Array.from({ length: room }, (_, i): Row => {
    const row = shown[i] ?? []
    const fitted: Row =
      rowWidth(row) > inner ? [{ text: clip(row.map((r) => r.text).join(''), inner) }] : row
    if (!scrolls) return card([blank(PAD), ...fitted])
    const on = i >= at && i < at + thumb
    const bar: Run = {
      text: on ? '┃' : '│',
      fg: on ? (lit ? palette.fg : palette.dim) : palette.faint,
    }
    return card([blank(PAD), ...fitted, blank(inner - rowWidth(fitted) + GAP), bar])
  })

  const seen = new Set(items.slice(start, start + room))
  const below = new Set(items.slice(start + room).filter((i) => !seen.has(i))).size
  const note = `↓ ${below} more`
  const more: Row =
    below > 0 ? [blank(width - AFTER - stringWidth(note)), { text: note, fg: palette.dim }] : []

  return [
    card([
      { text: " what's new ", fg: palette.fg, bg: palette.panelBand, bold: true },
      { text: ` in ${version}`, fg: palette.dim },
    ]),
    card([]),
    ...body,
    card(more),
  ]
}
