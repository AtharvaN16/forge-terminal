/**
 * Scale steps (2026-10-13): choosing where a scale starts and ends, and how
 * far apart its steps are, instead of the fixed 50 … 950. Also the home
 * cards' new subtitles.
 *
 * The brand, the tab row and the key rows of home are cells captured from
 * the real app (a throwaway test wrote /tmp/forge-steps/frames-{dark,light}.json);
 * the bar, the field, the preview and the slider come from the app's own art
 * functions. The ramp is redrawn here so it fits any number of steps, and
 * `stepColour` is a draft of how a step between today's would be coloured.
 *
 *   npx tsx scripts/scale-steps-mockup.ts   → mockups/scale-steps-2026-10.html
 */
import { readFileSync, writeFileSync } from 'node:fs'
import stringWidth from 'string-width'
import { onWhiteAndBlack, rate } from '../src/core/colour/contrast.js'
import { scale } from '../src/core/colour/scale.js'
import {
  formatOklch,
  fromLch,
  inGamut,
  oklabToRgb,
  parseHex,
  type Rgb,
  rgbToOklab,
  toHex,
  toLch,
} from '../src/core/colour/space.js'
import { trailBarRow } from '../src/shell/bar-art.js'
import {
  COLOUR_SAMPLES,
  fieldRows,
  fieldValue,
  previewRows,
} from '../src/shell/colour/colour-art.js'
import { blank, type Row, type Run, width } from '../src/shell/home-art.js'
import { sliderRow } from '../src/shell/quality-art.js'
import { DARK, LIGHT, modePalette, type Palette } from '../src/shell/theme.js'

const N = 80
/** The content's width inside the shell's two-column margins. */
const CONTENT = 76
/** The field's width, and so the ramp's: the content less its two-column lead. */
const AVAIL = 72

/* -------------------------------------------------------- captured cells */

interface Cell {
  ch: string
  fg: string | null
  bg: string | null
  b: boolean
}
const frames = (name: string) =>
  JSON.parse(readFileSync(`/tmp/forge-steps/frames-${name}.json`, 'utf8')) as Record<
    string,
    Cell[][]
  >
const CAPTURED = { dark: frames('dark'), light: frames('light') }

const rowOf = (cells: Cell[]): Row => {
  const out: Run[] = []
  for (const c of cells) {
    const last = out[out.length - 1]
    const fg = c.fg ?? undefined
    const bg = c.bg ?? undefined
    if (last && last.fg === fg && last.bg === bg && !!last.bold === c.b) last.text += c.ch
    else out.push({ text: c.ch, fg, bg, bold: c.b })
  }
  return out
}

interface Look {
  p: Palette
  name: 'dark' | 'light'
  home: Row[]
}
function lookOf(base: Palette): Look {
  const name = base.name === 'light' ? 'light' : 'dark'
  const f = CAPTURED[name]
  return { p: modePalette(base, 'colour'), name, home: (f.home as Cell[][]).map(rowOf) }
}

/* ---------------------------------------------------------- the scale */

/**
 * Today's ladder, as knots on a 0–1000 ruler: how far a step has gone from
 * the reference towards white (up) or towards the floor (down). A step
 * between two knots is interpolated, so every step on today's default keeps
 * its exact hex. Beyond 50 and 950 the ruler goes on to near-white and to a
 * deeper dark.
 */
const UP: [number, number][] = [
  [50, 1],
  [100, 0.86],
  [200, 0.68],
  [300, 0.46],
  [400, 0.22],
  [500, 0],
]
const DOWN: [number, number][] = [
  [500, 0],
  [600, 0.2],
  [700, 0.4],
  [800, 0.6],
  [900, 0.8],
  [950, 1],
]
function interp(knots: [number, number][], s: number): number {
  for (let i = 1; i < knots.length; i++) {
    const [a, fa] = knots[i - 1] as [number, number]
    const [b, fb] = knots[i] as [number, number]
    if (s <= b) return fa + ((fb - fa) * (s - a)) / (b - a)
  }
  return (knots[knots.length - 1] as [number, number])[1]
}

function stepColour(ref: Rgb, s: number): Rgb {
  if (s === 500) return ref
  const { L: L0, C: C0, h } = toLch(rgbToOklab(ref))
  const grey = C0 < 0.015
  const top = Math.max(0.975, L0)
  const floor = L0 < 0.16 ? 0.42 * L0 : Math.max(0.16, 0.42 * L0)
  let L: number
  let C: number
  if (s < 500) {
    if (s >= 50) {
      const f = interp(UP, s)
      L = L0 + (top - L0) * f
      C = C0 * (1 - 0.88 * f)
    } else {
      const t = (50 - s) / 50
      L = top + (Math.max(0.995, top) - top) * t
      C = C0 * 0.12 * (1 - t)
    }
  } else if (s <= 950) {
    const g = interp(DOWN, s)
    L = L0 - (L0 - floor) * g
    C = C0 * (1 - 0.45 * g)
  } else {
    const t = (s - 950) / 50
    L = floor * (1 - 0.35 * t)
    C = C0 * 0.55 * (1 - 0.4 * t)
  }
  if (grey) C = 0
  while (C > 0 && !inGamut(fromLch({ L, C, h }))) C -= 0.002
  return oklabToRgb(fromLch({ L, C: Math.max(0, C), h }))
}

interface Steps {
  start: number
  end: number
  every: number
}
const DEFAULT: Steps = { start: 50, end: 950, every: 100 }

/** The start, the end, and every multiple of `every` between them. 500 is always one. */
function stepsOf({ start, end, every }: Steps): number[] {
  const out = new Set<number>([start, end, 500])
  for (let s = Math.ceil((start + 1) / every) * every; s < end; s += every) out.add(s)
  return [...out].sort((a, b) => a - b)
}

