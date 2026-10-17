import { describe, expect, it } from 'vitest'
import { FOCUS_OFF, FOCUS_ON, isFocusIn } from '../../src/shell/focus.js'
import { isStrayEscapeSequence } from '../../src/shell/mouse.js'

describe('focus reports', () => {
  it('asks for and stops focus reporting with DECSET 1004', () => {
    expect(FOCUS_ON).toBe('\x1b[?1004h')
    expect(FOCUS_OFF).toBe('\x1b[?1004l')
  })

  it('knows the window coming back to the front', () => {
    expect(isFocusIn('\x1b[I')).toBe(true)
    expect(isFocusIn('\x1b[O')).toBe(false)
    expect(isFocusIn('I')).toBe(false)
  })

  it('never lets a focus report be typed into a field', () => {
    expect(isStrayEscapeSequence('[I')).toBe(true)
    expect(isStrayEscapeSequence('[O')).toBe(true)
    // Brackets stay typeable: they are legal in file names.
    expect(isStrayEscapeSequence('[In')).toBe(false)
    expect(isStrayEscapeSequence('[')).toBe(false)
  })
})
