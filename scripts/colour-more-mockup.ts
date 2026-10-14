/**
 * Colour, the rest of the list (2026-10-13): scales for a whole palette, a
 * colour-vision check, mixing two colours, and more ways to type a colour.
 * Drawn after neutrals and alpha were decided (K1 · A1 · P1,
 * mockups/neutral-alpha-2026-10.html), to be built together with them.
 *
 * The home, the palette and the empty scale are cells captured from the
 * real app at 80 × 24 (a throwaway test wrote /tmp/forge-na/frames2-*.json
 * and frames-*.json); the bar, the field, the ramp, the steps line and the
 * preview come from the app's own art functions. Colour-vision simulation
 * is Machado et al. (2009) at full severity, in linear sRGB.
 *
 *   npx tsx scripts/colour-more-mockup.ts   → mockups/colour-more-2026-10.html
 */
import { readFileSync, writeFileSync } from 'node:fs'
import stringWidth from 'string-width'
import { contrast, onWhiteAndBlack, rate } from '../src/core/colour/contrast.js'
import { hueName } from '../src/core/colour/names.js'
import { DEFAULT_STEPS, scale, stepsOf } from '../src/core/colour/scale.js'
import {
  formatOklch,
  formatRgb,
  fromLch,
  type Lab,
  oklabToRgb,
  parseHex,
  type Rgb,
  rgbToOklab,
  toHex,
  toLch,
} from '../src/core/colour/space.js'
import { trailBarRow } from '../src/shell/bar-art.js'
import {
  fieldRows,
  previewRows,
  rampRows,
  stepsLine,
  withKey,
} from '../src/shell/colour/colour-art.js'
import { blank, type Row, type Run, width } from '../src/shell/home-art.js'
import { sliderRow } from '../src/shell/quality-art.js'
import { DARK, LIGHT, modePalette, type Palette } from '../src/shell/theme.js'

const N = 80
const CONTENT = 76

/* -------------------------------------------------------- captured cells */

interface Cell {
  ch: string
  fg: string | null
  bg: string | null
  b: boolean
}
type Grid = Cell[][]
const read = (f: string) => JSON.parse(readFileSync(f, 'utf8')) as Record<string, Grid>
const CAPTURED = {
  dark: { ...read('/tmp/forge-na/frames2-dark.json'), ...read('/tmp/forge-na/frames-dark.json') },
  light: {
    ...read('/tmp/forge-na/frames2-light.json'),
    ...read('/tmp/forge-na/frames-light.json'),
  },
}

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
  grids: Record<string, Grid>
}
function lookOf(base: Palette): Look {
  const name = base.name === 'light' ? 'light' : 'dark'
  return { p: modePalette(base, 'colour'), name, grids: CAPTURED[name] }
}
const rowsOf = (g: Grid): Row[] => g.map(rowOf)
/** A captured row without the shell's two-column margin, for a body row. */
const unmargin = (g: Grid, r: number): Row => rowOf((g[r] as Cell[]).slice(2))

/* ------------------------------------------------------------ helpers */

const lc = (h: string) => h.toLowerCase()
const ink = (text: string, fg: string, bold = false): Run => ({ text, fg: lc(fg), bold })
const fill = (text: string, bg: string): Run => ({ text, bg: lc(bg) })
const pad = (row: Row, n: number): Row => (width(row) < n ? [...row, blank(n - width(row))] : row)
const centre = (row: Row, w: number): Row => {
  const left = Math.max(0, Math.floor((w - width(row)) / 2))
  return pad([blank(left), ...row], w)
}
const cap = (p: Palette, k: string): Run => ({
  text: ` ${k} `,
  fg: p.fg,
  bg: p.keycapBg,
  bold: true,
})
const hexRgb = (h: string) => parseHex(h) as Rgb
const readsOn = (hex: string) => {
  const r = onWhiteAndBlack(hexRgb(hex))
  return r.white >= r.black ? '#ffffff' : '#111111'
}

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

function withKeys(p: Palette, row: Row, pairs: [string, string][], w = CONTENT - 1): Row {
  const tail: Row = []
  pairs.forEach(([k, word], i) => {
    if (i) tail.push(blank(2))
    tail.push(cap(p, k), ink(` ${word}`, p.dim))
  })
  const gap = w - 1 - width(row) - width(tail)
  return gap < 2 ? row : [...row, blank(gap), ...tail]
}

/** The field's content: a value, swatches, and something quiet after. */
function value(
  L: Look,
  parts: (string | { swatch: string } | { quiet: string } | { bright: string })[],
): Row {
  const row: Row = []
  parts.forEach((x, i) => {
    if (i) row.push(blank(typeof x === 'object' && 'swatch' in x ? 2 : 3))
    if (typeof x === 'string') row.push(ink(x, L.p.dim))
    else if ('swatch' in x) row.push(fill('    ', x.swatch))
    else if ('bright' in x) row.push(ink(x.bright, L.p.fg))
    else row.push(ink(x.quiet, L.p.border))
  })
  return row
}

/** A whole screen at 80 × 24: bar, field, body from row 6, the rule, the keys. */
function screen(
  L: Look,
  trail: string[],
  field: Row,
  body: Row[],
  keys: Row,
  focus = false,
  /** No blank row between the field and the body: the tabs sit right under the field. */
  tight = false,
): Row[] {
  const bar = trailBarRow({
    width: N,
    palette: L.p,
    mode: 'colour',
    trail: { answers: trail.slice(0, -1), current: trail[trail.length - 1] },
    slanted: false,
  })
  const head = fieldRows({ width: CONTENT, palette: L.p, content: field, focus })
  const rows = [[], ...head, ...(tight ? [] : [[]]), ...body].map((r) =>
    r.length ? [blank(2), ...r] : r,
  )
  while (rows.length < 20) rows.push([])
  const rule = rowsOf(L.grids.scale as Grid)[22] as Row
  return [[], bar, ...rows.slice(0, 20), rule, keys]
}

/* ------------------------------------------------------------ the maths */

/** Linear sRGB in and out; Machado, Oliveira & Fernandes (2009), severity 1. */
const MACHADO = {
  protan: [
    [0.152286, 1.052583, -0.204868],
    [0.114503, 0.786281, 0.099216],
    [-0.003882, -0.048116, 1.051998],
  ],
  deutan: [
    [0.367322, 0.860646, -0.227968],
    [0.280085, 0.672501, 0.047413],
    [-0.01182, 0.04294, 0.968881],
  ],
  tritan: [
    [1.255528, -0.076749, -0.178779],
    [-0.078411, 0.930809, 0.147602],
    [0.004733, 0.691367, 0.3039],
  ],
} as const
type Vision = 'normal' | keyof typeof MACHADO
const VISION_NAME: Record<Vision, string> = {
  normal: 'as you see it',
  protan: 'protanopia',
  deutan: 'deuteranopia',
  tritan: 'tritanopia',
}
const VISION_WHO: Record<Vision, string> = {
  normal: '',
  protan: 'red-blind · 1 in 100 men',
  deutan: 'green-blind · 1 in 17 men',
  tritan: 'blue-blind · very rare',
}
const lin = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
const gam = (v: number) => (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055)
function seen(hex: string, v: Vision): string {
  if (v === 'normal') return hex
  const c = hexRgb(hex)
  const x = [c.r, c.g, c.b].map((n) => lin(n / 255))
  const m = MACHADO[v]
  const y = m.map(
    (row) => row[0] * (x[0] as number) + row[1] * (x[1] as number) + row[2] * (x[2] as number),
  )
  const [r, g, b] = y.map((n) =>
    Math.round(Math.max(0, Math.min(1, gam(Math.max(0, n)))) * 255),
  ) as [number, number, number]
  return toHex({ r, g, b })
}
const dE = (a: string, b: string) => {
  const x = rgbToOklab(hexRgb(a))
  const y = rgbToOklab(hexRgb(b))
  return Math.hypot(x.L - y.L, x.a - y.a, x.b - y.b)
}
/** Under this OKLab distance two colours are hard to tell apart side by side. */
const ALIKE = 0.06
function alikePairs(hexes: string[], v: Vision): [number, number, number][] {
  const out: [number, number, number][] = []
  for (let i = 0; i < hexes.length; i++)
    for (let j = i + 1; j < hexes.length; j++) {
      const d = dE(seen(hexes[i] as string, v), seen(hexes[j] as string, v))
      if (d < ALIKE) out.push([i, j, d])
    }
  return out
}
/** Every colour a screen holds, as that kind of eye would see it. */
const seenGrid = (g: Grid, v: Vision): Grid =>
  g.map((r) =>
    r.map((c) => ({
      ...c,
      fg: c.fg && /^#[0-9a-f]{6}$/i.test(c.fg) ? lc(seen(c.fg, v)) : c.fg,
      bg: c.bg && /^#[0-9a-f]{6}$/i.test(c.bg) ? lc(seen(c.bg, v)) : c.bg,
    })),
  )

/** Two colours mixed, `t` of the way from `a` to `b`, in OKLab or in OKLCH (the short way round). */
function mix(a: string, b: string, t: number, space: 'oklab' | 'oklch'): string {
  const x = rgbToOklab(hexRgb(a))
  const y = rgbToOklab(hexRgb(b))
  if (space === 'oklab') {
    const lab: Lab = {
      L: x.L + (y.L - x.L) * t,
      a: x.a + (y.a - x.a) * t,
      b: x.b + (y.b - x.b) * t,
    }
    return toHex(oklabToRgb(lab))
  }
  const p = toLch(x)
  const q = toLch(y)
  let dh = q.h - p.h
  if (dh > 180) dh -= 360
  if (dh < -180) dh += 360
  const lch = { L: p.L + (q.L - p.L) * t, C: p.C + (q.C - p.C) * t, h: p.h + dh * t }
  let lab = fromLch(lch)
  // Out of gauntlet: give up chroma until it fits, as the scale does.
  for (let C = lch.C; C > 0; C -= 0.002) {
    lab = fromLch({ ...lch, C })
    const rgb = oklabToRgb(lab)
    const back = rgbToOklab(rgb)
    if (Math.hypot(back.L - lab.L, back.a - lab.a, back.b - lab.b) < 0.002) break
  }
  return toHex(oklabToRgb(lab))
}

/* ------------------------------------------------------------ the data */

const PALETTE = ['#AC96EF', '#89B929', '#275F22', '#6678FF', '#B3E72E', '#F9716E', '#5A8E25']
const SHARES = [18, 15, 15, 15, 13, 12, 12]
const LABELS = stepsOf(DEFAULT_STEPS)
const scaleOf = (hex: string) => scale(hexRgb(hex)).map((s) => s.hex)

/** A neutral from the palette's first colour (soft tint), as decided for neutrals. */
function neutralFrom(hex: string): string[] {
  const { h } = toLch(rgbToOklab(hexRgb(hex)))
  const ref = oklabToRgb(fromLch({ L: 0.553, C: 0.024, h }))
  // The grey fix: the tint is kept on every step (scale() today would drop it).
  return scale(ref).map((s, i) => (i === 5 ? toHex(ref) : s.hex))
}
const NEUTRAL = neutralFrom(PALETTE[0] as string)

/** Names for the rows: the colour family, numbered where two share one. */
function namesOf(hexes: string[]): string[] {
  const base = hexes.map((h) => hueName(hexRgb(h)))
  return base.map((n, i) => {
    const same = base.filter((m) => m === n).length
    if (same === 1) return n
    return `${n} ${base.slice(0, i + 1).filter((m) => m === n).length}`
  })
}
const NAMES = namesOf(PALETTE)

/* ------------------------------------------- tab 0: a system from one colour */

/**
 * The common families, each at its Tailwind 500 (v4, OKLCH): where its
 * hue sits and how light it naturally is. Yellow is light, blue is dark;
 * that stays true in every system.
 */
const FAMILY: { name: string; hex: string; role?: string }[] = [
  { name: 'red', hex: '#FB2C36', role: 'danger' },
  { name: 'orange', hex: '#FF6900' },
  { name: 'yellow', hex: '#EFB100', role: 'warning' },
  { name: 'green', hex: '#00C950', role: 'success' },
  { name: 'teal', hex: '#00BBA7' },
  { name: 'blue', hex: '#2B7FFF', role: 'info' },
  { name: 'purple', hex: '#AD46FF' },
  { name: 'pink', hex: '#F6339A' },
]
const lchOf = (h: string) => toLch(rgbToOklab(hexRgb(h)))
/** The most chroma a lightness and hue can have inside sRGB. */
function maxC(L0: number, h: number): number {
  let lo = 0
  let hi = 0.4
  for (let i = 0; i < 30; i++) {
    const m = (lo + hi) / 2
    const lab = fromLch({ L: L0, C: m, h })
    const back = rgbToOklab(oklabToRgb(lab))
    if (Math.hypot(back.L - lab.L, back.a - lab.a, back.b - lab.b) < 0.003) lo = m
    else hi = m
  }
  return lo
}
const hueGap = (a: number, b: number) => ((a - b + 540) % 360) - 180

interface SysRow {
  name: string
  role?: string
  hexes: string[]
  yours: boolean
}
/**
 * A system from one colour. It takes the family nearest its hue, as itself.
 * Every other family keeps its own hue and natural lightness, but moved the
 * way the colour is moved from its family's: as much lighter or darker, as
 * vivid or as muted, and turned half as far round the wheel (at most 10°).
 */
interface Tweak {
  /** −100 to +100: towards black at −100, towards white at +100 (as Photoshop's Lightness). */
  bright: number
  /** −100 to +100: grey at −100, as vivid as sRGB allows at +100. */
  sat: number
  /** −180 to +180: degrees round the wheel, every family together. */
  hue?: number
  /** −100 to +100: each scale drawn in to its 500 at −100, spread twice as far at +100. */
  contrast?: number
}
/** Brightness: towards white above 0, towards black below. */
const lighten = (L: number, k: number) =>
  k >= 0 ? L + (0.98 - L) * (k / 100) : L + (L - 0.05) * (k / 100)
