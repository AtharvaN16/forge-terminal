import { describe, expect, it } from 'vitest'
import {
  CURSOR_QUERY,
  MOUSE_OFF,
  MOUSE_ON,
  offsetForColumn,
  parseCursorReport,
  parseMouse,
} from '../../src/shell/mouse.js'

describe('sgr mouse decoding', () => {
  it('decodes a left press, converting to zero-based coordinates', () => {
    expect(parseMouse('\x1b[<0;12;34M')).toEqual({
      x: 11,
      y: 33,
      button: 1,
      action: 'press',
      shift: false,
      meta: false,
      ctrl: false,
    })
  })

  /**
   * Ink strips the leading ESC from any sequence its keypress parser could
   * not resolve, so this is the form the shell actually receives.
   */
  it('decodes the ESC-stripped form Ink delivers', () => {
    expect(parseMouse('[<0;12;34M')).toMatchObject({ x: 11, y: 33, action: 'press' })
  })

  it('tells a release from a press by the final byte', () => {
    expect(parseMouse('\x1b[<0;5;5m')).toMatchObject({ action: 'release' })
    expect(parseMouse('\x1b[<0;5;5M')).toMatchObject({ action: 'press' })
  })

  it('reads a drag as motion with a button held', () => {
    // 32 = motion, low bits 0 = button 1
    expect(parseMouse('\x1b[<32;13;34M')).toMatchObject({ action: 'drag', button: 1 })
  })

  it('reads motion with no button held as a move', () => {
    // 35 = 32 (motion) + 3 (no button)
    expect(parseMouse('\x1b[<35;13;34M')).toMatchObject({ action: 'move', button: null })
  })

  it('decodes the wheel, which never reports a release', () => {
    expect(parseMouse('\x1b[<64;5;7M')).toMatchObject({ action: 'wheel', button: 4 })
    expect(parseMouse('\x1b[<65;5;7M')).toMatchObject({ action: 'wheel', button: 5 })
  })

  it('decodes modifier bits', () => {
    // 4 shift, 8 meta, 16 ctrl
    expect(parseMouse('\x1b[<4;1;1M')).toMatchObject({ shift: true, meta: false, ctrl: false })
    expect(parseMouse('\x1b[<8;1;1M')).toMatchObject({ shift: false, meta: true, ctrl: false })
    expect(parseMouse('\x1b[<16;1;1M')).toMatchObject({ shift: false, meta: false, ctrl: true })
    expect(parseMouse('\x1b[<28;1;1M')).toMatchObject({ shift: true, meta: true, ctrl: true })
  })

  it('handles the middle and right buttons', () => {
    expect(parseMouse('\x1b[<1;1;1M')).toMatchObject({ button: 2 })
    expect(parseMouse('\x1b[<2;1;1M')).toMatchObject({ button: 3 })
  })

  it('survives a wide terminal, which is why SGR is used at all', () => {
    // Column 500 is unrepresentable in the original X10 encoding.
    expect(parseMouse('\x1b[<0;500;9M')).toMatchObject({ x: 499, y: 8 })
  })

  it('returns null for anything that is not a mouse report', () => {
    for (const s of ['', 'a', '[', '[<', 'shot[1].png', '\x1b[3~', '[1;5D', '\x1b[<0;1;1X']) {
      expect(parseMouse(s)).toBeNull()
    }
  })
})

describe('mouse mode sequences', () => {
  it('enables SGR encoding, without which columns past 223 are unreportable', () => {
    expect(MOUSE_ON).toContain('?1006h')
  })

  it('asks for drag but not bare hover', () => {
    expect(MOUSE_ON).toContain('?1002h')
    expect(MOUSE_ON).not.toContain('?1003h')
  })

  it('turns off every mode it turned on', () => {
    for (const mode of ['1000', '1002', '1006']) {
      expect(MOUSE_ON).toContain(`?${mode}h`)
      expect(MOUSE_OFF).toContain(`?${mode}l`)
    }
  })
})

describe('cursor position reports', () => {
  it('asks with DSR 6, whose reply arrives on the input stream', () => {
    expect(CURSOR_QUERY).toBe('\x1b[6n')
  })

  it('decodes a DSR reply to zero-based coordinates', () => {
    expect(parseCursorReport('\x1b[24;1R')).toEqual({ row: 23, col: 0 })
  })

  it('decodes the ESC-stripped form Ink delivers', () => {
    expect(parseCursorReport('[24;13R')).toEqual({ row: 23, col: 12 })
  })

  it('returns null for anything else, including a mouse report', () => {
    for (const s of ['', '[24;1', '[<0;12;34M', 'abc', '[3~']) {
      expect(parseCursorReport(s)).toBeNull()
    }
  })
})

describe('mapping a click column to a caret offset', () => {
  it('places the caret between characters for plain ascii', () => {
    expect(offsetForColumn('abcd', 0)).toBe(0)
    expect(offsetForColumn('abcd', 2)).toBe(2)
    expect(offsetForColumn('abcd', 4)).toBe(4)
  })

  it('clamps a click past the end to the end', () => {
    expect(offsetForColumn('abc', 99)).toBe(3)
  })

  /**
   * The reason this walks widths instead of counting code points: these three
   * characters occupy six columns, so column 4 is the third character, not a
   * position past the end.
   */
  it('accounts for wide characters', () => {
    expect(offsetForColumn('日本語', 0)).toBe(0)
    expect(offsetForColumn('日本語', 2)).toBe(1)
    expect(offsetForColumn('日本語', 4)).toBe(2)
    expect(offsetForColumn('日本語', 6)).toBe(3)
  })

  it('lands after a wide glyph when clicked past its midpoint', () => {
    // '日' spans columns 0-1; a click at column 1 is past its midpoint.
    expect(offsetForColumn('日x', 1)).toBe(1)
  })
})

describe('MOUSE_ON_WITH_HOVER', () => {
  it('asks for any-motion reporting instead of button-motion', async () => {
    const { MOUSE_ON_WITH_HOVER } = await import('../../src/shell/mouse.js')
    // ?1003 (any motion) in place of ?1002 (motion only while held): hover
    // feedback needs events when no button is down.
    expect(MOUSE_ON_WITH_HOVER).toBe('\x1b[?1000h\x1b[?1003h\x1b[?1006h')
    expect(MOUSE_ON_WITH_HOVER).not.toContain('?1002h')
  })

  it('is cleared by the existing MOUSE_OFF', async () => {
    const { MOUSE_OFF } = await import('../../src/shell/mouse.js')
    // ?1003 and ?1002 are the same tracking slot, so ?1002l clears either.
    expect(MOUSE_OFF).toContain('?1002l')
    expect(MOUSE_OFF).toContain('?1000l')
    expect(MOUSE_OFF).toContain('?1006l')
  })
})
