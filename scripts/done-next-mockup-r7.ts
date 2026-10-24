/**
 * The way on from Done, round seven (2026-10-22). From round six the user
 * asked for:
 *
 *   - ←→ to move between the buttons, not tab (so Continue editing takes e,
 *     since → moves the focus);
 *   - a selected grey button drawn as Home is: its fill the full three rows,
 *     no frame padding above or below it;
 *   - Home, when selected, in the bright blue instead of the tint;
 *   - the greys shown side by side, so they can be compared.
 *
 * The page opens with comparison grids (frame grey, focus grey, Home's tint,
 * touching or apart), each cell labelled with its ID; the concepts below
 * carry the verdict buttons.
 *
 *   npx tsx scripts/done-next-mockup-r7.ts   → mockups/done-next-2026-10-round7.html
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { mix } from '../src/shell/home-art.js'
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

/* ----------------------------------------------- the buttons, round seven */

interface Button {
  key: string
  label: string
  home?: boolean
}
const BUTTONS: Button[] = [
  { key: 'o', label: 'Open' },
  { key: 'f', label: 'Finder' },
  { key: 'p', label: 'Save as preset' },
  { key: 'e', label: 'Continue editing' },
  { key: '↵', label: 'Home', home: true },
]
const HOME_AT = BUTTONS.length - 1
const OPEN_AT = 0

interface Look {
  /** The frame's grey. */
  fill: string
  /** A selected grey button's fill. */
  lift: string
  /** Home's tint, while it is not selected. */
  tint: string
}

/** Home: two cells either side of its words. */
const HOME_PAD = 2
/** One cell of the frame's grey at either end of its buttons. */
const SIDE = 1

/**
 * The frame with the four buttons, then Home's block, three rows each, `gap`
 * cells of canvas between. A selected button's fill runs all three rows:
 * a grey one in `lift`, Home in the bright blue.
 */
function rows(k: Look, gap: number, at: number): Cell[][] {
  const homeSel = at === HOME_AT
  const homeBg = homeSel ? MODE : k.tint
  const homeFg = homeSel ? q.ink : MODE
  const home: Seg[] = [
    [`${' '.repeat(HOME_PAD)}↵`, homeFg, homeBg, true],
    [` Home${' '.repeat(HOME_PAD)}`, homeFg, homeBg, true],
  ]
  const homeW = len(home)
  const frameW = W - homeW - gap
  const parts: Seg[][] = BUTTONS.slice(0, HOME_AT).map((b, i) => {
    const sel = i === at
    const bg = sel ? k.lift : k.fill
    return [
      [` ${b.key}`, q.fg, bg, true],
      [` ${b.label} `, sel ? q.fg : q.dim, bg, sel],
    ]
  })
  const spare = frameW - 2 * SIDE - parts.reduce((n, p) => n + len(p), 0)
  const gaps = parts.length - 1
  const gapAt = (i: number) => Math.floor((spare * (i + 1)) / gaps) - Math.floor((spare * i) / gaps)
  const segs: Seg[] = parts.flatMap((p, i) =>
    i ? [[' '.repeat(gapAt(i - 1)), undefined, k.fill] as Seg, ...p] : p,
  )
  const words = line(L, [[' '.repeat(frameW), undefined, k.fill]])
  put(words, L + SIDE, segs)
  put(words, R - homeW, home)
  // Above and below: the frame's grey, except under a selected grey button and Home.
  const pad = () => {
    const r = line(L, [[' '.repeat(frameW), undefined, k.fill]])
    words.forEach((c, x) => {
      if (x < L + frameW && c.bg === k.lift && at !== HOME_AT) r[x] = { ch: ' ', bg: k.lift }
    })
    put(r, R - homeW, [[' '.repeat(homeW), undefined, homeBg]])
    return r
  }
  return [pad(), words, pad()]
}

const KEYS = keyRow([cap('←→', 'choose'), cap('↵', 'confirm')])
const onScreen = (r: Cell[][]) => shot(screen(doneTop(), [...r, blankRow(), RULE, KEYS]))

