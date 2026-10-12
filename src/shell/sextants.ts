import chalk from 'chalk'
import type { PixelGrid } from '../core/closeup.js'

/**
 * Pictures in characters, for a terminal that cannot draw images (Apple
 * Terminal): each cell a sextant — Unicode 13's 2 × 3 blocks, U+1FB00 on —
 * so a cell holds six dots where a half-block held two. A cell still has
 * only two colours, its text and its background, so the six dots are split
 * between the two colours that fit them best: edges (letters, a cutout's
 * outline) come out much sharper, a smooth gradient a little grainier.
 * Measured on enhance's Done against half-blocks and quadrants before it was
 * chosen (2026-10-12).
 */

type RGB = [number, number, number]

export interface SextantCell {
  ch: string
  fg: RGB
  bg: RGB
}

const lum = (p: RGB) => 0.2126 * p[0] + 0.7152 * p[1] + 0.0722 * p[2]
const far = (p: RGB, q: RGB) => (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2 + (p[2] - q[2]) ** 2
const same = (p: RGB, q: RGB) => p[0] === q[0] && p[1] === q[1] && p[2] === q[2]
const mean = (ps: RGB[]): RGB => {
  const at = (c: 0 | 1 | 2) => Math.round(ps.reduce((s, p) => s + p[c], 0) / ps.length)
  return [at(0), at(1), at(2)]
}

/**
 * The character for the dots set in `mask` (bit 0 top-left, 1 top-right, 2
 * middle-left, … 5 bottom-right). The block skips the two that already
 * exist as half blocks, ▌ and ▐.
 */
function sextant(mask: number): string {
  if (mask === 0) return ' '
  if (mask === 63) return '█'
  if (mask === 21) return '▌'
  if (mask === 42) return '▐'
  return String.fromCodePoint(0x1fb00 + mask - 1 - (mask > 21 ? 1 : 0) - (mask > 42 ? 1 : 0))
}

/**
 * One cell from its six dots, row by row: the two colours that stand for
 * them best (two-means, from the darkest and the lightest), the lighter as
 * the text. One colour throughout is a space on it — no glyph, so no seam.
 */
export function sextantCell(dots: RGB[]): SextantCell {
  const sorted = [...dots].sort((a, b) => lum(a) - lum(b))
  let bg = sorted[0] ?? [0, 0, 0]
  let fg = sorted[sorted.length - 1] ?? bg
  let mask = 0
  for (let pass = 0; pass < 4 && !same(fg, bg); pass++) {
    mask = 0
    dots.forEach((p, i) => {
      if (far(p, fg) < far(p, bg)) mask |= 1 << i
    })
    const on = dots.filter((_, i) => mask & (1 << i))
    const off = dots.filter((_, i) => !(mask & (1 << i)))
    if (on.length === 0 || off.length === 0) break
    fg = mean(on)
    bg = mean(off)
  }
  if (same(fg, bg) || mask === 0 || mask === 63) {
    const all = mean(dots)
    return { ch: ' ', fg: all, bg: all }
  }
  return { ch: sextant(mask), fg, bg }
}

/**
 * A grid (width a multiple of 2, height of 3) as rows of sextants, a run of
 * cells in the same two colours styled once. Styled through chalk, the same
 * chalk Ink draws with, so its colour level holds: FORCE_COLOR, NO_COLOR
 * (mapped to it at start-up), and 256 or 16 colours where the terminal has no
 * true colour. One string per row — a few hundred <Text> elements per
 * picture would cost more than they say.
 */
export function sextants(g: PixelGrid): string[] {
  const at = (x: number, y: number): RGB => {
    const i = (y * g.width + x) * 4
    return [g.rgba[i] ?? 0, g.rgba[i + 1] ?? 0, g.rgba[i + 2] ?? 0]
  }
  const out: string[] = []
  for (let y = 0; y + 2 < g.height; y += 3) {
    let row = ''
    let run: SextantCell | undefined
    let text = ''
    const flush = () => {
      if (run) row += chalk.rgb(...run.fg).bgRgb(...run.bg)(text)
    }
    for (let x = 0; x + 1 < g.width; x += 2) {
      const c = sextantCell([
        at(x, y),
        at(x + 1, y),
        at(x, y + 1),
        at(x + 1, y + 1),
        at(x, y + 2),
        at(x + 1, y + 2),
      ])
      if (run && same(run.fg, c.fg) && same(run.bg, c.bg)) {
        text += c.ch
        continue
      }
      flush()
      run = c
      text = c.ch
    }
    flush()
    out.push(row)
  }
  return out
}
