/**
 * Colour mode, simpler (2026-10-23): the audit's fixes drawn as two flows
 * (I have a colour · I have a photo) and three open questions, each with its
 * options. Screens are drawn with the app's own art (bar, drop zone, field,
 * ramp, grid, slider) on cells captured from dev
 * (scripts/colour-redesign-frames.json, from scripts/colour-audit-capture.tsx).
 *
 *   npx tsx scripts/colour-redesign-mockup.ts → mockups/colour-redesign-2026-10.html
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
    tabs(g, 7, ['Shades', 'Palette'], 0)
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
  tabs(g, 7, ['Shades', 'Palette'], 1)
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
  tabs(g, 7, ['Shades', 'Palette'], 0, false)
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
  bar(g, [], 'sonoma.jpg')
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
  tabs(g, 7, ['Shades', 'Palette', 'Blend', 'See-through'], 0)
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

/* ---------------------------------------------------------------- page */

const big = (g: Grid) => termHtml(P, g)
const small = (g: Grid) => big(g).replace('class="t"', 'class="t sm"')

const step = (n: string, title: string, g: Grid, keysCap: string) =>
  `<figure class="st"><figcaption><span class="n">${n}</span>${title}</figcaption>${small(g)}<div class="k">${keysCap}</div></figure>`
const lane = (...cards: string[]) => `<div class="row">${cards.join('<span class="ar">→</span>')}</div>`
const option = (id: string, title: string, g: Grid, note: string, rec = false) =>
  `<figure class="op${rec ? ' rec' : ''}"><figcaption><span class="oid">${id}</span>${title}${rec ? '<span class="pick">my pick</span>' : ''}</figcaption>${small(g)}<p>${note}</p></figure>`

const story = `
<div class="rules">
<div><b>1</b> Two ways in: drop a photo, or type a colour.</div>
<div><b>2</b> A colour opens on its <i>Shades</i>. <code>tab</code> shows its <i>Palette</i>.</div>
<div><b>3</b> The same keys on every screen. Extras live in one list: <code>m</code> more.</div>
</div>

<div class="sec"><h2><span class="sn">1</span>Flow — I have a colour</h2>
${lane(
  step('1', 'Colour’s home', home(), 'looks like every other mode'),
  step('2', 'Type a colour', home('#6579FD'), 'type · ↵ open'),
  step('3', 'Its shades', shades(BLUE), '←→ choose · ↵ copy hex'),
)}
${lane(
  step('4', 'Copy for Figma', shades(BLUE, { flash: 'copied for Figma' }), 'c'),
  step('5', 'Its palette', paletteOf(BLUE), 'tab · every row shows'),
  step('6', 'More', withMore(shades(BLUE)), 'm'),
)}
${lane(step('7', 'Adjust', adjust(BLUE), 'from More · the colours stay in view'))}
</div>

<div class="sec"><h2><span class="sn">2</span>Flow — I have a photo</h2>
<p class="lead2">Drop a photo on colour’s home (step 1 above).</p>
${lane(
  step('2', 'Its colours', photo(), '↑↓ choose · ↵ copy hex'),
  step('3', 'Open one', shades(PURPLE, { trail: ['sonoma.jpg'] }), '→ · the same Shades screen'),
  step('4', 'Its palette', paletteOf(PURPLE, { trail: ['sonoma.jpg'] }), 'tab'),
)}
</div>

<div class="sec"><h2><span class="sn">3</span>Questions — pick one option for each</h2>
<h3 class="q">A · How much goes under the shades?</h3>
<div class="opts">
${option('A1', 'One line', shades(BLUE, { how: 'line' }), 'Only the step and its hex. Quietest.')}
${option('A2', 'The colour, big', shades(BLUE), 'The chosen colour large, with white and black text on it, and its codes.', true)}
${option('A3', 'Palette under it', shades(BLUE, { how: 'palette', tabbed: false }), 'No tabs: your shades on top, the other colours as thin rows below.')}
</div>
<h3 class="q">B · Where do the extras live?</h3>
<div class="opts">
${option('B1', 'A list on m', withMore(shades(BLUE)), 'Hidden until you ask. One key, one short list.', true)}
${option('B2', 'More tabs', tabsForAll(), 'Blend and See-through are tabs; Adjust and Steps are keys.')}
${option('B3', 'A sheet over the keys', sheet(), 'Each extra on its own key, shown in a strip.')}
</div>
<h3 class="q">C · Colour’s home</h3>
<div class="opts">
${option('C1', 'Drop zone + field', home(), 'The same as every other mode.', true)}
${option('C2', 'Two cards', twoCards(), 'Photo or Colour, picked with A or S.')}
</div>
</div>

<div class="sec"><h2><span class="sn">4</span>Words to approve</h2>
<p class="words">Drop a photo here · OR type a colour · open · Shades · Palette · copy for Figma · copied for Figma · more · More · Blend with a colour · See-through · Adjust · Steps · white text · black text · % of the photo</p>
<p class="words dim">Kept, not shown here: make centre, the grey’s tint, palette style and “go deeper” go into More on the screen they belong to.</p>
</div>

<h2 class="vh">Your verdicts</h2>
<style>
.rules{display:grid;gap:6px;margin:22px 0 0;font-size:17px}
.rules b{display:inline-flex;width:24px;height:24px;border-radius:12px;background:#e5a23c;color:#0c1d22;align-items:center;justify-content:center;font-size:13px;margin-right:8px}
.sec{margin:40px 0 0;padding:26px 0 0;border-top:1px solid #23252c}
.sec h2{display:flex;align-items:center;gap:12px;margin:0 0 16px;font-size:22px;padding-top:0;border-top:0}
.sec .sn{display:inline-flex;width:30px;height:30px;border-radius:15px;background:#e5a23c;color:#0c1d22;align-items:center;justify-content:center;font-size:15px;font-weight:700}
.t.sm{font-size:9px;padding:8px 9px}
.t.sm .r{height:11px}
.t.sm .r > span{height:11px;line-height:11px}
.row{display:flex;align-items:flex-start;gap:12px;overflow-x:auto;padding-bottom:6px;margin:0 0 18px}
.ar{align-self:center;font-size:22px;color:#4a4f5a}
.st{margin:0;display:flex;flex-direction:column;gap:6px;flex:none}
.st figcaption{font:600 14px -apple-system,sans-serif;color:#e2e4ea;display:flex;align-items:center;gap:8px}
.st .n{display:inline-flex;width:22px;height:22px;border-radius:11px;background:#2a2d35;align-items:center;justify-content:center;font-size:12px}
.st .k{font:12.5px ui-monospace,Menlo,monospace;color:#8f94a1}
.lead2{color:#a9aebb;margin:0 0 12px;font-size:15px}
.q{font-size:17px;margin:26px 0 10px}
.opts{display:flex;gap:16px;flex-wrap:wrap}
.op{margin:0;flex:none;max-width:520px}
.op figcaption{font:600 15px -apple-system,sans-serif;display:flex;align-items:center;gap:8px;margin:0 0 6px}
.op .oid{font:700 12px ui-monospace,monospace;padding:2px 7px;border-radius:5px;background:#12282e;color:#55c7d9}
.op .pick{font:700 11px ui-monospace,monospace;letter-spacing:.05em;text-transform:uppercase;padding:2px 7px;border-radius:5px;background:#2a2112;color:#f3d39d;border:1px solid #6e5a26}
.op p{font-size:14px;color:#a9aebb;margin:6px 0 0}
.words{color:#c7cbd4;font-size:15px;line-height:1.7;margin:0}
.words.dim{color:#8f94a1;margin-top:8px}
.vh{margin:56px 0 0;padding-top:26px;border-top:1px solid #23252c}
</style>`

