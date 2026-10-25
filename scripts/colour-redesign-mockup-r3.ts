/**
 * Colour mode, simpler — round 2 (2026-10-24). Round 1
 * (colour-redesign-2026-10.html) reorganised and with two changes:
 *
 * - colour's home stays as it is (three cards: Extract, Scale, Palette); the
 *   only home explorations are other takes on the cards themselves;
 * - Scale and Palette are two tabs of one colour screen, so the S and D cards
 *   open the same screen on their own tab, and the tab keeps the name Scale.
 *
 * Round 3 (2026-10-24): the user found round 2 hard to follow because it
 * mixed the flows with choices. This page is only the design: the idea, then
 * the two flows, top to bottom, one scroll, no tabs and no options. The
 * open choices were decided (A2 the colour big, B1 a list on m, home kept)
 * and are not shown.
 *
 *   npx tsx scripts/colour-redesign-mockup-r3.ts → mockups/colour-redesign-2026-10-round3.html
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { DEFAULT_STEPS, scale, stepsOf } from '../src/core/colour/scale.js'
import { formatOklch, formatRgb, parseHex, type Rgb } from '../src/core/colour/space.js'
import { NO_TWEAK, system, type Tweak, tweakSteps } from '../src/core/colour/system.js'
import { trailBarRow } from '../src/shell/bar-art.js'
import { fieldRows, fieldValue, rampRows } from '../src/shell/colour/colour-art.js'
import { type Row, surfaceRows } from '../src/shell/home-art.js'
import { sliderRow } from '../src/shell/quality-art.js'
import { DARK, modePalette } from '../src/shell/theme.js'
import { feedbackPage, type PageConcept } from './feedback-page.js'
import { type Cell, type Grid, termHtml } from './term-cells.js'

const P = modePalette(DARK, 'colour')
const W = 80
const H = 26
const CANVAS = '#1e1e1e'
const FG = '#e7e7e7'
const DIM = '#b0b0b0'
const QUIET = '#808080'
const FAINT = '#4d4d4d'
const CAP = '#333333'
const FIELD = '#2c2c2c'
const SHELF = '#242424'
const PINK = '#f27ba8'
const FORMATS = 'JPEG · PNG · HEIC · WebP · TIFF'

type Raw = { ch: string; fg: string | null; bg: string | null; b: boolean }
const FRAMES = JSON.parse(
  readFileSync(new URL('./colour-redesign-frames.json', import.meta.url), 'utf8'),
) as Record<string, Raw[][]>
const frame = (k: string): Grid =>
  (FRAMES[k] as Raw[][]).map((r) =>
    r.map((c) => ({ ch: c.ch, fg: c.fg ?? undefined, bg: c.bg ?? CANVAS, b: c.b })),
  )
const empty = (): Grid =>
  Array.from({ length: H }, () => Array.from({ length: W }, () => ({ ch: ' ', bg: CANVAS })))

/* ------------------------------------------------------------- drawing */

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
function clear(g: Grid, from: number, to: number, c0 = 0, c1 = W): void {
  for (let r = from; r <= to; r++)
    for (let c = c0; c < c1; c++) (g[r] as Cell[])[c] = { ch: ' ', bg: CANVAS }
}
/** An art row (runs) onto row `r`, from column `at` (the app's 2-cell paint inset). */
function row(g: Grid, r: number, runs: Row, at = 2): void {
  put(
    g,
    r,
    at,
    runs.map((x) => [x.text, x.fg, x.bg, x.bold] as Seg),
  )
}
const rows = (g: Grid, r: number, rs: Row[], at = 2) => rs.forEach((x, i) => row(g, r + i, x, at))

