/**
 * Neutrals and alpha (2026-10-13): from any colour, a grey scale tinted with
 * its hue, and the scale as see-through colours that look the same over white
 * (or black). Where they live on the scale screen, and how a terminal shows
 * something see-through.
 *
 * The header (bar and field) and the rule over the keys are cells captured
 * from the real app at 80 × 24 (a throwaway test wrote
 * /tmp/forge-na/frames-{dark,light}.json); the ramp, the steps line and the
 * preview come from the app's own art functions wherever the app already
 * draws them. `neutralOf` and `alphaOf` are drafts of the new maths.
 *
 *   npx tsx scripts/neutral-alpha-mockup.ts   → mockups/neutral-alpha-2026-10.html
 */
import { readFileSync, writeFileSync } from 'node:fs'
import stringWidth from 'string-width'
import { card } from '../src/core/colour/card.js'
import { onWhiteAndBlack, rate } from '../src/core/colour/contrast.js'
import { DEFAULT_STEPS, type StepSpec, scale, stepsOf } from '../src/core/colour/scale.js'
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
import { previewRows, rampRows, stepsLine, withKey } from '../src/shell/colour/colour-art.js'
import { blank, type Row, type Run, width } from '../src/shell/home-art.js'
import { DARK, LIGHT, modePalette, type Palette } from '../src/shell/theme.js'

const N = 80
/** The content's width inside the shell's two-column margins. */
const CONTENT = 76

/* -------------------------------------------------------- captured cells */

interface Cell {
  ch: string
  fg: string | null
  bg: string | null
  b: boolean
}
const frames = (name: string) =>
  JSON.parse(readFileSync(`/tmp/forge-na/frames-${name}.json`, 'utf8')) as Record<string, Cell[][]>
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
  scale: Row[]
}
function lookOf(base: Palette): Look {
  const name = base.name === 'light' ? 'light' : 'dark'
  return {
    p: modePalette(base, 'colour'),
    name,
    scale: (CAPTURED[name].scale as Cell[][]).map(rowOf),
  }
}

/* ------------------------------------------------------------ the maths */

/**
 * Today's scale with one change: no colour is treated as grey, so zinc and
 * stone keep their tint on every step. (Today anything under chroma 0.015
 * loses it everywhere but the 500.) A step can never be more tinted than
 * the colour it comes from, so a nearly grey colour gives a nearly grey
 * scale; nothing is amplified.
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
function along(knots: [number, number][], s: number): number {
  for (let i = 1; i < knots.length; i++) {
    const [a, fa] = knots[i - 1] as [number, number]
    const [b, fb] = knots[i] as [number, number]
    if (s <= b) return fa + ((fb - fa) * (s - a)) / (b - a)
  }
  return (knots[knots.length - 1] as [number, number])[1]
}
function stepAt(ref: Rgb, place: number): Rgb {
  if (place === 500) return ref
  const { L: L0, C: C0, h } = toLch(rgbToOklab(ref))
  const top = Math.max(0.975, L0)
  const floor = L0 < 0.16 ? 0.42 * L0 : Math.max(0.16, 0.42 * L0)
  let L: number
  let C: number
  if (place >= 50 && place < 500) {
    const f = along(UP, place)
    L = L0 + (top - L0) * f
    C = C0 * (1 - 0.88 * f)
  } else if (place < 50) {
    const t = (50 - place) / 50
    L = top + (Math.max(0.995, top) - top) * t
    C = C0 * 0.12 * (1 - t)
  } else if (place <= 950) {
    const g = along(DOWN, place)
    L = L0 - (L0 - floor) * g
    C = C0 * (1 - 0.45 * g)
  } else {
    const t = (place - 950) / 50
    L = floor * (1 - 0.35 * t)
    C = C0 * 0.55 * (1 - 0.4 * t)
  }
  while (C > 0 && !inGamut(fromLch({ L, C, h }))) C -= 0.002
  return oklabToRgb(fromLch({ L, C: Math.max(0, C), h }))
}

interface Step {
  step: number
  rgb: Rgb
  hex: string
  reference: boolean
}
const placesOf = (spec: StepSpec) => stepsOf(spec)
function scaleFree(ref: Rgb, spec: StepSpec = DEFAULT_STEPS): Step[] {
  return placesOf(spec).map((s) => {
    const rgb = stepAt(ref, s)
    return { step: s, rgb, hex: toHex(rgb), reference: s === 500 }
  })
}
// The draft must leave every colour scale as it is today, greys aside.
for (const hex of ['#6579FD', '#F26E69', '#343F96', '#ACE02C', '#64748B']) {
  const today = scale(parseHex(hex) as Rgb).map((s) => s.hex)
  const drafted = scaleFree(parseHex(hex) as Rgb).map((s) => s.hex)
  if (today.join() !== drafted.join()) throw new Error(`draft differs for ${hex}`)
}

/** How tinted a neutral is: its chroma at 500, after Tailwind's own greys. */
type Tint = 'none' | 'faint' | 'soft' | 'strong'
const TINTS: Record<Tint, { C: number; like: string }> = {
  none: { C: 0, like: 'neutral' },
  faint: { C: 0.012, like: 'zinc, stone' },
  soft: { C: 0.024, like: 'gray' },
  strong: { C: 0.04, like: 'slate' },
}
/** Every Tailwind grey's 500 sits at OKLCH lightness 0.55; so does a neutral's. */
const NEUTRAL_L = 0.553
function neutralOf(hex: string, tint: Tint, spec: StepSpec = DEFAULT_STEPS): Step[] {
  const { h } = toLch(rgbToOklab(parseHex(hex) as Rgb))
  return scaleFree(oklabToRgb(fromLch({ L: NEUTRAL_L, C: TINTS[tint].C, h })), spec)
}

