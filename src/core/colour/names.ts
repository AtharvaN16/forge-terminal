import { type Rgb, rgbToOklab, toLch } from './space.js'

/**
 * A colour family, for the Figma card's title and its layer ids (`blue-500`).
 * A fixed table of OKLCH hue ranges, measured on the sRGB primaries and
 * secondaries (red 29°, orange 53°, yellow 110°, green 142°, cyan 195°, blue
 * 264°). A label, not a naming service.
 */
const FAMILIES: [number, string][] = [
  [15, 'rose'],
  [45, 'red'],
  [70, 'orange'],
  [95, 'amber'],
  [120, 'yellow'],
  [140, 'lime'],
  [165, 'green'],
  [185, 'teal'],
  [215, 'cyan'],
  [250, 'sky'],
  [280, 'blue'],
  [295, 'indigo'],
  [315, 'violet'],
  [340, 'purple'],
  [355, 'pink'],
  [360, 'rose'],
]

export function hueName(c: Rgb): string {
  const { C, h } = toLch(rgbToOklab(c))
  if (C < 0.03) return 'grey'
  return (FAMILIES.find(([upTo]) => h < upTo) ?? [360, 'rose'])[1]
}
