/**
 * The drop zone's dots in motion (2026-10-12): four ways they could move,
 * each in dark and in light (L6 — L5's washed band, L1's drop zone; decided in round 5 part
 * twelve). Every frame is the drop zone's own colour arithmetic, as
 * scripts/round5-mockup.ts draws it, played at the rate the app would redraw.
 *
 * The drawing helpers are copied from scripts/round5-mockup.ts, which another
 * line of work is still changing; only `dotted` gained a `motion` frame.
 *
 *   npx tsx scripts/dots-motion-mockup.ts   → mockups/dots-motion-2026-10.html
 */
import { writeFileSync } from 'node:fs'
import stringWidth from 'string-width'
import {
  blank,
  gradientAt,
  HOME_MARGIN as M,
  MODE_KINDS,
  mix,
  type Row,
  type Run,
  tabRows,
  WORDMARK3,
  width,
} from '../src/shell/home-art.js'
import {
  DARK,
  LIGHT,
  MODE_KEYS,
  MODE_ORDER,
  modeColours,
  modeGradient,
  type Palette,
  type ShellMode,
  VERSION,
} from '../src/shell/theme.js'

const N = 80
const H = 24
const W = N - M * 2

/* ------------------------------------------------------------ helpers */

const run = (text: string, fg?: string, bg?: string, bold = false): Run => ({ text, fg, bg, bold })
const pad = (row: Row, n: number, bg?: string): Row => [
  ...row,
  { text: ' '.repeat(Math.max(0, n - width(row))), bg },
]
/** A whole frame: `top` rows, blank rows, then `bottom` rows at the foot. */
const frame = (top: Row[], bottom: Row[] = []): Row[] => {
  const out = top.slice(0, H - bottom.length)
  while (out.length < H - bottom.length) out.push([])
  return [...out, ...bottom]
}

/** The F1 key row, as `KeyRow` draws it. */
function keyRow(p: Palette, main: [string, string][], foot: [string, string][]): Row {
  const row: Row = [blank(M + 1)]
  main.forEach(([k, w], i) => {
    if (i) row.push(blank(2))
    row.push(run(` ${k} `, p.fg, p.keycapBg, true), run(` ${w}`, p.dim))
  })
  const note = foot.map(([k, w]) => (w ? `${k} ${w}` : k)).join(' · ')
  row.push(blank(Math.max(1, N - width(row) - stringWidth(note) - 1)), run(note, p.border))
  return row
}
const keys = (p: Palette, main: [string, string][], foot: [string, string][]) => [
  [run('─'.repeat(N), p.border)],
  keyRow(p, main, foot),
]

/* ------------------------------------------------------ colour science */

const lin = (c: number) => {
  const v = c / 255
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
}
const unlin = (v: number) => (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055)
const rgbOf = (hex: string) =>
  [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16)) as [number, number, number]

/** WCAG 2 relative luminance and contrast ratio. */
const luminance = (hex: string) => {
  const [r, g, b] = rgbOf(hex).map(lin) as [number, number, number]
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
export const contrast = (a: string, b: string) => {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p) as [number, number]
  return (x + 0.05) / (y + 0.05)
}

function toOklch(hex: string): [number, number, number] {
  const [r, g, b] = rgbOf(hex).map(lin) as [number, number, number]
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
  return [L, Math.hypot(A, B), Math.atan2(B, A)]
}
/** Linear sRGB for an OKLCH colour, possibly out of gamut. */
function linearOf(L: number, C: number, h: number): [number, number, number] {
  const a = C * Math.cos(h)
  const b = C * Math.sin(h)
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ]
}
const inGamut = (L: number, C: number, h: number) =>
  linearOf(L, C, h).every((v) => v >= -1e-4 && v <= 1 + 1e-4)
function fromOklch(L: number, C: number, h: number): string {
  return `#${linearOf(L, C, h)
    .map((v) =>
      Math.round(255 * unlin(Math.min(1, Math.max(0, v))))
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`
}
/** The most chroma sRGB holds at this lightness and hue. */
function maxChroma(L: number, h: number): number {
  let lo = 0
  let hi = 0.4
  for (let i = 0; i < 30; i++) {
    const mid = (lo + hi) / 2
    if (inGamut(L, mid, h)) lo = mid
    else hi = mid
  }
  return lo
}

