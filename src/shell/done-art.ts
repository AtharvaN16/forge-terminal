import stringWidth from 'string-width'
import { formatBytes, percentChange } from '../core/units.js'
import { blank, HOME_MARGIN, mix, type Row, type Run, width } from './home-art.js'
import { modeColours, type Palette, type ShellMode, SYMBOLS } from './theme.js'
import { middleEllipsis } from './width.js'

/**
 * Done (round 24, mockups/done-2026-10-round18.html): the file as it was and
 * as it is, as one bar five rows tall and as long as the larger of the two.
 * The part both share is the band, in the mode's colour, the new file's name
 * on it; what a smaller file shed is grey hatching, and what a larger one
 * grew by is a fill. Above the bar and touching it, a strip on the shelf
 * grey, padded by half a row above and below: the formats at its left
 * ("PNG → WebP", the new one leading), the change at its right. Under the
 * bar, after a blank row, the two sizes, each word over its size, the
 * smaller file on the left.
 *
 * Every number is measured — the file has been written — so the bar is a
 * picture of two real sizes, never progress (invariant 7). A file too small
 * for its name keeps its true length: the name runs on past the band.
 *
 * Every row starts at column 0 and is at most the width less one margin.
 */

const M = HOME_MARGIN
/** Where the notes start: one cell in from the bar. */
const LEAD = M + 1

/** What the Done screen says about one written file. */
export interface DoneFacts {
  mode: ShellMode
  /** The source: its format's label ("PNG"), its file name and its size. */
  before: { format: string; name: string; bytes: number }
  /** The written file: its format's label, its name and its measured size. */
  after: { format: string; name: string; bytes: number }
}

/**
 * Bar lengths for two sizes on one scale. The larger side gets every cell;
 * the other is scaled to it and never drawn empty unless it really is zero
 * bytes. Two zeros draw as two full bars — "the same", which they are.
 */
export function receiptBars(
  before: number,
  after: number,
  cells: number,
): { before: number; after: number; grew: boolean } {
  const big = Math.max(before, after)
  if (big === 0) return { before: cells, after: cells, grew: false }
  const scale = (n: number) => (n === 0 ? 0 : Math.max(1, Math.round((cells * n) / big)))
  return { before: scale(before), after: scale(after), grew: after > before }
}

/**
 * The longest head of `word` that fits in `width` columns, and the rest.
 * Walks code points by display width, so a wide character is never split or
 * left hanging past the edge; always takes at least one, so it makes progress
 * even when a character is wider than the line.
 */
function breakWord(word: string, width: number): [string, string] {
  let head = ''
  let used = 0
  for (const ch of word) {
    const w = stringWidth(ch)
    if (head && used + w > width) break
    head += ch
    used += w
  }
  return [head, word.slice(head.length)]
}

/** Word-wraps `text` to `width` columns, hard-breaking any longer word. */
export function wrapWords(text: string, width: number): string[] {
  const out: string[] = []
  let line = ''
  for (const word of text.split(/\s+/).filter(Boolean)) {
    let w = word
    while (stringWidth(w) > width) {
      if (line) {
        out.push(line)
        line = ''
      }
      const [head, rest] = breakWord(w, width)
      out.push(head)
      w = rest
    }
    if (!w) continue
    if (!line) line = w
    else if (stringWidth(`${line} ${w}`) <= width) line = `${line} ${w}`
    else {
      out.push(line)
      line = w
    }
  }
  if (line) out.push(line)
  return out
}

/** "37.6% smaller", "45.5% larger" or "same size". */
export function changePhrase(from: number, to: number): string {
  const { pct, direction } = percentChange(from, to)
  return direction === 'same' ? 'same size' : `${pct}% ${direction}`
}

/** A colour as a run's fill: none where the palette has none. */
const fillOf = (colour: string) => (colour === '' ? undefined : colour)

interface Cell {
  ch: string
  fg?: string | undefined
  bg?: string | undefined
  bold?: boolean | undefined
}

/** `row`'s runs written over `cells` from column `at`, each cell keeping its fill. */
function writeOver(cells: Cell[], at: number, row: Run[]): void {
  let i = at
  for (const run of row) {
    for (const ch of run.text) {
      const under = cells[i]
      if (under) cells[i] = { ch, fg: run.fg, bg: under.bg, bold: run.bold }
      i++
    }
  }
}

/** Cells back into runs, one per stretch of the same style. */
function runsOf(cells: Cell[]): Run[] {
  const out: Run[] = []
  for (const c of cells) {
    const last = out[out.length - 1]
    if (last && last.fg === c.fg && last.bg === c.bg && !!last.bold === !!c.bold) last.text += c.ch
    else out.push({ text: c.ch, fg: c.fg, bg: c.bg, bold: c.bold })
  }
  return out
}

