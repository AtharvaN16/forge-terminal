import { invalidArguments } from './errors.js'
import { FORMATS } from './formats.js'
import type { FormatId } from './types.js'

/**
 * Remove-background must keep its alpha: flattening would undo the operation
 * (spec §5.2). Read from the format table, not a list (invariant 2).
 */
export function removeBackgroundTargetRefusal(target: FormatId) {
  if (FORMATS[target].hasAlpha) return undefined
  const carrying = (Object.keys(FORMATS) as FormatId[])
    .filter((id) => FORMATS[id].hasAlpha && id !== 'heic')
    .join(', ')
  return invalidArguments(
    `${FORMATS[target].label} cannot hold transparency, so a cutout cannot be saved as one.`,
    `Choose a format that can: ${carrying}.`,
  )
}

/** The boost runner's own limits (extensions/boost/runner.ts): a side, and the whole output. */
export const BOOST_MAX_SIDE = 16_384
export const BOOST_MAX_PIXELS = 100_000_000

/**
 * Why a `scale`× boost of a `width` × `height` image is past the runner's
 * limits, or undefined when it fits. Scale 1 is Sharpen: the same check on
 * the image itself.
 */
export function boostOverLimit(
  width: number,
  height: number,
  scale: number,
): { side: number } | { megapixels: number } | undefined {
  const side = Math.max(width, height) * scale
  if (side > BOOST_MAX_SIDE) return { side }
  const pixels = width * scale * height * scale
  if (pixels > BOOST_MAX_PIXELS) return { megapixels: Math.round(pixels / 1e6) }
  return undefined
}