/**
 * A dark-theme gradient stop moved to where it holds on white: the same hue,
 * as much chroma as sRGB allows there (it is what makes a colour "pop"), and
 * the lightness at which it reaches `target`:1 against white. 4.5:1 on white
 * is what keeps it above WCAG's 3:1 for graphics (SC 1.4.11) on the grey
 * panel as well, where the dots are drawn; 3.4:1 on white fell to 2.7:1 there.
 */
function forLight(hex: string, target = 4.5): string {
  const [, c0, h] = toOklch(hex)
  const at = (L: number) => fromOklch(L, Math.min(Math.max(c0, 0.13), maxChroma(L, h) * 0.96), h)
  let lo = 0.3
  let hi = 0.85
  for (let i = 0; i < 30; i++) {
    const mid = (lo + hi) / 2
    if (contrast(at(mid), '#ffffff') >= target) lo = mid
    else hi = mid
  }
  return at(lo)
}

/** The pure grey with the same OKLab lightness as `hex`. */
function neutralOf(hex: string): string {
  const [L] = toOklch(hex)
  const v = Math.round(255 * unlin(L ** 3))
  const h = v.toString(16).padStart(2, '0')
  return `#${h}${h}${h}`
}

/* ------------------------------------------------ light mode proposal */

const SPECTRUM = ['#f26e69', '#e5a23c', '#ace02c', '#55c7d9', '#6579fd', '#ad95e9']
/** Every mode's gradient as dark draws it — the colours the light stops are made from. */
const DARK_STOPS: Record<ShellMode, string[]> = {
  convert: [DARK.modeConvert, DARK.violet],
  compress: [DARK.modeCompress, DARK.modeConvert],
  pdf: [DARK.modePdf, DARK.brand],
  colour: SPECTRUM,
  enhance: [DARK.modeEnhance, '#7d6ad0'],
}
const LIGHT_STOPS = Object.fromEntries(
  MODE_ORDER.map((m) => [m, DARK_STOPS[m].map((h) => forLight(h))]),
) as Record<ShellMode, string[]>

/** Light's greys — every warm one — swapped for pure greys of the same lightness, as dark's were. */
const GREYS = [
  'dim',
  'border',
  'selectionBg',
  'band',
  'keycapBg',
  'faint',
  'listBand',
  'panelBand',
  'track',
  'trackFill',
  'folderChip',
  'fieldBand',
  'fg',
  'thumb',
  'pill',
  'failTintDim',
  'shelf',
  'tabChip',
] as const
const LIGHT_NEUTRAL: Palette = {
  ...LIGHT,
  ...Object.fromEntries(GREYS.map((k) => [k, neutralOf(LIGHT[k])])),
}

/* -------------------------------------------- light gradients (part 12) */

