import { boostAction, removeBackgroundAction } from '../core/actions/extension.js'
import type { Action } from '../core/actions/index.js'
import { targetIdsFor } from '../core/capabilities.js'
import {
  BOOST_MAX_SIDE,
  type BoostScale,
  boostOverLimit,
  boostScales,
} from '../core/extension-targets.js'
import type { FormatId, ImageInfo } from '../core/types.js'
import type { ExtensionId } from '../extensions/catalog.js'
import type { ExtensionStatus } from '../extensions/manager.js'

/**
 * Enhance (mode 5, mockups/extensions-2026-10.html tabs Flow and 1 Picker;
 * mockups/boost-row-2026-10.html B3 and S1): one picker of three rows, each
 * one of the two optional extensions run a particular way. Boost resolution
 * is one row whose scale changes on the row. Pure: what the rows are and say
 * for an image, nothing drawn.
 */

export type EnhanceToolId = 'sharpen' | 'boost' | 'cutout'

/** What a row makes: dim words, then the fact in bold. */
export interface Detail {
  dim: string
  bold: string
  after?: string
}

export interface EnhanceRow {
  id: EnhanceToolId
  /** The row's name, and the trail's answer: never just "Boost". */
  label: string
  /** The extension that does it. */
  extension: ExtensionId
  /** Sharpen: the boost extension at 1×. */
  scale?: 1
  /** Boost resolution: the scales this image can take, smallest first; ←→ steps through them. */
  scales?: Array<{ scale: BoostScale; detail: Detail }>
  /** What the file is written as: the source's own format, or PNG for a cutout. */
  target: FormatId
  /** What the row makes; Boost's at its smallest scale. */
  detail: Detail
  /** What the pane beside the list says the tool does (S1): the short answer, then why. */
  pane: { short: string; long: string }
  /** Why this row cannot be chosen for this image, said on the row, dimmed. */
  tooLarge?: string
  /** Working's verb (W5). */
  verb: string
}

const dims = (w: number, h: number) => `${w} × ${h}`
const grouped = (n: number) => n.toLocaleString('en-US')

/**
 * What Sharpen and Boost resolution write: the source's own format where the
 * image engine writes it, else JPEG for a HEIC (it cannot be written), else PNG.
 */
export function keptFormat(source: ImageInfo): FormatId {
  if (source.format === 'heic') return 'jpeg'
  return targetIdsFor(source).includes(source.format) ? source.format : 'png'
}

function tooLarge(source: ImageInfo, scale: number): string | undefined {
  const over = boostOverLimit(source.width, source.height, scale)
  if (!over) return undefined
  return 'side' in over
    ? `${grouped(over.side)} px, over ${grouped(BOOST_MAX_SIDE)}`
    : `${over.megapixels} MP, over 100 MP`
}

/**
 * The three rows, in the decided order, for `source`. No row is a default.
 * `offered` is what the installed boost makes (`boostScales`); the Boost row
 * keeps those that fit this image.
 */
export function enhanceRows(
  source: ImageInfo,
  offered: readonly BoostScale[] = boostScales(undefined),
): EnhanceRow[] {
  const kept = keptFormat(source)
  const asJpeg = source.format === 'heic' ? ' · as JPEG' : ''
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
    },
  ]
}

/** One row by id; `offered` as for `enhanceRows` (Boost's scales depend on it). */
export function enhanceRow(
  source: ImageInfo,
  id: unknown,
  offered?: readonly BoostScale[],
): EnhanceRow | undefined {
  return enhanceRows(source, offered).find((r) => r.id === id)
}

/** What a row makes at `scale` (one of Boost's), else at its own. */
export function detailAt(row: EnhanceRow, scale?: number): Detail {
  return row.scales?.find((s) => s.scale === scale)?.detail ?? row.detail
}

/** The action a row runs through: the same plan-and-run path as the CLI. */
export const actionForRow = (row: Pick<EnhanceRow, 'extension'>): Action =>
  row.extension === 'boost' ? boostAction : removeBackgroundAction

/** The answers Save as and the run plan with, for a row at `scale` (one of Boost's). */
export function rowValues(row: EnhanceRow, scale?: number): Record<string, unknown> {
  const k = row.scales
    ? (row.scales.find((s) => s.scale === scale) ?? row.scales[0])?.scale
    : row.scale
  return {
    tool: row.id,
    target: row.target,
    ...(k === undefined ? {} : { scale: String(k) }),
  }
}

/** Where a tool stands on this Mac, as the picker's row shows it. */
export type ToolState =
  | {
      kind: 'ready' /** The installed version: which factors boost makes (`boostScales`). */
      version?: string
    }
  | { kind: 'absent'; downloadBytes: number }
  | { kind: 'unsupported'; reason: string }
  | { kind: 'installing'; done: number; total: number }

export function toolState(status: ExtensionStatus | undefined): ToolState {
  if (!status) return { kind: 'unsupported', reason: 'not available' }
  if (status.installed !== undefined) return { kind: 'ready', version: status.installed }
  if (!status.supported) return { kind: 'unsupported', reason: status.reason ?? 'not available' }
  return { kind: 'absent', downloadBytes: status.downloadBytes ?? 0 }
}

/** The slice of `src/extensions/manager.ts` enhance needs, injectable so tests need no network. */
export interface EnhanceTools {
  list(): Promise<ExtensionStatus[]>
  install(
    id: string,
    opts: { onProgress: (done: number, total: number) => void; signal: AbortSignal },
  ): Promise<unknown>
}

/** Loaded on first use, so the shell's start-up never touches `src/extensions/`. */
export const realTools: EnhanceTools = {
  async list() {
    return (await import('../extensions/manager.js')).listExtensions()
  },
  async install(id, opts) {
    return (await import('../extensions/manager.js')).installExtension(id, opts)
  },
}
