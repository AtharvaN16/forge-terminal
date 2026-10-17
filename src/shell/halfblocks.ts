import chalk from 'chalk'
import type { PixelGrid } from '../core/closeup.js'
import { wrapWords } from './done-art.js'
import { blank, type Row } from './home-art.js'

/**
 * Pictures in characters, for a terminal that cannot draw images (Apple
 * Terminal): each cell an upper half block, `▀`, its text colour the top
 * pixel and its background the bottom one — two square pixels a cell, each
 * in its own colour.
 *
 * Chosen for working everywhere (2026-10-12). `▀` is in code page 437, so
 * every monospace font has it. Finer cells came first and failed: sextants
 * (U+1FB00) are in no macOS font, so Apple Terminal drew "?" boxes, and
 * quadrants are missing from older Windows fonts. Both also force four or
 * six dots into two colours, which made photos grainy.
 */

type RGB = [number, number, number]

/**
 * Said under every picture drawn in half blocks: a reader seeing blocks
 * should know the real file is not like that. The user's wording
 * (2026-10-12), given for edit's Done, which goes on to name the key that
 * opens the result; Extract and Crop to shape have no such key, so they say
 * this alone (2026-10-16).
 */
export const SKETCH_ONLY =
  'The image preview is for illustrative purposes only; the terminal cannot display the actual image.'

/**
 * The note under a half-block picture whose rows start `lead` cells in, in a
 * window `width` wide: a gap, then its lines in `fg`, one cell short of the
 * edge, as edit's Done wraps its own.
 */
export function sketchNoteRows(fg: string, lead: number, width: number): Row[] {
  const lines = wrapWords(SKETCH_ONLY, Math.max(1, width - lead - 1))
  // The gap is spaces, not an empty row, which some renderers give no height.
  return [[blank(lead)], ...lines.map((text): Row => [blank(lead), { text, fg }])]
}

export interface HalfBlockCell {
  ch: string
  fg: RGB
  bg: RGB
}

const same = (p: RGB, q: RGB) => p[0] === q[0] && p[1] === q[1] && p[2] === q[2]

/** One cell from its two pixels. One colour throughout is a space on it — no glyph, so no seam. */
export function halfBlockCell(top: RGB, bottom: RGB): HalfBlockCell {
  if (same(top, bottom)) return { ch: ' ', fg: top, bg: top }
  return { ch: '▀', fg: top, bg: bottom }
}

/**
 * A grid (height a multiple of 2) as rows of half blocks, a run of cells in
 * the same two colours styled once. Styled through chalk, the same chalk Ink
 * draws with, so its colour level holds: FORCE_COLOR, NO_COLOR (mapped to it
 * at start-up), and 256 or 16 colours where the terminal has no true colour.
 * One string per row — a few hundred <Text> elements per picture would cost
 * more than they say.
 */
export function halfBlocks(g: PixelGrid): string[] {
  const at = (x: number, y: number): RGB => {
    const i = (y * g.width + x) * 4
    return [g.rgba[i] ?? 0, g.rgba[i + 1] ?? 0, g.rgba[i + 2] ?? 0]
  }
  const out: string[] = []
  for (let y = 0; y + 1 < g.height; y += 2) {
    let row = ''
    let run: HalfBlockCell | undefined
    let text = ''
    const flush = () => {
      if (run) row += chalk.rgb(...run.fg).bgRgb(...run.bg)(text)
    }
    for (let x = 0; x < g.width; x++) {
      const c = halfBlockCell(at(x, y), at(x, y + 1))
      // A space shows only its background: it joins any run on that background.
      if (run && same(run.bg, c.bg) && (c.ch === ' ' || same(run.fg, c.fg))) {
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