/** OKLab coordinates of a colour. */
const labOf = (hex: string): [number, number, number] => {
  const [L, C, h] = toOklch(hex)
  return [L, C * Math.cos(h), C * Math.sin(h)]
}
/** `a` moved `k` of the way to `b` in OKLab: no grey dip between two hues. */
function labMix(a: string, b: string, k: number): string {
  if (!/^#[0-9a-f]{6}$/i.test(a) || !/^#[0-9a-f]{6}$/i.test(b)) return b
  const t = Math.max(0, Math.min(1, k))
  const [x, y] = [labOf(a), labOf(b)]
  const [L, A, B] = x.map((v, i) => v + ((y[i] ?? v) - v) * t) as [number, number, number]
  return fromOklch(L, Math.hypot(A, B), Math.atan2(B, A))
}

/**
 * A gradient through dark's hues, walked in OKLCH (the hue turning the short
 * way round), every step at lightness `L` and as much chroma as sRGB holds
 * there — `n` stops, so the terminal's straight blend between neighbours
 * never strays from the path. Yellows are lifted (see below).
 */
/** OKLCH's yellow, where sRGB's chroma peaks closest to white. */
const YELLOW = (105 * Math.PI) / 180

function oklchStops(hexes: readonly string[], L: number, n = 9, chroma = 0.94): string[] {
  const hues = hexes.map((h) => toOklch(h)[2])
  const out: string[] = []
  for (let i = 0; i < n; i++) {
    const p = (i / (n - 1)) * (hues.length - 1)
    const k = Math.min(hues.length - 2, Math.floor(p))
    const a = hues[k] ?? 0
    let d = (hues[k + 1] ?? a) - a
    if (d > Math.PI) d -= 2 * Math.PI
    if (d < -Math.PI) d += 2 * Math.PI
    const h = a + d * (hues.length === 1 ? 0 : p - k)
    // Yellow only reaches full chroma near white: lifted towards its own
    // lightness, ambers and yellow-greens stay clear instead of going olive.
    const at = L + 0.16 * Math.max(0, Math.cos(h - YELLOW)) ** 3
    out.push(fromOklch(at, maxChroma(at, h) * chroma, h))
  }
  return out
}

/** A high-key tint of `hex`: its hue, near white. */
const washOf = (hex: string, L = 0.955, C = 0.035) => {
  const h = toOklch(hex)[2]
  return fromOklch(L, Math.min(C, maxChroma(L, h) * 0.9), h)
}

interface Look {
  stops: Record<ShellMode, string[]>
  /** How a dot steps back into the fill. */
  mix: (a: string, b: string, k: number) => string
  /** Hatching drawn on a tint of its own colour, rather than on the canvas. */
  wash?: boolean
  /** The drop zone's own gradient and blend, when it is not the band's (L6). */
  dots?: { stops: Record<ShellMode, string[]>; mix: (a: string, b: string, k: number) => string }
  /** The drop zone on a tint too; the band's `wash` when not said. */
  washDots?: boolean
}
/** The look being drawn; none is the palette's own gradient. */
let LOOK: Look | undefined
const withLook = <T>(look: Look | undefined, draw: () => T): T => {
  const was = LOOK
  LOOK = look
  try {
    return draw()
  } finally {
    LOOK = was
  }
}

const stopsAt = (L: number) =>
  Object.fromEntries(
    MODE_ORDER.map((m) => [m, oklchStops(DARK_STOPS[m], L, m === 'colour' ? 15 : 9)]),
  ) as Record<ShellMode, string[]>

const LOOKS: Record<string, Look> = {
  proposal: { stops: LIGHT_STOPS, mix },
  vivid: { stops: stopsAt(0.64), mix: labMix },
  jewel: { stops: stopsAt(0.54), mix: labMix },
  wash: { stops: stopsAt(0.62), mix: labMix, wash: true },
  /** L6 (decided): L5's washed band over L1's drop zone. */
  mixed: {
    stops: stopsAt(0.62),
    mix: labMix,
    wash: true,
    washDots: false,
    dots: { stops: LIGHT_STOPS, mix },
  },
  pastel: { stops: stopsAt(0.76), mix: labMix },
}

/** The drop zone's gradient: its own where the look gives it one, else the band's. */
const dotStops = (p: Palette, mode: ShellMode) => LOOK?.dots?.stops[mode] ?? stopsFor(p, mode)

/** The gradient a palette draws a mode in: the look's own stops where one is drawn. */
const stopsFor = (p: Palette, mode: ShellMode) =>
  LOOK ? LOOK.stops[mode] : p === LIGHT_NEUTRAL ? LIGHT_STOPS[mode] : [...modeGradient(p, mode)]

/* -------------------------------------------------------------- home */

/** FORGE knocked out of the hatching, as `brandRows` draws it, in any stops. */
function brand(p: Palette, mode: ShellMode): Row[] {
  const stops = stopsFor(p, mode)
  const span = N + 8
  const hatch = (from: number, n: number, row: number): Run[] =>
    Array.from({ length: Math.max(0, n) }, (_, i) => {
      const fg = gradientAt(from + i + row * 2, span, stops)
      return run('╱', fg, LOOK?.wash ? washOf(fg) : undefined)
    })
  const word = WORDMARK3[0]?.length ?? 0
  const after = W - word - 3
  const version = `v${VERSION}`
  const room = after - 2 - version.length - 2
  return WORDMARK3.map((letters, i) => {
    const row: Row = [
      blank(M),
      ...hatch(M, 1, i),
      blank(1),
      run(letters, p.fg, undefined, true),
      blank(1),
    ]
    const c0 = M + word + 3
    if (i === 2)
      row.push(
        ...hatch(c0, room, i),
        blank(1),
        run(version, p.dim),
        blank(1),
        ...hatch(c0 + after - 2, 2, i),
      )
    else row.push(...hatch(c0, after, i))
    return row
  })
}

/**
 * One frame of the dots in motion (part thirteen): how strong a dot is — 0
 * the fill, 1 its tint, above 1 brighter than its tint — and, optionally,
 * its tint. `rest` is the strength it has when still.
 */
interface DotMotion {
  level: (c: number, r: number, rest: number) => number
  tint?: (c: number, r: number) => string
}

/**
 * How much a flare lifts a dot above its rest, at most (0.5 → 0.8 for the
 * faintest). Never past its own tint: no growth, no push towards white.
 */
const LIFT = 0.3
/** A dot `glow` of the way up its flare. */
const lifted = (rest: number, glow: number) => Math.min(1, rest + LIFT * glow)

/** The dotted surface, as `dotted` in home-art draws it; `motion` draws one frame of it moving. */
function dotted(p: Palette, mode: ShellMode, lines: Row[], h = 8, motion?: DotMotion): Row[] {
  const fill = p.selectionBg
  const stops = dotStops(p, mode)
  const isDot = (c: number) => c % 3 === 0 && c >= 3 && c <= W - 4
  const mid = (h - 1) / 2
  const blend = LOOK?.dots?.mix ?? LOOK?.mix ?? mix
  /** A dot's colour: `k` of the way from the fill to its tint. */
  const dot = (c: number, r: number): { glyph: string; fg: string } => {
    const tint = motion?.tint?.(c, r) ?? gradientAt(c + r * 2, W + 14, stops)
    const dx = Math.abs(c - W / 2) / (W / 2)
    const dy = Math.abs(r - mid) / mid
    const rest = 0.5 + 0.4 * Math.min(1, Math.hypot(dx, dy * 0.6))
    const k = motion ? motion.level(c, r, rest) : rest
    return { glyph: '·', fg: blend(cellFill(c, r), tint, Math.min(1, k)) }
  }
  /** The fill under a cell: the panel's grey, or on a wash a tint of the gradient there. */
  const cellFill = (c: number, r: number) =>
    (LOOK?.washDots ?? LOOK?.wash)
      ? washOf(gradientAt(c + r * 2, W + 14, stops), 0.965, 0.03)
      : fill
  const top = Math.floor((h - lines.length) / 2)
  const words = Math.max(...lines.map(width))
  let a = Math.max(0, Math.floor((W - words - 8) / 2))
  let b = W - a
  while (a > 0 && !isDot(a - 1)) a--
  while (b < W && !isDot(b)) b++
  const cut = b - a
  const out: Row[] = []
  for (let r = 0; r < h; r++) {
    const line = lines[r - top]
    const clear = r >= top && r < top + lines.length
    const row: Row = [blank(M)]
    let c = 0
    while (c < W) {
      if (clear && c === a) {
        const left = line ? Math.floor((cut - width(line)) / 2) : 0
        const lead = line ? left : cut
        for (let i = 0; i < lead; i++) row.push(run(' ', undefined, cellFill(c + i, r)))
        let at = c + lead
        for (const x of line ?? []) {
          row.push({ ...x, bg: x.bg ?? cellFill(at + Math.floor(width([x]) / 2), r) })
          at += width([x])
        }
        while (at < c + cut) row.push(run(' ', undefined, cellFill(at++, r)))
        c += cut
        continue
      }
      row.push(
        r >= 1 && r <= h - 2 && isDot(c)
          ? (() => {
              const d = dot(c, r)
              return { ...run(d.glyph, d.fg, cellFill(c, r)), dot: true }
            })()
          : run(' ', undefined, cellFill(c, r)),
      )
      c++
    }
    out.push(row)
  }
  return out
}

/** Home's field on its recessed shelf (P2), as Prompt draws it. */
function shelf(p: Palette, mode: ShellMode, hint: string): Row[] {
  const bg = p.shelf
  const line = (r: Row): Row => [blank(M), ...pad(r, W, bg)]
  return [
    line([]),
    line([
      run('  ', undefined, bg),
      run('›', modeColours(p, mode).fg, bg, true),
      run(' ', undefined, bg),
      run(hint.slice(0, 1), p.canvas, p.dim),
      run(hint.slice(1), p.border, bg),
    ]),
    line([]),
  ]
}

function home(p: Palette, mode: ShellMode, motion?: DotMotion): Row[] {
  const accent = modeColours(p, mode).fg
  const words: Row[] = [
    [run('↓', accent, undefined, true), blank(2), run('Drop a file here', p.fg, undefined, true)],
    [run(MODE_KINDS[mode], p.dim)],
  ]
  const tabs = tabRows({
    width: N,
    palette: p,
    mode,
    savesTo: '~/Desktop',
    ...(mode === 'colour' ? { right: { label: 'copies to', value: 'clipboard' } } : {}),
  })
  const panel = dotted(p, mode, words, 8, motion)
  const field = shelf(p, mode, 'or type a path')
  return frame(
    [[], ...brand(p, mode), [], ...tabs, ...panel, ...field],
    keys(
      p,
      mode === 'colour'
        ? [
            ['↔', 'choose'],
            ['↵', 'open'],
          ]
        : [['↵', 'send']],
      [
        [MODE_KEYS, 'mode'],
        ...(mode === 'colour' ? [] : ([['esc', 'clear']] as [string, string][])),
        ['ctrl-n', 'new'],
        ['ctrl-c', 'quit'],
      ],
    ),
  )
}

/* ------------------------------------------------------------- render */

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const GLYPH: Record<string, string> = {
  '╱': 'd',
  '▀': 'u',
  '▄': 'l',
  '█': 'f',
  '▌': 'h',
  '▔': 'o',
  '': 'si',
  '': 'so',
}

function html(all: Row[], p: Palette, crop?: number): string {
  const rows = crop ? all.slice(0, crop) : all
  rows.forEach((r, i) => {
    if (width(r) > N) console.warn(`row ${i} is ${width(r)} wide:`, r.map((x) => x.text).join(''))
  })
  if (!crop && rows.length !== H) console.warn(`frame is ${rows.length} rows`)
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
        const cls = (x as { dot?: boolean }).dot ? ' class="dt"' : ''
        out += style
          ? `<span${cls} style="${style}">${inner}</span>`
          : `<span${cls}>${inner}</span>`
        used += stringWidth(x.text)
      }
      if (used < N) out += `<span>${' '.repeat(N - used)}</span>`
      return `<div class="r">${out}</div>`
    })
    .join('')
  return `<div class="t" style="background:${p.canvas};color:${p.fg}">${body}</div>`
}

