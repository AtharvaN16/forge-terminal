/**
 * The way on from Done, round two (2026-10-22). Round one's verdicts: Y8
 * (what next, as a list) and Y10 (a row of buttons) liked. The user leans
 * to Y10, since a list gets cut off in a short window, and asked for:
 *
 *   - Continue editing as the last button;
 *   - every button keeping its key, with the key shown in the button;
 *   - Home or Done (still open) looking like the primary action;
 *   - different ways to draw the button row.
 *
 * Every button has its own key, so nothing is chosen with ←→ (→ is Continue
 * editing's key anyway) and ↵ is always the primary. Labels are the same in
 * every concept, so the concepts differ only in how the row is drawn. "Show
 * in Finder" is "Finder" so five buttons fit 72 columns.
 *
 *   npx tsx scripts/done-next-mockup-r2.ts   → mockups/done-next-2026-10-round2.html
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { DARK, modePalette } from '../src/shell/theme.js'
import { type PageConcept, feedbackPage } from './feedback-page.js'
import { type Cell, type Grid, termHtml } from './term-cells.js'

type Raw = { ch: string; fg: string | null; bg: string | null; b: boolean }
const frames = JSON.parse(
  readFileSync(new URL('./done-next-frames.json', import.meta.url), 'utf8'),
) as Record<string, Raw[][]>
const grid = (raw: Raw[][]): Grid =>
  raw.map((r) => r.map((c) => ({ ch: c.ch, fg: c.fg ?? undefined, bg: c.bg ?? undefined, b: c.b })))

const q = modePalette(DARK, 'convert')
const N = 80
/** The painted app's block: columns 4 to 75. */
const L = 4
const R = N - 4
const W = R - L
const CANVAS = q.canvas
const MODE = q.modeConvert
const MODE_BG = q.modeConvertBg

const DONE = grid(frames.step4 as Raw[][])

/* ------------------------------------------------------------- drawing */

type Seg = [text: string, fg?: string, bg?: string, bold?: boolean]
const blankRow = (): Cell[] => Array.from({ length: N }, () => ({ ch: ' ', bg: CANVAS }))
const copy = (row: Cell[] | undefined): Cell[] => (row ?? blankRow()).map((c) => ({ ...c }))
const len = (segs: Seg[]) => segs.reduce((n, [t]) => n + [...t].length, 0)

/** `segs` written on `row` from column `at`; a cell keeps its fill unless the segment has one. */
function put(row: Cell[], at: number, segs: Seg[]): Cell[] {
  let i = at
  for (const [text, fg, bg, bold] of segs)
    for (const ch of text) {
      const under = row[i]
      if (under) row[i] = { ch, fg, bg: bg ?? under.bg ?? CANVAS, b: !!bold }
      i++
    }
  return row
}
const line = (at: number, segs: Seg[]) => put(blankRow(), at, segs)
const ends = (left: Seg[], right: Seg[]) => put(line(L, left), R - len(right), right)

/** A key as the key row draws it: the cap on the key grey, the words dim. */
const cap = (k: string, words: string): Seg[] => [
  [` ${k} `, q.fg, q.keycapBg, true],
  [` ${words}`, q.dim],
]
function keyRow(main: Seg[][], foot: Array<[string, string]> = [['ctrl-c', 'quit']]): Cell[] {
  const left: Seg[] = main.flatMap((k, i) => (i ? [['  '] as Seg, ...k] : k))
  const right: Seg[] = foot.flatMap(([k, w], i) => [
    ...(i ? ([[' · ', q.border]] as Seg[]) : []),
    [k, q.fg] as Seg,
    ...(w ? ([[` ${w}`, q.border]] as Seg[]) : []),
  ])
  return ends(left, right)
}
const RULE = copy(DONE[22])
const HEADER = copy(DONE[1])
const BODY = [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16].map((i) => copy(DONE[i]))