/** Saturation: towards grey below 0, towards the most vivid sRGB allows above. */
const saturate = (C: number, max: number, k: number) =>
  k >= 0 ? C + (Math.max(C, max) - C) * (k / 100) : C * (1 + k / 100)
const isTweaked = (tw: Tweak) => !!(tw.bright || tw.sat || tw.hue || tw.contrast)
/** Your colour with the tweaks on it; untouched when there are none. */
function tweakHex(hex: string, tw: Tweak): string {
  if (!(tw.bright || tw.sat || tw.hue)) return hex
  const c = toLch(rgbToOklab(hexRgb(hex)))
  const L0 = lighten(c.L, tw.bright)
  const h = (c.h + (tw.hue ?? 0) + 360) % 360
  let C = saturate(c.C, maxC(L0, h), tw.sat)
  for (let k = 0; k < 40; k++) {
    const lab = fromLch({ L: L0, C, h })
    const back = rgbToOklab(oklabToRgb(lab))
    if (Math.hypot(back.L - lab.L, back.a - lab.a, back.b - lab.b) < 0.003) break
    C -= 0.005
  }
  return toHex(oklabToRgb(fromLch({ L: L0, C: Math.max(0, C), h })))
}
const NO_TWEAK: Tweak = { bright: 0, sat: 0 }
function systemOf(base: string, tw: Tweak = NO_TWEAK): { rows: SysRow[]; neutral: string[] } {
  const b = lchOf(base)
  const nat = FAMILY.map((f) => lchOf(f.hex))
  let slot = 0
  nat.forEach((n, i) => {
    if (Math.abs(hueGap(b.h, n.h)) < Math.abs(hueGap(b.h, (nat[slot] as typeof n).h))) slot = i
  })
  const home = nat[slot] as (typeof nat)[number]
  const turn = Math.max(-10, Math.min(10, hueGap(b.h, home.h) / 2))
  const vivid = Math.min(1, b.C / maxC(b.L, b.h))
  const rows = FAMILY.map((f, i): SysRow => {
    if (i === slot)
      return { name: f.name, role: f.role, hexes: scaleOf(tweakHex(base, tw)), yours: true }
    const n = nat[i] as (typeof nat)[number]
    const matched =
      b.L >= home.L ? n.L + ((b.L - home.L) * (1 - n.L)) / (1 - home.L) : (n.L * b.L) / home.L
    const L0 = lighten(matched, tw.bright)
    const h = (n.h + turn + (tw.hue ?? 0) + 360) % 360
    const own = n.C / maxC(n.L, n.h)
    const C = Math.min(
      maxC(L0, h),
      saturate(vivid * Math.min(1, own) * maxC(L0, h), maxC(L0, h), tw.sat),
    )
    const hex = toHex(oklabToRgb(fromLch({ L: L0, C, h })))
    return { name: f.name, role: f.role, hexes: scaleOf(hex), yours: false }
  })
  // The neutral moves with the rest: its 500 lighter or darker, its tint stronger or fainter.
  const ref = oklabToRgb(
    fromLch({ L: lighten(0.553, tw.bright), C: Math.max(0, 0.024 * (1 + tw.sat / 100)), h: b.h }),
  )
  const neutral = scale(ref).map((x, i) => (i === 5 ? toHex(ref) : x.hex))
  return { rows, neutral: tw.bright || tw.sat ? neutral : neutralFrom(base) }
}

/** The tabs as /about draws them (L2), with System as the fourth. */
function kindTabs(L: Look, on: number): Row[] {
  const names: Row = [blank(2)]
  const rule: Row = [blank(2)]
  let used = 0
  ;['Colour', 'Neutral', 'Alpha', 'System'].forEach((name, i) => {
    const w = name.length + 4
    names.push(ink(`  ${name}  `, i === on ? L.p.fg : L.p.dim, i === on))
    rule.push(ink((i === on ? '━' : '─').repeat(w), i === on ? L.p.accent : L.p.faint))
    used += w
  })
  rule.push(ink('─'.repeat(CONTENT - 4 - used), L.p.faint))
  return [withKeys(L.p, names, [['tab', 'switch']]), rule]
}

/** The system as a grid: a row per family, your colour's named in the mode colour. */
function sysGrid(
  L: Look,
  sys: { rows: SysRow[]; neutral: string[] },
  sel: { row: number; col: number },
  opts: { roles?: boolean; gap?: boolean; fill?: number } = {},
): Row[] {
  const nameW = opts.roles ? 18 : 10
  const cell = 4
  const lead: Row = [blank(2)]
  const all = [...sys.rows, { name: 'neutral', hexes: sys.neutral, yours: false } as SysRow]
  const labels: Row = [...lead, blank(nameW)]
  LABELS.forEach((n, i) => {
    if (i) labels.push(blank(1))
    const on = i === sel.col
    labels.push(
      ...centre([ink(String(n), on ? L.p.fg : i === 5 ? L.p.accent : L.p.border, on)], cell),
    )
  })
  const line = (r: number, k = 0, tall = 1): Row => {
    const x = all[r] as SysRow
    const on = r === sel.row
    const nameRun = ink(x.name, x.yours ? L.p.accent : on ? L.p.fg : L.p.dim, on || x.yours)
    const role = opts.roles && x.role ? [ink(`  ${x.role}`, L.p.border)] : []
    const named =
      k === 0 ? [...(LOCKED.includes(r) ? [ink('◆ ', L.p.accent)] : []), nameRun, ...role] : []
    const out: Row = [...lead, ...named, blank(nameW - width(named))]

    const wideSel = SEL === 'wide' && on
    x.hexes.forEach((h, i) => {
      const mine = x.yours && i === 5
      const mid = Math.floor((tall - 1) / 2)
      const dot = SEL === 'dot' && on && i === sel.col && k === mid
      if (i) {
        // The chosen cell, wider: half a column into the gap on each side.
        if (wideSel && i === sel.col) out.push(ink('▐', h))
        else if (wideSel && i === sel.col + 1) out.push(ink('▌', x.hexes[sel.col] as string))
        else out.push(gapMark(L, MARK, x.yours, i, h, x.hexes[5] as string, k, mid))
      } else if (wideSel && sel.col === 0) {
        // Leftmost: the bulge goes into the last column of the names.
        out[out.length - 1] = blank(Math.max(0, nameW - width(named) - 1))
        out.push(ink('▐', h))
      }
      out.push(...cellMark(L, MARK, mine, h, dot, k, tall))
    })
    if (wideSel && sel.col === x.hexes.length - 1) out.push(ink('▌', x.hexes[sel.col] as string))
    return out
  }
  const rows: Row[] = [labels]
  // Fewer colours, taller rows: as tall as fit in the room the full set takes.
  const tall = opts.fill ? Math.max(1, Math.min(3, Math.floor(opts.fill / all.length))) : 1
  for (let r = 0; r < all.length; r++) {
    if (r === sys.rows.length && opts.gap) rows.push([])
    for (let k = 0; k < tall; k++) rows.push(line(r, k, tall))
  }
  while (opts.fill && rows.length < opts.fill + 1) rows.push([])
  return rows
}

function sysDetail(
  L: Look,
  sys: { rows: SysRow[]; neutral: string[] },
  sel: { row: number; col: number },
): Row {
  const x =
    sel.row < sys.rows.length
      ? (sys.rows[sel.row] as SysRow)
      : { name: 'neutral', hexes: sys.neutral, yours: false }
  const h = x.hexes[sel.col] as string
  return [
    blank(2),
    ink(`${x.name} ${LABELS[sel.col]}`, L.p.fg, true),
    blank(2),
    ink(h, L.p.fg, true),
    blank(2),
    ink(formatOklch(hexRgb(h)), L.p.dim),
  ]
}

const CHERRY = '#D2042D'
const cherryField = (L: Look) => value(L, [CHERRY, { swatch: CHERRY }])
const signed = (n: number) => (n > 0 ? `+${n}` : n < 0 ? `−${-n}` : '0')
const sysLine = (L: Look, tw: Tweak = NO_TWEAK, keys = true) =>
  withKeys(
    L.p,
    [
      blank(2),
      ink('Tailwind', L.p.fg, true),
      ink('  50 – 950', L.p.dim),
      ...(tw.bright || tw.sat
        ? [
            ink('  ·  brightness ', L.p.border),
            ink(signed(tw.bright), L.p.fg, true),
            ink('  saturation ', L.p.border),
            ink(signed(tw.sat), L.p.fg, true),
          ]
        : [ink('  ·  8 colours and a neutral', L.p.border)]),
    ],
    keys
      ? [
          ['t', 'tweak'],
          ['s', 'steps'],
        ]
      : [],
  )
/** One of the tweaks as the quality screen's slider: grey band, white pill. */
function tweakRow(
  L: Look,
  label: string,
  v: number,
  on: boolean,
  w = 40,
  labelW = 12,
  lead = 2,
  max = 100,
  unit = '',
): Row {
  return [
    blank(lead),
    ...pad([ink(label, on ? L.p.fg : L.p.dim, on)], labelW),
    ...sliderRow({ palette: L.p, value: v, min: -max, max, width: w }).map((r) =>
      r.text.trim() === String(v) ? { ...r, text: ` ${signed(v)}${unit} ` } : r,
    ),
  ]
}

/** S1: the fourth tab of the scale screen; `t` turns its last two lines into the tweaks. */
function _sysTab(
  L: Look,
  sel = { row: 0, col: 5 },
  opts: { tw?: Tweak; editing?: 'bright' | 'sat' } = {},
): Row[] {
  const tw = opts.tw ?? NO_TWEAK
  const sys = systemOf(CHERRY, tw)
  const tweaked = tw.bright !== 0 || tw.sat !== 0
  const tail: Row[] = opts.editing
    ? [
        tweakRow(L, 'brightness', tw.bright, opts.editing === 'bright'),
        [],
        tweakRow(L, 'saturation', tw.sat, opts.editing === 'sat'),
      ]
    : [sysLine(L, tw), [], sysDetail(L, sys, sel)]
  const keys = opts.editing
    ? keyRow(
        L.p,
        [
          ['↑↓', 'choose'],
          ['←→', 'change'],
          ['r', 'reset'],
        ],
        [
          ['↵', 'done'],
          ['esc', 'cancel'],
        ],
      )
    : keyRow(
        L.p,
        [
          ['↑↓←→', 'choose'],
          ['↵', 'copy'],
          ['c', 'copy all'],
        ],
        tweaked
          ? [
              ['r', 'reset'],
              ['#', 'new colour'],
            ]
          : [
              ['#', 'new colour'],
              ['esc', 'back'],
            ],
      )
  return screen(
    L,
    ['Scale'],
    cherryField(L),
    [...kindTabs(L, 3), ...sysGrid(L, sys, opts.editing ? { row: -1, col: -1 } : sel), ...tail],
    keys,
  )
}

/** S2: its own screen, from `g` on the scale; room for the roles. */
function _sysOwn(L: Look, sel = { row: 0, col: 5 }): Row[] {
  const sys = systemOf(CHERRY)
  return screen(
    L,
    ['Scale', 'System'],
    cherryField(L),
    [
      ...sysGrid(L, sys, sel, { roles: true, gap: true }),
      [],
      sysLine(L),
      [],
      sysDetail(L, sys, sel),
    ],
    keyRow(
      L.p,
      [
        ['↑↓←→', 'choose'],
        ['↵', 'copy'],
        ['c', 'copy all'],
      ],
      [
        ['#', 'new colour'],
        ['esc', 'back'],
      ],
    ),
  )
}

/** The same system as HTML swatches, to judge the colours themselves. */
function _sysHtml(title: string, base: string, tw: Tweak = NO_TWEAK): string {
  const sys = systemFor(base, 'full', tw)
  const all = [...sys.rows, { name: 'neutral', hexes: sys.neutral, yours: false } as SysRow]
  const head = `<div class="g-row"><span class="g-name"></span>${LABELS.map((n) => `<span class="g-lab">${n}</span>`).join('')}</div>`
  const rows = all
    .map(
      (r) =>
        `<div class="g-row"><span class="g-name${r.yours ? ' yours' : ''}">${r.name}${r.role ? ` <i>${r.role}</i>` : ''}</span>${r.hexes
          .map(
            (h, i) =>
              `<span class="g-sw${r.yours && i === 5 ? ' ref' : ''}" style="background:${h}" title="${h}"></span>`,
          )
          .join('')}</div>`,
    )
    .join('')
  return `<div class="g"><div class="st"><b>${esc(title)}</b> <span>${base}</span></div>${head}${rows}</div>`
}

function _sysCard(base: string, title: string): string {
  const sys = systemOf(base)
  const rows = [...sys.rows.map((r) => r.hexes), sys.neutral]
  const names = [...sys.rows.map((r) => r.name), 'neutral']
  return gridCard(rows, names, title, `from ${base} · 8 colours and a neutral · 50–950 in OKLCH`)
}

/* ------------------------------------------------ marking your colour's cell */

type Mark = 'name' | 'tri' | 'notch' | 'pointer' | 'under' | 'wide' | 'split'
/** How your colour's cell is marked in the grid; set while a figure draws. */
let MARK: Mark = 'tri'
/** How the chosen cell is shown: a dot on it, or the cell drawn wider. */
let SEL: 'dot' | 'wide' = 'wide'
/** Rows locked against `space` (the generator); set while a figure draws. */
let LOCKED: number[] = []

