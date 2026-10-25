/**
 * The steps row in one frame (2026-10-24): the user asked to see the steps
 * line drawn as Done's way on (Y31) — one shelf-grey frame, three rows, the
 * values in it — with `m done` as its own block beside it, as Home is.
 * The screen under it is the Palette tab as built (dev), captured by
 * scripts/palette-steps-capture.tsx at 80 × 26.
 *
 *   npx tsx scripts/palette-steps-frame-mockup.ts → mockups/palette-steps-frame-2026-10.html
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { DARK, modeColours, modePalette } from '../src/shell/theme.js'
import { feedbackPage, type PageConcept } from './feedback-page.js'
import { type Cell, type Grid, termHtml } from './term-cells.js'

const P = modePalette(DARK, 'colour')
const TONE = modeColours(DARK, 'colour')
const CANVAS = DARK.canvas
const SHELF = DARK.shelf
const CAP = DARK.keycapBg
const PILL = DARK.fieldBand
const THUMB = DARK.thumb
const INK = DARK.ink
const FG = DARK.fg
const DIM = DARK.dim
const QUIET = DARK.border

type Raw = { ch: string; fg: string | null; bg: string | null; b: boolean }
const FRAMES = JSON.parse(
  readFileSync(new URL('./palette-steps-frames.json', import.meta.url), 'utf8'),
) as Record<string, Raw[][]>
const frame = (k: string): Grid =>
  (FRAMES[k] as Raw[][]).map((r) =>
    r.map((c) => ({ ch: c.ch, fg: c.fg ?? undefined, bg: c.bg ?? CANVAS, b: c.b })),
  )

/** The block's columns (the rule's), and the rows the frame takes: the detail line, More's row and the rule. */
const LEFT = 4
const BLOCK = 72
const TOP = 22
const KEYS = 25

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
const blankRow = (g: Grid, r: number) => {
  g[r] = Array.from({ length: 80 }, () => ({ ch: ' ', bg: CANVAS }))
}
/** `segs` on all three rows, the words only on the middle one, so fills run the full height. */
function three(g: Grid, at: number, segs: Seg[]): void {
  const bare = segs.map(([t, , bg]): Seg => [' '.repeat([...t].length), undefined, bg])
  put(g, TOP, at, bare)
  put(g, TOP + 1, at, segs)
  put(g, TOP + 2, at, bare)
}

function keyRow(g: Grid): void {
  blankRow(g, KEYS)
  put(g, KEYS, LEFT + 1, [
    [' ←→ ', FG, CAP, true],
    [' change', DIM],
  ])
  const foot: Seg[] = [
    ['esc', FG, undefined, true],
    [' cancel', QUIET],
    [' · ', QUIET],
    ['ctrl-c', FG, undefined, true],
    [' quit', QUIET],
  ]
  put(g, KEYS, LEFT + BLOCK - len(foot), foot)
}

type Field = 'set' | 'start' | 'end'
const VALUES: Record<Field, string> = { set: 'Tailwind', start: '50', end: '950' }

/** m done as its own block: the mode's tint at rest (A, B), or its bright colour (C). */
function doneBlock(bright: boolean): Seg[] {
  const bg = bright ? TONE.fg : TONE.bg
  const fg = bright ? INK : TONE.fg
  return [
    ['  m', fg, bg, true],
    [' done  ', fg, bg, bright],
  ]
}

/** The tab cap alone, as the tab row's is. */
const TAB: Seg[] = [[' tab ', FG, CAP, true]]

/**
 * A: today's pills, in the frame. The value in hand on the white thumb with
 * ‹ ›, the others on the field's grey; tab at the frame's right end.
 */
function pillsIn(hand: Field): Seg[] {
  const pill = (f: Field): Seg =>
    f === hand ? [` ‹ ${VALUES[f]} › `, INK, THUMB, true] : [` ${VALUES[f]} `, FG, PILL]
  return [
    ['  '],
    pill('set'),
    ['  from ', DIM],
    pill('start'),
    ['  to ', DIM],
    pill('end'),
    ['   11 steps', QUIET],
  ]
}

/**
 * B and C: Done's buttons. Each value a button spaced evenly in the frame;
 * the one in hand fills all three rows in the key caps' grey, its words
 * bright with ‹ ›; the rest dim on the shelf.
 */
