import stringWidth from 'string-width'
import { formatBytes, percentChange } from '../core/units.js'
import { blank, HOME_MARGIN, mix, type Row, type Run, width } from './home-art.js'
import { colourProp, modeColours, type Palette, type ShellMode, SYMBOLS } from './theme.js'
import { middleEllipsis } from './width.js'

/**
 * Done (B6a, mockups/round-5-2026-10.html): the file as it was and as it is,
 * as one bar as long as the larger of the two. The part both share is on the
 * band, the new file's name on it; what a smaller file shed is hatching, and
 * what a larger one grew by is a fill, with the change written inside it.
 * Under the bar, after a blank row, the two sizes: the smaller on the left.
 * A chip above it says the formats, "PNG → JPEG".
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
/** The least of a long name the bar keeps before it gives up the change. */
const NAME_MIN = 20

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

/**
 * The body, top to bottom: the formats' chip, the bar (three rows), a blank
 * row, and the two sizes.
 */
export function doneBody({
  palette,
  facts,
  width: columns,
  folder,
  draw,
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
}): Row[] {
  const block = Math.max(1, columns - 2 * M)
  const { before, after } = facts
  const bars = receiptBars(before.bytes, after.bytes, block)
  const shared = Math.min(bars.before, bars.after)
  const mode = modeColours(palette, facts.mode)
  const band = fillOf(palette.panelBand)
  const same = before.bytes === after.bytes
  const outcome = bars.grew ? palette.larger : palette.ok

  // The chip: the formats, said once when they are the same.
  const formats =
    before.format === after.format ? before.format : `${before.format} → ${after.format}`
  const chip: Row = [
    blank(M),
    { text: ` ${formats} `, fg: mode.fg, bg: fillOf(mode.bg), bold: true },
  ]

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
      if (!bars.grew) return { ch: '╱', fg: palette.shedHatch }
      return i < shared + grownNow ? { ...growth } : { ch: ' ' }
    })

  // The middle row: the new file's name from the left, the change flush to
  // the bar's end, each knocked out of the hatching with a cell to spare. A
  // narrow bar keeps the name readable first — whole, or at least NAME_MIN
  // columns of it — so the change shortens, then goes.
  const keep = Math.min(stringWidth(after.name), NAME_MIN)
  const label = changeLabels(before.bytes, after.bytes).find(
    (l) => block - stringWidth(l) - 1 - 5 >= keep,
  )
  const labelAt = label === undefined ? block : block - stringWidth(label) - 1
  const name = middleEllipsis(after.name, Math.max(1, labelAt - 5))
  const mid = cellsOf()
  writeOver(mid, 0, [
    { text: ' ' },
    { text: `${SYMBOLS.ok} `, fg: palette.ok, bold: true },
    { text: `${name} `, fg: palette.fg, bold: true },
  ])
  const fade = draw?.label ?? 1
  if (label !== undefined && fade > 0) {
    // Fading in, the words come up out of what they sit on.
    const under = bars.grew ? palette.grownFill || palette.canvas : palette.canvas
    const ink = same ? palette.dim : outcome
    writeOver(mid, labelAt, [
      { text: ' ' },
      { text: label, fg: fade < 1 ? mix(under, ink, fade) : ink, bold: !same },
    ])
    // The same size has no change to sit in: the label keeps a cell from the end.
    if (same) mid.push(...mid.splice(labelAt, 1))
  }
  const row = (cells: Cell[]): Row => [blank(M), ...runsOf(cells)]

  // Under the bar: the smaller size on the left, the larger on the right. The
  // new size sits on a chip of the bar's grey, a cell either side, so it
  // reads as the answer; the old one is bare.
  const shelf = colourProp(palette.panelBand)
  const now: Run[] = [
    { text: ' now ', fg: palette.border, bg: shelf },
    { text: formatBytes(after.bytes), fg: palette.fg, bold: true, bg: shelf },
    { text: ' ', bg: shelf },
  ]
  const was: Run[] = [
    { text: 'was ', fg: palette.border },
    { text: formatBytes(before.bytes), fg: palette.dim },
  ]
  const [left, right] = bars.grew ? [was, now] : [now, was]
  const gap = Math.max(1, block - width(left) - width(right))
  const sizes: Row = [blank(M), ...left, blank(gap), ...right]

  const body = [chip, row(cellsOf()), row(mid), row(cellsOf()), [], sizes]
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
