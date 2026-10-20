import stringWidth from 'string-width'
import { contrast } from '../core/colour/contrast.js'
import {
  fromLch,
  inGamut,
  oklabToRgb,
  parseHex,
  type Rgb,
  rgbToOklab,
  toHex,
  toLch,
} from '../core/colour/space.js'
import { FORMATS } from '../core/formats.js'
import type { FormatId } from '../core/types.js'
import type { Command } from './commands.js'
import type { StagedFile, StagedView, UnderField } from './stage.js'
import {
  dotGradient,
  MODE_ORDER,
  modeColours,
  modeGradient,
  modeWash,
  type Palette,
  type ShellMode,
  VERSION,
} from './theme.js'
import { middleEllipsis } from './width.js'

/**
 * The home screen's drawn parts — the brand band, the mode tabs and the drop
 * surface — as rows of styled runs. Pure, so each one can be held to the
 * decided mockup (mockups/flow-parts-2026-10.html, tabs 2 and 3) cell for
 * cell; `Home.tsx` only lays the rows out.
 *
 * The colour arithmetic is the mockup's own, kept exactly: a dot's tint is a
 * function of its column, its row and its distance from the middle, and any
 * rounding done differently shows up as a different colour in every cell.
 */

export interface Run {
  text: string
  fg?: string | undefined
  bg?: string | undefined
  bold?: boolean | undefined
}
export type Row = Run[]

/** Columns kept clear either side of the block. */
export const HOME_MARGIN = 2

/** FORGE in half blocks, three rows tall. */
export const WORDMARK3 = [
  '█▀▀▀ █▀▀█ █▀▀▄ █▀▀▀ █▀▀▀',
  '█▀▀  █  █ █▀▀▄ █ ▀█ █▀▀ ',
  '▀    ▀▀▀▀ ▀  ▀ ▀▀▀▀ ▀▀▀▀',
]

const HEX = /^#[0-9a-f]{6}$/i

function channels(hex: string): number[] {
  return [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16))
}

/**
 * `a` moved `k` of the way to `b`. A colour that is not a hex value — the
 * first-run palette's ANSI names — cannot be mixed, so `b` is used as it is.
 */
export function mix(a: string, b: string, k: number): string {
  if (!HEX.test(a) || !HEX.test(b)) return b
  const t = Math.max(0, Math.min(1, k))
  const from = channels(a)
  const to = channels(b)
  return `#${from
    .map((v, i) =>
      Math.round(v + ((to[i] ?? v) - v) * t)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`
}

/** The colour at step `i` of `n` along `stops`. */
export function gradientAt(i: number, n: number, stops: readonly string[]): string {
  const first = stops[0] ?? ''
  const p = (Math.max(0, Math.min(n - 1, i)) / Math.max(1, n - 1)) * (stops.length - 1)
  const k = Math.floor(p)
  return mix(stops[k] ?? first, stops[Math.min(stops.length - 1, k + 1)] ?? first, p - k)
}

export const blank = (n: number): Run => ({ text: ' '.repeat(Math.max(0, n)) })
export const width = (row: Row) => row.reduce((n, run) => n + stringWidth(run.text), 0)

/** What the drop surface lists under its heading ("Drop a file here"), by mode. */
export const MODE_KINDS: Record<ShellMode, string> = {
  // Kinds, not formats (mockups/kinds-2026-10.html): holding ? names the formats.
  convert: 'Images · Video · Audio · Documents',
  compress: 'Images · Video · Audio · PDF',
  pdf: 'split · merge · rotate · extract · delete',
  colour: 'palette · scale',
  edit: 'Images · Video · Audio',
  transcribe: 'or paste a YouTube link',
}

/** The kinds a mode lists, each with the formats it takes: `[kind, 'JPEG · PNG · …']`. */
export type FormatKinds = readonly (readonly [kind: string, formats: string])[]

const labels = (ids: readonly FormatId[]) => ids.map((id) => FORMATS[id].label).join(' · ')
const IMAGE_IDS = ['jpeg', 'png', 'webp', 'avif', 'heic', 'gif', 'tiff'] as const
// `hevc` is a codec written into an .mp4, never a source (video spec §2).
const VIDEO_IDS = ['mp4', 'mov', 'webm', 'mkv', 'avi'] as const
const SOUND_IDS = ['mp3', 'm4a', 'opus', 'flac', 'aiff', 'wav', 'ogg'] as const

/**
 * What holding ? shows on the drop surface, by mode; a mode with no entry has
 * nothing to list (pdf, colour and transcribe say what they do on the line
 * itself). Not a list of output formats — those come from `targetsFor` — only
 * what a drop is understood as.
 */
export const MODE_FORMATS: Partial<Record<ShellMode, FormatKinds>> = {
  convert: [
    ['Images', labels(IMAGE_IDS)],
    ['Video', labels(VIDEO_IDS)],
    ['Audio', labels(SOUND_IDS)],
    ['Documents', 'PDF · Word'],
  ],
  compress: [
    ['Images', labels(['jpeg', 'png', 'webp', 'avif', 'gif'])],
    ['Video', labels(VIDEO_IDS)],
    ['Audio', labels(SOUND_IDS)],
    ['PDF', 'PDF'],
  ],
  edit: [
    ['Images', labels(IMAGE_IDS)],
    ['Video', labels(VIDEO_IDS)],
    ['Audio', labels(SOUND_IDS)],
  ],
}

