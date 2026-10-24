import { invalidArguments } from '../errors.js'
import {
  fromLch,
  inGamut,
  type Lab,
  oklabToRgb,
  type Rgb,
  rgbToOklab,
  toHex,
  toLch,
} from './space.js'

/**
 * Two colours mixed. OKLab draws a straight line between them, so the middle
 * of two vivid colours of opposite hue goes greyish; OKLCH keeps the chroma
 * and swings the hue round the short way, so it stays vivid.
 */
export type MixSpace = 'oklab' | 'oklch'

/** 3 to 21 steps, as a scale's even set has. */
export const MIX_COUNTS = Array.from({ length: 19 }, (_, i) => i + 3)

/** Below this chroma a colour is grey and its hue is rounding noise. */
const GREY = 0.0005

export interface MixStep {
  /** Its name: how far along it is, as a percentage. */
  step: number
  /** How far along it is, 0 to 1. */
  at: number
  rgb: Rgb
  hex: string
  /** True for the two ends, which are the colours exactly. */
  reference: boolean
}

/** Gives up chroma until `lab` fits in sRGB, as `scale()` does. */
function intoGamut(lab: Lab): Rgb {
  if (inGamut(lab)) return oklabToRgb(lab)
  const { L, h } = toLch(lab)
  let { C } = toLch(lab)
  while (C > 0 && !inGamut(fromLch({ L, C, h }))) C -= 0.002
  return oklabToRgb(fromLch({ L, C: Math.max(0, C), h }))
}

/** `t` of the way from `a` to `b`, 0 to 1. The ends come back exactly. */
export function mix(a: Rgb, b: Rgb, t: number, space: MixSpace): Rgb {
  if (t <= 0) return { ...a }
  if (t >= 1) return { ...b }
  const x = rgbToOklab(a)
  const y = rgbToOklab(b)
  if (space === 'oklab') {
    return intoGamut({
      L: x.L + (y.L - x.L) * t,
      a: x.a + (y.a - x.a) * t,
      b: x.b + (y.b - x.b) * t,
    })
  }
  const p = toLch(x)
  const q = toLch(y)
  // A grey has no hue of its own, so it borrows the other end's.
  const hp = p.C < GREY ? q.h : p.h
  const hq = q.C < GREY ? p.h : q.h
  const dh = ((hq - hp + 540) % 360) - 180
  const h = (hp + dh * t + 360) % 360
  return intoGamut(fromLch({ L: p.L + (q.L - p.L) * t, C: p.C + (q.C - p.C) * t, h }))
}

/** `count` colours evenly from `a` to `b`, both ends included. */
export function mixSteps(a: Rgb, b: Rgb, count: number, space: MixSpace): MixStep[] {
  return gradientSteps([a, b], count, space)
}

/**
 * `count` colours evenly through `stops`, in order (a gradient, 2026-10-24):
 * the stops spaced evenly along it, each stretch between two neighbours their
 * mix. A step that lands on a stop is that colour exactly, and a reference.
 */
export function gradientSteps(stops: readonly Rgb[], count: number, space: MixSpace): MixStep[] {
  if (!MIX_COUNTS.includes(count)) {
    throw invalidArguments(`A mix has 3 to 21 steps; got ${count}.`, 'Try: 9 steps.')
  }
  if (stops.length < 2) {
    throw invalidArguments('A gradient needs two colours or more.', 'Try: #6579FD → #F5A524.')
  }
  const spans = stops.length - 1
  return Array.from({ length: count }, (_, i) => {
    const at = i / (count - 1)
    const x = at * spans
    // Which stretch the step is on, and how far along it; the last step is on the last stop.
    const k = Math.min(spans - 1, Math.floor(x))
    const t = x - k
    const rgb = mix(stops[k] as Rgb, stops[k + 1] as Rgb, t, space)
    return {
      step: Math.round(at * 100),
      at,
      rgb,
      hex: toHex(rgb),
      reference: Math.abs(x - Math.round(x)) < 1e-9,
    }
  })
}
