import { describe, expect, it } from 'vitest'
import {
  COMMANDS,
  isCommandBuffer,
  listCommands,
  parseCommand,
  rightClickDescription,
} from '../../src/shell/commands.js'

describe('isCommandBuffer', () => {
  it('is true only for a buffer that opens with a slash', () => {
    expect(isCommandBuffer('/')).toBe(true)
    expect(isCommandBuffer('/co')).toBe(true)
    expect(isCommandBuffer('')).toBe(false)
    expect(isCommandBuffer('photo.jpg')).toBe(false)
  })

  it('is false for a path that merely contains slashes', () => {
    // The single most common input to this prompt is an absolute path. It
    // must never open the palette.
    expect(isCommandBuffer('~/Desktop/a.png')).toBe(false)
    expect(isCommandBuffer('/Users/me/Desktop/a.png')).toBe(false)
    expect(isCommandBuffer('/tmp/x')).toBe(false)
  })

  it('is false once a space appears — no command takes an argument', () => {
    expect(isCommandBuffer('/Users me')).toBe(false)
    expect(isCommandBuffer('/compress now')).toBe(false)
  })

  it('is true for a dragged path only if it does not start with a slash', () => {
    // A dropped file on macOS arrives escaped, e.g. /Users/me/my\ photo.png —
    // it has both a slash and a space, so it can never be mistaken.
    expect(isCommandBuffer('/Users/me/my\\ photo.png')).toBe(false)
  })
})

describe('/colour', () => {
  it('switches to colour mode, and /color does too without being listed', () => {
    expect(parseCommand('/colour')?.mode).toBe('colour')
    expect(parseCommand('/color')?.mode).toBe('colour')
    expect(listCommands('col').items.map((c) => c.name)).toEqual(['colour'])
  })
})

describe('listCommands', () => {
  const names = (fragment: string) => listCommands(fragment).items.map((c) => c.name)

  it('lists the settings, then the modes in tab order, for a bare slash, with no /help row', () => {
    expect(names('')).toEqual([
      'theme',
      'extensions',
      'right-click',
      'cli',
      'update',
      'about',
      'convert',
      'compress',
      'pdf',
      'edit',
      'transcribe',
      'colour',
    ])
    expect(listCommands('').items.map((c) => c.group)).toEqual([
      'settings',
      'settings',
      'settings',
      'settings',
      'settings',
      'settings',
      'modes',
      'modes',
      'modes',
      'modes',
      'modes',
      'modes',
    ])
  })

  it('prefix-matches, case-insensitively, and returns the typed part to draw bright', () => {
    expect(names('co')).toEqual(['convert', 'compress', 'colour'])
    expect(listCommands('CO').query).toBe('co')
    expect(names('comp')).toEqual(['compress'])
  })

  it('opens the whole list for /help, and for the start of it', () => {
    for (const typed of ['help', 'he', 'h']) {
      expect(names(typed)).toEqual([
        'theme',
        'extensions',
        'right-click',
        'cli',
        'update',
        'about',
        'convert',
        'compress',
        'pdf',
        'edit',
        'transcribe',
        'colour',
      ])
      expect(listCommands(typed).query).toBe('')
    }
  })

  it('returns nothing for a fragment that matches nothing', () => {
    expect(listCommands('zzz').items).toEqual([])
  })

  it('names the mode each mode command switches to', () => {
    expect(listCommands('').items.map((c) => c.mode)).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      'convert',
      'compress',
      'pdf',
      'edit',
      'transcribe',
      'colour',
    ])
  })
})

describe('parseCommand', () => {
  it('resolves an exact name', () => {
    expect(parseCommand('/compress')?.name).toBe('compress')
    expect(parseCommand('/theme')?.name).toBe('theme')
  })

  it('ignores case and surrounding space', () => {
    expect(parseCommand('  /Compress  ')?.name).toBe('compress')
  })

  it('returns undefined for an unknown command', () => {
    expect(parseCommand('/nope')).toBeUndefined()
    expect(parseCommand('not a command')).toBeUndefined()
  })

  it('does not resolve a prefix — /comp is not /compress', () => {
    // The palette resolves prefixes by highlighting; typing one in full and
    // pressing enter should not silently pick something.
    expect(parseCommand('/comp')).toBeUndefined()
  })
})

describe('the registry', () => {
  it('says what each command does (2026-10-18)', () => {
    const said = (name: string) => COMMANDS.find((c) => c.name === name)?.description
    expect(said('theme')).toBe('switch between light and dark themes')
    expect(said('extensions')).toBe('manage installed AI tools')
    expect(said('update')).toBe('check for updates')
    expect(said('about')).toBe('version, credits, and dependencies')
    expect(said('convert')).toBe('convert files between formats')
    expect(said('compress')).toBe('reduce file size')
    expect(said('pdf')).toBe('merge, split, and edit PDFs')
    expect(said('edit')).toBe('enhance, resize, and edit images')
    expect(said('transcribe')).toBe('transcribe audio and video')
    expect(said('colour')).toBe('extract palettes and generate colour scales')
    expect(said('color')).toBe(said('colour'))
  })

  it('names the right-click menu as each system does', () => {
    expect(rightClickDescription('darwin')).toBe('manage Forge mac quick actions')
    expect(rightClickDescription('win32')).toBe('manage Forge right-click actions')
  })

  it('carries every command the shell can run', () => {
    expect(COMMANDS.map((c) => c.name).sort()).toEqual([
      'about',
      'cli',
      'color',
      'colour',
      'compress',
      'convert',
      'edit',
      'extensions',
      'help',
      'pdf',
      'right-click',
      'theme',
      'transcribe',
      'update',
    ])
  })

  it('lists /about last among the settings', () => {
    expect(listCommands('a').items.map((c) => c.name)).toEqual(['about'])
    expect(listCommands('a').items[0]?.group).toBe('settings')
  })

  it('gives every command a description, since the palette shows them', () => {
    for (const c of COMMANDS) expect(c.description.length).toBeGreaterThan(0)
  })

  it('marks which commands need a file to mean anything', () => {
    const needs = Object.fromEntries(COMMANDS.map((c) => [c.name, c.needsSource]))
    expect(needs.convert).toBe(true)
    expect(needs.compress).toBe(true)
    expect(needs.pdf).toBe(true)
    expect(needs.theme).toBe(false)
    expect(needs.help).toBe(false)
  })
})