/** `list` broken at its separators into lines of at most `max` columns. */
function wrapFormats(list: string, max: number): string[] {
  const out: string[] = []
  let line = ''
  for (const part of list.split(' · ')) {
    const next = line ? `${line} · ${part}` : part
    if (stringWidth(next) > max && line) {
      out.push(`${line} ·`)
      line = part
    } else line = next
  }
  if (line) out.push(line)
  return out
}

/** The drop surface's heading where a mode asks for more than "a file" (mockups/transcribe-2026-10-round2.html). */
export const MODE_DROP_TITLES: Partial<Record<ShellMode, string>> = {
  transcribe: 'Drop a video or audio file',
}

/** What a mode cannot do yet, said on home's "/ menu" row at its left end (`menuHintRow`). */
export const MODE_NOTES: Partial<Record<ShellMode, string>> = {
  transcribe: 'Currently only English transcription supported',
}

/**
 * Diagonal hatching whose colour follows the absolute column, `from` onwards,
 * so the three stacked rows line up into one band. With `wash`, each cell
 * sits on the fill at the same step of that gradient.
 */
export function hatch(
  from: number,
  n: number,
  row: number,
  span: number,
  stops: readonly string[],
  wash?: readonly string[],
): Run[] {
  const runs: Run[] = []
  for (let i = 0; i < n; i++) {
    const at = from + i + row * 2
    runs.push({
      text: '╱',
      fg: gradientAt(at, span, stops),
      ...(wash ? { bg: gradientAt(at, span, wash) } : {}),
    })
  }
  return runs
}

/**
 * FORGE knocked out of a band of hatching in the mode's gradient — the
 * menu's gold while the menu is open — with the version knocked
 * out of the bottom row at the right end, on the letters' baseline. In light
 * the hatching sits on its wash (L6). Empty when the terminal is too narrow
 * for the word.
 */
/**
 * The colour across the wheel from a mode's own (N1, update mockup round 5):
 * the same OKLCH lightness, hue turned 180°, chroma brought in until it fits
 * sRGB, then lightness moved away from the canvas until it reads at 4.5:1.
 * It stands apart from the band's hatching in every mode by construction.
 */
const opposites = new Map<string, string>()
export function oppositeColour(palette: Palette, scheme: ShellMode | 'menu'): string {
  const base = scheme === 'menu' ? palette.brand : modeColours(palette, scheme).fg
  const key = `${base}|${palette.canvas}`
  const known = opposites.get(key)
  if (known !== undefined) return known
  const from = parseHex(base)
  const canvas = parseHex(palette.canvas)
  // A named ANSI colour (no true colour) has no hue to turn: keep the plain fg.
  if (from === undefined || canvas === undefined) return palette.fg
  const lch = toLch(rgbToOklab(from))
  const out = { L: lch.L, C: lch.C, h: (lch.h + 180) % 360 }
  const intoGamut = () => {
    while (!inGamut(fromLch(out)) && out.C > 0) out.C = Math.max(0, out.C - 0.005)
  }
  intoGamut()
  const darkCanvas = toLch(rgbToOklab(canvas)).L < 0.5
  for (let k = 0; k < 100 && contrast(oklabToRgb(fromLch(out)) as Rgb, canvas) < 4.5; k++) {
    out.L = Math.min(1, Math.max(0, out.L + (darkCanvas ? 0.01 : -0.01)))
    intoGamut()
  }
  const hex = toHex(oklabToRgb(fromLch(out)))
  opposites.set(key, hex)
  return hex
}

export function brandRows({
  width: columns,
  palette,
  mode,
  menu = false,
  update,
}: {
  width: number
  palette: Palette
  mode: ShellMode
  /** The menu is open: the band takes its gold. */
  menu?: boolean
  /** A newer Forge, from the update check: the baseline says "/update is available ·" before the version. */
  update?: string | undefined
}): Row[] {
  const M = HOME_MARGIN
  const W = columns - M * 2
  const scheme = menu ? 'menu' : mode
  const stops = modeGradient(palette, scheme)
  const wash = modeWash(palette, scheme)
  const span = columns + 8
  const word = WORDMARK3[0]?.length ?? 0
  // The hatching after the word: the block, less the lead-in hatch, the word
  // and a space either side of it.
  const after = W - word - 3
  if (after < 2) return []

  const version = `v${VERSION}`
  const tail = 2
  const NOTE = '/update is available'
  const SEP = ' · '
  const plain = after - tail - version.length - 2
  // The note only when the hatching keeps some length beside it.
  const withNote = update !== undefined && plain - NOTE.length - SEP.length >= 4
  const room = withNote ? plain - NOTE.length - SEP.length : plain

  return WORDMARK3.map((letters, i) => {
    const row: Row = [
      blank(M),
      ...hatch(M, 1, i, span, stops, wash),
      blank(1),
      { text: letters, fg: palette.fg, bold: true },
      blank(1),
    ]
    const c0 = M + word + 3
    if (i === WORDMARK3.length - 1 && room >= 1) {
      row.push(
        ...hatch(c0, room, i, span, stops, wash),
        blank(1),
        ...(withNote
          ? [
              { text: NOTE, fg: oppositeColour(palette, scheme), bold: true },
              { text: SEP, fg: palette.dim },
            ]
          : []),
        { text: version, fg: palette.dim },
        blank(1),
        ...hatch(c0 + after - tail, tail, i, span, stops, wash),
      )
    } else {
      row.push(...hatch(c0, after, i, span, stops, wash))
    }
    return row
  })
}