function buttonsIn(hand: Field, room: number): Seg[] {
  const label: Record<Field, string> = { set: 'Tailwind', start: 'from 50', end: 'to 950' }
  const buttons = (['set', 'start', 'end'] as Field[]).map((f): Seg =>
    f === hand ? [` ‹ ${label[f]} › `, FG, CAP, true] : [`   ${label[f]}   `, DIM, SHELF],
  )
  const tail: Seg[] = [['11 steps', QUIET, SHELF], ['  '], ...TAB, ['  ']]
  const spare = room - len(buttons) - len(tail)
  const gap = Math.floor(spare / 4)
  const out: Seg[] = []
  buttons.forEach((b) => out.push([' '.repeat(gap), undefined, SHELF], b))
  out.push([' '.repeat(spare - gap * 3), undefined, SHELF], ...tail)
  return out
}

function concept(kind: 'A' | 'B' | 'C', hand: Field): Grid {
  const g = frame('steps')
  for (const r of [TOP, TOP + 1, TOP + 2]) blankRow(g, r)
  const done = doneBlock(kind === 'C')
  const frameW = BLOCK - len(done) - 1
  three(g, LEFT, [[' '.repeat(frameW), undefined, SHELF]])
  if (kind === 'A') {
    const inside = pillsIn(hand)
    three(g, LEFT, inside.map(([t, fg, bg, b]): Seg => [t, fg, bg ?? SHELF, b]))
    // The value pills are one row; the frame round them is three.
    put(g, TOP, LEFT, [[' '.repeat(frameW), undefined, SHELF]])
    put(g, TOP + 2, LEFT, [[' '.repeat(frameW), undefined, SHELF]])
    put(g, TOP + 1, LEFT + frameW - len(TAB) - 2, TAB)
  } else {
    three(g, LEFT, buttonsIn(hand, frameW))
    // tab's cap on the words' row only.
    put(g, TOP, LEFT + frameW - len(TAB) - 2, [[' '.repeat(len(TAB)), undefined, SHELF]])
    put(g, TOP + 2, LEFT + frameW - len(TAB) - 2, [[' '.repeat(len(TAB)), undefined, SHELF]])
  }
  three(g, LEFT + frameW + 1, done)
  keyRow(g)
  return g
}

const today = frame('steps')

const big = (g: Grid) => termHtml(P, g)
/** The whole screen with the set in hand; under it, only its last rows after tab. */
const pair = (a: Grid, b: Grid) =>
  `<div class="pair"><div class="cap">The set in hand</div>${big(a)}<div class="cap">After tab: from in hand</div>${big(b.slice(TOP - 2))}</div>`

const concepts: PageConcept[] = [
  {
    id: 'F1',
    name: 'Today’s pills in a frame, m done beside it',
    idea: 'Your idea as asked: the line in one shelf-grey frame, three rows tall, as Done’s way on. The pills are today’s. tab sits at the frame’s right end. m done is its own block in the colour mode’s tint, a cell apart, as Home is. The frame takes the rule’s row; a blank stays above it.',
    html: pair(concept('A', 'set'), concept('A', 'start')),
  },
  {
    id: 'F2',
    name: 'Done’s buttons: the value in hand fills the frame’s height',
    idea: 'Each value is a button, spaced evenly as Done’s actions are. The one in hand fills all three rows in the key caps’ grey with ‹ › round it; the rest are dim on the shelf. “from” and “to” go inside their buttons. m done tinted beside it.',
    html: pair(concept('B', 'set'), concept('B', 'start')),
  },
  {
    id: 'F3',
    name: 'As F2, m done bright',
    idea: 'The same buttons; m done in the bright pink with dark words, as Home looks when chosen, so the way out is the loudest thing on the line.',
    html: pair(concept('C', 'set'), concept('C', 'start')),
  },
]

const CSS = `<style>
.pair .cap,.ref .cap{font:600 14px -apple-system,sans-serif;margin:14px 0 6px}
.pair .cap:first-child{margin-top:0}
.ref{margin:18px 0 0}
</style>`
const before = `${CSS}
<div class="ref"><div class="cap">Today, for reference (dev, 80 × 26): one line, the rule under it</div>${big(today)}</div>`

writeFileSync(
  'mockups/palette-steps-frame-2026-10.html',
  feedbackPage({
    page: 'palette-steps-frame-2026-10',
    title: 'Forge · colour: the steps row in a frame',
    heading: 'The steps row in one frame',
    lede: 'The steps line drawn as Done’s button row, with m done as its own button. Each concept shows the set in hand, then from in hand after tab.',
    before,
    concepts,
  }),
)
console.log('wrote mockups/palette-steps-frame-2026-10.html')
