import { type GroupOptions, group } from './group.js'
import { type Lab, type Rgb, rgbToOklab, toHex } from './space.js'

/** Decoded pixels, RGBA, row by row. Made by `engines/pixels.ts`. */
export interface Pixels {
  width: number
  height: number
  rgba: Uint8Array
}

export interface Group {
  /** The real pixel nearest the group's centre (colour spec §2.2): never an average. */
  rgb: Rgb
  hex: string
  /** Of the opaque pixels (palette) or of the parent's pixels (inside). */
  share: number
  centre: Lab
  /** Pixel indices (into width × height), ascending. */
  members: Uint32Array
}

export const PALETTE: GroupOptions = { k: 8, merge: 0.06, minShare: 0.015 }
export const INSIDE: GroupOptions = { k: 4, merge: 0.03, minShare: 0.02 }
export const TRANSPARENT = -1
export const OUTSIDE = -2
const OPAQUE = 128
const MIN_TO_OPEN = 64

const rgbAt = (px: Pixels, i: number): Rgb => ({
  r: px.rgba[i * 4] as number,
  g: px.rgba[i * 4 + 1] as number,
  b: px.rgba[i * 4 + 2] as number,
})

function groupIndices(px: Pixels, indices: number[], opts: GroupOptions): Group[] {
  const n = indices.length
  const L = new Float64Array(n)
  const A = new Float64Array(n)
  const B = new Float64Array(n)
  indices.forEach((p, j) => {
    const lab = rgbToOklab(rgbAt(px, p))
    L[j] = lab.L
    A[j] = lab.a
    B[j] = lab.b
  })
  return group(L, A, B, opts)
    .map((g) => {
      let best = g.members[0] as number
      let bestD = Number.POSITIVE_INFINITY
      for (const j of g.members) {
        const d =
          ((L[j] as number) - g.centre[0]) ** 2 +
          ((A[j] as number) - g.centre[1]) ** 2 +
          ((B[j] as number) - g.centre[2]) ** 2
        if (d < bestD) {
          bestD = d
          best = j
        }
      }
      const rgb = rgbAt(px, indices[best] as number)
      return {
        rgb,
        hex: toHex(rgb),
        share: g.members.length / n,
        centre: { L: g.centre[0], a: g.centre[1], b: g.centre[2] },
        members: Uint32Array.from(g.members.map((j) => indices[j] as number)).sort(),
      }
    })
    .sort((x, y) => y.share - x.share || (x.hex < y.hex ? -1 : 1))
}

/** The image's main colours, most of the image first. `[]` when nothing is opaque. */
export function palette(px: Pixels): Group[] {
  const opaque: number[] = []
  for (let i = 0; i < px.width * px.height; i++) {
    if ((px.rgba[i * 4 + 3] as number) >= OPAQUE) opaque.push(i)
  }
  return groupIndices(px, opaque, PALETTE)
}

/** The shades a group is made of; shares are of the group. */
export function inside(px: Pixels, parent: Group): Group[] {
  return groupIndices(px, [...parent.members], INSIDE)
}

/** Whether → can open this group: enough pixels, and more than one shade inside. */
export function canOpen(px: Pixels, g: Group): boolean {
  return g.members.length >= MIN_TO_OPEN && inside(px, g).length > 1
}

/** Whole percentages adding up to the rounded total, by largest remainder. */
export function wholePercents(shares: number[]): number[] {
  const raw = shares.map((s) => s * 100)
  const out = raw.map(Math.floor)
  let left = Math.round(raw.reduce((a, b) => a + b, 0)) - out.reduce((a, b) => a + b, 0)
  raw
    .map((r, i) => [r - Math.floor(r), i] as const)
    .sort((a, b) => b[0] - a[0] || a[1] - b[1])
    .forEach(([, i]) => {
      if (left-- > 0) out[i] = (out[i] as number) + 1
    })
  return out
}

/**
 * The image as a grid at most `max` a side (aspect kept): each cell is the
 * index of the group owning the pixel at its centre, `TRANSPARENT`, or
 * `OUTSIDE` (opaque but in none of `groups`, as when they are one colour's shades).
 */
export function photoMap(px: Pixels, groups: Group[], max = 24): number[][] {
  const owner = new Int32Array(px.width * px.height).fill(OUTSIDE)
  groups.forEach((g, gi) => {
    for (const i of g.members) owner[i] = gi
  })
  const wide = px.width >= px.height
  const cols = wide ? max : Math.max(1, Math.round((max * px.width) / px.height))
  const rows = wide ? Math.max(1, Math.round((max * px.height) / px.width)) : max
  return Array.from({ length: rows }, (_, y) =>
    Array.from({ length: cols }, (_, x) => {
      const sx = Math.min(px.width - 1, Math.floor(((x + 0.5) * px.width) / cols))
      const sy = Math.min(px.height - 1, Math.floor(((y + 0.5) * px.height) / rows))
      const i = sy * px.width + sx
      return (px.rgba[i * 4 + 3] as number) < OPAQUE ? TRANSPARENT : (owner[i] as number)
    }),
  )
}