/** How long the band takes to draw itself in at launch (M8b), and how far its bright edge reaches. */
export const INTRO_MS = 950
const INTRO_EDGE = 3

/**
 * The brand's rows drawn in up to column `front` (M8b): everything past it is
 * blank, and the hatching just behind it is lit towards the foreground, a
 * bright edge sweeping across. The front leans with the hatching, two columns
 * on for each row down, so it reads as one slanted edge.
 */
export function brandIntro(rows: Row[], front: number, palette: Palette): Row[] {
  return rows.map((row, r) => {
    const out: Run[] = []
    let x = 0
    for (const run of row) {
      for (const ch of run.text) {
        const behind = front - (x + r * 2)
        const cell: Run =
          behind < 0
            ? { text: ' ' }
            : ch === '╱' && behind < INTRO_EDGE && run.fg
              ? { ...run, text: ch, fg: mix(run.fg, palette.fg, 0.7 * (1 - behind / INTRO_EDGE)) }
              : { ...run, text: ch }
        const last = out[out.length - 1]
        if (last && last.fg === cell.fg && last.bg === cell.bg && last.bold === cell.bold)
          last.text += cell.text
        else out.push(cell)
        x++
      }
    }
    return out
  })
}

/**
 * The numbered modes (round 5, H2): the active one on a chip of dark grey, a
 * step off the background, its number in its mode's colour; the rest bare
 * words. "/ menu" left this row for `menuHintRow` when transcribe took its
 * slot (2026-10-17).
 * The row above is left blank: a half-cell lip there drew as a hairline seam
 * in terminals that leave a gap between rows. Nothing sits at the row's
 * right: "saves to ~/Desktop" (and colour's "copies to clipboard") was taken
 * out on 2026-10-13 — Save as says where a file goes when it matters.
 */
export function tabRows({ palette, mode }: { palette: Palette; mode: ShellMode }): Row[] {
  const M = HOME_MARGIN
  const chip = palette.tabChip === '' ? undefined : palette.tabChip
  const top: Row = [blank(M)]
  const tabs: Row = []
  const tab = (key: string, keyColour: string, name: string, active: boolean) => {
    const w = key.length + name.length + 3
    top.push(blank(w))
    if (active) {
      tabs.push(
        { text: ' ', bg: chip },
        { text: key, fg: keyColour, bg: chip, bold: true },
        { text: ' ', bg: chip },
        { text: name, fg: palette.fg, bg: chip, bold: true },
        { text: ' ', bg: chip },
      )
    } else {
      tabs.push(
        blank(1),
        { text: key, fg: palette.border, bold: key === '/' },
        blank(1),
        { text: name, fg: palette.dim },
        blank(1),
      )
    }
    top.push(blank(1))
    tabs.push(blank(1))
  }
  MODE_ORDER.forEach((m, i) => {
    tab(String(i + 1), modeColours(palette, m).fg, m, m === mode)
  })
  return [top, [blank(M), ...tabs]]
}

/**
 * "/ menu" on the row above the key row's rule, right-aligned so its last
 * cell is one short of the edge (mockups/transcribe-2026-10-round2.html,
 * "/ menu"): the slash on a keycap, then the word in dim; in the menu's gold
 * while the menu is open. Home draws it at rest; the menu popup draws it open.
 * A mode's standing caveat (transcribe's English only, 2026-10-19) sits at
 * the row's left end, dim, and goes first when the row is too narrow.
 */
export function menuHintRow({
  palette,
  width: columns,
  open,
  clear = false,
  menu = true,
  note,
}: {
  palette: Palette
  width: number
  open: boolean
  /** "esc clear" at the row's left, lined up with the key row's first key: only while something is staged. */
  clear?: boolean
  /** "/ menu" at the right; off while a path is being typed. */
  menu?: boolean
  /** A dim sentence at the row's left, after "esc clear" if that is there. */
  note?: string | undefined
}): Row {
  const hint: Row = !menu
    ? []
    : palette.keycapBg === ''
      ? [{ text: '[/] menu', fg: open ? palette.brand : palette.border, bold: open }]
      : open
        ? [
            { text: ' / ', fg: palette.ink, bg: palette.brand, bold: true },
            { text: ' menu', fg: palette.brand, bold: true },
          ]
        : [
            { text: ' / ', fg: palette.fg, bg: palette.keycapBg },
            { text: ' menu', fg: palette.dim },
          ]
  const esc: Row = !clear
    ? []
    : palette.keycapBg === ''
      ? [{ text: '[esc] clear', fg: palette.border }]
      : [
          { text: ' esc ', fg: palette.fg, bg: palette.keycapBg },
          { text: ' clear', fg: palette.dim },
        ]
  const said: Row = note
    ? [...(esc.length > 0 ? [blank(3)] : []), { text: note, fg: palette.dim }]
    : []
  // The note only where it fits with a column to spare before "/ menu".
  const fits = (left: Row) =>
    HOME_MARGIN + 1 + width(left) + (hint.length > 0 ? 1 + width(hint) + 1 : 0) <= columns
  const left: Row = said.length > 0 && fits([...esc, ...said]) ? [...esc, ...said] : esc
  const lead = left.length > 0 ? HOME_MARGIN + 1 : 0
  if (hint.length === 0) return left.length > 0 ? [blank(lead), ...left] : []
  return [
    ...(left.length > 0 ? [blank(lead), ...left] : []),
    blank(columns - 1 - width(hint) - lead - width(left)),
    ...hint,
    blank(1),
  ]
}

