import stringWidth from 'string-width'
import { type Alpha, composite } from '../../core/colour/alpha.js'
import { onWhiteAndBlack, rate } from '../../core/colour/contrast.js'
import type { MixSpace } from '../../core/colour/mix.js'
import { OUTSIDE, TRANSPARENT } from '../../core/colour/palette.js'
import { type StepSpec, scale, stepsOf } from '../../core/colour/scale.js'
import { parseHex, type Rgb, toHex } from '../../core/colour/space.js'
import { blank, mix, type Row, type Run, surfaceRows, width } from '../home-art.js'
import type { Palette } from '../theme.js'

/**
 * Colour mode's screens as rows of runs — data, so they can be held cell for
 * cell to the decided flow (mockups/colour-2026-10.html, ★ Flow; colour spec
 * §6) without Ink. `ColourFlow` draws them with `Runs`.
 *
 * The palette passed in is `modePalette(palette, 'colour')`, so `accent` is
 * the mode's own colour. Colours are written lowercase, as a terminal reports
 * them back.
 */

const lc = (h: string): string => h.toLowerCase()
const ink = (text: string, fg: string, bold = false): Run => ({ text, fg: lc(fg), bold })
const fill = (text: string, bg: string): Run => ({ text, bg: lc(bg) })
const isHex = (s: string): boolean => /^#[0-9a-f]{6}$/i.test(s)

/** `runs` on `bg`, `w` cells wide: a run with no fill of its own takes `bg`. */
function on(bg: string, runs: Row, w: number): Row {
  const row: Row = runs.map((r) => (r.bg ? r : { ...r, bg: lc(bg) }))
  const used = width(row)
  if (used < w) row.push(fill(' '.repeat(w - used), bg))
  return row
}

/** `runs` padded with blanks to `w` cells. */
function pad(runs: Row, w: number): Row {
  const used = width(runs)
  return used < w ? [...runs, blank(w - used)] : runs
}

/** `runs` centred in `w` cells, the extra cell on the right. */
function centre(runs: Row, w: number): Row {
  const left = Math.max(0, Math.floor((w - width(runs)) / 2))
  return pad([blank(left), ...runs], w)
}

const dim = (p: Palette, h: string): string => mix(lc(h), lc(p.canvas), 0.78)
const faint = (p: Palette, h: string): string => mix(lc(h), lc(p.canvas), 0.9)

/* ------------------------------------------------------------- home: C1 */

/**
 * What the two cards preview: a palette (the six colours of the mockup's
 * photo) and a scale (from its blue). Decoration, the same on every run.
 */
export const COLOUR_SAMPLES = {
  palette: ['#356723', '#77A726', '#AD95E9', '#ACE02C', '#6579FD', '#F26E69'],
  scale: scale({ r: 0x65, g: 0x79, b: 0xfd }).map((s) => s.hex),
  /** A palette from one colour: Full set's 500s from #D2042D, then its neutral. */
  system: [
    '#D2042D',
    '#D85B12',
    '#C7930F',
    '#15A64C',
    '#0E9E8C',
    '#1874E5',
    '#9C3DE6',
    '#D53689',
    '#8C7271',
  ],
}

/** A square swatch's width in cells, one row tall. */
const SQUARE = 2

/** The three cards' names and subtitles, each subtitle on two lines (colour spec §12.6). */
export const COLOUR_CARDS = [
  { name: 'Extract', sub: ['extract colours', 'from an image'] },
  { name: 'Scale', sub: ['create shades', 'from one colour'] },
  { name: 'Palette', sub: ['build a palette', 'from one colour'] },
] as const

/**
 * Home's panel in colour mode: three cards, Extract, Scale and Palette, each
 * with a preview of what it makes. The chosen one is on `panelBand`, and that
 * lighter fill is all that marks it (round 5, G4). Without fills to tell
 * them apart, a `▌` in the mode's colour marks it instead. Nine rows: three
 * cards side by side only fit with each subtitle on two lines.
 */
