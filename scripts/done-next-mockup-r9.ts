/**
 * The way on from Done, round nine (2026-10-22): a picker instead of grids.
 * Round seven/eight's comparison grids were "very overwhelming" — every
 * grey twice, in two states, against two frames, then again with verdict
 * buttons, with no clear way to answer. Here there is one screen and one
 * row of choices per colour; a click repaints the screen in place, so the
 * greys are compared by flicking between them on the same spot. The chosen
 * chips are the answer, saved to mockups/feedback/done-next-r9.json.
 *
 * The design is round eight's: the grey buttons flush on the frame's left
 * edge, a selected one filling all three rows, Home bright blue while
 * selected and the tint otherwise, ←→ to move, Continue editing on e.
 *
 *   npx tsx scripts/done-next-mockup-r9.ts   → mockups/done-next-2026-10-round9.html
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { mix } from '../src/shell/home-art.js'
import { DARK, modePalette } from '../src/shell/theme.js'
import { type Cell, type Grid, gridHtml, TERM_CSS, termHtml } from './term-cells.js'

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
/** The grey buttons start on the frame's left edge; one cell of its grey after the last. */
const LEFT = 0
const RIGHT = 1

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
  const spare = frameW - LEFT - RIGHT - parts.reduce((n, p) => n + len(p), 0)
  const gaps = parts.length - 1
  const gapAt = (i: number) => Math.floor((spare * (i + 1)) / gaps) - Math.floor((spare * i) / gaps)
  const segs: Seg[] = parts.flatMap((p, i) =>
    i ? [[' '.repeat(gapAt(i - 1)), undefined, k.fill] as Seg, ...p] : p,
  )
  const words = line(L, [[' '.repeat(frameW), undefined, k.fill]])
  put(words, L + LEFT, segs)
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

/* -------------------------------------------------------------- choices */

type Choice = [id: string, label: string, colour: string]
const FRAMES: Choice[] = [
  ['bg', 'Same as background', q.canvas],
  ['212121', '#212121', mix(q.canvas, q.shelf, 0.5)],
  ['242424', '#242424 (now)', q.shelf],
  ['282828', '#282828', mix(q.shelf, q.selectionBg, 0.5)],
  ['2c2c2c', '#2c2c2c', q.selectionBg],
]
const LIFTS: Choice[] = [
  ['2c2c2c', '#2c2c2c', q.selectionBg],
  ['333333', '#333333 (now)', q.keycapBg],
  ['3a3a3a', '#3a3a3a', mix(q.keycapBg, q.panelBand, 0.5)],
  ['3d3d3d', '#3d3d3d', q.fieldBand],
  ['404040', '#404040', q.panelBand],
]
const TINTS: Choice[] = [
  ['deeper', 'Deeper', mix(MODE_BG, q.canvas, 0.35)],
  ['now', 'As now', MODE_BG],
  ['brighter', 'Brighter', mix(MODE_BG, MODE, 0.15)],
]
const GAPS: Choice[] = [
  ['0', 'Touching', ''],
  ['1', 'One cell apart', ''],
]
const VIEWS: Choice[] = [
  ['home', 'Home selected', ''],
  ['open', 'Open selected', ''],
]

/** Every combination's button rows, keyed frame|lift|tint|gap|view. */
const strips: Record<string, string> = {}
for (const [f, , fill] of FRAMES)
  for (const [l, , lift] of LIFTS)
    for (const [t, , tint] of TINTS)
      for (const [g] of GAPS)
        for (const [v] of VIEWS)
          strips[[f, l, t, g, v].join('|')] = gridHtml(
            rows({ fill, lift, tint }, Number(g), v === 'home' ? HOME_AT : OPEN_AT),
            q,
          )

/** The screen around the buttons, drawn once: everything above them, and the rule and keys below. */
const sample = screen(doneTop(), [
  ...rows({ fill: q.shelf, lift: q.keycapBg, tint: MODE_BG }, 0, HOME_AT),
  blankRow(),
  RULE,
  KEYS,
])
const above = gridHtml(sample.slice(0, sample.length - 6), q)
const below = gridHtml(sample.slice(sample.length - 3), q)

const START = { frame: '242424', lift: '333333', tint: 'now', gap: '0', view: 'home' }

const chips = (name: string, title: string, list: Choice[], hint = '') =>
  `<div class="q"><div class="qt">${title}${hint ? `<span class="hint">${hint}</span>` : ''}</div><div class="chips">${list
    .map(
      ([id, label, colour]) =>
        `<button class="chip" data-name="${name}" data-id="${id}">${colour ? `<span class="sw" style="background:${colour}"></span>` : ''}${label}</button>`,
    )
    .join('')}</div></div>`

