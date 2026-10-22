import stringWidth from 'string-width'
import type { FolderKind, KindId } from '../core/folder.js'
import { formatBytes, percentChange } from '../core/units.js'
import { blank, gradientAt, HOME_MARGIN, mix, type Row, type Run, width } from './home-art.js'
import { sliderRow } from './quality-art.js'
import { modeColours, modeGradient, type Palette, type ShellMode } from './theme.js'
import { CARD_WIDTH, middleEllipsis } from './width.js'

/*
 * forge watch's screens, as data (mockups/watch-2026-10.html): the folder's
 * card, the hairline the watching screen sweeps a light along, the rows of
 * files that land under it, the list that follows the newest, and the rows
 * of a mixed folder's kinds.
 */

/** The edge keeps at least this much line after the name, so it still reads as an edge. */
const EDGE_MIN = 3

const padText = (s: string, n: number) => {
  const shown = middleEllipsis(s, n)
  return shown + ' '.repeat(Math.max(0, n - stringWidth(shown)))
}

/**
 * A dropped folder's card (D1): today's file card, with "FOLDER – name" in
 * its top edge where a file's format goes — FOLDER in the mode's colour as
 * a format is, the name bold — and the facts inside, dim. A long name is cut
 * in the middle so a little of the edge always follows it.
 */
export function folderCardLines({
  palette,
  mode,
  name,
  lines,
  tag,
  width: columns,
}: {
  palette: Palette
  mode: ShellMode
  name: string
  lines: string[]
  width: number
  /**
   * Several files dropped together, not a folder: the edge says what they
   * are ("PNG ×12"), as the steps' card for several files does, and no name.
   */
  tag?: string | undefined
}): Row[] {
  const cw = Math.max(20, Math.min(CARD_WIDTH, columns - 2 * HOME_MARGIN))
  const e = palette.border
  const kind: Run = { text: tag ?? 'FOLDER', fg: modeColours(palette, mode).fg, bold: true }
  const dash: Run = { text: ' – ', fg: e }
  const room = Math.max(1, cw - 5 - width([kind, dash]) - EDGE_MIN)
  const named: Run = { text: middleEllipsis(name, room), fg: palette.fg, bold: true }
  const edge = tag === undefined ? [kind, dash, named] : [kind]
  const used = width(edge)
  return [
    [
      { text: '╭─ ', fg: e },
      ...edge,
      { text: ` ${'─'.repeat(Math.max(0, cw - 5 - used))}╮`, fg: e },
    ],
    ...lines.map(
      (line): Row => [
        { text: '│ ', fg: e },
        { text: padText(line, cw - 4), fg: palette.dim },
        { text: ' │', fg: e },
      ],
    ),
    [{ text: `╰${'─'.repeat(cw - 2)}╯`, fg: e }],
  ]
}

const NOUNS: Record<KindId, [string, string]> = {
  images: ['image', 'images'],
  pdfs: ['PDF', 'PDFs'],
  documents: ['document', 'documents'],
  videos: ['video', 'videos'],
  audio: ['audio file', 'audio files'],
  other: ['other', 'other'],
}

/** "18 images", "1 PDF". */
export const countOf = (id: KindId, n: number) => `${n} ${NOUNS[id][n === 1 ? 0 : 1]}`

const LABELS: Record<KindId, string> = {
  images: 'Images',
  pdfs: 'PDFs',
  documents: 'Documents',
  videos: 'Videos',
  audio: 'Audio',
  other: 'Other',
}
/** A kind's name as its row and window say it. */
export const kindLabel = (id: KindId) => LABELS[id]

/** A kind's window's title: how many, then the kind — "3 PDFs", "1 PDF". */
export const kindTitle = (id: KindId, n: number) => {
  const [one] = NOUNS[id]
  return n === 1 ? `1 ${one.charAt(0).toUpperCase()}${one.slice(1)}` : `${n} ${LABELS[id]}`
}

/**
 * What the folder's card says inside: one kind by its own name ("24 images
 * · 86.4 MB"); a mixed folder as files, then each kind's count.
 */
