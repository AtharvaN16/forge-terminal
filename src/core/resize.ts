import { ENGINES } from '../engines/registry.js'
import { targetIdsFor } from './capabilities.js'
import { type ForgeError, invalidArguments } from './errors.js'
import { FORMATS } from './formats.js'
import type { Size } from './size.js'
import type { FormatId, ImageInfo, ResizeSpec } from './types.js'

export { resizedSize, type Size, sizeOverLimit } from './size.js'

/**
 * Resize (spec 2026-10-12): the size arithmetic, the limits and the names.
 * Pure. The slider's range is here so the shell, the CLI and the tests agree.
 */
export const RESIZE_MIN = 5
export const RESIZE_MAX = 200
export const RESIZE_STEP = 5

/**
 * What Sharpen, Boost, Trim and Resize write: the source's own format where
 * the image engine writes it, else JPEG for a photo it cannot write (HEIC,
 * camera RAW), else PNG.
 */
export function keptFormat(source: ImageInfo): FormatId {
  if (source.format === 'heic' || source.format === 'raw') return 'jpeg'
  return targetIdsFor(source).includes(source.format) ? source.format : 'png'
}

/**
 * Why `--to` cannot take a trim, crop or resize, or undefined when it can. All
 * are the image engine's work; a target only another engine writes (a PDF) would
 * drop them silently and still name the file as if they ran. Read from the
 * image engine's own `writes`, so no format list lives here (invariant 2).
 */
export function editTargetRefusal(
  target: FormatId,
  what: 'trim' | 'resize' | 'crop',
): ForgeError | undefined {
  const writes = ENGINES.find((e) => e.id === 'image')?.writes
  if (writes?.has(target)) return undefined
  return invalidArguments(
    `Cannot ${what} into ${FORMATS[target].label}; only an image format can take the edit.`,
    `Choose one of: ${[...(writes ?? [])].join(', ')}.`,
  )
}

/** `2016x1512`, for a file name. */
export const sizeSuffix = (s: Size): string => `${s.width}x${s.height}`

/** `50pct`, `1200w`, `900h`: what a name says when the result size is not known yet. */
export const specSuffix = (spec: ResizeSpec): string =>
  'percent' in spec ? `${spec.percent}pct` : 'width' in spec ? `${spec.width}w` : `${spec.height}h`
