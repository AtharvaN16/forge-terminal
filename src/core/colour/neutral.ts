import { DEFAULT_STEPS, type Step, type StepSpec, scale } from './scale.js'
import { fromLch, oklabToRgb, type Rgb, rgbToOklab, toLch } from './space.js'

/**
 * A neutral: a grey scale tinted with a colour's hue, as Tailwind's greys
 * are tinted towards blue or warm. How much tint is one setting, measured
 * against Tailwind's own greys rather than picked by eye.
 */
export type Tint = 'none' | 'faint' | 'soft' | 'strong'

/** OKLCH chroma at the 500: Tailwind's neutral, zinc and stone, gray, slate. */
export const TINTS: Readonly<Record<Tint, number>> = {
  none: 0,
  faint: 0.012,
  soft: 0.024,
  strong: 0.04,
}

export const DEFAULT_TINT: Tint = 'soft'

/**
 * Every Tailwind grey's 500 sits at OKLCH lightness ≈ 0.553, so a neutral's
 * does too, not at the colour's own: a pale yellow would otherwise give a
 * pale grey 500.
 */
export const NEUTRAL_L = 0.553

/** The neutral's 500: the neutral lightness, the tint's chroma, the colour's hue. */
export function neutralRef(ref: Rgb, tint: Tint): Rgb {
  const { h } = toLch(rgbToOklab(ref))
  return oklabToRgb(fromLch({ L: NEUTRAL_L, C: TINTS[tint], h }))
}

/** The neutral scale for `ref`: an ordinary scale around its neutral 500. */
export function neutral(
  ref: Rgb,
  tint: Tint = DEFAULT_TINT,
  spec: StepSpec = DEFAULT_STEPS,
): Step[] {
  return scale(neutralRef(ref, tint), spec)
}
