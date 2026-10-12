import chalk from 'chalk'
import stringWidth from 'string-width'
import stripAnsi from 'strip-ansi'
import { afterEach, describe, expect, it } from 'vitest'
import type { PixelGrid } from '../../src/core/closeup.js'
import { sextantCell, sextants } from '../../src/shell/sextants.js'

type RGB = [number, number, number]
const W: RGB = [250, 250, 250]
const K: RGB = [10, 10, 10]

/** A cell's six dots, row by row: top-left, top-right, middle-left, … */
const cell = (...dots: RGB[]) => dots

describe('sextantCell', () => {
  it('draws one colour as a space on that background', () => {
    expect(sextantCell(cell(W, W, W, W, W, W))).toEqual({ ch: ' ', fg: W, bg: W })
  })

  it('splits the dots between the two colours that fit them best', () => {
    // Right column white: the right half block, white on black.
    expect(sextantCell(cell(K, W, K, W, K, W))).toEqual({ ch: '▐', fg: W, bg: K })
    // Top-left alone: sextant-1, the first of the block.
    expect(sextantCell(cell(W, K, K, K, K, K))).toEqual({ ch: '\u{1FB00}', fg: W, bg: K })
    // The top row: sextant-12.
    expect(sextantCell(cell(W, W, K, K, K, K))).toEqual({ ch: '\u{1FB02}', fg: W, bg: K })
    // All but the bottom-right: sextant-12345, past the skipped ▌.
    expect(sextantCell(cell(W, W, W, W, W, K))).toEqual({ ch: '\u{1FB1D}', fg: W, bg: K })
    // All but the top-left: sextant-23456, the last of the block, past ▐ too.
    expect(sextantCell(cell(K, W, W, W, W, W))).toEqual({ ch: '\u{1FB3B}', fg: W, bg: K })
  })

  it('gives a colour the mean of the dots it stands for', () => {
    const { fg, bg } = sextantCell(cell([200, 0, 0], [220, 0, 0], K, K, K, K))
    expect(fg).toEqual([210, 0, 0])
    expect(bg).toEqual(K)
  })
})

const level = chalk.level
afterEach(() => {
  chalk.level = level
})

describe('sextants', () => {
  it('draws a grid as rows of cells, two dots across and three down each', () => {
    chalk.level = 3
    const g: PixelGrid = { width: 8, height: 6, rgba: new Uint8Array(8 * 6 * 4) }
    for (let i = 0; i < 8 * 6; i++) g.rgba.set([...(i % 8 < 3 ? K : W), 255], i * 4)
    const rows = sextants(g)
    expect(rows).toHaveLength(2)
    expect(rows.every((r) => stringWidth(stripAnsi(r)) === 4)).toBe(true)
    // Dots 0–2 black: cell 0 all black, cell 1 black then white (▐), the rest white.
    expect(stripAnsi(rows[0] ?? '')).toBe(' ▐  ')
    // True colour, through chalk: the black as a background.
    expect(rows[0]).toContain('\u001b[48;2;10;10;10m')
  })
})
