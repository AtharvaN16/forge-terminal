import { largestBox } from '../core/crop.js'
import { FORMATS } from '../core/formats.js'
import type { Size } from '../core/size.js'
import { blank, type Row, type Run, width } from './home-art.js'
import type { Editor, EditorRow, OpId } from './preset-editor.js'
import { sliderRow } from './quality-art.js'
import type { Palette } from './theme.js'

/**
 * Continue editing's lines (W2, mockups/presets-2026-10.html), for colour
 * mode's window to frame: a row per operation — the marker, ● or ○, the name,
 * the answer — then the file as it is now. A lit row that has a window of its
 * own ends in ›. No words beyond the names and the answers.
 */

export const OP_NAMES: Record<OpId, string> = {
  convert: 'Convert to',
  quality: 'Quality',
  compress: 'Compress',
  resize: 'Resize',
  trim: 'Trim edges',
  crop: 'Crop to shape',
  sharpen: 'Sharpen',
  boost: 'Boost resolution',
  cutout: 'Remove background',
}
const NAME_W = 19
/** Rows whose → opens a window of their own. */
const HAS_WINDOW: readonly OpId[] = ['convert', 'compress', 'resize', 'crop', 'boost']

/** A row's answer, as words: `WebP`, `1920 wide`, `under 500 KB`, `16:9`, `2×`. */
export function valueText(row: EditorRow): string {
  const v = row.value
  if (v === undefined) return ''
  if (row.id === 'convert' && typeof v === 'string') return FORMATS[v]?.label ?? v
  if (row.id === 'compress' && typeof v === 'number') return `under ${v / 1000} KB`
  if (row.id === 'boost' && typeof v === 'number') return `${v}×`
  if (typeof v === 'number') return String(v)
  if (typeof v === 'object' && 'width' in v) return `${v.width} wide`
  if (typeof v === 'object' && 'height' in v) return `${v.height} high`
  if (typeof v === 'object' && 'percent' in v) return `${v.percent}%`
  if (typeof v === 'object' && 'w' in v) return `${v.w}:${v.h}`
  return ''
}

const pad = (row: Row, n: number, bg?: string): Row => {
  const w = width(row)
  return w >= n ? row : [...row, { text: ' '.repeat(n - w), ...(bg ? { bg } : {}) }]
}
const band = (row: Row, bg: string | undefined): Row =>
  bg ? row.map((r) => (r.bg ? r : { ...r, bg })) : row

function rowLine(p: Palette, row: EditorRow, lit: boolean, inner: number, glyph?: string): Row {
  const bg = lit && p.panelBand ? p.panelBand : undefined
  const head: Row = [
    { text: lit ? ' › ' : '   ', fg: p.accent, bold: true },
    { text: row.on ? '● ' : '○ ', fg: row.why ? p.faint : row.on ? p.accent : p.border },
    {
      text: OP_NAMES[row.id].padEnd(NAME_W),
      fg: row.why ? p.faint : row.on || lit ? p.fg : p.dim,
      bold: lit,
    },
  ]
  let value: Row
  if (row.why) {
    // Cannot apply here: dim, the reason where the answer would be (E2).
    value = [{ text: row.why, fg: p.faint }]
  } else if (row.missing !== undefined) {
    // Its extension is not added: → offers it under the row (E3).
    value = [{ text: 'not added', fg: p.faint }]
  } else if (lit && row.id === 'quality' && typeof row.value === 'number') {
    // The quality screen's slider, as long as the window leaves room for.
    const room = Math.max(10, Math.min(30, inner - 3 - 2 - NAME_W - 1))
    value = sliderRow({ palette: p, value: row.value, min: 1, max: 100, width: room }).slice(1)
  } else {
    const words = valueText(row)
    const plain = row.id === 'trim' || row.id === 'sharpen' || row.id === 'cutout'
    value = words
      ? [{ text: words, fg: row.on ? p.fg : p.faint, bold: lit }]
      : row.on && plain
        ? []
        : [{ text: '—', fg: p.faint }]
  }
  // The row being rerun spins before its answer (E5).
  if (glyph) value = [{ text: `${glyph} `, fg: p.accent, bold: true }, ...value]
  const more: Row =
    lit && !row.why && (HAS_WINDOW.includes(row.id) || row.missing !== undefined)
      ? [{ text: '  ›', fg: p.border }]
      : []
  return pad(band([...head, ...value, ...more], bg), inner, bg)
}