/**
 * The commands, drawn on the drop surface's fill in place of its dots: the
 * modes, then the settings, each under a gold heading and a rule (C1) and
 * only when something in it matches. A row is the slash, what has been
 * typed (bright) and the rest of the name. The chosen row is the picker's — a band
 * with a `▌` strip — and the strip takes the colour of the mode the command
 * would switch to, or the menu's gold for a setting.
 *
 * At least `rows` tall, so it takes the surface's place exactly; taller when
 * the list needs it, up to `max`, past which the rows scroll to keep the
 * chosen one in view.
 */
export function commandRows({
  width: columns,
  rows: h,
  max = h,
  palette,
  items,
  query,
  typed,
  selected,
  panel = true,
}: {
  width: number
  rows: number
  max?: number
  palette: Palette
  items: Command[]
  query: string
  typed: string
  selected: number
  /**
   * On the drop surface's fill (home), or on the terminal's own background
   * under a field that has no surface to swap it into.
   */
  panel?: boolean
}): Row[] {
  const M = HOME_MARGIN
  const W = columns - M * 2
  const fill = panel ? palette.selectionBg : ''
  const band = panel ? palette.panelBand : palette.listBand
  const line = (runs: Run[]): Row => {
    const row = runs.map((run) => ({ ...run, bg: run.bg ?? fill }))
    return [blank(M), ...row, { text: ' '.repeat(Math.max(0, W - width(row))), bg: fill }]
  }

  const lines: Row[] = []
  let chosenLine = 0
  for (const group of ['modes', 'settings'] as const) {
    const members = items.filter((c) => c.group === group)
    if (members.length === 0) continue
    if (lines.length > 0) lines.push(line([]))
    // C1 (round 5): the heading in the menu's gold, and a quiet rule on to
    // the panel's end, as Save as parts its name from its folders.
    const rule = Math.max(0, W - 8 - group.length - 1)
    lines.push(
      line([
        { text: '    ' },
        { text: group.charAt(0).toUpperCase() + group.slice(1), fg: palette.brand, bold: true },
        { text: ` ${'─'.repeat(rule)}`, fg: palette.faint },
      ]),
    )
    lines.push(line([]))
    for (const c of members) {
      const chosen = items.indexOf(c) === selected
      const rest = c.name.slice(query.length)
      const name: Run[] = [
        { text: `/${query}`, fg: palette.fg, bold: true },
        { text: rest, fg: chosen ? palette.fg : palette.dim, bold: chosen },
      ]
      if (!chosen) {
        lines.push(line([{ text: '    ' }, ...name]))
        continue
      }
      chosenLine = lines.length
      const strip = c.mode ? modeColours(palette, c.mode).fg : palette.brand
      const inner: Run[] = [{ text: '▌', fg: strip }, { text: ' ' }, ...name].map((run) => ({
        ...run,
        bg: band,
      }))
      const bandWidth = Math.max(0, W - 4)
      lines.push(
        line([
          { text: '  ' },
          ...inner,
          { text: ' '.repeat(Math.max(0, bandWidth - width(inner))), bg: band },
        ]),
      )
    }
  }
  if (items.length === 0) {
    lines.push(line([{ text: '    ' }, { text: `no command matches /${typed}`, fg: palette.dim }]))
  }

  const room = Math.max(1, max - 2)
  const start = Math.min(Math.max(0, chosenLine - room + 1), Math.max(0, lines.length - room))
  const shown = lines.slice(start, start + room)
  const total = lines.length
  if (total <= room) {
    const out = [line([]), ...shown, line([])]
    while (out.length < h) out.push(line([]))
    return out
  }

  // S2 (mockups/commands-scroll-2026-10.html): past `room` the list scrolls,
  // so a thin bar on the panel's last column and a note on its bottom edge
  // say so. At 80 × 24 /update was one row below the panel with nothing to
  // show it was there. The bar takes the trailing fill's last cell, so no
  // row gets wider.
  const thumb = Math.max(1, Math.round((room * room) / total))
  const at = Math.round((start / (total - room)) * (room - thumb))
  const edge = (row: Row, ch: string, fg: string): Row => {
    const end = row[row.length - 1] as Run
    if (end.text.length === 0) return row
    return [...row.slice(0, -1), { ...end, text: end.text.slice(1) }, { text: ch, fg, bg: fill }]
  }
  const barred = shown.map((row, i) =>
    i >= at && i < at + thumb ? edge(row, '┃', palette.dim) : edge(row, '│', palette.faint),
  )
  // Only what is still below: rows scrolled off the top were already seen,
  // and "↑ n more" read as if something were still hidden (2026-10-13).
  const below = total - start - room
  const note = `↓ ${below} more`
  const out = [
    line([]),
    ...barred,
    below > 0
      ? line([
          { text: ' '.repeat(Math.max(0, W - 1 - width([{ text: note }]))) },
          { text: note, fg: palette.dim },
        ])
      : line([]),
  ]
  while (out.length < h) out.push(line([]))
  return out
}

/** Shortens `text` to `max` columns with a trailing ellipsis. */
export function clip(text: string, max: number): string {
  if (stringWidth(text) <= max) return text
  let out = ''
  for (const ch of text) {
    if (stringWidth(`${out}${ch}…`) > max) break
    out += ch
  }
  return `${out}…`
}

/**
 * The drop surface's ripple, in milliseconds (M1, decided 2026-10-12 on
 * mockups/dots-motion-2026-10.html). From an empty surface a soft ring
 * spreads out from the words over `ring` and the dots appear as it reaches
 * them; the full field rests for `hold`, fades out together over `fade`,
 * stays empty for `gap`, and the ring comes again.
 */