/** The header bar: colour's chip, then the trail. */
function bar(g: Grid, answers: string[], current?: string) {
  clear(g, 1, 1)
  row(
    g,
    1,
    trailBarRow({ width: 76, palette: P, mode: 'colour', trail: { answers, current }, slanted: false }),
  )
}
/** The field: a filled block of three rows. */
function field(g: Grid, top: number, content: Row, focus = false, fill = FIELD) {
  const rs = fieldRows({ width: 76, palette: P, content, focus }).map((r) =>
    r.map((x) => (x.bg === P.selectionBg ? { ...x, bg: fill } : x)),
  )
  rows(g, top, rs)
}
/** A key on its chip at a field's far end (the decided in-field hint, grey in colour mode). */
const chipHint = (k: string, w: string): Seg[] => [
  [' ', undefined, QUIET],
  [k, CANVAS, QUIET, true],
  [' ', undefined, QUIET],
  [` ${w}`, QUIET],
]
/** The rule over the keys, and the key row: caps on grey, the foot at the right margin. */
function keys(g: Grid, main: Array<[string, string]>, foot: Array<[string, string]>) {
  clear(g, 24, 25)
  put(g, 24, 4, [['─'.repeat(72), QUIET]])
  let at = 4
  for (const [k, w] of main) {
    put(g, 25, at, [
      [' ', undefined, CAP],
      [k, FG, CAP, true],
      [' ', undefined, CAP],
      [` ${w}`, DIM],
    ])
    at += [...k].length + 3 + w.length + 2
  }
  const segs: Seg[] = foot.flatMap(([k, w], i) => [
    ...(i ? ([[foot[i - 1]?.[1] ? ' · ' : ' ', QUIET]] as Seg[]) : []),
    [k, FG] as Seg,
    ...(w ? ([[` ${w}`, QUIET]] as Seg[]) : []),
  ])
  put(g, 25, 76 - len(segs), segs)
}
/** Tabs, as Scale's are drawn: names, then a rule with the chosen one underlined in pink. */
function tabs(g: Grid, r: number, names: string[], on: number, hint = true) {
  clear(g, r, r + 1)
  let at = 6
  put(g, r + 1, 4, [['─'.repeat(72), FAINT]])
  names.forEach((n, i) => {
    put(g, r, at, [[n, i === on ? FG : DIM, undefined, i === on]])
    if (i === on) put(g, r + 1, at - 2, [['━'.repeat(n.length + 4), PINK]])
    at += n.length + 4
  })
  if (hint) put(g, r, 64, [[' ', undefined, CAP], ['tab', FG, CAP, true], [' ', undefined, CAP], [' switch', DIM]])
}

/* --------------------------------------------------------------- data */

const BLUE = parseHex('#6579FD') as Rgb
const PURPLE = parseHex('#AC96EF') as Rgb
const stepsFor = (ref: Rgb, t: Tweak = NO_TWEAK) =>
  t === NO_TWEAK ? scale(ref) : tweakSteps((r) => scale(r), ref, t, 5)
const hex = (rgb: Rgb) => `#${[rgb.r, rgb.g, rgb.b].map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase()}`

/** The ramp under the tabs (labels at `top`), its chosen step marked with a heavier bar. */
function ramp(g: Grid, top: number, ref: Rgb, sel = 5, t: Tweak = NO_TWEAK) {
  const rs = rampRows({ width: 76, palette: P, steps: stepsFor(ref, t), selected: sel })
  rows(g, top, rs)
  // The chosen step's mark: a white line either side of it, in the gaps, as on Palette.
  const under = g[top + 4] as Cell[]
  const at = under.findIndex((c) => c.ch === '▔')
  for (let c = 0; c < W; c++) if (under[c]?.ch === '▔') under[c] = { ch: ' ', bg: CANVAS }
  if (at >= 0) mark(g, top + 1, top + 3, at - 1, at + 5)
}
/** The chosen swatch's mark: thin white lines in the gap columns either side. */
function mark(g: Grid, r0: number, r1: number, left: number, right: number) {
  for (let r = r0; r <= r1; r++) {
    put(g, r, left, [['▕', FG]])
    put(g, r, right, [['▏', FG]])
  }
}