/** The window's lines: a blank row, a row per operation, a blank row, the file as it is now, a blank row. */
export function editorLines(
  p: Palette,
  e: Editor,
  foot: Row,
  inner: number,
  spin?: { id: OpId; glyph: string },
): Row[] {
  return [
    [],
    ...e.rows.map((row, i) =>
      rowLine(p, row, i === e.at, inner, spin?.id === row.id ? spin.glyph : undefined),
    ),
    [],
    [blank(3), ...foot],
    [],
  ]
}

/** A list row in a row's window, as colour's: › in the mode colour and the band on the one in hand. */
function listRow(
  p: Palette,
  name: string,
  lit: boolean,
  inner: number,
  nameW: number,
  after: Run[] = [],
): Row {
  const bg = lit && p.panelBand ? p.panelBand : undefined
  const row: Row = [
    { text: lit ? ' › ' : '   ', fg: p.accent, bold: true },
    { text: name.padEnd(nameW), fg: lit ? p.fg : p.dim, bold: lit },
    ...(after.length ? [blank(1), ...after.map((r) => (lit ? r : { ...r, fg: p.border }))] : []),
  ]
  return pad(band(row, bg), inner, bg)
}

/** The lit row's own window: what it offers, or the number being typed. */
export function subLines(p: Palette, e: Editor, inner: number, size?: Size): Row[] {
  const sub = e.sub
  if (!sub) return []
  const caret: Run = { text: ' ', bg: p.fg }
  const field = (typed: string, unit: string): Run[] => [
    { text: ` ${typed}`, fg: p.fg, bg: p.band, bold: true },
    caret,
    { text: ' ', bg: p.band },
    { text: ` ${unit}`, fg: p.dim },
  ]
  if (sub.add) {
    // A missing extension: what adding it downloads, then that it is being added.
    const row = e.rows.find((r) => r.id === sub.id)
    const mb = Math.max(1, Math.round((row?.missing ?? 0) / 1_000_000))
    return [
      [],
      sub.adding
        ? [blank(3), { text: 'adding', fg: p.dim }]
        : [blank(3), { text: ` add · ${mb} MB `, fg: p.ink, bg: p.pill, bold: true }],
      [],
    ]
  }
  if (sub.id === 'convert') {
    return [
      [],
      ...e.targets.map((t, i) => listRow(p, FORMATS[t]?.label ?? t, i === sub.at, inner, 8)),
      [],
    ]
  }
  if (sub.id === 'crop') {
    const shapes = [
      { w: 1, h: 1 },
      { w: 4, h: 5 },
      { w: 16, h: 9 },
      { w: 9, h: 16 },
    ]
    return [
      [],
      ...shapes.map((s, i) => {
        const box = size ? largestBox(size, s) : undefined
        return listRow(
          p,
          `${s.w}:${s.h}`,
          i === sub.at,
          inner,
          6,
          box ? [{ text: `${box.width}×${box.height}`, fg: p.dim }] : [],
        )
      }),
      [],
    ]
  }
  if (sub.id === 'boost') {
    return [
      [],
      ...e.scales.map((k, i) =>
        listRow(
          p,
          `${k}×`,
          i === sub.at,
          inner,
          4,
          size ? [{ text: `${size.width * k}×${size.height * k}`, fg: p.dim }] : [],
        ),
      ),
      [],
    ]
  }
  if (sub.id === 'compress') {
    return [[], listRow(p, 'To a target size', true, inner, 18, field(sub.typed, 'KB')), []]
  }
  // Resize: the side being typed, the other following the picture's shape.
  const n = Number(sub.typed)
  const other =
    size && n > 0
      ? sub.side === 'width'
        ? Math.round((n * size.height) / size.width)
        : Math.round((n * size.width) / size.height)
      : undefined
  const [w, h] = sub.side === 'width' ? ['W', 'H'] : ['H', 'W']
  return [
    [],
    pad(
      [
        blank(2),
        { text: `${w} `, fg: p.accent, bold: true },
        ...field(sub.typed, ''),
        { text: `   ×  ${h} `, fg: p.border },
        { text: other === undefined ? '' : String(other), fg: p.dim },
      ],
      inner,
    ),
    [],
  ]
}