/** The cell, four wide: the dot if it's chosen, and your colour's mark if it's yours. */
function cellMark(
  L: Look,
  m: Mark,
  mine: boolean,
  h: string,
  dot: boolean,
  k: number,
  tall: number,
): Row {
  const ink2 = lc(readsOn(h))
  const chars = [' ', ' ', ' ', ' ']
  const fgs: (string | undefined)[] = [undefined, undefined, undefined, undefined]
  const bgs: string[] = [lc(h), lc(h), lc(h), lc(h)]
  if (dot) {
    chars[1] = '●'
    fgs[1] = ink2
  }
  if (mine) {
    if ((m === 'tri' || m === 'split') && k === 0) {
      chars[0] = '◤'
      fgs[0] = ink2
    }
    if (m === 'notch' && k === 0) {
      // The top-left corner cut away: the canvas shows through a quarter of the first cell.
      chars[0] = '▟'
      fgs[0] = lc(h)
      bgs[0] = lc(L.p.canvas)
    }
    if (m === 'under' && k === tall - 1) {
      for (let c = 0; c < 4; c++) {
        if (chars[c] === ' ') {
          chars[c] = '▁'
          fgs[c] = ink2
        }
      }
    }
    if (m === 'split' && TWEAKED_FROM) {
      // Tweaked: the cell's left half is the colour as you typed it.
      bgs[0] = lc(TWEAKED_FROM)
      bgs[1] = lc(TWEAKED_FROM)
      if (chars[0] === '◤') fgs[0] = lc(readsOn(TWEAKED_FROM))
      if (chars[1] === '●') fgs[1] = lc(readsOn(TWEAKED_FROM))
    }
  }
  return chars.map((ch, c) => ({ text: ch, fg: fgs[c], bg: bgs[c], bold: false }))
}

/** The gap before cell `i`: a blank, or part of your colour's mark. */
function gapMark(
  L: Look,
  m: Mark,
  yours: boolean,
  i: number,
  h: string,
  h500: string,
  k: number,
  mid: number,
): Run {
  if (!yours) return blank(1)
  if (m === 'pointer' && i === 6 && k === mid) return ink('◂', L.p.fg)
  if (m === 'wide' && i === 5) return ink('▐', h)
  if (m === 'wide' && i === 6) return ink('▌', h500)
  return blank(1)
}
/** The colour as typed, when the palette has been tweaked (for the split mark). */
let TWEAKED_FROM: string | undefined

const _MARKS: { m: Mark; id: string; name: string; note: string }[] = [
  {
    m: 'tri',
    id: 'X1',
    name: 'A triangle in the corner',
    note: '◤ in the top-left corner of the cell, in white or near-black, whichever shows on it. Your idea. Stays put when the dot is on the cell.',
  },
  {
    m: 'notch',
    id: 'X2',
    name: 'A corner cut away',
    note: 'The cell’s top-left corner is missing, so its shape is different from every other cell. No colour of its own, so it never clashes.',
  },
  {
    m: 'pointer',
    id: 'X3',
    name: 'A pointer in the gap',
    note: '◂ just right of the cell, in the text colour. Nothing drawn on the colour itself.',
  },
  {
    m: 'under',
    id: 'X4',
    name: 'A line along the bottom',
    note: 'A thin line inside the cell’s bottom edge. On taller cells (fewer colours) it sits under the dot.',
  },
  {
    m: 'wide',
    id: 'X5',
    name: 'A wider cell',
    note: 'The cell bulges half a column into the gap on each side: the one swatch bigger than the rest.',
  },
  {
    m: 'split',
    id: 'X6',
    name: 'The triangle, and once tweaked, the original beside it',
    note: 'Before any tweak, the triangle. After one, the cell’s left half is the colour as you typed it and the right half what it is now: you see how far the tweaks have taken it.',
  },
  {
    m: 'name',
    id: 'X0',
    name: 'Nothing on the cell',
    note: 'Only the row’s name in the mode colour, and the 500 column’s number in it too: where they cross is yours.',
  },
]

/** Each mark three ways: at rest (dot elsewhere), the dot on it with taller cells, and tweaked. */
function _markFrames(L: Look, m: Mark): Row[][] {
  const before = MARK
  const selBefore = SEL
  SEL = 'dot'
  MARK = m
  const a = modeTab(L, 'full', { sel: { row: 5, col: 7 } })
  const b = modeTab(L, 'opposite', { sel: { row: 0, col: 5 } })
  TWEAKED_FROM = CHERRY
  const c = modeTab(L, 'full', { sel: { row: 5, col: 7 }, tw: { bright: 20, sat: -35 } })
  TWEAKED_FROM = undefined
  MARK = before
  SEL = selBefore
  return [a, b, c]
}

/** X7: the chosen cell wider, your colour's triangle; at rest, on yours, tweaked, and at both edges. */
function _x7Frames(L: Look): Row[][] {
  MARK = 'tri'
  SEL = 'wide'
  return [
    modeTab(L, 'full', { sel: { row: 5, col: 7 } }),
    modeTab(L, 'opposite', { sel: { row: 0, col: 5 } }),
    modeTab(L, 'full', { sel: { row: 5, col: 7 }, tw: { bright: 20, sat: -35 } }),
    modeTab(L, 'full', { sel: { row: 2, col: 0 } }),
    modeTab(L, 'full', { sel: { row: 8, col: 10 } }),
  ]
}

/* ------------------------------------------------------------- the modes */

type Mode = 'full' | 'mono' | 'analogous' | 'opposite' | 'split' | 'triad' | 'pastel'
const MODES: Mode[] = ['full', 'mono', 'analogous', 'opposite', 'split', 'triad', 'pastel']
const MODE_NAME: Record<Mode, string> = {
  full: 'Full set',
  mono: 'Monochromatic',
  analogous: 'Analogous',
  opposite: 'Complementary',
  split: 'Split complementary',
  triad: 'Triadic',
  pastel: 'Pastel',
}
/** Where on the wheel each of a harmony's colours sits, from yours. */
const TURNS: Partial<Record<Mode, number[]>> = {
  analogous: [-30, 0, 30],
  opposite: [0, 180],
  split: [0, 150, 210],
  triad: [0, 120, 240],
}

/**
 * The colours of a mode. A harmony keeps your colour as typed and puts the
 * others round the wheel from it, as light and as vivid as yours (as far as
 * sRGB lets each hue go). Monochrome keeps your hue and softens it. Pastel is
 * the full set made light and soft, your hue included. The tweaks move every
 * row but yours; the neutral always comes last.
 */
/** Contrast: every step but the 500 moved further from it in lightness, or nearer. */
function contrastScale(hexes: string[], k: number): string[] {
  if (!k) return hexes
  const mid = lchOf(hexes[5] as string).L
  return hexes.map((h, i) => {
    if (i === 5) return h
    const c = lchOf(h)
    const L0 = Math.max(0.02, Math.min(0.995, mid + (c.L - mid) * (1 + k / 100)))
    const C = Math.min(c.C, maxC(L0, c.h))
    return toHex(oklabToRgb(fromLch({ L: L0, C, h: c.h })))
  })
}
function systemFor(
  base: string,
  mode: Mode,
  tw: Tweak = NO_TWEAK,
): { rows: SysRow[]; neutral: string[] } {
  const sys = systemForBase(base, mode, tw)
  const k = tw.contrast ?? 0
  return {
    rows: sys.rows.map((r) => ({ ...r, hexes: contrastScale(r.hexes, k) })),
    neutral: contrastScale(sys.neutral, k),
  }
}
function systemForBase(
  base: string,
  mode: Mode,
  tw: Tweak = NO_TWEAK,
): { rows: SysRow[]; neutral: string[] } {
  if (mode === 'full') return systemOf(base, tw)
  const b = lchOf(base)
  const vivid = Math.min(1, b.C / maxC(b.L, b.h))
  const neutral = systemOf(base, tw).neutral
  const make = (L0: number, C0: number, h: number) => {
    const Lt = lighten(L0, tw.bright)
    const C = Math.min(maxC(Lt, h), saturate(C0, maxC(Lt, h), tw.sat))
    return toHex(
      oklabToRgb(fromLch({ L: Lt, C: Math.max(0, C), h: (h + (tw.hue ?? 0) + 360) % 360 })),
    )
  }
  const fam = hueName(hexRgb(base))
  if (mode === 'mono') {
    const soft = make(b.L, b.C * 0.5, b.h)
    const dusty = make(b.L, b.C * 0.22, b.h)
    return {
      rows: [
        { name: fam, hexes: scaleOf(tweakHex(base, tw)), yours: true },
        { name: `${fam} soft`, hexes: scaleOf(soft), yours: false },
        { name: `${fam} dusty`, hexes: scaleOf(dusty), yours: false },
      ],
      neutral,
    }
  }
  if (mode === 'pastel') {
    const full = systemOf(base, NO_TWEAK)
    const rows = full.rows.map((r) => {
      const c = lchOf(r.hexes[5] as string)
      const hex = make(0.86, Math.min(0.1, maxC(0.86, c.h)) * 0.85, c.h)
      return { ...r, hexes: scaleOf(hex) }
    })
    return { rows, neutral }
  }
  const rows = (TURNS[mode] as number[]).map((t): SysRow => {
    if (t === 0) return { name: fam, hexes: scaleOf(tweakHex(base, tw)), yours: true }
    const h = (b.h + t + 360) % 360
    const hex = make(b.L, vivid * maxC(b.L, h), h)
    return { name: hueName(hexRgb(hex)), hexes: scaleOf(hex), yours: false }
  })
  // Your colour first, then round the wheel.
  rows.sort((x, y) => Number(y.yours) - Number(x.yours))
  return { rows, neutral }
}

const countWords = (sys: { rows: SysRow[] }) => `${sys.rows.length} colours and a neutral`
/** The line under the grid: the mode first, what it holds, and the keys. */
function modeLine(L: Look, mode: Mode): Row {
  return withKeys(
    L.p,
    [blank(2), ink(MODE_NAME[mode], L.p.fg, true)],
    [
      ['m', 'mode'],
      ['t', 'tweak'],
      ['s', 'steps'],
    ],
  )
}

/**
 * The Palette screen (its own screen in colour mode): the chosen swatch's
 * line, a gap, the grid, a gap, the mode and its keys.
 */
function modeTab(
  L: Look,
  mode: Mode,
  opts: { sel?: { row: number; col: number }; tw?: Tweak } = {},
): Row[] {
  const tw = opts.tw ?? NO_TWEAK
  const sys = systemFor(CHERRY, mode, tw)
  const sel = opts.sel ?? { row: 0, col: 5 }
  return screen(
    L,
    ['Palette'],
    cherryField(L),
    [
      sysDetail(L, sys, sel),
      [],
      ...gappedGrid(L, sys, sel),
      ...(sel.row === sys.rows.length ? [] : [[]]),
      modeLine(L, mode),
    ],
    keyRow(
      L.p,
      [
        ['↑↓←→', 'choose'],
        ['↵', 'copy'],
        ['c', 'copy all'],
      ],
      isTweaked(tw)
        ? [
            ['r', 'reset'],
            ['#', 'new colour'],
          ]
        : [
            ['#', 'new colour'],
            ['esc', 'back'],
          ],
    ),
  )
}

/**
 * The grid with a gap between rows as well as between columns: each row's
 * swatches fill only the lower half of their first line, so half a line of
 * canvas sits between one row and the next. The chosen cell is wider (half
 * a column into each gap) with a stroke all round it in the text colour:
 * the gap columns are half stroke, half cell; the half line above it and
 * the half line under it are stroke.
 */
function gappedGrid(
  L: Look,
  sys: { rows: SysRow[]; neutral: string[] },
  sel: { row: number; col: number },
  fill = 9,
): Row[] {
  const nameW = 10
  const cell = 4
  const canvas = lc(L.p.canvas)
  const frame = lc(L.p.fg)
  const all = [...sys.rows, { name: 'neutral', hexes: sys.neutral, yours: false } as SysRow]
  const tall = Math.max(1, Math.min(3, Math.floor(fill / all.length)))
  const labels: Row = [blank(2), blank(nameW)]
  LABELS.forEach((n, i) => {
    if (i) labels.push(blank(1))
    const on = i === sel.col
    labels.push(
      ...centre([ink(String(n), on ? L.p.fg : i === 5 ? L.p.accent : L.p.border, on)], cell),
    )
  })
  const C = (ch: string, fg?: string, bg?: string, bold = false): Cel => ({ ch, fg, bg, bold })
  const rows: Row[] = [labels]
  const isSelRow = (r: number) => r === sel.row
  const isBelow = (r: number) => r === sel.row + 1
  /** The gap column before cell `i` on line k of row r. */
  const gap = (r: number, k: number, i: number, hexes: string[]): Cel => {
    if (isSelRow(r) && i === sel.col)
      return k === 0 ? C('▗', lc(hexes[i] as string), frame) : C('▐', lc(hexes[i] as string), frame)
    if (isSelRow(r) && i === sel.col + 1)
      return k === 0
        ? C('▖', lc(hexes[sel.col] as string), frame)
        : C('▌', lc(hexes[sel.col] as string), frame)
    if (isBelow(r) && k === 0 && (i === sel.col || i === sel.col + 1)) return C('▀', frame, canvas)
    return C(' ')
  }
  for (let r = 0; r < all.length; r++) {
    const x = all[r] as SysRow
    for (let k = 0; k < tall; k++) {
      const cells: Cel[] = [C(' '), C(' ')]
      const name = k === 0 ? x.name : ''
      const nameFg = x.yours ? lc(L.p.accent) : isSelRow(r) ? lc(L.p.fg) : lc(L.p.dim)
      for (let c = 0; c < nameW; c++)
        cells.push(C(name[c] ?? ' ', nameFg, undefined, isSelRow(r) || x.yours))
      x.hexes.forEach((h, i) => {
        const g = gap(r, k, i, x.hexes)
        if (i > 0) cells.push(g)
        else if (g.ch !== ' ') cells[cells.length - 1] = g
        const strokeTop =
          k === 0 && ((isSelRow(r) && i === sel.col) || (isBelow(r) && i === sel.col))
        const mine = x.yours && i === 5
        for (let c = 0; c < cell; c++) {
          if (k === 0) {
            // Your colour: a small square in its lower-left corner, the triangle's place.
            if (mine && c === 0 && tall === 1)
              cells.push(C('▖', lc(readsOn(h)), strokeTop ? frame : canvas))
            else cells.push(C('▄', lc(h), strokeTop ? frame : canvas))
          } else if (mine && c === 0 && k === 1) cells.push(C('◤', lc(readsOn(h)), lc(h)))
          else cells.push(C(' ', undefined, lc(h)))
        }
      })
      const end = gap(r, k, x.hexes.length, x.hexes)
      if (end.ch !== ' ') cells.push(end)
      rows.push(rowFrom(cells))
    }
  }
  // The half line under the last row: the stroke's bottom, if the chosen cell is there.
  if (sel.row === all.length - 1) {
    const cells: Cel[] = [C(' '), C(' ')]
    for (let c = 0; c < nameW; c++) cells.push(C(' '))
    LABELS.forEach((_, i) => {
      const edge = i === sel.col || i === sel.col + 1
      if (i > 0) cells.push(edge ? C('▀', frame) : C(' '))
      else if (sel.col === 0) cells[cells.length - 1] = C('▀', frame)
      for (let c = 0; c < cell; c++) cells.push(i === sel.col ? C('▀', frame) : C(' '))
    })
    if (sel.col === LABELS.length - 1) cells.push(C('▀', frame))
    rows.push(rowFrom(cells))
  }
  while (rows.length < fill + 1) rows.push([])
  return rows
}