interface Step {
  step: number
  /** What the ramp calls it, when that is not the step's number (Radix's 1–12). */
  label?: string
  hex: string
  rgb: Rgb
  reference: boolean
}
function scaleOf(hex: string, st: Steps): Step[] {
  const ref = parseHex(hex) as Rgb
  return stepsOf(st).map((s) => {
    const rgb = stepColour(ref, s)
    return { step: s, rgb, hex: toHex(rgb), reference: s === 500 }
  })
}

// The draft must leave today's scale exactly as it is.
for (const hex of ['#6579FD', '#F26E69', '#71717A', '#343F96', '#ACE02C']) {
  const today = scale(parseHex(hex) as Rgb).map((s) => s.hex)
  const drafted = scaleOf(hex, DEFAULT).map((s) => s.hex)
  if (today.join() !== drafted.join()) throw new Error(`draft differs for ${hex}: ${drafted}`)
}

/* ------------------------------------------------------------ helpers */

const run = (text: string, fg?: string, bg?: string, bold = false): Run => ({ text, fg, bg, bold })
const pad = (row: Row, n: number, bg?: string): Row => [
  ...row,
  ...(n > width(row) ? [{ text: ' '.repeat(n - width(row)), bg }] : []),
]
const cap = (L: Look, k: string): Run => run(` ${k} `, L.p.fg, L.p.keycapBg, true)

function keys(L: Look, main: [string, string][], foot: [string, string][]): Row[] {
  const row: Row = [blank(1)]
  main.forEach(([k, w], i) => {
    if (i) row.push(blank(2))
    row.push(cap(L, k), run(` ${w}`, L.p.dim))
  })
  const f = foot.map(([k, w]) => `${k} ${w}`).join(' · ')
  row.push(blank(Math.max(2, 75 - width(row) - stringWidth(f))), run(f, L.p.border))
  return [[run('─'.repeat(CONTENT), L.p.border)], row]
}

/** A whole screen at 80 × 24: the bar, the field, the body, the keys at the bottom. */
function screen(L: Look, trail: string[], value: string, body: Row[], keyRows: Row[]): Row[] {
  const current = trail[trail.length - 1]
  const bar = trailBarRow({
    width: N,
    palette: L.p,
    mode: 'colour',
    trail: { answers: trail.slice(0, -1), current },
    slanted: false,
  })
  const field = fieldRows({
    width: CONTENT,
    palette: L.p,
    content: fieldValue({ palette: L.p, value }),
    focus: false,
  })
  const content = [[], ...field, [], ...body]
  while (content.length < 20) content.push([])
  return [[], bar, ...[...content.slice(0, 20), ...keyRows].map((r) => [blank(2), ...r])]
}

/* --------------------------------------------------------------- ramp */

/**
 * The ramp at any count: cells as wide as fit in the field's width, a gap
 * between them while cells are at least four wide. A label that would touch
 * its neighbour is left out; the chosen step's always shows.
 */
function ramp(L: Look, steps: Step[], sel: number): Row[] {
  const n = steps.length
  let gap = 1
  let cell = Math.floor((AVAIL - (n - 1)) / n)
  if (cell < 4) {
    gap = 0
    cell = Math.floor(AVAIL / n)
  }
  const at = (i: number) => i * (cell + gap)
  // Labels: the chosen one first, then the rest wherever they do not touch.
  const placed: { from: number; to: number; i: number }[] = []
  const tryPlace = (i: number, force = false) => {
    const t = (steps[i] as Step).label ?? String((steps[i] as Step).step)
    const from = at(i) + Math.floor((cell - t.length) / 2)
    const to = from + t.length
    if (!force && placed.some((p) => from < p.to + 1 && to + 1 > p.from)) return
    placed.push({ from: Math.max(0, from), to, i })
  }
  tryPlace(sel, true)
  steps.forEach((_, i) => {
    if (i !== sel) tryPlace(i)
  })
  placed.sort((a, b) => a.from - b.from)
  const labels: Row = [blank(2)]
  let col = 0
  for (const p of placed) {
    const s = steps[p.i] as Step
    labels.push(blank(p.from - col))
    const t = s.label ?? String(s.step)
    labels.push(
      p.i === sel ? run(t, L.p.fg, undefined, true) : run(t, s.reference ? L.p.accent : L.p.border),
    )
    col = p.to
  }
  const join = (cells: Row[]): Row => [
    blank(2),
    ...cells.flatMap((c, i) => (i === 0 || gap === 0 ? c : [blank(gap), ...c])),
  ]
  const sw = join(steps.map((s) => [run(' '.repeat(cell), undefined, s.hex)]))
  return [
    labels,
    sw,
    sw,
    sw,
    join(steps.map((_, i) => [i === sel ? run('▔'.repeat(cell), L.p.fg) : blank(cell)])),
  ]
}

function preview(L: Look, s: Step): Row[] {
  return previewRows({
    palette: L.p,
    step: {
      step: s.label ? Number(s.label) : s.step,
      hex: s.hex,
      oklch: formatOklch(s.rgb),
      ...onWhiteAndBlack(s.rgb),
    },
  })
}

const HEX = '#6579FD'
const selOf = (steps: Step[], want = 500) => {
  const i = steps.findIndex((s) => s.step === want)
  return i < 0 ? steps.findIndex((s) => s.step === 500) : i
}
const describe = (st: Steps) => `${st.start} – ${st.end}, every ${st.every}`
const countOf = (st: Steps) => `${stepsOf(st).length} steps`

