import { boostAction, removeBackgroundAction } from '../core/actions/extension.js'
import type { Action } from '../core/actions/index.js'
import { mediaEditAction } from '../core/actions/media.js'
import { cropAction, resizeAction, trimAction } from '../core/actions/resize.js'
import { type CropShape, largestBox, shapesFor } from '../core/crop.js'
import {
  BOOST_MAX_SIDE,
  type BoostScale,
  boostOverLimit,
  boostScales,
} from '../core/extension-targets.js'
import { FORMATS } from '../core/formats.js'
import { hasPicture } from '../core/media.js'
import { keptFormat } from '../core/resize.js'
import type { FormatId, ImageInfo, MediaInfo } from '../core/types.js'
import type { ImageMeasure } from '../engines/image.js'
import { type ExtensionId, offeredHere } from '../extensions/catalog.js'
import type { ExtensionStatus } from '../extensions/manager.js'

/**
 * Edit (mode 5, mockups/extensions-2026-10.html tabs Flow and 1 Picker;
 * mockups/boost-row-2026-10.html B3 and S1): one picker of rows, the first
 * three each one of the two optional extensions run a particular way —
 * Boost resolution one row whose scale changes on the row — then, after one
 * blank row (E3, mockups/resize-2026-10.html), Trim edges, Resize and Crop to
 * shape (mockups/crop-2026-10.html), which are built in. Pure: what the rows
 * are and say for an image, nothing drawn.
 */

export type EditToolId =
  | 'sharpen'
  | 'boost'
  | 'cutout'
  | 'trim'
  | 'resize'
  | 'crop'
  // Video and sound (video spec §3.4).
  | 'cut'
  | 'mute'
  | 'loudness'

/** The row the picker leaves a blank row after (E3): the AI tools above it, the plain ones below. */
export const GAP_AFTER: EditToolId = 'cutout'

/** What a row makes: dim words, then the fact in bold. */
export interface Detail {
  dim: string
  bold: string
  after?: string
}

export interface EditRow {
  id: EditToolId
  /** The row's name, and the trail's answer: never just "Boost". */
  label: string
  /** The extension that does it; absent for a built-in tool, which is always ready. */
  extension?: ExtensionId
  /** Sharpen: the boost extension at 1×. */
  scale?: 1
  /** Boost resolution: the scales this image can take, smallest first; ←→ steps through them. */
  scales?: Array<{ scale: BoostScale; detail: Detail }>
  /** Crop to shape: the shapes this image can be cut to, in the pill's order; ←→ steps through them. */
  shapes?: Array<{ shape: CropShape; detail: Detail }>
  /** What the file is written as: the source's own format, or PNG for a cutout. */
  target: FormatId
  /** What the row makes; Boost's at its smallest scale, Crop's at its first shape. */
  detail: Detail
  /** What the pane beside the list says the tool does (S1): the short answer, then why. */
  pane: { short: string; long: string }
  /** Why this row cannot be chosen for this image, said on the row, dimmed. */
  tooLarge?: string
  /** Working's verb (W5). */
  verb: string
  /** The picker leaves a blank row after this one (E3); else after the last extension row. */
  gapAfter?: true
}

export { keptFormat }

const dims = (w: number, h: number) => `${w} × ${h}`
const grouped = (n: number) => n.toLocaleString('en-US')

function tooLarge(source: ImageInfo, scale: number): string | undefined {
  const over = boostOverLimit(source.width, source.height, scale)
  if (!over) return undefined
  return 'side' in over
    ? `${grouped(over.side)} px, over ${grouped(BOOST_MAX_SIDE)}`
    : `${over.megapixels} MP, over 100 MP`
}

/**
 * Trim's row: the size a trim leaves, once `measure` has it; dimmed with why
 * when there is nothing to cut or the image is animated.
 */
function trimRow(source: ImageInfo, measure: ImageMeasure | undefined): EditRow {
  const trimmed = measure?.trimmed
  return {
    id: 'trim',
    label: 'Trim edges',
    target: keptFormat(source),
    detail:
      trimmed && typeof trimmed === 'object'
        ? { dim: 'empty edges off · ', bold: dims(trimmed.width, trimmed.height) }
        : { dim: '', bold: '' },
    pane: {
      short: 'Cuts off plain borders.',
      long: 'Plain borders come off. Nothing else in the picture changes.',
    },
    ...(trimmed === 'nothing' ? { tooLarge: 'no empty edges' } : {}),
    ...(trimmed === 'animated' ? { tooLarge: 'animated' } : {}),
    verb: trimAction.verb,
  }
}

