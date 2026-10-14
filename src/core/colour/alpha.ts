import { type Rgb, toHex } from './space.js'

/**
 * Radix-style alpha colours: a see-through colour that, laid over a known
 * background, looks exactly like a solid one. Blended in sRGB, channel by
 * channel, as browsers and Figma blend, so what is checked here is what a
 * user will see.
 */
export interface Alpha {
  rgb: Rgb
  /** The opacity, a whole byte: A/255. */
  a: number
  /** `#RRGGBBAA`, in capitals. */
  hex8: string
  /** The opacity as a whole percentage. */
  pct: number
}

export const WHITE: Rgb = { r: 255, g: 255, b: 255 }
export const BLACK: Rgb = { r: 0, g: 0, b: 0 }

const CHANNELS = ['r', 'g', 'b'] as const

/** `alpha` laid over `bg`, each channel rounded as a screen would show it. */
export function composite(alpha: Alpha, bg: Rgb): Rgb {
  const { rgb, a } = alpha
  const at = (k: (typeof CHANNELS)[number]) => Math.round(a * rgb[k] + (1 - a) * bg[k])
  return { r: at('r'), g: at('g'), b: at('b') }
}

function make(rgb: Rgb, A: number): Alpha {
  const a = A / 255
  return {
    rgb,
    a,
    hex8: toHex(rgb) + A.toString(16).padStart(2, '0').toUpperCase(),
    pct: Math.round(a * 100),
  }
}

/**
 * The most see-through colour that, over `over`, reproduces `target` to
 * within 1 per channel. Each channel is pushed as far from the background
 * as it can go (to 0 or 255), which sets the least opacity that channel
 * needs; the most any channel needs, rounded up to a byte, is tried first.
 * Rounding the colour to bytes can miss by more than 1, so the opacity then
 * climbs a byte at a time until the composite checks out; at 255 it is the
 * target itself.
 *
 * A target equal to the background needs no opacity, but none is zero:
 * it comes back as the background's own colour at 1/255.
 */
export function alphaOf(target: Rgb, over: Rgb): Alpha {
  let need = 0
  for (const k of CHANNELS) {
    const t = target[k] / 255
    const b = over[k] / 255
    const d = t - b
    if (d > 0) need = Math.max(need, d / (1 - b))
    else if (d < 0) need = Math.max(need, -d / b)
  }
  for (let A = Math.max(1, Math.ceil(need * 255 - 1e-9)); A < 255; A++) {
    const a = A / 255
    const solve = (k: (typeof CHANNELS)[number]) =>
      Math.round(Math.min(255, Math.max(0, (target[k] - (1 - a) * over[k]) / a)))
    const alpha = make({ r: solve('r'), g: solve('g'), b: solve('b') }, A)
    const back = composite(alpha, over)
    if (CHANNELS.every((k) => Math.abs(back[k] - target[k]) <= 1)) return alpha
  }
  return make({ ...target }, 255)
}