const REST_KEYS = (L: Look, extra: [string, string][] = []) =>
  keys(
    L,
    [['←→', 'choose'], ['↵', 'copy'], ['c', 'copy all'], ...extra],
    [
      ['r', 'make centre'],
      ['#', 'new colour'],
    ],
  )

/* ------------------------------------------------- V1: a line you edit */

/** The quiet line under the ramp at rest: what the steps are, and the key that changes them. */
function stepsLine(L: Look, st: Steps): Row {
  const left: Row = [blank(2), run(describe(st), L.p.dim), run(`  ·  ${countOf(st)}`, L.p.border)]
  return withEnd(L, left, false)
}
/** The line's right end: `s steps` at rest, `↵ done` while the values are being changed. */
function withEnd(L: Look, left: Row, editing: boolean): Row {
  const right: Row = editing
    ? [cap(L, '↵'), run(' done', L.p.dim)]
    : [cap(L, 's'), run(' steps', L.p.dim)]
  return [...pad(left, 2 + AVAIL - width(right)), ...right]
}

type Focus = 'start' | 'end' | 'every'
/** The same line while it is being changed: three values, the one in hand a white pill. */
function stepsEditor(L: Look, st: Steps, focus: Focus): Row {
  const pill = (f: Focus, v: number): Run[] =>
    f === focus
      ? [run(` ‹ ${v} › `, L.p.ink, L.p.thumb, true)]
      : [run(` ${v} `, L.p.fg, L.p.fieldBand)]
  return [
    blank(2),
    run('from ', L.p.dim),
    ...pill('start', st.start),
    run('  to ', L.p.dim),
    ...pill('end', st.end),
    run('  every ', L.p.dim),
    ...pill('every', st.every),
    run(`   ${countOf(st)}`, L.p.border),
  ]
}
/** Round two: the editor with `↵ done` where `s steps` was. */
const stepsEditor2 = (L: Look, st: Steps, focus: Focus): Row =>
  withEnd(L, stepsEditor(L, st, focus), true)

const EDIT_KEYS2 = (L: Look) =>
  keys(
    L,
    [
      ['←→', 'change'],
      ['tab', 'next'],
    ],
    [['esc', 'cancel']],
  )

function v1b(L: Look, st: Steps, opts: { focus?: Focus; sel?: number } = {}): Row[] {
  const steps = scaleOf(HEX, st)
  const sel = selOf(steps, opts.sel)
  const line = opts.focus ? stepsEditor2(L, st, opts.focus) : stepsLine(L, st)
  return screen(
    L,
    ['Scale'],
    HEX,
    [...ramp(L, steps, sel), [], line, [], ...preview(L, steps[sel] as Step)],
    opts.focus ? EDIT_KEYS2(L) : REST_KEYS(L),
  )
}

const EDIT_KEYS = (L: Look) =>
  keys(
    L,
    [
      ['←→', 'change'],
      ['tab', 'next'],
      ['↵', 'done'],
    ],
    [['esc', 'cancel']],
  )

function v1(L: Look, st: Steps, opts: { focus?: Focus; sel?: number } = {}): Row[] {
  const steps = scaleOf(HEX, st)
  const sel = selOf(steps, opts.sel)
  const line = opts.focus ? stepsEditor(L, st, opts.focus) : stepsLine(L, st)
  return screen(
    L,
    ['Scale'],
    HEX,
    [...ramp(L, steps, sel), [], line, [], ...preview(L, steps[sel] as Step)],
    opts.focus ? EDIT_KEYS(L) : REST_KEYS(L),
  )
}

/* ---------------------------------------------- V2: its own screen */

const SL = 44
function v2Rows(L: Look, st: Steps, focus: Focus): Row[] {
  const label = (f: Focus, t: string): Run[] => [
    f === focus ? run('▌', L.p.accent) : blank(1),
    run(' '),
    run(t.padEnd(7), f === focus ? L.p.fg : L.p.dim, undefined, f === focus),
  ]
  const slider = (f: Focus, v: number, min: number, max: number, ends: [string, string]): Row[] => [
    [
      blank(1),
      ...label(f, f === 'start' ? 'Start' : 'End'),
      ...sliderRow({ palette: L.p, value: v, min, max, width: SL }),
    ],
    [
      blank(11),
      run(ends[0], L.p.border),
      blank(SL + 1 - ends[0].length - ends[1].length),
      run(ends[1], L.p.border),
    ],
  ]
  const choices: Row = [blank(1), ...label('every', 'Every')]
  for (const v of [50, 100, 250]) {
    choices.push(
      blank(1),
      v === st.every
        ? run(` ${v} `, L.p.ink, focus === 'every' ? L.p.thumb : L.p.trackFill, true)
        : run(` ${v} `, L.p.dim, L.p.track),
    )
  }
  choices.push(run(`      ${countOf(st)}`, L.p.border))
  return [
    ...slider('start', st.start, 0, 450, ['0', '450']),
    [],
    ...slider('end', st.end, 550, 1000, ['550', '1000']),
    [],
    choices,
  ]
}
function v2(L: Look, st: Steps, focus: Focus): Row[] {
  const steps = scaleOf(HEX, st)
  return screen(
    L,
    ['Scale', 'Steps'],
    HEX,
    [...ramp(L, steps, selOf(steps)), [], ...v2Rows(L, st, focus)],
    keys(
      L,
      [
        ['↑↓', 'choose'],
        ['←→', 'change'],
        ['↵', 'done'],
      ],
      [['esc', 'cancel']],
    ),
  )
}

/* ------------------------------------------------- V3: a short list */

