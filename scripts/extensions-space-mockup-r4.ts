/**
 * /extensions: the space taken, round four (2026-10-23). The user: "you
 * became tunnel visioned by D2", and "what happens if the list of extensions
 * becomes long". So this round varies where the figure lives — the header
 * bar, the row over the keys, the key row, the field, a pinned foot, the
 * list's own head, a row of its own for Forge — and draws every option twice:
 * with today's four tools, and with sixteen, the list scrolling ("↓ N more",
 * as the / menu's list does) since today it would simply overflow.
 *
 * The figures stay as round three settled them: Forge 35 MB, Extensions
 * 52 MB, 87 MB in all, whole MB, quiet greys, white numbers, no per-extension
 * size (D2, carried as it was, is the one exception).
 *
 *   npx tsx scripts/extensions-space-mockup-r4.ts   → mockups/extensions-space-2026-10-round4.html
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { DARK, modePalette } from '../src/shell/theme.js'
import { feedbackPage, type PageConcept } from './feedback-page.js'
import { type Cell, type Grid, termHtml } from './term-cells.js'

type Raw = { ch: string; fg: string | null; bg: string | null; b: boolean }
const frames = JSON.parse(
  readFileSync(new URL('./extensions-space-frames.json', import.meta.url), 'utf8'),
) as Record<string, Raw[][]>
const G = (k: string): Grid =>
  (frames[k] as Raw[][]).map((r) =>
    r.map((c) => ({ ch: c.ch, fg: c.fg ?? undefined, bg: c.bg ?? undefined, b: c.b })),
  )

const P = modePalette(DARK, 'menu')
const FG = '#e7e7e7'
const DIM = '#b0b0b0'
const QUIET = '#808080'
const FAINT = '#4d4d4d'
const GOLD = '#e5a23c'
const PANEL = '#2c2c2c'
const BAND = '#323232'
const CANVAS = '#1e1e1e'
const SHELF = '#242424'
const N = 100
const R = N - 4

type Seg = [text: string, fg?: string, bg?: string, bold?: boolean]
const len = (segs: Seg[]) => segs.reduce((n, [t]) => n + [...t].length, 0)
function put(g: Grid, r: number, at: number, segs: Seg[]): void {
  const row = g[r] as Cell[]
  let i = at
  for (const [text, fg, bg, bold] of segs)
    for (const ch of text) {
      const under = row[i]
      if (under) row[i] = { ch, fg, bg: bg ?? under.bg, b: !!bold }
      i++
    }
}
const textOf = (g: Grid, r: number) => (g[r] as Cell[]).map((c) => c.ch).join('')

/** The list's column: names at 10, the cursor's band 8–34, the mark at 33. */
const X = 8
const COL = 27
const END = X + COL - 1
const atEnd = (g: Grid, r: number, segs: Seg[]) => put(g, r, END - len(segs), segs)
const rule = (g: Grid, r: number) => put(g, r, X + 2, [['─'.repeat(COL - 3), FAINT]])

const FORGE = '35 MB'
const EXTS = '52 MB'
const ALL = '87 MB'

interface Item {
  name: string
  mark?: string
  size?: string
}
/** Today's four, as installed for the capture. */
const SHORT: Item[] = [
  { name: 'Boost resolution', mark: '✓', size: '15 MB' },
  { name: 'Remove background', mark: '✓', size: '33 KB' },
  { name: 'YouTube links', mark: '✓', size: '37 MB' },
  { name: 'Video and audio', mark: '✓', size: 'yours' },
]
/** Sixteen: today's, then tools Forge might offer later — placeholders, to see the list grow. */
const LONG: Item[] = [
  ...SHORT,
  { name: 'HEIC photos' },
  { name: 'Word documents', mark: '✓', size: 'yours' },
  { name: 'PDF compression' },
  { name: 'Text in images' },
  { name: 'Denoise audio' },
  { name: 'Upscale video' },
  { name: 'Subtitles' },
  { name: 'RAW photos' },
  { name: 'Voices' },
  { name: 'Colour profiles' },
  { name: 'Fonts' },
  { name: 'Archives' },
]
const CURSOR = 'YouTube links'

