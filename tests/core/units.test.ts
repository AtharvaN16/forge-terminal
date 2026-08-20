import { describe, expect, it } from 'vitest'
import { formatBytes, parseSize, percentChange } from '../../src/core/units.js'

describe('formatBytes', () => {
  it('shows plain bytes below a kilobyte', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(940)).toBe('940 B')
  })

  it('drops the decimal once the number is big enough not to need it', () => {
    expect(formatBytes(820_000)).toBe('820 KB')
  })

  it('keeps one decimal for small values', () => {
    expect(formatBytes(4_200_000)).toBe('4.2 MB')
  })
})

describe('percentChange', () => {
  it('reports a reduction', () => {
    expect(percentChange(4_200_000, 820_000)).toEqual({ pct: 80.5, direction: 'smaller' })
  })

  it('reports growth', () => {
    expect(percentChange(100, 150)).toEqual({ pct: 50, direction: 'larger' })
  })

  it('reports no change', () => {
    expect(percentChange(100, 100)).toEqual({ pct: 0, direction: 'same' })
  })

  it('does not divide by zero', () => {
    expect(percentChange(0, 100)).toEqual({ pct: 0, direction: 'larger' })
  })
})

describe('parseSize', () => {
  it('reads plain byte counts', () => {
    expect(parseSize('1024')).toBe(1024)
    expect(parseSize('500 b')).toBe(500)
  })

  it('reads KB, MB and GB as powers of 1024', () => {
    expect(parseSize('1kb')).toBe(1024)
    expect(parseSize('500kb')).toBe(512_000)
    expect(parseSize('2mb')).toBe(2 * 1024 * 1024)
    expect(parseSize('1gb')).toBe(1024 * 1024 * 1024)
  })

  it('ignores case and an optional space', () => {
    expect(parseSize('2 MB')).toBe(parseSize('2mb'))
    expect(parseSize('2Mb')).toBe(parseSize('2mb'))
    expect(parseSize('  2mb  ')).toBe(parseSize('2mb'))
  })

  it('accepts a decimal', () => {
    expect(parseSize('1.5mb')).toBe(Math.round(1.5 * 1024 * 1024))
  })

  it('rejects what is not a size', () => {
    for (const bad of ['', '   ', 'abc', 'mb', '-5mb', '5xb', '5 5mb', 'NaN']) {
      expect(parseSize(bad), bad).toBeUndefined()
    }
  })

  it('rejects zero — a file cannot be nothing', () => {
    expect(parseSize('0')).toBeUndefined()
    expect(parseSize('0kb')).toBeUndefined()
  })

  it('agrees with formatBytes about what a megabyte is', () => {
    // Both binary. If one were decimal a file would read "1 MB" on one line
    // and be over the limit on the next.
    expect(formatBytes(parseSize('1mb') ?? 0)).toContain('1 MB')
  })
})