/**
 * The most see-through colour that looks exactly like `t` over `bg`: each
 * channel pushed as far from the background as it can go, the opacity as
 * low as that allows, rounded up to a byte, then checked. Blended in sRGB,
 * as browsers and Figma blend.
 */
interface Alpha {
  hex8: string
  rgb: Rgb
  a: number
  pct: number
}
function alphaOf(t: Rgb, bg: Rgb): Alpha {
  const T = [t.r, t.g, t.b].map((v) => v / 255)
  const B = [bg.r, bg.g, bg.b].map((v) => v / 255)
  let need = 0
  T.forEach((v, i) => {
    const b = B[i] as number
    const d = v - b
    need = Math.max(need, d > 0 ? d / (1 - b) : d < 0 ? -d / b : 0)
  })
  for (let A = Math.max(1, Math.ceil(need * 255)); ; A++) {
    const a = A / 255
    const C = T.map((v, i) => {
      const b = B[i] as number
      return Math.round(Math.min(1, Math.max(0, (v - (1 - a) * b) / a)) * 255)
    })
    const back = C.map((c, i) => Math.round(a * c + (1 - a) * (B[i] as number) * 255))
    const err = Math.max(...back.map((v, i) => Math.abs(v - (T[i] as number) * 255)))
    if (err <= 1 || A >= 255) {
      const rgb = { r: C[0] as number, g: C[1] as number, b: C[2] as number }
      return {
        rgb,
        a,
        hex8: toHex(rgb) + A.toString(16).padStart(2, '0').toUpperCase(),
        pct: Math.round(a * 100),
      }
    }
  }
}
const WHITE: Rgb = { r: 255, g: 255, b: 255 }
const BLACK: Rgb = { r: 0, g: 0, b: 0 }
const over = (x: Alpha, bg: Rgb): string =>
  toHex({
    r: Math.round(x.a * x.rgb.r + (1 - x.a) * bg.r),
    g: Math.round(x.a * x.rgb.g + (1 - x.a) * bg.g),
    b: Math.round(x.a * x.rgb.b + (1 - x.a) * bg.b),
  })
const hexRgb = (h: string) => parseHex(h) as Rgb

/* ------------------------------------------------------------ helpers */

const lc = (h: string) => h.toLowerCase()
const ink = (text: string, fg: string, bold = false): Run => ({ text, fg: lc(fg), bold })
const fill = (text: string, bg: string): Run => ({ text, bg: lc(bg) })
const pad = (row: Row, n: number): Row => (width(row) < n ? [...row, blank(n - width(row))] : row)
const centre = (row: Row, w: number): Row => {
  const left = Math.max(0, Math.floor((w - width(row)) / 2))
  return pad([blank(left), ...row], w)
}
const cap = (p: Palette, k: string): Run => ({ text: ` ${k} `, fg: p.fg, bg: p.keycapBg, bold: true })

/** The key row as HintBar draws it: caps on the left, the quiet foot at the right. */
function keyRow(p: Palette, main: [string, string][], foot: [string, string][]): Row {
  const row: Row = [blank(3)]
  main.forEach(([k, w], i) => {
    if (i) row.push(blank(2))
    row.push(cap(p, k), ink(` ${w}`, p.dim))
  })
  const f = foot.map(([k, w]) => `${k} ${w}`).join(' · ')
  row.push(blank(Math.max(2, 77 - width(row) - stringWidth(f))), ink(f, p.border))
  return row
}

/** Keys at the far right of a line, as `s steps` sits on the steps line. */
function withKeys(p: Palette, row: Row, pairs: [string, string][], w = CONTENT - 1): Row {
  const tail: Row = []
  pairs.forEach(([k, word], i) => {
    if (i) tail.push(blank(2))
    tail.push(cap(p, k), ink(` ${word}`, p.dim))
  })
  const gap = w - 1 - width(row) - width(tail)
  return gap < 2 ? row : [...row, blank(gap), ...tail]
}

/**
 * A whole screen at 80 × 24: the captured header (with its trail redrawn
 * when it differs), the body from row 6, the captured rule, the keys.
 */
function screen(L: Look, body: Row[], keys: Row, trail?: string[]): Row[] {
  const head = L.scale.slice(0, 6)
  if (trail) {
    head[1] = [
      blank(0),
      ...trailBarRow({
        width: N,
        palette: L.p,
        mode: 'colour',
        trail: { answers: trail.slice(0, -1), current: trail[trail.length - 1] },
        slanted: false,
      }),
    ]
  }
  const rows = body.map((r) => (r.length ? [blank(2), ...r] : r))
  while (rows.length < 16) rows.push([])
  return [...head, ...rows.slice(0, 16), L.scale[22] as Row, keys]
}

/* ------------------------------------------------------------ the parts */

/** The app's cell at 80 columns for eleven steps: (72 − 10 gaps) / 11. */
const CELL = 5

const HEX = '#6579FD'
const REF = hexRgb(HEX)
const COLOUR = scaleFree(REF)
const MID = 5

const restKeys = (L: Look, foot: [string, string][]) =>
  keyRow(
    L.p,
    [
      ['←→', 'choose'],
      ['↵', 'copy'],
      ['c', 'copy all'],
    ],
    foot,
  )

/** The preview, as the app draws it, for a solid step. */
function solidPreview(L: Look, s: Step): Row[] {
  return previewRows({
    palette: L.p,
    step: { ...s, oklch: formatOklch(s.rgb), ...onWhiteAndBlack(s.rgb) },
  })
}