export const RIPPLE = (() => {
  const ring = 3200
  const hold = 1300
  const fade = 700
  const gap = 500
  return { ring, hold, fade, gap, length: ring + hold + fade + gap }
})()
/** How deep the ring's band is, in columns, and how much it lifts a dot at most. */
const RING_WIDTH = 22
const RING_LIFT = 0.3
/** How long a drop's ring takes to run out (M2a), and how deep its band is in columns. */
export const DROP_RING_MS = 520
const DROP_RING_WIDTH = 4
/** A row is about twice as tall as a column is wide. */
const ROW_ASPECT = 2.2

const smooth = (k: number) => {
  const t = Math.max(0, Math.min(1, k))
  return t * t * (3 - 2 * t)
}

/**
 * How strong a dot `d` columns from the words is, `t` ms into the ripple, as
 * a fraction of the way from the fill to its tint; `rest` is its strength when
 * still, and `reach` how far the ring goes before it is done. 0 is no dot. The
 * ring lifts a dot by at most `RING_LIFT` and never past its own tint.
 */
export function rippleLevel(t: number, d: number, rest: number, reach: number): number {
  const at = ((t % RIPPLE.length) + RIPPLE.length) % RIPPLE.length
  const front = (Math.min(at, RIPPLE.ring) / RIPPLE.ring) * (reach + RING_WIDTH)
  const behind = front - d
  if (behind <= 0) return 0
  // A soft leading edge where the dot appears, a long tail as it eases back.
  const glow = behind >= RING_WIDTH ? 0 : (1 - behind / RING_WIDTH) ** 1.3
  const out = 1 - smooth((at - RIPPLE.ring - RIPPLE.hold) / RIPPLE.fade)
  return out * smooth(behind / 6) * Math.min(1, rest + RING_LIFT * glow)
}

/**
 * A filled panel with a grid of dots, one every third column, tinted by the
 * mode's dot gradient (`dotGradient`: light's are deeper) — fainter towards the middle — and `lines` centred in one
 * clean rectangle cut out of the dots. The cut-out is `pad` columns wider
 * than the words either side, then widened until each side meets a dot, so
 * the gap is even either side.
 *
 * `scale` steps the dots back towards the fill (1 leaves them as they rest),
 * for a surface that has something laid on it. `ripple` draws the surface
 * that many ms into its ripple (`RIPPLE`); without it the dots are still.
 * `ring` draws a drop's ring that far through its one pass (M2a, 0 to 1):
 * the dots it is crossing lean to the mode's colour, fading as it goes out.
 */
function dotted({
  width: columns,
  rows: h,
  palette,
  mode,
  lines,
  pad,
  dim = 1,
  scale = 1,
  ripple,
  ring,
}: {
  width: number
  rows: number
  palette: Palette
  mode: ShellMode
  lines: Row[]
  pad: number
  /** The resting dots' own factor: less than 1 while a path is typed. */
  dim?: number
  scale?: number
  ripple?: number | undefined
  ring?: number | undefined
}): Row[] {
  const M = HOME_MARGIN
  const W = columns - M * 2
  const fill = palette.selectionBg
  const stops = dotGradient(palette, mode)

  const isDot = (c: number) => c % 3 === 0 && c >= 3 && c <= W - 4
  const mid = (h - 1) / 2
  // The ring's centre is the middle of the dot columns, so it is even either side.
  const centre = (3 + Math.floor((W - 4) / 3) * 3) / 2
  const reach = Math.hypot(centre, mid * ROW_ASPECT) + 14
  /** A dot's strength, 0 to 1 of the way from the fill to its tint. */
  const level = (c: number, r: number) => {
    const dx = Math.abs(c - W / 2) / (W / 2)
    const dy = mid === 0 ? 0 : Math.abs(r - mid) / mid
    const rest = 0.5 + 0.4 * Math.min(1, Math.hypot(dx, dy * 0.6))
    if (ripple === undefined) return rest
    return rippleLevel(ripple, Math.hypot(c - centre, (r - mid) * ROW_ASPECT), rest, reach)
  }
  const accent = modeColours(palette, mode).fg
  const dot = (c: number, r: number, k: number) => {
    const tint = gradientAt(c + r * 2, W + 14, stops)
    const rest = mix(fill, tint, k * dim)
    const still = scale === 1 ? rest : mix(fill, rest, scale)
    if (ring === undefined || ring <= 0 || ring >= 1) return still
    const d = Math.hypot(c - centre, (r - mid) * ROW_ASPECT)
    const lit = Math.exp(-(((d - ring * reach) / DROP_RING_WIDTH) ** 2)) * (1 - ring)
    return mix(still, accent, 0.9 * lit)
  }

  const top = Math.floor((h - lines.length) / 2)
  const words = Math.max(...lines.map(width))
  let a = Math.max(0, Math.floor((W - words - pad * 2) / 2))
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
        row.push(
          { text: ' '.repeat(Math.max(0, line ? left : cut)), bg: fill },
          ...(line ?? []).map((run) => ({ ...run, bg: fill })),
          { text: ' '.repeat(Math.max(0, line ? cut - left - width(line) : 0)), bg: fill },
        )
        c += cut
        continue
      }
      const k = r >= 1 && r <= h - 2 && isDot(c) ? level(c, r) : 0
      row.push(k > 0 ? { text: '·', fg: dot(c, r, k), bg: fill } : { text: ' ', bg: fill })
      c++
    }
    out.push(row)
  }
  return out
}