export function folderFacts({
  kinds,
  bytes,
  files,
}: {
  kinds: FolderKind[]
  bytes: number
  /** Every file in the folder, whatever its kind. */
  files: number
}): string[] {
  const [only] = kinds
  if (kinds.length === 1 && only && only.why === undefined) {
    return [`${countOf(only.id, only.count)} · ${formatBytes(bytes)}`]
  }
  return [
    `${files} ${files === 1 ? 'file' : 'files'} · ${formatBytes(bytes)}`,
    kinds.map((k) => countOf(k.id, k.count)).join(' · '),
  ]
}

/** Where a light sweeping to and fro over `n` cells is, `i` of `frames` in. */
export const sweepAt = (i: number, frames: number, n: number) =>
  (0.5 - 0.5 * Math.cos((i / frames) * Math.PI * 2)) * (n - 1)
const glow = (c: number, at: number, spread: number) => Math.exp(-(((c - at) / spread) ** 2))

/**
 * The watching line (T1): a hairline in the quiet grey, lit along the
 * mode's gradient near `at`, the light's cell. Without `at` (motion off) it
 * is the grey alone.
 */
export function hairlineRow({
  palette,
  mode,
  width: columns,
  at,
}: {
  palette: Palette
  mode: ShellMode
  width: number
  at?: number | undefined
}): Row {
  const n = Math.max(1, columns - 6)
  const stops = modeGradient(palette, mode)
  return [
    blank(3),
    ...Array.from(
      { length: n },
      (_, c): Run => ({
        text: '─',
        fg:
          at === undefined
            ? palette.faint
            : mix(palette.faint, gradientAt(c, n, stops), glow(c, at, 7)),
      }),
    ),
  ]
}

/** A file that landed while watching, as its row says it. */
export interface WatchedFile {
  path: string
  /** When it landed: "14:06". */
  at: string
  state: 'running' | 'done' | 'failed' | 'left'
  /** Running: the true phase, "Encoding WebP". */
  phase?: string
  /** Running: how long it has run, "4.1s". */
  clock?: string
  /** Done: its format before and after, "HEIC" and "WebP"; and the new file's size. */
  from?: string
  to?: string
  bytes?: number
  /** Done, compressed: the size it was. The row says was → now and the change. */
  was?: number
  /** Failed or left alone: why. */
  reason?: string
  /** A finished row's band as it fades, 1 to 0. */
  flash?: number
}

const NAME_W = 30
const AFTER_W = 17
/** A compressed row's change, "−65%". */
const SAVED_W = 7

/**
 * A landed file's row: its state, its name, what it became and how big it
 * is now (convert says the format, not a saving), the time at `end`. A
 * running file shows its phase and clock; a failure is tinted with why; a
 * file left alone has a dash and why.
 */