/* ------------------------------------------------------------- screens */

/** Colour's home, as every mode's home: the drop zone, the field under it. */
function home(typed?: string): Grid {
  const g = frame('home')
  clear(g, 8, 23)
  const typing = typed !== undefined
  rows(
    g,
    8,
    surfaceRows({
      width: 76,
      rows: 8,
      palette: P,
      mode: 'colour',
      typing,
      kinds: FORMATS,
      title: 'Drop a photo here',
    }),
  )
  // Home's shelf under the drop zone, then the field on it.
  put(g, 15, 4, [[' '.repeat(72), undefined, FIELD]])
  for (const r of [16, 17, 18]) put(g, r, 4, [[' '.repeat(72), undefined, SHELF]])
  if (typed) {
    put(g, 17, 6, [['›', PINK, SHELF, true], [' '], [typed, FG, SHELF], ['  '], ['    ', undefined, typed]])
    const hint = chipHint('↵', 'open')
    put(g, 17, 74 - len(hint), hint)
  } else {
    put(g, 17, 6, [['›', QUIET, SHELF, true], [' '], ['OR type a colour', QUIET, SHELF]])
  }
  put(g, 23, 68, [[' ', undefined, CAP], ['/', FG, CAP], [' ', undefined, CAP], [' menu', DIM]])
  keys(
    g,
    [],
    typing
      ? [
          ['esc', 'clear'],
          ['ctrl-c', 'quit'],
        ]
      : [
          ['1–6', ''],
          ['←→', 'mode'],
          ['ctrl-c', 'quit'],
        ],
  )
  if (typing) put(g, 25, 4, [[' ', undefined, CAP], ['↵', FG, CAP, true], [' ', undefined, CAP], [' open', DIM]])
  return g
}

type Under = 'line' | 'big' | 'palette'
const COPY_KEYS: Array<[string, string]> = [
  ['↵', 'copy'],
  ['c', 'copy for Figma'],
]
const FOOT: Array<[string, string]> = [
  ['m', 'more'],
  ['esc', 'back'],
]

/** What sits under the ramp: one line, the chosen colour big, or the palette as thin rows. */
function underRamp(g: Grid, top: number, ref: Rgb, sel: number, how: Under, flash?: string) {
  const step = stepsFor(ref)[sel]
  if (!step) return
  if (how === 'line') {
    put(g, top, 4, flash ? [['✓', P.ok, undefined, true], [` ${flash}`, FG]] : [[String(step.step), FG, undefined, true], ['  '], [step.hex, FG, undefined, true]])
    return
  }
  if (how === 'big') {
    for (let r = 0; r < 5; r++) put(g, top + r, 4, [[' '.repeat(16), undefined, step.hex]])
    put(g, top + 1, 6, [['Aa', '#ffffff', step.hex, true]])
    put(g, top + 3, 6, [['Aa', '#000000', step.hex, true]])
    put(g, top + 1, 9, [['white text', '#ffffff', step.hex]])
    put(g, top + 3, 9, [['black text', '#000000', step.hex]])
    if (flash) put(g, top, 24, [['✓', P.ok, undefined, true], [` ${flash}`, FG]])
    else put(g, top, 24, [[String(step.step), DIM], ['  '], [step.hex, FG, undefined, true]])
    put(g, top + 2, 24, [[formatRgb(step.rgb), DIM]])
    put(g, top + 3, 24, [[formatOklch(step.rgb), DIM]])
    return
  }
  // The rest of the palette as thin rows, each on the ramp's columns.
  const sys = system(ref, 'full', NO_TWEAK, DEFAULT_STEPS)
  const others = [...sys.rows.filter((r) => !r.yours), { name: 'neutral', steps: sys.neutral }]
  put(g, top, 4, [[String(step.step), FG, undefined, true], ['  '], [step.hex, FG, undefined, true]])
  others.slice(0, 8).forEach((r, i) => {
    r.steps.forEach((s, c) => put(g, top + 2 + i, 4 + c * 6, [['     ', undefined, s.hex]]))
    put(g, top + 2 + i, 70, [[(r.name === 'neutral' ? 'grey' : r.name).slice(0, 6), QUIET]])
  })
}