/**
 * The rows, in the decided order, for `source`. No row is a default.
 * `measure` (read once the list opens) gives Trim its facts. `offered` is
 * what the installed boost makes (`boostScales`); the Boost row keeps those
 * that fit this image. Remove background is a Mac-only row (`platform`).
 */
export function editRows(
  source: ImageInfo,
  measure?: ImageMeasure,
  offered: readonly BoostScale[] = boostScales(undefined),
  platform: NodeJS.Platform = process.platform,
): EditRow[] {
  const kept = keptFormat(source)
  const asJpeg = kept === 'jpeg' && source.format !== 'jpeg' ? ' · as JPEG' : ''
  const scales = offered
    .filter((k) => !tooLarge(source, k))
    .map((scale) => ({
      scale,
      detail: {
        dim: 'becomes ',
        bold: dims(source.width * scale, source.height * scale),
        after: asJpeg,
      },
    }))
  // Dimmed only when no scale fits, with why the smallest does not.
  const boostReason = scales.length === 0 ? tooLarge(source, offered[0] ?? 2) : undefined
  const sharpenReason = tooLarge(source, 1)
  return [
    {
      id: 'sharpen',
      label: 'Sharpen',
      extension: 'boost',
      scale: 1,
      target: kept,
      detail: { dim: 'same size · ', bold: dims(source.width, source.height), after: asJpeg },
      pane: {
        short: 'Keeps the size.',
        long: 'An on-device model redraws soft or noisy detail, so it looks crisper.',
      },
      ...(sharpenReason ? { tooLarge: sharpenReason } : {}),
      verb: 'Sharpening',
    },
    {
      id: 'boost',
      label: 'Boost resolution',
      extension: 'boost',
      scales,
      target: kept,
      detail: scales[0]?.detail ?? { dim: '', bold: '' },
      pane: {
        short: 'Makes it bigger.',
        long: 'An on-device model draws in new detail, so it stays sharp when you zoom in or print it.',
      },
      ...(boostReason ? { tooLarge: boostReason } : {}),
      verb: 'Boosting resolution',
    },
    // Apple Vision does the cutting, so there is no such row where it is not offered.
    ...(offeredHere('remove-background', platform)
      ? [
          {
            id: 'cutout',
            label: 'Remove background',
            extension: 'remove-background',
            target: 'png',
            detail: { dim: '', bold: 'transparent PNG' },
            pane: {
              short: 'Keeps the subject.',
              long: 'Everything behind the subject becomes transparent.',
            },
            verb: 'Removing background',
          } satisfies EditRow,
        ]
      : []),
    trimRow(source, measure),
    {
      id: 'resize',
      label: 'Resize',
      target: kept,
      detail: { dim: 'you choose the size next', bold: '' },
      pane: {
        short: 'Any size, no new detail.',
        long: 'Smaller stays sharp; larger looks softer. Boost resolution adds detail.',
      },
      verb: resizeAction.verb,
    },
    cropRow(source, asJpeg),
  ]
}

/**
 * The rows for several images at once (mockups/batch-2026-10.html, G1): the
 * same tools, each run on every image. Nothing here is measured from one
 * picture — an image a tool cannot change is left as it is and told at Done —
 * so no row is dimmed for one image's sake, and the facts are the tool's
 * alone. Crop to shape is one image at a time: where to cut is a choice made
 * for each picture.
 */
export function batchEditRows(
  first: ImageInfo,
  offered: readonly BoostScale[] = boostScales(undefined),
  platform: NodeJS.Platform = process.platform,
): EditRow[] {
  const none: Detail = { dim: '', bold: '' }
  return editRows(first, undefined, offered, platform).map((row): EditRow => {
    const { tooLarge: _one, ...rest } = row
    switch (row.id) {
      case 'sharpen':
        return { ...rest, detail: { dim: '', bold: 'same size' } }
      case 'boost':
        return {
          ...rest,
          scales: offered.map((scale) => ({ scale, detail: none })),
          detail: none,
        }
      case 'trim':
        return { ...rest, detail: none }
      case 'crop':
        return { ...rest, shapes: [], detail: none, tooLarge: 'one at a time' }
      default:
        return rest
    }
  })
}

