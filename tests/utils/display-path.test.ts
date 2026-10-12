import { describe, expect, it } from 'vitest'
import { displayPath } from '../../src/utils/display-path.js'

// The Mac behaviour, pinned to darwin so it holds on the Windows CI job too.
const home = '/Users/me'
const platform = 'darwin'

describe('displayPath', () => {
  it('abbreviates the home directory to ~', () => {
    expect(displayPath('/Users/me/Desktop', { home, platform })).toBe('~/Desktop')
  })

  it('shows home itself as ~', () => {
    expect(displayPath('/Users/me', { home, platform })).toBe('~')
  })

  it('does not mistake a sibling that shares a prefix for home', () => {
    expect(displayPath('/Users/meg/Desktop', { home, platform })).toBe('/Users/meg/Desktop')
  })

  it('leaves a path outside home absolute', () => {
    expect(displayPath('/Volumes/Backup/out', { home, platform })).toBe('/Volumes/Backup/out')
  })

  it('is relative to cwd when the path is inside it', () => {
    const cwd = '/Users/me/work'
    expect(displayPath('/Users/me/work/out/photo.png', { home, cwd, platform })).toBe(
      'out/photo.png',
    )
  })

  it('is . for cwd itself', () => {
    expect(displayPath('/Users/me/work', { home, cwd: '/Users/me/work', platform })).toBe('.')
  })

  it('treats a folder whose name starts with .. as inside, not above', () => {
    expect(
      displayPath('/Users/me/work/..cache/a.png', { home, cwd: '/Users/me/work', platform }),
    ).toBe('..cache/a.png')
  })

  it('falls back to ~ rather than climbing out of cwd with ..', () => {
    const cwd = '/Users/me/work'
    expect(displayPath('/Users/me/Pictures/a.png', { home, cwd, platform })).toBe(
      '~/Pictures/a.png',
    )
  })
})