/**
 * The drop surface: the dotted panel with the words in the cut-out.
 *
 * While a path is being typed the whole surface steps back, so the field
 * below it leads. `ripple` draws it that many ms into its ripple (`RIPPLE`).
 */
export function surfaceRows({
  width: columns,
  rows,
  palette,
  mode,
  typing,
  kinds,
  title: heading = 'Drop a file here',
  ripple,
}: {
  width: number
  rows: number
  palette: Palette
  mode: ShellMode
  typing: boolean
  kinds: string
  /** What to drop: colour's palette asks for an image. */
  title?: string
  ripple?: number | undefined
}): Row[] {
  const W = columns - HOME_MARGIN * 2
  const accent = modeColours(palette, mode).fg
  const title: Row = [
    { text: '↓', fg: typing ? palette.border : accent, bold: true },
    blank(2),
    { text: heading, fg: typing ? palette.dim : palette.fg, bold: true },
  ]
  const sub: Row = [
    { text: clip(kinds, Math.max(1, W - 2)), fg: typing ? palette.faint : palette.dim },
  ]
  return dotted({
    width: columns,
    rows,
    palette,
    mode,
    lines: [title, sub],
    pad: 4,
    dim: typing ? 0.45 : 1,
    ripple,
  })
}

/**
 * The supported formats, drawn on the drop surface's fill in place of its
 * dots, as the commands are (mockups/kinds-2026-10.html, Q2): a title in the
 * mode's colour, a rule, then a line a kind. Past the rows it has, the first
 * lines stay and a thin bar and "↓ n more" on the last row say there are more,
 * as the commands list does.
 */
export function formatRows({
  width: columns,
  rows: h,
  palette,
  mode,
  kinds,
}: {
  width: number
  rows: number
  palette: Palette
  mode: ShellMode
  kinds: FormatKinds
}): Row[] {
  const M = HOME_MARGIN
  const W = columns - M * 2
  const fill = palette.selectionBg
  const x = 3
  const lead = Math.max(0, ...kinds.map(([kind]) => stringWidth(kind))) + 3
  const line = (runs: Run[]): Row => {
    const row = runs.map((run) => ({ ...run, bg: run.bg ?? fill }))
    return [blank(M), ...row, { text: ' '.repeat(Math.max(0, W - width(row))), bg: fill }]
  }

  // A short surface gives up its top blank, then its rule, to keep lines.
  const top = h >= 7 ? 1 : 0
  const rule = h >= 6
  const head: Row[] = [
    ...(top ? [line([])] : []),
    line([blank(x), { text: 'Supported formats', fg: modeColours(palette, mode).fg, bold: true }]),
    ...(rule
      ? [line([blank(x), { text: '─'.repeat(Math.max(0, W - x * 2)), fg: palette.border }])]
      : []),
  ]
  const entries: Row[] = kinds.flatMap(([kind, formats]) =>
    wrapFormats(formats, Math.max(8, W - x * 2 - lead - 2)).map((text, i) =>
      line([
        blank(x),
        { text: (i === 0 ? kind : '').padEnd(lead), fg: palette.fg, bold: true },
        { text: text, fg: palette.dim },
      ]),
    ),
  )
  const room = Math.max(1, h - head.length)
  if (entries.length <= room) {
    const out = [...head, ...entries]
    while (out.length < h) out.push(line([]))
    return out
  }
  const shown = Math.max(1, room - 1)
  const thumb = Math.max(1, Math.round((shown * shown) / entries.length))
  const edge = (row: Row, ch: string, fg: string): Row => {
    const end = row[row.length - 1] as Run
    return [...row.slice(0, -1), { ...end, text: end.text.slice(1) }, { text: ch, fg, bg: fill }]
  }
  const note = `↓ ${entries.length - shown} more`
  return [
    ...head,
    ...entries
      .slice(0, shown)
      .map((row, i) => (i < thumb ? edge(row, '┃', palette.dim) : edge(row, '│', palette.faint))),
    line([blank(Math.max(0, W - 1 - note.length)), { text: note, fg: palette.dim }]),
  ]
}

/** One suggestion as the drop area lists it: the name, and the folder it is in. */
export interface SuggestionItem {
  name: string
  where: string
}

/**
 * The field's suggestions, drawn on the drop surface's fill in place of its
 * dots while something is typed (S2, mockups/file-suggestions-2026-10.html):
 * a row each, the name at the left and the folder it is in at the far end.
 * Only the chosen row is bright; the rest are faded. As many rows as the surface has, less a blank above and below;
 * the window follows the choice.
 */