interface Preset {
  st?: Steps
  name?: string
}
const PRESETS: Preset[] = [
  { st: { start: 50, end: 950, every: 100 }, name: 'Tailwind' },
  { st: { start: 100, end: 900, every: 100 } },
  { st: { start: 50, end: 950, every: 50 } },
  { st: { start: 0, end: 1000, every: 100 } },
  { st: { start: 0, end: 1000, every: 50 } },
  {},
]
function v3(L: Look, chosen: number, custom?: { st: Steps; focus: Focus }): Row[] {
  const now = custom?.st ?? PRESETS[chosen]?.st ?? DEFAULT
  const steps = scaleOf(HEX, now)
  const list: Row[] = PRESETS.map((pr, i) => {
    const on = i === chosen
    const bg = on ? L.p.band : undefined
    const lead: Row = [on ? run('▌', L.p.accent, bg) : blank(1), run(' ', undefined, bg)]
    if (!pr.st) {
      if (on && custom)
        return pad(
          [
            ...lead,
            ...stepsEditor(L, custom.st, custom.focus)
              .slice(1)
              .map((r) => (r.bg ? r : { ...r, bg })),
          ],
          AVAIL,
          bg,
        )
      return pad([...lead, run('Custom…', on ? L.p.fg : L.p.dim, bg, on)], on ? AVAIL : 0, bg)
    }
    const st = pr.st
    const text: Row = [
      run(`${st.start} – ${st.end}`.padEnd(12), on ? L.p.fg : L.p.dim, bg, on),
      run(`every ${st.every}`.padEnd(12), on ? L.p.fg : L.p.dim, bg),
      run(countOf(st).padEnd(12), L.p.border, bg),
      run(pr.name ?? '', L.p.border, bg),
    ]
    const now = i === 0 ? [run('✓ now', L.p.ok, bg)] : []
    const row = [...lead, ...text]
    return on
      ? [...pad(row, AVAIL - 6, bg), ...now, ...pad([], 6 - width(now), bg)]
      : [...row, ...(now.length ? [blank(Math.max(0, AVAIL - 6 - width(row))), ...now] : [])]
  })
  return screen(
    L,
    ['Scale', 'Steps'],
    HEX,
    [...ramp(L, steps, selOf(steps)), [], ...list.map((r) => [blank(2), ...r])],
    custom
      ? EDIT_KEYS(L)
      : keys(
          L,
          [
            ['↑↓', 'choose'],
            ['↵', 'use'],
          ],
          [['esc', 'back']],
        ),
  )
}

/* ------------------------------------------------------------- home */

const CARD = 34
function homeCards(L: Look, selected: 0 | 1, subs: [string, string]): Row[] {
  const p = L.p
  const W = AVAIL
  const on = (bg: string, runs: Row, w: number): Row =>
    pad(
      runs.map((r) => (r.bg ? r : { ...r, bg })),
      w,
      bg,
    )
  const cards = [
    {
      name: 'Palette',
      sub: subs[0],
      preview: COLOUR_SAMPLES.palette.map((h) => run('    ', undefined, h.toLowerCase())),
    },
    {
      name: 'Scale',
      sub: subs[1],
      preview: COLOUR_SAMPLES.scale.map((h) => run('  ', undefined, h.toLowerCase())),
    },
  ]
  const card = (i: number): Row[] => {
    const c = cards[i] as (typeof cards)[number]
    const me = i === selected
    const bg = me ? p.panelBand : p.selectionBg
    const line = (txt: Row): Row => on(bg, [blank(2), ...txt], CARD)
    return [
      line([]),
      line([run(c.name, me ? p.fg : p.dim, undefined, true)]),
      line([run(c.sub, me ? p.dim : p.border)]),
      line([]),
      line(c.preview),
      line([]),
    ]
  }
  const a = card(0)
  const b = card(1)
  const edge: Row = [blank(2), ...on(p.selectionBg, [], W)]
  return [
    edge,
    ...a.map((row, i) => [
      blank(2),
      ...on(p.selectionBg, [blank(1), ...row, blank(2), ...(b[i] ?? []), blank(1)], W),
    ]),
    edge,
  ]
}
function home(L: Look, selected: 0 | 1, subs: [string, string]): Row[] {
  const top = L.home.slice(0, 9)
  const keyRows = L.home.slice(22, 24)
  const body = homeCards(L, selected, subs).map((r) => [blank(2), ...r])
  const rows = [...top, ...body]
  while (rows.length < 22) rows.push([])
  return [...rows, ...keyRows]
}

/* ------------------------------------------------------------- render */

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const GLYPH: Record<string, string> = { '╱': 'd', '▀': 'u', '▄': 'l', '█': 'f', '▌': 'h' }

function html(rows: Row[], p: Palette): string {
  rows.forEach((r, i) => {
    if (width(r) > N) console.warn(`row ${i} is ${width(r)} wide:`, r.map((x) => x.text).join(''))
  })
  const body = rows
    .map((r) => {
      let out = ''
      let used = 0
      for (const x of r) {
        const style = [
          x.fg ? `color:${x.fg}` : '',
          x.bg ? `background:${x.bg}` : '',
          x.bold ? 'font-weight:700' : '',
        ]
          .filter(Boolean)
          .join(';')
        let inner = ''
        for (const ch of x.text) inner += GLYPH[ch] ? `<i class="${GLYPH[ch]}"></i>` : esc(ch)
        out += style ? `<span style="${style}">${inner}</span>` : `<span>${inner}</span>`
        used += stringWidth(x.text)
      }
      if (used < N) out += `<span>${' '.repeat(N - used)}</span>`
      return `<div class="r">${out}</div>`
    })
    .join('')
  return `<div class="t" style="background:${p.canvas};color:${p.fg}">${body}</div>`
}