/** A checkerboard in two-column squares, `light` and `dark` alternating. */
function checker(w: number, r: number, c0: number, light: string, dark: string): Row {
  const out: Row = []
  for (let c = 0; c < w; c++) {
    const sq = Math.floor((c0 + c) / 2) + r
    out.push(fill(' ', sq % 2 === 0 ? light : dark))
  }
  return out
}
/** Figma's board: white and a light grey; over black, black and a dark grey. */
const BOARD = { white: ['#ffffff', '#d9d9d9'], black: ['#000000', '#3a3a3a'] } as const
type Over = keyof typeof BOARD

/** An alpha step over each square of the board. */
const boardOf = (x: Alpha, o: Over) =>
  BOARD[o].map((b) => over(x, hexRgb(b))) as [string, string]

/**
 * A1: each cell is the step laid over a checkerboard. Where it is nearly
 * clear the board shows through; where it is nearly solid, it doesn't.
 */
type Pct = 'inside' | 'marker' | 'row'
function alphaRamp(L: Look, xs: Alpha[], labels: number[], sel: number, o: Over, pct?: Pct): Row[] {
  const cell = CELL
  const lead: Row = [blank(2)]
  const labelRow: Row = [...lead]
  labels.forEach((n, i) => {
    if (i) labelRow.push(blank(1))
    labelRow.push(
      ...centre([ink(String(n), i === sel ? L.p.fg : i === MID ? L.p.accent : L.p.border, i === sel)], cell),
    )
  })
  const swatch = (r: number): Row => {
    const row: Row = [...lead]
    xs.forEach((x, i) => {
      if (i) row.push(blank(1))
      const [a, b] = boardOf(x, o)
      const board = checker(cell, r, 0, a, b)
      if (pct === 'inside' && r === 1) {
        // The opacity written on the board, in whichever of white and near-black reads on it.
        const reads = onWhiteAndBlack(hexRgb(a))
        const fg = reads.white >= reads.black ? '#ffffff' : '#111111'
        const text = `${x.pct}%`
        const from = Math.floor((cell - text.length) / 2)
        board.forEach((run, c) => {
          const ch = text[c - from]
          if (ch) run.text = ch
          run.fg = fg
          run.bold = i === sel
        })
      }
      row.push(...board)
    })
    return row
  }
  const words = (pill: boolean): Row => {
    const row: Row = [...lead]
    xs.forEach((x, i) => {
      if (i) row.push(blank(1))
      const t = centre([ink(`${x.pct}%`, i === sel ? L.p.fg : L.p.border, i === sel)], cell)
      row.push(...(pill && i === sel ? t.map((run) => ({ ...run, bg: lc(L.p.fieldBand) })) : t))
    })
    return row
  }
  const mark: Row = [...lead]
  xs.forEach((_, i) => {
    if (i) mark.push(blank(1))
    mark.push(i === sel ? ink('▔'.repeat(cell), L.p.fg) : blank(cell))
  })
  if (pct === 'marker') return [labelRow, swatch(0), swatch(1), swatch(2), words(true)]
  if (pct === 'row') return [labelRow, swatch(0), swatch(1), swatch(2), mark, words(false)]
  return [labelRow, swatch(0), swatch(1), swatch(2), mark]
}

/** A2: the step as it looks over the background, its opacity written inside. */
function alphaRampPct(L: Look, xs: Alpha[], labels: number[], sel: number, o: Over): Row[] {
  const cell = CELL
  const lead: Row = [blank(2)]
  const bg = o === 'white' ? WHITE : BLACK
  const looks = xs.map((x) => over(x, bg))
  const labelRow: Row = [...lead]
  labels.forEach((n, i) => {
    if (i) labelRow.push(blank(1))
    labelRow.push(
      ...centre([ink(String(n), i === sel ? L.p.fg : i === MID ? L.p.accent : L.p.border, i === sel)], cell),
    )
  })
  const swatch = (withPct: boolean): Row => {
    const row: Row = [...lead]
    xs.forEach((x, i) => {
      if (i) row.push(blank(1))
      const hex = looks[i] as string
      const r = onWhiteAndBlack(hexRgb(hex))
      const fg = r.white >= r.black ? '#ffffff' : '#111111'
      const t = withPct ? centre([ink(`${x.pct}%`, fg)], cell) : [blank(cell)]
      row.push(...t.map((run) => ({ ...run, bg: lc(hex) })))
    })
    return row
  }
  const mark: Row = [...lead]
  xs.forEach((_, i) => {
    if (i) mark.push(blank(1))
    mark.push(i === sel ? ink('▔'.repeat(cell), L.p.fg) : blank(cell))
  })
  return [labelRow, swatch(false), swatch(true), swatch(false), mark]
}

const BLOCK = 18
/** The alpha preview: the step over the board, and what it is over white and over black. */
function alphaPreview(L: Look, step: number, x: Alpha, o: Over): Row[] {
  const [a, b] = boardOf(x, o)
  const block = (r: number) => checker(BLOCK, r, 0, a, b)
  const facts: Row[] = [
    [ink(String(step), L.p.fg, true), blank(2), ink(x.hex8, L.p.fg, true)],
    [ink(`${x.pct}% opaque · `, L.p.dim), ink(`rgb(${x.rgb.r} ${x.rgb.g} ${x.rgb.b} / ${x.pct}%)`, L.p.border)],
    [],
    [ink('over white  ', L.p.border), ink(over(x, WHITE), L.p.dim)],
    [ink('over black  ', L.p.border), ink(over(x, BLACK), L.p.dim)],
  ]
  return [0, 1, 2, 3, 4].map((r) => [blank(4), ...block(r), blank(4), ...(facts[r] ?? [])])
}

