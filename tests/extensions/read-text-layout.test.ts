import { describe, expect, it } from 'vitest'
import { blocksOf, type OcrLine } from '../../extensions/read-text/layout.js'
import { ctcDecode, regions, straightened } from '../../extensions/read-text/runner.js'

const PAGE = { width: 1000, height: 1400 }
const line = (text: string, x: number, y: number, w: number, h = 30): OcrLine => ({
  text,
  box: [x, y, w, h],
})

describe('read-text layout (PP-OCR lines into paragraphs, lists and tables)', () => {
  it('joins lines into a paragraph, mending a word broken by a hyphen', () => {
    const blocks = blocksOf(
      [
        line('Response rates were higher than vis-', 100, 100, 700),
        line('ited every household twice.', 100, 140, 500),
      ],
      PAGE,
    )
    expect(blocks).toHaveLength(1)
    expect(blocks[0]).toMatchObject({
      kind: 'text',
      text: 'Response rates were higher than visited every household twice.',
      lines: 2,
    })
  })

  it('sets a short, taller line apart as its own block, and the largest at the top as the title', () => {
    const blocks = blocksOf(
      [
        line('Quarterly Field Report', 100, 40, 500, 50),
        line('Body text that runs across the page, one line.', 100, 120, 700),
        line('More body text under it, also a full line.', 100, 160, 700),
        line('Key findings', 100, 210, 200, 38),
      ],
      PAGE,
    )
    expect(blocks.map((b) => b.kind === 'text' && b.text)).toEqual([
      'Quarterly Field Report',
      'Body text that runs across the page, one line. More body text under it, also a full line.',
      'Key findings',
    ])
    expect(blocks[0]).toMatchObject({ title: true })
  })

  it('reads bullets as a list, a full stop between bullets too', () => {
    const blocks = blocksOf(
      [
        line('• Water access improved', 120, 100, 500),
        line('. Two clinics closed', 120, 140, 500),
        line('• Travel time fell', 120, 180, 500),
      ],
      PAGE,
    )
    expect(blocks).toEqual([
      expect.objectContaining({
        kind: 'list',
        items: [
          { marker: 'bullet', text: 'Water access improved' },
          { marker: 'bullet', text: 'Two clinics closed' },
          { marker: 'bullet', text: 'Travel time fell' },
        ],
      }),
    ])
  })

  it('takes a numbered line for a list item only when the count runs on', () => {
    const counted = blocksOf(
      [line('1. First', 100, 100, 300), line('2. Second', 100, 140, 300)],
      PAGE,
    )
    expect(counted[0]).toMatchObject({
      kind: 'list',
      items: [
        { marker: 'decimal', text: 'First' },
        { marker: 'decimal', text: 'Second' },
      ],
    })
    const prose = blocksOf(
      [
        line('Column text sentence number', 100, 100, 600),
        line('15. Column text sentence', 100, 140, 600),
      ],
      PAGE,
    )
    expect(prose[0]).toMatchObject({
      kind: 'text',
      text: 'Column text sentence number 15. Column text sentence',
    })
  })

  it('reads aligned rows of short cells as a table, and two columns of prose as prose', () => {
    const rows = ['Region Households Rate', 'North 1,240 90%', 'South 980 72%', 'East 1,505 79%']
    const table = blocksOf(
      rows.flatMap((r, i) =>
        r.split(' ').map((cell, c) => line(cell, 100 + c * 300, 100 + i * 50, 150)),
      ),
      PAGE,
    )
    expect(table).toEqual([
      expect.objectContaining({ kind: 'table', rows: rows.map((r) => r.split(' ')) }),
    ])
    const columns = blocksOf(
      [0, 1, 2, 3].flatMap((i) => [
        line(`Column text sentence number ${i} runs on`, 50, 100 + i * 40, 420),
        line(`Column text sentence number ${i + 50} runs on`, 530, 100 + i * 40, 420),
      ]),
      PAGE,
    )
    expect(columns.every((b) => b.kind === 'text')).toBe(true)
    expect(columns).toHaveLength(2)
  })

  it('normalises boxes to the page', () => {
    expect(blocksOf([line('Alone', 100, 140, 500)], PAGE)[0]?.box).toEqual([
      0.1,
      0.1,
      0.5,
      30 / 1400,
    ])
  })
})

describe('read-text runner pieces', () => {
  it('finds a slanted line as one region, measured along its slant', () => {
    const w = 200
    const h = 100
    const prob = new Float32Array(w * h)
    // A bar 150 long, 6 high, tilted by 0.05 rad.
    for (let u = 0; u < 150; u++)
      for (let v = 0; v < 6; v++) {
        const x = Math.round(20 + u * Math.cos(0.05) - v * Math.sin(0.05))
        const y = Math.round(40 + u * Math.sin(0.05) + v * Math.cos(0.05))
        prob[y * w + x] = 0.9
      }
    const found = regions(prob, w, h)
    expect(found).toHaveLength(1)
    expect(found[0]?.angle).toBeCloseTo(0.05, 1)
    expect(found[0]?.w).toBeGreaterThan(150)
  })

  it('decodes CTC greedily: repeats once, blanks dropped', () => {
    const chars = ['', 'a', 'b', ' ']
    // a a _ b b
    const probs = new Float32Array([0, 1, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0])
    expect(ctcDecode(probs, 5, 4, chars)).toEqual({ text: 'ab', score: 1 })
  })

  it('straightens a tilted page, so a row is level again', () => {
    const tilt = 0.05
    const lines = [0, 1].map((k) => ({
      text: 'cell',
      score: 1,
      angle: tilt,
      box: [100 + k * 400, 500 + k * 400 * Math.tan(tilt), 300, 20] as [
        number,
        number,
        number,
        number,
      ],
    }))
    const level = straightened(lines, 1000, 1000)
    expect(Math.abs((level[0]?.box[1] ?? 0) - (level[1]?.box[1] ?? 0))).toBeLessThan(3)
  })
})