interface Fig {
  id: string
  name: string
  note: string
  pick?: boolean
  draw: (L: Look) => Row[][]
}
function figure(f: Fig): string {
  const themes = [DARK, LIGHT]
    .map((base) => {
      const L = lookOf(base)
      return `<div class="theme ${L.name}">${f
        .draw(L)
        .map((fr) => html(fr, L.p))
        .join('')}</div>`
    })
    .join('')
  return `<figure><div class="vt"><span class="id">${f.id}</span><span class="name">${f.name}</span>${f.pick ? '<span class="pick">MY PICK</span>' : ''}</div>${themes}<p class="idea">${f.note}</p></figure>`
}

/* ---------------------------------------------------------- the page */

const S_1700: Steps = { start: 100, end: 950, every: 100 }
const S_1750: Steps = { start: 100, end: 900, every: 50 }

/** Ramps alone, for the "how it works" tab: a caption, then the ramp. */
const rampOnly = (L: Look, st: Steps, hex = HEX, sel = 500): Row[] => {
  const steps = scaleOf(hex, st)
  return [
    [blank(4), run(describe(st), L.p.fg, undefined, true), run(`   ${countOf(st)}`, L.p.border)],
    [],
    ...ramp(L, steps, selOf(steps, sel)).map((r) => [blank(2), ...r]),
  ]
}
const stack = (L: Look, list: Steps[], hex = HEX): Row[] => {
  const rows: Row[] = [[]]
  for (const st of list) rows.push(...rampOnly(L, st, hex), [])
  return rows
}

const SUBS: { id: string; sub: string; note: string; pick?: boolean }[] = [
  {
    id: 'H1',
    sub: 'make shades from one colour',
    note: 'Says what you do, the same way Palette’s line does (“extract … from”). “Shades” is the word most people already use.',
  },
  {
    id: 'H2',
    sub: 'light to dark, from one colour',
    note: 'Describes the result: one colour, spread from light to dark. Doesn’t use a verb like Palette’s line does.',
  },
  {
    id: 'H3',
    sub: 'tints and shades of one colour',
    note: 'The designer’s words: tints go lighter, shades go darker. Precise, but “tints” is jargon for some people.',
  },
  {
    id: 'H4',
    sub: 'every shade of a colour',
    note: 'The shortest. “Every” overpromises a little: it’s 11 steps by default, not every shade.',
  },
]

/* ------------------------------------------ round 3: a set, or a count */

type SetName = 'Tailwind' | 'Even' | 'Radix'
interface Sets {
  set: SetName
  start: number
  end: number
  count: number
}
const TW: Sets = { set: 'Tailwind', start: 50, end: 950, count: 11 }
/** Radix's twelve, by what each is for: backgrounds 1–5, borders 6–8, the solid colour 9, text 11–12. */
const RADIX = [20, 50, 100, 150, 200, 260, 330, 420, 500, 560, 750, 920]

/**
 * Places on the ruler, each with its name. 500, the colour, is always one:
 * an even count is split into the steps lighter than it and darker than it,
 * in proportion to how much of the range each side has, so the colour is a
 * step whatever the count. Even steps are named by their place, to the 10.
 */
function placesOf(st: Sets): { pos: number; label: string }[] {
  if (st.set === 'Tailwind') {
    return stepsOf({ start: st.start, end: st.end, every: 100 }).map((pos) => ({
      pos,
      label: String(pos),
    }))
  }
  if (st.set === 'Radix') return RADIX.map((pos, i) => ({ pos, label: String(i + 1) }))
  const gaps = st.count - 1
  let light = Math.round((gaps * (500 - st.start)) / (st.end - st.start))
  light = Math.max(st.start < 500 ? 1 : 0, Math.min(gaps - (st.end > 500 ? 1 : 0), light))
  const dark = gaps - light
  const out: number[] = []
  for (let i = 0; i <= light; i++) out.push(st.start + ((500 - st.start) * i) / light)
  for (let j = 1; j <= dark; j++) out.push(500 + ((st.end - 500) * j) / dark)
  return out.map((pos) => ({ pos, label: String(Math.round(pos / 10) * 10) }))
}

function scaleOf3(hex: string, st: Sets): Step[] {
  const ref = parseHex(hex) as Rgb
  return placesOf(st).map(({ pos, label }) => {
    const rgb = stepColour(ref, pos)
    return { step: Math.round(pos), label, rgb, hex: toHex(rgb), reference: pos === 500 }
  })
}
const refOf = (steps: Step[]) => steps.findIndex((s) => s.reference)

/** The line at rest: which set, its ends, how many. */
function setsLine(L: Look, st: Sets): Row {
  const places = placesOf(st)
  const ends = `${places[0]?.label} – ${places[places.length - 1]?.label}`
  const tail = st.set === 'Radix' ? '12 steps · your colour at 9' : `${places.length} steps`
  return withEnd(
    L,
    [
      blank(2),
      run(st.set, L.p.fg, undefined, true),
      run(`  ${ends}`, L.p.dim),
      run(`  ·  ${tail}`, L.p.border),
    ],
    false,
  )
}