/**
 * The list redrawn on rows `from`–`to`: as many items as fit, the cursor's
 * band and gold bar on CURSOR, and — when some do not fit — the last row
 * says how many more, as the / menu's list does.
 */
function list(
  g: Grid,
  items: Item[],
  from: number,
  to: number,
  o: { sizes?: boolean; cursor?: string } = {},
) {
  for (let r = 4; r <= 17; r++) put(g, r, 4, [[' '.repeat(32), undefined, PANEL]])
  const room = to - from + 1
  const shown = items.length > room ? items.slice(0, room - 1) : items
  const on = o.cursor ?? CURSOR
  shown.forEach((it, i) => {
    const r = from + i
    if (it.name === on) {
      put(g, r, X, [[' '.repeat(COL), undefined, BAND]])
      put(g, r, X, [['▌', GOLD], [' '], [it.name, FG, undefined, true]])
    } else put(g, r, X + 2, [[it.name, DIM]])
    const right = o.sizes ? it.size : it.mark
    if (right) atEnd(g, r, [[right, it.name === on ? FG : o.sizes ? QUIET : DIM]])
  })
  if (items.length > room) {
    const more = `↓ ${items.length - shown.length} more`
    atEnd(g, to, [[more, QUIET]])
  }
  // The rule between list and sheet runs as far down as the list does.
  for (let r = 4; r <= Math.max(to, 4); r++) (g[r] as Cell[])[36] = { ch: '│', fg: FAINT }
}

/* ----------------------------------------------------------- options */

type Draw = (items: Item[]) => Grid

/** D2, carried: each row's size, then Forge, Extensions, the total under a rule. */
const d2: Draw = (items) => {
  const g = G('yt')
  const foot = 5
  list(g, items, 4, Math.min(17 - foot, 4 + items.length - 1), { sizes: true })
  const top = Math.min(4 + items.length, 17 - foot + 1) + 0
  rule(g, top)
  put(g, top + 1, X + 2, [['Forge', DIM]])
  atEnd(g, top + 1, [[FORGE, DIM]])
  put(g, top + 2, X + 2, [['Extensions', DIM]])
  atEnd(g, top + 2, [[EXTS, DIM]])
  put(g, top + 4, X + 2, [['Total', FG, undefined, true]])
  atEnd(g, top + 4, [[ALL, FG, undefined, true]])
  return g
}

/** P1 · the row over the keys, where "/ menu" sits: one full-width line, never in the list's way. */
const p1: Draw = (items) => {
  const g = G('yt')
  list(g, items, 4, 17)
  put(g, 21, 4, [
    ['Forge ', QUIET],
    [FORGE, DIM],
    ['   ·   ', FAINT],
    ['Extensions ', QUIET],
    [EXTS, DIM],
  ])
  return g
}

/** P2 · the key row's footnote: the total, quiet, beside i about. */
const p2: Draw = (items) => {
  const g = G('yt')
  list(g, items, 4, 17)
  const at = textOf(g, 23).indexOf('i about')
  put(g, 23, at - len([[`${ALL} · `]]), [
    [ALL, FG],
    [' · ', QUIET],
  ])
  return g
}

/** P3 · the header bar: the total knocked out of the hatching, before the screen's name. */
const p3: Draw = (items) => {
  const g = G('yt')
  list(g, items, 4, 17)
  const at = textOf(g, 2).indexOf(' Extensions')
  const words: Seg[] = [
    [' ', undefined, CANVAS],
    [ALL, FG, CANVAS, true],
    [' ', undefined, CANVAS],
  ]
  put(g, 2, at - len(words) - 1, words)
  return g
}