/**
 * What the change can be called, longest first: "47.4 KB saved · 38.9%
 * smaller" (or "+500 KB · 45.5% larger"), then the percentage alone. The same
 * size is only ever "same size".
 */
function changeLabels(from: number, to: number): string[] {
  const phrase = changePhrase(from, to)
  if (from === to) return [phrase]
  const diff = formatBytes(Math.abs(to - from))
  return [to > from ? `+${diff} · ${phrase}` : `${diff} saved · ${phrase}`, phrase]
}

/** How tall the bar is; three rows when the screen needs the room. */
const BAR_ROWS = 5
const COMPACT_BAR_ROWS = 3

/**
 * The body, top to bottom: the strip (half a row, the formats and the
 * change, half a row), the bar (five rows), a blank row, and the two sizes,
 * each word over its size.
 */
export function doneBody({
  palette,
  facts,
  width: columns,
  folder,
  draw,
  chain,
  compact = false,
}: {
  palette: Palette
  facts: DoneFacts
  width: number
  /**
   * The bar drawing itself once (M5a), each part 0 to 1; at rest without it.
   * `bar` takes a smaller file's band from the old length back to the new
   * one, or pushes a larger file's growth out from the old length; `label`
   * fades the change's words in. Both sizes are measured before this draws,
   * so it only ever moves towards the true picture (invariant 7).
   */
  draw?: { bar: number; label: number } | undefined
  /**
   * Where the file went, as shown (`~/Desktop`): a row under the sizes. The
   * scrollback keeps it (audit #9: a mistyped destination must be visible
   * once the screen is gone); the live screen's header already says it.
   */
  folder?: string | undefined
  /**
   * Every format the file has been, once Continue editing changed it
   * ("PNG", "JPEG", "WebP"): the strip says each step, the last one leading.
   */
  chain?: readonly string[] | undefined
  /**
   * Room is short (an error panel needs it): the bar three rows tall, the
   * strip without its half rows and no blank row under the bar — six rows,
   * as many as the old design, the same picture.
   */
  compact?: boolean | undefined
}): Row[] {
  const block = Math.max(1, columns - 2 * M)
  const { before, after } = facts
  const bars = receiptBars(before.bytes, after.bytes, block)
  const shared = Math.min(bars.before, bars.after)
  const same = before.bytes === after.bytes
  const outcome = bars.grew ? palette.larger : palette.ok
  // The band is the new file, in the mode's colour stepped halfway back to
  // the background; the shed part is hatched in a quiet grey. A palette
  // without fills (NO_COLOR) draws no band and hatches in its border grey.
  const band =
    palette.panelBand === '' || palette.canvas === ''
      ? undefined
      : mix(modeColours(palette, facts.mode).fg, palette.canvas, 0.5)
  const hatchFg = palette.canvas ? mix(palette.border, palette.canvas, 0.55) : palette.border
  const shelf = fillOf(palette.shelf)

  // The strip: the formats from its left, the change flush to its right,
  // on the shelf grey, with half a row of it above and below. The formats
  // are quiet up to the last, which leads.
  const steps =
    chain && chain.length > 1
      ? chain
      : before.format === after.format
        ? [after.format]
        : [before.format, after.format]
  const formats: Run[] = [{ text: ' ' }]
  steps.forEach((step, i) => {
    const last = i === steps.length - 1
    if (i > 0) formats.push({ text: ' → ', fg: palette.border })
    formats.push({ text: step, fg: last ? palette.fg : palette.dim, bold: last })
  })
  const strip: Cell[] = Array.from({ length: block }, (): Cell => ({ ch: ' ', bg: shelf }))
  writeOver(strip, 0, formats)
  // A narrow strip keeps the formats first: the change shortens, then goes.
  const label = changeLabels(before.bytes, after.bytes).find(
    (l) => block - width(formats) - (stringWidth(l) + 2) >= 1,
  )
  const fade = draw?.label ?? 1
  if (label !== undefined && fade > 0) {
    // Fading in, the words come up out of the strip's grey.
    const ink = same ? palette.dim : outcome
    writeOver(strip, block - stringWidth(label) - 2, [
      {
        text: ` ${label} `,
        fg: fade < 1 ? mix(palette.shelf || palette.canvas, ink, fade) : ink,
        bold: !same,
      },
    ])
  }
  const half = (ch: string): Row =>
    palette.shelf === '' ? [] : [blank(M), { text: ch.repeat(block), fg: palette.shelf }]

  // The bar's cells: the shared part on the band, then the change. What a
  // file shed is hatching on the background; growth is a fill, or shade
  // where there is none.
  const growth: Cell = palette.grownFill
    ? { ch: ' ', bg: palette.grownFill }
    : { ch: '▒', fg: palette.larger }
  const k = draw?.bar ?? 1
  const bandNow = bars.grew ? shared : Math.round(block - (block - shared) * k)
  const grownNow = bars.grew ? Math.round((block - shared) * k) : 0
  const cellsOf = (): Cell[] =>
    Array.from({ length: block }, (_, i): Cell => {
      if (i < bandNow) return { ch: ' ', bg: band }
      if (!bars.grew) return { ch: '╱', fg: hatchFg }
      return i < shared + grownNow ? { ...growth } : { ch: ' ' }
    })
  // The middle row names the new file from the left, knocked out of the
  // hatching with a cell to spare.
  const mid = cellsOf()
  writeOver(mid, 0, [
    { text: ' ' },
    { text: `${SYMBOLS.ok} `, fg: palette.ok, bold: true },
    { text: `${middleEllipsis(after.name, Math.max(1, block - 5))} `, fg: palette.fg, bold: true },
  ])
  const row = (cells: Cell[]): Row => [blank(M), ...runsOf(cells)]
  const tall = compact ? COMPACT_BAR_ROWS : BAR_ROWS
  const barRows = Array.from({ length: tall }, (_, r) =>
    r === tall >> 1 ? row(mid) : row(cellsOf()),
  )

  // Under the bar: each word quiet over its size, the smaller file on the
  // left. The new size takes the outcome's colour.
  const now = {
    word: { text: 'now', fg: palette.dim },
    size: { text: formatBytes(after.bytes), fg: same ? palette.fg : outcome, bold: true },
  }
  const was = {
    word: { text: 'was', fg: palette.border },
    size: { text: formatBytes(before.bytes), fg: palette.fg, bold: true },
  }
  const [left, right] = bars.grew ? [was, now] : [now, was]
  const ends = (a: Run, b: Run): Row => [blank(M), a, blank(Math.max(1, block - width([a, b]))), b]

  const body = [
    ...(compact ? [row(strip)] : [half('▄'), row(strip), half('▀')]),
    ...barRows,
    ...(compact ? [] : [[]]),
    ends(left.word, right.word),
    ends(left.size, right.size),
  ]
  if (folder === undefined) return body
  const where: Row = [
    blank(LEAD),
    { text: 'in ', fg: palette.border },
    { text: middleEllipsis(folder, Math.max(1, columns - M - LEAD - 3)), fg: palette.dim },
  ]
  return [...body, [], where]
}

