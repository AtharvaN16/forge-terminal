/**
 * Round 6 (2026-10-24): the user asked for the two-tone (G5) darker:
 * the same picker, four darker pairs first (each two greys the app already
 * uses), then every round-5 look, kept.
 *
 * Round 5 (2026-10-24): the user chose a grey More; this is a live picker
 * of grey looks, all made of greys the app already uses (key cap #333,
 * card #404040, field #2c2c2c, border #808080). One screen, one row of
 * chips; a click repaints it and saves the pick.
 *
 * Round 4 (2026-10-24): no ↵ done in the field while typing (the key row
 * says it); # new colour as plain text, no chip; the tab row's hint is the
 * tab cap alone; More tinted (the mode's tint behind its pink words, as
 * Done's Home rests).
 *
 * Round 3 (2026-10-24): esc back in the key row; # new colour as the
 * field's own hint at its far end; More drawn as home's ↵ enter pill (the
 * one a staged file's field shows), over the rule at the right.
 *
 * The More button and the copy message, round 2 (2026-10-24). The user
 * disliked all six looks of round 1 and asked which button types the app
 * already has. This page shows them (real cells from dev), then the More
 * button drawn only as types the app already uses, then the copy message in
 * the key row (C3, liked), said once or twice.
 *
 *   npx tsx scripts/colour-more-copy-mockup-r6.ts → mockups/colour-more-copy-2026-10-round6.html
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { onWhiteAndBlack } from '../src/core/colour/contrast.js'
import { DEFAULT_STEPS, scale, stepsOf } from '../src/core/colour/scale.js'
import {
  formatOklch,
  formatRgb,
  oklabToRgb,
  parseHex,
  type Rgb,
  rgbToOklab,
} from '../src/core/colour/space.js'
import { NO_TWEAK, system, type Tweak, tweakSteps } from '../src/core/colour/system.js'
import { trailBarRow } from '../src/shell/bar-art.js'
import { fieldRows, fieldValue, previewRows, rampRows } from '../src/shell/colour/colour-art.js'
import { chosenRow, tweakLines, windowOver } from '../src/shell/colour/system-art.js'
import { type Row, surfaceRows } from '../src/shell/home-art.js'
import { sliderRow } from '../src/shell/quality-art.js'
import { DARK, modePalette } from '../src/shell/theme.js'
import { feedbackPage, type PageConcept } from './feedback-page.js'
import { type Cell, type Grid, gridHtml, TERM_CSS, termHtml } from './term-cells.js'

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
    trailBarRow({
      width: 76,
      palette: P,
      mode: 'colour',
      trail: { answers, current },
      slanted: false,
    }),
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
  if (hint)
    put(g, r, 64, [
      [' ', undefined, CAP],
      ['tab', FG, CAP, true],
      [' ', undefined, CAP],
      [' switch', DIM],
    ])
}

/* --------------------------------------------------------------- data */

const BLUE = parseHex('#6579FD') as Rgb
const PURPLE = parseHex('#AC96EF') as Rgb
const stepsFor = (ref: Rgb, t: Tweak = NO_TWEAK) =>
  t === NO_TWEAK ? scale(ref) : tweakSteps((r) => scale(r), ref, t, 5)
const hex = (rgb: Rgb) =>
  `#${[rgb.r, rgb.g, rgb.b]
    .map((v) => v.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase()}`

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

const AMBER = parseHex('#F5A524') as Rgb
const TEAL = parseHex('#2EC4B6') as Rgb
const TABS = ['Colour', 'Neutral', 'Alpha', 'Palette']
const BUTTON = '#404040'
const POP = '#2c2c2c'
const POP_ON = '#404040'

/** The More button: a filled pill, its key in the mode's pink; lighter while its menu is open. */
function moreButton(g: Grid, r: number, open = false) {
  const bg = open ? '#4f4f4f' : BUTTON
  put(g, r, 65, [
    [' ', undefined, bg],
    ['m', PINK, bg, true],
    ['  More ▾ ', FG, bg, true],
  ])
}

/**
 * Today's Scale screen (a captured tab) with this round's changes: the
 * gradient hint gone from the field, Palette as a fourth tab, and the More
 * button where t tweak · s steps were.
 */
