import { boostOverLimit } from './extension-targets.js'
import type { ResizeSpec } from './types.js'

/**
 * The size arithmetic of Resize (spec 2026-10-12), apart from `resize.ts`
 * because the image engine needs it and `resize.ts` reaches the capability
 * graph, which reaches the engines. Re-exported from `resize.ts`.
 */

export interface Size {
  width: number
  height: number
}

const px = (n: number) => Math.max(1, Math.round(n))

/** The size `spec` gives `from`, the shape always kept. */
export function resizedSize(from: Size, spec: ResizeSpec): Size {
  if ('percent' in spec) {
    return {
      width: px((from.width * spec.percent) / 100),
      height: px((from.height * spec.percent) / 100),
    }
  }
  if ('width' in spec)
    return { width: px(spec.width), height: px((from.height * spec.width) / from.width) }
  return { width: px((from.width * spec.height) / from.height), height: px(spec.height) }
}

/** Boost's limits (16,384 px a side, 100 MP), applied to a size rather than a scale. */
export function sizeOverLimit(size: Size): { side: number } | { megapixels: number } | undefined {
  return boostOverLimit(size.width, size.height, 1)
}
