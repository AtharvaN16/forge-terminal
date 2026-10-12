/**
 * Round 5, part twelve (2026-10-12): light mode's gradients; Done and Save as as built,
 * drawn by the app's own art functions so every frame is what the code
 * draws — and so light mode is the same frame with the other palette.
 *
 * Variants that the code cannot draw yet are composed here from those
 * functions' rows; nothing in src/ knows about them. Earlier parts are kept
 * as mockups/round-5a to -5j-2026-10.html.
 *
 *   npx tsx scripts/round5-mockup.ts   → mockups/round-5-2026-10.html
 */
import { writeFileSync } from 'node:fs'
import stringWidth from 'string-width'
import { trailBarRow } from '../src/shell/bar-art.js'
import { COLOUR_SAMPLES, choiceCards } from '../src/shell/colour/colour-art.js'
import { listCommands } from '../src/shell/commands.js'
import { type DoneFacts, doneBody, doneLayout } from '../src/shell/done-art.js'
import {
  blank,
  commandRows,
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
import { titleRow } from '../src/shell/quality-art.js'
import {
  DARK,
  dotGradient,
  LIGHT,
  MODE_KEYS,
  MODE_ORDER,
  modeColours,
  modeGradient,
  modePalette,
  modeWash,
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
/** `rows` with every run on `from` moved to `to`. */
const rebg = (rows: Row[], from: string, to: string): Row[] =>
  rows.map((r) => r.map((x) => (x.bg === from ? { ...x, bg: to } : x)))
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
  /** The drop zone's own gradient and blend, when it is not the band's (L6–L8). */
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
  pastel: { stops: stopsAt(0.76), mix: labMix },
  /** L5's washed band over L1's drop zone. */
  mixed: {
    stops: stopsAt(0.62),
    mix: labMix,
    wash: true,
    washDots: false,
    dots: { stops: LIGHT_STOPS, mix },
  },
}

/** Light's neutral greys a step darker where the panels sit, so they stand off the white. */
const LIGHT_DEEPER: Palette = {
  ...LIGHT_NEUTRAL,
  selectionBg: '#dadada',
  shelf: '#e8e8e8',
  panelBand: '#c8c8c8',
  tabChip: '#e4e4e4',
}
/** And two steps. */
const LIGHT_DEEPEST: Palette = {
  ...LIGHT_NEUTRAL,
  selectionBg: '#cfcfcf',
  shelf: '#dfdfdf',
  panelBand: '#bdbdbd',
  tabChip: '#dadada',
}

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
      // Without a look, the palette's own wash, as brandRows draws it.
      const own = LOOK ? undefined : modeWash(p, mode)
      return run(
        '╱',
        fg,
        LOOK?.wash ? washOf(fg) : own && gradientAt(from + i + row * 2, span, own),
      )
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

/** The dotted surface, as `dotted` in home-art draws it. */
function dotted(p: Palette, mode: ShellMode, lines: Row[], h = 8): Row[] {
  const fill = p.selectionBg
  const stops =
    LOOK?.dots?.stops[mode] ??
    (LOOK || p === LIGHT_NEUTRAL ? stopsFor(p, mode) : dotGradient(p, mode))
  const isDot = (c: number) => c % 3 === 0 && c >= 3 && c <= W - 4
  const mid = (h - 1) / 2
  const dot = (c: number, r: number) => {
    const tint = gradientAt(c + r * 2, W + 14, stops)
    const dx = Math.abs(c - W / 2) / (W / 2)
    const dy = Math.abs(r - mid) / mid
    return (LOOK?.dots?.mix ?? LOOK?.mix ?? mix)(
      cellFill(c, r),
      tint,
      0.5 + 0.4 * Math.min(1, Math.hypot(dx, dy * 0.6)),
    )
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
          ? run('·', dot(c, r), cellFill(c, r))
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

function home(p: Palette, mode: ShellMode): Row[] {
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
  const panel = mode === 'colour' ? colourCards(p) : dotted(p, mode, words)
  const field = mode === 'colour' ? [[], [], []] : shelf(p, mode, 'or type a path')
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

/* ------------------------------------------------------------- colour */

/** Colour home's cards, with the chosen card's strip in `strip` when given. */
function colourCards(p0: Palette, strip?: (p: Palette) => string): Row[] {
  const p = modePalette(p0, 'colour')
  const cards = choiceCards({ width: N, palette: p, selected: 1, samples: COLOUR_SAMPLES })
  if (!strip) return cards
  return rebg(cards, mix(p.panelBand, p.accent, 0.55), strip(p))
}

function colourHomeWith(p: Palette, strip?: (p: Palette) => string): Row[] {
  const tabs = tabRows({
    width: N,
    palette: p,
    mode: 'colour',
    savesTo: '',
    right: { label: 'copies to', value: 'clipboard' },
  })
  return frame(
    [[], ...brand(p, 'colour'), [], ...tabs, ...colourCards(p, strip)],
    keys(
      p,
      [
        ['↔', 'choose'],
        ['↵', 'open'],
      ],
      [
        [MODE_KEYS, 'mode'],
        ['ctrl-n', 'new'],
        ['ctrl-c', 'quit'],
      ],
    ),
  )
}

const bar = (p: Palette, mode: ShellMode, answers: string[], current: string) =>
  trailBarRow({
    width: N,
    palette: p,
    mode,
    trail: { answers, current },
    slanted: true,
    chip: { label: mode, colour: modeColours(p, mode).fg, stops: stopsFor(p, mode) },
  })

/* ---------------------------------------------- commands (part 12) */

/** A colour for "/", the commands, as each theme draws it, and the two ends of its band. */
interface Hue {
  id: string
  name: string
  dark: { fg: string; stops: string[] }
  light: { fg: string; stops: string[] }
  note: string
}
const HUES: Hue[] = [
  {
    id: 'K1',
    name: 'Gold, the brand’s',
    dark: { fg: '#e5a23c', stops: ['#e5a23c', '#f2cf6b'] },
    light: { fg: '#9a6005', stops: ['#b86e00', '#c99a12'] },
    note: 'The product’s own colour: the commands are the app itself, not a mode of it. Close to where pdf’s band ends, but pdf starts red.',
  },
  {
    id: 'K2',
    name: 'Blue',
    dark: { fg: '#6f9cf5', stops: ['#5b8def', '#8fb4ff'] },
    light: { fg: '#2a55b0', stops: ['#2a55b0', '#3d7be0'] },
    note: 'The one hue no mode has. The same blue as Save as’s "new folder" tag.',
  },
  {
    id: 'K3',
    name: 'Lime',
    dark: { fg: '#b5d94a', stops: ['#ace02c', '#d6e86a'] },
    light: { fg: '#5a7a00', stops: ['#5a7a00', '#7d9a00'] },
    note: 'Bright and unlike any mode; compress is green, but a deeper, bluer one.',
  },
  {
    id: 'K4',
    name: 'Silver',
    dark: { fg: '#d0d0d0', stops: ['#8a8a8a', '#e6e6e6'] },
    light: { fg: '#4a4a4a', stops: ['#3a3a3a', '#9a9a9a'] },
    note: 'No colour: the commands are settings, quieter than any mode. The band is a grey ramp.',
  },
]

type Heading = 'today' | 'rule' | 'chip' | 'caps' | 'hatch' | 'slant'
const HEADINGS: Array<[string, string, Heading, string]> = [
  [
    'C0',
    'Today',
    'today',
    'A dim word, the same grey as the descriptions: nothing says it is a heading.',
  ],
  [
    'C1',
    'Word and rule',
    'rule',
    'The heading in the commands’ colour, bold, and a quiet rule running on to the panel’s end — the way Save as parts its name from its folders.',
  ],
  [
    'C2',
    'Tinted chip',
    'chip',
    'The heading on a chip of the commands’ tint, like the formats chip on Done.',
  ],
  ['C3', 'Spaced capitals', 'caps', 'M O D E S in the commands’ colour: a label, not a row.'],
  [
    'C4',
    'Hatched',
    'hatch',
    'The heading knocked out of a short run of the band’s hatching — the logo’s band, in small.',
  ],
  ['C5', 'Slanted chip', 'slant', 'A slanted chip, as the header bar draws its answers.'],
]

const hueOf = (p: Palette, h: Hue) => (p.name === 'light' ? h.light : h.dark)

/** A heading row's runs after the indent, in `style`. */
function headingRuns(
  p: Palette,
  c: { fg: string; stops: string[] },
  word: string,
  style: Heading,
  room: number,
): Run[] {
  const tint = mix(p.selectionBg, c.fg, p.name === 'light' ? 0.16 : 0.22)
  switch (style) {
    case 'today':
      return [run(word, p.border)]
    case 'rule':
      return [
        run(word, c.fg, undefined, true),
        run(` ${'─'.repeat(Math.max(0, room - word.length - 1))}`, p.faint),
      ]
    case 'chip':
      return [run(` ${word} `, c.fg, tint, true)]
    case 'caps':
      return [run(word.toUpperCase().split('').join(' '), c.fg, undefined, true)]
    case 'hatch':
      return [
        ...Array.from({ length: 2 }, (_, i) => run('╱', gradientAt(i, 14, c.stops))),
        run(` ${word} `, c.fg, undefined, true),
        ...Array.from({ length: 10 }, (_, i) => run('╱', gradientAt(i + 4, 14, c.stops))),
      ]
    case 'slant':
      return [run('\u{e0ba}', tint), run(` ${word} `, c.fg, tint, true), run('\u{e0bc}', tint)]
  }
}

/** Home with "/" typed: the commands in `hue`, headed in `style`. */
function commandsHome(p: Palette, mode: ShellMode, hue: Hue | undefined, style: Heading): Row[] {
  const c = hue ? hueOf(p, hue) : { fg: modeColours(p, mode).fg, stops: [...modeGradient(p, mode)] }
  const look: Look | undefined = hue
    ? {
        stops: Object.fromEntries(MODE_ORDER.map((m) => [m, c.stops])) as Record<
          ShellMode,
          string[]
        >,
        mix,
      }
    : undefined
  const modeFg = modeColours(p, mode).fg
  const tabs = tabRows({ width: N, palette: p, mode, savesTo: '~/Desktop', commands: true }).map(
    (r) => r.map((x) => (x.text === '/' && x.fg === modeFg ? { ...x, fg: c.fg } : x)),
  )
  const list = listCommands('')
  const selected = list.items.findIndex((x) => x.name === 'theme')
  const rows = commandRows({ width: N, palette: p, rows: 10, max: 14, ...list, selected }).map(
    (r) => {
      const at = r.findIndex(
        (x) => (x.text === 'modes' || x.text === 'settings') && x.fg === p.border,
      )
      if (at >= 0) {
        const word = r[at]?.text ?? ''
        const fill = r[0 + 1]?.bg
        const body = headingRuns(p, c, word, style, W - 8).map((x) => ({ ...x, bg: x.bg ?? fill }))
        return [blank(M), run('    ', undefined, fill), ...pad(body, W - 4, fill)]
      }
      // The chosen setting's strip takes the commands' colour.
      return hue ? r.map((x) => (x.text === '▌' && x.fg === p.fg ? { ...x, fg: c.fg } : x)) : r
    },
  )
  const bg = p.shelf
  const line = (r: Row): Row => [blank(M), ...pad(r, W, bg)]
  const field = [
    line([]),
    line([
      run('  ', undefined, bg),
      run('›', c.fg, bg, true),
      run(' ', undefined, bg),
      run('/', p.fg, bg, true),
      run(' ', undefined, p.fg),
    ]),
    line([]),
  ]
  return withLook(look, () =>
    frame(
      [[], ...brand(p, mode), [], ...tabs, ...rows, ...field],
      keys(
        p,
        [
          ['↑↓', 'choose'],
          ['↵', 'run'],
        ],
        [
          ['esc', 'clear'],
          ['ctrl-c', 'quit'],
        ],
      ),
    ),
  )
}

/* ------------------------------------------- extensions (part 12) */

/**
 * `/extensions` as ExtensionsFlow lays it out — the bar, the list of tools on
 * the left, the sheet on the right past a faint rule, the keys under it —
 * with the screen's colour (today enhance's violet) given by `c`.
 */
function extensionsScreen(
  p: Palette,
  c: { fg: string; stops: string[] },
  installing: boolean,
): Row[] {
  const LIST = 27
  const header = trailBarRow({
    width: N,
    palette: p,
    mode: 'convert',
    trail: installing
      ? { answers: ['Boost resolution'], current: 'Installing' }
      : { answers: [], current: 'Extensions' },
    slanted: true,
    chip: { label: 'extensions', colour: c.fg, stops: c.stops },
  })
  const cursor = installing ? 0 : 1
  const tools: Array<[string, string]> = [
    ['Boost resolution', installing ? '⠹' : '✓'],
    ['Remove background', ''],
  ]
  const list: Row[] = tools.map(([name, mark], i) => {
    const me = i === cursor
    const bg = me && p.listBand ? p.listBand : undefined
    const left: Row = me
      ? [run('▌ ', c.fg, bg), run(name, p.fg, bg, true)]
      : [run('  '), run(name, p.dim)]
    const right: Row = mark ? [run(`${mark} `, installing && i === 0 ? c.fg : p.dim, bg)] : []
    return [...pad(left, LIST - width(right), bg), ...right]
  })
  const pill = (t: string) => run(` ${t} `, p.ink, p.pill, true)
  const sheet: Row[] = installing
    ? [
        [run('Boost resolution', p.fg, undefined, true)],
        [run('Sharpen · Boost resolution 2× · 4×', p.dim)],
        [],
        [
          run(' '.repeat(7), undefined, p.trackFill),
          run(' '.repeat(9), undefined, p.track),
          run('  '),
          run('6.2', p.fg, undefined, true),
          run(' of 14.9 MB', p.dim),
        ],
      ]
    : [
        [run('Remove background', p.fg, undefined, true)],
        [run('Cutouts, as transparent PNG', p.dim)],
        [],
        [pill('↵ install'), run('  32.5 KB', p.dim)],
      ]
  const body: Row[] = sheet.map((r, i) => [
    blank(M),
    ...(list[i] ?? [blank(LIST)]),
    blank(1),
    run('│', p.faint),
    blank(2),
    ...r,
  ])
  const k = installing
    ? keys(p, [['esc', 'stop']], [['ctrl-c', 'quit']])
    : keys(
        p,
        [
          ['↑↓', 'choose'],
          ['↵', 'install'],
        ],
        [
          ['i', 'about'],
          ['esc', 'home'],
          ['ctrl-c', 'quit'],
        ],
      )
  return frame([header, [], ...body, [], ...k])
}

const enhanceHue = (p: Palette) => ({
  fg: modeColours(p, 'enhance').fg,
  stops: [...modeGradient(p, 'enhance')],
})

/* ------------------------------------------------------------ save as */

const FW = 76
const FOLDERS = [
  { label: 'Same folder', path: '~/Desktop', isDefault: true },
  { label: 'Downloads', path: '~/Downloads' },
  { label: 'New subfolder', path: '~/Desktop/Id card' },
]

/* --------------------------------------------------------------- done */

const SMALLER: DoneFacts & { to: string } = {
  mode: 'convert',
  before: { format: 'PNG', name: 'Id card.png', bytes: 1_900_000 },
  after: { name: 'Id card.webp', bytes: 165_000 },
  folder: '~/Desktop',
  to: 'WebP',
}
const LARGER: DoneFacts & { to: string } = {
  mode: 'convert',
  before: { format: 'GIF', name: 'logo.gif', bytes: 120_000 },
  after: { name: 'logo.png', bytes: 210_000 },
  folder: '~/Desktop',
  to: 'PNG',
}

/* --------------------------------------------------- part three: save as */

const NAME = 'Id card'
const EXT = '.webp'

/** The pieces every version shares. */
function kit(p0: Palette) {
  const p = modePalette(p0, 'convert')
  const { fg: accent, bg: tint } = modeColours(p, 'convert')
  const caret = run(' ', undefined, p.fg)
  const tag = run(' default ', p.defaultTag, p.defaultTagBg)
  return { p, accent, tint, caret, tag }
}

/** A folder row in a list `w` wide: the highlighted one banded, barred and with its path; the rest a name. */
function folderLine(
  p: Palette,
  f: (typeof FOLDERS)[number],
  sel: boolean,
  w: number,
  bg: string | undefined,
  marker: { on: Run; off: Run } = { on: run('▌', p.fg), off: run(' ') },
): Row {
  const band = sel ? p.fieldBand : bg
  const m = sel ? marker.on : marker.off
  const body: Row = [
    { ...m, bg: band },
    run(' ', undefined, band),
    run(sel ? f.label.padEnd(16) : f.label, sel ? p.fg : p.dim, band, sel),
    ...(sel ? [run(f.path, p.border, band)] : []),
  ]
  const tag: Row = f.isDefault
    ? [run(' default ', p.defaultTag, p.defaultTagBg), run(' ', undefined, band)]
    : []
  return [...pad(body, w - width(tag), band), ...tag]
}
const pathLine = (p: Palette, bg?: string): Row => [
  run('  ', undefined, bg),
  run('Type the path here', p.dim, bg),
  run('  or drop a folder', p.border, bg),
]
const fill = (r: Row, w: number, bg?: string): Row => pad(r, w, bg)
const at2 = (r: Row): Row => [blank(M), ...r]

/* ---------------------------------------------- part four: save as, V10 */

type NameLook = 'fill' | 'underline' | 'both'
type PathState = 'rest' | 'moved' | 'defaulted' | 'typing' | 'new' | 'dropped' | 'file' | 'many'

/**
 * V10, the pick: one block with a mode-coloured left edge, the name above a
 * rule and the folders below it. The name is a tinted box, underlined, or
 * both. The last row is where a path goes: ↓ past the folders and type, or
 * drop a folder anywhere on the screen.
 */
function v10(p0: Palette, look: NameLook, state: PathState): Row[] {
  const { p, accent, tint, caret } = kit(p0)
  const bg = p.selectionBg
  const edge = mix(bg, accent, 0.7)
  const box = (r: Row): Row =>
    at2([run(' ', undefined, edge), ...fill([run('  ', undefined, bg), ...r], FW - 1, bg)])
  const NAME_W = 26
  const filled = look !== 'underline'
  // The caret stays in the name while ↑↓ moves through the folders.
  const onName = state === 'rest' || state === 'moved' || state === 'defaulted'
  const many = state === 'many'
  const nameRow = many
    ? box([run('files   ', p.border, bg), run('Id card-1.png … Id card-12.png', p.dim, bg)])
    : box([
        run('name    ', p.border, bg),
        ...(filled
          ? [
              run(` ${NAME}`, p.fg, tint, true),
              onName ? caret : run(' ', undefined, tint),
              run(' '.repeat(NAME_W - NAME.length - 2), undefined, tint),
              run(` ${EXT}`, p.border, bg),
            ]
          : [
              run(NAME, p.fg, bg, true),
              onName ? caret : run(' ', undefined, bg),
              run(EXT, p.border, bg),
            ]),
      ])
  const under =
    look === 'fill' || many
      ? box([])
      : box([run('        ', undefined, bg), run('▔'.repeat(NAME_W), accent, bg)])

  const listW = FW - 13
  const lead = (i: number) => run(i === 0 ? 'to      ' : '        ', p.border, bg)
  const selected = { rest: 0, many: 0, moved: 1, defaulted: 1 }[state as string] ?? -1
  const places = FOLDERS.map((f, i) => ({
    ...f,
    isDefault: state === 'defaulted' ? i === 1 : !!f.isDefault,
  }))
  const folders = places.map((f, i) =>
    box([lead(i), ...folderLine(p, f, i === selected, listW, bg)]),
  )
  const band = p.fieldBand
  /** The path row, highlighted, with `right` at the far end where the default's tag sits. */
  const on = (r: Row, right: Row = []): Row =>
    box([
      lead(1),
      ...fill(
        [run('▌', p.fg, band), run(' ', undefined, band), ...r],
        listW - width(right) - (right.length ? 1 : 0),
        band,
      ),
      ...right,
      ...(right.length ? [run(' ', undefined, band)] : []),
    ])
  // "new folder": the default's tag in blue instead of orange.
  const blue = p.name === 'light' ? '#2a55b0' : '#5b8def'
  const newTag = run(
    ' new folder ',
    p.name === 'light' ? blue : mix(blue, p.canvas, 0.2),
    mix(p.canvas, blue, p.name === 'light' ? 0.14 : 0.2),
  )
  const pathRow: Row = {
    rest: box([lead(1), ...pathLine(p, bg)]),
    moved: box([lead(1), ...pathLine(p, bg)]),
    defaulted: box([lead(1), ...pathLine(p, bg)]),
    many: box([lead(1), ...pathLine(p, bg)]),
    file: on([
      run('Next to photo.jpg'.padEnd(20), p.fg, band, true),
      run('~/Pictures', p.border, band),
    ]),
    typing: on(
      [run('~/Documents/Sc', p.fg, band, true), caret, run('ans', p.border, band)],
      [run('tab completes', p.border, band)],
    ),
    new: on([run('~/Documents/Invoices 2026', p.fg, band, true), caret], [newTag]),
    dropped: on([
      run('Scans'.padEnd(16), p.fg, band, true),
      run('~/Documents/Scans', p.border, band),
    ]),
  }[state]

  const folderKeys: [[string, string][], [string, string][]] = [
    [
      ['↵', 'save'],
      ['↑↓', 'folder'],
      ['tab', 'make default'],
    ],
    [
      ['esc', 'back'],
      ['ctrl-c', 'quit'],
    ],
  ]
  const keyset: Record<PathState, [[string, string][], [string, string][]]> = {
    moved: folderKeys,
    defaulted: folderKeys,
    many: folderKeys,
    file: folderKeys,
    rest: [
      [
        ['↵', 'save'],
        ['↑↓', 'folder'],
        ['tab', 'make default'],
      ],
      [
        ['esc', 'back'],
        ['ctrl-c', 'quit'],
      ],
    ],
    typing: [
      [
        ['↵', 'save here'],
        ['tab', 'complete'],
        ['↑', 'folders'],
      ],
      [
        ['esc', 'clear path'],
        ['ctrl-c', 'quit'],
      ],
    ],
    new: [
      [
        ['↵', 'make it and save'],
        ['↑', 'folders'],
      ],
      [
        ['esc', 'clear path'],
        ['ctrl-c', 'quit'],
      ],
    ],
    dropped: [
      [
        ['↵', 'save'],
        ['↑↓', 'folder'],
        ['tab', 'make default'],
      ],
      [
        ['esc', 'back'],
        ['ctrl-c', 'quit'],
      ],
    ],
  }
  const head = [
    bar(p0, 'convert', ['WebP', '80'], 'Save as'),
    [],
    titleRow({ palette: p0, mode: 'convert', title: 'Save as', width: N }),
    [],
  ]
  const body = [
    box([]),
    nameRow,
    under,
    box([run('─'.repeat(FW - 6), p.faint, bg)]),
    box([]),
    ...folders,
    pathRow,
    box([]),
  ]
  const [main, foot] = keyset[state]
  return frame([...head, ...body], keys(p0, main, foot))
}

/* ------------------------------------------------------ done, as built */

/** Done as the branch draws it now: the app's own body and layout. */
function doneBuilt(p0: Palette, f: DoneFacts & { to: string }): Row[] {
  const p = modePalette(p0, f.mode)
  const facts: DoneFacts = { mode: f.mode, before: f.before, after: { ...f.after, format: f.to } }
  const body = doneBody({ palette: p, facts, width: N })
  const { top } = doneLayout({ height: H, body: body.length, notes: 0 })
  const grew = f.after.bytes > f.before.bytes
  return frame(
    [bar_(p0, f, grew), [], ...Array.from({ length: top }, (): Row => []), ...body],
    keys(
      p0,
      [
        ['↵', 'convert another'],
        ['o', 'open'],
        ['s', 'show in Finder'],
      ],
      [['ctrl-c', 'quit']],
    ),
  )
}
const bar_ = (p0: Palette, f: DoneFacts, grew: boolean) =>
  bar(
    p0,
    f.mode,
    grew ? ['PNG', 'Desktop', 'logo.png'] : ['WebP', '80', 'Desktop', 'Id card.webp'],
    'Done',
  )

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
  note?: string
  pick?: boolean
  draw: (p: Palette) => Row[] | Row[][]
  /** The palettes to draw in, when not dark and light. */
  palettes?: Palette[]
  /** Only the top this many rows of each frame. */
  crop?: number
}

function figure(f: Fig): string {
  const multi = Array.isArray(f.draw(DARK)[0]?.[0])
  const both = (f.palettes ?? [DARK, LIGHT])
    .map((p) => {
      const d = f.draw(p)
      const frames = (Array.isArray(d[0]?.[0]) ? d : [d]) as Row[][]
      return `<div class="theme ${f.palettes ? 'fixed' : p.name}">${frames.map((fr) => html(fr, p, f.crop)).join('')}</div>`
    })
    .join('')
  return `<figure${multi || f.palettes ? ' class="wide"' : ''}><div class="vt"><span class="id">${f.id}</span><span class="name">${f.name}</span>${f.pick ? '<span class="pick">MY PICK</span>' : ''}</div>${both}${f.note ? `<p class="idea">${f.note}</p>` : ''}</figure>`
}

interface Tab {
  id: string
  title: string
  intro: string
  extra?: string
  figs: Fig[]
}

const S = SMALLER
const Lg = LARGER

const MID: DoneFacts & { to: string } = {
  mode: 'convert',
  before: { format: 'PNG', name: 'poster.png', bytes: 2_400_000 },
  after: { name: 'poster.jpg', bytes: 1_600_000 },
  folder: '~/Desktop',
  to: 'JPEG',
}

const V10C: Array<[string, string, PathState, string]> = [
  [
    '1',
    'At rest',
    'rest',
    'The caret in the name; the folder it will save to highlighted, with its path; the default tagged.',
  ],
  [
    '2',
    '↓ to another folder',
    'moved',
    'The highlight moves; the caret stays in the name, so ↵ saves with whatever name is typed. Only the highlighted folder shows its path.',
  ],
  [
    '3',
    'tab: make it the default',
    'defaulted',
    'The tag moves to the highlighted folder at once.',
  ],
  [
    '4',
    'Typing a path',
    'typing',
    '↓ past the last folder onto the path row, and type. The rest of a matching folder shows dim; tab takes it.',
  ],
  [
    '5',
    'A folder that does not exist yet',
    'new',
    'The blue "new folder" tag where the default\'s sits; ↵ makes it and saves there.',
  ],
  [
    '6',
    'A dropped folder',
    'dropped',
    'Dropped anywhere on the screen, it lands on the path row, chosen: its name and where it is.',
  ],
  [
    '7',
    'A dropped file',
    'file',
    'A file means "save next to it": the row says so, with its folder.',
  ],
  [
    '8',
    'Many files',
    'many',
    'A document rasterised a page at a time: the names are fixed, so the name row says what will be written and is not editable.',
  ],
]

/** Light's gradients: today's, part five's proposal, and the four new looks. */
const LIGHT_LOOKS: Array<[string, string, Look | undefined, Palette, string]> = [
  [
    'L0',
    'Built: L6',
    undefined,
    LIGHT,
    'What the branch now draws: L6, from the app’s palette. (Before it, the gradients ran between the mode colours, which are deep because they are also text colours, and blend in plain RGB. So convert and enhance are dark and heavy; enhance barely moves (violet to violet); pdf runs red into the brand’s brown; colour is magenta to violet, not a spectrum. The dots are those colours blended into a beige fill, which is where the mud came from.)',
  ],
  [
    'L1',
    'Part five’s proposal',
    LOOKS.proposal,
    LIGHT_NEUTRAL,
    'Dark’s hues, each darkened until it reads 4.5:1 on white. Legible, and it fixes the hues, but every stop is pushed dark — saturated but heavy. Kept for comparison.',
  ],
  [
    'L2',
    'Vivid',
    LOOKS.vivid,
    LIGHT_NEUTRAL,
    'Dark’s hues walked in OKLCH, the hue turning the short way round with midpoints every few columns, every step at the same lightness (0.64) and as much chroma as the screen can show there. Even weight end to end; no grey dip in the middle. The dots fade into the fill in OKLab, so they go paler, not muddier.',
  ],
  [
    'L3',
    'Jewel',
    LOOKS.jewel,
    LIGHT_NEUTRAL,
    'L2 one step deeper (0.54): richer, more ink on the page, closer to how the dark theme’s colours sit on black. Thin hatching holds up better at this weight.',
  ],
  [
    'L4',
    'Pastel',
    LOOKS.pastel,
    LIGHT_NEUTRAL,
    'L2 one step lighter (0.76): the soft pastel the advice suggests. Airy, but thin hatching and small dots start to fade into white — shown so you can see where that line is.',
  ],
  [
    'L5',
    'Vivid on a wash',
    LOOKS.wash,
    LIGHT_NEUTRAL,
    'The high-key tint idea: every hatch cell sits on a near-white tint of its own colour, so FORGE is knocked out of a soft coloured band rather than out of thin lines; the drop zone’s fill becomes the same faint tint, running with the gradient. The lines are L2’s, slightly deeper.',
  ],
  [
    'L6',
    'L5’s band, L1’s drop zone',
    LOOKS.mixed,
    LIGHT_NEUTRAL,
    'Your mix: the logo’s hatching on its wash (L5), the drop zone back on its grey with L1’s deeper dots.',
  ],
  [
    'L7',
    'L6, greys a step darker',
    LOOKS.mixed,
    LIGHT_DEEPER,
    'The drop zone #dadada (from #e4e4e4), the field’s shelf #e8e8e8 (from #f3f3f3), the active tab #e4e4e4 (from #f0f0f0): the panels stand off the white, and the dots have a firmer ground.',
  ],
  [
    'L8',
    'L6, greys two steps darker',
    LOOKS.mixed,
    LIGHT_DEEPEST,
    'The drop zone #cfcfcf, the shelf #dfdfdf, the tab #dadada. Near where light mode stops feeling light.',
  ],
  [
    'L9',
    'L5, greys a step darker',
    LOOKS.wash,
    LIGHT_DEEPER,
    'L5 as it was, washed drop zone and all, with the shelf and the active tab a step darker.',
  ],
]

/** The gradient itself, a cell a step, for every look and mode: what a terminal shows. */
const strips = `<table class="lt"><tr><th></th>${MODE_ORDER.map((m) => `<th>${m}</th>`).join('')}</tr>${LIGHT_LOOKS.map(
  ([id, name, look, p]) =>
    `<tr><td>${id} · ${name}</td>${MODE_ORDER.map((m) => {
      const stops = withLook(look, () => stopsFor(p, m))
      return `<td><div style="display:flex;background:#fff;padding:6px;border-radius:4px">${Array.from(
        { length: 28 },
        (_, i) =>
          `<span style="width:7px;height:16px;background:${gradientAt(i, 28, stops)}"></span>`,
      ).join('')}</div></td>`
    }).join('')}</tr>`,
).join('')}</table>`

const TABS: Tab[] = [
  {
    id: 'extensions',
    title: 'Extensions · in each colour',
    intro:
      '<code>/extensions</code> is a setting, reached from the commands, so with “/” given a colour of its own it would take that colour instead of enhance’s violet: the bar’s chip and hatching, the chosen tool’s strip, the spinner while it installs. Everything else on the screen stays as it is. Two states each — browsing, and a download under way — in dark and in light (light on L5’s neutral greys).',
    figs: [
      {
        id: 'E0',
        name: 'Today: enhance’s violet',
        palettes: [DARK, LIGHT],
        crop: 12,
        draw: (p: Palette) => [
          extensionsScreen(p, enhanceHue(p), false),
          extensionsScreen(p, enhanceHue(p), true),
        ],
      },
      ...HUES.map((h) => ({
        id: h.id.replace('K', 'E'),
        name: `${h.id} · ${h.name}`,
        palettes: [DARK, LIGHT_NEUTRAL],
        crop: 12,
        draw: (p: Palette) => [
          extensionsScreen(p, hueOf(p, h), false),
          extensionsScreen(p, hueOf(p, h), true),
        ],
      })),
    ],
  },
  {
    id: 'commands',
    title: 'Commands · colour and headings',
    intro:
      '“/ commands” gets a colour of its own, the way each mode has one: the band, the "/" on its tab, the field’s marker and the chosen setting’s strip all take it (a mode’s row keeps its mode’s strip — it says where ↵ goes). First the colour, four ways, each with C1’s headings; then the headings, six ways, in K1’s gold. Pick one of each.',
    figs: [
      {
        id: 'K0',
        name: 'Today: the mode’s colour',
        draw: (p: Palette) => commandsHome(p, 'convert', undefined, 'today'),
      },
      ...HUES.map((h) => ({
        id: h.id,
        name: h.name,
        note: h.note,
        draw: (p: Palette) => commandsHome(p, 'convert', h, 'rule'),
      })),
      ...HEADINGS.map(([id, name, style, note]) => ({
        id,
        name,
        note,
        draw: (p: Palette) => commandsHome(p, 'convert', HUES[0], style),
      })),
    ],
  },
  {
    id: 'light',
    title: 'Light mode · gradients',
    intro:
      'Light mode’s gradients, beside today’s; L6–L9 are the round after your L5 pick. Each is the home screen in all five modes, drawn by the app’s code with only the gradient swapped (and the greys made neutral, as part five proposed). What carries over from the advice: blend in OKLCH, not RGB, so there is no grey dead zone; add midpoints along the hue path; keep lightness level so the band has an even weight; fade into the background rather than into a colour. What does not: grain and banding — a terminal cell holds one colour and a gradient here is about seventy cells wide, so every cell already gets its own step and there is nothing to band; noise would read as stray glyph colours.',
    extra: strips,
    figs: LIGHT_LOOKS.map(([id, name, look, p, note]) => ({
      id,
      name,
      note,
      palettes: [p],
      crop: 19,
      draw: (pal: Palette) => withLook(look, () => MODE_ORDER.map((m) => home(pal, m))),
    })),
  },
  {
    id: 'branch',
    title: 'On the branch',
    intro:
      'Built and running in <code>npm run dev</code>: H2, G4, P2, C4, Done (B6a) with the new size on a grey chip, light mode L6 (switch to light above), and the commands in the brand’s gold (K1) — the band, the "/" on its tab, the field’s marker, a chosen setting’s strip and <code>/extensions</code>. The live Done screen leaves out "in ~/Desktop" as you asked; the scrollback record keeps it, because a mistyped destination once saved somewhere unexpected without a word (audit #9), and the record is where that has to stay answered.',
    figs: [
      { id: 'H2', name: 'Home · convert', draw: (p) => home(p, 'convert') },
      { id: 'G4', name: 'Home · colour', draw: (p) => colourHomeWith(p) },
      {
        id: 'Done',
        name: 'Done · 91% smaller · 33% smaller · 75% larger',
        draw: (p) => [doneBuilt(p, S), doneBuilt(p, MID), doneBuilt(p, Lg)],
      },
    ],
  },
  {
    id: 'saveas',
    title: 'Save as · V10c, before it is built',
    intro:
      'Every state Save as can be in, as it will be built. The name is filled and underlined; the folders sit under a rule, lean but for the highlighted one; the last row takes a path.',
    figs: V10C.map(([id, name, state, note]) => ({
      id,
      name,
      note,
      draw: (p: Palette) => v10(p, 'both', state),
    })),
  },
]

const page = `<!doctype html>
<html lang="en"><head><meta charset="utf-8" />
<title>Convert — round 5, part twelve</title>
<style>
  :root { --page:#0d0e11; --ink:#e2e4ea; --muted:#8f94a1; --rule:#23252c; --card:#14161a; --cyan:#55c7d9; --mono:"SF Mono", ui-monospace, Menlo, monospace; --sans:-apple-system, BlinkMacSystemFont, "Helvetica Neue", sans-serif; }
  * { box-sizing:border-box; }
  body { margin:0; background:var(--page); color:var(--ink); font:16px/1.6 var(--sans); }
  main { max-width:1500px; margin:0 auto; padding:44px 24px 120px; }
  h1 { font-size:32px; margin:0 0 8px; }
  .lede { color:var(--muted); max-width:900px; margin:0; }
  .tabs { position:sticky; top:0; z-index:5; display:flex; flex-wrap:wrap; gap:6px; margin:22px -24px 0; padding:12px 24px; background:rgba(13,14,17,.94); border-bottom:1px solid var(--rule); align-items:center; }
  .tabs a { font:13px var(--mono); color:var(--muted); text-decoration:none; border:1px solid var(--rule); padding:6px 12px; border-radius:8px; cursor:pointer; }
  .tabs a.on { color:#0c1d22; background:var(--cyan); border-color:var(--cyan); font-weight:700; }
  .tabs .sp { flex:1; }
  .tabs label { font:13px var(--mono); color:var(--muted); display:flex; gap:6px; align-items:center; }
  section { display:none; margin-top:30px; } section.on { display:block; }
  .intro { color:#c7cbd4; max-width:1000px; }
  .grid { display:grid; grid-template-columns:repeat(auto-fill, minmax(680px, 1fr)); gap:34px 22px; margin-top:22px; }
  figure.wide { grid-column:1 / -1; }
  body.both figure { grid-column:1 / -1; }
  figure { margin:0; }
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
  i.o { background:linear-gradient(currentColor 2px, transparent 2px); }
  i.si { background:linear-gradient(to bottom right, transparent 50%, currentColor 50%); }
  i.so { background:linear-gradient(to bottom right, currentColor 50%, transparent 50%); }
  code { font:.9em var(--mono); background:#1c1e24; padding:1px 5px; border-radius:4px; }
  table.lt { border-collapse:collapse; margin-top:18px; font:13px var(--mono); }
  table.lt th, table.lt td { text-align:left; padding:5px 18px 5px 0; border-bottom:1px solid #23252c; color:#c9ccd3; }
  table.lt th { color:#7c818c; font-weight:600; }
  .sw { display:inline-block; width:14px; height:14px; border-radius:3px; vertical-align:-2px; margin-right:6px; }
  .ok { color:#6fcf7f; } .no { color:#e8796d; }
</style></head>
<body class="only-dark"><main>
<h1>Round 5 · part twelve</h1>
<p class="lede">Light mode’s gradients, and what is on the branch. Earlier parts are kept as <code>round-5a</code> to <code>-5k</code>. Drawn by the app's own code at 80 × 24; switch dark and light at the right of the tab bar (the light-mode tab is light only).</p>
<div class="tabs">${TABS.map((t, i) => `<a data-t="${t.id}"${i === 0 ? ' class="on"' : ''}>${t.title}</a>`).join('')}<span class="sp"></span>
<label><input type="radio" name="th" value="only-dark" checked> dark</label><label><input type="radio" name="th" value="only-light"> light</label><label><input type="radio" name="th" value="both"> both</label></div>
${TABS.map((t, i) => `<section id="s-${t.id}"${i === 0 ? ' class="on"' : ''}><p class="intro">${t.intro}</p>${t.extra ?? ''}<div class="grid">${t.figs.map(figure).join('')}</div></section>`).join('\n')}
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

/** For generating the palette's constants from the same functions. */
export { GREYS, LIGHT_NEUTRAL, LIGHT_STOPS, oklchStops, stopsAt, washOf }

const out = new URL('../mockups/round-5-2026-10.html', import.meta.url)
writeFileSync(out, page)
console.log('wrote', decodeURIComponent(out.pathname), page.length)
