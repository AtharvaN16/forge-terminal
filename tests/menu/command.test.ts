import { describe, expect, it } from 'vitest'
import { openedFor, parseMenuArgs } from '../../src/menu/command.js'

describe('parseMenuArgs', () => {
  it('reads a click: the action and every file', () => {
    expect(parseMenuArgs(['run', 'sharpen', '/a.png', '/b c.png'])).toEqual({
      kind: 'run',
      action: 'sharpen',
      paths: ['/a.png', '/b c.png'],
    })
  })

  it('reads the window a click opened', () => {
    expect(parseMenuArgs(['open', 'compress', '/a.png'])).toEqual({
      kind: 'open',
      action: 'compress',
      paths: ['/a.png'],
    })
  })

  it('reads Open in Forge from a menu written before video and sound', () => {
    expect(parseMenuArgs(['run', 'open-pdf', '/a.pdf'])).toEqual({
      kind: 'run',
      action: 'open-file',
      paths: ['/a.pdf'],
    })
  })

  it('reads install and remove', () => {
    expect(parseMenuArgs(['install'])).toEqual({ kind: 'install' })
    expect(parseMenuArgs(['remove'])).toEqual({ kind: 'remove' })
  })

  it('reads a preset’s click: the preset’s name, then the files', () => {
    expect(parseMenuArgs(['run', 'preset', 'webblog', '/a.png'])).toEqual({
      kind: 'run',
      action: 'preset',
      preset: 'webblog',
      paths: ['/a.png'],
    })
  })

  it('refuses a preset click with no name, or a name no preset could have', () => {
    expect(() => parseMenuArgs(['run', 'preset'])).toThrow()
    expect(() => parseMenuArgs(['run', 'preset', '/a.png'])).toThrow()
  })

  it('refuses an action it does not know', () => {
    expect(() => parseMenuArgs(['run', 'rotate', '/a.png'])).toThrow(/rotate/)
    expect(() => parseMenuArgs([])).toThrow()
  })
})

describe('openedFor', () => {
  it('Open Forge: the app as it starts, nothing staged', () => {
    expect(openedFor('open', ['/a.png'])).toEqual({ paths: [], mode: 'convert', advance: false })
  })

  it('Convert and Compress: staged, the mode chosen, one step in', () => {
    expect(openedFor('convert', ['/a.png'])).toEqual({
      paths: ['/a.png'],
      mode: 'convert',
      advance: true,
    })
    expect(openedFor('compress', ['/a.png'])).toEqual({
      paths: ['/a.png'],
      mode: 'compress',
      advance: true,
    })
  })

  it('Open in Forge on a PDF: staged in PDF mode, waiting for ↵', () => {
    expect(openedFor('open-file', ['/n.pdf'], true)).toEqual({
      paths: ['/n.pdf'],
      mode: 'pdf',
      advance: false,
    })
  })

  it('Open in Forge on a video or sound file: staged on the convert home, waiting for ↵', () => {
    expect(openedFor('open-file', ['/clip.mov'])).toEqual({
      paths: ['/clip.mov'],
      mode: 'convert',
      advance: false,
    })
  })
})