/**
 * What the result says besides the sizes, at the foot of the body: the
 * offers (`✧`, in the accent, as the key that takes one is) and then any
 * warning, word-wrapped, in `warn`.
 */
export function doneNotes({
  palette,
  offers,
  warnings,
  width: columns,
}: {
  palette: Palette
  /** Whole sentences, `✧` and all. */
  offers: string[]
  /** Warning messages; the `⚠` is added here. */
  warnings: string[]
  width: number
}): Row[] {
  const room = Math.max(8, columns - 2 * M - 4)
  const lines = (text: string, fg: string): Row[] =>
    wrapWords(text, room).map((line) => [blank(LEAD), { text: line, fg }])
  return [
    ...offers.flatMap((offer) => lines(offer, palette.accent)),
    ...warnings.flatMap((w) => lines(`${SYMBOLS.warn} ${w}`, palette.warn)),
  ]
}

/**
 * The blank rows around the body, for a screen `height` rows tall: the bar
 * and a blank row above, the keys on the last row under their rule. The body sits a row
 * above the middle of the space between them; the notes end four rows above
 * the keys, with at least a row between them and the body. Blank rows above
 * the body go first when the screen is short; it never cuts the body.
 */
export function doneLayout({
  height,
  body,
  notes,
}: {
  height: number
  body: number
  notes: number
}): { top: number; between: number; bottom: number } {
  const space = height - 6
  const centred = Math.max(0, Math.floor((space - body) / 2) - 1)
  const fixed = 4 + body
  if (notes === 0) {
    const top = Math.min(centred, Math.max(0, height - fixed))
    return { top, between: 0, bottom: Math.max(0, height - fixed - top) }
  }
  const room = space - notes - 1
  const top = Math.max(0, Math.min(centred, room - body - 1))
  const between = Math.max(1, room - top - body)
  return { top, between, bottom: Math.max(0, height - fixed - top - between - notes) }
}
