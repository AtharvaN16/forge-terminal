/**
 * The way on from Done, round four (2026-10-22). The user liked Y21 and Y25
 * (a three-row frame, only Home tinted, the focus in a lighter grey) and
 * asked to remove every other concept, then:
 *
 *   - Home's tint only on the buttons' row, the frame's grey above and below
 *     it (the frame's padding runs over Home too);
 *   - Home at the far right; the order Open, Finder, Save as preset,
 *     Continue editing, Home;
 *   - Finder on f (free on Done: ↵ o s c p u → are taken), Continue editing
 *     on →.
 *
 * → for Continue editing takes ←→ away from moving between the buttons, so
 * here tab moves the focus (see the page's questions).
 *
 *   npx tsx scripts/done-next-mockup-r4.ts   → mockups/done-next-2026-10-round4.html
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { DARK, modePalette } from '../src/shell/theme.js'
import { feedbackPage, type PageConcept } from './feedback-page.js'
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

/* ------------------------------------------------ the buttons, round four */

interface Button {
  key: string
  label: string
  home?: boolean
}
/** Round three's order and keys, for Y21 and Y25 as they were drawn. */
const R3_BUTTONS: Button[] = [
  { key: '↵', label: 'Home', home: true },
  { key: 'o', label: 'Open' },
  { key: 's', label: 'Finder' },
  { key: 'p', label: 'Save as preset' },
  { key: 'e', label: 'Continue editing' },
]
/** Round four: Home at the far right, Finder on f, Continue editing on →. */
const BUTTONS: Button[] = [
  { key: 'o', label: 'Open' },
  { key: 'f', label: 'Finder' },
  { key: 'p', label: 'Save as preset' },
  { key: '→', label: 'Continue editing' },
  { key: '↵', label: 'Home', home: true },
]

interface Frame {
  fill: string
  /** The focused button's grey. */
  lift: string
  /** Home's tint and the focus's grey run all three rows (round three); else only the buttons' row. */
  fullHeight: boolean
  /** Cells of the frame's grey left and right of the buttons. */
  side: number
}

/** One button: ` k Label `, Home on the tint, the focused one on the lighter grey, the rest bare. */
function button(b: Button, focused: boolean, f: Frame): Seg[] {
  const [kFg, wFg, bg, bold] = b.home
    ? [MODE, MODE, MODE_BG, true]
    : focused
      ? [q.fg, q.fg, f.lift, true]
      : [q.fg, q.dim, f.fill, false]
  return [
    [` ${b.key}`, kFg, bg, true],
    [` ${b.label} `, wFg, bg, bold],
  ]
}

/** The frame across the block, three rows: its grey above and below, the buttons spread along the middle. */
function frameRows(bs: Button[], at: number, f: Frame): Cell[][] {
  const parts = bs.map((b, i) => button(b, i === at, f))
  const inner = W - 2 * f.side
  const spare = inner - parts.reduce((n, p) => n + len(p), 0)
  const gaps = parts.length - 1
  const gapAt = (i: number) => Math.floor((spare * (i + 1)) / gaps) - Math.floor((spare * i) / gaps)
  const segs: Seg[] = parts.flatMap((p, i) =>
    i ? [[' '.repeat(gapAt(i - 1)), undefined, f.fill] as Seg, ...p] : p,
  )
  const fillRow = () => line(L, [[' '.repeat(W), undefined, f.fill]])
  const words = put(fillRow(), L + f.side, segs)
  const padRow = () => {
    const r = fillRow()
    if (f.fullHeight)
      words.forEach((c, x) => {
        if (c.bg === MODE_BG || c.bg === f.lift) r[x] = { ch: ' ', bg: c.bg }
      })
    return r
  }
  return [padRow(), words, padRow()]
}

/** Round three's key row; round four's, with tab moving the focus since → is Continue editing. */
const R3_KEYS = keyRow([cap('←→', 'choose'), cap('↵', 'confirm')])
const KEYS = keyRow([cap('tab', 'choose'), cap('↵', 'confirm')])

const onScreen = (rows: Cell[][], keys: Cell[]) =>
  shot(screen(doneTop(), [...rows, blankRow(), RULE, keys]))

