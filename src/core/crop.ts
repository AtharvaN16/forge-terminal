import { invalidArguments } from './errors.js'
import type { Size } from './size.js'
import type { Aspect, Box } from './types.js'

export type { Aspect, Box, CropSpec } from './types.js'

/**
 * Crop to shape (spec 2026-10-13): the box arithmetic, the shapes the shell
 * offers and the preview's dot grid. Pure. Every box is in upright pixels.
 */

export interface CropShape extends Aspect {
  label: string
}

/**
 * The shell pill's four, in order. Shapes, not output formats: invariant 2 is
 * about formats, and the CLI takes any ratio (`parseAspect`).
 */
export const CROP_SHAPES: readonly CropShape[] = [
  { w: 1, h: 1, label: '1:1' },
  { w: 4, h: 5, label: '4:5' },
  { w: 16, h: 9, label: '16:9' },
  { w: 9, h: 16, label: '9:16' },
]

/** Zoom is the box side as a percentage of the largest box's. */
export const CROP_ZOOM_MIN = 20
export const CROP_ZOOM_STEP = 10

const px = (n: number) => Math.max(1, Math.round(n))
const clamp = (n: number, min: number, max: number) => Math.min(Math.max(n, min), max)

/** The biggest box of this shape the image holds, centred. It spans the whole width or height. */
export function largestBox(size: Size, aspect: Aspect): Box {
  const byWidth = px((size.width * aspect.h) / aspect.w)
  const [width, height] =
    byWidth <= size.height
      ? [size.width, byWidth]
      : [Math.min(size.width, px((size.height * aspect.w) / aspect.h)), size.height]
  return {
    left: Math.floor((size.width - width) / 2),
    top: Math.floor((size.height - height) / 2),
    width,
    height,
  }
}

const isWhole = (size: Size, box: Box) => box.width === size.width && box.height === size.height

/** The shapes worth offering: one the image already has would cut nothing. */
export function shapesFor(size: Size): CropShape[] {
  return CROP_SHAPES.filter((s) => !isWhole(size, largestBox(size, s)))
}

/** The box at `pct` % of the largest, kept on `centre`, then pushed back inside the image. */
export function zoomedBox(
  size: Size,
  aspect: Aspect,
  centre: { x: number; y: number },
  pct: number,
): Box {
  const largest = largestBox(size, aspect)
  // One side is scaled and the other derived through the ratio (as largestBox
  // does), so the box keeps the shape; rounding both drifted (16:9 → 806 × 454).
  // The longer side leads: the shorter one from it is the closer pair.
  let width: number
  let height: number
  if (aspect.w >= aspect.h) {
    width = px((largest.width * pct) / 100)
    height = Math.min(size.height, px((width * aspect.h) / aspect.w))
  } else {
    height = px((largest.height * pct) / 100)
    width = Math.min(size.width, px((height * aspect.w) / aspect.h))
  }
  return {
    left: clamp(Math.round(centre.x - width / 2), 0, size.width - width),
    top: clamp(Math.round(centre.y - height / 2), 0, size.height - height),
    width,
    height,
  }
}

/** The box moved by `dx`, `dy` pixels, stopping at the image's edges. */
export function movedBox(size: Size, box: Box, dx: number, dy: number): Box {
  return {
    ...box,
    left: clamp(box.left + dx, 0, size.width - box.width),
    top: clamp(box.top + dy, 0, size.height - box.height),
  }
}

/** Which way the box can move at all: not along an axis it spans. */
export function movableAxes(size: Size, box: Box): { x: boolean; y: boolean } {
  return { x: box.width < size.width, y: box.height < size.height }
}

export function centreOf(box: Box): { x: number; y: number } {
  return { x: box.left + box.width / 2, y: box.top + box.height / 2 }
}

/** The box's area as a whole percentage of the image's. */
export function keptShare(size: Size, box: Box): number {
  return Math.round((box.width * box.height * 100) / (size.width * size.height))
}

/** `16:9`. */
export const aspectLabel = (a: Aspect): string => `${a.w}:${a.h}`

/** `cropped-16x9`, for a file name (`:` cannot be in one on Windows). */
export const cropSuffix = (a: Aspect): string => `cropped-${a.w}x${a.h}`

/** `--crop`'s value: `W:H`, two whole numbers from 1 to 100. */
export function parseAspect(text: string): Aspect {
  const match = /^(\d{1,3}):(\d{1,3})$/.exec(text.trim())
  const w = Number(match?.[1])
  const h = Number(match?.[2])
  if (!match || w < 1 || w > 100 || h < 1 || h > 100) {
    throw invalidArguments(
      `"${text}" is not a shape; it takes two whole numbers from 1 to 100, as W:H.`,
      'Try --crop 1:1 or --crop 16:9.',
    )
  }
  return { w, h }
}

/**
 * A thumbnail: `width × height` pixels, RGB, 3 bytes each, and with
 * transparency its alpha, one byte each. No `alpha`: opaque.
 */
export interface Thumb {
  width: number
  height: number
  rgb: Uint8Array
  alpha?: Uint8Array | undefined
}

/**
 * The preview's dot grid: `cols × dotRows` dots, RGB, 3 bytes each (dotRows =
 * 2 × cell rows), and the alpha of each when the thumbnail had one.
 */
export interface Dots {
  cols: number
  dotRows: number
  rgb: Uint8Array
  alpha?: Uint8Array | undefined
}

/**
 * Area-averages a thumbnail into `cols × rows*2` dots: two per cell, one for
 * each half of a `▀`. A pixel straddling a dot's edge counts by how much of
 * it falls inside, so the grid never shimmers as the picture is resized.
 * Colour is weighed by alpha (premultiplied), so what transparency hides —
 * black, or a removed background — never tints a dot; the alpha is the
 * share of the dot that is seen.
 */
export function sampleDots(thumb: Thumb, cols: number, rows: number): Dots {
  const dotRows = rows * 2
  const rgb = new Uint8Array(cols * dotRows * 3)
  const alpha = thumb.alpha ? new Uint8Array(cols * dotRows) : undefined
  const sx = thumb.width / cols
  const sy = thumb.height / dotRows
  for (let dy = 0; dy < dotRows; dy++) {
    const y0 = dy * sy
    const y1 = y0 + sy
    for (let dx = 0; dx < cols; dx++) {
      const x0 = dx * sx
      const x1 = x0 + sx
      let r = 0
      let g = 0
      let b = 0
      let seen = 0
      let area = 0
      for (let y = Math.floor(y0); y < Math.min(Math.ceil(y1), thumb.height); y++) {
        const wy = Math.min(y + 1, y1) - Math.max(y, y0)
        for (let x = Math.floor(x0); x < Math.min(Math.ceil(x1), thumb.width); x++) {
          const p = y * thumb.width + x
          const w = (Math.min(x + 1, x1) - Math.max(x, x0)) * wy
          const wa = w * (thumb.alpha ? (thumb.alpha[p] ?? 0) / 255 : 1)
          const i = p * 3
          r += (thumb.rgb[i] ?? 0) * wa
          g += (thumb.rgb[i + 1] ?? 0) * wa
          b += (thumb.rgb[i + 2] ?? 0) * wa
          seen += wa
          area += w
        }
      }
      const d = dy * cols + dx
      if (seen > 0) rgb.set([r / seen, g / seen, b / seen].map(Math.round), d * 3)
      if (alpha && area > 0) alpha[d] = Math.round((seen * 255) / area)
    }
  }
  return { cols, dotRows, rgb, ...(alpha ? { alpha } : {}) }
}