/** P4 · a foot pinned to the bottom of the list's column; the list scrolls above it. */
const p4: Draw = (items) => {
  const g = G('yt')
  list(g, items, 4, 14)
  rule(g, 15)
  put(g, 16, X + 2, [['Forge', QUIET]])
  atEnd(g, 16, [[FORGE, DIM]])
  put(g, 17, X + 2, [['Extensions', QUIET]])
  atEnd(g, 17, [[EXTS, DIM]])
  return g
}

/** The sheet for Forge itself: its name, its version, and a card of its sizes. */
function forgeSheet(g: Grid) {
  const S = 39
  for (let r = 4; r <= 17; r++) put(g, r, S - 1, [[' '.repeat(R - S + 1), undefined, PANEL]])
  put(g, 4, S, [['Forge', FG, undefined, true]])
  put(g, 5, S, [['Version 0.4.5', DIM]])
  const L = S
  const W = 54
  put(g, 7, L, [
    ['╭─ ', QUIET],
    ['space', GOLD, undefined, true],
    [` ${'─'.repeat(W - 10)}╮`, QUIET],
  ])
  const side = (r: number, segs: Seg[]) => {
    put(g, r, L, [['│', QUIET]])
    put(g, r, L + 3, segs)
    put(g, r, L + W - 1, [['│', QUIET]])
  }
  side(8, [])
  side(9, [
    ['Forge      ', QUIET],
    [FORGE, DIM],
  ])
  side(10, [
    ['Extensions ', QUIET],
    [EXTS, DIM],
  ])
  side(11, [])
  side(12, [
    ['Total      ', QUIET],
    [ALL, FG, undefined, true],
  ])
  side(13, [])
  put(g, 14, L, [[`╰${'─'.repeat(W - 2)}╯`, QUIET]])
  for (let r = 4; r <= 14; r++) (g[r] as Cell[])[36] = { ch: '│', fg: FAINT }
}

/** P5 · Forge as the list's first row, a rule under it: its sheet holds the sizes, in the facts card. */
const p5: Draw = (items) => {
  const g = G('yt')
  list(g, [{ name: 'Forge' }], 4, 4, { cursor: 'Forge' })
  rule(g, 5)
  const rest = (g[6] as Cell[]).slice()
  void rest
  list2(g, items, 6, 17)
  // Forge's own row, back over the cleared column.
  put(g, 4, X, [[' '.repeat(COL), undefined, BAND]])
  put(g, 4, X, [['▌', GOLD], [' '], ['Forge', FG, undefined, true]])
  rule(g, 5)
  forgeSheet(g)
  return g
}
/** The list on rows `from`–`to` without clearing the column above `from`. */
function list2(g: Grid, items: Item[], from: number, to: number) {
  const room = to - from + 1
  const shown = items.length > room ? items.slice(0, room - 1) : items
  shown.forEach((it, i) => {
    const r = from + i
    put(g, r, 4, [[' '.repeat(32), undefined, PANEL]])
    put(g, r, X + 2, [[it.name, DIM]])
    if (it.mark) atEnd(g, r, [[it.mark, DIM]])
  })
  if (items.length > room) atEnd(g, to, [[`↓ ${items.length - shown.length} more`, QUIET]])
}

/** P6 · the list's own head: the total above the names, the list scrolling under it. */
const p6: Draw = (items) => {
  const g = G('yt')
  list(g, items, 6, 17)
  put(g, 4, X + 2, [['On this Mac', QUIET]])
  atEnd(g, 4, [[ALL, FG, undefined, true]])
  rule(g, 5)
  return g
}

/** P7 · the field's far end, on its shelf, where a key hint would sit. */
const p7: Draw = (items) => {
  const g = G('yt')
  list(g, items, 4, 17)
  const words: Seg[] = [
    [ALL, DIM, SHELF],
    [' on this Mac', QUIET, SHELF],
  ]
  put(g, 19, R - 2 - len(words), words)
  return g
}

/* --------------------------------------------------------------- page */