function screen(top: Cell[][], bottom: Cell[][], h = 24): Grid {
  const gap = h - top.length - bottom.length
  if (gap < 0) throw new Error(`screen overflows by ${-gap}`)
  return [...top, ...Array.from({ length: gap }, blankRow), ...bottom]
}
const blanks = (n: number) => Array.from({ length: n }, blankRow)
const shot = (g: Grid) => termHtml(q, g)
const doneTop = () => [blankRow(), HEADER, ...blanks(2), ...BODY]

/* ------------------------------------------------- the buttons, round two */

interface Button {
  key: string
  label: string
  primary?: boolean
}
const buttons = (word: string): Button[] => [
  { key: '↵', label: word, primary: true },
  { key: 'o', label: 'Open' },
  { key: 's', label: 'Finder' },
  { key: 'p', label: 'Save as preset' },
  { key: '→', label: 'Continue editing' },
]

/** One button's cells, by treatment. */
type Draw = (b: Button) => Seg[]

/** Y11: solid. The primary filled with the mode's colour; the rest on the key grey, key white, words dim. */
const solid: Draw = (b) =>
  b.primary
    ? [[` ${b.key} ${b.label} `, q.ink, MODE, true]]
    : [
        [` ${b.key}`, q.fg, q.keycapBg, true],
        [` ${b.label} `, q.dim, q.keycapBg],
      ]

/** Y12: the key on its own cap inside each button. The primary solid. */
const capped: Draw = (b) =>
  b.primary
    ? [[` ${b.key} ${b.label} `, q.ink, MODE, true]]
    : [
        [` ${b.key} `, q.fg, q.panelBand, true],
        [` ${b.label} `, q.dim, q.selectionBg],
      ]

/** Y13: the primary solid; the rest drawn as the key row draws a key, no fill. */
const ghost: Draw = (b) =>
  b.primary ? [[` ${b.key} ${b.label} `, q.ink, MODE, true]] : cap(b.key, b.label)

/** Y19: the primary on the mode's tint, key and words in the mode's colour; the rest on the key grey. */
const tinted: Draw = (b) =>
  b.primary
    ? [
        [` ${b.key} `, q.ink, MODE, true],
        [` ${b.label} `, MODE, MODE_BG, true],
      ]
    : [
        [` ${b.key}`, q.fg, q.keycapBg, true],
        [` ${b.label} `, q.dim, q.keycapBg],
      ]

/** Y18: no fills at all: the primary in the mode's colour, │ between. */
const bare: Draw = (b) =>
  b.primary
    ? [[`${b.key} ${b.label}`, MODE, undefined, true]]
    : [
        [b.key, q.fg, undefined, true],
        [` ${b.label}`, q.dim],
      ]

/** The buttons from the margin, `gap` cells apart; `split` pushes the last to the block's end. */
function row(bs: Button[], draw: Draw, { gap = 1, split = false, sep }: { gap?: number; split?: boolean; sep?: Seg } = {}): Cell[] {
  const parts = bs.map(draw)
  if (split) {
    const last = parts.pop() ?? []
    const left = parts.flatMap((p, i) => (i ? [[' '.repeat(gap)] as Seg, ...p] : p))
    return ends(left, last)
  }
  const between: Seg[] = sep ? [sep] : [[' '.repeat(gap)]]
  return line(L, parts.flatMap((p, i) => (i ? [...between, ...p] : p)))
}

/** Y14: one bar across the block, no gaps; the spare cells shared out as padding. */
function segmented(bs: Button[]): Cell[] {
  const words = bs.map((b) => `${b.key} ${b.label}`)
  const divider = 1
  let spare = W - words.reduce((n, w) => n + [...w].length, 0) - divider * (bs.length - 1)
  const pads = words.map(() => 0)
  for (let i = 0; spare > 0; i = (i + 1) % pads.length, spare--) pads[i] = (pads[i] ?? 0) + 1
  const segs: Seg[] = []
  bs.forEach((b, i) => {
    const p = pads[i] ?? 0
    const lead = ' '.repeat(Math.floor(p / 2))
    const tail = ' '.repeat(p - Math.floor(p / 2))
    if (i) segs.push(['│', CANVAS, q.selectionBg])
    if (b.primary) segs.push([`${lead}${b.key} ${b.label}${tail}`, q.ink, MODE, true])
    else
      segs.push(
        [`${lead}${b.key}`, q.fg, q.selectionBg, true],
        [` ${b.label}${tail}`, q.dim, q.selectionBg],
      )
  })
  return line(L, segs)
}

