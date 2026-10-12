import type { Rgb } from './space.js'

const lin = (v: number): number => {
  const c = v / 255
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}
const luminance = ({ r, g, b }: Rgb): number => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)

/** The WCAG 2 contrast ratio, 1 to 21, in either order. */
export function contrast(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number]
  return (hi + 0.05) / (lo + 0.05)
}

export type Rating = 'AAA' | 'AA' | 'large' | 'fails'

export function rate(ratio: number): Rating {
  return ratio >= 7 ? 'AAA' : ratio >= 4.5 ? 'AA' : ratio >= 3 ? 'large' : 'fails'
}

const WHITE: Rgb = { r: 255, g: 255, b: 255 }
const BLACK: Rgb = { r: 0, g: 0, b: 0 }
/**
 * Down to one decimal, never to nearest: 4.48:1 fails AA, and rounding it to
 * 4.5 would rate it a pass. The WCAG thresholds (3, 4.5, 7) all have one
 * decimal, so rating the value rounded down gives exactly the real grade.
 */
const one = (n: number): number => Math.floor(n * 10) / 10

/** How white text and black text read on this colour, to one decimal, rounded down. */
export function onWhiteAndBlack(c: Rgb): { white: number; black: number } {
  return { white: one(contrast(c, WHITE)), black: one(contrast(c, BLACK)) }
}
