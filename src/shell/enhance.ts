import { boostAction, removeBackgroundAction } from '../core/actions/extension.js'
import type { Action } from '../core/actions/index.js'
import { BOOST_MAX_SIDE, boostOverLimit } from '../core/extension-targets.js'
import { keptFormat } from '../core/resize.js'
import type { FormatId, ImageInfo } from '../core/types.js'
import type { ExtensionId } from '../extensions/catalog.js'
import type { ExtensionStatus } from '../extensions/manager.js'

/**
 * Enhance (mode 5, mockups/extensions-2026-10.html tabs Flow and 1 Picker):
 * one picker of four rows, each one of the two optional extensions run a
 * particular way. Pure: what the rows are and say for an image, nothing drawn.
 */

export type EnhanceToolId = 'sharpen' | 'boost-2' | 'boost-4' | 'cutout'

export interface EnhanceRow {
  id: EnhanceToolId
  /** The row's name, and the trail's answer: never just "Boost". */
  label: string
  /** The extension that does it. */
  extension: ExtensionId
  /** For a boost row: 1 is Sharpen. */
  scale?: 1 | 2 | 4
  /** What the file is written as: the source's own format, or PNG for a cutout. */
  target: FormatId
  /** What the highlighted row says: dim words, then the fact in bold. */
  detail: { dim: string; bold: string; after?: string }
  /** Why this row cannot be chosen for this image, said on the row, dimmed. */
  tooLarge?: string
  /** Working's verb (W5). */
  verb: string
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

/** The four rows, in the decided order, for `source`. No row is a default. */
export function enhanceRows(source: ImageInfo): EnhanceRow[] {
  const kept = keptFormat(source)
  const asJpeg = source.format === 'heic' ? ' · as JPEG' : ''
  const boost = (scale: 2 | 4): EnhanceRow => {
    const reason = tooLarge(source, scale)
    return {
      id: scale === 2 ? 'boost-2' : 'boost-4',
      label: `Boost resolution ${scale}×`,
      extension: 'boost',
      scale,
      target: kept,
      detail: { dim: '', bold: dims(source.width * scale, source.height * scale), after: asJpeg },
      ...(reason ? { tooLarge: reason } : {}),
      verb: 'Boosting resolution',
    }
  }
  const sharpenReason = tooLarge(source, 1)
  return [
    {
      id: 'sharpen',
      label: 'Sharpen',
      extension: 'boost',
      scale: 1,
      target: kept,
      detail: { dim: 'same size · ', bold: dims(source.width, source.height), after: asJpeg },
      ...(sharpenReason ? { tooLarge: sharpenReason } : {}),
      verb: 'Sharpening',
    },
    boost(2),
    boost(4),
    {
      id: 'cutout',
      label: 'Remove background',
      extension: 'remove-background',
      target: 'png',
      detail: { dim: '', bold: 'transparent PNG' },
      verb: 'Removing background',
    },
  ]
}

export function enhanceRow(source: ImageInfo, id: unknown): EnhanceRow | undefined {
  return enhanceRows(source).find((r) => r.id === id)
}

/** The action a row runs through: the same plan-and-run path as the CLI. */
export const actionForRow = (row: Pick<EnhanceRow, 'extension'>): Action =>
  row.extension === 'boost' ? boostAction : removeBackgroundAction

/** The answers Save as and the run plan with, for a row. */
export function rowValues(row: EnhanceRow): Record<string, unknown> {
  return {
    tool: row.id,
    target: row.target,
    ...(row.scale === undefined ? {} : { scale: String(row.scale) }),
  }
}

/** Where a tool stands on this Mac, as the picker's row shows it. */
export type ToolState =
  | { kind: 'ready' }
  | { kind: 'absent'; downloadBytes: number }
  | { kind: 'unsupported'; reason: string }
  | { kind: 'installing'; done: number; total: number }

export function toolState(status: ExtensionStatus | undefined): ToolState {
  if (!status) return { kind: 'unsupported', reason: 'not available' }
  if (status.installed !== undefined) return { kind: 'ready' }
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