export function watchedRow({
  palette,
  mode,
  width: columns,
  file,
  spinner = '⠹',
  end = columns - 2,
}: {
  palette: Palette
  mode: ShellMode
  width: number
  file: WatchedFile
  spinner?: string | undefined
  /** Where the row ends; less when the list's bar takes the last columns. */
  end?: number
}): Row {
  const p = palette
  const name = padText(file.path.split(/[\\/]/).pop() ?? file.path, NAME_W - 2).padEnd(NAME_W)
  const time = file.state === 'running' ? (file.clock ?? '') : file.at
  const timed = (row: Row, bg?: string, fg = p.border): Row => {
    const room = Math.max(0, end - stringWidth(time) - width(row))
    return [
      ...row,
      { text: ' '.repeat(room), ...(bg ? { bg } : {}) },
      { text: time, fg, ...(bg ? { bg } : {}) },
    ]
  }
  if (file.state === 'running') {
    return timed([
      blank(3),
      { text: spinner, fg: modeColours(p, mode).fg, bold: true },
      blank(1),
      { text: name, fg: p.fg, bold: true },
      { text: file.phase ?? '', fg: p.fg, bold: true },
    ])
  }
  if (file.state === 'failed') {
    const bg = p.failTint
    return timed(
      [
        blank(2),
        { text: ' ✕ ', fg: p.fail, bg, bold: true },
        { text: name, fg: p.fail, bg, bold: true },
        { text: file.reason ?? '', fg: p.fg, bg },
      ],
      bg,
      p.failTintDim,
    )
  }
  if (file.state === 'left') {
    return timed([
      blank(3),
      { text: '–', fg: p.border },
      blank(1),
      { text: name, fg: p.dim },
      { text: file.reason ?? '', fg: p.border },
    ])
  }
  const bg = file.flash && file.flash > 0 ? mix(p.canvas, p.panelBand, file.flash) : undefined
  const on = (r: Run): Run => (bg ? { ...r, bg } : r)
  if (file.was !== undefined) {
    // Compressed: the format stayed, so the row says what it weighed and what it saved.
    const { pct } = percentChange(file.was, file.bytes ?? 0)
    return timed(
      [
        blank(2),
        on({ text: ' ✓ ', fg: p.ok, bold: true }),
        on({ text: name, fg: p.fg }),
        on({ text: formatBytes(file.was).padStart(8), fg: p.border }),
        on({ text: '  →  ', fg: p.border }),
        on({ text: formatBytes(file.bytes ?? 0).padStart(8), fg: p.fg }),
        on({ text: `−${Math.round(pct)}%`.padStart(SAVED_W), fg: p.ok, bold: true }),
      ],
      bg,
    )
  }
  return timed(
    [
      blank(2),
      on({ text: ' ✓ ', fg: p.ok, bold: true }),
      on({ text: name, fg: p.fg }),
      on({ text: `${file.from ?? ''} → ${file.to ?? ''}`.padEnd(AFTER_W), fg: p.fg }),
      on({ text: formatBytes(file.bytes ?? 0).padStart(8), fg: p.dim }),
    ],
    bg,
  )
}

/**
 * The list under the hairline (R1): oldest at the top, the newest at the
 * bottom, where the eye is when a file lands. While the rows fit they sit
 * under a blank row. Past `room` the list follows the newest by itself,
 * with the commands list's thin bar at the end; a failure that has scrolled
 * off the top is counted over the list ("↑ 1 failed"), so it never goes
 * unseen. `back` rows up (you scrolled), it stays put, and files that land
 * meanwhile are counted in the last row's place ("↓ 1 new").
 */
export function watchListRows({
  palette,
  rows,
  room,
  width: columns,
  failedAt,
  back = 0,
  fresh = 0,
}: {
  palette: Palette
  rows: Row[]
  room: number
  width: number
  /** The indexes of the rows that failed. */
  failedAt: number[]
  back?: number
  fresh?: number
}): Row[] {
  const end = columns - HOME_MARGIN
  const total = rows.length
  if (total <= room) return [[], ...rows]
  const shown = back > 0 ? room - 1 : room
  const start = Math.max(0, total - shown - back)
  const thumb = Math.max(1, Math.round((shown * shown) / total))
  const at = Math.round((start / Math.max(1, total - shown)) * (shown - thumb))
  const body = rows.slice(start, start + shown).map((row, k): Row => {
    const bar: Run =
      k >= at && k < at + thumb ? { text: '┃', fg: palette.dim } : { text: '│', fg: palette.faint }
    return [...row, blank(end - 1 - width(row)), bar]
  })
  const above = failedAt.filter((i) => i < start).length
  const right = (run: Run): Row => [blank(end - stringWidth(run.text)), run]
  return [
    above > 0 ? right({ text: `↑ ${above} failed`, fg: palette.fail }) : [],
    ...body,
    ...(back > 0
      ? [fresh > 0 ? right({ text: `↓ ${fresh} new`, fg: palette.accent, bold: true }) : []]
      : []),
  ]
}

/** The band a chosen kind's row sits on, as wide as a picker's. */
const KIND_BAND = 60

/**
 * A kind's row on Each kind (M2): how many first, then the kind, then its
 * answer ("WebP · 80"); a kind Forge cannot convert has a dash and why. The
 * chosen row sits on the list's band with the mode's mark.
 */
