import { describe, expect, it } from 'vitest'
import { cutsToRanges, formatRanges, parseRanges, rangesToCuts } from '../../src/core/pages.js'

describe('parseRanges', () => {
  it('parses a single page as a 0-based index', () => {
    expect(parseRanges('3', 10)).toEqual([2])
  })

  it('parses an inclusive span', () => {
    expect(parseRanges('3-7', 10)).toEqual([2, 3, 4, 5, 6])
  })

  it('parses an open-ended span as "to the end"', () => {
    expect(parseRanges('8-', 10)).toEqual([7, 8, 9])
  })

  it('parses several comma-separated terms', () => {
    expect(parseRanges('3-5, 9, 1', 10)).toEqual([0, 2, 3, 4, 8])
  })

  it('collapses duplicates and overlaps', () => {
    expect(parseRanges('1,1,1-3,2', 10)).toEqual([0, 1, 2])
  })

  it('tolerates any amount of surrounding whitespace', () => {
    expect(parseRanges('  3 - 5 ,  9  ', 10)).toEqual([2, 3, 4, 8])
  })

  it('rejects page 0, because pages are 1-based to the user', () => {
    expect(() => parseRanges('0-3', 10)).toThrow(/1 and 10/)
  })

  it('rejects a page past the end and names the page count', () => {
    expect(() => parseRanges('11', 10)).toThrow(/1 and 10/)
  })

  it('rejects a reversed span', () => {
    expect(() => parseRanges('7-3', 10)).toThrow(/7-3/)
  })

  it('rejects non-numeric input', () => {
    expect(() => parseRanges('three', 10)).toThrow(/three/)
  })

  it('rejects empty input rather than selecting nothing silently', () => {
    expect(() => parseRanges('   ', 10)).toThrow(/no pages/)
  })
})

describe('formatRanges', () => {
  it('collapses consecutive pages into spans, 1-based', () => {
    expect(formatRanges([2, 3, 4, 5, 6, 11, 19, 20])).toBe('3-7, 12, 20-21')
  })

  it('renders a single page without a dash', () => {
    expect(formatRanges([0])).toBe('1')
  })

  it('renders an empty selection as an empty string', () => {
    expect(formatRanges([])).toBe('')
  })

  it('round-trips through parseRanges', () => {
    const pages = [0, 1, 2, 6, 9]
    expect(parseRanges(formatRanges(pages), 10)).toEqual(pages)
  })
})

describe('cuts and ranges are the same data', () => {
  it('turns cuts into the ranges they partition the document into', () => {
    // cuts after 0-based pages 0 and 3 -> [0,0], [1,3], [4,6]
    expect(cutsToRanges([0, 3], 7)).toEqual([
      { from: 0, to: 0 },
      { from: 1, to: 3 },
      { from: 4, to: 6 },
    ])
  })

  it('returns the whole document when there are no cuts', () => {
    expect(cutsToRanges([], 7)).toEqual([{ from: 0, to: 6 }])
  })

  it('turns ranges back into cuts', () => {
    expect(
      rangesToCuts([
        { from: 0, to: 0 },
        { from: 1, to: 3 },
        { from: 4, to: 6 },
      ]),
    ).toEqual([0, 3])
  })

  it('round-trips any cut set unchanged', () => {
    for (const cuts of [[], [0], [2, 5], [0, 1, 2, 3, 4, 5]]) {
      expect(rangesToCuts(cutsToRanges(cuts, 7))).toEqual(cuts)
    }
  })

  it('always partitions: every page appears exactly once', () => {
    const ranges = cutsToRanges([1, 4], 9)
    const seen = ranges.flatMap((r) =>
      Array.from({ length: r.to - r.from + 1 }, (_, i) => r.from + i),
    )
    expect(seen).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8])
  })
})