function scaleTab(k: 'scale' | 'scale-neutral' | 'scale-alpha', open = false): Grid {
  const g = frame(k)
  put(g, 4, 40, [[' '.repeat(36), undefined, FIELD]])
  put(g, 7, 36, [['Palette', DIM]])
  clear(g, 14, 14, 50, 76)
  moreButton(g, 14, open)
  return g
}

/** A pop-up: a rounded frame in the border grey, its title in the top edge, filled. */
function popup(g: Grid, top: number, width: number, title: string, lines: Seg[][], pad = true) {
  const left = 76 - width
  const inner = width - 2
  put(g, top, left, [
    ['╭─ ', QUIET],
    [title, FG, undefined, true],
    [` ${'─'.repeat(inner - title.length - 3)}╮`, QUIET],
  ])
  const body = (pad ? [[], ...lines, []] : lines) as Seg[][]
  body.forEach((segs, i) => {
    put(g, top + 1 + i, left, [
      ['│', QUIET],
      [' '.repeat(inner), undefined, POP],
      ['│', QUIET],
    ])
    put(
      g,
      top + 1 + i,
      left + 1,
      segs.map(([t, fg, bg, b]) => [t, fg, bg ?? POP, b] as Seg),
    )
  })
  put(g, top + 1 + body.length, left, [[`╰${'─'.repeat(inner)}╯`, QUIET]])
}

/** Rows of the grid as an art row, `from` column on, `n` cells wide. */
function asRow(g: Grid, r: number, from = 2, n = 76): Row {
  return (g[r] as Cell[])
    .slice(from, from + n)
    .map((c) => ({ text: c.ch, fg: c.fg, bg: c.bg, bold: !!c.b }))
}
const WIN = 56
/**
 * A window as Mode and Tweak open today (W1): centred, framed, over the
 * screen under the field, which fades behind it.
 */
function windowed(g: Grid, title: string, lines: Row[]) {
  const first = 6
  const last = 23
  const under = Array.from({ length: last - first + 1 }, (_, i) => asRow(g, first + i))
  const top = Math.max(0, Math.floor((under.length - lines.length - 2) / 2))
  const out = windowOver(P, under, { title, lines, width: WIN, columns: 76, top })
  out.slice(0, under.length).forEach((r, i) => {
    clear(g, first + i, first + i, 2, 78)
    row(g, first + i, r)
  })
}
/** A list row in a window, as the Mode list draws its rows: › and the band on the one in hand. */
function listLine(name: string, key: string, on: boolean): Row {
  const band = on ? P.panelBand || undefined : undefined
  const inner = WIN - 2
  const text = `${name}`.padEnd(inner - 3 - key.length - 3)
  return [
    { text: on ? ' › ' : '   ', fg: P.accent, bold: true, bg: band },
    { text, fg: on ? P.fg : P.dim, bold: on, bg: band },
    { text: key, fg: QUIET, bg: band },
    { text: '   ', bg: band },
  ]
}