const shot = (g: Grid) => termHtml(P, g)
const both = (draw: Draw) =>
  `<div class="both"><figure class="fr">${shot(draw(SHORT))}<figcaption>today’s four</figcaption></figure><figure class="fr">${shot(draw(LONG))}<figcaption>sixteen — the list scrolls</figcaption></figure></div>`

const concepts: PageConcept[] = [
  {
    id: 'D2',
    earlier: 'love',
    section: 'YOUR PICK SO FAR',
    name: 'Just the numbers, under the list',
    idea: 'Round two’s D2, drawn long: the figures stay under the list, so a long list must scroll above them.',
    html: both(d2),
  },
  {
    id: 'P1',
    section:
      'NEW — where the figure lives, not only how it reads. Each drawn with today’s four tools, then with sixteen.',
    name: 'The row over the keys',
    idea: 'Where “/ menu” sits: one quiet full-width line. The list can grow as long as it likes; the line never moves.',
    html: both(p1),
  },
  {
    id: 'P2',
    name: 'In the key row’s footnote',
    idea: '87 MB, quiet, at the head of the footnote beside i about — among the things always true of the screen. Only the number fits beside the keys.',
    html: both(p2),
  },
  {
    id: 'P3',
    name: 'In the header bar',
    idea: 'The total knocked out of the hatching, just before the screen’s name: the size of the whole screen, said where its title is.',
    html: both(p3),
  },
  {
    id: 'P4',
    name: 'A foot pinned under the list',
    idea: 'Forge and Extensions held at the bottom of the list’s column, under a rule; a long list scrolls above them.',
    html: both(p4),
  },
  {
    id: 'P5',
    name: 'Forge as the first row',
    idea: 'Forge itself is the list’s first row, set apart by a rule; its sheet holds the sizes in the same facts card as the tools. Nothing extra on the screen until you go to it.',
    html: both(p5),
  },
  {
    id: 'P6',
    name: 'The list’s own head',
    idea: 'On this Mac · 87 MB as the list’s title, a rule under it; the names scroll under the head.',
    html: both(p6),
  },
  {
    id: 'P7',
    name: 'At the field’s far end',
    idea: 'On the field’s shelf, where a key hint would sit: 87 MB on this Mac. The bottom of the screen, always in the same place.',
    html: both(p7),
  },
]

const before = `<div class="box"><h3>What this round asks</h3>
<p><b>Where</b> the figure lives, not just how it reads — every option shown with today’s four tools and with sixteen. Today the list does not scroll: sixteen tools would push anything under it off the screen. Drawn here, it scrolls the way the / menu’s list does, its last row saying “↓ N more”.</p>
<p class="note">The twelve extra tools are placeholders, to see the list grow — not a plan.</p></div>
<div class="box"><h3>Words to approve</h3><p>“Forge” · “Extensions” · “Total” · “on this Mac” · “On this Mac” (P6) · “Version 0.4.5”, the card’s tag “space” (P5) · “↓ N more” (as the / menu has it).</p></div>
<style>
.both{display:flex;flex-direction:column;gap:12px}
.fr{margin:0;display:flex;flex-direction:column;gap:6px}
.fr figcaption{font-size:13px;color:#a9aebb}
.box .note{color:#a9aebb}
</style>`

writeFileSync(
  'mockups/extensions-space-2026-10-round4.html',
  feedbackPage({
    page: 'extensions-space-2026-10-round4',
    title: 'Forge · space, round 4: where it lives',
    heading: '/extensions — where the space lives',
    lede: 'Seven places for Forge’s size and its extensions’, each drawn with today’s list and a long one.',
    before,
    concepts,
  }),
)
console.log('wrote mockups/extensions-space-2026-10-round4.html')
if (process.env.DUMP)
  for (const d of [d2, p1, p2, p3, p4, p5, p6, p7])
    console.log(
      `${d(LONG)
        .map((r) => r.map((c) => c.ch).join(''))
        .join('\n')}\n${'='.repeat(N)}`,
    )