/** Y17: each button three rows tall, as the strip is: its fill above and below the words. */
function tall(bs: Button[]): Cell[][] {
  const words = row(bs, solid)
  const pad = words.map((c) => ({ ...c, ch: ' ', b: false }))
  return [pad, words, pad.map((c) => ({ ...c }))]
}

/* ------------------------------------------------------------- screens */

const FOOTNOTE = keyRow([])

/** The buttons where the foot was, a blank row, the rule, and a key row with only the footnote. */
const above = (rows: Cell[][]) => shot(screen(doneTop(), [...rows, blankRow(), RULE, FOOTNOTE]))

/** The row alone, both words, for the detail. */
const rowsAlone = (make: (word: string) => Cell[][]) =>
  `<div class="alone">${['Home', 'Done']
    .map((w) => `<div class="moderow"><span class="mlabel">${w.toLowerCase()}</span>${shot(make(w))}</div>`)
    .join('')}</div>`

const figure = (screenHtml: string, make: (word: string) => Cell[][]) =>
  `<div style="display:flex;flex-direction:column;gap:18px">${screenHtml}${rowsAlone(make)}</div>`

/** A treatment drawn above the rule, with its row alone in both words. */
const treat = (make: (word: string) => Cell[][]) => figure(above(make('Home')), make)

/* ---------------------------------------------- round one's liked, as drawn */

const CHOICES = ['Next file', 'Open', 'Show in Finder', 'Continue editing', 'Save as preset']
const listRows = CHOICES.map((c, i) =>
  i === 0
    ? put(line(L, [['▌', MODE, q.listBand]]), L + 1, [
        [' ', undefined, q.listBand],
        [c, q.fg, q.listBand, true],
        [' '.repeat(30 - c.length), undefined, q.listBand],
      ])
    : line(L, [['  '], [c, q.dim]]),
)
const y10Row = (() => {
  const segs: Seg[] = []
  CHOICES.forEach((c, i) => {
    if (i) segs.push([' '])
    segs.push(i === 0 ? [` ${c} `, q.ink, MODE, true] : [` ${c} `, q.dim, q.keycapBg])
  })
  return line(L + Math.floor((R - L - len(segs)) / 2), segs)
})()

/* ------------------------------------------------------------ concepts */

