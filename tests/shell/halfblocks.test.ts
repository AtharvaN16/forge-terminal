import chalk from 'chalk'
import stringWidth from 'string-width'
import stripAnsi from 'strip-ansi'
import { afterEach, describe, expect, it } from 'vitest'
import type { PixelGrid } from '../../src/core/closeup.js'
import { halfBlockCell, halfBlocks } from '../../src/shell/halfblocks.js'

type RGB = [number, number, number]
const W: RGB = [250, 250, 250]
const K: RGB = [10, 10, 10]

describe('halfBlockCell', () => {
  it('draws one colour as a space on that background', () => {
    expect(halfBlockCell(W, W)).toEqual({ ch: ' ', fg: W, bg: W })
  })

  it('draws two as the upper half block: top in the text, bottom behind it', () => {
    expect(halfBlockCell(W, K)).toEqual({ ch: '▀', fg: W, bg: K })
    expect(halfBlockCell(K, W)).toEqual({ ch: '▀', fg: K, bg: W })
  })
})

const level = chalk.level
afterEach(() => {
  chalk.level = level
})

describe('halfBlocks', () => {
  it('draws a grid as rows of cells, one pixel across and two down each', () => {
    chalk.level = 3
    // 4 × 4: the top row and the left column black, the rest white.
    const g: PixelGrid = { width: 4, height: 4, rgba: new Uint8Array(4 * 4 * 4) }
    for (let i = 0; i < 16; i++) {
      const black = i < 4 || i % 4 === 0
      g.rgba.set([...(black ? K : W), 255], i * 4)
    }
    const rows = halfBlocks(g)
    expect(rows).toHaveLength(2)
    expect(rows.every((r) => stringWidth(stripAnsi(r)) === 4)).toBe(true)
    // Top cells: black over black (a space), then black over white (▀).
    expect(stripAnsi(rows[0] ?? '')).toBe(' ▀▀▀')
    expect(stripAnsi(rows[1] ?? '')).toBe('    ')
    // True colour, through chalk: the black as a background.
    expect(rows[0]).toContain('\u001b[48;2;10;10;10m')
  })
})