export function choiceCards({
  width: columns,
  palette: p,
  selected,
  samples,
}: {
  width: number
  palette: Palette
  selected: 0 | 1 | 2
  samples: { palette: string[]; scale: string[]; system: string[] }
}): Row[] {
  const W = columns - 4
  // Three cards in the panel: a cell of panel at each side, two between each.
  const CARD = Math.floor((W - 6) / 3)
  // Square swatches, as Scale's ramp draws them: a cell is half as wide as
  // it is tall, so two across and one down. A strip longer than the card
  // keeps its middle (a scale loses its lightest and darkest first).
  const fit = Math.max(1, Math.floor((CARD - 4) / SQUARE))
  const swatches = (hexes: string[]) => {
    const drop = Math.max(0, hexes.length - fit)
    const kept = hexes.slice(Math.floor(drop / 2), hexes.length - Math.ceil(drop / 2))
    return kept.map((h) => fill(' '.repeat(SQUARE), h))
  }
  const previews: Row[] = [
    swatches(samples.palette),
    swatches(samples.scale),
    swatches(samples.system),
  ]
  const card = (i: number): Row[] => {
    const c = COLOUR_CARDS[i] as (typeof COLOUR_CARDS)[number]
    const me = i === selected
    const bg = me ? p.panelBand : p.selectionBg
    const strip: Run = me && !isHex(bg) ? ink('▌', p.accent) : blank(1)
    const line = (txt: Row): Row => on(bg, [strip, blank(1), ...txt], CARD)
    return [
      line([]),
      line([ink(c.name, me ? p.fg : p.dim, true)]),
      line([ink(c.sub[0], me ? p.dim : p.border)]),
      line([ink(c.sub[1], me ? p.dim : p.border)]),
      line([]),
      line(previews[i] as Row),
      line([]),
    ]
  }
  const cards = [card(0), card(1), card(2)]
  const edge: Row = [blank(2), ...on(p.selectionBg, [], W)]
  return [
    edge,
    ...(cards[0] as Row[]).map((row, i) => [
      blank(2),
      ...on(
        p.selectionBg,
        [
          blank(1),
          ...row,
          blank(2),
          ...(cards[1]?.[i] ?? []),
          blank(2),
          ...(cards[2]?.[i] ?? []),
          blank(1),
        ],
        W,
      ),
    ]),
    edge,
  ]
}

/* ----------------------------------------------------------- the field */

/**
 * The field at the top of a colour screen, drawn as the app's other fields
 * are: a filled block three rows tall, neutral grey, no border. `›` is in the
 * mode's colour while the field has focus, dim at rest.
 */
export function fieldRows({
  width: columns,
  palette: p,
  content,
  focus,
}: {
  width: number
  palette: Palette
  content: Row
  focus: boolean
}): Row[] {
  const W = columns - 4
  const lead = blank(2)
  const caret = ink('›', focus ? p.accent : p.border, true)
  return [
    [lead, ...on(p.selectionBg, [], W)],
    [lead, ...on(p.selectionBg, [blank(1), caret, blank(1), ...content], W)],
    [lead, ...on(p.selectionBg, [], W)],
  ]
}

/** The one quiet hint in an empty field. */
export function fieldHint(p: Palette, text: string): Row {
  return [ink(text, p.border)]
}

/**
 * What the field holds: the value (dim at rest, bright while typing), a
 * swatch once a hex is whole, and a quiet detail (size, where it came from).
 */
export function fieldValue({
  palette: p,
  value,
  detail,
  swatch = false,
  typing = false,
}: {
  palette: Palette
  value: string
  detail?: string
  swatch?: boolean
  typing?: boolean
}): Row {
  const row: Row = [ink(value, typing ? p.fg : p.dim)]
  if (swatch && isHex(value)) row.push(blank(2), fill('    ', value))
  if (detail) row.push(blank(3), ink(detail, p.border))
  return row
}

/* --------------------------------------------------------- the palette */

/** The decided drop zone, its title for images and its second line the formats. */
export function dropZone({
  width: columns,
  palette: p,
  typing,
  formats,
}: {
  width: number
  palette: Palette
  typing: boolean
  formats: string
}): Row[] {
  return surfaceRows({
    width: columns,
    rows: 8,
    palette: p,
    mode: 'colour',
    typing,
    kinds: formats,
    title: 'Drop an image here',
  })
}

/**
 * The photo drawn in its own colours, in `▀` half blocks: two pixel rows to
 * a text row. `map` gives each pixel's index into `colours`; the `lit` one is
 * drawn as it is and the rest dimmed. Inside a colour, `map` holds its shades
 * and `OUTSIDE` for the rest of the photo, drawn faint in `outside`'s colours.
 */
