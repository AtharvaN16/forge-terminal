/**
 * Round 5 (2026-10-24): every pop-up — More, Tweak, Gradient — is the
 * centred window over the faded screen that Mode and Tweak use today (W1,
 * `windowOver`), not a pop-up under the button. Otherwise round 4.
 *
 * Colour mode, simpler — round 4 (2026-10-24): Flow 1 only, after the
 * user liked round 3's Flow 1 and asked for:
 *
 * - Neutral and Alpha back as tabs, with Palette: Colour · Neutral · Alpha · Palette;
 * - a More button in the screen itself (on the steps line, where t tweak and
 *   s steps were), its list a pop-up, and what it opens (Tweak, Gradient) a
 *   pop-up too, never the bottom of the screen;
 * - today's words kept; Mix is called Gradient, and takes any number of colours.
 *
 *   npx tsx scripts/colour-redesign-mockup-r5.ts → mockups/colour-redesign-2026-10-round5.html
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { DEFAULT_STEPS, scale, stepsOf } from '../src/core/colour/scale.js'
import { formatOklch, formatRgb, parseHex, type Rgb } from '../src/core/colour/space.js'
import { NO_TWEAK, system, type Tweak, tweakSteps } from '../src/core/colour/system.js'
import { trailBarRow } from '../src/shell/bar-art.js'
import { fieldRows, fieldValue, previewRows, rampRows } from '../src/shell/colour/colour-art.js'
import { chosenRow, tweakLines, windowOver } from '../src/shell/colour/system-art.js'
import { onWhiteAndBlack } from '../src/core/colour/contrast.js'
import { oklabToRgb, rgbToOklab } from '../src/core/colour/space.js'
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

const AMBER = parseHex('#F5A524') as Rgb
const TEAL = parseHex('#2EC4B6') as Rgb
const TABS = ['Colour', 'Neutral', 'Alpha', 'Palette']
const BUTTON = '#404040'
const POP = '#2c2c2c'
const POP_ON = '#404040'

/** The More button: a filled pill, its key in the mode's pink; lighter while its menu is open. */
function moreButton(g: Grid, r: number, open = false) {
  const bg = open ? '#4f4f4f' : BUTTON
  put(g, r, 65, [[' ', undefined, bg], ['m', PINK, bg, true], ['  More ▾ ', FG, bg, true]])
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
  put(g, top, left, [['╭─ ', QUIET], [title, FG, undefined, true], [` ${'─'.repeat(inner - title.length - 3)}╮`, QUIET]])
  const body = (pad ? [[], ...lines, []] : lines) as Seg[][]
  body.forEach((segs, i) => {
    put(g, top + 1 + i, left, [['│', QUIET], [' '.repeat(inner), undefined, POP], ['│', QUIET]])
    put(g, top + 1 + i, left + 1, segs.map(([t, fg, bg, b]) => [t, fg, bg ?? POP, b] as Seg))
  })
  put(g, top + 1 + body.length, left, [[`╰${'─'.repeat(inner)}╯`, QUIET]])
}

/** Rows of the grid as an art row, `from` column on, `n` cells wide. */
function asRow(g: Grid, r: number, from = 2, n = 76): Row {
  return (g[r] as Cell[]).slice(from, from + n).map((c) => ({ text: c.ch, fg: c.fg, bg: c.bg, bold: !!c.b }))
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
  keys(g, [['↑↓', 'choose'], ['↵', 'open']], [['esc', 'close'], ['ctrl-c', 'quit']])
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
  keys(g, [['↑↓', 'choose'], ['←→', '1'], ['⇧←→', '10'], ['↵', 'done']], [['r', 'reset'], ['esc', 'cancel']])
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
    const rgb = oklabToRgb({ L: a.L + (b.L - a.L) * u, a: a.a + (b.a - a.a) * u, b: a.b + (b.b - a.b) * u })
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
  keys(g, [['↵', 'add'], ['↑↓', 'choose']], [['⌫', 'remove'], ['tab', 'done'], ['esc', 'cancel']])
  return g
}

/** The gradient: today's Mix screen, with every colour that was added. */
function gradientScreen(): Grid {
  const g = frame('mix')
  bar(g, ['#6579FD'], 'Gradient')
  clear(g, 3, 5)
  const sw = (c: Rgb): Seg[] => [[hex(c), DIM, FIELD], ['  ', undefined, FIELD], ['    ', undefined, hex(c)]]
  field(g, 3, [])
  put(g, 4, 7, [...sw(BLUE), ['   →   ', QUIET, FIELD], ...sw(AMBER), ['   →   ', QUIET, FIELD], ...sw(TEAL)])
  const steps = gradient([BLUE, AMBER, TEAL], 9)
  clear(g, 7, 11)
  rows(g, 7, rampRows({ width: 76, palette: P, steps, selected: 4 }))
  clear(g, 12, 12, 60, 76)
  moreButton(g, 12)
  clear(g, 14, 18)
  const at = steps[4] as (typeof steps)[number]
  const prev = previewRows({ palette: P, step: { step: at.step, hex: at.hex, oklch: formatOklch(at.rgb), ...onWhiteAndBlack(at.rgb) } })
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
  const ordered = [...(yours ? [yours] : []), ...sys.rows.filter((r) => !r.yours), { name: 'neutral', steps: sys.neutral, yours: false }]
  put(g, 9, 14, stepsOf(DEFAULT_STEPS).map((n, c) => [(n < 100 ? ` ${n}` : String(n)).padEnd(5), c === 5 ? FG : QUIET, undefined, c === 5] as Seg))
  ordered.forEach((r, i) => {
    put(g, 10 + i, 4, [[r.name, i === 0 ? PINK : DIM, undefined, i === 0]])
    r.steps.forEach((st, c) => put(g, 10 + i, 14 + c * 5, [['    ', undefined, st.hex]]))
  })
  for (const [c, ch] of [[38, '▕'], [43, '▏']] as const) put(g, 10, c, [[ch, FG]])
  const chosen = ordered[0]?.steps[5]
  if (chosen) row(g, 20, chosenRow(P, ordered[0]?.name ?? '', '500', chosen.hex, formatOklch(chosen.rgb)))
  put(g, 22, 4, [['Full set', FG, undefined, true]])
  moreButton(g, 22)
  keys(g, [['↑↓←→', 'choose'], ['↵', 'copy'], ['c', 'copy all']], [['#', 'new colour'], ['esc', 'back']])
  return g
}