const html = `<!doctype html><html><head><meta charset="utf-8"><title>Forge · Done, pick the colours</title>
<style>
  body { margin:0; background:#0d0e11; color:#e2e4ea; font:16px/1.6 -apple-system, BlinkMacSystemFont, "Helvetica Neue", sans-serif; }
  main { max-width:1400px; margin:0 auto; padding:40px 24px 80px; }
  h1 { font-size:28px; margin:0 0 6px; }
  .lede { color:#8f94a1; margin:0 0 28px; max-width:900px; }
  .layout { display:flex; gap:40px; align-items:flex-start; }
  .views { display:flex; flex-direction:column; gap:18px; }
  .big .t { zoom:1.5; }
  .picks { min-width:380px; }
  .q { margin:0 0 22px; }
  .qt { font-weight:620; margin-bottom:8px; }
  .hint { font-weight:400; color:#8f94a1; font-size:13px; margin-left:8px; }
  .chips { display:flex; flex-wrap:wrap; gap:8px; }
  .chip { font:500 14px -apple-system, BlinkMacSystemFont, sans-serif; color:#c7cbd4; background:#16181d; border:1px solid #2c2f37; border-radius:8px; padding:7px 12px; cursor:pointer; display:flex; align-items:center; gap:8px; }
  .chip:hover { border-color:#4a4f5a; color:#fff; }
  .chip.on { border-color:#55c7d9; background:#12282e; color:#8fe3f0; }
  .sw { width:16px; height:16px; border-radius:4px; border:1px solid #4a4f5a; }
  .view { border-top:1px solid #23252c; padding-top:18px; margin-top:6px; }
  .status { font:13px "SF Mono", ui-monospace, Menlo, monospace; color:#8f94a1; margin-top:8px; }
  .copy { font:500 14px -apple-system, sans-serif; color:#c7cbd4; background:#16181d; border:1px solid #2c2f37; border-radius:8px; padding:8px 14px; cursor:pointer; }
  ${TERM_CSS}
</style></head><body><main>
<h1>Done: pick the colours</h1>
<p class="lede">Click one choice in each row on the right. The screen changes straight away, so you can flick between two choices and compare them in the same spot. The highlighted choices are your picks, and they save on their own.</p>
<div class="layout">
  <div class="views">
    <div class="t" style="background:${q.canvas}">${above}<div id="strip"></div>${below}</div>
    <div class="big"><div class="t" style="background:${q.canvas}"><div id="strip-big"></div></div></div>
  </div>
  <div class="picks">
    ${chips('frame', '1. The frame’s grey', FRAMES)}
    ${chips('lift', '2. A selected button’s grey', LIFTS, 'shows Open selected')}
    ${chips('tint', '3. Home’s colour when not selected', TINTS, 'shows Open selected')}
    ${chips('gap', '4. Space before Home', GAPS)}
    <div class="view">${chips('view', 'Look at it with', VIEWS, 'not a pick, just the view')}</div>
    <button class="copy">Copy my picks</button>
    <div class="status"></div>
  </div>
</div>
<script>
const STRIPS = ${JSON.stringify(strips)}
const PAGE = 'done-next-r9'
let state = Object.assign(${JSON.stringify(START)}, JSON.parse(localStorage.getItem(PAGE) || '{}'))
const status = document.querySelector('.status')
function paint() {
  const key = [state.frame, state.lift, state.tint, state.gap, state.view].join('|')
  document.getElementById('strip').innerHTML = STRIPS[key]
  document.getElementById('strip-big').innerHTML = STRIPS[key]
  for (const c of document.querySelectorAll('.chip')) c.classList.toggle('on', state[c.dataset.name] === c.dataset.id)
}
function label(name) { const c = document.querySelector('.chip[data-name="' + name + '"][data-id="' + state[name] + '"]'); return c ? c.textContent : '' }
function summary() { return 'done-next-r9 picks: frame ' + label('frame') + ' · selected ' + label('lift') + ' · Home tint ' + label('tint') + ' · ' + label('gap') }
async function save() {
  localStorage.setItem(PAGE, JSON.stringify(state))
  if (!location.protocol.startsWith('http')) { status.textContent = 'kept in this browser · use Copy my picks'; return }
  const picks = { frame: label('frame'), lift: label('lift'), tint: label('tint'), gap: label('gap') }
  try {
    const r = await fetch('/feedback/' + PAGE, { method: 'POST', body: JSON.stringify({ page: PAGE, picks }) })
    status.textContent = r.ok ? 'saved · ' + new Date().toLocaleTimeString() : 'not saved · use Copy my picks'
  } catch { status.textContent = 'not saved · use Copy my picks' }
}
for (const c of document.querySelectorAll('.chip'))
  c.addEventListener('click', () => {
    state[c.dataset.name] = c.dataset.id
    // The selected grey and Home's tint only show while Home is not selected.
    if (c.dataset.name === 'lift' || c.dataset.name === 'tint') state.view = 'open'
    paint()
    if (c.dataset.name !== 'view') save()
  })
document.querySelector('.copy').addEventListener('click', async () => { await navigator.clipboard.writeText(summary()); status.textContent = 'copied · paste it to Claude' })
paint()
</script>
</main></body></html>`

writeFileSync('mockups/done-next-2026-10-round9.html', html)
console.log('wrote mockups/done-next-2026-10-round9.html')