export function photoRows({
  palette: p,
  map,
  colours,
  lit,
  outside,
}: {
  palette: Palette
  map: number[][]
  colours: string[]
  lit: number
  outside?: { map: number[][]; colours: string[] }
}): Row[] {
  const at = (y: number, x: number): string | undefined => {
    const v = map[y]?.[x] ?? TRANSPARENT
    if (v === TRANSPARENT) return undefined
    if (v === OUTSIDE) {
      const o = outside?.map[y]?.[x]
      const c = o === undefined ? undefined : outside?.colours[o]
      return c === undefined ? undefined : faint(p, c)
    }
    const c = colours[v]
    if (c === undefined) return undefined
    return v === lit ? lc(c) : dim(p, c)
  }
  const cols = map[0]?.length ?? 0
  return Array.from({ length: Math.ceil(map.length / 2) }, (_, r) =>
    Array.from({ length: cols }, (_, x): Run => {
      const top = at(r * 2, x)
      const bottom = at(r * 2 + 1, x)
      if (top === undefined && bottom === undefined) return blank(1)
      // One colour throughout is a space on it: no glyph, so no seam (halfBlockCell).
      if (top === bottom) return { text: ' ', fg: top, bg: bottom }
      return { text: '▀', ...(top ? { fg: top } : {}), ...(bottom ? { bg: bottom } : {}) }
    }),
  )
}

const BAR = 14
const EIGHTHS = ['', '▏', '▎', '▍', '▌', '▋', '▊', '▉']
const ROW = 42

/** One colour in the list: swatch, hex, a bar as long as its share, the share. */
function listItem(
  p: Palette,
  item: { hex: string; pct: number },
  max: number,
  selected: boolean,
): Row {
  const e = Math.round((item.pct / max) * BAR * 8)
  const bar = '█'.repeat(Math.floor(e / 8)) + EIGHTHS[e % 8]
  const body: Row = [
    fill('    ', item.hex),
    blank(2),
    ...pad([ink(item.hex, selected ? p.fg : p.dim, selected)], 9),
    ...pad([ink(bar, selected ? item.hex : dim(p, item.hex))], BAR + 1),
    blank(1),
    ink(`${item.pct}%`, selected ? p.fg : p.border, selected),
  ]
  return selected
    ? on(p.listBand, [ink('▌', p.accent), blank(1), ...body], ROW)
    : [blank(2), ...body]
}

/** Every other row while they fit beside the photo, every row past that. */
function spaced(items: Row[], rows: number): Row[] {
  if (items.length * 2 > rows) return items
  return items.flatMap((row) => [row, []])
}

/** `row` faded up `k` of the way out of the background: every ink and fill from the canvas. */
function arriving(p: Palette, row: Row, k: number): Row {
  if (k >= 1) return row
  const from = lc(p.canvas)
  return row.map((r) => ({
    ...r,
    ...(r.fg ? { fg: mix(from, r.fg, k) } : {}),
    ...(r.bg ? { bg: mix(from, r.bg, k) } : {}),
  }))
}

/**
 * The palette's list: one colour per row, the chosen one on the picker's
 * band. `arrive` says how far each colour has faded in as a palette comes in
 * (M7), 0 to 1; without it every colour is there.
 */
export function paletteColumn({
  palette: p,
  items,
  selected,
  rows = 12,
  arrive,
}: {
  palette: Palette
  items: { hex: string; pct: number }[]
  selected: number
  rows?: number
  arrive?: number[] | undefined
}): Row[] {
  const max = Math.max(1, ...items.map((i) => i.pct))
  return spaced(
    items.map((item, i) => arriving(p, listItem(p, item, max, i === selected), arrive?.[i] ?? 1)),
    rows,
  )
}

/** Inside a colour: the colour itself on top, then its shades, each a share of it. */
export function insideColumn({
  palette: p,
  parent,
  items,
  selected,
  rows = 12,
}: {
  palette: Palette
  parent: { hex: string; pct: number }
  items: { hex: string; pct: number }[]
  selected: number
  rows?: number
}): Row[] {
  const max = Math.max(1, ...items.map((i) => i.pct))
  const head: Row = [
    blank(2),
    fill('    ', parent.hex),
    blank(2),
    ink(parent.hex, p.fg, true),
    blank(2),
    ink(`${parent.pct}% of the image`, p.border),
  ]
  return [
    head,
    [],
    ...spaced(
      items.map((item, i) => listItem(p, item, max, i === selected)),
      rows - 2,
    ),
  ]
}