/** The Palette screen before a colour: the field waiting, the grid as outlines. */
function paletteEmpty(L: Look): Row[] {
  const nameW = 10
  const labels: Row = [blank(2), blank(nameW)]
  LABELS.forEach((n, i) => {
    if (i) labels.push(blank(1))
    labels.push(...centre([ink(String(n), L.p.faint)], 4))
  })
  const outline = (r: number): Row => {
    const row: Row = [blank(2), blank(nameW)]
    LABELS.forEach((_, i) => {
      if (i) row.push(blank(1))
      row.push(r % 2 === 0 ? ink('╌╌╌╌', L.p.faint) : blank(4))
    })
    return row
  }
  return screen(
    L,
    ['Palette'],
    [ink('type a hex code', L.p.border)],
    [[], [], labels, ...[0, 1, 2, 3, 4, 5, 6, 7, 8].map(outline)],
    keyRow(
      L.p,
      [
        ['↵', 'done'],
        ['esc', 'cancel'],
      ],
      [['ctrl-c', 'quit']],
    ),
    true,
  )
}

/**
 * Colour's home with three cards: Extract (today's Palette, renamed),
 * Scale, and the new Palette. Three only fit with each subtitle on two
 * lines; the words of the first two are the ones already chosen.
 */
function homeCards3(L: Look, selected: number): Row[] {
  const rows = rowsOf(L.grids.home as Grid)
  const p = L.p
  const W = CONTENT - 4
  const CARD = Math.floor((W - 6) / 3)
  const full = systemFor(CHERRY, 'full')
  const cards = [
    {
      name: 'Extract',
      sub: ['extract colours', 'from an image'],
      preview: ['#356723', '#77A726', '#AD95E9', '#ACE02C', '#6579FD', '#F26E69'].map((h) =>
        fill('   ', h),
      ),
    },
    {
      name: 'Scale',
      sub: ['create shades', 'from one colour'],
      preview: scaleOf(A).map((h) => fill(' ', h)),
    },
    {
      name: 'Palette',
      sub: ['build a palette', 'from one colour'],
      preview: [...full.rows.map((r) => r.hexes[5] as string), full.neutral[5] as string].map((h) =>
        fill('  ', h),
      ),
    },
  ]
  const on = (bg: string, runs: Row, w: number): Row => {
    const row = runs.map((r) => (r.bg ? r : { ...r, bg: lc(bg) }))
    return width(row) < w ? [...row, fill(' '.repeat(w - width(row)), bg)] : row
  }
  const card = (i: number): Row[] => {
    const c = cards[i] as (typeof cards)[number]
    const me = i === selected
    const bg = me ? p.panelBand : p.selectionBg
    const line = (txt: Row): Row => on(bg, [blank(1), ...txt], CARD)
    return [
      line([]),
      line([ink(c.name, me ? p.fg : p.dim, true)]),
      line([ink(c.sub[0] as string, me ? p.dim : p.border)]),
      line([ink(c.sub[1] as string, me ? p.dim : p.border)]),
      line([]),
      line(c.preview),
      line([]),
    ]
  }
  const cs = [card(0), card(1), card(2)]
  const edge: Row = [blank(4), ...on(p.selectionBg, [], W)]
  const panel = [
    edge,
    ...[0, 1, 2, 3, 4, 5, 6].map((r) => [
      blank(4),
      ...on(
        p.selectionBg,
        [
          blank(1),
          ...(cs[0]?.[r] ?? []),
          blank(2),
          ...(cs[1]?.[r] ?? []),
          blank(2),
          ...(cs[2]?.[r] ?? []),
          blank(1),
        ],
        W,
      ),
    ]),
    edge,
  ]
  for (let r = 0; r < panel.length; r++) rows[9 + r] = panel[r] as Row
  return rows
}

/* ------------------------------------------------- a window over the screen */

interface Cel {
  ch: string
  fg?: string
  bg?: string
  bold?: boolean
}
function cellsOf(row: Row, n = N): Cel[] {
  const out: Cel[] = []
  for (const r of row) for (const ch of r.text) out.push({ ch, fg: r.fg, bg: r.bg, bold: r.bold })
  while (out.length < n) out.push({ ch: ' ' })
  return out.slice(0, n)
}
function rowFrom(cells: Cel[]): Row {
  const out: Run[] = []
  for (const c of cells) {
    const last = out[out.length - 1]
    if (last && last.fg === c.fg && last.bg === c.bg && !!last.bold === !!c.bold) last.text += c.ch
    else out.push({ text: c.ch, fg: c.fg, bg: c.bg, bold: c.bold })
  }
  return out
}

/**
 * A framed window drawn over the screen, which fades behind it so the
 * window is plainly on top. Rounded corners in the border grey, filled with
 * the field's grey, the title in the top edge. `scroll` draws a bar in the
 * right edge: where the window is in a list longer than it.
 */
