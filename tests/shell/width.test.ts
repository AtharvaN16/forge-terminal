import stringWidth from 'string-width'
import { describe, expect, it } from 'vitest'
import { bandFor, middleEllipsis } from '../../src/shell/width.js'

/**
 * True if any code point of `s` is an unpaired surrogate. Iterating a
 * string by code point (`[...s]`) keeps a valid surrogate pair together as
 * one entry whose code point is the combined astral character — so the
 * only way `codePointAt(0)` lands in the surrogate range (0xD800-0xDFFF)
 * is if that half was left without its partner.
 */
function hasUnpairedSurrogate(s: string): boolean {
  for (const char of [...s]) {
    const cp = char.codePointAt(0)
    if (cp !== undefined && cp >= 0xd800 && cp <= 0xdfff) return true
  }
  return false
}

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

  it('pins the common ascii path to an exact known string', () => {
    expect(middleEllipsis('/Users/me/Pictures/holiday/beach.jpg', 20)).toBe('/Users/me/…beach.jpg')
  })

  it('never splits a surrogate pair, even when truncating a run of emoji', () => {
    const out = middleEllipsis('🎉'.repeat(20), 20)
    expect(hasUnpairedSurrogate(out)).toBe(false)
    expect(stringWidth(out)).toBeLessThanOrEqual(20)
    expect(out).toContain('…')
  })

  it('bounds terminal columns, not code units, for wide CJK glyphs', () => {
    const out = middleEllipsis('/Users/me/写真/休暇/海辺の夕日.jpeg', 20)
    expect(stringWidth(out)).toBeLessThanOrEqual(20)
    expect(out).toContain('…')
  })

  it('bounds columns for mixed ascii, emoji and CJK text at several widths', () => {
    const text = '/Users/me/🎉旅行/写真フォルダ/海辺の夕日🌅.jpeg'
    for (const max of [10, 15, 20, 25, 30]) {
      const out = middleEllipsis(text, max)
      expect(stringWidth(out)).toBeLessThanOrEqual(max)
      expect(hasUnpairedSurrogate(out)).toBe(false)
    }
  })
})
