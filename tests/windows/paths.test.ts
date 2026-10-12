import { mkdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveInputs } from '../../src/core/resolve.js'
import { completePath } from '../../src/shell/complete.js'
import { destinationRows, isPathQuery, safeStem } from '../../src/shell/destinations.js'
import { displayPath } from '../../src/utils/display-path.js'
import { lastSegment } from '../../src/utils/last-segment.js'
import { unescapePath } from '../../src/utils/unescape-path.js'
import { makeJpeg, makePng, makeTempDir } from '../helpers/fixtures.js'

const rows = (text: string) => destinationRows(text, [], '', (p) => p, 'win32')

describe('Save as on Windows takes a typed or dropped folder', () => {
  it('reads a drive path, a quoted drop and ~\\ as places, not filters', () => {
    expect(isPathQuery('C:\\Users\\me\\out', 'win32')).toBe(true)
    expect(isPathQuery('C:/Users/me/out', 'win32')).toBe(true)
    expect(rows('"C:\\My Files\\new folder"')).toEqual([
      {
        value: 'C:\\My Files\\new folder',
        label: 'Use this folder',
        hint: 'C:\\My Files\\new folder',
      },
    ])
    expect(rows('~\\out')[0]?.value).toBe(join(homedir(), 'out'))
  })

  it('still filters the places by any other text', () => {
    expect(isPathQuery('Desk', 'win32')).toBe(false)
  })
})

describe('Tab completion on Windows', () => {
  it('splits on a backslash and inserts names unescaped, keeping the typed separator', async () => {
    const dir = await makeTempDir()
    await mkdir(join(dir, 'sub', 'My Photos'), { recursive: true })
    const found = await completePath('sub\\My', { cwd: dir, platform: 'win32' })
    expect(found[0]).toEqual({ label: 'sub\\My Photos\\', insert: 'sub\\My Photos\\' })
  })
})

describe('unescapePath on Windows', () => {
  it('expands ~\\ as it does ~/', () => {
    expect(unescapePath('~\\Pictures', 'win32')).toBe(join(homedir(), 'Pictures'))
  })
})

describe('the Save as name on Windows', () => {
  it('turns every character Windows refuses or reads as a path into -', () => {
    expect(safeStem(' a\\b:c*d?e"f<g>h|i/j ', 'win32')).toBe('a-b-c-d-e-f-g-h-i-j')
  })

  it('on macOS only / is replaced, as before', () => {
    expect(safeStem(' a\\b:c/d ', 'darwin')).toBe('a\\b:c-d')
  })
})

describe('displayPath on Windows', () => {
  it('abbreviates home with a backslash and evens out a / in the rest', () => {
    const path = 'C:\\Users\\a\\OneDrive\\Desktop/photo.png'
    expect(displayPath(path, { home: 'C:\\Users\\a', platform: 'win32' })).toBe(
      '~\\OneDrive\\Desktop\\photo.png',
    )
  })
})

describe('lastSegment', () => {
  it('on macOS is split("/").pop(), so a trailing slash still names nothing', () => {
    expect(lastSegment('/Users/x/Pictures/', 'darwin')).toBe('')
    expect(lastSegment('/Users/x/a.png', 'darwin')).toBe('a.png')
  })

  it('on Windows splits on either slash', () => {
    expect(lastSegment('C:\\Users\\x\\a.png', 'win32')).toBe('a.png')
    expect(lastSegment('C:/Users/x/a.png', 'win32')).toBe('a.png')
  })
})

describe('a Windows glob', () => {
  it('matches with backslash separators', async () => {
    const dir = await makeTempDir()
    await makeJpeg(dir, 'a.jpg')
    await makeJpeg(dir, 'b.jpg')
    await makePng(dir, 'c.png')
    const { sources } = await resolveInputs([`${dir}\\*.jpg`], {
      recursive: false,
      platform: 'win32',
    })
    expect(sources.map((s) => basename(s.path)).sort()).toEqual(['a.jpg', 'b.jpg'])
  })
})