export function kindRow({
  palette,
  mode,
  kind,
  answer,
  selected,
}: {
  palette: Palette
  mode: ShellMode
  kind: FolderKind
  answer?: string | undefined
  selected: boolean
}): Row {
  const p = palette
  const can = kind.why === undefined
  const what: Row = can
    ? (answer ?? '')
        .split(' · ')
        .flatMap((part, i): Run[] => [
          ...(i > 0 ? [{ text: ' · ', fg: p.border }] : []),
          { text: part, fg: p.fg },
        ])
    : [
        { text: '–', fg: p.border },
        { text: `  ${kind.why}`, fg: p.border },
      ]
  const body: Row = [
    { text: String(kind.count).padStart(3), fg: can ? p.fg : p.dim },
    blank(2),
    { text: kindLabel(kind.id).padEnd(10), fg: can ? p.fg : p.dim, bold: selected },
    ...what,
  ]
  if (!selected) return [blank(4), ...body]
  const band = (r: Run): Run => ({ ...r, bg: r.bg ?? p.listBand })
  const marked: Row = [{ text: '▌', fg: modeColours(p, mode).fg }, blank(1), ...body]
  return [blank(2), ...marked.map(band), band(blank(Math.max(0, KIND_BAND - width(marked))))]
}

/**
 * Edit's pill (B3), as runs: ` ‹ ` the step ` › ` on the folder chip, an
 * arrow in the mode's colour where ←→ can still go and grey at the end.
 */
export function pillRuns({
  palette,
  mode,
  label,
  at,
  of,
}: {
  palette: Palette
  mode: ShellMode
  label: string
  at: number
  of: number
}): Row {
  const chip = palette.folderChip === '' ? {} : { bg: palette.folderChip }
  const arrow = (live: boolean, text: string): Run => ({
    text,
    fg: live ? modeColours(palette, mode).fg : palette.border,
    bold: live,
    ...chip,
  })
  return [
    arrow(at > 0, ' ‹ '),
    { text: label, fg: palette.fg, bold: true, ...chip },
    arrow(at < of - 1, ' › '),
  ]
}

/** One setting in a kind's window: a step on a pill, or the quality slider. */
export type WindowSetting =
  | { label: string; kind: 'pill'; value: string; at: number; of: number }
  | { label: string; kind: 'slider'; value: number; min: number; max: number }

/**
 * A kind's window (colour's W1, centred): its format, then its own setting
 * — Resolution on a pill, or Quality as the quality screen's slider, as
 * Tweak draws its sliders. The setting in hand is on the panel's band with
 * the mode's ›; the other is plain.
 */
export function kindWindowLines({
  palette,
  mode,
  inner,
  focus,
  settings,
}: {
  palette: Palette
  mode: ShellMode
  /** The window's width inside its frame. */
  inner: number
  focus: number
  settings: WindowSetting[]
}): Row[] {
  const p = palette
  const lines: Row[] = [[]]
  settings.forEach((s, i) => {
    const on = i === focus
    if (s.kind === 'slider') {
      lines.push([])
      lines.push([
        blank(3),
        { text: s.label.padEnd(12), fg: on ? p.fg : p.dim, bold: on },
        ...sliderRow({ palette: p, value: s.value, min: s.min, max: s.max, width: 34 }),
      ])
      return
    }
    const band = on && p.panelBand !== '' ? p.panelBand : undefined
    const row: Row = [
      { text: on ? ' › ' : '   ', fg: modeColours(p, mode).fg, bold: true },
      { text: s.label.padEnd(14), fg: on ? p.fg : p.dim, bold: on },
      ...(on
        ? pillRuns({ palette: p, mode, label: s.value, at: s.at, of: s.of })
        : [blank(3), { text: s.value, fg: p.dim }]),
    ]
    const full = [...row, blank(Math.max(0, inner - width(row)))]
    lines.push(band ? full.map((r) => ({ ...r, bg: r.bg ?? band })) : full)
  })
  lines.push([])
  return lines
}