/* ------------------------------------------------------------ the looks */

const F_CANVAS = q.canvas
const F_212 = mix(q.canvas, q.shelf, 0.5)
const F_242 = q.shelf
const F_282 = mix(q.shelf, q.selectionBg, 0.5)
const F_2C2 = q.selectionBg

const BASE: Look = { fill: F_242, lift: q.keycapBg, tint: MODE_BG }
const BRIGHTER = mix(MODE_BG, MODE, 0.15)
const DEEPER = mix(MODE_BG, q.canvas, 0.35)

/* -------------------------------------------------- side-by-side grids */

/** A grid: a label column, then one column per `cols`, one row per `rows`; each cell drawn by `draw`. */
function compare<R, C>(
  title: string,
  note: string,
  rowsOf: Array<[string, R]>,
  cols: Array<[string, C]>,
  draw: (r: R, c: C) => Cell[][],
): string {
  const head = `<div></div>${cols.map(([c]) => `<div class="ch">${c}</div>`).join('')}`
  const body = rowsOf
    .map(
      ([label, r]) =>
        `<div class="rh">${label}</div>${cols.map(([, c]) => `<div>${shot(draw(r, c))}</div>`).join('')}`,
    )
    .join('')
  return `<h2>${title}</h2><p class="lede">${note}</p><div class="cmp" style="grid-template-columns:120px repeat(${cols.length}, max-content)">${head}${body}</div>`
}

const FRAMES: Array<[string, Look]> = [
  ['Y32 · #1e1e1e<br>the background', { ...BASE, fill: F_CANVAS, lift: q.selectionBg }],
  ['Y33 · #212121', { ...BASE, fill: F_212, lift: q.selectionBg }],
  ['Y30 · #242424<br>as now', BASE],
  ['Y34 · #282828', { ...BASE, fill: F_282 }],
  ['Y39 · #2c2c2c', { ...BASE, fill: F_2C2, lift: q.panelBand }],
]
const STATES: Array<[string, number]> = [
  ['Home selected', HOME_AT],
  ['Open selected', OPEN_AT],
]
const LIFTS: Array<[string, string]> = [
  ['Y35 · #2c2c2c', q.selectionBg],
  ['Y30 · #333333<br>as now', q.keycapBg],
  ['Y40 · #3a3a3a', mix(q.keycapBg, q.panelBand, 0.5)],
  ['Y36 · #3d3d3d', q.fieldBand],
  ['Y41 · #404040', q.panelBand],
]
const TINTS: Array<[string, string]> = [
  ['Y38 · deeper', DEEPER],
  ['Y30 · as now', MODE_BG],
  ['Y37 · brighter', BRIGHTER],
]

const grids = [
  compare(
    'Compare: the frame’s grey',
    'Each row one frame grey; left with Home selected (bright blue), right with Open selected (its grey fills all three rows, Home back to the tint). Touching.',
    FRAMES,
    STATES,
    (k, at) => rows(k, 0, at),
  ),
  compare(
    'Compare: a selected button’s grey',
    'Open selected. Each row one grey for the selected button; left on Y30’s #242424 frame, right on Y32’s frame, the background’s grey.',
    LIFTS,
    [
      ['frame #242424', F_242],
      ['frame #1e1e1e', F_CANVAS],
    ],
    (lift, fill) => rows({ ...BASE, fill, lift }, 0, OPEN_AT),
  ),
  compare(
    'Compare: Home’s tint',
    'Open selected, so Home shows its tint. Left on the #242424 frame, right on the background’s grey.',
    TINTS,
    [
      ['frame #242424', F_242],
      ['frame #1e1e1e', F_CANVAS],
    ],
    (tint, fill) =>
      rows(
        { ...BASE, fill, lift: fill === F_CANVAS ? q.selectionBg : q.keycapBg, tint },
        0,
        OPEN_AT,
      ),
  ),
  compare(
    'Compare: touching or a cell apart',
    'Y30 against Y31, in both states.',
    [
      ['Y30 · touching', 0],
      ['Y31 · a cell apart', 1],
    ],
    STATES,
    (gap, at) => rows(BASE, gap, at),
  ),
].join('')

