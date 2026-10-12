import { describe, expect, it } from 'vitest'
import { slantedChips, trueColour } from '../../src/shell/glyphs.js'

describe('Windows Terminal', () => {
  it('is recognised by WT_SESSION', () => {
    expect(slantedChips({ WT_SESSION: 'x' })).toBe(true)
    expect(trueColour({ WT_SESSION: 'x' })).toBe(true)
  })

  it('still yields to the overrides', () => {
    expect(slantedChips({ WT_SESSION: 'x', FORGE_POWERLINE: '0' })).toBe(false)
    expect(trueColour({ WT_SESSION: 'x', NO_COLOR: '1' })).toBe(false)
  })
})
