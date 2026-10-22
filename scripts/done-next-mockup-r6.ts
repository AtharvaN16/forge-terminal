/**
 * The way on from Done, round six (2026-10-22). The user is leaning to Y30
 * and Y31 (Home as its own three-row block in the tint, beside a #242424
 * frame holding Open, Finder, Save as preset and Continue editing; touching,
 * and a cell apart) and asked to:
 *
 *   - give Home more padding left and right inside its block;
 *   - remove every other exploration;
 *   - show small visual variations within these two: other greys, one with
 *     the frame the same grey as the background.
 *
 * Home is two cells either side of its words now, so the frame keeps one
 * cell at either end to fit 80 columns. Each concept shows the screen
 * (touching), then the row alone touching and a cell apart, and with the
 * focus moved to Open.
 *
 *   npx tsx scripts/done-next-mockup-r6.ts   → mockups/done-next-2026-10-round6.html
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { mix } from '../src/shell/home-art.js'
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

/* ------------------------------------------------- the buttons, round six */

interface Button {
  key: string
  label: string
}
const REST: Button[] = [
  { key: 'o', label: 'Open' },
  { key: 'f', label: 'Finder' },
  { key: 'p', label: 'Save as preset' },
  { key: '→', label: 'Continue editing' },
]
const HOME: Button = { key: '↵', label: 'Home' }

interface Look {
  /** The frame's grey. */
  fill: string
  /** The focused button's grey. */
  lift: string
  /** Home's tint. */
  tint: string
}

/** A button in the frame: bare on the frame's grey, or lifted when focused. */
function button(b: Button, focused: boolean, k: Look): Seg[] {
  const [wFg, bg, bold] = focused ? [q.fg, k.lift, true] : [q.dim, k.fill, false]
  return [
    [` ${b.key}`, q.fg, bg, true],
    [` ${b.label} `, wFg, bg, bold],
  ]
}

/** Home's words: two cells of the tint either side. */
const HOME_PAD = 2
const homeWords = (k: Look): Seg[] => [
  [`${' '.repeat(HOME_PAD)}${HOME.key}`, MODE, k.tint, true],
  [` ${HOME.label}${' '.repeat(HOME_PAD)}`, MODE, k.tint, true],
]

/** One cell of the frame's grey at either end of its buttons. */
const SIDE = 1

/**
 * The frame with the four buttons, then Home's block, three rows each,
 * `gap` cells of canvas between them; the focus on REST[at], or nowhere.
 */
function rows(k: Look, gap: number, at = -1): Cell[][] {
  const home = homeWords(k)
  const homeW = len(home)
  const frameW = W - homeW - gap
  const parts = REST.map((b, i) => button(b, i === at, k))
  const spare = frameW - 2 * SIDE - parts.reduce((n, p) => n + len(p), 0)
  const gaps = parts.length - 1
  const gapAt = (i: number) => Math.floor((spare * (i + 1)) / gaps) - Math.floor((spare * i) / gaps)
  const segs: Seg[] = parts.flatMap((p, i) => (i ? [[' '.repeat(gapAt(i - 1)), undefined, k.fill] as Seg, ...p] : p))
  const row = (words: boolean) => {
    const r = line(L, [[' '.repeat(frameW), undefined, k.fill]])
    if (words) put(r, L + SIDE, segs)
    put(r, R - homeW, words ? home : [[' '.repeat(homeW), undefined, k.tint]])
    return r
  }
  return [row(false), row(true), row(false)]
}

const KEYS = keyRow([cap('tab', 'choose'), cap('↵', 'confirm')])
const onScreen = (r: Cell[][]) => shot(screen(doneTop(), [...r, blankRow(), RULE, KEYS]))
const states = (pairs: Array<[string, Cell[][]]>) =>
  `<div class="alone">${pairs
    .map(([label, r]) => `<div class="moderow"><span class="mlabel">${label}</span>${shot(r)}</div>`)
    .join('')}</div>`

/** The screen at `gap`, then the row alone touching, a cell apart, and focused on Open. */
const figure = (k: Look, gap: number) =>
  `<div style="display:flex;flex-direction:column;gap:18px">${onScreen(rows(k, gap))}${states([
    ['touching', rows(k, 0)],
    ['a cell apart', rows(k, 1)],
    ['on Open', rows(k, gap, 0)],
  ])}</div>`

/* ------------------------------------------------------------ concepts */

/** Y30 and Y31's look: the frame in the shelf grey, the focus in the key caps' grey. */
const BASE: Look = { fill: q.shelf, lift: q.keycapBg, tint: MODE_BG }

