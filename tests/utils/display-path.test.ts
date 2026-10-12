import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { displayPath } from '../../src/utils/display-path.js'

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
    expect(displayPath('/Users/me/work/out/photo.png', { home, cwd })).toBe(
      join('out', 'photo.png'),
    )
  })

  it('is . for cwd itself', () => {
    expect(displayPath('/Users/me/work', { home, cwd: '/Users/me/work' })).toBe('.')
  })

  it('treats a folder whose name starts with .. as inside, not above', () => {
    expect(displayPath('/Users/me/work/..cache/a.png', { home, cwd: '/Users/me/work' })).toBe(
      join('..cache', 'a.png'),
    )
  })

  it('falls back to ~ rather than climbing out of cwd with ..', () => {
    const cwd = '/Users/me/work'
    expect(displayPath('/Users/me/Pictures/a.png', { home, cwd })).toBe('~/Pictures/a.png')
  })
})
