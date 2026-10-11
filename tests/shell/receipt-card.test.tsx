import { render } from 'ink-testing-library'
import stringWidth from 'string-width'
import { describe, expect, it } from 'vitest'
import type { Result } from '../../src/core/types.js'
import { HistoryEntry } from '../../src/shell/blocks.js'
import {
  RECEIPT_MAX,
  ReceiptCard,
  receiptBars,
  wrapWords,
} from '../../src/shell/components/ReceiptCard.js'
import { ThemeProvider } from '../../src/shell/ThemeContext.js'
import { DARK } from '../../src/shell/theme.js'
import { receiptResult as result } from './receipt-fixtures.js'

const frame = (r: Result, width: number) =>
  render(
    <ThemeProvider palette={DARK}>
      <ReceiptCard result={r} width={width} />
    </ThemeProvider>,
  ).lastFrame() ?? ''
const entry = (r: Result, width: number) =>
  render(
    <ThemeProvider palette={DARK}>
      <HistoryEntry block={{ kind: 'result', id: 'r', result: r }} width={width} />
    </ThemeProvider>,
  ).lastFrame() ?? ''
const lines = (f: string) => f.split('\n').filter((l) => l.length > 0)

describe('receiptBars', () => {
  it('gives the larger side every cell and scales the other', () => {
    expect(receiptBars(122_449, 76_390, 24)).toEqual({ before: 24, after: 15, grew: false })
    expect(receiptBars(100, 400, 24)).toEqual({ before: 6, after: 24, grew: true })
    expect(receiptBars(500, 500, 24)).toEqual({ before: 24, after: 24, grew: false })
  })
  it('never draws an empty bar for a non-zero size', () => {
    expect(receiptBars(10_000_000, 1, 24).after).toBe(1)
  })
  it('survives zero bytes on either side', () => {
    expect(receiptBars(0, 0, 24)).toEqual({ before: 24, after: 24, grew: false })
    expect(receiptBars(100, 0, 24)).toEqual({ before: 24, after: 0, grew: false })
  })
})

describe('wrapWords', () => {
  it('wraps on spaces and never exceeds the width', () => {
    expect(wrapWords('one two three four five six seven', 10)).toEqual([
      'one two',
      'three four',
      'five six',
      'seven',
    ])
  })
  it('hard-breaks a word longer than the width', () => {
    expect(wrapWords('abcdefghijkl', 5)).toEqual(['abcde', 'fghij', 'kl'])
  })
})

describe('the receipt card', () => {
  it('is titled DONE and carries both names, both sizes and the saving', () => {
    const f = frame(result(), 100)
    expect(f).toContain('╭─ ✓ DONE')
    expect(f).toContain('test.png  ──→  test.jpg')
    expect(f).toContain('before')
    expect(f).toContain('122 KB')
    expect(f).toContain('76.4 KB')
    expect(f).toContain('37.6% smaller')
    expect(f).toContain('saved to ~/Desktop/test.jpg')
  })

  it('draws every line at exactly the card width', () => {
    for (const w of [60, 72, 80, 100, 160]) {
      const expected = Math.min(w, RECEIPT_MAX)
      for (const line of lines(frame(result(), w))) expect(stringWidth(line)).toBe(expected)
    }
  })

  it('ellipses two very long names and still keeps its width', () => {
    const long = 'Screenshot 2026-08-17 at 3.52.36 PM with an absurdly long suffix'
    const f = frame(result({ source: { path: `/tmp/${long}.png` }, out: `/tmp/${long}.jpg` }), 80)
    expect(f).toContain('…')
    for (const line of lines(f)) expect(stringWidth(line)).toBe(RECEIPT_MAX)
  })

  it('puts names that will not share a line on two lines, in full', () => {
    // Truncation is the last resort, as it was for the stacked layout this
    // card replaced: a real screenshot name fits the card on its own line.
    const name = 'Screenshot 2026-08-17 at 3.52.36 PM'
    const f = frame(result({ source: { path: `/tmp/${name}.png` }, out: `/tmp/${name}.jpg` }), 92)
    expect(f).toContain(`${name}.png`)
    expect(f).toContain(`──→ ${name}.jpg`)
    expect(f).not.toContain('…')
    for (const line of lines(f)) expect(stringWidth(line)).toBe(RECEIPT_MAX)
  })

  it('wraps a long warning inside the card', () => {
    const msg =
      'Animation was flattened to its first frame because JPEG cannot store more than one frame'
    const f = frame(result({ warnings: [msg] }), 72)
    expect(f).toContain('⚠ Animation was flattened')
    expect(f).toContain('one frame')
    for (const line of lines(f)) expect(stringWidth(line)).toBe(RECEIPT_MAX)
  })

  it('says larger when the result grew', () => {
    expect(frame(result({ bytes: 400_000 }), 80)).toContain('larger')
  })

  it('draws a zero-byte source without breaking', () => {
    const f = frame(result({ source: { bytes: 0 } }), 80)
    expect(f).not.toContain('NaN')
    for (const line of lines(f)) expect(stringWidth(line)).toBe(RECEIPT_MAX)
  })

  it('is what a history result block renders in the normal band', () => {
    expect(entry(result(), 80)).toContain('✓ DONE')
  })

  it('leaves the compact band on the single-line form', () => {
    const f = entry(result(), 50)
    expect(f).not.toContain('╭')
    expect(f).toContain('✓ done')
  })
})