/** A colour's Shades: the field, Shades | Palette, the ramp, and what's under it. */
function shades(
  ref: Rgb,
  {
    trail = [] as string[],
    sel = 5,
    how = 'big' as Under,
    flash,
    tabbed = true,
  }: { trail?: string[]; sel?: number; how?: Under; flash?: string; tabbed?: boolean } = {},
): Grid {
  const g = empty()
  bar(g, trail, hex(ref))
  field(g, 3, fieldValue({ palette: P, value: hex(ref), swatch: true }))
  if (tabbed) {
    tabs(g, 7, ['Scale', 'Palette'], 0)
    ramp(g, 9, ref, sel)
    underRamp(g, 15, ref, sel, how, flash)
  } else {
    ramp(g, 7, ref, sel)
    underRamp(g, 12, ref, sel, how, flash)
  }
  keys(g, [['←→', 'choose'], ...COPY_KEYS], FOOT)
  return g
}

/** A colour's Palette: every family on the same steps, yours first, all rows showing. */
function paletteOf(ref: Rgb, { trail = [] as string[] } = {}): Grid {
  const g = empty()
  bar(g, trail, hex(ref))
  field(g, 3, fieldValue({ palette: P, value: hex(ref), swatch: true }))
  tabs(g, 7, ['Scale', 'Palette'], 1)
  const sys = system(ref, 'full', NO_TWEAK, DEFAULT_STEPS)
  const yours = sys.rows.find((r) => r.yours)
  const ordered = [
    ...(yours ? [yours] : []),
    ...sys.rows.filter((r) => !r.yours),
    { name: 'neutral', steps: sys.neutral, yours: false },
  ]
  // Every row on one line, touching, so all nine show at 80×26.
  put(g, 9, 14, stepsOf(DEFAULT_STEPS).map((n, c) => [(n < 100 ? ` ${n}` : String(n)).padEnd(5), c === 5 ? FG : QUIET, undefined, c === 5] as Seg))
  ordered.forEach((r, i) => {
    const name = r.name === 'neutral' ? 'grey' : r.name
    put(g, 10 + i, 4, [[name, i === 0 ? PINK : DIM, undefined, i === 0]])
    r.steps.forEach((st, c) => put(g, 10 + i, 14 + c * 5, [['    ', undefined, st.hex]]))
  })
  mark(g, 10, 10, 38, 43)
  const chosen = ordered[0]?.steps[5]
  if (chosen)
    put(g, 20, 4, [[ordered[0]?.name ?? '', FG, undefined, true], [' 500', FG, undefined, true], ['  '], [chosen.hex, FG, undefined, true], ['  '], [formatRgb(chosen.rgb), DIM]])
  keys(g, [['↑↓←→', 'choose'], ...COPY_KEYS], FOOT)
  return g
}

