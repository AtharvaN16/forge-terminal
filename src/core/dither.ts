import { FORMATS } from './formats.js'
import type { FormatId, ImageInfo } from './types.js'

/**
 * Dither in /edit: the picture cut to a few colours, the missing ones scattered
 * as dots so the eye mixes them back. The same palette cut `/compress` makes,
 * asked for on its own and at a colour count you choose. Pure.
 */

/**
 * The counts the pill offers, the gentlest first; ← is gentler and → stronger.
 * A palette PNG or GIF holds 2, 4, 16 or 256 colours (1, 2, 4 or 8 bits), and
 * Sharp rounds any count up to the next of those, so a count between them
 * (8, say) would say less than the file has. 256 is left out: it is the
 * picture, near enough.
 */
export const DITHER_COLOURS: readonly number[] = [16, 4, 2]

export const isDitherColours = (v: unknown): v is number =>
  typeof v === 'number' && DITHER_COLOURS.includes(v)

export const ditherSuffix = (colours: number): string => `dithered-${colours}`

export const coloursLabel = (colours: number): string => `${colours} colours`

/**
 * The format a dithered picture is written in: its own where that is a palette
 * format (a GIF stays a GIF), else a PNG. The dots are the point, and a lossy
 * encoder would smear them back into a blur.
 */
export const ditherTarget = (source: ImageInfo): FormatId =>
  FORMATS[source.format].quantisable ? source.format : 'png'

/** Only a GIF can keep its frames through a dither; any other animation is a still here. */
export const canDither = (source: ImageInfo): boolean =>
  !(source.frames > 1) || source.format === 'gif'