/** The steps line with what this kind adds, said quietly after the count. */
function line(L: Look, extra?: string, keys: [string, string][] = [['s', 'steps']]): Row {
  const names = stepsOf(DEFAULT_STEPS)
  const row: Row = [
    blank(2),
    ink('Tailwind', L.p.fg, true),
    ink(`  ${names[0]} – ${names[names.length - 1]}`, L.p.dim),
    ink(`  ·  ${names.length} steps`, L.p.border),
    ...(extra ? [ink(`  ·  ${extra}`, L.p.border)] : []),
  ]
  return withKeys(L.p, row, keys)
}

/** The steps line being changed, with this kind's own setting as the last pill. */
function editLine(L: Look, focus: 'set' | 'tint' | 'over', last: { label: string; value: string }): Row {
  const p = L.p
  const pill = (on: boolean, v: string): Run =>
    on
      ? { text: ` ‹ ${v} › `, fg: lc(p.ink), bg: lc(p.thumb), bold: true }
      : { text: ` ${v} `, fg: lc(p.fg), bg: lc(p.fieldBand) }
  const row: Row = [
    blank(2),
    pill(focus === 'set', 'Tailwind'),
    ink('  from ', p.dim),
    pill(false, '50'),
    ink('  to ', p.dim),
    pill(false, '950'),
    ink(`  ${last.label} `, p.dim),
    pill(focus !== 'set', last.value),
  ]
  return withKey(p, row, '↵', 'done', CONTENT - 1)
}
const editKeys = (L: Look) =>
  keyRow(
    L.p,
    [
      ['←→', 'change'],
      ['tab', 'next'],
    ],
    [
      ['esc', 'cancel'],
      ['ctrl-c', 'quit'],
    ],
  )

/* ------------------------------------------------- K1: tabs over the ramp */

type Kind = 'colour' | 'neutral' | 'alpha'
const KINDS: [Kind, string][] = [
  ['colour', 'Colour'],
  ['neutral', 'Neutral'],
  ['alpha', 'Alpha'],
]

/** The tabs as /about draws them (L2): names with room round them, a rule under, heavy under the one on. */
function tabs(L: Look, on: Kind): Row[] {
  const names: Row = [blank(2)]
  const rule: Row = [blank(2)]
  let used = 0
  KINDS.forEach(([k, name]) => {
    const w = name.length + 4
    names.push(ink(`  ${name}  `, k === on ? L.p.fg : L.p.dim, k === on))
    rule.push(ink((k === on ? '━' : '─').repeat(w), k === on ? L.p.accent : L.p.faint))
    used += w
  })
  rule.push(ink('─'.repeat(CONTENT - 4 - used), L.p.faint))
  return [withKeys(L.p, names, [['tab', 'switch']]), rule]
}

const NEUTRAL = neutralOf(HEX, 'soft')
const ALPHA_W = COLOUR.map((s) => alphaOf(s.rgb, WHITE))
const ALPHA_B = COLOUR.map((s) => alphaOf(s.rgb, BLACK))
const LABELS = COLOUR.map((s) => s.step)

function k1(L: Look, kind: Kind, opts: { sel?: number; a2?: boolean; pct?: Pct } = {}): Row[] {
  const sel = opts.sel ?? MID
  const foot: [string, string][] =
    kind === 'colour' ? [['r', 'make centre'], ['#', 'new colour']] : [['#', 'new colour'], ['esc', 'back']]
  let ramp: Row[]
  let ln: Row
  let prev: Row[]
  if (kind === 'colour') {
    ramp = rampRows({ width: CONTENT, palette: L.p, steps: COLOUR, selected: sel })
    ln = stepsLine({ width: CONTENT, palette: L.p, spec: DEFAULT_STEPS })
    prev = solidPreview(L, COLOUR[sel] as Step)
  } else if (kind === 'neutral') {
    ramp = rampRows({ width: CONTENT, palette: L.p, steps: NEUTRAL, selected: sel })
    ln = line(L, 'soft tint')
    prev = solidPreview(L, NEUTRAL[sel] as Step)
  } else {
    ramp = opts.a2
      ? alphaRampPct(L, ALPHA_W, LABELS, sel, 'white')
      : alphaRamp(L, ALPHA_W, LABELS, sel, 'white', opts.pct)
    ln = line(L, 'over white')
    prev = alphaPreview(L, LABELS[sel] as number, ALPHA_W[sel] as Alpha, 'white')
  }
  return screen(L, [[], ...tabs(L, kind), ...ramp, ln, [], ...prev], restKeys(L, foot))
}

/* ------------------------------------ K2: keys on the line, the trail says */

function k2(L: Look, kind: Kind, opts: { sel?: number } = {}): Row[] {
  const sel = opts.sel ?? MID
  if (kind === 'colour') {
    return screen(
      L,
      [
        ...rampRows({ width: CONTENT, palette: L.p, steps: COLOUR, selected: sel }),
        line(L, undefined, [
          ['n', 'neutral'],
          ['a', 'alpha'],
          ['s', 'steps'],
        ]),
        [],
        ...solidPreview(L, COLOUR[sel] as Step),
      ],
      restKeys(L, [
        ['r', 'make centre'],
        ['#', 'new colour'],
      ]),
    )
  }
  if (kind === 'neutral') {
    return screen(
      L,
      [
        ...rampRows({ width: CONTENT, palette: L.p, steps: NEUTRAL, selected: sel }),
        line(L, 'soft tint', [
          ['a', 'alpha'],
          ['s', 'steps'],
        ]),
        [],
        ...solidPreview(L, NEUTRAL[sel] as Step),
      ],
      restKeys(L, [
        ['#', 'new colour'],
        ['esc', 'back'],
      ]),
      ['Scale', 'Neutral'],
    )
  }
  return screen(
    L,
    [
      ...alphaRamp(L, ALPHA_W, LABELS, sel, 'white'),
      line(L, 'over white', [
        ['n', 'neutral'],
        ['s', 'steps'],
      ]),
      [],
      ...alphaPreview(L, LABELS[sel] as number, ALPHA_W[sel] as Alpha, 'white'),
    ],
    restKeys(L, [
      ['#', 'new colour'],
      ['esc', 'back'],
    ]),
    ['Scale', 'Alpha'],
  )
}