/** The More list, opened by m: a framed list over the bottom right. */
const MORE = [
  ['Blend with a colour', 'b'],
  ['See-through', 'a'],
  ['Adjust', 't'],
  ['Steps', 's'],
] as const
function moreBox(g: Grid, items: readonly (readonly [string, string])[] = MORE, at = 0) {
  const w = 30
  const left = 76 - w
  const top = 23 - items.length - 3
  clear(g, top, 23, left - 1, 76)
  put(g, top, left, [['╭─ ', QUIET], ['More', FG, undefined, true], [` ${'─'.repeat(w - 9)}╮`, QUIET]])
  put(g, top + 1, left, [['│', QUIET], [' '.repeat(w - 2), undefined, FIELD], ['│', QUIET]])
  items.forEach(([name, k], i) => {
    const r = top + 2 + i
    const on = i === at
    put(g, r, left, [['│', QUIET], [' '.repeat(w - 2), undefined, on ? '#404040' : FIELD], ['│', QUIET]])
    put(g, r, left + 2, [[on ? '▌' : ' ', PINK, on ? '#404040' : FIELD], [' '], [name, on ? FG : DIM, on ? '#404040' : FIELD, on]])
    put(g, r, left + w - 4, [[k, QUIET, on ? '#404040' : FIELD]])
  })
  put(g, top + 2 + items.length, left, [['│', QUIET], [' '.repeat(w - 2), undefined, FIELD], ['│', QUIET]])
  put(g, top + 3 + items.length, left, [[`╰${'─'.repeat(w - 2)}╯`, QUIET]])
}
function withMore(g: Grid, items: readonly (readonly [string, string])[] = MORE): Grid {
  moreBox(g, items)
  keys(
    g,
    [
      ['↑↓', 'choose'],
      ['↵', 'open'],
    ],
    [
      ['esc', 'close'],
      ['ctrl-c', 'quit'],
    ],
  )
  return g
}

/** Adjust: the sliders along the bottom; the ramp above stays in view and changes live. */
function adjust(ref: Rgb): Grid {
  const t: Tweak = { brightness: 12, saturation: -20, hue: 0, contrast: 0 }
  const g = empty()
  bar(g, [hex(ref)], 'Adjust')
  field(g, 3, fieldValue({ palette: P, value: hex(ref), swatch: true }))
  tabs(g, 7, ['Scale', 'Palette'], 0, false)
  ramp(g, 9, ref, 5, t)
  put(g, 15, 4, [['─'.repeat(72), FAINT]])
  const names = ['brightness', 'saturation', 'hue', 'contrast'] as const
  names.forEach((n, i) => {
    const r = 16 + i * 2
    const on = i === 1
    put(g, r, 4, [[on ? '▌' : ' ', PINK], [' '], [n.padEnd(12), on ? FG : DIM, undefined, on]])
    row(
      g,
      r,
      sliderRow({ palette: P, value: t[n], min: n === 'hue' ? -180 : -100, max: n === 'hue' ? 180 : 100, width: 50 }),
      21,
    )
  })
  keys(
    g,
    [
      ['↑↓', 'choose'],
      ['←→', 'change'],
      ['↵', 'done'],
    ],
    [
      ['r', 'reset'],
      ['esc', 'cancel'],
    ],
  )
  return g
}

/** The photo's colours: today's photo and list, the note gone, keys in the key row. */
function photo(sel = 0): Grid {
  const g = frame('extract')
  bar(g, [], 'Extract')
  clear(g, 17, 23)
  if (sel !== 0) {
    // Move the chosen mark (▌ at col 24) and the bright list row.
    for (let r = 6; r <= 14; r++) {
      const cells = g[r] as Cell[]
      if (cells[24]?.ch === '▌') cells[24] = { ch: ' ', bg: CANVAS }
    }
    put(g, 7 + sel, 24, [['▌', PINK]])
  }
  const hexes = ['#AC96EF', '#89B929', '#275F22', '#6678FF', '#B3E72E', '#F9716E', '#5A8E25']
  const pcts = ['18', '15', '15', '15', '13', '12', '12']
  put(g, 18, 4, [[hexes[sel] ?? '', FG, undefined, true], ['  '], [`${pcts[sel]}% of the photo`, DIM]])
  keys(g, [['↑↓', 'choose'], ...COPY_KEYS], [['→', 'open'], ...FOOT])
  return g
}

