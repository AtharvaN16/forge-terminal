import { describe, expect, it } from 'vitest'
import { bandFor, middleEllipsis } from '../../src/shell/width.js'

describe('bandFor', () => {
  it('uses the spec boundaries', () => {
    expect(bandFor(40)).toBe('compact')
    expect(bandFor(59)).toBe('compact')
    expect(bandFor(60)).toBe('normal')
    expect(bandFor(100)).toBe('normal')
    expect(bandFor(101)).toBe('wide')
    expect(bandFor(200)).toBe('wide')
  })

  it('treats a zero or unknown width as compact rather than crashing', () => {
    expect(bandFor(0)).toBe('compact')
  })
})

describe('middleEllipsis', () => {
  it('leaves short text alone', () => {
    expect(middleEllipsis('photo.jpg', 20)).toBe('photo.jpg')
  })

  it('leaves text of exactly the maximum alone', () => {
    expect(middleEllipsis('123456789', 9)).toBe('123456789')
  })

  it('keeps both ends, which is what matters for paths', () => {
    const out = middleEllipsis('/Users/me/Pictures/holiday/beach.jpg', 20)
    expect(out).toHaveLength(20)
    expect(out.startsWith('/Users')).toBe(true)
    expect(out.endsWith('.jpg')).toBe(true)
    expect(out).toContain('…')
  })

  it('never exceeds the maximum', () => {
    for (const max of [4, 5, 10, 15, 30]) {
      expect(middleEllipsis('/a/very/long/path/to/a/file.jpeg', max).length).toBeLessThanOrEqual(
        max,
      )
    }
  })

  it('degrades sanely at tiny widths', () => {
    expect(middleEllipsis('abcdefgh', 1)).toBe('…')
    expect(middleEllipsis('abcdefgh', 0)).toBe('')
  })
})