/* ------------------------------- K3: the neutral always under the colour */

/**
 * Both ramps at once, two rows each: the colour's, and under it the neutral
 * that goes with it. ↑↓ moves between them; the ▔ marks the chosen cell on
 * whichever is chosen, and the label row names that ramp's step.
 */
function pairRamp(L: Look, top: Step[] | Alpha[], bottom: Step[] | Alpha[], sel: number, row: 0 | 1, alpha: boolean): Row[] {
  const cell = CELL
  const lead = (on: boolean): Row => [on ? ink('▌', L.p.fg) : blank(1), blank(1)]
  const labels: Row = [blank(2)]
  LABELS.forEach((n, i) => {
    if (i) labels.push(blank(1))
    labels.push(...centre([ink(String(n), i === sel ? L.p.fg : i === MID ? L.p.accent : L.p.border, i === sel)], cell))
  })
  const draw = (xs: Step[] | Alpha[], r: number, on: boolean): Row => {
    const out: Row = [...lead(on)]
    xs.forEach((x, i) => {
      if (i) out.push(blank(1))
      if (alpha) {
        const [a, b] = boardOf(x as Alpha, 'white')
        out.push(...checker(cell, r, 0, a, b))
      } else out.push(fill(' '.repeat(cell), (x as Step).hex))
    })
    return out
  }
  const mark = (on: boolean): Row => {
    const out: Row = [blank(2)]
    LABELS.forEach((_, i) => {
      if (i) out.push(blank(1))
      out.push(on && i === sel ? ink('▔'.repeat(cell), L.p.fg) : blank(cell))
    })
    return out
  }
  return [
    labels,
    draw(top, 0, row === 0),
    draw(top, 1, row === 0),
    row === 0 ? mark(true) : [],
    draw(bottom, 0, row === 1),
    draw(bottom, 1, row === 1),
    row === 1 ? mark(true) : [],
  ]
}

function k3(L: Look, row: 0 | 1, alpha = false, sel = MID): Row[] {
  const nAlpha = NEUTRAL.map((s) => alphaOf(s.rgb, WHITE))
  const top = alpha ? ALPHA_W : COLOUR
  const bottom = alpha ? nAlpha : NEUTRAL
  const extra = alpha ? 'over white' : undefined
  const ln = line(L, extra, [
    ['a', alpha ? 'solid' : 'alpha'],
    ['s', 'steps'],
  ])
  const chosen = row === 0 ? (alpha ? null : (COLOUR[sel] as Step)) : alpha ? null : (NEUTRAL[sel] as Step)
  const prev = chosen
    ? solidPreview(L, chosen)
    : alphaPreview(L, LABELS[sel] as number, (row === 0 ? ALPHA_W : nAlpha)[sel] as Alpha, 'white')
  return screen(
    L,
    [...pairRamp(L, top, bottom, sel, row, alpha), ln, [], ...prev],
    keyRow(
      L.p,
      [
        ['←→', 'choose'],
        ['↑↓', row === 0 ? 'neutral' : 'colour'],
        ['↵', 'copy'],
        ['c', 'copy all'],
      ],
      [['#', 'new colour']],
    ),
  )
}

/* ------------------------------------------------------------- render */

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const GLYPH: Record<string, string> = { '╱': 'd', '▀': 'u', '▄': 'l', '█': 'f', '▌': 'h' }

function html(rows: Row[], p: Palette, label: string): string {
  rows.forEach((r, i) => {
    if (width(r) > N) console.warn(`${label}: row ${i} is ${width(r)} wide:`, r.map((x) => x.text).join(''))
  })
  if (rows.length !== 24) console.warn(`${label}: ${rows.length} rows`)
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
  /** Decided by the user. */
  chosen?: boolean
  draw: (L: Look) => Row[][]
}
function figure(f: Fig): string {
  const themes = [DARK, LIGHT]
    .map((base) => {
      const L = lookOf(base)
      return `<div class="theme ${L.name}">${f
        .draw(L)
        .map((fr, i) => html(fr, L.p, `${f.id}/${L.name}/${i}`))
        .join('')}</div>`
    })
    .join('')
  return `<figure${f.chosen === false ? ' class="not"' : ''}><div class="vt"><span class="id">${f.id}</span><span class="name">${f.name}</span>${f.chosen ? '<span class="chosen">✓ CHOSEN</span>' : f.pick ? '<span class="pick">MY PICK</span>' : ''}</div>${themes}<p class="idea">${f.note}</p></figure>`
}

/* ----------------------------------------------------- the maths, shown */

/** A strip of swatches with each hex under it, for the "how" tab. */
function strip(title: string, sub: string, hexes: string[], names: (string | number)[], board?: Over, alphas?: Alpha[]): string {
  const cells = hexes
    .map((h, i) => {
      const a = alphas?.[i]
      const bgCss = board
        ? `background-color:${board === 'white' ? '#fff' : '#000'};background-image:conic-gradient(${BOARD[board][1]} 25%, transparent 0 50%, ${BOARD[board][1]} 0 75%, transparent 0);background-size:16px 16px`
        : ''
      const swatch = a
        ? `<div class="sw" style="${bgCss}"><div style="width:100%;height:100%;border-radius:8px;background:${toHex(a.rgb)};opacity:${a.a}"></div></div>`
        : `<div class="sw" style="background:${h}"></div>`
      return `<div class="c">${swatch}<b>${names[i]}</b><span>${esc(h)}</span></div>`
    })
    .join('')
  return `<div class="strip"><div class="st"><b>${esc(title)}</b> <span>${esc(sub)}</span></div><div class="cells">${cells}</div></div>`
}