const concepts: PageConcept[] = [
  {
    id: 'Y30',
    name: 'Touching, with Home padded',
    idea: 'As in round five: the frame #242424, the focus #333333, Home in the tint and touching the frame. Home now has two cells of tint either side of its words.',
    earlier: 'like',
    html: figure(BASE, 0),
    section: 'Your picks, Home padded',
  },
  {
    id: 'Y31',
    name: 'A cell apart, with Home padded',
    idea: 'Y30 with one cell of canvas between the frame and Home.',
    earlier: 'like',
    html: figure(BASE, 1),
  },
  {
    id: 'Y32',
    name: 'The frame the same grey as the background',
    idea: 'The frame in the canvas’s own #1e1e1e, so it disappears: the four buttons sit on the background and only Home is a block. The focus in #2c2c2c.',
    html: figure({ ...BASE, fill: q.canvas, lift: q.selectionBg }, 1),
    section: 'Variations: the frame’s grey',
  },
  {
    id: 'Y33',
    name: 'A barely-there frame, #212121',
    idea: 'The frame one step off the background, #212121: there if you look for it. The focus in #2c2c2c.',
    html: figure({ ...BASE, fill: mix(q.canvas, q.shelf, 0.5), lift: q.selectionBg }, 1),
  },
  {
    id: 'Y34',
    name: 'A lighter frame, #282828',
    idea: 'The frame a step lighter than Y30’s, #282828; the focus in #333333 as before.',
    html: figure({ ...BASE, fill: mix(q.shelf, q.selectionBg, 0.5) }, 1),
  },
  {
    id: 'Y35',
    name: 'A softer focus, #2c2c2c',
    idea: 'Y31 with the focused button in #2c2c2c, only a little lighter than the frame.',
    html: figure({ ...BASE, lift: q.selectionBg }, 1),
    section: 'Variations: the focus’s grey',
  },
  {
    id: 'Y36',
    name: 'A stronger focus, #3d3d3d',
    idea: 'Y31 with the focused button in #3d3d3d, the Save as field’s grey, so where the focus is reads at a glance.',
    html: figure({ ...BASE, lift: q.fieldBand }, 1),
  },
  {
    id: 'Y37',
    name: 'A brighter tint for Home',
    idea: 'Y31 with Home’s tint a step brighter: today’s tint moved 15% towards the mode’s blue.',
    html: figure({ ...BASE, tint: mix(MODE_BG, MODE, 0.15) }, 1),
    section: 'Variations: Home’s tint',
  },
  {
    id: 'Y38',
    name: 'A deeper tint for Home',
    idea: 'Y31 with Home’s tint a step darker and quieter: today’s tint moved 35% towards the background.',
    html: figure({ ...BASE, tint: mix(MODE_BG, q.canvas, 0.35) }, 1),
  },
]

const before = `<div class="box"><h3>Decided so far</h3>
<p style="margin:4px 0 0">Two elements, three rows tall: a frame holding Open, Finder, Save as preset and Continue editing, the focused one in a lighter grey, and Home as its own block in the tinted blue at the right edge. Finder is f, Continue editing is →. Each button shows its key. Home now has two cells of tint either side of its words.</p></div>
<div class="box"><h3>Still open</h3><ol>
<li>tab moves between the buttons (→ is Continue editing). Or ←→, with another key for Continue editing?</li>
<li>Should the focus start on Home or on Open? Here nothing in the frame is focused until tab is pressed.</li>
</ol></div>
<style>.alone{display:flex;flex-direction:column;gap:10px}.moderow{display:flex;align-items:center;gap:14px}.mlabel{font:12px "SF Mono",ui-monospace,Menlo,monospace;color:#8f94a1;width:84px;text-align:right}.alone .t{padding:8px 16px;zoom:1.2}</style>`

writeFileSync(
  'mockups/done-next-2026-10-round6.html',
  feedbackPage({
    page: 'done-next-r6',
    title: 'Forge · the way on from Done, round six',
    heading: 'Done: Home’s block, in other greys',
    lede: 'Y30 and Y31 with more padding inside Home, then small variations: the frame’s grey (one the same as the background), the focus’s grey, and Home’s tint. Each concept: the screen, then the row alone touching, a cell apart, and with the focus on Open. Captured from the app, dark, 80 × 24.',
    before,
    concepts,
  }),
)
console.log('wrote mockups/done-next-2026-10-round6.html')
