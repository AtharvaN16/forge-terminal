/**
 * The way on from Done, round three (2026-10-22). From round two the user
 * asked for:
 *
 *   - ←→ kept, to move between the buttons;
 *   - every button wrapped in one common frame;
 *   - fewer accent colours: only Home keeps a frame of its own, in the
 *     tinted blue; the rest have no fill and take the frame's.
 *
 * Already decided: a row of buttons (Y10), Continue editing last, every
 * button keeps its key and shows it, Home as the primary. With ←→ moving
 * the focus, → can no longer open Continue editing, so it is `e` here.
 *
 * Each concept shows the screen with the focus on Home, then the row alone
 * with the focus on Home and moved to Open.
 *
 *   npx tsx scripts/done-next-mockup-r3.ts   → mockups/done-next-2026-10-round3.html
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

/* ----------------------------------------------- the buttons, round three */

interface Button {
  key: string
  label: string
}
const BUTTONS: Button[] = [
  { key: '↵', label: 'Home' },
  { key: 'o', label: 'Open' },
  { key: 's', label: 'Finder' },
  { key: 'p', label: 'Save as preset' },
  { key: 'e', label: 'Continue editing' },
]

/** How the focus shows once it leaves Home. */
type Focus =
  /** Home keeps its tint; the focused button gets a lighter grey of its own. */
  | 'grey'
  /** Home keeps its tint; the focused button's words go white and bold, no fill. */
  | 'words'
  /** The tint is the focus: it moves off Home onto the focused button. */
  | 'moves'

interface Frame {
  /** The frame's fill; none for a drawn border. */
  fill?: string
  /** A rounded border drawn round the row, in this colour. */
  border?: string
  /** Rows of the frame's fill above and below the buttons. */
  pad?: 0 | 1
  /** The frame as wide as the block, buttons spread across it; else it hugs them. */
  wide?: boolean
  focus: Focus
  /** The focused button's grey, for `grey`. */
  lift?: string
}

/** One button: ` k Label `, coloured by whether it is Home, focused, both or neither. */
function button(b: Button, i: number, at: number, f: Frame): Seg[] {
  const home = i === 0
  const focused = i === at
  const text = (
    k: string,
    w: string,
    kFg: string,
    wFg: string,
    bg: string | undefined,
    bold: boolean,
  ): Seg[] => [
    [` ${k}`, kFg, bg, true],
    [` ${w} `, wFg, bg, bold],
  ]
  const tinted = f.focus === 'moves' ? focused : home
  if (tinted) return text(b.key, b.label, MODE, MODE, MODE_BG, true)
  if (focused && f.focus === 'grey')
    return text(b.key, b.label, q.fg, q.fg, f.lift ?? q.panelBand, true)
  if (focused && f.focus === 'words') return text(b.key, b.label, q.fg, q.fg, f.fill, true)
  return text(b.key, b.label, q.fg, q.dim, f.fill, false)
}

/** The frame and its buttons, focus on button `at`: one row, or three with padding or a border. */
function frameRows(f: Frame, at: number): Cell[][] {
  const parts = BUTTONS.map((b, i) => button(b, i, at, f))
  const inner = f.border ? W - 4 : W - 2
  const used = parts.reduce((n, p) => n + len(p), 0)
  // Spread: the spare cells shared between the gaps; hugging: one cell apart.
  const gaps = parts.length - 1
  const spare = f.wide ? inner - used : gaps
  const gapAt = (i: number) => Math.floor((spare * (i + 1)) / gaps) - Math.floor((spare * i) / gaps)
  const segs: Seg[] = parts.flatMap((p, i) =>
    i ? [[' '.repeat(gapAt(i - 1)), undefined, f.fill] as Seg, ...p] : p,
  )
  const width = len(segs) + (f.border ? 4 : 2)
  const fillRow = () => line(L, [[' '.repeat(width), undefined, f.fill]])
  if (f.border) {
    const c = f.border
    return [
      line(L, [['╭' + '─'.repeat(width - 2) + '╮', c]]),
      put(line(L, [['│', c], [' '.repeat(width - 2)], ['│', c]]), L + 2, segs),
      line(L, [['╰' + '─'.repeat(width - 2) + '╯', c]]),
    ]
  }
  const words = put(fillRow(), L + 1, segs)
  if (!f.pad) return [words]
  // Home's tint (or the focus's) runs the frame's full height, as its own frame inside it.
  const padRow = () => {
    const r = fillRow()
    words.forEach((c, x) => {
      if (c.bg === MODE_BG || (f.lift && c.bg === f.lift)) r[x] = { ch: ' ', bg: c.bg }
    })
    return r
  }
  return [padRow(), words, padRow()]
}

const KEYS = keyRow([cap('←→', 'choose'), cap('↵', 'confirm')])

/** Above the rule, with the picker's keys under it. */
const onScreen = (rows: Cell[][]) => shot(screen(doneTop(), [...rows, blankRow(), RULE, KEYS]))

/** The row alone: focus on Home, then moved to Open. */
const states = (f: Frame) =>
  `<div class="alone">${[
    ['on Home', 0],
    ['on Open', 1],
  ]
    .map(
      ([label, at]) =>
        `<div class="moderow"><span class="mlabel">${label}</span>${shot(frameRows(f, at as number))}</div>`,
    )
    .join('')}</div>`

