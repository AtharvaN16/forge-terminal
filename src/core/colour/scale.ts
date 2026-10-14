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
 * white, to 1000, near black, with the colour always at 500. A place between
 * two of the ladder's is interpolated, so the default eleven keep their
 * exact hex.
 */

/** Tailwind's 50 … 950; an even count named by place; or Radix's twelve. */
export type StepSet = 'tailwind' | 'even' | 'radix'

export interface StepSpec {
  set: StepSet
  /** The lightest place: 0 to 450, in 50s. Not Radix's. */
  start: number
  /** The darkest place: 550 to 1000, in 50s. Not Radix's. */
  end: number
  /** How many steps an even set has: 3 to 21. */
  count: number
}

export const DEFAULT_STEPS: StepSpec = { set: 'tailwind', start: 50, end: 950, count: 11 }
export const SETS: readonly StepSet[] = ['tailwind', 'even', 'radix']
export const STARTS = [0, 50, 100, 150, 200, 250, 300, 350, 400, 450] as const
export const ENDS = [550, 600, 650, 700, 750, 800, 850, 900, 950, 1000] as const
/** 3 to 21: at 21 the ramp's cells are three columns wide at 80 columns. */
export const COUNTS = Array.from({ length: 19 }, (_, i) => i + 3)

/**
 * Radix's twelve, by what each is for: app backgrounds 1–2, component
 * backgrounds 3–5, borders 6–8, the solid colour 9, its hover 10, text 11–12.
 */
const RADIX = [20, 50, 100, 150, 200, 260, 330, 420, 500, 560, 750, 920]
/** Where Radix puts the solid colour: the 9th of 12. */
const RADIX_REFERENCE = 8

export interface Step {
  /** Its name: the place on the ruler (Tailwind, even), or 1–12 (Radix). */
  step: number
  /** Its place on the ruler, 0 to 1000; 500 is the reference. */
  at: number
  rgb: Rgb
  hex: string
  /** True for the reference, which is the colour exactly. */
  reference: boolean
}

/** Why `spec` is not a set of steps a scale can have, or undefined when it is. */
export function stepsProblem({ set, start, end, count }: StepSpec): string | undefined {
  if (!SETS.includes(set)) return `The set must be tailwind, even or radix; got ${set}.`
  if (set === 'radix') return undefined
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
  if (set === 'even' && !COUNTS.includes(count)) {
    return `An even set has 3 to 21 steps; got ${count}.`
  }
  return undefined
}

/**
 * The places a set of steps sits at, each with its name. An even count is
 * split between the places lighter than the colour and those darker, in
 * proportion to how much of the range each side has, so 500 is always one;
 * each is named by its place to the 10, or to the 5 or the 1 where two
 * would share a name.
 */
export function placesOf(spec: StepSpec): { step: number; at: number }[] {
  const { set, start, end, count } = spec
  if (set === 'radix') return RADIX.map((at, i) => ({ step: i + 1, at }))
  if (set === 'tailwind') {
    const at = new Set<number>([start, end, 500])
    for (let s = Math.ceil((start + 1) / 100) * 100; s < end; s += 100) at.add(s)
    return [...at].sort((a, b) => a - b).map((p) => ({ step: p, at: p }))
  }
  const gaps = count - 1
  const share = Math.round((gaps * (500 - start)) / (end - start))
  const light = Math.max(1, Math.min(gaps - 1, share))
  const dark = gaps - light
  const at: number[] = []
  for (let i = 0; i <= light; i++) at.push(start + ((500 - start) * i) / light)
  for (let j = 1; j <= dark; j++) at.push(500 + ((end - 500) * j) / dark)
  for (const to of [10, 5, 1]) {
    const names = at.map((p) => Math.round(p / to) * to)
    if (new Set(names).size === names.length)
      return at.map((p, i) => ({ step: names[i] as number, at: p }))
  }
  return at.map((p) => ({ step: p, at: p }))
}

/** The names of a set's steps, lightest first. */
export function stepsOf(spec: StepSpec): number[] {
  return placesOf(spec).map((p) => p.step)
}

/** The default steps: 50, 100, 200 … 900, 950. */
export const STEPS = stepsOf(DEFAULT_STEPS)

/** Where the colour itself sits among a set's steps. */
export function referenceIndex(spec: StepSpec): number {
  return spec.set === 'radix' ? RADIX_REFERENCE : placesOf(spec).findIndex((p) => p.at === 500)
}

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
/**
 * Below this chroma a colour is grey and its hue is rounding noise from
 * atan2. Only that is flattened: zinc and stone (C ≈ 0.012) keep their tint
 * on every step, and since no step has more chroma than the reference, a
 * nearly grey colour still gives a nearly grey scale.
 */
const GREY = 0.0005

export function scale(ref: Rgb, spec: StepSpec = DEFAULT_STEPS): Step[] {
  const problem = stepsProblem(spec)
  if (problem) throw invalidArguments(problem, 'Try: Tailwind, from 50 to 950.')
  const { L: L0, C: C0, h } = toLch(rgbToOklab(ref))
  const grey = C0 < GREY
  // A reference lighter than the ladder's top, or darker than its floor,
  // keeps those steps level with itself rather than reversing them.
  const top = Math.max(0.975, L0)
  // Below L 0.16 the usual floor would sit above the reference; there the
  // darker steps keep going down towards black instead.
  const floor = L0 < 0.16 ? 0.42 * L0 : Math.max(0.16, 0.42 * L0)
  return placesOf(spec).map(({ step, at: place }) => {
    if (place === 500) return { step, at: place, rgb: { ...ref }, hex: toHex(ref), reference: true }
    let L: number
    let C: number
    if (place >= 50 && place < 500) {
      const f = along(UP, place)
      L = L0 + (top - L0) * f
      C = C0 * (1 - 0.88 * f)
    } else if (place < 50) {
      // Past 50, on towards white, the last of the chroma going with it.
      const t = (50 - place) / 50
      L = top + (Math.max(WHITE_END, top) - top) * t
      C = C0 * 0.12 * (1 - t)
    } else if (place <= 950) {
      const g = along(DOWN, place)
      L = L0 - (L0 - floor) * g
      C = C0 * (1 - 0.45 * g)
    } else {
      // Past 950, on below the floor.
      const t = (place - 950) / 50
      L = floor * (1 - PAST_FLOOR * t)
      C = C0 * 0.55 * (1 - 0.4 * t)
    }
    if (grey) C = 0
    while (C > 0 && !inGamut(fromLch({ L, C, h }))) C -= 0.002
    const rgb = oklabToRgb(fromLch({ L, C: Math.max(0, C), h }))
    return { step, at: place, rgb, hex: toHex(rgb), reference: false }
  })
}
