import { homedir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { splitPastedPaths, startsLikePath, unescapePath } from '../../src/utils/unescape-path.js'

describe('unescapePath on win32', () => {
  it('on win32, strips the quotes Windows Terminal adds around a path with spaces', () => {
    expect(unescapePath('"C:\\My Files\\a.png"', 'win32')).toBe('C:\\My Files\\a.png')
  })

  it('on win32, keeps backslashes, which are separators there and not escapes', () => {
    expect(unescapePath('C:\\Users\\a.png', 'win32')).toBe('C:\\Users\\a.png')
  })
})

// The Mac behaviour, pinned to darwin so it holds on the Windows CI job too.
describe('unescapePath on darwin', () => {
  const onMac = (raw: string) => unescapePath(raw, 'darwin')

  it('leaves a plain path alone', () => {
    expect(onMac('/Users/me/photo.jpg')).toBe('/Users/me/photo.jpg')
  })

  it('unescapes backslash-escaped spaces, which is what iTerm pastes', () => {
    expect(onMac('/Users/me/My\\ Photo.jpg')).toBe('/Users/me/My Photo.jpg')
  })

  it('unescapes other backslash escapes', () => {
    expect(onMac("/Users/me/it\\'s.jpg")).toBe("/Users/me/it's.jpg")
  })

  it('reads a file:// URL, which some terminals drop, as the path it names', () => {
    expect(onMac('file:///Users/me/My%20Photo.jpg')).toBe('/Users/me/My Photo.jpg')
    expect(onMac('file://localhost/Users/me/a.jpg')).toBe('/Users/me/a.jpg')
  })

  it('reads a file:// URL that was shell-escaped or quoted', () => {
    expect(onMac("'file:///Users/me/My%20Photo.jpg'")).toBe('/Users/me/My Photo.jpg')
    expect(onMac('file:///Users/me/it\\%27s.jpg')).toBe("/Users/me/it's.jpg")
  })

  it('leaves text that only looks like a URL alone', () => {
    expect(onMac('https://example.com/a.jpg')).toBe('https://example.com/a.jpg')
    expect(onMac('file:not-a-url')).toBe('file:not-a-url')
  })

  it('strips single quotes without unescaping inside them', () => {
    expect(onMac("'/Users/me/My Photo.jpg'")).toBe('/Users/me/My Photo.jpg')
  })

  it('strips double quotes', () => {
    expect(onMac('"/Users/me/My Photo.jpg"')).toBe('/Users/me/My Photo.jpg')
  })

  it('expands a bare tilde', () => {
    expect(onMac('~')).toBe(homedir())
  })

  it('expands a tilde prefix', () => {
    expect(onMac('~/Desktop/a.jpg')).toBe(join(homedir(), 'Desktop/a.jpg'))
  })

  it('does not expand a tilde in the middle', () => {
    expect(onMac('/tmp/~backup/a.jpg')).toBe('/tmp/~backup/a.jpg')
  })

  it('trims surrounding whitespace, which terminals add', () => {
    expect(onMac('  /Users/me/a.jpg  ')).toBe('/Users/me/a.jpg')
  })
})

describe('splitPastedPaths on darwin', () => {
  const split = (raw: string) => splitPastedPaths(raw, 'darwin')

  it('splits several plain paths', () => {
    expect(split('/a/one.jpg /a/two.jpg')).toEqual(['/a/one.jpg', '/a/two.jpg'])
  })

  it('does not split on an escaped space', () => {
    expect(split('/a/My\\ Photo.jpg /a/two.jpg')).toEqual(['/a/My Photo.jpg', '/a/two.jpg'])
  })

  it('does not split inside quotes', () => {
    expect(split("'/a/My Photo.jpg' /a/two.jpg")).toEqual(['/a/My Photo.jpg', '/a/two.jpg'])
  })

  it('splits several dropped file:// URLs into their paths', () => {
    expect(split('file:///a/one.jpg file:///a/My%20two.jpg')).toEqual([
      '/a/one.jpg',
      '/a/My two.jpg',
    ])
  })

  it('returns one path for one path', () => {
    expect(split('/a/one.jpg')).toEqual(['/a/one.jpg'])
  })

  it('returns nothing for empty input', () => {
    expect(split('   ')).toEqual([])
  })

  it('merges two paths into one bogus chunk on an unterminated quote', () => {
    // Deliberate, documented behaviour (mirrors real shell semantics): once
    // an opening quote never finds its close, everything after it -
    // including whitespace that would otherwise be a path separator - is
    // absorbed into a single chunk. Two dropped paths can silently become
    // one. Not something this function is expected to fix.
    expect(split("'/a/one.jpg /a/two.jpg")).toEqual(["'/a/one.jpg /a/two.jpg"])
  })
})

describe('startsLikePath', () => {
  it('is true for what a terminal drops on a Mac: absolute, quoted, escaped, file URL', () => {
    for (const text of [
      '/Users/me/a.png',
      "'/Users/me/My Photo.png'",
      '/Users/me/My\\ Photo.png /Users/me/b.png',
      'file:///Users/me/a.png',
      './a.png',
    ]) {
      expect(startsLikePath(text, 'darwin'), text).toBe(true)
    }
  })

  // `~` expands to the home of the machine running the test, and a Windows
  // runner's is `C:\Users\…` — no Mac path. win32's own case is below.
  it.skipIf(process.platform === 'win32')('is true for a path under home on a Mac', () => {
    expect(startsLikePath('~/Desktop/a.png', 'darwin')).toBe(true)
  })

  it('is false for words, a hex, or a URL that is not a file', () => {
    for (const text of ['foo bar', '#6579FD', 'https://example.com/a.png', 'photo.png']) {
      expect(startsLikePath(text, 'darwin'), text).toBe(false)
    }
  })

  it('on win32, is true for a drive, a share, home, or a quoted path', () => {
    for (const text of [
      'C:\\Users\\a.png',
      '"C:\\My Files\\a.png"',
      '\\\\server\\a.png',
      '~\\Pictures\\a.png',
      '~/Desktop/a.png',
    ]) {
      expect(startsLikePath(text, 'win32'), text).toBe(true)
    }
    expect(startsLikePath('foo bar', 'win32')).toBe(false)
  })
})