/* ---------------------------------------------------------------- page */

const big = (g: Grid) => termHtml(P, g)
const step = (n: number, title: string, g: Grid, press: string, said: string) =>
  `<div class="vs"><div class="vs-l">${big(g)}</div><div class="vs-r"><div class="vn">Step ${n}</div><h4>${title}</h4><p class="press">${press}</p><p>${said}</p></div></div>`
const down = '<div class="down">↓</div>'
const flow = (...steps: string[]) => `<div class="flow">${steps.join(down)}</div>`

const idea = `<div class="ov">
<ol class="rules3">
<li><b>Home stays.</b> <kbd>S</kbd> Scale opens the Colour tab; <kbd>D</kbd> Palette opens the Palette tab of the same screen.</li>
<li><b>Four tabs:</b> Colour · Neutral · Alpha · Palette.</li>
<li><b>A More button</b> on the screen holds Gradient, Tweak and Steps (Mode on Palette). Its list and what it opens are windows in the middle of the screen, as Mode and Tweak are today.</li>
<li><b>Gradient takes as many colours as you like.</b></li>
<li><b>Today’s words stay.</b> New ones: <span class="words">More · Palette (as a tab) · Gradient (the bar and menu; today “Mix”) · add · remove</span></li>
</ol></div>`

const colourFlow = flow(
  step(1, 'Colour’s home', frame('home'), 'Press <kbd>S</kbd> Scale', 'Unchanged.'),
  step(2, 'Type a colour', frame('scale-typing'), 'Type <code>#6579FD</code>, then <kbd>↵</kbd>', 'Unchanged.'),
  step(3, 'Colour tab', scaleTab('scale'), '<kbd>←→</kbd> choose · <kbd>↵</kbd> copy', 'Palette is a fourth tab. The More button sits where t tweak · s steps were. The gradient hint left the field: Gradient is in More.'),
  step(4, 'Neutral tab', scaleTab('scale-neutral'), '<kbd>tab</kbd>', 'As today.'),
  step(5, 'Alpha tab', scaleTab('scale-alpha'), '<kbd>tab</kbd>', 'As today.'),
  step(6, 'Palette tab', paletteTab(BLUE), '<kbd>tab</kbd> · or <kbd>D</kbd> on home', 'Every row shows at once, yours first. Its More holds Mode, Tweak and Steps.'),
  step(7, 'More', moreOpen(), '<kbd>m</kbd> on the Colour tab', 'A window in the middle, over the faded screen, as Mode and Tweak open today.'),
  step(8, 'Tweak', tweakOpen(), 'Pick Tweak', 'Today’s Tweak window: the sliders, and the scale’s colours under them, changing as you move.'),
  step(9, 'Gradient: add colours', gradientOpen(), 'Pick Gradient, type a colour, <kbd>↵</kbd> add', 'Starts with this colour. Add as many as you like; <kbd>⌫</kbd> removes the chosen one; <kbd>tab</kbd> shows it.'),
  step(10, 'The gradient', gradientScreen(), '<kbd>tab</kbd>', 'Today’s Mix screen, with every colour you added. Its More holds Steps.'),
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
.rules3{margin:0;padding-left:22px;font-size:16px;line-height:1.8}
.words{color:#f3d39d}
</style>`

const concepts: PageConcept[] = [
  { id: 'F1', name: 'I have a colour', idea: 'Ten steps, top to bottom.', html: colourFlow, section: 'Flow 1 · I have a colour' },
]

writeFileSync(
  'mockups/colour-redesign-2026-10-round5.html',
  feedbackPage({
    page: 'colour-redesign-2026-10-round5',
    title: 'Forge · colour mode, simpler · round 5',
    heading: 'Colour mode, simpler — Flow 1',
    lede: 'Round 4 with every pop-up as a window in the middle of the screen, as Mode and Tweak are today. The photo flow comes next.',
    before: `${CSS}<h2>What changed</h2>${idea}`,
    concepts,
  }),
)
console.log('wrote mockups/colour-redesign-2026-10-round5.html')
if (process.env.DUMP)
  for (const [n, g] of Object.entries({ colour: scaleTab('scale'), pal: paletteTab(BLUE), more: moreOpen(), tweak: tweakOpen(), grad: gradientOpen(), gs: gradientScreen() }))
    console.log(`== ${n}\n${g.map((r) => r.map((c) => c.ch).join('')).join('\n')}`)
