import { CROP_SHAPES } from '../core/crop.js'
import type { PresetSteps } from '../core/preset.js'
import type { Aspect, FormatId, ResizeSpec } from '../core/types.js'

/**
 * Continue editing (W2, mockups/presets-2026-10.html): the state of the one
 * window over Done. Every operation is a row, selected (●) or not (○), with
 * its answer; a row that needs room opens its own window under it. Pure, so
 * every key's effect is tested without Ink; the component draws it and runs
 * `stepsOf` from the original as it changes.
 */
export type OpId =
  | 'convert'
  | 'quality'
  | 'compress'
  | 'resize'
  | 'trim'
  | 'crop'
  | 'sharpen'
  | 'boost'
  | 'cutout'

type Value = FormatId | number | ResizeSpec | Aspect

export interface EditorRow {
  id: OpId
  on: boolean
  /** The row's answer, kept when it is unselected so space brings it back. */
  value?: Value
}

/** A row's own window: a list to choose from, or a number being typed. */
export interface Sub {
  id: OpId
  /** The highlighted item of a list. */
  at: number
  typed: string
  /** Resize's box being typed in. */
  side: 'width' | 'height'
}

export interface Editor {
  rows: EditorRow[]
  at: number
  sub?: Sub | undefined
  /** What Convert to can become, from the source (invariant 2). */
  targets: FormatId[]
  scales: Array<2 | 3 | 4>
}

export type EditorKey =
  | 'up'
  | 'down'
  | 'left'
  | 'right'
  | 'shiftLeft'
  | 'shiftRight'
  | 'space'
  | 'enter'
  | 'tab'
  | 'backspace'
  | { digit: string }

/** Rows with nothing to ask: space alone selects them. */
const PLAIN: readonly OpId[] = ['trim', 'sharpen', 'cutout']
/** Rows whose answer is chosen in a window of their own. */
const LISTED: readonly OpId[] = ['convert', 'crop', 'boost']
const TYPED: readonly OpId[] = ['compress', 'resize']

export function openEditor(o: {
  /** The format the convert just made. */
  target: FormatId
  /** Its quality, for a lossy target. */
  quality?: number | undefined
  targets: FormatId[]
  scales: Array<2 | 3 | 4>
  /** Remove background is offered here (macOS). */
  cutout: boolean
}): Editor {
  const rows: EditorRow[] = [
    { id: 'convert', on: true, value: o.target },
    o.quality === undefined
      ? { id: 'quality', on: false }
      : { id: 'quality', on: true, value: o.quality },
    { id: 'compress', on: false },
    { id: 'resize', on: false },
    { id: 'trim', on: false },
    { id: 'crop', on: false },
    { id: 'sharpen', on: false },
    { id: 'boost', on: false },
    ...(o.cutout ? [{ id: 'cutout' as const, on: false }] : []),
  ]
  const first = rows.findIndex((r) => !r.on)
  return { rows, at: first < 0 ? 0 : first, targets: o.targets, scales: o.scales }
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))

/** The list a row's window offers. */
function listOf(e: Editor, id: OpId): Value[] {
  if (id === 'convert') return e.targets
  if (id === 'crop') return CROP_SHAPES.map((s) => ({ w: s.w, h: s.h }))
  if (id === 'boost') return e.scales
  return []
}

const same = (a: Value | undefined, b: Value) => JSON.stringify(a) === JSON.stringify(b)

function openSub(e: Editor): Editor {
  const row = e.rows[e.at]
  if (!row || PLAIN.includes(row.id) || row.id === 'quality') return e
  const list = listOf(e, row.id)
  const at = Math.max(
    0,
    list.findIndex((v) => same(row.value, v)),
  )
  return { ...e, sub: { id: row.id, at, typed: '', side: 'width' } }
}

const setRow = (e: Editor, i: number, patch: Partial<EditorRow>): Editor => ({
  ...e,
  rows: e.rows.map((r, k) => (k === i ? { ...r, ...patch } : r)),
})

