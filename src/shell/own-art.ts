import { blank, type Row, type Run, width as widthOf } from './home-art.js'
import type { Palette } from './theme.js'
import { endEllipsis } from './width.js'

/**
 * The sheet of a tool a user may already have — yt-dlp, ffmpeg — in
 * /extensions (mockups/own-tools-2026-10-round11.html). Three levels, the
 * same in every state:
 *
 * 1. a header: the tool's name and what it gives, the one action as a white
 *    pill at the right — what ↵ does;
 * 2. a card of facts, the app's bordered card with the tool's tag in its top
 *    edge as the file card has: Status alone, a gap, then Path, Version…,
 *    a row of padding inside each edge;
 * 3. under the card, the one other thing there is to do.
 */
export interface OwnSheetView {
  name: string
  gives: string
  /** The header's pill: "↵ install", "↵ use it", "↵ update". None when nothing is to do. */
  action?: string | undefined
  /** The card's tag: the tool's own name. */
  tag: string
  /** Label, then the value's runs. The first is Status, set apart from the rest. */
  facts: Array<[label: string, value: Run[]]>
  /** The fact, by label, whose value is a field to drop or type a path into. */
  field?: string | undefined
  /** Under the card: the one other thing. */
  under?: Run[] | undefined
}

/** The labels' column: "Version" and two cells. */
const LABEL = 10
/** Labels start this far in from the card's left edge. */
const IN = 3

const fill = (c: string) => (c === '' ? undefined : c)

/** `runs` cut to `room` cells: the last run that does not fit ends in an ellipsis. */
function cut(runs: Run[], room: number): Run[] {
  const out: Run[] = []
  let left = room
  for (const run of runs) {
    if (left <= 0) break
    const w = widthOf([run])
    if (w <= left) {
      out.push(run)
      left -= w
    } else {
      out.push({ ...run, text: endEllipsis(run.text, left) })
      left = 0
    }
  }
  return out
}

/** The pill: the key and words in the ink, on the pill's white, a cell either side. */
export function pillRuns(p: Palette, words: string): Run[] {
  const bg = fill(p.pill)
  if (bg === undefined) return [{ text: `[${words}]`, fg: p.fg, bold: true }]
  return [{ text: ` ${words} `, fg: p.ink, bg, bold: true }]
}

export function ownSheetRows(p: Palette, v: OwnSheetView, width: number): Row[] {
  const rows: Row[] = []
  // 1 · header
  const pill = v.action ? pillRuns(p, v.action) : []
  const name: Run = { text: v.name, fg: p.fg, bold: true }
  const gap = Math.max(1, width - widthOf([name]) - widthOf(pill))
  rows.push([name, ...(pill.length ? [blank(gap), ...pill] : [])])
  rows.push(cut([{ text: v.gives, fg: p.dim }], width))
  // A space, not an empty row: an empty one takes no height on screen.
  const gapRow: Row = [blank(1)]
  rows.push(gapRow)
  // 2 · the card
  const edge = p.border
  const inner = width - 2
  const tag: Run[] = [
    { text: '╭─ ', fg: edge },
    { text: v.tag, fg: p.brand, bold: true },
    { text: ' ', fg: edge },
  ]
  rows.push([...tag, { text: `${'─'.repeat(Math.max(0, width - widthOf(tag) - 1))}╮`, fg: edge }])
  const side = (content: Run[]): Row => {
    const body = cut(content, inner)
    return [{ text: '│', fg: edge }, ...body, blank(inner - widthOf(body)), { text: '│', fg: edge }]
  }
  const padding = side([])
  rows.push(padding)
  v.facts.forEach(([label, value], i) => {
    if (i === 1) rows.push(padding)
    const head: Run[] = [blank(IN - 1), { text: label.padEnd(LABEL), fg: p.border }]
    if (v.field === label) {
      // The field: the shelf's fill from the value's column to a cell short
      // of the edge, its caret in the screen's gold, as home's field has.
      const room = inner - (IN - 1) - LABEL - 1
      const shelf = fill(p.shelf)
      const words = cut([{ text: '› ', fg: p.brand, bold: true }, ...value], room - 2)
      const body: Run[] = [blank(1), ...words]
      const runs = body.map((r) => (shelf ? { ...r, bg: shelf } : r))
      rows.push(
        side([
          ...head.slice(0, 1),
          { text: label.padEnd(LABEL - 1), fg: p.border },
          ...runs,
          shelf
            ? { text: ' '.repeat(Math.max(0, room - widthOf(body))), bg: shelf }
            : blank(room - widthOf(body)),
        ]),
      )
    } else rows.push(side([...head, ...value]))
  })
  rows.push(padding)
  rows.push([{ text: `╰${'─'.repeat(Math.max(0, width - 2))}╯`, fg: edge }])
  // 3 · under the card
  if (v.under) rows.push(gapRow, cut(v.under, width))
  return rows
}
