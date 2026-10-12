import { describe, expect, it } from 'vitest'
import { displayName, displayPath } from '../../src/utils/display-path.js'

const home = '/Users/me'

describe('displayPath', () => {
  it('abbreviates the home directory to ~', () => {
    expect(displayPath('/Users/me/Desktop', { home })).toBe('~/Desktop')
  })

  it('shows home itself as ~', () => {
    expect(displayPath('/Users/me', { home })).toBe('~')
  })

  it('does not mistake a sibling that shares a prefix for home', () => {
    expect(displayPath('/Users/meg/Desktop', { home })).toBe('/Users/meg/Desktop')
  })

  it('leaves a path outside home absolute', () => {
    expect(displayPath('/Volumes/Backup/out', { home })).toBe('/Volumes/Backup/out')
  })

  it('is relative to cwd when the path is inside it', () => {
    const cwd = '/Users/me/work'
    expect(displayPath('/Users/me/work/out/photo.png', { home, cwd })).toBe('out/photo.png')
  })

  it('is . for cwd itself', () => {
    expect(displayPath('/Users/me/work', { home, cwd: '/Users/me/work' })).toBe('.')
  })

  it('treats a folder whose name starts with .. as inside, not above', () => {
    expect(displayPath('/Users/me/work/..cache/a.png', { home, cwd: '/Users/me/work' })).toBe(
      '..cache/a.png',
    )
  })

  it('falls back to ~ rather than climbing out of cwd with ..', () => {
    const cwd = '/Users/me/work'
    expect(displayPath('/Users/me/Pictures/a.png', { home, cwd })).toBe('~/Pictures/a.png')
  })
})

describe('display of a hostile name', () => {
  it('displayPath shows control characters as ?', () => {
    expect(displayPath('/Users/me/a\x1b]0;x\x07.png', { home })).toBe('~/a?]0;x?.png')
  })

  it('displayName is the base name, made printable', () => {
    expect(displayName('/tmp/a\x1b]0;x\x07.png')).toBe('a?]0;x?.png')
    expect(displayName('/tmp/photo.jpg')).toBe('photo.jpg')
  })
})