type Focus3 = 'set' | 'start' | 'end' | 'count'
/** The line while it is being changed: the set first, then what that set lets you change. */
function setsEditor(L: Look, st: Sets, focus: Focus3): Row {
  const pill = (f: Focus3, v: string | number): Run[] =>
    f === focus
      ? [run(` ‹ ${v} › `, L.p.ink, L.p.thumb, true)]
      : [run(` ${v} `, L.p.fg, L.p.fieldBand)]
  const row: Row = [blank(2), ...pill('set', st.set)]
  if (st.set === 'Tailwind') {
    row.push(
      run('  from ', L.p.dim),
      ...pill('start', st.start),
      run('  to ', L.p.dim),
      ...pill('end', st.end),
    )
    row.push(run(`   ${placesOf(st).length} steps`, L.p.border))
  } else if (st.set === 'Even') {
    row.push(
      run('  from ', L.p.dim),
      ...pill('start', st.start),
      run('  to ', L.p.dim),
      ...pill('end', st.end),
    )
    row.push(run('  steps ', L.p.dim), ...pill('count', st.count))
  } else {
    row.push(run('   1 – 12 · your colour at 9', L.p.border))
  }
  return withEnd(L, row, true)
}

function r3(L: Look, st: Sets, opts: { focus?: Focus3; sel?: number } = {}): Row[] {
  const steps = scaleOf3(HEX, st)
  const sel = opts.sel ?? refOf(steps)
  const line = opts.focus ? setsEditor(L, st, opts.focus) : setsLine(L, st)
  return screen(
    L,
    ['Scale'],
    HEX,
    [...ramp(L, steps, sel), line, [], ...preview(L, steps[sel] as Step)],
    opts.focus ? EDIT_KEYS2(L) : REST_KEYS(L),
  )
}

const r3Only = (L: Look, st: Sets, hex = HEX): Row[] => {
  const steps = scaleOf3(hex, st)
  const places = placesOf(st)
  const what =
    st.set === 'Even'
      ? `Even  ${st.start} – ${st.end}, ${st.count} steps`
      : st.set === 'Radix'
        ? 'Radix  1 – 12, your colour at 9'
        : `Tailwind  ${places[0]?.label} – ${places[places.length - 1]?.label}`
  return [
    [blank(4), run(what, L.p.fg, undefined, true), run(`   ${places.length} steps`, L.p.border)],
    [],
    ...ramp(L, steps, refOf(steps)).map((r) => [blank(2), ...r]),
  ]
}
const r3Stack = (L: Look, list: Sets[]): Row[] => {
  const rows: Row[] = [[]]
  for (const st of list) rows.push(...r3Only(L, st), [])
  return rows
}
const EVEN = (start: number, end: number, count: number): Sets => ({
  set: 'Even',
  start,
  end,
  count,
})

const ROUND3: { id: string; title: string; intro: string; figs: Fig[] } = {
  id: 'r3',
  title: '★ Round 3 · a set, or a count',
  intro:
    'The line under the ramp now starts with <b>which set</b> of steps, the way online generators do it. <b>Tailwind</b> is the 50 … 950 you have today, and you can still trim its ends. <b>Even</b> takes a <b>count</b> instead of “every”: 3 to 21 steps spread evenly from one end to the other, named by where they fall, to the nearest 10. Your colour is always one of them: the count is split between the lighter side and the darker side, in proportion, so 500 is always a step. <b>Radix</b> is their twelve, numbered 1 – 12, with your colour at 9 where Radix puts its solid colour, light backgrounds and borders above it and text colours below. The first value in the line is now the set: ←→ changes it, and tab goes on to what that set lets you change.',
  figs: [
    {
      id: 'C1',
      name: 'At rest · the set in hand · Even · 15 steps · done · Radix',
      pick: true,
      note: 'Each moment, left to right: today’s scale; <b>s</b> with the set in hand; → makes it Even, which renames the same range by place (50, 140, 230 …); tab to <b>steps</b> and → to 15 over 0 – 1000; ↵ keeps it; and the Radix set for comparison.',
      draw: (L) => [
        r3(L, TW),
        r3(L, TW, { focus: 'set' }),
        r3(L, EVEN(50, 950, 11), { focus: 'set' }),
        r3(L, EVEN(0, 1000, 15), { focus: 'count' }),
        r3(L, EVEN(0, 1000, 15), { sel: 10 }),
        r3(L, { ...TW, set: 'Radix' }),
      ],
    },
    {
      id: 'C2',
      name: 'What each set gives, on one colour',
      note: 'Tailwind trimmed to 100 – 900; Even at 5, 9, 15 and 21 over 0 – 1000; Radix’s twelve. With a count, the spacing is the same on each side of your colour only when the range is: over 0 – 1000 it is, over 100 – 950 the darker side’s steps sit a little further apart.',
      draw: (L) => [
        r3Stack(L, [TW, { ...TW, start: 100, end: 900 }, { ...TW, set: 'Radix' }]),
        r3Stack(L, [EVEN(0, 1000, 5), EVEN(0, 1000, 9), EVEN(0, 1000, 15)]),
        r3Stack(L, [EVEN(0, 1000, 21), EVEN(100, 950, 12), EVEN(0, 1000, 12)]),
      ],
    },
  ],
}