function windowOver(
  L: Look,
  under: Row[],
  win: {
    title: string
    lines: Row[]
    width: number
    top: number
    scroll?: { at: number; of: number }
    /** Where the window's left edge is; centred without it. */
    left?: number
    /** Fade the screen behind (true), or leave it as it is, live. */
    fade?: boolean
  },
): Row[] {
  const p = L.p
  const canvas = lc(p.canvas)
  const fade = (h?: string) => (h && /^#[0-9a-f]{6}$/i.test(h) ? mix(lc(h), canvas, 0.7) : h)
  const faded = win.fade ?? true
  const grid = under.map((r, i) =>
    !faded || i === 0 || i >= 22
      ? cellsOf(r)
      : cellsOf(r).map((c) => ({ ...c, fg: fade(c.fg), bg: fade(c.bg), bold: false })),
  )
  const W = win.width
  const left = win.left ?? Math.floor((N - W) / 2)
  const fillBg = lc(p.selectionBg)
  const edge = lc(p.border)
  const inner = W - 2
  const h = win.lines.length
  const bar = (k: number): string => {
    if (!win.scroll) return '│'
    const thumb = Math.max(1, Math.round((h * h) / win.scroll.of))
    const start = Math.round(((h - thumb) * win.scroll.at) / Math.max(1, win.scroll.of - h))
    return k >= start && k < start + thumb ? '┃' : '│'
  }
  const title = ` ${win.title} `
  const top: Cel[] = [
    { ch: '╭', fg: edge, bg: fillBg },
    { ch: '─', fg: edge, bg: fillBg },
    ...[...title].map((ch) => ({ ch, fg: lc(p.fg), bg: fillBg, bold: true })),
    ...Array.from({ length: inner - 1 - title.length }, () => ({ ch: '─', fg: edge, bg: fillBg })),
    { ch: '╮', fg: edge, bg: fillBg },
  ]
  const bottom: Cel[] = [
    { ch: '╰', fg: edge, bg: fillBg },
    ...Array.from({ length: inner }, () => ({ ch: '─', fg: edge, bg: fillBg })),
    { ch: '╯', fg: edge, bg: fillBg },
  ]
  const body = win.lines.map((line, k): Cel[] => [
    { ch: '│', fg: edge, bg: fillBg },
    ...cellsOf(line, inner).map((c) => ({ ...c, bg: c.bg ?? fillBg })),
    { ch: bar(k), fg: win.scroll && bar(k) === '┃' ? lc(p.fg) : edge, bg: fillBg },
  ])
  ;[top, ...body, bottom].forEach((cells, k) => {
    const row = grid[win.top + k] as Cel[]
    cells.forEach((c, j) => {
      row[left + j] = c
    })
  })
  return grid.map(rowFrom)
}

type WinStyle = 'centre' | 'sheet' | 'side' | 'popover'
const TWEAKS: { key: keyof Tweak; label: string }[] = [
  { key: 'bright', label: 'brightness' },
  { key: 'sat', label: 'saturation' },
  { key: 'hue', label: 'hue' },
  { key: 'contrast', label: 'contrast' },
]
const modeKeys = (L: Look, across = false) =>
  keyRow(
    L.p,
    [
      [across ? '←→' : '↑↓', 'choose'],
      ['↵', 'done'],
    ],
    [
      ['esc', 'cancel'],
      ['ctrl-c', 'quit'],
    ],
  )
const tweakKeys = (L: Look) =>
  keyRow(
    L.p,
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

/** A mode's colours as chips: its 500s, then the neutral. */
function chipsOf(mode: Mode, w: number, gap: number, glyph: string, tw: Tweak = NO_TWEAK): Row {
  const sys = systemFor(CHERRY, mode, tw)
  const out: Row = []
  ;[...sys.rows.map((r) => r.hexes[5] as string), sys.neutral[5] as string].forEach((h, i) => {
    if (i && gap) out.push(blank(gap))
    out.push(glyph === ' ' ? fill(' '.repeat(w), h) : ink(glyph.repeat(w), h))
  })
  return out
}
/** A list row: the one in hand on the band, with a › in the mode colour. */
function listRow(
  L: Look,
  name: string,
  on: boolean,
  inner: number,
  nameW: number,
  chips: Row,
): Row {
  const band = on ? lc(L.p.panelBand) : undefined
  const row: Row = [
    { text: on ? ' › ' : '   ', fg: lc(L.p.accent), bold: true, bg: band },
    { ...ink(name, on ? L.p.fg : L.p.dim, on), bg: band },
  ]
  row.push(
    { text: ' '.repeat(Math.max(1, nameW + 3 - width(row))), bg: band },
    ...chips.map((c) => ({ ...c, bg: band })),
  )
  row.push({ text: ' '.repeat(Math.max(0, inner - width(row))), bg: band })
  return row
}

/** The Mode window, in one of four styles. */
function modeWin(
  L: Look,
  style: WinStyle,
  current: Mode,
  opts: { visible?: number; first?: number } = {},
): Row[] {
  const p = L.p
  if (style === 'centre') {
    // W1: centred over the faded screen; each mode with its colours, as chips.
    const W = 56
    const visible = opts.visible ?? MODES.length
    const first = opts.first ?? 0
    const shown = MODES.slice(first, first + visible)
    const lines: Row[] = [
      [],
      ...shown.map((m) =>
        listRow(L, MODE_NAME[m], m === current, W - 2, 21, chipsOf(m, 2, 1, '▄')),
      ),
    ]
    const more = MODES.length - (first + shown.length)
    lines.push(more > 0 ? [blank(3), ink(`↓ ${more} more`, p.border)] : [])
    return withKeysRow(
      L,
      windowOver(L, modeTab(L, current), {
        title: 'Mode',
        lines,
        width: W,
        top: 21 - lines.length - 1,
        scroll: visible < MODES.length ? { at: first, of: MODES.length } : undefined,
      }),
      modeKeys(L),
    )
  }
  if (style === 'sheet') {
    // W2: a strip across the bottom; the modes as pills in two rows; the grid above stays live.
    const pill = (m: Mode): Run =>
      m === current
        ? { text: ` ${MODE_NAME[m]} `, fg: lc(p.ink), bg: lc(p.thumb), bold: true }
        : { text: ` ${MODE_NAME[m]} `, fg: lc(p.fg), bg: lc(p.fieldBand) }
    const rowA: Row = [blank(1)]
    const rowB: Row = [blank(1)]
    MODES.forEach((m, i) => {
      const r = i < 4 ? rowA : rowB
      if (r.length > 1) r.push(blank(2))
      r.push(pill(m))
    })
    const lines: Row[] = [rowA, rowB]
    return withKeysRow(
      L,
      windowOver(L, modeTab(L, current), {
        title: 'Mode',
        lines,
        width: 76,
        left: 2,
        top: 21 - lines.length - 1,
        fade: false,
      }),
      modeKeys(L, true),
    )
  }
  if (style === 'side') {
    // W3: a panel down the right; names and small chips; the grid's left part stays live.
    const W = 34
    const lines: Row[] = [
      [],
      ...MODES.flatMap((m) => [
        listRow(L, MODE_NAME[m], m === current, W - 2, 19, chipsOf(m, 1, 0, '▄')),
      ]),
      [],
    ]
    return withKeysRow(
      L,
      windowOver(L, modeTab(L, current), {
        title: 'Mode',
        lines,
        width: W,
        left: N - W - 2,
        top: 6,
        fade: false,
      }),
      modeKeys(L),
    )
  }
  // W4: a small list opening up from the line, under the m key; names only.
  const W = 26
  const lines: Row[] = MODES.map((m) => listRow(L, MODE_NAME[m], m === current, W - 2, 19, []))
  return withKeysRow(
    L,
    windowOver(L, modeTab(L, current), {
      title: 'Mode',
      lines,
      width: W,
      left: 46,
      top: 21 - lines.length - 2,
      fade: false,
    }),
    modeKeys(L),
  )
}

/** The Tweak window, in one of four styles: brightness, saturation, hue, contrast. */
function tweakWin(L: Look, style: WinStyle, tw: Tweak, on: keyof Tweak): Row[] {
  const p = L.p
  const under = modeTab(L, 'full', { tw })
  const v = (k: keyof Tweak) => (tw[k] as number | undefined) ?? 0
  if (style === 'centre') {
    const W = 56
    const lines: Row[] = [[]]
    TWEAKS.forEach((t, i) => {
      if (i) lines.push([])
      lines.push(
        tweakRow(
          L,
          t.label,
          v(t.key),
          t.key === on,
          36,
          12,
          1,
          t.key === 'hue' ? 180 : 100,
          t.key === 'hue' ? '°' : '',
        ),
      )
    })
    lines.push([], [blank(1), ...pad([], 12), ...chipsOf('full', 3, 1, ' ', tw)], [])
    return withKeysRow(
      L,
      windowOver(L, under, { title: 'Tweak', lines, width: W, top: 21 - lines.length - 1 }),
      tweakKeys(L),
    )
  }
  if (style === 'sheet') {
    const half = (t: (typeof TWEAKS)[number]): Row =>
      tweakRow(L, t.label, v(t.key), t.key === on, 22, 11, 1)
    const pair = (a: number, b: number): Row => {
      const left = half(TWEAKS[a] as (typeof TWEAKS)[number])
      return [
        ...left,
        blank(Math.max(2, 37 - width(left))),
        ...half(TWEAKS[b] as (typeof TWEAKS)[number]),
      ]
    }
    const lines: Row[] = [pair(0, 1), pair(2, 3)]
    return withKeysRow(
      L,
      windowOver(L, under, {
        title: 'Tweak',
        lines,
        width: 76,
        left: 2,
        top: 21 - lines.length - 1,
        fade: false,
      }),
      tweakKeys(L),
    )
  }
  if (style === 'side') {
    const W = 34
    const lines: Row[] = [[]]
    TWEAKS.forEach((t) => {
      lines.push([blank(1), ink(t.label, t.key === on ? p.fg : p.dim, t.key === on)])
      lines.push(tweakRow(L, '', v(t.key), t.key === on, 28, 0, 1))
      lines.push([])
    })
    return withKeysRow(
      L,
      windowOver(L, under, {
        title: 'Tweak',
        lines,
        width: W,
        left: N - W - 2,
        top: 6,
        fade: false,
      }),
      tweakKeys(L),
    )
  }
  const W = 46
  const lines: Row[] = TWEAKS.map((t) => tweakRow(L, t.label, v(t.key), t.key === on, 30, 11, 1))
  return withKeysRow(
    L,
    windowOver(L, under, {
      title: 'Tweak',
      lines,
      width: W,
      left: 30,
      top: 21 - lines.length - 2,
      fade: false,
    }),
    tweakKeys(L),
  )
}

/** The key row is the window's while it's open. */
function withKeysRow(_L: Look, rows: Row[], keys: Row): Row[] {
  rows[23] = keys
  return rows
}

function _modeHtml(base: string, mode: Mode): string {
  const sys = systemFor(base, mode)
  const all = [...sys.rows, { name: 'neutral', hexes: sys.neutral, yours: false } as SysRow]
  const rows = all
    .map(
      (r) =>
        `<div class="g-row"><span class="g-name${r.yours ? ' yours' : ''}">${r.name}</span>${r.hexes
          .map(
            (h, i) =>
              `<span class="g-sw${r.yours && i === 5 ? ' ref' : ''}" style="background:${h}" title="${h}"></span>`,
          )
          .join('')}</div>`,
    )
    .join('')
  return `<div class="g"><div class="st"><b>${MODE_NAME[mode]}</b> <span>${countWords(sys)}</span></div>${rows}</div>`
}

/* --------------------------------------------- tab 1: the whole palette */

/**
 * G1: every colour's scale at once, one row each, the neutral under a gap.
 * The chosen cell carries a dot; its row's name is bright.
 */
function grid(L: Look, opts: { row: number; col: number; tall?: boolean; top?: number }): Row[] {
  const nameW = 9
  const cell = 4
  const lead: Row = [blank(2)]
  const rows = [...PALETTE.map((h) => scaleOf(h)), NEUTRAL]
  const names = [...NAMES, 'neutral']
  const labels: Row = [...lead, blank(nameW)]
  LABELS.forEach((n, i) => {
    if (i) labels.push(blank(1))
    const on = i === opts.col
    labels.push(
      ...centre([ink(String(n), on ? L.p.fg : i === 5 ? L.p.accent : L.p.border, on)], cell),
    )
  })
  const line = (r: number, withDot: boolean, named = true): Row => {
    const hexes = rows[r] as string[]
    const on = r === opts.row
    const out: Row = [
      ...lead,
      ...pad(named ? [ink(names[r] as string, on ? L.p.fg : L.p.dim, on)] : [], nameW),
    ]
    hexes.forEach((h, i) => {
      if (i) out.push(blank(1))
      const dot = withDot && on && i === opts.col
      out.push(dot ? { text: ' ●  ', fg: lc(readsOn(h)), bg: lc(h) } : fill(' '.repeat(cell), h))
    })
    return out
  }
  if (!opts.tall) {
    const body: Row[] = [labels]
    for (let r = 0; r < PALETTE.length; r++) body.push(line(r, true))
    body.push([], line(PALETTE.length, true))
    return body
  }
  // G2: two rows each, so it scrolls.
  const top = opts.top ?? 0
  const body: Row[] = [labels]
  const shown = [0, 1, 2, 3, 4].map((k) => top + k).filter((r) => r < rows.length)
  for (const r of shown) {
    body.push(line(r, true), line(r, false, false))
  }
  const more = rows.length - (top + shown.length)
  body.push(more > 0 ? [blank(2 + nameW), ink(`↓ ${more} more`, L.p.border)] : [])
  return body
}

function _gridScreen(L: Look, row: number, col: number, tall = false): Row[] {
  const hexes = row < PALETTE.length ? scaleOf(PALETTE[row] as string) : NEUTRAL
  const h = hexes[col] as string
  const name = row < PALETTE.length ? (NAMES[row] as string) : 'neutral'
  const detail: Row = [
    blank(2),
    ink(`${name} ${LABELS[col]}`, L.p.fg, true),
    blank(2),
    ink(h, L.p.fg, true),
    blank(2),
    ink(formatOklch(hexRgb(h)), L.p.dim),
  ]
  const line = withKeys(
    L.p,
    [
      blank(2),
      ink('Tailwind', L.p.fg, true),
      ink('  50 – 950', L.p.dim),
      ink('  ·  7 colours and a neutral', L.p.border),
    ],
    [['s', 'steps']],
  )
  const body = tall
    ? [...grid(L, { row, col, tall: true, top: Math.max(0, row - 4) }), line, [], detail]
    : [...grid(L, { row, col }), [], line, [], detail]
  return screen(
    L,
    ['Palette', 'All scales'],
    value(L, ['sonoma.jpg', { quiet: '320×320 · 14.9 KB' }]),
    body,
    keyRow(
      L.p,
      [
        ['↑↓←→', 'choose'],
        ['↵', 'copy'],
        ['c', 'copy all'],
      ],
      [
        ['#', 'new colour'],
        ['esc', 'back'],
      ],
    ),
  )
}

/** The palette screen with the new key in its foot. */
function paletteWithKey(L: Look, foot: [string, string][]): Row[] {
  const rows = rowsOf(L.grids.palette as Grid)
  rows[23] = keyRow(
    L.p,
    [
      ['↑↓', 'choose'],
      ['↵', 'copy'],
      ['c', 'copy all'],
    ],
    foot,
  )
  return rows
}

function gridCard(
  rows: string[][] = [...PALETTE.map((h) => scaleOf(h)), NEUTRAL],
  names: string[] = [...NAMES, 'neutral'],
  title = 'sonoma.jpg',
  sub = '7 colours and a neutral · 50–950 in OKLCH',
): string {
  const sw = 44
  const gap = 6
  const left = 24 + 92
  const w = left + LABELS.length * sw + (LABELS.length - 1) * gap + 24
  const rowH = sw + 10
  const top = 92
  const h = top + rows.length * rowH + 24 + 10
  const head = LABELS.map(
    (n, i) =>
      `<text x="${left + i * (sw + gap) + 1}" y="${top - 10}" font-family="Inter" font-size="11" font-weight="600" fill="#71717A">${n}</text>`,
  ).join('')
  const body = rows
    .map((hexes, r) => {
      const y = top + r * rowH + (r === rows.length - 1 ? 10 : 0)
      return (
        `<text x="24" y="${y + sw / 2 + 4}" font-family="Inter" font-size="13" font-weight="600" fill="#111111">${names[r]}</text>` +
        hexes
          .map(
            (hx, i) =>
              `<rect x="${left + i * (sw + gap)}" y="${y}" width="${sw}" height="${sw}" rx="8" fill="${hx}" stroke="#000" stroke-opacity="0.08"/>`,
          )
          .join('')
      )
    })
    .join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect width="${w}" height="${h}" fill="#FFFFFF"/><text x="24" y="38" font-family="Inter" font-size="15" font-weight="600" fill="#111111">${title}</text><text x="24" y="58" font-family="Inter" font-size="12" fill="#71717A">${sub}</text>${head}${body}</svg>`
}

/* ----------------------------------------------- tab 2: colour vision */

/** V1 on the palette: everything redrawn as that eye sees it, look-alikes marked. */
function _visionPalette(L: Look, v: Vision): Row[] {
  if (v === 'normal')
    return paletteWithKey(L, [
      ['v', 'vision'],
      ['s', 'scale'],
      ['#', 'new colour'],
    ])
  const g = seenGrid(L.grids.palette as Grid, v)
  const rows = rowsOf(g)
  const pairs = alikePairs(PALETTE, v)
  // Each colour that has a look-alike says which, at the end of its row.
  PALETTE.forEach((_, i) => {
    const other = pairs.find(([a, b]) => a === i || b === i)
    if (!other) return
    const j = other[0] === i ? other[1] : other[0]
    const r = 7 + i
    const row = rows[r] as Row
    const cells = g[r] as Cell[]
    // Up to the percentage, then the mark.
    let end = 0
    cells.forEach((c, k) => {
      if (c.ch !== ' ') end = k
    })
    const kept = rowOf(cells.slice(0, end + 1))
    rows[r] = [...kept, blank(2), ink(`≈ ${PALETTE[j]}`, L.p.accent)]
    void row
  })
  const note: Row =
    v === 'normal'
      ? [blank(4), ink('as you see it', L.p.dim)]
      : [
          blank(4),
          ink(VISION_NAME[v], L.p.fg, true),
          ink(`  ${VISION_WHO[v]}`, L.p.dim),
          ...(pairs.length
            ? [
                ink(
                  `  ·  ${pairs.length} pair${pairs.length > 1 ? 's' : ''} look alike`,
                  L.p.accent,
                ),
              ]
            : [ink('  ·  all tell apart', L.p.ok)]),
        ]
  rows[19] = withKey(L.p, note, 'v', v === 'tritan' ? 'normal' : 'next', CONTENT + 2)
  rows[1] = trailBarRow({
    width: N,
    palette: L.p,
    mode: 'colour',
    trail: {
      answers: v === 'normal' ? [] : ['Palette'],
      current: v === 'normal' ? 'Palette' : 'Vision',
    },
    slanted: false,
  })
  rows[23] = keyRow(
    L.p,
    [
      ['↑↓', 'choose'],
      ['↵', 'copy'],
      ['c', 'copy all'],
    ],
    v === 'normal'
      ? [
          ['v', 'vision'],
          ['s', 'scale'],
          ['#', 'new colour'],
        ]
      : [
          ['esc', 'back'],
          ['ctrl-c', 'quit'],
        ],
  )
  return rows
}

/** V2: its own screen, every colour seen four ways, look-alikes marked in their column. */
function _visionTable(L: Look, sel: number): Row[] {
  const kinds: Vision[] = ['normal', 'protan', 'deutan', 'tritan']
  const colW = 14
  const sw = 10
  const lead: Row = [blank(4)]
  const head: Row = [...lead, blank(11)]
  for (const k of kinds)
    head.push(...pad([ink(k === 'normal' ? 'you' : VISION_NAME[k], L.p.dim)], colW))
  const alike = kinds.map((k) => alikePairs(PALETTE, k))
  const rows: Row[] = [head]
  PALETTE.forEach((h, i) => {
    const on = i === sel
    const row: Row = [
      ...lead,
      ...pad([ink(`${i + 1} `, L.p.border), ink(h, on ? L.p.fg : L.p.dim, on)], 11),
    ]
    kinds.forEach((k, c) => {
      const s = seen(h, k)
      const pair = alike[c]?.find(([a, b]) => a === i || b === i)
      const tag = pair ? ink(` ≈${(pair[0] === i ? pair[1] : pair[0]) + 1}`, L.p.accent) : blank(3)
      row.push(fill(' '.repeat(sw), s), tag, blank(colW - sw - 3))
    })
    rows.push(row)
  })
  const counts = kinds
    .slice(1)
    .map((k, c) => `${VISION_NAME[k]} ${alike[c + 1]?.length ?? 0}`)
    .join(' · ')
  const numbered = PALETTE.map((h, i) => `${i + 1} ${h}`)
  void numbered
  return screen(
    L,
    ['Palette', 'Vision'],
    value(L, ['sonoma.jpg', { quiet: '320×320 · 14.9 KB' }]),
    [
      ...rows,
      [],
      [blank(4), ink('pairs that look alike  ', L.p.border), ink(counts, L.p.dim)],
      [blank(4), ink('≈3 means “looks like the 3rd colour” to that eye', L.p.border)],
    ],
    keyRow(
      L.p,
      [
        ['↑↓', 'choose'],
        ['↵', 'copy'],
      ],
      [
        ['esc', 'back'],
        ['ctrl-c', 'quit'],
      ],
    ),
  )
}

/* --------------------------------------------------- tab 3: mix two */

const A = '#6579FD'
const B = '#F26E69'
type Space = 'oklab' | 'oklch'
function mixSteps(a: string, b: string, n: number, sp: Space) {
  return Array.from({ length: n }, (_, i) => {
    const t = i / (n - 1)
    const hex = mix(a, b, t, sp)
    return { step: Math.round(t * 100), hex, rgb: hexRgb(hex), reference: i === 0 || i === n - 1 }
  })
}

function mixLine(L: Look, sp: Space, n: number, edit?: 'space' | 'count'): Row {
  const p = L.p
  if (!edit) {
    return withKeys(
      p,
      [
        blank(2),
        ink(sp === 'oklab' ? 'OKLab' : 'OKLCH', p.fg, true),
        ink(sp === 'oklab' ? '  straight across' : '  round the hue wheel', p.dim),
        ink(`  ·  ${n} steps`, p.border),
      ],
      [['s', 'steps']],
    )
  }
  const pill = (on: boolean, v: string): Run =>
    on
      ? { text: ` ‹ ${v} › `, fg: lc(p.ink), bg: lc(p.thumb), bold: true }
      : { text: ` ${v} `, fg: lc(p.fg), bg: lc(p.fieldBand) }
  return withKey(
    p,
    [
      blank(2),
      pill(edit === 'space', sp === 'oklab' ? 'OKLab' : 'OKLCH'),
      ink('  steps ', p.dim),
      pill(edit === 'count', String(n)),
    ],
    '↵',
    'done',
    CONTENT - 1,
  )
}

function mixPreview(L: Look, s: { step: number; hex: string; rgb: Rgb }): Row[] {
  const rows = previewRows({
    palette: L.p,
    step: { ...s, oklch: formatOklch(s.rgb), ...onWhiteAndBlack(s.rgb) },
  })
  // "50" there is 50% of the way; say so.
  const first = rows[0] as Row
  const at = first.findIndex((r) => r.text === String(s.step) && r.bold)
  if (at >= 0) first[at] = { ...(first[at] as Run), text: `${s.step}%` }
  return rows
}

/** The mix screen, however it was reached. */
function mixScreen(
  L: Look,
  trail: string[],
  opts: { sp?: Space; n?: number; sel?: number; edit?: 'space' | 'count'; b?: string } = {},
): Row[] {
  const sp = opts.sp ?? 'oklab'
  const n = opts.n ?? 9
  const b = opts.b ?? B
  const steps = mixSteps(A, b, n, sp)
  const sel = opts.sel ?? Math.floor(n / 2)
  const field = value(L, [A, { swatch: A }, '→', b, { swatch: b }])
  return screen(
    L,
    trail,
    field,
    [
      ...rampRows({ width: CONTENT, palette: L.p, steps, selected: sel }),
      mixLine(L, sp, n, opts.edit),
      [],
      ...mixPreview(L, steps[sel] as (typeof steps)[number]),
    ],
    opts.edit
      ? keyRow(
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
      : keyRow(
          L.p,
          [
            ['←→', 'choose'],
            ['↵', 'copy'],
            ['c', 'copy all'],
          ],
          [
            ['#', 'new colours'],
            ['esc', 'back'],
          ],
        ),
  )
}

/** The scale field while a second colour is being typed into it (M1). */
function typingSecond(L: Look, typed: string): Row[] {
  const steps = scale(hexRgb(A))
  const field: Row = [
    ink(A, L.p.fg),
    blank(2),
    fill('    ', A),
    blank(3),
    ink('→', L.p.dim),
    blank(3),
    ink(typed, L.p.fg),
    ...(typed ? [] : [ink('type a second colour to mix', L.p.border)]),
  ]
  return screen(
    L,
    ['Scale'],
    field,
    [
      ...rampRows({ width: CONTENT, palette: L.p, steps, selected: 5 }),
      stepsLine({ width: CONTENT, palette: L.p, spec: DEFAULT_STEPS }),
      [],
      ...previewRows({
        palette: L.p,
        step: {
          ...(steps[5] as (typeof steps)[number]),
          oklch: formatOklch(hexRgb(A)),
          ...onWhiteAndBlack(hexRgb(A)),
        },
      }),
    ],
    keyRow(
      L.p,
      [
        ['↵', 'mix'],
        ['esc', 'cancel'],
      ],
      [['ctrl-c', 'quit']],
    ),
    true,
  )
}

/** M3: home with a third card; the subtitles shortened so three fit. */
function _homeThree(L: Look, selected: number): Row[] {
  const rows = rowsOf(L.grids.home as Grid)
  const p = L.p
  const W = CONTENT - 4
  const CARD = Math.floor((W - 6) / 3)
  const cards = [
    {
      name: 'Palette',
      sub: 'colours of an image',
      preview: ['#356723', '#77A726', '#AD95E9', '#ACE02C', '#6579FD', '#F26E69'].map((h) =>
        fill('   ', h),
      ),
    },
    {
      name: 'Scale',
      sub: 'shades of one colour',
      preview: scaleOf(A)
        .map((h) => fill(' ', h))
        .slice(0, 11),
    },
    {
      name: 'Mix',
      sub: 'blend two colours',
      preview: mixSteps(A, B, 9, 'oklab').map((s) => fill('  ', s.hex)),
    },
  ]
  const on = (bg: string, runs: Row, w: number): Row => {
    const row = runs.map((r) => (r.bg ? r : { ...r, bg: lc(bg) }))
    return width(row) < w ? [...row, fill(' '.repeat(w - width(row)), bg)] : row
  }
  const card = (i: number): Row[] => {
    const c = cards[i] as (typeof cards)[number]
    const me = i === selected
    const bg = me ? p.panelBand : p.selectionBg
    const line = (txt: Row): Row => on(bg, [blank(2), ...txt], CARD)
    return [
      line([]),
      line([ink(c.name, me ? p.fg : p.dim, true)]),
      line([ink(c.sub, me ? p.dim : p.border)]),
      line([]),
      line(c.preview),
      line([]),
    ]
  }
  const cs = [card(0), card(1), card(2)]
  const edge: Row = [blank(4), ...on(p.selectionBg, [], W)]
  const panel = [
    edge,
    ...[0, 1, 2, 3, 4, 5].map((r) => [
      blank(4),
      ...on(
        p.selectionBg,
        [
          blank(1),
          ...(cs[0]?.[r] ?? []),
          blank(2),
          ...(cs[1]?.[r] ?? []),
          blank(2),
          ...(cs[2]?.[r] ?? []),
          blank(1),
        ],
        W,
      ),
    ]),
    edge,
  ]
  // The captured home's panel starts at row 9.
  for (let r = 0; r < panel.length; r++) rows[9 + r] = panel[r] as Row
  return rows
}

/* -------------------------------------------- tab 4: typing a colour */

interface Typed {
  typed: string
  hex?: string
  note?: string
  error?: string
}
function typedScreen(L: Look, t: Typed): Row[] {
  // Wrong input: what was typed turns red, and the field says so quietly at its far end.
  const field: Row = t.error
    ? [
        ink(t.typed, L.p.fail),
        blank(CONTENT - 4 - 4 - t.typed.length - t.error.length),
        ink(t.error, L.p.border),
      ]
    : [ink(t.typed, L.p.fg)]
  if (t.hex) field.push(blank(2), fill('    ', t.hex), blank(3), ink(t.hex, L.p.dim))
  if (t.note) field.push(ink(`  ·  ${t.note}`, L.p.border))
  const steps = t.hex ? scale(hexRgb(t.hex)) : undefined
  const _empty = rowsOf(L.grids.scaleEmpty as Grid)
  const body: Row[] = steps
    ? [
        ...rampRows({ width: CONTENT, palette: L.p, steps, selected: 5 }),
        stepsLine({ width: CONTENT, palette: L.p, spec: DEFAULT_STEPS }),
        [],
        ...previewRows({
          palette: L.p,
          step: {
            ...(steps[5] as (typeof steps)[number]),
            oklch: formatOklch(hexRgb(t.hex as string)),
            ...onWhiteAndBlack(hexRgb(t.hex as string)),
          },
        }),
      ]
    : [7, 8, 9, 10, 11].map((r) => unmargin(L.grids.scaleEmpty as Grid, r))
  const s = screen(
    L,
    ['Scale'],
    field,
    body,
    keyRow(
      L.p,
      [
        ['↵', 'done'],
        ['esc', 'cancel'],
      ],
      [['ctrl-c', 'quit']],
    ),
    true,
  )
  return s
}

/** The box empty: its hint says what it takes. */
const TYPE_HINT = 'type a hex, rgb(), hsl(), oklch() or a colour name'
function emptyTyping(L: Look): Row[] {
  return screen(
    L,
    ['Scale'],
    [ink(TYPE_HINT, L.p.border)],
    [7, 8, 9, 10, 11].map((r) => unmargin(L.grids.scaleEmpty as Grid, r)),
    keyRow(
      L.p,
      [
        ['↵', 'done'],
        ['esc', 'cancel'],
      ],
      [['ctrl-c', 'quit']],
    ),
    true,
  )
}

/** C1: an empty field offers the colour on the clipboard; ↵ takes it. */
function _clipboardOffer(L: Look, offer: boolean): Row[] {
  const field: Row = offer
    ? [
        ink('type a colour', L.p.border),
        blank(4),
        ink('↵', L.p.fg, true),
        ink(' use ', L.p.border),
        fill('  ', '#F26E69'),
        ink(' #F26E69', L.p.dim),
        ink(' from the clipboard', L.p.border),
      ]
    : [ink('type a colour', L.p.border)]
  const _empty = rowsOf(L.grids.scaleEmpty as Grid)
  return screen(
    L,
    ['Scale'],
    field,
    [7, 8, 9, 10, 11].map((r) => unmargin(L.grids.scaleEmpty as Grid, r)),
    keyRow(
      L.p,
      [
        ['↵', offer ? 'use it' : 'done'],
        ['esc', 'cancel'],
      ],
      [['ctrl-c', 'quit']],
    ),
    true,
  )
}

function hsl(h: number, sat: number, l: number): string {
  const k = (n: number) => (n + h / 30) % 12
  const a = sat * Math.min(l, 1 - l)
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1))
  return toHex({ r: Math.round(f(0) * 255), g: Math.round(f(8) * 255), b: Math.round(f(4) * 255) })
}
const oklchHex = (L0: number, C: number, h: number) => toHex(oklabToRgb(fromLch({ L: L0, C, h })))
const FORMATS: { title: string; t: Typed; note: string }[] = [
  {
    title: 'oklch()',
    t: { typed: 'oklch(63% 0.196 273)', hex: oklchHex(0.63, 0.196, 273) },
    note: 'What a designer copies out of Figma’s or a browser’s colour picker. The hex it comes to is said beside it.',
  },
  {
    title: 'rgb() and hsl()',
    t: { typed: 'hsl(230 97% 69%)', hex: hsl(230, 0.97, 0.69) },
    note: 'CSS’s own forms, old (commas) and new (spaces), with or without the alpha.',
  },
  {
    title: 'A name',
    t: { typed: 'cherry red', hex: '#F7022A' },
    note: 'Names from two lists: CSS’s 148 (rebeccapurple, crimson) and the xkcd colour survey’s 949 (cherry red, dusty rose, forest green; public domain). Where both have a name, CSS’s wins. Letters typed into the field go to the field, so this only works once the field is open (# or ↵), never as keys on the screen.',
  },
  {
    title: 'Eight-digit hex',
    t: { typed: '#6579FDCC', hex: '#6579FD' },
    note: 'A scale is made from a solid colour, so the alpha is dropped, and said so. The Alpha tab gives it back, for every step.',
  },
  {
    title: 'Something it can’t read',
    t: { typed: 'rgb(300 0 0)', error: 'wrong input' },
    note: 'Said in one line where the ✓ after a copy goes, with a version that would work. The field keeps what was typed.',
  },
]

/* ------------------------------------------------------------- render */

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const GLYPH: Record<string, string> = {
  '╱': 'd',
  '▀': 'u',
  '▄': 'l',
  '█': 'f',
  '▌': 'h',
  '▐': 'rh',
  '▟': 'nt',
  '◤': 'tr',
  '▁': 'e',
  '▗': 'qr',
  '▖': 'ql',
}

function html(rows: Row[], p: Palette, label: string): string {
  rows.forEach((r, i) => {
    if (width(r) > N)
      console.warn(`${label}: row ${i} is ${width(r)} wide:`, r.map((x) => x.text).join(''))
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
  chosen?: boolean
  /** The open questions this screen needs your answer on. */
  ask?: number[]
  /** The question, said under the screen. */
  question?: string
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
  return `<figure><div class="vt"><span class="id">${f.id}</span><span class="name">${f.name}</span>${f.chosen ? '<span class="chosen">✓ CHOSEN</span>' : f.pick ? '<span class="pick">MY PICK</span>' : ''}${f.ask ? f.ask.map((q) => `<a class="ask" href="#q${q}">? ${q}</a>`).join('') : '<span class="done">decided</span>'}</div>${themes}${f.question ? `<p class="askq">${(f.ask ?? []).map((q) => `<span class="ask">? ${q}</span>`).join(' ')} ${f.question}</p>` : ''}<p class="idea">${f.note}</p></figure>`
}

/** Swatch strips for the mix comparison. */
function _strip(title: string, sub: string, hexes: string[], names: (string | number)[]): string {
  const cells = hexes
    .map(
      (h, i) =>
        `<div class="c"><div class="sw" style="background:${h}"></div><b>${names[i]}</b><span>${esc(h)}</span></div>`,
    )
    .join('')
  return `<div class="strip"><div class="st"><b>${esc(title)}</b> <span>${esc(sub)}</span></div><div class="cells">${cells}</div></div>`
}

/* ---------------------------------------------------------- the page */

const _visionCounts = (['protan', 'deutan', 'tritan'] as Vision[])
  .map((v) => {
    const ps = alikePairs(PALETTE, v)
    return `${VISION_NAME[v]}: ${ps.length ? ps.map(([a, b, d]) => `${PALETTE[a]} ≈ ${PALETTE[b]} (${d.toFixed(3)})`).join(', ') : 'none'}`
  })
  .join('<br>')

const _MIX_PAIRS: [string, string][] = [
  [A, B],
  ['#2E7DFF', '#FFC233'],
  ['#14B8A6', '#E11D48'],
]

/* ------------------------------------------- the Coolors tools, folded in */

interface PalOpts {
  base: string
  sys: { rows: SysRow[]; neutral: string[] }
  mode?: Mode
  sel?: { row: number; col: number }
  locked?: number[]
  /** After a `space`: there is something to undo. */
  undo?: boolean
}
/** The Palette screen, any colours: with the generator's keys on the line. */
function _palScreen(L: Look, o: PalOpts): Row[] {
  const sel = o.sel ?? { row: 0, col: 5 }
  LOCKED = o.locked ?? []
  const line = withKeys(
    L.p,
    [blank(2), ink(MODE_NAME[o.mode ?? 'full'], L.p.fg, true)],
    [
      ['space', 'new'],
      ['l', 'lock'],
      ['m', 'mode'],
      ['t', 'tweak'],
      ['s', 'steps'],
    ],
  )
  const rows = screen(
    L,
    ['Palette'],
    value(L, [o.base, { swatch: o.base }]),
    [sysDetail(L, o.sys, sel), [], ...sysGrid(L, o.sys, sel, { fill: 9 }), [], line],
    keyRow(
      L.p,
      [
        ['↑↓←→', 'choose'],
        ['↵', 'copy'],
        ['c', 'copy all'],
      ],
      o.undo
        ? [
            ['z', 'undo'],
            ['e', 'export'],
            ['#', 'new colour'],
          ]
        : [
            ['e', 'export'],
            ['#', 'new colour'],
          ],
    ),
  )
  LOCKED = []
  return rows
}

/** Before a colour: the box waits, and `space` makes one up. */
function _palEmptyGen(L: Look): Row[] {
  const rows = paletteEmpty(L)
  rows[23] = keyRow(
    L.p,
    [
      ['↵', 'done'],
      ['space', 'make one up'],
    ],
    [
      ['esc', 'cancel'],
      ['ctrl-c', 'quit'],
    ],
  )
  return rows
}

const GEN1 = '#3E7CB1'
const GEN2 = '#2A9D8F'
/** `space` with red and yellow locked: they stay, the rest follow the new colour. */
function _lockedSpace(): { rows: SysRow[]; neutral: string[] } {
  const a = systemFor(GEN1, 'full')
  const b = systemFor(GEN2, 'full')
  return {
    rows: b.rows.map((r, i) =>
      i === 0 || i === 2 ? { ...(a.rows[i] as SysRow), yours: false } : r,
    ),
    neutral: b.neutral,
  }
}

/**
 * x: one colour's scale against itself, every step as text (rows) on every
 * step as background (columns), the ratio written in the text colour on the
 * background colour. `tab` moves to the next colour's scale.
 */
function _contrastWin(L: Look, family: number, selRow: number, selCol: number): Row[] {
  const sys = systemFor(CHERRY, 'full')
  const fam = sys.rows[family] as SysRow
  const hexes = fam.hexes
  const W = 70
  const cell = 5
  const head: Row = [blank(6)]
  LABELS.forEach((n, j) => {
    head.push(...centre([ink(String(n), j === selCol ? L.p.fg : L.p.border, j === selCol)], cell))
  })
  const lines: Row[] = [[], head]
  hexes.forEach((fg, i) => {
    const row: Row = [
      blank(1),
      ...pad([ink(String(LABELS[i]), i === selRow ? L.p.fg : L.p.border, i === selRow)], 5),
    ]
    hexes.forEach((bg, j) => {
      const r = Math.floor(contrast(hexRgb(fg), hexRgb(bg)) * 10) / 10
      const txt = i === j ? '·' : r >= 10 ? String(Math.floor(r)) : r.toFixed(1)
      const me = i === selRow && j === selCol
      row.push({
        text: (me ? `‹${txt}›` : ` ${txt}`).padEnd(cell),
        fg: lc(fg),
        bg: lc(bg),
        bold: me,
      })
    })
    lines.push(row)
  })
  const r =
    Math.floor(contrast(hexRgb(hexes[selRow] as string), hexRgb(hexes[selCol] as string)) * 10) / 10
  const rating = rate(r)
  lines.push(
    [],
    [
      blank(1),
      ink(`${fam.name} ${LABELS[selRow]} on ${fam.name} ${LABELS[selCol]}`, L.p.fg, true),
      blank(2),
      ink(r.toFixed(1), L.p.dim),
      blank(1),
      ink(rating, rating === 'AA' || rating === 'AAA' ? L.p.ok : L.p.border),
    ],
  )
  return withKeysRow(
    L,
    windowOver(L, modeTab(L, 'full', { sel: { row: family, col: 5 } }), {
      title: `Contrast · ${fam.name}`,
      lines,
      width: W,
      top: 21 - lines.length - 1,
    }),
    keyRow(
      L.p,
      [
        ['↑↓←→', 'choose'],
        ['tab', 'next colour'],
        ['↵', 'copy pair'],
      ],
      [['esc', 'close']],
    ),
  )
}

const FORMATS_EX: { name: string; file?: string; preview: string[] }[] = [
  { name: 'Figma card', preview: ['<svg … a grid card', '  9 rows × 11 swatches'] },
  {
    name: 'CSS variables',
    preview: [
      '--red-50: #FFF4F3;',
      '--red-100: #FFE1DE;',
      '--red-200: #FFC7C1;',
      '--red-300: #FB9F97;',
      '…',
    ],
  },
  {
    name: 'Tailwind theme',
    preview: ['@theme {', '  --color-red-50: …;', '  --color-red-100: …;', '  …', '}'],
  },
  {
    name: 'JSON',
    preview: ['{ "red": {', '    "50": "#FFF4F3",', '    "100": "#FFE1DE",', '    …'],
  },
  { name: 'Adobe swatches', file: 'palette.ase', preview: [] },
  { name: 'Procreate', file: 'palette.swatches', preview: [] },
  { name: 'GIMP · Krita', file: 'palette.gpl', preview: [] },
]
/** e: the formats down the left, the chosen one's first lines on the right. */
function _exportWin(L: Look, sel: number, under: Row[]): Row[] {
  const W = 62
  const inner = W - 2
  const f = FORMATS_EX[sel] as (typeof FORMATS_EX)[number]
  const right = f.file ? [ink(f.file, L.p.fg, true)] : []
  const lines: Row[] = [[]]
  FORMATS_EX.forEach((x, i) => {
    const on = i === sel
    const band = on ? lc(L.p.panelBand) : undefined
    const left: Row = [
      { text: on ? ' › ' : '   ', fg: lc(L.p.accent), bold: true, bg: band },
      { ...ink(x.name, on ? L.p.fg : L.p.dim, on), bg: band },
    ]
    left.push({ text: ' '.repeat(Math.max(0, 22 - width(left))), bg: band })
    const pv = f.file
      ? i === 0
        ? right
        : []
      : f.preview[i]
        ? [ink(f.preview[i] as string, L.p.border)]
        : []
    const row: Row = [...left, blank(3), ...pv]
    lines.push(pad(row, inner))
  })
  lines.push([])
  return withKeysRow(
    L,
    windowOver(L, under, { title: 'Export', lines, width: W, top: 21 - lines.length - 1 }),
    keyRow(
      L.p,
      [
        ['↑↓', 'choose'],
        ['↵', f.file ? 'save' : 'copy'],
      ],
      [
        ['esc', 'close'],
        ['ctrl-c', 'quit'],
      ],
    ),
  )
}

/** "A on B" in Scale's box: the ramp is B's, the preview is A on the chosen step. */
function _onScreen(L: Look, sel: number): Row[] {
  const fgHex = '#FFFFFF'
  const steps = scale(hexRgb('#6579FD'))
  const s5 = steps[sel] as (typeof steps)[number]
  const r = Math.floor(contrast(hexRgb(fgHex), s5.rgb) * 10) / 10
  const rating = rate(r)
  const BLOCK = 18
  const block = (txt: Row = []): Row => {
    const row = centre(txt, BLOCK)
    return row.map((run) => ({ ...run, bg: lc(s5.hex) }))
  }
  const facts: Row[] = [
    [ink(String(s5.step), L.p.fg, true), blank(2), ink(s5.hex, L.p.fg, true)],
    [ink(formatOklch(s5.rgb), L.p.dim)],
    [],
    [
      ink('#FFFFFF on it  ', L.p.border),
      ink(`${r.toFixed(1)} `, L.p.dim),
      ink(rating, rating === 'AA' || rating === 'AAA' ? L.p.ok : L.p.border),
    ],
    [],
  ]
  const blocks = [
    block(),
    block([ink('Aa', fgHex, true)]),
    block([ink('Aa', fgHex)]),
    block(),
    block(),
  ]
  const preview = blocks.map((b, i) => [blank(4), ...b, blank(4), ...(facts[i] ?? [])])
  return screen(
    L,
    ['Scale'],
    [
      ink('#FFFFFF', L.p.dim),
      blank(2),
      fill('    ', fgHex),
      blank(3),
      ink('on', L.p.dim),
      blank(3),
      ink('#6579FD', L.p.dim),
      blank(2),
      fill('    ', '#6579FD'),
    ],
    [
      ...kindTabs3(L),
      ...rampRows({ width: CONTENT, palette: L.p, steps, selected: sel }),
      withKeys(
        L.p,
        [blank(2), ink('Tailwind', L.p.fg, true), ink('  50 – 950', L.p.dim)],
        [
          ['f', 'nearest that passes'],
          ['s', 'steps'],
        ],
      ),
      [],
      ...preview,
    ],
    keyRow(
      L.p,
      [
        ['←→', 'choose'],
        ['↵', 'copy'],
        ['c', 'copy all'],
      ],
      [
        ['e', 'export'],
        ['#', 'new colour'],
      ],
    ),
  )
}
/** Scale's decided tabs: Colour · Neutral · Alpha. */
function kindTabs3(L: Look): Row[] {
  const names: Row = [blank(2)]
  const rule: Row = [blank(2)]
  let used = 0
  ;['Colour', 'Neutral', 'Alpha'].forEach((name, i) => {
    const w = name.length + 4
    names.push(ink(`  ${name}  `, i === 0 ? L.p.fg : L.p.dim, i === 0))
    rule.push(ink((i === 0 ? '━' : '─').repeat(w), i === 0 ? L.p.accent : L.p.faint))
    used += w
  })
  rule.push(ink('─'.repeat(CONTENT - 4 - used), L.p.faint))
  return [withKeys(L.p, names, [['tab', 'switch']]), rule]
}

/* ---------------------------------------------------------- the page */

/** The Colour tab, with System as the fourth tab, for step 1. */
function _colourTab(L: Look): Row[] {
  const steps = scale(hexRgb(CHERRY))
  const s5 = steps[5] as (typeof steps)[number]
  return screen(
    L,
    ['Scale'],
    cherryField(L),
    [
      ...kindTabs(L, 0),
      ...rampRows({ width: CONTENT, palette: L.p, steps, selected: 5 }),
      stepsLine({ width: CONTENT, palette: L.p, spec: DEFAULT_STEPS }),
      [],
      ...previewRows({
        palette: L.p,
        step: { ...s5, oklch: formatOklch(s5.rgb), ...onWhiteAndBlack(s5.rgb) },
      }),
    ],
    keyRow(
      L.p,
      [
        ['←→', 'choose'],
        ['↵', 'copy'],
        ['c', 'copy all'],
      ],
      [
        ['r', 'make centre'],
        ['#', 'new colour'],
      ],
    ),
    false,
    true,
  )
}

/** After `c`: the line under the grid says what went to the clipboard. */
function _copied(L: Look, mode: Mode, tw: Tweak): Row[] {
  const rows = modeTab(L, mode, { tw })
  const sys = systemFor(CHERRY, mode, tw)
  rows[7] = [
    blank(4),
    ink('✓', L.p.ok, true),
    blank(1),
    ink(`copied ${sys.rows.length + 1} rows of swatches`, L.p.fg),
    ink(' · paste into Figma with ⌘V', L.p.dim),
  ]
  return rows
}

const MODE_SAYS: Record<Mode, string> = {
  full: 'every common colour, matched to yours',
  mono: 'your colour, softer and dustier',
  analogous: 'your neighbours on the colour wheel',
  opposite: 'the colour across the wheel',
  split: 'the two either side of the opposite',
  triad: 'three, evenly round the wheel',
  pastel: 'every common colour, light and soft',
}
/** The modes at a glance: each one's 500s, and the neutral. */
const modesGlance = () =>
  `<div class="glance">${MODES.map((m) => {
    const sys = systemFor(CHERRY, m)
    const chips = [
      ...sys.rows.map((r) => ({ h: r.hexes[5] as string, yours: r.yours })),
      { h: sys.neutral[5] as string, yours: false },
    ]
      .map(
        (c) =>
          `<span class="chip${c.yours ? ' ref' : ''}" style="background:${c.h}" title="${c.h}"></span>`,
      )
      .join('')
    return `<div class="gl-row"><b>${MODE_NAME[m]}</b><span class="gl-says">${MODE_SAYS[m]}</span><span class="gl-chips">${chips}</span></div>`
  }).join('')}</div>`

const _step = (n: number, name: string, note: string, draw: (L: Look) => Row[][]): string =>
  figure({ id: String(n), name, note, draw })

const _fold = (summary: string, body: string) =>
  `<details><summary>${summary}</summary>${body}</details>`

/** A screen with its label (Step 1, Option A…) and a one-line caption. */
const card = (
  label: string,
  caption: string,
  draw: (L: Look) => Row[][],
  ask?: number[],
  question?: string,
): string => figure({ id: label, name: caption, note: '', draw, ask, question })
/** A flow: steps in order, an arrow between each. */
const steps = (title: string, cards: string[]) =>
  `<h3 class="kind"><span class="tag flowtag">Flow</span>${title}</h3><div class="flow">${cards.join('<div class="arrow">→</div>')}</div>`
/** Options: alternatives side by side, to pick from. */
const _options = (title: string, cards: string[]) =>
  `<h3 class="kind"><span class="tag opttag">Options</span>${title}</h3><div class="flow">${cards.join('<div class="or">or</div>')}</div>`
const single = (title: string, cards: string[]) =>
  `<h3 class="kind"><span class="tag onetag">Screen</span>${title}</h3><div class="flow">${cards.join('')}</div>`

const TABS: { id: string; title: string; body: string }[] = [
  {
    id: 'palette',
    title: 'Palette',
    body:
      `<p class="lead">Type one colour, get every common colour to go with it, each with a 50–950 scale.</p>` +
      steps('From colour’s home to a tweaked palette', [
        card('Step 1', 'Colour home: choose Palette', (L) => [homeCards3(L, 2)]),
        card('Step 2', 'Type a colour: the full set', (L) => [
          modeTab(L, 'full', { sel: { row: 5, col: 7 } }),
        ]),
        card('Step 3', 'm: choose a mode', (L) => [modeWin(L, 'centre', 'opposite')]),
        card('Step 4', 'The mode chosen', (L) => [modeTab(L, 'opposite')]),
        card('Step 5', 't: tweak the whole palette', (L) => [
          tweakWin(L, 'centre', { bright: 20, sat: -35, hue: 0, contrast: 0 }, 'sat'),
        ]),
        card('Step 6', 'Tweaked; r resets', (L) => [
          modeTab(L, 'full', { sel: { row: 5, col: 7 }, tw: { bright: 20, sat: -35 } }),
        ]),
      ]) +
      single('The grid up close: gaps between rows, the chosen cell wider with a stroke', [
        card('Screen 1', 'Full set, the cursor on blue 700', (L) => [
          modeTab(L, 'full', { sel: { row: 5, col: 7 } }),
        ]),
        card('Screen 2', 'Complementary’s taller cells, the cursor on your colour', (L) => [
          modeTab(L, 'opposite', { sel: { row: 0, col: 5 } }),
        ]),
        card('Screen 3', 'The corner: neutral 950', (L) => [
          modeTab(L, 'full', { sel: { row: 8, col: 10 } }),
        ]),
      ]) +
      `<h3>The seven modes</h3>${modesGlance()}`,
  },
  {
    id: 'mix',
    title: 'Mix',
    body:
      `<p class="lead">Two colours, the shades between them.</p>` +
      steps('From a scale to a mix', [
        card(
          'Step 1',
          'In Scale, type → and a second colour',
          (L) => [typingSecond(L, '')],
          [1],
          'Is the hint “type a second colour to mix” all right, in the box until you type?',
        ),
        card('Step 2', '↵: the mix', (L) => [mixScreen(L, ['Scale', 'Mix'])]),
        card('Step 3', 's: OKLab or OKLCH, how many steps', (L) => [
          mixScreen(L, ['Scale', 'Mix'], { sp: 'oklch', edit: 'space' }),
        ]),
      ]),
  },
  {
    id: 'typing',
    title: 'Typing a colour',
    body:
      `<p class="lead">The colour box takes more than hex.</p><table class="ex">${[
        ['oklch(63% 0.196 273)', oklchHex(0.63, 0.196, 273)],
        ['rgb(210 4 45)', '#D2042D'],
        ['hsl(230 97% 69%)', hsl(230, 0.97, 0.69)],
        ['crimson', '#DC143C'],
        ['#6579FDCC', '#6579FD'],
      ]
        .map(
          ([t, h]) =>
            `<tr><td><code>${t}</code></td><td>→</td><td><span class="chip" style="background:${h}"></span> ${h}</td></tr>`,
        )
        .join('')}</table>` +
      single('What it looks like', [
        card('Screen 1', 'The box, empty: its hint lists what it takes', (L) => [emptyTyping(L)]),
        card('Screen 2', 'A colour typed another way: its hex beside it', (L) => [
          typedScreen(L, (FORMATS[0] as (typeof FORMATS)[number]).t),
        ]),
        card(
          'Screen 3',
          'A colour name: CSS’s 148 and 949 everyday ones (crimson, cherry red)',
          (L) => [
            typedScreen(L, { typed: 'crimson', hex: '#DC143C' }),
            typedScreen(L, { typed: 'cherry red', hex: '#F7022A' }),
          ],
        ),
        card('Screen 4', 'Wrong input: the text red, “wrong input” at the box’s far end', (L) => [
          typedScreen(L, (FORMATS[4] as (typeof FORMATS)[number]).t),
        ]),
        card(
          'Screen 5',
          'A hex with transparency (#6579FDCC): the colour is used, the transparency ignored',
          (L) => [typedScreen(L, (FORMATS[3] as (typeof FORMATS)[number]).t)],
        ),
      ]),
  },
]

/** The questions still open, every one in a single list at the top. */
const QUESTIONS = [
  '<b>Mix’s hint</b> (Mix step 1): “type a second colour to mix” in the box until you type. All right?',
  '<b>Figma check:</b> run <code>pbcopy &lt; /tmp/forge-na/alpha-card.svg</code>, ⌘V in Figma: do the alpha swatches come in see-through?',
]

const page = `<!doctype html><html><head><meta charset="utf-8"><title>Forge · Colour, the rest</title>
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
  .mono { font:13px var(--mono); color:var(--muted); }
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
  i.rh { background:linear-gradient(to right, transparent 50%, currentColor 50%); }
  i.nt { background:linear-gradient(currentColor,currentColor) right top/50% 50% no-repeat, linear-gradient(currentColor,currentColor) bottom/100% 50% no-repeat; }
  i.tr { background:linear-gradient(to bottom right, currentColor 50%, transparent 50%) left top/100% 70% no-repeat; }
  i.qr { background:linear-gradient(currentColor,currentColor) right bottom/50% 50% no-repeat; }
  i.ql { background:linear-gradient(currentColor,currentColor) left bottom/50% 50% no-repeat; }
  i.e { background:linear-gradient(transparent 82%, currentColor 82%); }
  code { font:.9em var(--mono); background:#1c1e24; padding:1px 5px; border-radius:4px; }
  .strip { margin:16px 0 0; } .st { font-size:14px; } .st span { color:var(--muted); }
  .cells { display:flex; gap:8px; margin-top:6px; }
  .c { display:flex; flex-direction:column; width:84px; font:11px var(--mono); color:var(--muted); }
  .c b { color:var(--ink); font-weight:600; margin-top:4px; }
  .sw { width:84px; height:56px; border-radius:8px; }
  .svg { background:#2a2b30; padding:24px; border-radius:10px; width:max-content; }
  .decided { margin:22px 0 0; padding:14px 18px; border:1px solid #2c5a37; background:#0f1a13; border-radius:10px; max-width:1000px; }
  .decided b { color:#6fcf7f; } .decided b.drop { color:#e08a8a; } .decided b.open { color:#e5c07b; } .decided div + div { margin-top:4px; }
  h2 { font-size:22px; margin:44px 0 6px; display:flex; align-items:center; gap:10px; }
  h2 .n { font:700 13px var(--mono); background:var(--cyan); color:#0c1d22; width:24px; height:24px; border-radius:50%; display:inline-flex; align-items:center; justify-content:center; }
  .lead-box { font-size:18px; line-height:1.55; max-width:1000px; padding:16px 20px; border-left:3px solid var(--cyan); background:#12161b; border-radius:0 10px 10px 0; }
  .glance { margin-top:12px; } .gl-row { display:flex; align-items:center; gap:14px; padding:6px 0; border-bottom:1px solid var(--rule); max-width:1000px; }
  .gl-row b { width:120px; } .gl-says { width:320px; color:var(--muted); font-size:14px; } .gl-chips { display:flex; gap:6px; }
  .chip { display:inline-block; width:34px; height:22px; border-radius:5px; vertical-align:middle; } .chip.ref { outline:2px solid #fff; outline-offset:2px; }
  .qs { max-width:1100px; color:#c7cbd4; } .qs li { margin:6px 0; }
  .askq { max-width:640px; margin:10px 0 0; padding:10px 14px; background:#2e2412; border-left:3px solid #e5c07b; border-radius:0 8px 8px 0; color:#f0e2c4; font-size:15px; }
  .ask { font:700 12px var(--mono); color:#1a1205; background:#e5c07b; padding:2px 8px; border-radius:6px; text-decoration:none; margin-left:2px; }
  .done { font:600 11px var(--mono); color:var(--muted); border:1px solid var(--rule); padding:1px 7px; border-radius:6px; }
  h3.kind { display:flex; align-items:center; gap:10px; margin-top:34px; }
  .tag { font:700 11px var(--mono); letter-spacing:.06em; padding:3px 8px; border-radius:6px; text-transform:uppercase; }
  .flowtag { background:#12282e; color:var(--cyan); } .opttag { background:#2e2412; color:#e5c07b; } .onetag { background:#1c1e24; color:var(--muted); }
  .arrow, .or { align-self:center; font:700 28px var(--sans); color:var(--muted); }
  .or { font-size:15px; text-transform:uppercase; letter-spacing:.1em; color:#e5c07b; }
  .flow { display:flex; flex-wrap:wrap; gap:26px 22px; align-items:flex-start; margin-top:18px; }
  .flow figure { margin:0; } .flow .idea { display:none; }
  .lead { font-size:18px; margin:6px 0 0; }
  details { margin-top:28px; max-width:1500px; border:1px solid var(--rule); border-radius:10px; padding:10px 16px; }
  details summary { cursor:pointer; color:var(--muted); font-weight:600; }
  table.ex { border-collapse:collapse; margin-top:10px; } table.ex td, table.ex th { text-align:left; padding:7px 18px 7px 0; border-bottom:1px solid var(--rule); font-size:14px; } table.ex th { color:var(--muted); font-weight:600; }
  .vt .chosen { font:700 11px var(--mono); letter-spacing:.08em; color:#0c1d12; background:#6fcf7f; padding:2px 8px; border-radius:6px; }
  .g { margin:20px 0 0; } .g-row { display:flex; gap:6px; margin-top:6px; align-items:center; }
  .g-name { width:150px; font:13px var(--mono); color:var(--ink); } .g-name i { color:var(--muted); font-style:normal; font-size:11px; } .g-name.yours { color:#f38ba8; font-weight:700; }
  .g-lab { width:56px; font:11px var(--mono); color:var(--muted); text-align:center; }
  .g-sw { width:56px; height:30px; border-radius:6px; } .g-sw.ref { outline:2px solid #fff; outline-offset:2px; }
</style></head>
<body class="only-dark"><main>
<h1>Colour · what comes next</h1>
<div class="decided"><div><b>Decided</b> · Scale gets Neutral and Alpha tabs (neutral-alpha-2026-10.html) · Palette from one colour, its own screen (today’s Palette becomes Extract), 7 modes, centred windows, 4 sliders, reset · Mix by typing a second colour · typing colours (hex, rgb, hsl, oklch, CSS and everyday names; wrong input in red) · the Palette flow, with “build a palette / from one colour” on its home card</div></div>
<h3>Open questions</h3><p class="intro">Screens that need your answer carry a <span class="ask">? n</span> badge with the question’s number; the rest say <span class="done">decided</span>.</p><ol class="qs">${QUESTIONS.map((q, i) => `<li id="q${i + 1}">${q}</li>`).join('')}</ol>
<div class="tabs">${TABS.map((t, i) => `<a data-t="${t.id}"${i === 0 ? ' class="on"' : ''}>${t.title}</a>`).join('')}<span class="sp"></span>
<label><input type="radio" name="th" value="only-dark" checked> dark</label><label><input type="radio" name="th" value="only-light"> light</label><label><input type="radio" name="th" value="both"> both</label></div>
${TABS.map((t, i) => `<section id="s-${t.id}"${i === 0 ? ' class="on"' : ''}>${t.body}</section>`).join('\n')}
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

void formatRgb
void SHARES
const out = new URL('../mockups/colour-more-2026-10.html', import.meta.url)
writeFileSync(out, page)
console.log('wrote', decodeURIComponent(out.pathname), page.length)
