import { describe, expect, it } from 'vitest'
import { formatBytes, percentChange } from '../../src/core/units.js'

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