export function suggestionRows({
  width: columns,
  rows: h,
  palette,
  items,
  selected,
}: {
  width: number
  rows: number
  palette: Palette
  /** The mode it is drawn in; the list itself takes no colour from it. */
  mode?: ShellMode
  items: readonly SuggestionItem[]
  selected: number
}): Row[] {
  const M = HOME_MARGIN
  const W = columns - M * 2
  const fill = palette.selectionBg
  const line = (runs: Run[]): Row => {
    const row = runs.map((run) => ({ ...run, bg: run.bg ?? fill }))
    return [blank(M), ...row, { text: ' '.repeat(Math.max(0, W - width(row))), bg: fill }]
  }
  const visible = Math.max(1, h - 2)
  const start = Math.min(Math.max(0, selected - visible + 1), Math.max(0, items.length - visible))
  // The band runs from the strip to two cells short of the surface's end.
  const inner = Math.max(10, W - 4)
  const out: Row[] = [line([])]
  items.slice(start, start + visible).forEach((item, i) => {
    // The chosen row is lit by its text alone (2026-10-19): no band, no strip.
    const chosen = start + i === selected
    const room = inner - 3
    const where = middleEllipsis(item.where, Math.max(4, Math.floor(room * 0.45)))
    const name = middleEllipsis(item.name, Math.max(4, room - width([{ text: where }]) - 2))
    const gap = Math.max(1, room - width([{ text: name }]) - width([{ text: where }]))
    out.push(
      line([
        blank(4),
        { text: name, fg: chosen ? palette.fg : palette.dim, bold: chosen },
        { text: ' '.repeat(gap) },
        { text: where, fg: chosen ? palette.fg : palette.border },
        blank(1),
      ]),
    )
  })
  while (out.length < h) out.push(line([]))
  return out
}

/** `text` broken at spaces into lines of at most `max` columns. */
function wrapWords(text: string, max: number): string[] {
  const out: string[] = []
  let line = ''
  for (const word of text.split(' ')) {
    const next = line ? `${line} ${word}` : word
    if (stringWidth(next) > max && line) {
      out.push(line)
      line = word
    } else line = next
  }
  if (line) out.push(line)
  return out
}

/**
 * A question on the drop surface's fill in place of its dots: the first name
 * typed asks before the Mac is searched (2026-10-19, P2) — a bold line, then
 * what it means, dim, broken to the surface's width.
 */
export function askRows({
  width: columns,
  rows: h,
  palette,
  title,
  body,
}: {
  width: number
  rows: number
  palette: Palette
  title: string
  body: string
}): Row[] {
  const M = HOME_MARGIN
  const W = columns - M * 2
  const fill = palette.selectionBg
  const line = (runs: Run[]): Row => {
    const row = [blank(3), ...runs].map((run) => ({ ...run, bg: run.bg ?? fill }))
    return [blank(M), ...row, { text: ' '.repeat(Math.max(0, W - width(row))), bg: fill }]
  }
  const said = [
    line([{ text: clip(title, W - 6), fg: palette.fg, bold: true }]),
    ...wrapWords(body, W - 6).map((t) => line([{ text: t, fg: palette.dim }])),
  ]
  const top = Math.max(0, Math.min(2, Math.floor((h - said.length) / 2)))
  const out: Row[] = [...Array.from({ length: top }, () => line([])), ...said].slice(0, h)
  while (out.length < h) out.push(line([]))
  return out
}

/**
 * The drop surface while a name is being looked for (2026-10-19, L1), at
 * least 0.3 s however fast the search: its fill and one line in the middle —
 * the spinner in the mode's colour, then "Searching your Mac", dim.
 */
export function searchingRows({
  width: columns,
  rows: h,
  palette,
  mode,
  glyph,
}: {
  width: number
  rows: number
  palette: Palette
  mode: ShellMode
  /** The spinner's frame. */
  glyph: string
}): Row[] {
  const M = HOME_MARGIN
  const W = columns - M * 2
  const fill = palette.selectionBg
  const said: Run[] = [
    { text: `${glyph} `, fg: modeColours(palette, mode).fg, bold: true },
    { text: 'Searching your Mac', fg: palette.dim },
  ]
  const lead = Math.max(0, Math.floor((W - width(said)) / 2))
  const mid = Math.floor((h - 1) / 2)
  return Array.from({ length: h }, (_, r): Row => {
    const runs = r === mid ? [blank(lead), ...said] : []
    const row = runs.map((run) => ({ ...run, bg: run.bg ?? fill }))
    return [blank(M), ...row, { text: ' '.repeat(Math.max(0, W - width(row))), bg: fill }]
  })
}

/** The file card's width on the surface; the card on the screen after this is the same. */
const CARD_W = 52

/** `text` clipped in the middle, then padded with blanks to exactly `n` columns. */
function padTo(text: string, n: number): string {
  const shown = middleEllipsis(text, n)
  return shown + ' '.repeat(Math.max(0, n - stringWidth(shown)))
}

/**
 * One staged file as a card laid on the dots, which step back to 0.42 of
 * their strength and run right up to its frame. The card is the one on the
 * screen after this, so ↵ does not make it jump.
 */
export function stagedCardRows({
  width: columns,
  rows,
  palette,
  mode,
  file,
  ring,
}: {
  width: number
  rows: number
  palette: Palette
  mode: ShellMode
  file: StagedFile
  /** How far a drop's ring has run through the dots, 0 to 1 (M2a); none at rest. */
  ring?: number | undefined
}): Row[] {
  const W = columns - HOME_MARGIN * 2
  const cw = Math.max(8, Math.min(CARD_W, W - 6))
  const edge = palette.border
  const tag = clip(file.tag, Math.max(1, cw - 6))
  const side = (text: string, fg: string, bold = false): Row => [
    { text: '│ ', fg: edge },
    { text: padTo(text, cw - 4), fg, bold },
    { text: ' │', fg: edge },
  ]
  const card: Row[] = [
    [
      { text: '╭─ ', fg: edge },
      { text: tag, fg: modeColours(palette, mode).fg, bold: true },
      { text: ` ${'─'.repeat(Math.max(0, cw - 5 - stringWidth(tag)))}╮`, fg: edge },
    ],
    side(file.name, palette.fg, true),
    side(file.facts, palette.dim),
    [{ text: `╰${'─'.repeat(cw - 2)}╯`, fg: edge }],
  ]
  return dotted({ width: columns, rows, palette, mode, lines: card, pad: 1, scale: 0.42, ring })
}

