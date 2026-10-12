import stringWidth from 'string-width'
import { formatBytes, percentChange } from '../core/units.js'
import { blank, HOME_MARGIN, type Row, type Run, width } from './home-art.js'
import { modeColours, type Palette, type ShellMode, SYMBOLS } from './theme.js'
import { middleEllipsis } from './width.js'

/**
 * Done (K3·a, mockups/flow-parts-2-2026-10.html tab "8 · Done ✓"): the file
 * as it was and as it is, two panels stacked, each as long as its file is
 * heavy. The larger of the two fills the block; what a smaller file shed is
 * grey hatching after its panel, what a larger one grew by is orange
 * hatching. "before" and "after" are tabs on the panels' top edges, in their
 * fills, and a short arrow in the mode's colour points from one to the other.
 *
 * Every number is measured — the file has been written — so the panels are
 * a picture of two real sizes, never progress (invariant 7). A panel too
 * short for its words keeps its true length: the words run on past the fill
 * on the middle row, and the rows above and below still show the proportion.
 *
 * Every row starts at column 0 and is at most the width less one margin.
 */

const M = HOME_MARGIN
/** Where the notes and the folder start: one cell in from the panels. */
const LEAD = M + 1

/** What the Done screen says about one written file. */
export interface DoneFacts {
  mode: ShellMode
  /** The source: its format's label ("PNG"), its file name and its size. */
  before: { format: string; name: string; bytes: number }
  /** The written file: its name and its measured size. */
  after: { name: string; bytes: number }
  /** The folder it was written to, as shown (`~/Desktop`). */
  folder: string
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
      out.push(w.slice(0, width))
      w = w.slice(width)
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

/** `runs` with the first `n` cells on `bg`, splitting the run that crosses it. */
function onFill(runs: Run[], n: number, bg: string | undefined): Run[] {
  const out: Run[] = []
  let left = n
  for (const run of runs) {
    const chars = [...run.text]
    const k = Math.max(0, Math.min(left, chars.length))
    if (k > 0) out.push({ ...run, text: chars.slice(0, k).join(''), bg })
    if (k < chars.length) out.push({ ...run, text: chars.slice(k).join('') })
    left -= k
  }
  return out
}

/** `n` cells of `╱` in one colour. */
const hatching = (n: number, fg: string): Run[] => (n > 0 ? [{ text: '╱'.repeat(n), fg }] : [])

/**
 * A panel's three rows: blank fill above and below, and on the middle row
 * `words` then `size` right-aligned with a cell to spare. Where the two do
 * not fit, the size follows the words a cell on, and the fill still stops
 * at `length`. `tail` is drawn after each row — the hatching — and is told
 * where the row has got to.
 */
function panel(
  length: number,
  bg: string | undefined,
  words: Run[],
  size: Run | undefined,
  tail: (from: number) => Run[] = () => [],
): Row[] {
  const plain = [blank(length)]
  const sized = size ? [size, { text: ' ' }] : []
  const gap = Math.max(1, length - width(words) - width(sized))
  const middle = [...words, blank(size ? gap : Math.max(0, length - width(words))), ...sized]
  const row = (runs: Run[]) => {
    const filled = onFill(runs, length, bg)
    return [blank(M), ...filled, ...tail(width(filled))]
  }
  return [row(plain), row(middle), row(plain)]
}

/** A tab on a panel's top edge, in the panel's fill. */
const tab = (label: string, run: Omit<Run, 'text'>): Row => [
  blank(M),
  { ...run, text: ` ${label} ` },
]

/**
 * The body, top to bottom: the before tab and panel, the arrow, the after
 * tab and panel, the change under the longer panel, a blank, the folder.
 */
export function doneBody({
  palette,
  facts,
  width: columns,
}: {
  palette: Palette
  facts: DoneFacts
  width: number
}): Row[] {
  const block = Math.max(1, columns - 2 * M)
  const bars = receiptBars(facts.before.bytes, facts.after.bytes, block)
  const wb = bars.before
  const wa = bars.after
  const mode = modeColours(palette, facts.mode).fg
  const beforeFill = fillOf(palette.selectionBg)
  const afterFill = fillOf(palette.panelBand)

  // Before: " PNG   test.png" and its size, dim, on the quiet fill.
  const beforeSize = formatBytes(facts.before.bytes)
  const tag = ` ${facts.before.format}   `
  const beforeName = middleEllipsis(
    facts.before.name,
    Math.max(1, block - stringWidth(tag) - stringWidth(beforeSize) - 2),
  )
  const before = panel(
    wb,
    beforeFill,
    [
      { text: ' ' },
      { text: facts.before.format, fg: palette.border },
      { text: '   ' },
      { text: beforeName, fg: palette.dim },
    ],
    { text: beforeSize, fg: palette.dim },
  )

  // After: "✓ test.jpg", bold. A smaller file's size sits just past its
  // panel, where the hatching begins; it moves inside, right-aligned, when
  // the file grew or when there is too little shed left to hold it.
  const afterSize = formatBytes(facts.after.bytes)
  const sizeRun: Run = { text: afterSize, fg: palette.fg, bold: true }
  const outside = stringWidth(afterSize) + 2
  const inside = bars.grew || wb - wa < outside
  const afterName = middleEllipsis(
    facts.after.name,
    Math.max(1, block - 3 - (inside ? stringWidth(afterSize) + 2 : outside)),
  )
  const words: Run[] = [
    { text: ' ' },
    { text: `${SYMBOLS.ok} `, fg: palette.ok, bold: true },
    { text: afterName, fg: palette.fg, bold: true },
  ]
  const end = Math.max(wa, wb)
  const shade = bars.grew ? palette.grownHatch : palette.faint
  const toEnd = (from: number) => hatching(end - from, shade)
  const after = inside
    ? panel(bars.grew ? wb : wa, afterFill, words, sizeRun, toEnd)
    : (() => {
        const rows = panel(wa, afterFill, words, undefined, toEnd)
        // The middle row: the words on the fill, then the size, then hatching.
        const filled = onFill([...words, blank(Math.max(0, wa - width(words)))], wa, afterFill)
        const sized: Run[] = [{ text: ' ' }, sizeRun, { text: ' ' }]
        rows[1] = [blank(M), ...filled, ...sized, ...toEnd(width(filled) + width(sized))]
        return rows
      })()

  // The change, ending where the longer panel ends.
  const phrase = changePhrase(facts.before.bytes, facts.after.bytes)
  const outcome = percentChange(facts.before.bytes, facts.after.bytes).direction
  const change: Row = [
    blank(M + Math.max(0, end - stringWidth(phrase))),
    { text: phrase, fg: outcome === 'larger' ? palette.larger : palette.ok, bold: true },
  ]

  const folder: Row = [
    blank(LEAD),
    { text: 'in ', fg: palette.border },
    { text: middleEllipsis(facts.folder, Math.max(1, columns - M - LEAD - 3)), fg: palette.dim },
  ]

  return [
    tab('before', { fg: palette.dim, bg: beforeFill }),
    ...before,
    [blank(M + 2), { text: '│', fg: mode }],
    [blank(M + 2), { text: '▼', fg: mode, bold: true }],
    tab('after', { fg: palette.fg, bg: afterFill, bold: true }),
    ...after,
    change,
    [],
    folder,
  ]
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
 * and a blank row above, the keys on the last row. The body sits a row
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
  const space = height - 5
  const centred = Math.max(0, Math.floor((space - body) / 2) - 1)
  const fixed = 3 + body
  if (notes === 0) {
    const top = Math.min(centred, Math.max(0, height - fixed))
    return { top, between: 0, bottom: Math.max(0, height - fixed - top) }
  }
  const room = space - notes - 1
  const top = Math.max(0, Math.min(centred, room - body - 1))
  const between = Math.max(1, room - top - body)
  return { top, between, bottom: Math.max(0, height - fixed - top - between - notes) }
}