/** Option: extras as more tabs, always in view. */
function tabsForAll(): Grid {
  const g = shades(BLUE, { how: 'line' })
  tabs(g, 7, ['Scale', 'Palette', 'Blend', 'See-through'], 0)
  clear(g, 15, 23)
  underRamp(g, 15, BLUE, 5, 'line')
  keys(g, [['←→', 'choose'], ...COPY_KEYS], [['t', 'adjust'], ['s', 'steps'], ['esc', 'back']])
  return g
}
/** Option: extras on a sheet that rises over the key row, each on its key. */
function sheet(): Grid {
  const g = shades(BLUE)
  clear(g, 20, 25)
  for (const r of [21, 22, 23]) put(g, r, 4, [[' '.repeat(72), undefined, FIELD]])
  let at = 6
  for (const [name, k] of MORE) {
    put(g, 22, at, [[' ', undefined, CAP], [k, FG, CAP, true], [' ', undefined, CAP], [` ${name}`, FG, FIELD]])
    at += name.length + 6
  }
  put(g, 24, 4, [['─'.repeat(72), QUIET]])
  put(g, 25, 70, [['esc', FG], [' close', QUIET]])
  return g
}
/** Option: colour's home as two cards, Photo and Colour. */
function twoCards(): Grid {
  const g = frame('home')
  clear(g, 8, 23)
  for (let r = 9; r <= 15; r++) put(g, r, 4, [[' '.repeat(72), undefined, FIELD]])
  const card = (at: number, k: string, name: string, sub: string[], on: boolean, chips: string[]) => {
    const bg = on ? '#404040' : FIELD
    for (let r = 10; r <= 14; r++) put(g, r, at, [[' '.repeat(32), undefined, bg]])
    put(g, 10, at + 2, [[k, PINK, bg, true], [' '], [name, FG, bg, true]])
    sub.forEach((s, i) => put(g, 11 + i, at + 2, [[s, DIM, bg]]))
    chips.forEach((h, i) => put(g, 13, at + 2 + i * 2, [['  ', undefined, h]]))
  }
  card(6, 'A', 'Photo', ['colours in a photo'], true, ['#AC96EF', '#89B929', '#275F22', '#6678FF', '#B3E72E', '#F9716E', '#5A8E25'])
  card(41, 'S', 'Colour', ['shades and a palette'], false, scale(BLUE).map((s) => s.hex))
  put(g, 23, 68, [[' ', undefined, CAP], ['/', FG, CAP], [' ', undefined, CAP], [' menu', DIM]])
  keys(g, [['A S', 'open']], [['1–6', ''], ['←→', 'mode'], ['ctrl-c', 'quit']])
  return g
}

/** Colour's home today: three cards, untouched. */
const todayHome = (): Grid => frame('home')

/** Option: the same three cards, each subtitle saying what it gives. */
function plainCards(): Grid {
  const g = frame('home')
  const subs: Array<[number, string, string]> = [
    [9, 'the colours', 'in a photo'],
    [33, 'light to dark', 'of one colour'],
    [57, 'colours that', 'go together'],
  ]
  for (const [at, a, b] of subs) {
    put(g, 11, at, [[' '.repeat(18)]])
    put(g, 12, at, [[' '.repeat(18)]])
    put(g, 11, at, [[a, DIM]])
    put(g, 12, at, [[b, DIM]])
  }
  return g
}

/** Scale, typing a colour: the ramp drawn as it is typed, ↵ done at the field's end. */
function scaleTyping(ref: Rgb): Grid {
  const g = empty()
  bar(g, [], 'Scale')
  field(g, 3, fieldValue({ palette: P, value: hex(ref), swatch: true, typing: true }), true)
  const hint = chipHint('↵', 'done')
  put(g, 4, 74 - len(hint), hint)
  tabs(g, 7, ['Scale', 'Palette'], 0, false)
  ramp(g, 9, ref, 5)
  keys(
    g,
    [['↵', 'done']],
    [
      ['esc', 'cancel'],
      ['ctrl-c', 'quit'],
    ],
  )
  return g
}