const concepts: PageConcept[] = [
  { id: 'F1', name: 'Flow — I have a colour', idea: 'Home → type → Shades → copy for Figma → Palette → More → Adjust.', html: small(shades(BLUE)) },
  { id: 'F2', name: 'Flow — I have a photo', idea: 'Drop → its colours → open one → its palette.', html: small(photo()) },
  { id: 'A1', name: 'Under the shades: one line', idea: 'Step and hex only.', html: small(shades(BLUE, { how: 'line' })) },
  { id: 'A2', name: 'Under the shades: the colour, big', idea: 'Large colour, text on it, its codes.', html: small(shades(BLUE)) },
  { id: 'A3', name: 'Under the shades: palette under it', idea: 'No tabs; other colours as thin rows.', html: small(shades(BLUE, { how: 'palette', tabbed: false })) },
  { id: 'B1', name: 'Extras: a list on m', idea: 'Hidden until asked.', html: small(withMore(shades(BLUE))) },
  { id: 'B2', name: 'Extras: more tabs', idea: 'Always in view.', html: small(tabsForAll()) },
  { id: 'B3', name: 'Extras: a sheet over the keys', idea: 'Each on its key.', html: small(sheet()) },
  { id: 'C1', name: 'Home: drop zone + field', idea: 'Like every mode.', html: small(home()) },
  { id: 'C2', name: 'Home: two cards', idea: 'Photo or Colour.', html: small(twoCards()) },
]

writeFileSync(
  'mockups/colour-redesign-2026-10.html',
  feedbackPage({
    page: 'colour-redesign-2026-10',
    title: 'Forge · colour mode, simpler',
    heading: 'Colour mode, simpler',
    lede: 'The audit’s fixes, drawn. Two flows, then three questions with options. Rate them at the bottom.',
    before: story,
    concepts,
    compact: true,
  }),
)
console.log('wrote mockups/colour-redesign-2026-10.html')
if (process.env.DUMP) {
  for (const [n, g] of Object.entries({ home: home(), typed: home('#6579FD'), shades: shades(BLUE), pal: paletteOf(BLUE), more: withMore(shades(BLUE)), adjust: adjust(BLUE), photo: photo(), purple: shades(PURPLE, { trail: ['sonoma.jpg'] }), a3: shades(BLUE, { how: 'palette', tabbed: false }), b2: tabsForAll(), b3: sheet(), c2: twoCards() }))
    console.log(`== ${n}\n${g.map((r) => r.map((c) => c.ch).join('')).join('\n')}`)
}
if (process.env.SHOTS) {
  const screens: Record<string, Grid> = {
    home: home(),
    typed: home('#6579FD'),
    shades: shades(BLUE),
    copied: shades(BLUE, { flash: 'copied for Figma' }),
    palette: paletteOf(BLUE),
    more: withMore(shades(BLUE)),
    adjust: adjust(BLUE),
    photo: photo(),
    photoShades: shades(PURPLE, { trail: ['sonoma.jpg'] }),
    photoPalette: paletteOf(PURPLE, { trail: ['sonoma.jpg'] }),
    a1: shades(BLUE, { how: 'line' }),
    a3: shades(BLUE, { how: 'palette', tabbed: false }),
    b2: tabsForAll(),
    b3: sheet(),
    c2: twoCards(),
  }
  writeFileSync(
    '/tmp/colour-audit/redesign-grids.json',
    JSON.stringify(Object.fromEntries(Object.entries(screens).map(([k, g]) => [k, termHtml(P, g)]))),
  )
}