/**
 * The photo inside a one-cell frame in the border grey, so where the image
 * starts and ends shows against a dark photo on a dark terminal.
 */
export function framed(p: Palette, photo: Row[]): Row[] {
  const cols = width(photo[0] ?? [])
  const edge = (text: string): Run => ink(text, p.border)
  return [
    [edge(`┌${'─'.repeat(cols)}┐`)],
    ...photo.map((row) => [edge('│'), ...row, edge('│')]),
    [edge(`└${'─'.repeat(cols)}┘`)],
  ]
}

/**
 * The detail line with a key at its far end, one cell short of `w`: what
 * `→` does to the chosen colour, said beside it rather than in the key row.
 * The cap is drawn as the key row draws its caps; without fills, bracketed.
 */
export function withKey(p: Palette, row: Row, key: string, word: string, w: number): Row {
  const cap: Run =
    p.keycapBg === ''
      ? { text: `[${key}]`, fg: p.fg, bold: true }
      : { text: ` ${key} `, fg: p.fg, bg: p.keycapBg, bold: true }
  const tail: Row = [cap, ink(` ${word}`, p.dim)]
  const gap = w - 1 - width(row) - width(tail)
  return gap < 2 ? row : [...row, blank(gap), ...tail]
}

/** The photo at column 4, the list four cells after it. */
export function paletteBody(photo: Row[], list: Row[]): Row[] {
  const cols = width(photo[0] ?? [])
  return Array.from({ length: Math.max(photo.length, list.length) }, (_, r) => [
    blank(4),
    ...(photo[r] ?? [blank(cols)]),
    blank(4),
    ...(list[r] ?? []),
  ])
}

/* ------------------------------------------------------------ the lines */

/**
 * The line under the view, about the chosen colour: the first part bright,
 * the rest dim, two cells apart; a `joined` part follows with no gap, and a
 * `quiet` one is in the border colour.
 */
export function detailRow(
  p: Palette,
  parts: { text: string; strong?: boolean; quiet?: boolean; joined?: boolean }[],
): Row {
  const row: Row = [blank(4)]
  parts.forEach((part, i) => {
    if (i > 0 && !part.joined) row.push(blank(2))
    row.push(ink(part.text, part.strong ? p.fg : part.quiet ? p.border : p.dim, part.strong))
  })
  return row
}

/** What a copy put on the clipboard, in place of the detail line for a moment. */
export function copiedRow(
  p: Palette,
  what: { hex: string } | { count: number },
  platform: NodeJS.Platform = process.platform,
): Row {
  const tick: Row = [blank(4), ink('✓', p.ok, true), blank(1)]
  if ('hex' in what) return [...tick, ink('copied ', p.fg), ink(what.hex, p.fg, true)]
  return [
    ...tick,
    ink(`copied ${what.count} swatches`, p.fg),
    ink(` · paste into Figma with ${platform === 'win32' ? 'Ctrl+V' : '⌘V'}`, p.dim),
  ]
}

/**
 * A confirmation in place of the detail line: a copy, or `r`'s "is now 500".
 * What follows a ` · ` is said quietly.
 */
