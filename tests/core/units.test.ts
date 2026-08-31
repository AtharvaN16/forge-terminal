import { describe, expect, it } from 'vitest'
import { describeSize, formatBytes, parseSize, percentChange } from '../../src/core/units.js'

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

  /**
   * Decimal, matching `formatBytes` and matching Finder — which has reported
   * file sizes in powers of 1000 since 10.6, and is where the number a user
   * is aiming at comes from. Reading a KB as 1024 while printing one as 1000
   * meant a typed "500 KB" came back as "you asked for 512 KB".
   */
  it('reads KB, MB and GB as powers of 1000, the same way formatBytes prints them', () => {
    expect(parseSize('1kb')).toBe(1000)
    expect(parseSize('500kb')).toBe(500_000)
    expect(parseSize('2mb')).toBe(2_000_000)
    expect(parseSize('1gb')).toBe(1_000_000_000)
  })

  it('round-trips through formatBytes, so a target is never restated as a different number', () => {
    for (const typed of ['500kb', '2mb', '1gb', '250b']) {
      const bytes = parseSize(typed)
      if (bytes === undefined) throw new Error(`${typed} should parse`)
      expect(formatBytes(bytes)).toBe(describeSize(typed))
    }
  })

  it('ignores case and an optional space', () => {
    expect(parseSize('2 MB')).toBe(parseSize('2mb'))
    expect(parseSize('2Mb')).toBe(parseSize('2mb'))
    expect(parseSize('  2mb  ')).toBe(parseSize('2mb'))
  })

  it('accepts a decimal', () => {
    expect(parseSize('1.5mb')).toBe(1_500_000)
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

describe('describeSize', () => {
  /**
   * The target-size field echoes what it understood. It must echo the size
   * the user actually named — `parseSize` counts a KB as 1024 bytes while
   * `formatBytes` prints one as 1000, so round-tripping a typed "500 MB"
   * through both would answer "524 MB" and read as the field misunderstanding
   * a number it in fact got right.
   */
  it('restates a typed size in its own units', () => {
    expect(describeSize('500mb')).toBe('500 MB')
    expect(describeSize('2 MB')).toBe('2 MB')
    expect(describeSize('1.5gb')).toBe('1.5 GB')
    // No unit means bytes, the same assumption `parseSize` makes.
    expect(describeSize('900')).toBe('900 B')
  })

  it('is undefined for anything parseSize refuses', () => {
    expect(describeSize('later')).toBeUndefined()
    expect(describeSize('')).toBeUndefined()
    expect(describeSize('0kb')).toBeUndefined()
  })
})