function howTab(): string {
  const greys: [string, string][] = [
    ['zinc 500', '#71717A'],
    ['stone 500', '#78716C'],
  ]
  const before = greys
    .map(([n, h]) =>
      strip(`${n} · today`, 'tint dropped from every step but 500', scale(hexRgb(h)).map((s) => s.hex), LABELS),
    )
    .join('')
  const after = greys
    .map(([n, h]) =>
      strip(`${n} · fixed`, 'tint kept, never stronger than the colour’s own', scaleFree(hexRgb(h)).map((s) => s.hex), LABELS),
    )
    .join('')
  const tints = (['none', 'faint', 'soft', 'strong'] as Tint[])
    .map((t) =>
      strip(
        `${HEX} → ${t}`,
        `chroma ${TINTS[t].C} at 500 · like Tailwind’s ${TINTS[t].like}`,
        neutralOf(HEX, t).map((s) => s.hex),
        LABELS,
      ),
    )
    .join('')
  const coral = (['soft'] as Tint[])
    .map((t) => strip(`#F26E69 → ${t}`, 'the same tint, a warm hue', neutralOf('#F26E69', t).map((s) => s.hex), LABELS))
    .join('')
  const tw = strip('Tailwind gray, for comparison', 'its 500 is #6B7280', ['#F9FAFB', '#F3F4F6', '#E5E7EB', '#D1D5DB', '#9CA3AF', '#6B7280', '#4B5563', '#374151', '#1F2937', '#111827', '#030712'], LABELS)
  const aw = strip(
    `${HEX} as alpha over white`,
    'each looks exactly like its solid step when laid over white',
    ALPHA_W.map((a) => a.hex8),
    LABELS.map((n, i) => `${n} · ${(ALPHA_W[i] as Alpha).pct}%`),
    'white',
    ALPHA_W,
  )
  const ab = strip(
    `${HEX} as alpha over black`,
    'over black the light steps cannot be see-through: lighter than black needs the colour itself',
    ALPHA_B.map((a) => a.hex8),
    LABELS.map((n, i) => `${n} · ${(ALPHA_B[i] as Alpha).pct}%`),
    'black',
    ALPHA_B,
  )
  return `<h3>Neutrals</h3><p class="intro">A neutral is a grey scale tinted with the colour’s hue. Its 500 sits at OKLCH lightness 0.55, where every Tailwind grey’s 500 does, not at the colour’s own lightness: a pale yellow would otherwise give a pale grey 500. How much tint is one setting, measured against Tailwind’s greys. <b>Soft</b> on ${HEX} lands on Tailwind gray almost exactly.</p>${tints}${coral}${tw}
<h3>The grey bug, fixed on the way</h3><p class="intro">Today a colour with chroma under 0.015 is treated as pure grey, so zinc and stone lose their tint on every step but 500. Neutrals need that gone. Every other colour’s scale is unchanged (the script checks five).</p>${before}${after}
<h3>Alpha</h3><p class="intro">For each solid step: the most see-through colour that looks exactly like it when laid over white. The colour is pushed as far from white as it can go, so the opacity can be as low as possible; it’s rounded up to a byte, then checked to within 1 on every channel. Radix builds its alpha scales this way. These swatches are real transparency in the browser, over a checkerboard.</p>${aw}${ab}`
}

/* ------------------------------------------------------- the Figma cards */

