import { fromLch, inGamut, oklabToRgb, type Rgb, rgbToOklab, toHex, toLch } from './space.js'

/**
 * A tonal scale with the reference always at 500 (colour spec §2.3, §4.4).
 * Lightness follows a fixed ladder away from the reference, chroma thins
 * towards the ends, the hue is held, and a step outside sRGB gives up chroma
 * until it fits. The numbers were tuned on the mockups and are pinned by the
 * tests; change them only with new measurements.
 */
export const STEPS = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950] as const

export interface Step {
  step: number
  rgb: Rgb
  hex: string
  /** True for 500, which is the reference exactly. */
  reference: boolean
}

const UP = [1.0, 0.86, 0.68, 0.46, 0.22]
const DOWN = [0.2, 0.4, 0.6, 0.8, 1.0]

export function scale(ref: Rgb): Step[] {
  const { L: L0, C: C0, h } = toLch(rgbToOklab(ref))
  const grey = C0 < 0.015
  // A reference lighter than the ladder's top, or darker than its floor,
  // keeps those steps level with itself rather than reversing them.
  const top = Math.max(0.975, L0)
  // Below L 0.16 the usual floor would sit above the reference; there the
  // darker steps keep going down towards black instead.
  const floor = L0 < 0.16 ? 0.42 * L0 : Math.max(0.16, 0.42 * L0)
  return STEPS.map((step, i) => {
    if (i === 5) return { step, rgb: { ...ref }, hex: toHex(ref), reference: true }
    const lighter = i < 5
    const f = lighter ? (UP[i] as number) : (DOWN[i - 6] as number)
    const L = lighter ? L0 + (top - L0) * f : L0 - (L0 - floor) * f
    let C = grey ? 0 : C0 * (lighter ? 1 - 0.88 * f : 1 - 0.45 * f)
    while (C > 0 && !inGamut(fromLch({ L, C, h }))) C -= 0.002
    const rgb = oklabToRgb(fromLch({ L, C: Math.max(0, C), h }))
    return { step, rgb, hex: toHex(rgb), reference: false }
  })
}