/**
 * A video's or sound file's rows (video spec §3.4): Trim and Mute, a blank
 * row, then Resize and Crop to shape for a video; Trim and Even out loudness
 * for sound. Each keeps the format and runs through `mediaEditAction`.
 */
export function mediaEditRows(source: MediaInfo): EditRow[] {
  const target = source.format
  const v = source.facts?.video
  const sound = source.facts ? source.facts.audio !== undefined : true
  const trim: EditRow = {
    id: 'cut',
    label: 'Trim',
    target,
    detail: { dim: '', bold: '' },
    pane: {
      short: 'Cuts off the start and the end.',
      long: 'Copied, not re-encoded, so it takes seconds.',
    },
    verb: 'Trimming',
  }
  if (!hasPicture(source)) {
    return [
      trim,
      {
        id: 'loudness',
        label: 'Even out loudness',
        target,
        detail: { dim: '', bold: '' },
        pane: { short: 'Brings the sound to one steady level.', long: 'The level podcasts use.' },
        verb: 'Evening out loudness',
      },
    ]
  }
  const rows: EditRow[] = [trim]
  if (sound) {
    rows.push({
      id: 'mute',
      label: 'Mute',
      target,
      detail: { dim: '', bold: '' },
      pane: { short: 'Takes the sound out.', long: 'The picture is copied as it is.' },
      verb: 'Muting',
    })
  }
  rows[rows.length - 1] = { ...(rows[rows.length - 1] as EditRow), gapAfter: true }
  rows.push({
    id: 'resize',
    label: 'Resize',
    target,
    detail: { dim: 'you choose the size next', bold: '' },
    pane: { short: 'Makes the picture smaller.', long: 'The shape is kept.' },
    verb: 'Resizing',
  })
  const size = v ? { width: v.width, height: v.height } : undefined
  const shapes = size
    ? shapesFor(size).map((shape) => {
        const box = largestBox(size, shape)
        return { shape, detail: { dim: 'becomes ', bold: dims(box.width, box.height) } }
      })
    : []
  rows.push({
    id: 'crop',
    label: 'Crop to shape',
    shapes,
    target,
    detail: shapes[0]?.detail ?? { dim: '', bold: '' },
    pane: {
      short: 'Changes the shape.',
      long: 'Cuts the picture to a new shape. You see the crop next and can move it.',
    },
    ...(shapes.length === 0 ? { tooLarge: 'no shape to cut' } : {}),
    verb: 'Cropping',
  })
  return rows
}

/**
 * Crop to shape's row (spec 2026-10-13 §2.1): the shapes the photo does not
 * already have, each with the largest box it cuts — nothing is scaled, so
 * that is the size written. Dimmed for an animation, as Trim is, and when no
 * shape would change it (a 1 × 1 image already has every one).
 */
function cropRow(source: ImageInfo, asJpeg: string): EditRow {
  const shapes = shapesFor(source).map((shape) => {
    const box = largestBox(source, shape)
    return { shape, detail: { dim: 'becomes ', bold: dims(box.width, box.height), after: asJpeg } }
  })
  return {
    id: 'crop',
    label: 'Crop to shape',
    shapes,
    target: keptFormat(source),
    detail: shapes[0]?.detail ?? { dim: '', bold: '' },
    pane: {
      short: 'Changes the shape.',
      long: 'Cuts it to a new shape around the subject. You see the crop next and can move it.',
    },
    ...((source.frames ?? 1) > 1
      ? { tooLarge: 'animated' }
      : shapes.length === 0
        ? { tooLarge: 'no shape to cut' }
        : {}),
    verb: cropAction.verb,
  }
}

/** One stop on a row's pill: what ↵ answers with, what the pill says, what the row makes there. */
export interface PillStep {
  value: number | string
  label: string
  detail: Detail
}

/**
 * The pill a row carries at its band's far end, if any: Boost's scales or
 * Crop's shapes, one pill for both. `noun` is the key row's word for ←→.
 */