const concepts: PageConcept[] = [
  {
    id: 'Y10',
    name: 'A row of buttons',
    idea: 'Round one, as drawn: the first button lit, ←→ to move, ↵ to confirm. Round two builds on this.',
    earlier: 'like',
    html: shot(
      screen(doneTop(), [
        y10Row,
        blankRow(),
        RULE,
        keyRow([cap('←→', 'choose'), cap('↵', 'confirm')], [['esc', 'home'], ['ctrl-c', 'quit']]),
      ]),
    ),
    section: 'Liked in round one',
  },
  {
    id: 'Y8',
    name: 'What next, as a list',
    idea: 'Round one, as drawn. Kept for reference. Your concern: in a short window the list gets cut off.',
    earlier: 'like',
    html: shot(
      screen(
        [blankRow(), HEADER, blankRow(), ...BODY, blankRow(), ...listRows],
        [RULE, keyRow([cap('↑↓', 'choose'), cap('↵', 'confirm')], [['esc', 'home'], ['ctrl-c', 'quit']])],
      ),
    ),
  },
  {
    id: 'Y11',
    name: 'Solid buttons',
    idea: 'Every button filled. The primary in the mode’s colour with dark words; the rest on the key grey, the key white and bold, the words dim. Below the screen: the row alone with Home, then Done.',
    html: treat((w) => [row(buttons(w), solid)]),
    section: 'Round two: the button row, five ways on, each with its key',
  },
  {
    id: 'Y12',
    name: 'A key cap inside each button',
    idea: 'The secondary buttons are a quiet grey with the key on its own lighter cap, as on a keyboard. The primary is solid in the mode’s colour.',
    html: treat((w) => [row(buttons(w), capped)]),
  },
  {
    id: 'Y13',
    name: 'One button, the rest as keys',
    idea: 'Only the primary is a button. The others are drawn the way the key row draws a key, so the one fill on the row is the way home.',
    html: treat((w) => [row(buttons(w), ghost, { gap: 2 })]),
  },
  {
    id: 'Y19',
    name: 'A tinted primary',
    idea: 'The primary is softer: the key on the mode’s colour, the word in the mode’s colour on its dark tint. The rest are solid grey, as in Y11.',
    html: treat((w) => [row(buttons(w), tinted)]),
  },
  {
    id: 'Y14',
    name: 'One bar, edge to edge',
    idea: 'The buttons joined into one bar across the block, split by thin canvas lines; the primary is the lit segment at the left end.',
    html: treat((w) => [segmented(buttons(w))]),
  },
  {
    id: 'Y15',
    name: 'Continue editing at the far end',
    idea: 'Y11’s buttons, with Continue editing pushed to the right end of the row, where it sits today, so the forward step reads as separate from going home.',
    html: treat((w) => [row(buttons(w), solid, { split: true })]),
  },
  {
    id: 'Y17',
    name: 'Tall buttons',
    idea: 'Each button three rows tall, a row of its fill above and below the words, so the row has the same weight as the strip at the top.',
    html: figure(shot(screen(doneTop(), [...tall(buttons('Home')), blankRow(), RULE, FOOTNOTE])), (w) => tall(buttons(w))),
  },
  {
    id: 'Y18',
    name: 'No fills',
    idea: 'The quietest: words only, │ between them. The primary in the mode’s colour and bold; the keys white and bold, the words dim.',
    html: treat((w) => [row(buttons(w), bare, { sep: ['  │  ', q.faint] })]),
  },
  {
    id: 'Y16',
    name: 'The buttons are the key row',
    idea: 'Y13’s row takes the key row’s place under the rule, on the last line, since it now carries the keys. Nothing sits above the rule; ctrl-c quit drops off this screen (it still works).',
    html: figure(shot(screen(doneTop(), [RULE, row(buttons('Home'), ghost, { gap: 2 })])), (w) => [
      row(buttons(w), ghost, { gap: 2 }),
    ]),
  },
]

const before = `<div class="box"><h3>Decided in round one</h3>
<p style="margin:4px 0 0">A row of buttons (Y10), not a list. Continue editing is the last button. Every button keeps its key and shows it. Home or Done is the primary action. Nothing moves a selection now: each button has its own key, and ↵ is always the primary.</p></div>
<div class="box"><h3>Questions for you</h3><ol>
<li>Home or Done? Each concept shows its row alone in both words, under the screen.</li>
<li>To fit five buttons in 80 columns, “Show in Finder” is <code>Finder</code> on the button. Is that all right?</li>
<li>When the buttons are above the rule (all but Y16), the key row under the rule keeps only <code>ctrl-c quit</code>. Keep it, or drop the rule and key row on Done?</li>
<li>Still open from round one: should esc also go home, and should a dropped file start straight away?</li>
</ol></div>
<style>.alone{display:flex;flex-direction:column;gap:10px}.moderow{display:flex;align-items:center;gap:14px}.mlabel{font:12px "SF Mono",ui-monospace,Menlo,monospace;color:#8f94a1;width:40px;text-align:right}.alone .t{padding:8px 16px;zoom:1.2}</style>`

writeFileSync(
  'mockups/done-next-2026-10-round2.html',
  feedbackPage({
    page: 'done-next-r2',
    title: 'Forge · the way on from Done, round two',
    heading: 'Done: the button row',
    lede: 'Y10’s row of buttons, with Continue editing last, each button showing its key, and the way home drawn as the primary action. The concepts differ only in how the row is drawn. Captured from the app, dark, 80 × 24.',
    before,
    concepts,
  }),
)
console.log('wrote mockups/done-next-2026-10-round2.html')