const TABS: { id: string; title: string; intro: string; figs: Fig[] }[] = [
  ROUND3,
  {
    id: 'v1b',
    title: 'V1 · round 2 (built)',
    intro:
      'V1 with your two changes. <b>r make centre</b> steps back into the quiet keys at the right, beside <b>#&nbsp;new colour</b>. Pressing <b>s</b> turns the line’s <b>s steps</b> into <b>↵ done</b> in the same place, so the key that finishes sits where you started. The key row while editing keeps only ←→ change and tab next, with esc cancel at the right. Home: Scale reads <b>create shades from one colour</b>.',
    figs: [
      {
        id: 'V1b',
        name: 'At rest · changing the start · changing the spacing · done',
        pick: true,
        note: 'The steps stay as you set them for the rest of the session: a new colour with # and a new centre with r keep them.',
        draw: (L) => [
          v1b(L, DEFAULT),
          v1b(L, { ...DEFAULT, start: 100 }, { focus: 'start' }),
          v1b(L, S_1750, { focus: 'every' }),
          v1b(L, S_1750, { sel: 800 }),
        ],
      },
      {
        id: 'H5',
        name: '“create shades from one colour”',
        pick: true,
        note: 'Home with Palette chosen, then Scale.',
        draw: (L: Look) => [
          home(L, 0, ['extract colours from an image', 'create shades from one colour']),
          home(L, 1, ['extract colours from an image', 'create shades from one colour']),
        ],
      },
    ],
  },
  {
    id: 'set',
    title: 'Round 1 · setting the steps',
    intro:
      'Three ways to change where the scale starts, where it ends and how far apart its steps are. Each figure is a few moments, left to right: the scale as it is, changing the start, changing the spacing, and the result. The ramp redraws as you change a value, so you see the steps before you commit. The <b>Steps</b> tab explains the rules all three share.',
    figs: [
      {
        id: 'V1',
        name: 'A line under the ramp you edit in place',
        pick: true,
        note: 'The scale screen gets one quiet line: <b>50 – 950, every 100 · 11 steps</b>, with <b>s steps</b> at its right. Press <b>s</b> and the line turns into three values. The one in hand is a white pill (like Quality’s thumb), ←→ changes it, tab goes to the next, ↵ keeps the change and esc undoes it. Nothing new to learn and no new screen, and you always see the current setting. The key row stays as it is, because the key sits on the line it changes.',
        draw: (L) => [
          v1(L, DEFAULT),
          v1(L, { ...DEFAULT, start: 100 }, { focus: 'start' }),
          v1(L, S_1750, { focus: 'every' }),
          v1(L, S_1750, { sel: 800 }),
        ],
      },
      {
        id: 'V2',
        name: 'Its own screen, with Quality’s sliders',
        note: '<b>s</b> opens <b>Scale ╱ Steps</b>. The ramp stays at the top and redraws as you change values. Below it are Start and End as Quality’s grey slider bands (the value on a white pill) and Every as three choices. ↑↓ moves between rows and ←→ changes the value. It’s the most visual and the easiest to explore, but it’s a separate screen for three numbers, and the sliders take up the space the preview would use.',
        draw: (L) => [
          v2(L, DEFAULT, 'start'),
          v2(L, { ...DEFAULT, start: 100 }, 'start'),
          v2(L, S_1750, 'every'),
          v1(L, S_1750, { sel: 800 }),
        ],
      },
      {
        id: 'V3',
        name: 'A short list of common sets, then Custom',
        note: '<b>s</b> opens a list of the sets people actually use: Tailwind’s 50 – 950, 100 – 900, the same range every 50, and 0 – 1000. The ramp above previews the highlighted one, so ↑↓ is the comparison. <b>Custom…</b> opens V1’s line inside the list. It takes one key for the common cases, but someone has to choose the list, and anything custom takes two steps.',
        draw: (L) => [
          v3(L, 0),
          v3(L, 2),
          v3(L, 5, { st: S_1750, focus: 'every' }),
          v1(L, S_1750, { sel: 800 }),
        ],
      },
    ],
  },
  {
    id: 'rules',
    title: 'Steps · how they work',
    intro:
      'The numbers are places on a ruler from <b>0</b> (near white) to <b>1000</b> (near black), with your colour always at <b>500</b>. <b>Start</b> and <b>end</b> choose how much of the ruler you get, and <b>every</b> chooses how many steps: the start, the end, and every multiple of “every” between them. So today’s set is 50 – 950 every 100, which gives 50, 100, 200 … 900, 950. Today’s eleven colours keep their exact hex: a new step like 150 sits halfway between 100 and 200 on the same curve. The script checks this against <code>scale()</code> for five colours.<br><br><b>Limits, and why.</b> Start goes from 0 to 450 and end from 550 to 1000, in 50s, so your colour is always in its own scale. “Every” is 50, 100 or 250. I left out 25 because 0 – 1000 every 25 would be 41 swatches, two cells wide and impossible to tell apart. At most it’s 21 steps (0 – 1000 every 50), and those still fit in 80 columns.',
    figs: [
      {
        id: 'R',
        name: 'One colour, five settings',
        note: 'All five share the same 500 (#6579FD). When the swatches get narrow, the ramp drops the gaps between them first. After that it drops labels that would touch their neighbours, but always keeps the chosen step’s.',
        draw: (L) => [
          stack(L, [DEFAULT, { start: 100, end: 900, every: 100 }, S_1750]),
          stack(L, [
            { start: 0, end: 1000, every: 100 },
            { start: 0, end: 1000, every: 50 },
            { start: 50, end: 950, every: 250 },
          ]),
        ],
      },
      {
        id: 'R2',
        name: 'A grey and a warm colour, 0 – 1000 every 50',
        note: 'The two ends of the ruler on colours that behave differently: a neutral grey (still pure grey, see the note on tinted greys in chat) and a coral that loses chroma as it nears white.',
        draw: (L) => [
          stack(L, [{ start: 0, end: 1000, every: 50 }], '#71717A'),
          stack(L, [{ start: 0, end: 1000, every: 50 }], '#F26E69'),
        ],
      },
    ],
  },
  {
    id: 'home',
    title: 'Home · new subtitles',
    intro:
      'Palette now reads <b>extract colours from an image</b>, as you asked, and here are four lines for Scale. I also fixed the cards’ width: today they’re drawn four columns wider than the space they get, so the right edge of the panel is cut off and shows a column of <b>…</b> (that’s what you saw on the right of your screenshot). The same fault cuts off the ramp’s 950 step on the scale screen. Here both fit inside the margins.',
    figs: SUBS.map((s) => ({
      id: s.id,
      name: `“${s.sub}”`,
      pick: s.pick,
      note: s.note,
      draw: (L: Look) => [
        home(L, 0, ['extract colours from an image', s.sub]),
        home(L, 1, ['extract colours from an image', s.sub]),
      ],
    })),
  },
]