function alphaCard(title: string, sub: string, xs: Alpha[], names: number[]): string {
  // A draft of the F1 card with a checkerboard under each swatch.
  const sw = 64
  const gap = 10
  const w = 48 + xs.length * sw + (xs.length - 1) * gap
  const h = 84 + sw + 56
  const sq = 8
  const board = `<pattern id="board" width="${sq * 2}" height="${sq * 2}" patternUnits="userSpaceOnUse"><rect width="${sq * 2}" height="${sq * 2}" fill="#FFFFFF"/><rect width="${sq}" height="${sq}" fill="#E5E5E5"/><rect x="${sq}" y="${sq}" width="${sq}" height="${sq}" fill="#E5E5E5"/></pattern>`
  const body = xs
    .map(
      (x, i) =>
        `<g transform="translate(${24 + i * (sw + gap)} 80)"><rect width="${sw}" height="${sw}" rx="10" fill="url(#board)"/><rect width="${sw}" height="${sw}" rx="10" fill="${toHex(x.rgb)}" fill-opacity="${x.a.toFixed(3)}" stroke="#000" stroke-opacity="0.08"/>` +
        `<text x="1" y="${sw + 22}" font-family="Inter" font-size="13" font-weight="600" fill="#111111">${names[i]}</text>` +
        `<text x="1" y="${sw + 40}" font-family="Inter" font-size="11" fill="#71717A">${x.hex8}</text></g>`,
    )
    .join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><defs>${board}</defs><rect width="${w}" height="${h}" fill="#FFFFFF"/><text x="24" y="38" font-family="Inter" font-size="15" font-weight="600" fill="#111111">${title}</text><text x="24" y="58" font-family="Inter" font-size="12" fill="#71717A">${sub}</text>${body}</svg>`
}

function cardsTab(): string {
  const neutral = card(
    'Blue neutral',
    `from ${HEX} · soft tint · 50–950 in OKLCH`,
    NEUTRAL.map((s) => ({ id: `neutral-${s.step}`, name: String(s.step), value: s.hex, hex: s.hex })),
  )
  const alpha = alphaCard('Blue alpha', `from ${HEX} · over white · 50–950`, ALPHA_W, LABELS)
  writeFileSync('/tmp/forge-na/alpha-card.svg', alpha)
  return `<p class="intro">What <code>c</code> copies, pasted into Figma. The neutral is today’s F1 card with the neutral’s steps. The alpha card is new: a checkerboard under each swatch, and the swatch’s fill opacity carries the alpha (an SVG <code>fill-opacity</code>). That Figma keeps it on paste is <b>not checked yet</b>: I’ll test it on your Mac before building, as we did for the first card. The value under each is the 8-digit hex.</p>
<figure><div class="vt"><span class="id">F·N</span><span class="name">Neutral card</span></div><div class="svg">${neutral}</div></figure>
<figure><div class="vt"><span class="id">F·A</span><span class="name">Alpha card</span></div><div class="svg">${alpha}</div></figure>`
}

/* ---------------------------------------------------------- the page */

const TABS: { id: string; title: string; intro: string; body: string }[] = [
  {
    id: 'pct',
    title: '★ Percentages',
    intro:
      'Each step’s opacity, written on its swatch (P1). Shown with 500 chosen, then 100.',
    body: [
      {
        id: 'P1',
        name: 'Written on the board',
        chosen: true,
        note: 'The percentage in the middle row of each swatch, in white or near-black, whichever reads on that step; the chosen one bold. No new rows, and the number sits on the thing it describes. At 21 steps the cells are three wide, so “100%” no longer fits; there the numbers would drop out and only the chosen step’s shows, in the preview.',
        draw: (L: Look) => [k1(L, 'alpha', { pct: 'inside' }), k1(L, 'alpha', { pct: 'inside', sel: 1 })],
      },
      {
        id: 'P2',
        chosen: false,
        name: 'In place of the marker',
        note: 'The row the ▔ marker uses carries every percentage instead, quiet; the chosen one is bright on a grey pill, which also marks it. No new rows, swatches left clean.',
        draw: (L: Look) => [k1(L, 'alpha', { pct: 'marker' }), k1(L, 'alpha', { pct: 'marker', sel: 1 })],
      },
      {
        id: 'P3',
        chosen: false,
        name: 'Its own row under the marker',
        note: 'The ▔ marker stays, the percentages get a row of their own under it. Clearest, but the ramp is a row taller, so the ✓ after a copy sits right above the keys.',
        draw: (L: Look) => [k1(L, 'alpha', { pct: 'row' }), k1(L, 'alpha', { pct: 'row', sel: 1 })],
      },
    ]
      .filter((f) => f.chosen !== false)
      .map(figure)
      .join(''),
  },
  {
    id: 'where',
    title: 'Where they live',
    intro:
      'Colour · Neutral · Alpha as tabs over the ramp (K1), <code>tab</code> switches. The same blue (#6579FD) on each.',
    body: [
      {
        id: 'K1',
        name: 'Tabs over the ramp',
        chosen: true,
        note: 'A row of three tabs between the field and the ramp; <code>tab</code> moves along them. The kind’s own setting (tint, or what it’s over) is said quietly on the steps line and changed with <code>s</code> like the rest. <code>r</code> make centre only on Colour: a neutral’s centre is fixed and an alpha follows its colour. The tabs are /about’s: a rule under them, heavy in the mode’s colour under the one you’re on. Costs the gap under the preview, so a copy’s ✓ sits just above the keys.',
        draw: (L: Look) => [k1(L, 'colour'), k1(L, 'neutral'), k1(L, 'alpha')],
      },
      {
        id: 'K2',
        chosen: false,
        name: 'Keys on the steps line',
        note: 'Nothing new to look at until you ask: <code>n</code> and <code>a</code> sit beside <code>s steps</code>, and the bar says <b>Scale ╱ Neutral</b> or <b>Scale ╱ Alpha</b>; <code>esc</code> goes back to the colour. The screen keeps its layout. The other two are only one key away, but you have to know they exist.',
        draw: (L: Look) => [k2(L, 'colour'), k2(L, 'neutral'), k2(L, 'alpha')],
      },
      {
        id: 'K3',
        chosen: false,
        name: 'The neutral always under the colour',
        note: 'The colour’s ramp and its neutral’s, two rows each, so you always see them as a pair; <code>↑↓</code> picks which one ←→ moves on (the ▌ at the left and the ▔ mark it). <code>a</code> turns both into alpha. <code>c</code> copies both in one card. Swatches are shorter, <code>r</code> make centre no longer fits in the key row at 80 columns, and the steps line sits right on the preview.',
        draw: (L: Look) => [k3(L, 0), k3(L, 1), k3(L, 0, true)],
      },
    ]
      .filter((f) => f.chosen !== false)
      .map(figure)
      .join(''),
  },
  {
    id: 'alpha',
    title: 'Showing alpha',
    intro:
      'Alpha over a checkerboard (A1): the board shows through where a step is nearly clear.',
    body: [
      {
        id: 'A1',
        name: 'Over a checkerboard',
        chosen: true,
        note: 'Each cell is the step laid over a two-column white and grey checkerboard, as Figma shows a see-through fill. Nearly clear steps show the board, nearly solid ones hide it, so you read the opacity at a glance. The preview block does the same, larger.',
        draw: (L: Look) => [k1(L, 'alpha'), k1(L, 'alpha', { sel: 1 })],
      },
      {
        id: 'A2',
        chosen: false,
        name: 'Solid, with the opacity written in',
        note: 'Each cell is what the step looks like over white, which is the solid step exactly, with its opacity printed inside. Calmer, but the ramp looks just like the colour tab’s; only the numbers say it’s alpha.',
        draw: (L: Look) => [k1(L, 'alpha', { a2: true }), k1(L, 'alpha', { a2: true, sel: 1 })],
      },
    ]
      .filter((f) => f.chosen !== false)
      .map(figure)
      .join(''),
  },
  {
    id: 'settings',
    title: 'Their settings',
    intro:
      '<code>s</code> already opens the steps line for changing. A neutral’s tint and an alpha’s background become its last pill, so there’s one place for every setting. Tint: none, faint, soft, strong (chroma 0, 0.012, 0.024, 0.04 at 500: Tailwind’s neutral, zinc, gray and slate). Over: white or black.',
    body: [
      {
        id: 'S·N',
        name: 'Neutral: tint',
        note: 'Tab along to <b>tint</b>, ←→ through none · faint · soft · strong; the ramp changes as you go. ↵ keeps it for the session, as the steps are kept.',
        draw: (L: Look) => [
          screen(
            L,
            [
              [],
              ...tabs(L, 'neutral'),
              ...rampRows({ width: CONTENT, palette: L.p, steps: neutralOf(HEX, 'strong'), selected: MID }),
              editLine(L, 'tint', { label: 'tint', value: 'strong' }),
              [],
              ...solidPreview(L, neutralOf(HEX, 'strong')[MID] as Step),
            ],
            editKeys(L),
          ),
        ],
      },
      {
        id: 'S·A',
        name: 'Alpha: over',
        note: 'Over black, for dark interfaces. The light steps come out solid there, 98–100%: nothing lighter than black can be made by letting black show through. Said in the preview rather than hidden.',
        draw: (L: Look) => [
          screen(
            L,
            [
              [],
              ...tabs(L, 'alpha'),
              ...alphaRamp(L, ALPHA_B, LABELS, 8, 'black'),
              editLine(L, 'over', { label: 'over', value: 'black' }),
              [],
              ...alphaPreview(L, 800, ALPHA_B[8] as Alpha, 'black'),
            ],
            editKeys(L),
          ),
        ],
      },
    ]
      .filter((f) => f.chosen !== false)
      .map(figure)
      .join(''),
  },
  { id: 'how', title: 'How they’re made', intro: '', body: howTab() },
  { id: 'cards', title: 'In Figma', intro: '', body: cardsTab() },
]

const page = `<!doctype html><html><head><meta charset="utf-8"><title>Forge · Neutrals and alpha</title>
<style>
  :root { --page:#0d0e11; --ink:#e2e4ea; --muted:#8f94a1; --rule:#23252c; --cyan:#55c7d9; --mono:"SF Mono", ui-monospace, Menlo, monospace; --sans:-apple-system, BlinkMacSystemFont, "Helvetica Neue", sans-serif; }
  * { box-sizing:border-box; }
  body { margin:0; background:var(--page); color:var(--ink); font:16px/1.6 var(--sans); }
  main { max-width:2300px; margin:0 auto; padding:44px 24px 120px; }
  h1 { font-size:32px; margin:0 0 8px; } h3 { margin:34px 0 4px; }
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
  .vt .chosen { font:700 11px var(--mono); letter-spacing:.08em; color:#0c1d12; background:#6fcf7f; padding:2px 8px; border-radius:6px; }
  figure.not { opacity:.55; }
  .decided { margin:22px 0 0; padding:14px 18px; border:1px solid #2c5a37; background:#0f1a13; border-radius:10px; max-width:1000px; }
  .decided b { color:#6fcf7f; }
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
  .strip { margin:16px 0 0; } .st { font-size:14px; } .st span { color:var(--muted); }
  .cells { display:flex; gap:8px; margin-top:6px; }
  .c { display:flex; flex-direction:column; width:84px; font:11px var(--mono); color:var(--muted); }
  .c b { color:var(--ink); font-weight:600; margin-top:4px; }
  .sw { width:84px; height:56px; border-radius:8px; }
  .svg { background:#2a2b30; padding:24px; border-radius:10px; width:max-content; }
</style></head>
<body class="only-dark"><main>
<h1>Scale · neutrals and alpha</h1>
<p class="lede">From any colour: a grey scale tinted with its hue, and the scale as see-through colours that look the same over white. The header, the ramp, the steps line and the preview are the app’s own code at 80 × 24; the new parts are drafted here. Switch dark and light at the right of the tab bar.</p>
<div class="decided"><b>Decided 2026-10-13.</b> <b>K1</b> tabs over the ramp (Colour · Neutral · Alpha, <code>tab</code> switches) · <b>A1</b> alpha over a checkerboard · <b>P1</b> each step’s opacity written on its swatch. Settings as drawn: a neutral’s tint (none · faint · soft · strong) and an alpha’s background (white · black) are the last pill on the steps line under <code>s</code>. The grey fix goes in with it. Still to check: that Figma keeps the alpha card’s see-through fills on paste.</div>
<div class="tabs">${TABS.map((t, i) => `<a data-t="${t.id}"${i === 0 ? ' class="on"' : ''}>${t.title}</a>`).join('')}<span class="sp"></span>
<label><input type="radio" name="th" value="only-dark" checked> dark</label><label><input type="radio" name="th" value="only-light"> light</label><label><input type="radio" name="th" value="both"> both</label></div>
${TABS.map((t, i) => `<section id="s-${t.id}"${i === 0 ? ' class="on"' : ''}>${t.intro ? `<p class="intro">${t.intro}</p>` : ''}${t.body}</section>`).join('\n')}
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
const out = new URL('../mockups/neutral-alpha-2026-10.html', import.meta.url)
writeFileSync(out, page)
console.log('wrote', decodeURIComponent(out.pathname), page.length)