function subKey(e: Editor, sub: Sub, k: EditorKey): Editor {
  if (k === 'left') return { ...e, sub: undefined }
  if (LISTED.includes(sub.id)) {
    const list = listOf(e, sub.id)
    if (k === 'up' || k === 'down') {
      const at = clamp(sub.at + (k === 'down' ? 1 : -1), 0, list.length - 1)
      return { ...e, sub: { ...sub, at } }
    }
    if (k === 'enter') {
      const value = list[sub.at]
      if (value === undefined) return e
      return { ...setRow(e, e.at, { on: true, value }), sub: undefined }
    }
    return e
  }
  // A number being typed: Compress's size in KB, Resize's width or height.
  if (typeof k === 'object') {
    if (!/^[0-9]$/.test(k.digit) || sub.typed.length >= 6) return e
    return { ...e, sub: { ...sub, typed: sub.typed + k.digit } }
  }
  if (k === 'backspace') return { ...e, sub: { ...sub, typed: sub.typed.slice(0, -1) } }
  if (k === 'tab' && sub.id === 'resize') {
    return { ...e, sub: { ...sub, side: sub.side === 'width' ? 'height' : 'width', typed: '' } }
  }
  if (k === 'enter') {
    const n = Number(sub.typed)
    if (!Number.isInteger(n) || n <= 0) return { ...e, sub: undefined }
    const value: Value =
      sub.id === 'compress' ? n * 1000 : sub.side === 'width' ? { width: n } : { height: n }
    return { ...setRow(e, e.at, { on: true, value }), sub: undefined }
  }
  return e
}

/** What a key does to the window. ↵ outside a row's window is the component's: done. */
export function press(e: Editor, k: EditorKey): Editor {
  if (e.sub) return subKey(e, e.sub, k)
  const row = e.rows[e.at]
  if (!row) return e
  if (k === 'up' || k === 'down') {
    return { ...e, at: clamp(e.at + (k === 'down' ? 1 : -1), 0, e.rows.length - 1) }
  }
  if (row.id === 'quality') {
    const step = { left: -1, right: 1, shiftLeft: -10, shiftRight: 10 } as const
    if (typeof k === 'string' && k in step) {
      const now = typeof row.value === 'number' ? row.value : 80
      return setRow(e, e.at, { on: true, value: clamp(now + step[k as keyof typeof step], 1, 100) })
    }
  }
  if (k === 'right') return openSub(e)
  if (k === 'space') {
    // A row that needs an answer and has none opens its window instead.
    if (!row.on && row.value === undefined && !PLAIN.includes(row.id)) return openSub(e)
    return setRow(e, e.at, { on: !row.on })
  }
  if (typeof k === 'object' && TYPED.includes(row.id)) {
    // Typing on a number row opens its window with that first digit.
    const opened = openSub(e)
    return opened.sub ? subKey(opened, opened.sub, k) : opened
  }
  return e
}

/** The preset the selected rows make. */
export function stepsOf(e: Editor): PresetSteps {
  const steps: PresetSteps = {}
  for (const row of e.rows) {
    if (!row.on) continue
    const v = row.value
    if (row.id === 'convert' && typeof v === 'string') steps.to = v
    else if (row.id === 'quality' && typeof v === 'number') steps.quality = v
    else if (row.id === 'compress' && typeof v === 'number') steps.maxBytes = v
    else if (row.id === 'resize' && typeof v === 'object') steps.resize = v as ResizeSpec
    else if (row.id === 'trim') steps.trim = true
    else if (row.id === 'crop' && typeof v === 'object') steps.crop = v as Aspect
    else if (row.id === 'sharpen') steps.sharpen = true
    else if (row.id === 'boost' && (v === 2 || v === 3 || v === 4)) steps.boost = v
    else if (row.id === 'cutout') steps.removeBackground = true
  }
  return steps
}