/** More, open: a pop-up dropping from the button; the scale above stays in view. */
const COLOUR_MORE: Array<[string, string]> = [
  ['Gradient', '⇧→'],
  ['Tweak', 't'],
  ['Steps', 's'],
]
function moreOpen(): Grid {
  const g = scaleTab('scale', true)
  windowed(g, 'More', [[], ...COLOUR_MORE.map(([name, k], i) => listLine(name, k, i === 0)), []])
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

/** Tweak, from More: today's sliders in a pop-up under the scale, which changes above it. */
function tweakOpen(): Grid {
  const t: Tweak = { brightness: 12, saturation: -20, hue: 0, contrast: 0 }
  const g = scaleTab('scale', true)
  const steps = tweakSteps((r) => scale(r), BLUE, t, 5)
  clear(g, 9, 13)
  rows(g, 9, rampRows({ width: 76, palette: P, steps, selected: 5 }))
  const lines = tweakLines(
    P,
    (['brightness', 'saturation', 'hue', 'contrast'] as const).map((k) => ({
      label: k,
      value: t[k],
      max: k === 'hue' ? 180 : 100,
      unit: k === 'hue' ? '°' : '',
    })),
    1,
    steps.map((x) => x.hex),
  )
  windowed(g, 'Tweak', lines)
  keys(
    g,
    [
      ['↑↓', 'choose'],
      ['←→', '1'],
      ['⇧←→', '10'],
      ['↵', 'done'],
    ],
    [
      ['r', 'reset'],
      ['esc', 'cancel'],
    ],
  )
  return g
}

/** Any number of colours, evenly across, in OKLab. */
function gradient(stops: Rgb[], n: number): Array<{ step: number; hex: string; rgb: Rgb }> {
  const labs = stops.map(rgbToOklab)
  return Array.from({ length: n }, (_, i) => {
    const at = i / (n - 1)
    const x = at * (labs.length - 1)
    const k = Math.min(labs.length - 2, Math.floor(x))
    const u = x - k
    const a = labs[k] as ReturnType<typeof rgbToOklab>
    const b = labs[k + 1] as ReturnType<typeof rgbToOklab>
    const rgb = oklabToRgb({
      L: a.L + (b.L - a.L) * u,
      a: a.a + (b.a - a.a) * u,
      b: a.b + (b.b - a.b) * u,
    })
    return { step: Math.round(at * 100), hex: hex(rgb), rgb }
  })
}

/** Gradient, from More: a pop-up listing its colours, a field for the next, the gradient under them. */
function gradientOpen(): Grid {
  const g = scaleTab('scale', true)
  const inner = WIN - 2
  const strip = gradient([BLUE, AMBER, TEAL], inner - 6)
  const stop = (n: number, c: Rgb): Row => [
    { text: `   ${n}   `, fg: QUIET },
    { text: '    ', bg: hex(c) },
    { text: '  ' },
    { text: hex(c), fg: P.dim },
  ]
  const shelf = SHELF
  const typing: Row = [
    { text: '   3  ', fg: QUIET },
    { text: ' ', bg: shelf },
    { text: '›', fg: PINK, bold: true, bg: shelf },
    { text: ' ', bg: shelf },
    { text: '#2EC4B6', fg: FG, bg: shelf },
    { text: '  ', bg: shelf },
    { text: '    ', bg: '#2EC4B6' },
    { text: ' '.repeat(inner - 6 - 26), bg: shelf },
  ]
  windowed(g, 'Gradient', [
    [],
    stop(1, BLUE),
    stop(2, AMBER),
    typing,
    [],
    [{ text: '   ' }, ...strip.map((x) => ({ text: ' ', bg: x.hex }))],
    [],
  ])
  keys(
    g,
    [
      ['↵', 'add'],
      ['↑↓', 'choose'],
    ],
    [
      ['⌫', 'remove'],
      ['tab', 'done'],
      ['esc', 'cancel'],
    ],
  )
  return g
}

/** The gradient: today's Mix screen, with every colour that was added. */
function gradientScreen(): Grid {
  const g = frame('mix')
  bar(g, ['#6579FD'], 'Gradient')
  clear(g, 3, 5)
  const sw = (c: Rgb): Seg[] => [
    [hex(c), DIM, FIELD],
    ['  ', undefined, FIELD],
    ['    ', undefined, hex(c)],
  ]
  field(g, 3, [])
  put(g, 4, 7, [
    ...sw(BLUE),
    ['   →   ', QUIET, FIELD],
    ...sw(AMBER),
    ['   →   ', QUIET, FIELD],
    ...sw(TEAL),
  ])
  const steps = gradient([BLUE, AMBER, TEAL], 9)
  clear(g, 7, 11)
  rows(g, 7, rampRows({ width: 76, palette: P, steps, selected: 4 }))
  clear(g, 12, 12, 60, 76)
  moreButton(g, 12)
  clear(g, 14, 18)
  const at = steps[4] as (typeof steps)[number]
  const prev = previewRows({
    palette: P,
    step: { step: at.step, hex: at.hex, oklch: formatOklch(at.rgb), ...onWhiteAndBlack(at.rgb) },
  })
  const first = prev[0]
  const i = first?.findIndex((r) => r.text === String(at.step) && r.bold) ?? -1
  if (first && i >= 0) first[i] = { ...(first[i] as Row[number]), text: `${at.step}%` }
  rows(g, 14, prev)
  return g
}

/** The Palette tab: every row on one line, so all nine show; Full set and the More button under them. */
function paletteTab(ref: Rgb): Grid {
  const g = empty()
  bar(g, [], 'Scale')
  field(g, 3, fieldValue({ palette: P, value: hex(ref), swatch: true }))
  tabs(g, 7, TABS, 3)
  const sys = system(ref, 'full', NO_TWEAK, DEFAULT_STEPS)
  const yours = sys.rows.find((r) => r.yours)
  const ordered = [
    ...(yours ? [yours] : []),
    ...sys.rows.filter((r) => !r.yours),
    { name: 'neutral', steps: sys.neutral, yours: false },
  ]
  put(
    g,
    9,
    14,
    stepsOf(DEFAULT_STEPS).map(
      (n, c) =>
        [
          (n < 100 ? ` ${n}` : String(n)).padEnd(5),
          c === 5 ? FG : QUIET,
          undefined,
          c === 5,
        ] as Seg,
    ),
  )
  ordered.forEach((r, i) => {
    put(g, 10 + i, 4, [[r.name, i === 0 ? PINK : DIM, undefined, i === 0]])
    r.steps.forEach((st, c) => put(g, 10 + i, 14 + c * 5, [['    ', undefined, st.hex]]))
  })
  for (const [c, ch] of [
    [38, '▕'],
    [43, '▏'],
  ] as const)
    put(g, 10, c, [[ch, FG]])
  const chosen = ordered[0]?.steps[5]
  if (chosen)
    row(g, 20, chosenRow(P, ordered[0]?.name ?? '', '500', chosen.hex, formatOklch(chosen.rgb)))
  put(g, 22, 4, [['Full set', FG, undefined, true]])
  moreButton(g, 22)
  keys(
    g,
    [
      ['↑↓←→', 'choose'],
      ['↵', 'copy'],
      ['c', 'copy all'],
    ],
    [
      ['#', 'new colour'],
      ['esc', 'back'],
    ],
  )
  return g
}

/* ------------------------------------------------------------- looks */

type Look = 'pill' | 'chip' | 'outline' | 'block' | 'dots' | 'tab'

/** The Colour tab, today's, with round 5's changes and the More button drawn as `look`. */
function colourTab(look: Look): Grid {
  const g = frame('scale')
  put(g, 4, 40, [[' '.repeat(36), undefined, FIELD]])
  put(g, 7, 36, [['Palette', DIM]])
  clear(g, 14, 14, 50, 76)
  if (look === 'pill') moreButton(g, 14)
  if (look === 'chip')
    put(g, 14, 67, [
      [' m ', CANVAS, QUIET, true],
      [' More', QUIET],
    ])
  if (look === 'dots')
    put(g, 14, 70, [
      [' ', undefined, BUTTON],
      ['m', PINK, BUTTON, true],
      [' ⋯ ', FG, BUTTON, true],
    ])
  if (look === 'outline') {
    clear(g, 13, 15, 60, 76)
    put(g, 13, 62, [['╭────────────╮', QUIET]])
    put(g, 14, 62, [
      ['│', QUIET],
      [' m', PINK, undefined, true],
      ['  More ▾  ', FG, undefined, true],
      ['│', QUIET],
    ])
    put(g, 15, 62, [['╰────────────╯', QUIET]])
  }
  if (look === 'block') {
    for (const r of [16, 17, 18]) put(g, r, 62, [[' '.repeat(14), undefined, FIELD]])
    put(g, 17, 64, [
      [' m ', FG, CAP, true],
      ['  More', FG, FIELD, true],
    ])
  }
  if (look === 'tab') {
    clear(g, 7, 7, 46, 64)
    put(g, 7, 50, [
      ['m', PINK, undefined, true],
      [' More ▾', FG, undefined, true],
    ])
  }
  return g
}

/* --------------------------------------------------------------- copy */

type Place = 'line' | 'toast' | 'keys'
interface Words {
  hex: [string, string]
  all: [string, string]
}
const WORDS: Words[] = [
  {
    hex: ['copied #6579FD', 'paste it into code or a colour field'],
    all: ['copied 11 swatches', 'paste into Figma with ⌘V'],
  },
  {
    hex: ['copied #6579FD', 'paste it into code or a colour field'],
    all: ['copied 11 swatches', 'paste into Figma with ⌘V, or into code as SVG'],
  },
  { hex: ['copied #6579FD', ''], all: ['copied 11 swatches', 'paste into Figma with ⌘V'] },
]

/** The Colour tab a moment after a copy: what was copied, and what it is for, at `place`. */
function copied(place: Place, [what, how]: [string, string]): Grid {
  const g = colourTab('pill')
  if (place === 'line') {
    put(g, 22, 6, [
      ['✓', P.ok, undefined, true],
      [` ${what}`, FG],
      ...(how ? ([[` · ${how}`, DIM]] as Seg[]) : []),
    ])
  }
  if (place === 'toast') {
    const text = Math.max(what.length + 2, how.length)
    const w = text + 6
    const left = 76 - w
    for (let r = 2; r <= 5; r++) put(g, r, left, [[' '.repeat(w), undefined, '#3a3a3a']])
    put(g, 3, left + 2, [
      ['✓', P.ok, '#3a3a3a', true],
      [` ${what}`, FG, '#3a3a3a', true],
    ])
    if (how) put(g, 4, left + 4, [[how, DIM, '#3a3a3a']])
  }
  if (place === 'keys') {
    clear(g, 25, 25)
    put(g, 25, 4, [
      ['✓', P.ok, undefined, true],
      [` ${what}`, FG],
      ...(how ? ([[` · ${how}`, DIM]] as Seg[]) : []),
    ])
  }
  return g
}

/* ------------------------------------------------- the More button, r2 */

type Look2 = 'menu' | 'pill'
/** The Colour tab with More drawn as a button type the app already has. */
function colourTab2(look: Look2): Grid {
  const g = colourTab('chip')
  clear(g, 14, 14, 60, 76)
  if (look === 'menu') {
    // As home's "/ menu": the key on a grey cap, the word after it, over the rule at the right.
    put(g, 23, 68, [
      [' ', undefined, CAP],
      ['m', FG, CAP],
      [' ', undefined, CAP],
      [' more', DIM],
    ])
  }
  if (look === 'pill') {
    // As /update's "↵ check again": a white pill, its words dark, at the right of its line.
    put(g, 14, 66, [
      [' m ', '#0c1d22', '#e7e7e7', true],
      ['More ', '#0c1d22', '#e7e7e7', true],
    ])
  }
  return g
}

/** The Colour tab a moment after a copy, the message in place of the key row. */
function copiedKeys(what: string, how: string): Grid {
  const g = colourTab2('menu')
  clear(g, 25, 25)
  put(g, 25, 4, [
    ['✓', P.ok, undefined, true],
    [` ${what}`, FG],
    ...(how ? ([[` · ${how}`, DIM]] as Seg[]) : []),
  ])
  return g
}

const INK = '#0c1d22'
const CARD = '#404040'
const pill = (bg: string, key: string, word: string, extra = ''): Seg[] => [
  [' ', undefined, bg],
  ['m', key, bg, true],
  [' ', undefined, bg],
  [`more${extra}`, word, bg, key === word],
  [' ', undefined, bg],
]
/** The grey looks: id → [label, what it borrows, cells]. */
const GREYS: Record<string, [string, string, Seg[]]> = {
  p1: [
    'G2 with m in pink',
    'your pick: home’s “/ menu” look, the key in colour mode’s pink',
    [
      [' ', undefined, CAP],
      ['m', PINK, CAP, true],
      [' ', undefined, CAP],
      [' more', DIM],
    ],
  ],
  d1: [
    'Darker',
    'key #4d4d4d · word #333333',
    [
      [' ', undefined, '#4d4d4d'],
      ['m', FG, '#4d4d4d', true],
      [' ', undefined, '#4d4d4d'],
      [' more ', FG, '#333333', true],
    ],
  ],
  d2: [
    'Darker still',
    'key #404040 · word #2c2c2c',
    [
      [' ', undefined, '#404040'],
      ['m', FG, '#404040', true],
      [' ', undefined, '#404040'],
      [' more ', FG, '#2c2c2c', true],
    ],
  ],
  d3: [
    'More contrast between the two',
    'key #4d4d4d · word #2c2c2c',
    [
      [' ', undefined, '#4d4d4d'],
      ['m', FG, '#4d4d4d', true],
      [' ', undefined, '#4d4d4d'],
      [' more ', FG, '#2c2c2c', true],
    ],
  ],
  d4: [
    'Darkest',
    'key #333333 · word #242424',
    [
      [' ', undefined, '#333333'],
      ['m', FG, '#333333', true],
      [' ', undefined, '#333333'],
      [' more ', FG, '#242424', true],
    ],
  ],
  g1: ['Mid grey, dark words', 'round 4’s grey; the in-field chip’s grey', pill(QUIET, INK, INK)],
  g2: [
    'Like “/ menu”',
    'a key cap, the word beside it on the canvas',
    [
      [' ', undefined, CAP],
      ['m', FG, CAP, true],
      [' ', undefined, CAP],
      [' more', DIM],
    ],
  ],
  g3: ['Key-cap grey, all in', 'the whole pill in the key caps’ grey', pill(CAP, FG, DIM)],
  g4: ['Card grey, light words', 'the grey of a chosen card on colour’s home', pill(CARD, FG, FG)],
  g5: [
    'Two-tone',
    'the key on mid grey, the word on card grey',
    [
      [' ', undefined, QUIET],
      ['m', INK, QUIET, true],
      [' ', undefined, QUIET],
      [' more ', FG, CARD, true],
    ],
  ],
  g6: ['Mid grey with ▾', 'g1, saying it opens a list', pill(QUIET, INK, INK, ' ▾')],
  g7: ['Field grey, quiet', 'the field’s grey; the quietest', pill(FIELD, FG, DIM)],
}
const TINT = '#3a1e2b'
type MoreLook = string

/** The Colour tab, round 4. */
function colourTab4({ more = 'p1' as MoreLook, typing = false } = {}): Grid {
  const g = colourTab('chip')
  clear(g, 14, 14, 60, 76)
  // The tab row's hint: the cap alone.
  clear(g, 7, 7, 60, 76)
  put(g, 7, 71, [
    [' ', undefined, CAP],
    ['tab', FG, CAP, true],
    [' ', undefined, CAP],
  ])
  if (typing) {
    // While typing, the field's end is empty: the key row says ↵ done.
    put(g, 4, 5, [
      ['›', PINK, FIELD, true],
      [' '],
      ['#6579FD', FG, FIELD],
      ['  '],
      ['    ', undefined, '#6579FD'],
    ])
  } else {
    // # new colour as plain text at the field's far end, as the key row's foot is written.
    const hint: Seg[] = [
      ['#', FG, FIELD],
      [' new colour', QUIET, FIELD],
    ]
    put(g, 4, 74 - len(hint), hint)
  }
  if (!typing) {
    const segs = GREYS[more]?.[2] ?? []
    put(g, 23, 76 - len(segs), segs)
  }
  keys(
    g,
    typing
      ? [['↵', 'done']]
      : [
          ['←→', 'choose'],
          ['↵', 'copy'],
          ['c', 'copy all'],
        ],
    typing
      ? [
          ['esc', 'cancel'],
          ['ctrl-c', 'quit'],
        ]
      : [
          ['r', 'make centre'],
          ['esc', 'back'],
        ],
  )
  return g
}

/* ---------------------------------------------------------------- page */

const SCREENS = Object.fromEntries(
  Object.keys(GREYS).map((k) => [k, gridHtml(colourTab4({ more: k }), P)]),
)
const CLOSE = Object.fromEntries(
  Object.keys(GREYS).map((k) => [
    k,
    gridHtml(
      colourTab4({ more: k })
        .slice(21, 26)
        .map((r) => r.slice(40)),
      P,
    ),
  ]),
)
const PAGE = 'colour-more-copy-2026-10-round6'

const chip = ([id, [label, from]]: [string, [string, string, Seg[]]]) =>
  `<button class="chip" data-id="${id}"><b>${id.toUpperCase()}</b> ${label}<span>${from}</span></button>`
const entries = Object.entries(GREYS)
const chips = `<div class="grp">Your pick · new</div>${entries
  .filter(([id]) => id.startsWith('p'))
  .map(chip)
  .join('')}<div class="grp">Two-tone, darker · round 6</div>${entries
  .filter(([id]) => id.startsWith('d'))
  .map(chip)
  .join('')}<div class="grp">Round 5 · all kept</div>${entries
  .filter(([id]) => id.startsWith('g'))
  .map(chip)
  .join('')}`

const html = `<!doctype html><html><head><meta charset="utf-8"><title>Forge · colour: the two-tone More button, darker</title>
<style>
  body { margin:0; background:#0d0e11; color:#e2e4ea; font:16px/1.6 -apple-system, BlinkMacSystemFont, "Helvetica Neue", sans-serif; }
  main { max-width:1400px; margin:0 auto; padding:40px 24px 80px; }
  h1 { font-size:28px; margin:0 0 6px; }
  .lede { color:#8f94a1; margin:0 0 28px; max-width:900px; }
  .layout { display:flex; gap:40px; align-items:flex-start; }
  .views { display:flex; flex-direction:column; gap:18px; }
  .close .t { zoom:2; }
  .vt { font:600 13px -apple-system,sans-serif; color:#8f94a1; margin:0 0 6px; }
  .picks { min-width:380px; }
  .chips { display:flex; flex-direction:column; gap:8px; align-items:stretch; }
  .chip { font:500 14px -apple-system, sans-serif; color:#c7cbd4; background:#16181d; border:1px solid #2c2f37; border-radius:8px; padding:8px 12px; cursor:pointer; text-align:left; display:flex; flex-direction:column; }
  .chip b { font:700 12px ui-monospace,Menlo,monospace; color:#55c7d9; margin-right:6px; display:inline }
  .chip span { color:#8f94a1; font-size:13px; }
  .chip:hover { border-color:#4a4f5a; color:#fff; }
  .chip.on { border-color:#55c7d9; background:#12282e; color:#8fe3f0; }
  .grp { font:700 12px ui-monospace,Menlo,monospace; letter-spacing:.06em; text-transform:uppercase; color:#e5a23c; margin:10px 0 2px; }
  .status { font:13px "SF Mono", ui-monospace, Menlo, monospace; color:#8f94a1; margin-top:10px; }
  .copy { margin-top:14px; font:500 14px -apple-system, sans-serif; color:#c7cbd4; background:#16181d; border:1px solid #2c2f37; border-radius:8px; padding:8px 14px; cursor:pointer; }
  ${TERM_CSS}
</style></head><body><main>
<h1>The two-tone More button, darker</h1>
<p class="lede">Click a look on the right. The screen and the close-up change at once, so you can flick between two in the same spot. The highlighted one is your pick, and it saves on its own. Every grey here is one the app already uses.</p>
<div class="layout">
  <div class="views">
    <div><div class="vt">The Colour tab</div><div class="t" style="background:${P.canvas}"><div id="screen"></div></div></div>
    <div class="close"><div class="vt">Close-up, the bottom right</div><div class="t" style="background:${P.canvas}"><div id="close"></div></div></div>
  </div>
  <div class="picks">
    <div class="chips">${chips}</div>
    <button class="copy">Copy my pick</button>
    <div class="status"></div>
  </div>
</div>
<script>
const SCREENS = ${JSON.stringify(SCREENS)}
const CLOSE = ${JSON.stringify(CLOSE)}
const PAGE = ${JSON.stringify(PAGE)}
let pick = 'p1'
const status = document.querySelector('.status')
const label = () => document.querySelector('.chip[data-id="' + pick + '"]').innerText.split('\\n')[0]
function paint() {
  document.getElementById('screen').innerHTML = SCREENS[pick]
  document.getElementById('close').innerHTML = CLOSE[pick]
  for (const c of document.querySelectorAll('.chip')) c.classList.toggle('on', c.dataset.id === pick)
}
async function save() {
  localStorage.setItem(PAGE, pick)
  if (!location.protocol.startsWith('http')) { status.textContent = 'kept in this browser · use Copy my pick'; return }
  try {
    const r = await fetch('/feedback/' + PAGE, { method: 'POST', body: JSON.stringify({ page: PAGE, pick, label: label() }) })
    status.textContent = r.ok ? 'saved · ' + new Date().toLocaleTimeString() : 'not saved · use Copy my pick'
  } catch { status.textContent = 'not saved · use Copy my pick' }
}
for (const c of document.querySelectorAll('.chip')) c.addEventListener('click', () => { pick = c.dataset.id; paint(); save() })
document.querySelector('.copy').addEventListener('click', async () => { await navigator.clipboard.writeText(PAGE + ' pick: ' + label()); status.textContent = 'copied · paste it to Claude' })
paint()
</script>
</main></body></html>`

writeFileSync(`mockups/${PAGE}.html`, html)
console.log(`wrote mockups/${PAGE}.html`)