/** The row alone in two states, labelled. */
const states = (pairs: Array<[string, Cell[][]]>) =>
  `<div class="alone">${pairs
    .map(
      ([label, rows]) =>
        `<div class="moderow"><span class="mlabel">${label}</span>${shot(rows)}</div>`,
    )
    .join('')}</div>`

const figure = (
  bs: Button[],
  f: Frame,
  keys: Cell[],
  home: number,
  other: number,
  otherName: string,
) =>
  `<div style="display:flex;flex-direction:column;gap:18px">${onScreen(frameRows(bs, home, f), keys)}${states(
    [
      ['on Home', frameRows(bs, home, f)],
      [`on ${otherName}`, frameRows(bs, other, f)],
    ],
  )}</div>`

/* ------------------------------------------------------------ concepts */

const LIGHT = { fill: q.selectionBg, lift: q.panelBand }
const DARK_ = { fill: q.shelf, lift: q.keycapBg }

const concepts: PageConcept[] = [
  {
    id: 'Y21',
    name: 'A three-row frame (round three)',
    idea: 'As drawn in round three. The frame in #2c2c2c, the strip’s grey; the focus in #404040. Home’s tint runs all three rows.',
    earlier: 'like',
    html: figure(R3_BUTTONS, { ...LIGHT, fullHeight: true, side: 1 }, R3_KEYS, 0, 1, 'Open'),
    section: 'Liked in round three',
  },
  {
    id: 'Y25',
    name: 'A three-row darker frame (round three)',
    idea: 'As drawn in round three. The frame in #242424, darker and quieter against the strip; the focus in #333333, the key caps’ grey.',
    earlier: 'like',
    html: figure(R3_BUTTONS, { ...DARK_, fullHeight: true, side: 1 }, R3_KEYS, 0, 1, 'Open'),
  },
  {
    id: 'Y26',
    name: 'Y21, padded round Home, Home at the right',
    idea: 'Y21’s greys. Home’s tint sits on the buttons’ row only, the frame’s grey above and below it, and the focus’s grey does the same. Home is at the far right; Finder is f and Continue editing →. Two cells of the frame’s grey at either end.',
    html: figure(BUTTONS, { ...LIGHT, fullHeight: false, side: 2 }, KEYS, 4, 0, 'Open'),
    section: 'Round four',
  },
  {
    id: 'Y27',
    name: 'Y25, padded round Home, Home at the right',
    idea: 'The same in Y25’s greys: the frame #242424, the focus #333333.',
    html: figure(BUTTONS, { ...DARK_, fullHeight: false, side: 2 }, KEYS, 4, 0, 'Open'),
  },
]

const before = `<div class="box"><h3>Decided so far</h3>
<p style="margin:4px 0 0">A three-row frame across the block holds every button. Only Home has a fill of its own, in the tinted blue; the focused button gets a lighter grey; the rest take the frame's grey. Home is at the far right: Open, Finder, Save as preset, Continue editing, Home. Finder is f, Continue editing is →. Each button shows its key.</p></div>
<div class="box"><h3>Questions for you</h3><ol>
<li>→ is Continue editing now, so ←→ can no longer move between the buttons. Here tab moves the focus (shift-tab back). The other way round would be ←→ to move and another key for Continue editing. Which do you want?</li>
<li>Home is ↵ and is chosen when Done opens. Should the focus start on Home at the right end, or on Open at the left?</li>
</ol></div>
<style>.alone{display:flex;flex-direction:column;gap:10px}.moderow{display:flex;align-items:center;gap:14px}.mlabel{font:12px "SF Mono",ui-monospace,Menlo,monospace;color:#8f94a1;width:64px;text-align:right}.alone .t{padding:8px 16px;zoom:1.2}</style>`

writeFileSync(
  'mockups/done-next-2026-10-round4.html',
  feedbackPage({
    page: 'done-next-r4',
    title: 'Forge · the way on from Done, round four',
    heading: 'Done: Home at the right, padded',
    lede: 'Y21 and Y25, then both with the frame’s grey above and below Home, Home at the far right, Finder on f and Continue editing on →. Each concept: the screen, then the row alone with the focus on Home and on Open. Captured from the app, dark, 80 × 24.',
    before,
    concepts,
  }),
)
console.log('wrote mockups/done-next-2026-10-round4.html')
