import { invalidArguments } from '../errors.js'
import { fromLch, inGamut, oklabToRgb, type Rgb, rgbToOklab, toHex, toLch } from './space.js'

/**
 * A tonal scale with the reference always at 500 (colour spec §2.3, §4.4).
 * Lightness follows a fixed ladder away from the reference, chroma thins
 * towards the ends, the hue is held, and a step outside sRGB gives up chroma
 * until it fits. The numbers were tuned on the mockups and are pinned by the
 * tests; change them only with new measurements.
 *
 * Which steps there are is chosen (§4.4.1): places on a ruler from 0, near
 * white, to 1000, near black. A step between two of the ladder's is
 * interpolated, so the default eleven keep their exact hex.
 */

export interface StepSpec {
  /** The lightest step: 0 to 450, in 50s. */
  start: number
  /** The darkest step: 550 to 1000, in 50s. */
  end: number
  /** The steps between are the multiples of this: 50, 100 or 250. */
  every: number
}

export const DEFAULT_STEPS: StepSpec = { start: 50, end: 950, every: 100 }
export const STARTS = [0, 50, 100, 150, 200, 250, 300, 350, 400, 450] as const
export const ENDS = [550, 600, 650, 700, 750, 800, 850, 900, 950, 1000] as const
/** 25 is left out: 0–1000 every 25 is 41 swatches, too narrow to tell apart. */
export const EVERY = [50, 100, 250] as const

export interface Step {
  step: number
  rgb: Rgb
  hex: string
  /** True for 500, which is the reference exactly. */
  reference: boolean
}

/** Why `spec` is not a set of steps a scale can have, or undefined when it is. */
export function stepsProblem({ start, end, every }: StepSpec): string | undefined {
  if (!(STARTS as readonly number[]).includes(start)) {
    return start % 50 === 0
      ? `The start must be from 0 to 450, so the colour (500) stays in the scale; got ${start}.`
      : `The start must be a multiple of 50; got ${start}.`
  }
  if (!(ENDS as readonly number[]).includes(end)) {
    return end % 50 === 0
      ? `The end must be from 550 to 1000, so the colour (500) stays in the scale; got ${end}.`
      : `The end must be a multiple of 50; got ${end}.`
  }
  if (!(EVERY as readonly number[]).includes(every)) {
    return `Every must be 50, 100 or 250; got ${every}.`
  }
  return undefined
}

/** The start, the end, and every multiple of `every` between them; 500 is always one. */
export function stepsOf({ start, end, every }: StepSpec): number[] {
  const out = new Set<number>([start, end, 500])
  for (let s = Math.ceil((start + 1) / every) * every; s < end; s += every) out.add(s)
  return [...out].sort((a, b) => a - b)
}

/** The default steps: 50, 100, 200 … 900, 950. */
export const STEPS = stepsOf(DEFAULT_STEPS)

/** How far a lighter step has gone from the reference towards the top, 0 to 1. */
const UP: [number, number][] = [
  [50, 1.0],
  [100, 0.86],
  [200, 0.68],
  [300, 0.46],
  [400, 0.22],
  [500, 0],
]
/** How far a darker step has gone from the reference towards the floor, 0 to 1. */
const DOWN: [number, number][] = [
  [500, 0],
  [600, 0.2],
  [700, 0.4],
  [800, 0.6],
  [900, 0.8],
  [950, 1.0],
]

function along(knots: [number, number][], s: number): number {
  for (let i = 1; i < knots.length; i++) {
    const [a, fa] = knots[i - 1] as [number, number]
    const [b, fb] = knots[i] as [number, number]
    if (s <= b) return fa + ((fb - fa) * (s - a)) / (b - a)
  }
  return (knots[knots.length - 1] as [number, number])[1]
}

/** Lightness at the ruler's white end, for a reference not already lighter. */
const WHITE_END = 0.995
/** How much of the floor's lightness 1000 gives up, below 950. */
const PAST_FLOOR = 0.35

export function scale(ref: Rgb, spec: StepSpec = DEFAULT_STEPS): Step[] {
  const problem = stepsProblem(spec)
  if (problem) throw invalidArguments(problem, 'Try: start 50, end 950, every 100.')
  const { L: L0, C: C0, h } = toLch(rgbToOklab(ref))
  const grey = C0 < 0.015
  // A reference lighter than the ladder's top, or darker than its floor,
  // keeps those steps level with itself rather than reversing them.
  const top = Math.max(0.975, L0)
  // Below L 0.16 the usual floor would sit above the reference; there the
  // darker steps keep going down towards black instead.
  const floor = L0 < 0.16 ? 0.42 * L0 : Math.max(0.16, 0.42 * L0)
  return stepsOf(spec).map((step) => {
    if (step === 500) return { step, rgb: { ...ref }, hex: toHex(ref), reference: true }
    let L: number
    let C: number
    if (step >= 50 && step < 500) {
      const f = along(UP, step)
      L = L0 + (top - L0) * f
      C = C0 * (1 - 0.88 * f)
    } else if (step < 50) {
      // Past 50, on towards white, the last of the chroma going with it.
      const t = (50 - step) / 50
      L = top + (Math.max(WHITE_END, top) - top) * t
      C = C0 * 0.12 * (1 - t)
    } else if (step <= 950) {
      const g = along(DOWN, step)
      L = L0 - (L0 - floor) * g
      C = C0 * (1 - 0.45 * g)
    } else {
      // Past 950, on below the floor.
      const t = (step - 950) / 50
      L = floor * (1 - PAST_FLOOR * t)
      C = C0 * 0.55 * (1 - 0.4 * t)
    }
    if (grey) C = 0
    while (C > 0 && !inGamut(fromLch({ L, C, h }))) C -= 0.002
    const rgb = oklabToRgb(fromLch({ L, C: Math.max(0, C), h }))
    return { step, rgb, hex: toHex(rgb), reference: false }
  })
}