/**
 * A dropped folder's card (`watch-art`'s `folderCardLines`) laid on the dots
 * exactly as a file's is: the same step back, the same ring when it lands.
 */
export function folderCardOnDots({
  width: columns,
  rows,
  palette,
  mode,
  card,
  ring,
}: {
  width: number
  rows: number
  palette: Palette
  mode: ShellMode
  card: Row[]
  ring?: number | undefined
}): Row[] {
  return dotted({ width: columns, rows, palette, mode, lines: card, pad: 1, scale: 0.42, ring })
}

/** Where a list's rows start, how far a name goes before it is cut, and the two columns' widths. */
const LIST_INDENT = '    '
const NAME_CLIP = 36
const NAME_COL = 40
const BAND_W = 54

/** A row of runs cut to at most `max` columns. */
function clipRow(row: Row, max: number): Row {
  const out: Row = []
  let used = 0
  for (const run of row) {
    const w = stringWidth(run.text)
    if (used + w <= max) {
      out.push(run)
      used += w
      continue
    }
    const text = clip(run.text, Math.max(0, max - used))
    if (text !== '') out.push({ ...run, text })
    break
  }
  return out
}

/**
 * Several staged files as a list on the bare panel: the count as the
 * headline with the total beside it, then up to three files, a name and a
 * size each, then "+N more". The rows that arrived last wear the picker's
 * band. A short panel gives up its blank row first, then file rows from the
 * end — never the headline or "+N more".
 */
export function stagedListRows({
  width: columns,
  rows: h,
  palette,
  mode,
  view,
}: {
  width: number
  rows: number
  palette: Palette
  mode: ShellMode
  view: StagedView
}): Row[] {
  const M = HOME_MARGIN
  const W = columns - M * 2
  const fill = palette.selectionBg
  const { files } = view
  const more = files.length - 3
  const inner = Math.max(0, h - 2)

  let shown = Math.min(3, files.length)
  let spaced = true
  const length = () => 1 + (spaced ? 1 : 0) + shown + (more > 0 ? 1 : 0)
  if (length() > inner) spaced = false
  while (length() > inner && shown > 0) shown--

  // A narrow panel shortens the name column rather than cutting the size off
  // the end of every row (and a second ellipsis into the name).
  const widest = Math.max(0, ...files.map((f) => stringWidth(f.size)))
  const gap = NAME_COL - NAME_CLIP
  const clipAt = Math.max(1, Math.min(NAME_CLIP, W - LIST_INDENT.length - gap - widest))
  const bandW = Math.min(BAND_W, W - 2)

  const fileRow = (i: number): Row => {
    const f = files[i]
    if (!f) return []
    const name = padTo(f.name, clipAt).padEnd(clipAt + gap)
    if (i >= files.length - view.fresh) {
      const body: Run[] = [
        { text: '▌', fg: modeColours(palette, mode).fg },
        { text: ' ' },
        { text: name, fg: palette.fg },
        { text: f.size, fg: palette.dim },
      ].map((run) => ({ ...run, bg: palette.panelBand }))
      const rest = bandW - width(body)
      return [
        { text: '  ' },
        ...body,
        { text: ' '.repeat(Math.max(0, rest)), bg: palette.panelBand },
      ]
    }
    return [
      { text: LIST_INDENT },
      { text: name, fg: palette.dim },
      { text: f.size, fg: palette.border },
    ]
  }

  const block: Row[] = [
    [
      { text: LIST_INDENT },
      { text: view.headline, fg: palette.fg, bold: true },
      { text: `   ${view.total}`, fg: palette.border },
    ],
  ]
  if (spaced) block.push([])
  for (let i = 0; i < shown; i++) block.push(fileRow(i))
  if (more > 0) block.push([{ text: LIST_INDENT }, { text: `+${more} more`, fg: palette.border }])

  const lead = Math.min(h, 1 + Math.max(0, Math.floor((inner - block.length) / 2)))
  const lines: Row[] = [...Array.from({ length: lead }, (): Row => []), ...block]
  const out: Row[] = []
  for (let r = 0; r < h; r++) {
    const row = clipRow(lines[r] ?? [], W).map((run) => ({ ...run, bg: run.bg ?? fill }))
    out.push([blank(M), ...row, { text: ' '.repeat(Math.max(0, W - width(row))), bg: fill }])
  }
  return out
}

/**
 * The one row under the field while something is staged: the red "left out"
 * line — `fail`, the colour and glyph of an error card — or a dim note.
 */
export function underRow({
  width: columns,
  palette,
  under,
}: {
  width: number
  palette: Palette
  under: UnderField
}): Row {
  const lead = blank(HOME_MARGIN + 2)
  if (under.kind === 'note') return clipRow([lead, { text: under.text, fg: palette.dim }], columns)
  const left = `${under.count} ${under.count === 1 ? 'file' : 'files'} left out`
  const why = `   ${under.name} · ${under.reason}${under.more > 0 ? `, +${under.more} more` : ''}`
  return clipRow(
    [
      lead,
      { text: '✕', fg: palette.fail, bold: true },
      { text: ' ' },
      { text: left, fg: palette.fail, bold: true },
      { text: why, fg: palette.dim },
    ],
    columns,
  )
}