const figure = (f: Frame) =>
  `<div style="display:flex;flex-direction:column;gap:18px">${onScreen(frameRows(f, 0))}${states(f)}</div>`

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

const FRAME = q.selectionBg

const concepts: PageConcept[] = [
  {
    id: 'Y10',
    name: 'A row of buttons',
    idea: 'Round one, as drawn. Round three builds on it.',
    earlier: 'like',
    html: shot(
      screen(doneTop(), [
        y10Row,
        blankRow(),
        RULE,
        keyRow(
          [cap('←→', 'choose'), cap('↵', 'confirm')],
          [
            ['esc', 'home'],
            ['ctrl-c', 'quit'],
          ],
        ),
      ]),
    ),
    section: 'Liked earlier',
  },
  {
    id: 'Y8',
    name: 'What next, as a list',
    idea: 'Round one, as drawn. Kept for reference: in a short window the list gets cut off.',
    earlier: 'like',
    html: shot(
      screen(
        [blankRow(), HEADER, blankRow(), ...BODY, blankRow(), ...listRows],
        [
          RULE,
          keyRow(
            [cap('↑↓', 'choose'), cap('↵', 'confirm')],
            [
              ['esc', 'home'],
              ['ctrl-c', 'quit'],
            ],
          ),
        ],
      ),
    ),
  },
  {
    id: 'Y20',
    name: 'A one-row frame, a lighter grey for the focus',
    idea: 'The frame is one row of #2c2c2c (the strip’s grey) across the block, the buttons spread along it. Home keeps its tint. The focused button gets a lighter grey (#404040) of its own.',
    html: figure({ fill: FRAME, wide: true, focus: 'grey', lift: q.panelBand }),
    section: 'Round three: one frame, only Home tinted',
  },
  {
    id: 'Y21',
    name: 'A three-row frame',
    idea: 'Y20 with a row of the frame’s grey above and below the buttons, the same weight as the strip at the top. Home’s tint, and the focus’s grey, run all three rows.',
    html: figure({ fill: FRAME, pad: 1, wide: true, focus: 'grey', lift: q.panelBand }),
  },
  {
    id: 'Y22',
    name: 'A drawn border, the focus in white',
    idea: 'No fill: a rounded border in the border grey around the row, the buttons on the canvas. Home keeps its tint; the focused button’s words turn white and bold.',
    html: figure({ border: q.border, focus: 'words' }),
  },
  {
    id: 'Y23',
    name: 'A darker frame, the tint follows the focus',
    idea: 'The frame in the darker shelf grey (#242424). The tint is the focus: it starts on Home and moves to whichever button ←→ lands on.',
    html: figure({ fill: q.shelf, wide: true, focus: 'moves' }),
  },
  {
    id: 'Y24',
    name: 'A frame that hugs the buttons',
    idea: 'The frame only as wide as the buttons, a cell between each, from the left margin. Home keeps its tint; the focused button’s words turn white and bold.',
    html: figure({ fill: FRAME, focus: 'words' }),
  },
  {
    id: 'Y25',
    name: 'A three-row darker frame, the focus in a lighter grey',
    idea: 'Y21 in the shelf grey (#242424): quieter against the strip. The focus gets the key grey (#333333).',
    html: figure({ fill: q.shelf, pad: 1, wide: true, focus: 'grey', lift: q.keycapBg }),
  },
]

const before = `<div class="box"><h3>Decided so far</h3>
<p style="margin:4px 0 0">A row of buttons (Y10) with ←→ to move between them. Continue editing is the last button. Every button keeps its key and shows it. One frame wraps all the buttons. Only Home has a frame of its own, in the tinted blue; the rest have no fill and take the frame's.</p></div>
<div class="box"><h3>Questions for you</h3><ol>
<li>With ←→ moving the focus, → can no longer open Continue editing. I gave it <code>e</code>. Is that all right?</li>
<li>↵ confirms whichever button has the focus. Home's own key could be ↵ (true while it has the focus, which it does when Done opens) or esc (true from anywhere). Which should its button show?</li>
<li>Home or Done: the buttons say Home, since you called it the home key. Is that settled?</li>
</ol></div>
<style>.alone{display:flex;flex-direction:column;gap:10px}.moderow{display:flex;align-items:center;gap:14px}.mlabel{font:12px "SF Mono",ui-monospace,Menlo,monospace;color:#8f94a1;width:64px;text-align:right}.alone .t{padding:8px 16px;zoom:1.2}</style>`

writeFileSync(
  'mockups/done-next-2026-10-round3.html',
  feedbackPage({
    page: 'done-next-r3',
    title: 'Forge · the way on from Done, round three',
    heading: 'Done: one frame, Home tinted',
    lede: 'The buttons in one common frame, ←→ moving between them, and colour only on Home. Each concept: the screen with the focus on Home, then the row alone with the focus on Home and on Open. Captured from the app, dark, 80 × 24.',
    before,
    concepts,
  }),
)
console.log('wrote mockups/done-next-2026-10-round3.html')