/* ---------------------------------------------------------------- page */

const big = (g: Grid) => termHtml(P, g)

/** One step of a flow: the screen, and beside it what you do and what is new. */
const step = (n: number, title: string, g: Grid, press: string, said: string) =>
  `<div class="vs"><div class="vs-l">${big(g)}</div><div class="vs-r"><div class="vn">Step ${n}</div><h4>${title}</h4><p class="press">${press}</p><p>${said}</p></div></div>`
const down = '<div class="down">↓</div>'
const flow = (...steps: string[]) => `<div class="flow">${steps.join(down)}</div>`

const map = `
<div class="map">
  <div class="mcol">
    <div class="mbox"><b>Colour’s home</b><span>unchanged · three cards</span></div>
  </div>
  <div class="mcol arrows"><div>A →</div><div>S or D →</div></div>
  <div class="mcol">
    <div class="mbox"><b>Extract</b><span>a photo’s colours</span></div>
    <div class="mdown">→ open a colour ↓</div>
    <div class="mbox main"><b>A colour</b><span>two tabs: <i>Scale</i> · <i>Palette</i></span><span>S opens Scale, D opens Palette</span></div>
  </div>
  <div class="mcol arrows"><div>&nbsp;</div><div>m →</div></div>
  <div class="mcol">
    <div class="mbox"><b>More</b><span>Blend with a colour</span><span>See-through</span><span>Adjust</span><span>Steps</span></div>
  </div>
</div>`

const overview = `<div class="ov">
<h3>Three rules</h3>
<ol class="rules3">
<li><b>Home stays as it is.</b> Scale and Palette become two tabs of one colour screen; the card you press picks the tab.</li>
<li><b>One plain result first.</b> The extras (blend, see-through, adjust, steps) move into one list on <kbd>m</kbd>.</li>
<li><b>The same keys on every screen.</b></li>
</ol>
<h3>How the screens connect</h3>
${map}
<h3>The keys, everywhere</h3>
<div class="keys"><span><kbd>←→</kbd> <kbd>↑↓</kbd> choose</span><span><kbd>↵</kbd> copy the hex</span><span><kbd>c</kbd> copy for Figma</span><span><kbd>tab</kbd> Scale ↔ Palette</span><span><kbd>m</kbd> more</span><span><kbd>esc</kbd> back</span></div>
<h3>New words, for your OK</h3>
<p class="words">copy for Figma · copied for Figma · more · More · Blend with a colour · See-through · Adjust · Steps · white text · black text · % of the photo</p>
</div>`

const colourFlow = flow(
  step(1, 'Colour’s home', todayHome(), 'Press <kbd>S</kbd> Scale', 'Unchanged. <kbd>D</kbd> Palette opens the same screen on its Palette tab.'),
  step(2, 'Type a colour', scaleTyping(BLUE), 'Type <code>#6579FD</code>, then <kbd>↵</kbd>', 'The shades draw as you type.'),
  step(3, 'Its scale', shades(BLUE), '<kbd>←→</kbd> choose · <kbd>↵</kbd> copy the hex', 'The chosen colour big, with text on it and its codes. Neutral is now a row on the Palette tab; Alpha is See-through in More.'),
  step(4, 'Copy for Figma', shades(BLUE, { flash: 'copied for Figma' }), '<kbd>c</kbd>', 'Says where the copy goes.'),
  step(5, 'Its palette', paletteOf(BLUE), '<kbd>tab</kbd>', 'Every colour row shows at once. Yours is first.'),
  step(6, 'More', withMore(shades(BLUE)), '<kbd>m</kbd>', 'The extras, in one short list.'),
  step(7, 'Adjust', adjust(BLUE), 'Pick Adjust in More', 'The sliders sit at the bottom, so the colours stay in view.'),
)