/* ------------------------------------------ dots in motion (part 13) */

/** The two themes every motion is shown in: dark as built, light as L5 (decided). */
const THEMES: Array<{ id: string; p: Palette; look?: Look }> = [
  { id: 'dark', p: DARK },
  { id: 'light', p: LIGHT_NEUTRAL, look: LOOKS.mixed },
]

/** The drop zone's own geometry, as `dotted` lays it out at 8 rows. */
const MID_R = 3.5
/** The middle of the dot columns (3 to the last third column before the edge), so a ring is even both sides. */
const MID_C = (3 + Math.floor((W - 4) / 3) * 3) / 2
/** A row is about twice as tall as a column is wide. */
const ASPECT = 2.2

const smooth = (k: number) => {
  const t = Math.max(0, Math.min(1, k))
  return t * t * (3 - 2 * t)
}

/** A seeded random number, so the page is the same every build. */
function seeded(seed: number) {
  let a = seed
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

interface Motion {
  id: string
  name: string
  note: string
  /** Milliseconds between frames: the rate the app would redraw at. */
  ms: number
  /** Total length; a loop repeats, a one-shot plays then holds its last frame. */
  length: number
  loop: boolean
  /** One-shots cycle through these modes, playing once on each arrival. */
  modes: ShellMode[]
  at: (t: number, p: Palette, mode: ShellMode) => DotMotion
}

/** One ring every RIPPLE_MS; it crosses the field in RING_MS, a band RING_W columns deep. */
const RING_MS = 3200
const RING_W = 22
/** After the ring: the full field rests, fades out, and stays empty before the next. */
const RING_HOLD = 1300
const RING_FADE = 700
const RING_GAP = 500
const RIPPLE_MS = RING_MS + RING_HOLD + RING_FADE + RING_GAP
const SWELL_MS = 9000
const FLOW_MS = 14000
const TWINKLE_MS = 12000
/** Furthest dot from the words, in columns. */
const REACH = Math.hypot(MID_C, MID_R * ASPECT) + 14

const MOTIONS: Motion[] = [
  {
    id: 'M1',
    name: 'Ripple, looping',
    note: 'The drop zone starts empty; a soft ring spreads out from the words and the dots appear as it reaches them, each lifting a little and easing back to rest. The ring takes 3.2 s to cross; the full field rests 1.3 s, fades out over 0.7 s, stays empty for 0.5 s, and the ring comes again — for as long as home is idle. Never stops, so like the others it needs an exception to the motion rule.',
    ms: 66,
    length: RIPPLE_MS,
    loop: true,
    modes: ['convert'],
    at: (t) => {
      const front = (Math.min(t, RING_MS) / RING_MS) * (REACH + RING_W)
      // After the ring and the rest, the whole field fades out together.
      const out = 1 - smooth((t - RING_MS - RING_HOLD) / RING_FADE)
      return {
        level: (c, r, rest) => {
          const d = Math.hypot(c - MID_C, (r - MID_R) * ASPECT)
          const behind = front - d
          // Not reached yet: no dot. Reached: it fades in at the ring's
          // leading edge and eases back to rest along its tail.
          if (behind <= 0) return 0
          const glow = behind >= RING_W ? 0 : (1 - behind / RING_W) ** 1.3
          return out * smooth(behind / 6) * lifted(rest, glow)
        },
      }
    },
  },
  {
    id: 'M2',
    name: 'Slow swell',
    note: 'A soft band of light drifts across the dots along the gradient’s own diagonal, one pass every 9 s with a pause between passes, for as long as home is idle. Calm, and it says “drop here” without words — but it never stops, so it would need an exception to the motion rule, and it redraws the screen 15 times a second while you are not doing anything.',
    ms: 66,
    length: SWELL_MS,
    loop: true,
    modes: ['convert'],
    at: (t) => {
      const span = W + 14 + 60
      const at = (t / SWELL_MS) * span - 25
      return {
        level: (c, r, rest) => {
          const glow = Math.exp(-(((c + r * 2 - at) / 10) ** 2))
          return lifted(rest, glow)
        },
      }
    },
  },
  {
    id: 'M3',
    name: 'Gradient flow',
    note: 'The gradient itself slides slowly to the right — cyan through violet and back — once every 14 s, like the header bar’s hatching does while a job runs. The dots keep their size and strength; only their colours travel — the quietest of the four, and on dots this small the hardest to see. Never stops, as M2. On light the wash under the dots stays where it is: only the dots move.',
    ms: 66,
    length: FLOW_MS,
    loop: true,
    modes: ['convert'],
    at: (t, p, mode) => {
      const stops = dotStops(p, mode)
      const there = [...stops, ...stops.slice(0, -1).reverse()]
      const n = 2 * W + 27
      const m = n - 1
      const shift = (t / FLOW_MS) * m
      return {
        level: (_c, _r, rest) => rest,
        tint: (c, r) => gradientAt((((c + r * 2 - shift) % m) + m) % m, n, there),
      }
    },
  },
  {
    id: 'M4',
    name: 'Twinkle',
    note: 'Now and then a dot lifts and fades, one or two at a time, at random — a field that is quietly alive rather than one sweeping motion. About two dots in five twinkle once every 12 s. Never stops, as M2.',
    ms: 66,
    length: TWINKLE_MS,
    loop: true,
    modes: ['convert'],
    at: (t) => {
      const rnd = seeded(7)
      const phase = new Map<string, number>()
      for (let r = 1; r <= 6; r++)
        for (let c = 3; c <= W - 4; c += 3) if (rnd() < 0.4) phase.set(`${c},${r}`, rnd())
      return {
        level: (c, r, rest) => {
          const ph = phase.get(`${c},${r}`)
          if (ph === undefined) return rest
          let d = t / TWINKLE_MS - ph
          d -= Math.round(d)
          return lifted(rest, Math.exp(-((d / 0.045) ** 2)))
        },
      }
    },
  },
]

/** The dots' colours in one frame, in the order the page finds them, as one string. */
const dotColours = (rows: Row[]) =>
  rows
    .flat()
    .filter((x) => (x as { dot?: boolean }).dot)
    .map((x) => (x.text === '•' ? 'B' : x.text === '∙' ? 'b' : 's') + (x.fg ?? '').slice(1))
    .join('')

const CROP = 19
const ANIM: Record<string, { ms: number; loop: boolean; frames: string[]; rest: string }> = {}

function motionFigure(m: Motion): string {
  const panes = THEMES.map(({ id: theme, p, look }) =>
    withLook(look, () => {
      const terms = m.modes.map((mode, i) => {
        const key = `${m.id}-${theme}-${mode}`
        const frames: string[] = []
        for (let t = 0; t <= m.length - (m.loop ? m.ms : 0); t += m.ms)
          frames.push(dotColours(home(p, mode, m.at(Math.min(t, m.length), p, mode))))
        // With motion off the screen is the still one, as today.
        const rest = home(p, mode)
        ANIM[key] = { ms: m.ms, loop: m.loop, frames, rest: dotColours(rest) }
        const still = html(rest, p, CROP)
        return still.replace(
          '<div class="t"',
          `<div class="t" data-a="${key}"${i === 0 ? '' : ' hidden'}`,
        )
      })
      return `<div class="pane"><div class="cap">${theme === 'dark' ? 'dark' : 'light · L6: L5’s band, L1’s drop zone'}</div>${terms.join('')}</div>`
    }),
  )
  return `<figure class="wide" data-m="${m.id}" data-cycle="${m.loop ? '' : m.modes.length}"><div class="vt"><span class="id">${m.id}</span><span class="name">${m.name}</span><span class="when">${m.loop ? `loops · ${m.length / 1000} s` : `once · ${m.length / 1000} s, then still`}</span></div><div class="pair">${panes.join('')}</div><p class="idea">${m.note}</p></figure>`
}

const motionTab = MOTIONS.map(motionFigure).join('')

/* --------------------------------------------------------------- page */

const page = `<!doctype html>
<html lang="en"><head><meta charset="utf-8" />
<title>Convert — the drop zone's dots in motion</title>
<style>
  :root { --page:#0d0e11; --ink:#e2e4ea; --muted:#8f94a1; --rule:#23252c; --cyan:#55c7d9; --mono:"SF Mono", ui-monospace, Menlo, monospace; --sans:-apple-system, BlinkMacSystemFont, "Helvetica Neue", sans-serif; }
  * { box-sizing:border-box; }
  body { margin:0; background:var(--page); color:var(--ink); font:16px/1.6 var(--sans); }
  main { max-width:1500px; margin:0 auto; padding:44px 24px 120px; }
  h1 { font-size:32px; margin:0 0 8px; }
  .intro { color:#c7cbd4; max-width:1000px; margin:0; }
  .ctl { position:sticky; top:0; z-index:5; display:flex; gap:18px; margin:22px -24px 0; padding:12px 24px; background:rgba(13,14,17,.94); border-bottom:1px solid var(--rule); font:13px var(--mono); color:var(--muted); }
  .ctl label { display:flex; gap:6px; align-items:center; }
  figure { margin:34px 0 0; }
  .vt { display:flex; align-items:baseline; gap:10px; margin-bottom:8px; }
  .vt .id { font:700 12px var(--mono); padding:3px 7px; border-radius:6px; background:#12282e; color:var(--cyan); }
  .vt .name { font-weight:620; }
  .vt .when { font:12px var(--mono); color:var(--muted); }
  .idea { font-size:14.5px; color:#c7cbd4; margin:8px 0 0; max-width:1000px; }
  .pair { display:flex; flex-wrap:wrap; gap:18px; }
  .pane .cap { font:12px var(--mono); color:var(--muted); margin-bottom:6px; }
  .pane .t[hidden] { display:none; }
  .t { font:13px/1 var(--mono); padding:12px 14px; border-radius:10px; border:1px solid #2c2f37; width:max-content; }
  .r { height:17px; white-space:pre; overflow:hidden; }
  .r > span { display:inline-block; height:17px; line-height:17px; vertical-align:top; }
  .r i { display:inline-block; width:1ch; height:17px; vertical-align:top; }
  i.d { background:linear-gradient(to top left, transparent calc(50% - .7px), currentColor calc(50% - .7px), currentColor calc(50% + .7px), transparent calc(50% + .7px)); }
  i.u { background:linear-gradient(currentColor 50%, transparent 50%); }
  i.l { background:linear-gradient(transparent 50%, currentColor 50%); }
  i.f { background:currentColor; }
  i.h { background:linear-gradient(to right, currentColor 50%, transparent 50%); }
  i.o { background:linear-gradient(currentColor 2px, transparent 2px); }
  i.si { background:linear-gradient(to bottom right, transparent 50%, currentColor 50%); }
  .r > span.dt { width:1ch; overflow:visible; text-align:center; }
  i.so { background:linear-gradient(to bottom right, currentColor 50%, transparent 50%); }
</style></head>
<body><main>
<h1>The drop zone's dots in motion</h1>
<p class="intro">Four ways the dots could move, each in dark and in light (L6: L5’s band, L1’s drop zone). Every frame is drawn by the drop zone’s own colour arithmetic and played at the rate the app would redraw: 15 a second, as the header bar’s drift does. All four loop for as long as home is idle. A dot rests at 0.5 (by the words) to 0.9 (at the edges) of the way from the panel to its colour; the motion lifts it by at most 0.3 — 0.5 to 0.8 for the faintest — and never past its own colour, so no dot grows or turns white. Only the dots move; the words, the cut-out and the field never do. With motion off — NO_COLOR, the first-run palette, a pipe — every one of these is the still screen you have today.</p>
<div class="ctl"><label><input type="radio" name="slow" value="1" checked> real speed</label><label><input type="radio" name="slow" value="4"> ¼ speed</label><label><input type="checkbox" name="still"> motion off</label></div>
${motionTab}
</main>
<script>
const ANIM = ${JSON.stringify(ANIM)}
let slow = 1
let still = false
const paint = (t, s) => {
  t.querySelectorAll('.dt').forEach((d, i) => {
    d.style.color = '#' + s.slice(i * 7 + 1, i * 7 + 7)
    const g = { B: '•', b: '∙', s: '·' }[s[i * 7]]
    if (d.textContent !== g) d.textContent = g
  })
}
document.querySelectorAll('figure[data-m]').forEach((fig) => {
  const cycle = Number(fig.dataset.cycle || 0)
  const terms = [...fig.querySelectorAll('.t[data-a]')]
  let start = performance.now()
  let mode = 0
  const tick = (now) => {
    if (!still) {
      const shown = cycle ? terms.filter((t, i) => i % cycle === mode) : terms
      for (const t of terms) t.hidden = !shown.includes(t)
      for (const t of shown) {
        const a = ANIM[t.dataset.a]
        // A frame's timestamp can be a little before \`start\` (it is when the
        // frame began, not when this runs): a negative n asked for frame -1.
        const n = Math.max(0, Math.floor((now - start) / (a.ms * slow)))
        const i = a.loop ? n % a.frames.length : Math.min(n, a.frames.length - 1)
        if (t._i !== i) { paint(t, a.frames[i]); t._i = i }
      }
      if (cycle && now - start > 4500 * slow) { start = now; mode = (mode + 1) % cycle; terms.forEach((t) => { t._i = -1 }) }
    } else start = now
    requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)
})
const at = new URLSearchParams(location.search).get('at')
if (at) {
  const [id, n] = at.split(':')
  still = true
  document.querySelectorAll('.t[data-a^="' + id + '-"]').forEach((t) => { const a = ANIM[t.dataset.a]; paint(t, n === 'rest' ? a.rest : a.frames[Number(n)]) })
}
document.querySelectorAll('input[name=slow]').forEach((r) => r.onchange = () => { slow = Number(r.value) })
document.querySelector('input[name=still]').onchange = (e) => {
  still = e.target.checked
  document.querySelectorAll('figure[data-m]').forEach((fig) => {
    const cycle = Number(fig.dataset.cycle || 0)
    fig.querySelectorAll('.t[data-a]').forEach((t, i) => {
      const a = ANIM[t.dataset.a]
      if (cycle) t.hidden = i % cycle !== 0
      if (still) paint(t, a.rest)
      t._i = -1
    })
  })
}
</script></body></html>`

const out = new URL('../mockups/dots-motion-2026-10.html', import.meta.url)
writeFileSync(out, page)
console.log('wrote', decodeURIComponent(out.pathname), page.length)