export function flashRow(p: Palette, text: string): Row {
  const hex = /^copied (#[0-9A-F]{6})$/i.exec(text)
  if (hex) return copiedRow(p, { hex: hex[1] as string })
  const count = /^copied (\d+) swatches$/.exec(text)
  if (count) return copiedRow(p, { count: Number(count[1]) })
  const [first = '', ...rest] = text.split(' · ')
  const row: Row = [blank(4), ink('✓', p.ok, true), blank(1), ink(first, p.fg)]
  if (rest.length > 0) row.push(ink(` · ${rest.join(' · ')}`, p.dim))
  return row
}

/* -------------------------------------------- without colour (NO_COLOR) */

/** `›` on the chosen row, where there is no band to show it. */
const pick = (p: Palette, selected: boolean): Row => [
  blank(2),
  selected ? ink('›', p.accent, true) : blank(1),
]

/** The palette as text: hex and share, one colour a row. */
export function plainPaletteRows({
  palette: p,
  items,
  selected,
}: {
  palette: Palette
  items: { hex: string; pct: number }[]
  selected: number
}): Row[] {
  return items.map((item, i) => [
    ...pick(p, i === selected),
    blank(1),
    ink(item.hex, i === selected ? p.fg : p.dim, i === selected),
    blank(2),
    ink(`${String(item.pct).padStart(3)}%`, p.border),
  ])
}

/** The scale as text: step, hex, and how white and black text read on it. */
export function plainScaleRows({
  palette: p,
  steps,
  selected,
}: {
  palette: Palette
  steps: { step: number; hex: string; white: number; black: number }[]
  selected: number
}): Row[] {
  return steps.map((s, i) => [
    ...pick(p, i === selected),
    ink(String(s.step).padStart(4), i === selected ? p.fg : p.border, i === selected),
    blank(2),
    ink(s.hex, i === selected ? p.fg : p.dim, i === selected),
    blank(2),
    ink(
      `white ${s.white.toFixed(1)} ${rate(s.white)} · black ${s.black.toFixed(1)} ${rate(s.black)}`,
      p.dim,
    ),
  ])
}

/** A refusal, on the line under the field. */
export function errorRow(p: Palette, text: string): Row {
  return [blank(4), ink(text, p.fail)]
}

/** Said once, quietly, where swatches cannot show the colour they name. */
export function approximateRow(p: Palette): Row {
  return [blank(4), ink('colours shown approximately · this terminal has 256 colours', p.border)]
}

/* ------------------------------------------------------------ the scale */

/** The widest a ramp's cell is drawn, however much room there is. */
const CELL = 6

interface StepLike {
  step: number
  hex: string
  reference?: boolean
  seed?: boolean
}

/**
 * How a ramp of `n` steps fits in the field's width (`columns - 4`): cells
 * as wide as fit, up to `CELL`, a blank between them while cells are at
 * least four wide, and none once they are narrower.
 */
function rampFit(columns: number, n: number): { cell: number; gap: number } {
  const room = columns - 4
  const spaced = Math.floor((room - (n - 1)) / n)
  if (spaced >= 4) return { cell: Math.min(CELL, spaced), gap: 1 }
  return { cell: Math.max(1, Math.min(CELL, Math.floor(room / n))), gap: 0 }
}

/**
 * The step numbers over the cells. A number that would touch its
 * neighbour's is left out, the chosen one's first, so the chosen step is
 * always named; `colour` says what each is drawn in.
 */
function labelRow(
  labels: string[],
  fit: { cell: number; gap: number },
  first: number | undefined,
  colour: (i: number) => Run,
  /** Only these cells may be named: an empty ramp names only the outlines it draws. */
  named: (i: number) => boolean = () => true,
): Row {
  const at = (i: number) => i * (fit.cell + fit.gap)
  const placed: { from: number; to: number; i: number }[] = []
  const place = (i: number) => {
    if (!named(i)) return
    const t = labels[i] as string
    const from = Math.max(0, at(i) + Math.floor((fit.cell - stringWidth(t)) / 2))
    const to = from + stringWidth(t)
    if (placed.some((q) => from < q.to + 1 && to + 1 > q.from)) return
    placed.push({ from, to, i })
  }
  if (first !== undefined) place(first)
  labels.forEach((_, i) => {
    if (i !== first) place(i)
  })
  placed.sort((a, b) => a.from - b.from)
  const row: Row = [blank(2)]
  let col = 0
  for (const q of placed) {
    if (q.from > col) row.push(blank(q.from - col))
    row.push(colour(q.i))
    col = q.to
  }
  const end = at(labels.length - 1) + fit.cell
  if (end > col) row.push(blank(end - col))
  return row
}

/** S1: the step numbers, three rows of swatches, and a `▔` under the chosen one. */
export function rampRows({
  width: columns,
  palette: p,
  steps,
  selected,
}: {
  width: number
  palette: Palette
  steps: StepLike[]
  selected: number
}): Row[] {
  const fit = rampFit(columns, steps.length)
  const join = (cells: Row[]): Row => [
    blank(2),
    ...cells.flatMap((c, i) => (i === 0 || fit.gap === 0 ? c : [blank(fit.gap), ...c])),
  ]
  const labels = labelRow(
    steps.map((s) => String(s.step)),
    fit,
    selected,
    (i) => {
      const s = steps[i] as StepLike
      return i === selected
        ? ink(String(s.step), p.fg, true)
        : ink(String(s.step), (s.reference ?? s.seed) ? p.accent : p.border)
    },
  )
  const swatches = join(steps.map((s) => [fill(' '.repeat(fit.cell), s.hex)]))
  return [
    labels,
    swatches,
    swatches,
    swatches,
    join(steps.map((_, i) => [i === selected ? ink('▔'.repeat(fit.cell), p.fg) : blank(fit.cell)])),
  ]
}

const BLOCK = 18

/** S9: the chosen step large, "Aa" in white and in black on it, and the facts beside it. */
export function previewRows({
  palette: p,
  step: s,
}: {
  palette: Palette
  step: { step: number; hex: string; oklch: string; white: number; black: number }
}): Row[] {
  const block = (txt: Row = []): Row => on(s.hex, centre(txt, BLOCK), BLOCK)
  const reads = (label: string, ratio: number): Row => [
    ink(label, p.border),
    ink(`${ratio.toFixed(1)} `, p.dim),
    ink(rate(ratio), ratio >= 4.5 ? p.ok : p.border),
  ]
  const facts: Row[] = [
    [ink(String(s.step), p.fg, true), blank(2), ink(s.hex, p.fg, true)],
    [ink(s.oklch, p.dim)],
    [],
    reads('white text  ', s.white),
    reads('black text  ', s.black),
  ]
  const blocks = [
    block(),
    block([ink('Aa', '#ffffff', true)]),
    block([ink('Aa', '#111111', true)]),
    block(),
    block(),
  ]
  return blocks.map((b, i) => [blank(4), ...b, blank(4), ...(facts[i] ?? [])])
}

/** Before there is a colour: the step numbers and the swatches as outlines. */
export function emptyRampRows({
  width: columns,
  palette: p,
  steps,
}: {
  width: number
  palette: Palette
  steps: number[]
}): Row[] {
  const fit = rampFit(columns, steps.length)
  const join = (cells: Row[]): Row => [
    blank(2),
    ...cells.flatMap((c, i) => (i === 0 || fit.gap === 0 ? c : [blank(fit.gap), ...c])),
  ]
  // Without gaps the outlines would run together: every other one is left out.
  const drawn = (i: number) => fit.gap > 0 || i % 2 === 0
  const outline = join(
    steps.map((_, i) => [drawn(i) ? ink('╌'.repeat(fit.cell), p.faint) : blank(fit.cell)]),
  )
  const labels = labelRow(
    steps.map(String),
    fit,
    undefined,
    (i) => ink(String(steps[i]), p.faint),
    drawn,
  )
  return [labels, outline, [], outline, []]
}

export type StepsField = 'set' | 'start' | 'end' | 'count' | 'tint' | 'over' | 'way' | 'mixCount'

const SET_NAMES: Record<StepSpec['set'], string> = {
  tailwind: 'Tailwind',
  even: 'Even',
  radix: 'Radix',
}

/**
 * The line under the ramp (C1, mockups/scale-steps-2026-10.html, round 3):
 * which set of steps, its ends and how many, and `s steps` at the field's
 * right edge. While it is being changed the set comes first, then what that
 * set lets you change, each a pill, the one in hand white with ‹ › round it,
 * and `s steps` has become `↵ done` in its place.
 */
export function stepsLine({
  width: columns,
  palette: p,
  spec,
  editing,
  extra,
}: {
  width: number
  palette: Palette
  spec: StepSpec
  editing?: StepsField | undefined
  /** The tab's own setting, last on the line: a neutral's tint, an alpha's background (§12.1). */
  extra?: { field: 'tint' | 'over'; value: string } | undefined
}): Row {
  const words = extra
    ? extra.field === 'tint'
      ? `${extra.value} tint`
      : `over ${extra.value}`
    : ''
  const names = stepsOf(spec)
  const count = `${names.length} steps`
  const radix = '12 steps · your colour at 9'
  if (!editing) {
    const row: Row = [
      blank(2),
      ink(SET_NAMES[spec.set], p.fg, true),
      ink(`  ${names[0]} – ${names[names.length - 1]}`, p.dim),
      ink(`  ·  ${spec.set === 'radix' ? radix : count}`, p.border),
      ...(extra ? [ink(`  ·  ${words}`, p.border)] : []),
    ]
    return withKey(p, row, 's', 'steps', columns - 1)
  }
  const plain = p.thumb === ''
  const pill = (f: StepsField, v: string | number): Run =>
    f === editing
      ? plain
        ? ink(`‹ ${v} ›`, p.fg, true)
        : { text: ` ‹ ${v} › `, fg: lc(p.ink), bg: lc(p.thumb), bold: true }
      : plain
        ? ink(` ${v} `, p.dim)
        : { text: ` ${v} `, fg: lc(p.fg), bg: lc(p.fieldBand) }
  const row: Row = [blank(2), pill('set', SET_NAMES[spec.set])]
  if (spec.set === 'radix') {
    row.push(ink(`   1 – 12 · your colour at 9`, p.border))
  } else {
    row.push(
      ink('  from ', p.dim),
      pill('start', spec.start),
      ink('  to ', p.dim),
      pill('end', spec.end),
    )
    if (spec.set === 'even') row.push(ink('  steps ', p.dim), pill('count', spec.count))
    else if (!extra) row.push(ink(`   ${count}`, p.border))
  }
  if (extra) row.push(ink(`  ${extra.field} `, p.dim), pill(extra.field, extra.value))
  return withKey(p, row, '↵', 'done', columns - 1)
}

const SPACE_NAMES: Record<MixSpace, string> = { oklab: 'OKLab', oklch: 'OKLCH' }
const SPACE_WORDS: Record<MixSpace, string> = {
  oklab: 'straight across',
  oklch: 'round the hue wheel',
}

/**
 * The line under a mix's ramp (§12.3): the way across and how many steps,
 * `s steps` at the far end; under `s`, the way and the count as pills.
 */
export function mixLine({
  width: columns,
  palette: p,
  space,
  count,
  editing,
}: {
  width: number
  palette: Palette
  space: MixSpace
  count: number
  editing?: 'way' | 'mixCount' | undefined
}): Row {
  if (!editing) {
    return withKey(
      p,
      [
        blank(2),
        ink(SPACE_NAMES[space], p.fg, true),
        ink(`  ${SPACE_WORDS[space]}`, p.dim),
        ink(`  ·  ${count} steps`, p.border),
      ],
      's',
      'steps',
      columns - 1,
    )
  }
  const plain = p.thumb === ''
  const pill = (on: boolean, v: string | number): Run =>
    on
      ? plain
        ? ink(`‹ ${v} ›`, p.fg, true)
        : { text: ` ‹ ${v} › `, fg: lc(p.ink), bg: lc(p.thumb), bold: true }
      : plain
        ? ink(` ${v} `, p.dim)
        : { text: ` ${v} `, fg: lc(p.fg), bg: lc(p.fieldBand) }
  return withKey(
    p,
    [
      blank(2),
      pill(editing === 'way', SPACE_NAMES[space]),
      ink('  steps ', p.dim),
      pill(editing === 'mixCount', count),
    ],
    '↵',
    'done',
    columns - 1,
  )
}

/** Scale's tabs (§12.1), drawn as /about's (L2): names with room round them, a rule under, heavy under the one in use. */
export function scaleTabRows({
  width: columns,
  palette: p,
  at,
}: {
  width: number
  palette: Palette
  at: number
}): Row[] {
  const names: Row = [blank(2)]
  const rule: Row = [blank(2)]
  let used = 0
  ;['Colour', 'Neutral', 'Alpha'].forEach((name, i) => {
    const on = i === at
    const w = name.length + 4
    names.push(ink(`  ${name}  `, on ? p.fg : p.dim, on))
    rule.push(ink((on ? '━' : '─').repeat(w), on ? p.accent : p.faint))
    used += w
  })
  rule.push(ink('─'.repeat(Math.max(0, columns - 4 - used)), p.faint))
  return [withKey(p, names, 'tab', 'switch', columns - 1), rule]
}

/** The checkerboard an alpha is drawn over: Figma's white and grey, or black and a dark grey. */
const BOARD: Record<'white' | 'black', [Rgb, Rgb]> = {
  white: [
    { r: 255, g: 255, b: 255 },
    { r: 0xd9, g: 0xd9, b: 0xd9 },
  ],
  black: [
    { r: 0, g: 0, b: 0 },
    { r: 0x3a, g: 0x3a, b: 0x3a },
  ],
}

/** `w` cells of the board under `a`, in two-column squares; `r` is the line, so squares alternate. */
function board(a: Alpha, over: 'white' | 'black', w: number, r: number): Row {
  const [light, dark] = BOARD[over].map((bg) => toHex(composite(a, bg))) as [string, string]
  return Array.from({ length: w }, (_, c) =>
    fill(' ', (Math.floor(c / 2) + r) % 2 === 0 ? light : dark),
  )
}

/**
 * The Alpha tab's ramp (A1, P1): each step laid over a checkerboard, so a
 * nearly clear step shows the board and a nearly solid one hides it; its
 * opacity written on the middle line, in white or near-black, whichever
 * reads, the chosen one bold. Under four columns a cell has no room for
 * "100%", and the numbers drop out (the preview still says it).
 */
export function alphaRampRows({
  width: columns,
  palette: p,
  steps,
  alphas,
  selected,
  over,
}: {
  width: number
  palette: Palette
  steps: StepLike[]
  alphas: Alpha[]
  selected: number
  over: 'white' | 'black'
}): Row[] {
  const fit = rampFit(columns, steps.length)
  const join = (cells: Row[]): Row => [
    blank(2),
    ...cells.flatMap((c, i) => (i === 0 || fit.gap === 0 ? c : [blank(fit.gap), ...c])),
  ]
  const labels = labelRow(
    steps.map((s) => String(s.step)),
    fit,
    selected,
    (i) => {
      const s = steps[i] as StepLike
      return i === selected
        ? ink(String(s.step), p.fg, true)
        : ink(String(s.step), (s.reference ?? s.seed) ? p.accent : p.border)
    },
  )
  const line = (r: number): Row =>
    join(
      alphas.map((a, i) => {
        const cells = board(a, over, fit.cell, r)
        if (r !== 1 || fit.cell < 4) return cells
        const text = `${a.pct}%`
        const fg = readsOn(toHex(composite(a, BOARD[over][0])))
        const from = Math.floor((fit.cell - text.length) / 2)
        return cells.map((run, c) => {
          const ch = text[c - from]
          return ch ? { ...run, text: ch, fg, bold: i === selected } : run
        })
      }),
    )
  return [
    labels,
    line(0),
    line(1),
    line(2),
    join(steps.map((_, i) => [i === selected ? ink('▔'.repeat(fit.cell), p.fg) : blank(fit.cell)])),
  ]
}

/** White or near-black, whichever reads on `hex`. */
function readsOn(hex: string): string {
  const rgb = parseHex(hex)
  if (!rgb) return '#ffffff'
  const r = onWhiteAndBlack(rgb)
  return r.white >= r.black ? '#ffffff' : '#111111'
}

/**
 * The Alpha tab's preview: the step over the board, larger; its 8-digit
 * hex, its opacity, and what it looks like over white and over black.
 */
export function alphaPreviewRows({
  palette: p,
  step,
  alpha: a,
  over,
}: {
  palette: Palette
  step: number
  alpha: Alpha
  over: 'white' | 'black'
}): Row[] {
  const facts: Row[] = [
    [ink(String(step), p.fg, true), blank(2), ink(a.hex8, p.fg, true)],
    [
      ink(`${a.pct}% opaque · `, p.dim),
      ink(`rgb(${a.rgb.r} ${a.rgb.g} ${a.rgb.b} / ${a.pct}%)`, p.border),
    ],
    [],
    [ink('over white  ', p.border), ink(toHex(composite(a, BOARD.white[0])), p.dim)],
    [ink('over black  ', p.border), ink(toHex(composite(a, BOARD.black[0])), p.dim)],
  ]
  return [0, 1, 2, 3, 4].map((r) => [
    blank(4),
    ...board(a, over, BLOCK, r),
    blank(4),
    ...(facts[r] ?? []),
  ])
}