const page = `<!doctype html><html><head><meta charset="utf-8"><title>Forge · Scale steps</title>
<style>
  :root { --page:#0d0e11; --ink:#e2e4ea; --muted:#8f94a1; --rule:#23252c; --cyan:#55c7d9; --mono:"SF Mono", ui-monospace, Menlo, monospace; --sans:-apple-system, BlinkMacSystemFont, "Helvetica Neue", sans-serif; }
  * { box-sizing:border-box; }
  body { margin:0; background:var(--page); color:var(--ink); font:16px/1.6 var(--sans); }
  main { max-width:2300px; margin:0 auto; padding:44px 24px 120px; }
  h1 { font-size:32px; margin:0 0 8px; }
  .lede { color:var(--muted); max-width:900px; margin:0; }
  .tabs { position:sticky; top:0; z-index:5; display:flex; flex-wrap:wrap; gap:6px; margin:22px -24px 0; padding:12px 24px; background:rgba(13,14,17,.94); border-bottom:1px solid var(--rule); align-items:center; }
  .tabs a { font:13px var(--mono); color:var(--muted); text-decoration:none; border:1px solid var(--rule); padding:6px 12px; border-radius:8px; cursor:pointer; }
  .tabs a.on { color:#0c1d22; background:var(--cyan); border-color:var(--cyan); font-weight:700; }
  .tabs .sp { flex:1; }
  .tabs label { font:13px var(--mono); color:var(--muted); display:flex; gap:6px; align-items:center; }
  section { display:none; margin-top:30px; } section.on { display:block; }
  .intro { color:#c7cbd4; max-width:1000px; }
  figure { margin:34px 0 0; }
  .vt { display:flex; align-items:baseline; gap:10px; margin-bottom:8px; }
  .vt .id { font:700 12px var(--mono); padding:3px 7px; border-radius:6px; background:#12282e; color:var(--cyan); }
  .vt .name { font-weight:620; }
  .vt .pick { font:600 11px var(--mono); letter-spacing:.08em; color:#6fcf7f; border:1px solid #2c5a37; padding:2px 7px; border-radius:6px; }
  .idea { font-size:14.5px; color:#c7cbd4; margin:8px 0 0; max-width:1000px; }
  .theme { display:flex; flex-wrap:wrap; gap:14px; }
  .theme + .theme { margin-top:14px; }
  body.only-dark .theme.light, body.only-light .theme.dark { display:none; }
  .t { font:13px/1 var(--mono); padding:12px 14px; border-radius:10px; border:1px solid #2c2f37; width:max-content; }
  .r { height:17px; white-space:pre; overflow:hidden; }
  .r > span { display:inline-block; height:17px; line-height:17px; vertical-align:top; }
  .r i { display:inline-block; width:1ch; height:17px; vertical-align:top; }
  i.d { background:linear-gradient(to top left, transparent calc(50% - .7px), currentColor calc(50% - .7px), currentColor calc(50% + .7px), transparent calc(50% + .7px)); }
  i.u { background:linear-gradient(currentColor 50%, transparent 50%); }
  i.l { background:linear-gradient(transparent 50%, currentColor 50%); }
  i.f { background:currentColor; }
  i.h { background:linear-gradient(to right, currentColor 50%, transparent 50%); }
  code { font:.9em var(--mono); background:#1c1e24; padding:1px 5px; border-radius:4px; }
</style></head>
<body class="only-dark"><main>
<h1>Scale · choosing the steps</h1>
<p class="lede">Where a scale starts and ends, and how far apart its steps are, instead of the fixed 50 … 950. Home, the bar, the field and the preview come from the app’s own code at 80 × 24. The ramp is redrawn so it fits any number of steps. Switch dark and light at the right of the tab bar.</p>
<div class="tabs">${TABS.map((t, i) => `<a data-t="${t.id}"${i === 0 ? ' class="on"' : ''}>${t.title}</a>`).join('')}<span class="sp"></span>
<label><input type="radio" name="th" value="only-dark" checked> dark</label><label><input type="radio" name="th" value="only-light"> light</label><label><input type="radio" name="th" value="both"> both</label></div>
${TABS.map((t, i) => `<section id="s-${t.id}"${i === 0 ? ' class="on"' : ''}><p class="intro">${t.intro}</p>${t.figs.map(figure).join('')}</section>`).join('\n')}
</main>
<script>
document.querySelectorAll('.tabs a').forEach((a) => a.onclick = () => {
  document.querySelectorAll('.tabs a').forEach((b) => b.classList.toggle('on', b === a))
  document.querySelectorAll('section').forEach((s) => s.classList.toggle('on', s.id === 's-' + a.dataset.t))
  history.replaceState(null, '', '#' + a.dataset.t)
})
const h = location.hash.slice(1); if (h) document.querySelector('.tabs a[data-t="' + h + '"]')?.click()
document.querySelectorAll('input[name=th]').forEach((r) => r.onchange = () => { document.body.className = r.value })
const th = new URLSearchParams(location.search).get('theme'); if (th) { const v = th === 'both' ? 'both' : 'only-' + th; document.body.className = v; const r = document.querySelector('input[value="' + v + '"]'); if (r) r.checked = true }
</script></body></html>`

void rate
void S_1700
const out = new URL('../mockups/scale-steps-2026-10.html', import.meta.url)
writeFileSync(out, page)
console.log('wrote', decodeURIComponent(out.pathname), page.length)
