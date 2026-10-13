import { describe, expect, it } from 'vitest'
import { BACKGROUND_RESET, backgroundSequence } from '../../src/shell/terminal-background.js'
import { DARK, LIGHT, NEUTRAL } from '../../src/shell/theme.js'

describe('backgroundSequence', () => {
  it('sets the terminal’s default background to the painted canvas', () => {
    expect(backgroundSequence(DARK, {})).toBe('\u001b]11;#1e1e1e\u001b\\')
    expect(backgroundSequence(LIGHT, {})).toBe('\u001b]11;#ffffff\u001b\\')
  })

  it('is nothing for the neutral palette, which paints nothing', () => {
    expect(backgroundSequence(NEUTRAL, {})).toBeNull()
  })

  it('is nothing under NO_COLOR', () => {
    expect(backgroundSequence(DARK, { NO_COLOR: '1' })).toBeNull()
    expect(backgroundSequence(DARK, { NO_COLOR: '' })).not.toBeNull()
  })

  it('is nothing inside a multiplexer, where it would colour every pane', () => {
    for (const env of [
      { TMUX: '/tmp/tmux-501/default,1,0' },
      { STY: '123.pts' },
      { ZELLIJ: '0' },
      { TERM_PROGRAM: 'tmux' },
      { TERM: 'screen-256color' },
      { TERM: 'tmux-256color' },
    ]) {
      expect(backgroundSequence(DARK, env)).toBeNull()
    }
  })
})

describe('BACKGROUND_RESET', () => {
  it('puts back the profile’s own background (OSC 111)', () => {
    expect(BACKGROUND_RESET).toBe('\u001b]111\u001b\\')
  })
})