/* ------------------------------------------------------------ concepts */

/** A concept's figure: the screen with Home selected, then with Open selected. */
const figure = (k: Look, gap = 0) =>
  `<div style="display:flex;flex-direction:column;gap:18px">${onScreen(rows(k, gap, HOME_AT))}${onScreen(rows(k, gap, OPEN_AT))}</div>`

const concepts: PageConcept[] = [
  {
    id: 'Y30',
    name: 'Touching, as now',
    idea: 'The frame #242424, a selected button #333333 for all three rows, Home’s tint, Home bright blue when selected. Top: Home selected, as Done opens. Bottom: Open selected.',
    earlier: 'like',
    html: figure(BASE, 0),
    section: 'Rate them here (the grids above show the same IDs)',
  },
  {
    id: 'Y31',
    name: 'A cell apart',
    idea: 'Y30 with a cell of canvas between the frame and Home.',
    earlier: 'like',
    html: figure(BASE, 1),
  },
  ...FRAMES.filter(([l]) => !l.startsWith('Y30')).map(
    ([label, k]): PageConcept => ({
      id: label.split(' · ')[0] ?? '',
      name: `The frame ${label.split(' · ')[1]?.replace('<br>', ', ')}`,
      idea: `The frame in ${label.split(' · ')[1]?.split('<br>')[0]}; a selected button in ${k.lift}.`,
      html: figure(k, 0),
    }),
  ),
  ...LIFTS.filter(([l]) => !l.startsWith('Y30')).map(
    ([label, lift]): PageConcept => ({
      id: label.split(' · ')[0] ?? '',
      name: `A selected button in ${label.split(' · ')[1]}`,
      idea: `Y30 with a selected button in ${lift}.`,
      html: figure({ ...BASE, lift }, 0),
    }),
  ),
  ...TINTS.filter(([l]) => !l.startsWith('Y30')).map(
    ([label, tint]): PageConcept => ({
      id: label.split(' · ')[0] ?? '',
      name: `Home’s tint, ${label.split(' · ')[1]}`,
      idea: `Y30 with Home’s tint ${tint}, while something else is selected.`,
      html: figure({ ...BASE, tint }, 0),
    }),
  ),
]

const before = `<div class="box"><h3>Decided so far</h3>
<p style="margin:4px 0 0">A frame holding Open, Finder, Save as preset and Continue editing, and Home as its own block at the right edge, both three rows tall. ←→ moves the selection; ↵ confirms. A selected grey button fills all three rows, as Home does. Home is the tint, and bright blue while selected. Finder is f.</p></div>
<div class="box"><h3>Questions for you</h3><ol>
<li>With ←→ moving the selection, → can’t open Continue editing, so it’s <code>e</code> here. All right?</li>
<li>When Done opens, Home is selected, so it starts bright blue. All right?</li>
</ol></div>
${grids}
<style>.cmp{display:grid;gap:12px 18px;align-items:center;margin:16px 0 8px}.cmp .ch{font:12px "SF Mono",ui-monospace,Menlo,monospace;color:#8f94a1}.cmp .rh{font:12px "SF Mono",ui-monospace,Menlo,monospace;color:#c7cbd4;text-align:right;line-height:1.5}.cmp .t{padding:6px 12px}</style>`

writeFileSync(
  'mockups/done-next-2026-10-round7.html',
  feedbackPage({
    page: 'done-next-r7',
    title: 'Forge · the way on from Done, round seven',
    heading: 'Done: ←→, full-height selection, greys side by side',
    lede: '←→ moves between the buttons. A selected grey button fills all three rows like Home, and Home turns bright blue when selected. First the greys in grids, side by side; then the same IDs with verdict buttons. Captured from the app, dark, 80 × 24.',
    before,
    concepts,
  }),
)
console.log('wrote mockups/done-next-2026-10-round7.html')