const photoFlow = flow(
  step(1, 'Colour’s home', todayHome(), 'Press <kbd>A</kbd> Extract', 'Unchanged.'),
  step(2, 'Drop a photo', frame('extract-empty'), 'Drop it, or type its path', 'Unchanged.'),
  step(3, 'Its colours', photo(), '<kbd>↑↓</kbd> choose · <kbd>↵</kbd> copy the hex', 'The long note under the photo is gone. All keys are in the bottom row.'),
  step(4, 'Open one', shades(PURPLE, { trail: ['Extract'] }), '<kbd>→</kbd>', 'The same colour screen as in the other flow.'),
  step(5, 'Its palette', paletteOf(PURPLE, { trail: ['Extract'] }), '<kbd>tab</kbd>', 'From a photo to a full palette, without typing the colour again.'),
)

const CSS = `<style>
.concept .side { position:sticky; top:24px; }
.vs{display:flex;gap:26px;align-items:center}
.vs-r{width:300px}
.vs-r h4{margin:2px 0 8px;font-size:19px}
.vn{font:700 12px ui-monospace,Menlo,monospace;color:#e5a23c;letter-spacing:.06em;text-transform:uppercase}
.vs-r p{margin:6px 0;font-size:15px;color:#c7cbd4}
.vs-r .press{color:#e2e4ea}
.down{font-size:26px;color:#4a4f5a;margin:6px 0 6px 320px}
kbd{font:600 13px ui-monospace,Menlo,monospace;background:#333;color:#e7e7e7;border-radius:4px;padding:1px 6px}
.ov{max-width:1000px}
.ov h3{font-size:16px;margin:26px 0 10px;color:#e2e4ea}
.ov h3:first-child{margin-top:0}
.rules3{margin:0;padding-left:22px;font-size:16px;line-height:1.7}
.map{display:flex;align-items:center;gap:14px}
.mcol{display:flex;flex-direction:column;gap:8px;align-items:stretch}
.mcol.arrows{color:#8f94a1;font:600 14px ui-monospace,Menlo,monospace;gap:70px}
.mbox{border:1px solid #3a3d46;border-radius:10px;padding:10px 14px;background:#16181d;display:flex;flex-direction:column;font-size:14px;color:#a9aebb;min-width:170px}
.mbox b{color:#e2e4ea;font-size:15px;margin-bottom:2px}
.mbox.main{border-color:#e5a23c}
.mdown{font:13px ui-monospace,Menlo,monospace;color:#8f94a1;text-align:center}
.keys{display:flex;flex-wrap:wrap;gap:10px 22px;font-size:15px}
.words{color:#c7cbd4;font-size:15px;line-height:1.7;margin:0}
h2{margin-top:40px !important}
.pk{font:700 11px ui-monospace,Menlo,monospace;letter-spacing:.06em;text-transform:uppercase;padding:3px 8px;border-radius:6px;background:#2a2112;color:#f3d39d;border:1px solid #6e5a26;vertical-align:middle;margin-left:10px}
</style>`

const concepts: PageConcept[] = [
  {
    id: 'F1',
    name: 'I have a colour',
    idea: 'Seven steps, top to bottom.',
    html: colourFlow,
    section: 'Flow 1 · I have a colour',
  },
  {
    id: 'F2',
    name: 'I have a photo',
    idea: 'Five steps. Steps 1 and 2 are today’s screens.',
    html: photoFlow,
    section: 'Flow 2 · I have a photo',
  },
]

writeFileSync(
  'mockups/colour-redesign-2026-10-round3.html',
  feedbackPage({
    page: 'colour-redesign-2026-10-round3',
    title: 'Forge · colour mode, simpler · round 3',
    heading: 'Colour mode, simpler',
    lede: 'One scroll: the idea, then two flows. Rate each flow with the buttons beside it.',
    before: `${CSS}<h2>The idea</h2>${overview}`,
    concepts,
  }),
)
console.log('wrote mockups/colour-redesign-2026-10-round3.html')
