import { homedir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { splitPastedPaths, unescapePath } from '../../src/utils/unescape-path.js'

describe('unescapePath, platform-pinned', () => {
  it('on darwin, still unescapes, unquotes and expands ~', () => {
    expect(unescapePath('My\\ Photo.jpg', 'darwin')).toBe('My Photo.jpg')
    expect(unescapePath("'/a b/c.png'", 'darwin')).toBe('/a b/c.png')
    expect(unescapePath('~/x', 'darwin')).toBe(join(homedir(), 'x'))
  })

  it('on win32, strips the quotes Windows Terminal adds around a path with spaces', () => {
    expect(unescapePath('"C:\\My Files\\a.png"', 'win32')).toBe('C:\\My Files\\a.png')
  })

  it('on win32, keeps backslashes, which are separators there and not escapes', () => {
    expect(unescapePath('C:\\Users\\a.png', 'win32')).toBe('C:\\Users\\a.png')
  })
})

describe('unescapePath', () => {
  it('leaves a plain path alone', () => {
    expect(unescapePath('/Users/me/photo.jpg')).toBe('/Users/me/photo.jpg')
  })

  it('unescapes backslash-escaped spaces, which is what iTerm pastes', () => {
    expect(unescapePath('/Users/me/My\\ Photo.jpg')).toBe('/Users/me/My Photo.jpg')
  })

  it('unescapes other backslash escapes', () => {
    expect(unescapePath("/Users/me/it\\'s.jpg")).toBe("/Users/me/it's.jpg")
  })

  it('strips single quotes without unescaping inside them', () => {
    expect(unescapePath("'/Users/me/My Photo.jpg'")).toBe('/Users/me/My Photo.jpg')
  })

  it('strips double quotes', () => {
    expect(unescapePath('"/Users/me/My Photo.jpg"')).toBe('/Users/me/My Photo.jpg')
  })

  it('expands a bare tilde', () => {
    expect(unescapePath('~')).toBe(homedir())
  })

  it('expands a tilde prefix', () => {
    expect(unescapePath('~/Desktop/a.jpg')).toBe(join(homedir(), 'Desktop/a.jpg'))
  })

  it('does not expand a tilde in the middle', () => {
    expect(unescapePath('/tmp/~backup/a.jpg')).toBe('/tmp/~backup/a.jpg')
  })

  it('trims surrounding whitespace, which terminals add', () => {
    expect(unescapePath('  /Users/me/a.jpg  ')).toBe('/Users/me/a.jpg')
  })
})

describe('splitPastedPaths', () => {
  it('splits several plain paths', () => {
    expect(splitPastedPaths('/a/one.jpg /a/two.jpg')).toEqual(['/a/one.jpg', '/a/two.jpg'])
  })

  it('does not split on an escaped space', () => {
    expect(splitPastedPaths('/a/My\\ Photo.jpg /a/two.jpg')).toEqual([
      '/a/My Photo.jpg',
      '/a/two.jpg',
    ])
  })

  it('does not split inside quotes', () => {
    expect(splitPastedPaths("'/a/My Photo.jpg' /a/two.jpg")).toEqual([
      '/a/My Photo.jpg',
      '/a/two.jpg',
    ])
  })

  it('returns one path for one path', () => {
    expect(splitPastedPaths('/a/one.jpg')).toEqual(['/a/one.jpg'])
  })

  it('returns nothing for empty input', () => {
    expect(splitPastedPaths('   ')).toEqual([])
  })

  it('merges two paths into one bogus chunk on an unterminated quote', () => {
    // Deliberate, documented behaviour (mirrors real shell semantics): once
    // an opening quote never finds its close, everything after it -
    // including whitespace that would otherwise be a path separator - is
    // absorbed into a single chunk. Two dropped paths can silently become
    // one. Not something this function is expected to fix.
    expect(splitPastedPaths("'/a/one.jpg /a/two.jpg")).toEqual(["'/a/one.jpg /a/two.jpg"])
  })
})
