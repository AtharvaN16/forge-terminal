import { rate } from '../../core/colour/contrast.js'
import { OUTSIDE, TRANSPARENT } from '../../core/colour/palette.js'
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

const CARD = 36

/**
 * Home's panel in colour mode: two cards, Palette and Scale, each with a
 * preview of what it makes. The chosen one is on `panelBand` with a `▌` in
 * the mode's colour. Eight rows, as tall as the drop surface it replaces.
 */
export function choiceCards({
  width: columns,
  palette: p,
  selected,
  samples,
}: {
  width: number
  palette: Palette
  selected: 0 | 1
  samples: { palette: string[]; scale: string[] }
}): Row[] {
  const W = columns - 4
  const cards = [
    {
      name: 'Palette',
      sub: 'the colours of an image',
      preview: samples.palette.map((h) => fill('    ', h)),
    },
    {
      name: 'Scale',
      sub: '50 to 950 from one colour',
      preview: samples.scale.map((h) => fill('  ', h)),
    },
  ]
  const card = (i: number): Row[] => {
    const c = cards[i] as (typeof cards)[number]
    const me = i === selected
    const bg = me ? p.panelBand : p.selectionBg
    const line = (txt: Row): Row =>
      on(bg, [me ? ink('▌', p.accent) : blank(1), blank(1), ...txt], CARD)
    return [
      line([]),
      line([ink(c.name, me ? p.fg : p.dim, true)]),
      line([ink(c.sub, me ? p.dim : p.border)]),
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

/** The palette's list: one colour per row, the chosen one on the picker's band. */
export function paletteColumn({
  palette: p,
  items,
  selected,
  rows = 12,
}: {
  palette: Palette
  items: { hex: string; pct: number }[]
  selected: number
  rows?: number
}): Row[] {
  const max = Math.max(1, ...items.map((i) => i.pct))
  return spaced(
    items.map((item, i) => listItem(p, item, max, i === selected)),
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
export function copiedRow(p: Palette, what: { hex: string } | { count: number }): Row {
  const tick: Row = [blank(4), ink('✓', p.ok, true), blank(1)]
  if ('hex' in what) return [...tick, ink('copied ', p.fg), ink(what.hex, p.fg, true)]
  return [
    ...tick,
    ink(`copied ${what.count} swatches`, p.fg),
    ink(' · paste into Figma with ⌘V', p.dim),
  ]
}

/* ------------------------------------------------------------ the scale */

const CELL = 6

interface StepLike {
  step: number
  hex: string
  reference?: boolean
  seed?: boolean
}

/** S1: the step numbers, three rows of swatches, and a `▔` under the chosen one. */
export function rampRows({
  palette: p,
  steps,
  selected,
}: {
  palette: Palette
  steps: StepLike[]
  selected: number
}): Row[] {
  const join = (cells: Row[]): Row => [
    blank(2),
    ...cells.flatMap((c, i) => (i === 0 ? c : [blank(1), ...c])),
  ]
  const label = (s: StepLike, i: number): Row =>
    centre(
      [
        i === selected
          ? ink(String(s.step), p.fg, true)
          : ink(String(s.step), (s.reference ?? s.seed) ? p.accent : p.border),
      ],
      CELL,
    )
  const swatches = join(steps.map((s) => [fill(' '.repeat(CELL), s.hex)]))
  return [
    join(steps.map(label)),
    swatches,
    swatches,
    swatches,
    join(steps.map((_, i) => [i === selected ? ink('▔'.repeat(CELL), p.fg) : blank(CELL)])),
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
export function emptyRampRows({ palette: p, steps }: { palette: Palette; steps: number[] }): Row[] {
  const join = (cells: Row[]): Row => [
    blank(2),
    ...cells.flatMap((c, i) => (i === 0 ? c : [blank(1), ...c])),
  ]
  const outline = join(steps.map(() => [ink('╌'.repeat(CELL), p.faint)]))
  return [join(steps.map((s) => centre([ink(String(s), p.faint)], CELL))), outline, [], outline, []]
}