export function pillOf(row: EditRow): { noun: string; steps: PillStep[] } | undefined {
  if (row.scales) {
    return {
      noun: 'scale',
      steps: row.scales.map((s) => ({ value: s.scale, label: `${s.scale}×`, detail: s.detail })),
    }
  }
  if (row.shapes) {
    return {
      noun: 'shape',
      steps: row.shapes.map((s) => ({
        value: s.shape.label,
        label: s.shape.label,
        detail: s.detail,
      })),
    }
  }
  return undefined
}

/** The pill step `value` names (a scale, a shape's label; as a number or its string), else the first. */
const stepAt = (row: EditRow, value: unknown): PillStep | undefined => {
  const steps = pillOf(row)?.steps ?? []
  return steps.find((s) => String(s.value) === String(value)) ?? steps[0]
}

/** One row by id; `offered` and `platform` as for `editRows` (Boost's scales depend on it). */
export function editRow(
  source: ImageInfo,
  id: unknown,
  offered?: readonly BoostScale[],
  platform: NodeJS.Platform = process.platform,
): EditRow | undefined {
  return editRows(source, undefined, offered, platform).find((r) => r.id === id)
}

/** What a row makes at `step` (one of Boost's scales, one of Crop's shapes), else at its own. */
export function detailAt(row: EditRow, step?: number | string): Detail {
  return pillOf(row)?.steps.find((s) => String(s.value) === String(step))?.detail ?? row.detail
}

/** The action a row runs through: the same plan-and-run path as the CLI. */
export const actionForRow = (row: Pick<EditRow, 'id' | 'extension' | 'target'>): Action =>
  FORMATS[row.target].media !== undefined && row.target !== 'gif'
    ? mediaEditAction
    : row.id === 'trim'
      ? trimAction
      : row.id === 'resize'
        ? resizeAction
        : row.id === 'crop'
          ? cropAction
          : row.extension === 'boost'
            ? boostAction
            : removeBackgroundAction

/**
 * The answers Save as and the run plan with, for a row at `step` on its pill:
 * Boost's scale, Crop's shape (its box is the preview's to add).
 */
export function rowValues(row: EditRow, step?: number | string): Record<string, unknown> {
  const at = stepAt(row, step)
  const k = row.scales ? at?.value : row.scale
  return {
    tool: row.id,
    target: row.target,
    ...(k === undefined ? {} : { scale: String(k) }),
    ...(row.shapes && at ? { shape: at.label } : {}),
    ...(row.id === 'trim' ? { trim: true } : {}),
  }
}

/** The shape `label` names among Crop's, if the row offers it. */
export const shapeOf = (row: EditRow | undefined, label: unknown): CropShape | undefined =>
  row?.shapes?.find((s) => s.shape.label === label)?.shape

/** Where a tool stands on this Mac, as the picker's row shows it. */
export type ToolState =
  /** `version`: the installed one, which decides the factors boost makes (`boostScales`). */
  | { kind: 'ready'; version?: string }
  | { kind: 'absent'; downloadBytes: number }
  | { kind: 'unsupported'; reason: string }
  | { kind: 'installing'; done: number; total: number }

export function toolState(status: ExtensionStatus | undefined): ToolState {
  if (!status) return { kind: 'unsupported', reason: 'not available' }
  if (status.installed !== undefined) return { kind: 'ready', version: status.installed }
  if (!status.supported) return { kind: 'unsupported', reason: status.reason ?? 'not available' }
  return { kind: 'absent', downloadBytes: status.downloadBytes ?? 0 }
}

/** The slice of `src/extensions/manager.ts` edit needs, injectable so tests need no network. */
export interface EditTools {
  list(): Promise<ExtensionStatus[]>
  install(
    id: string,
    opts: { onProgress: (done: number, total: number) => void; signal: AbortSignal },
  ): Promise<unknown>
}

/** Loaded on first use, so the shell's start-up never touches `src/extensions/`. */
export const realTools: EditTools = {
  async list() {
    return (await import('../extensions/manager.js')).listExtensions()
  },
  async install(id, opts) {
    return (await import('../extensions/manager.js')).installExtension(id, opts)
  },
}
