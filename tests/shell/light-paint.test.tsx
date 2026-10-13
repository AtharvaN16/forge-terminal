import { render } from 'ink-testing-library'
import stringWidth from 'string-width'
import stripAnsi from 'strip-ansi'
import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_PREFERENCES } from '../../src/config/preferences.js'
import { App } from '../../src/shell/App.js'

vi.hoisted(() => {
  process.env.FORCE_COLOR = '3'
  process.env.NO_COLOR = ''
})

const settle = (ms = 800) => new Promise((r) => setTimeout(r, ms))
const WHITE = '\u001b[48;2;255;255;255m'

describe('light paints its own canvas', () => {
  it('fills the whole window, every row the full width, on white', async () => {
    const prefs = { ...DEFAULT_PREFERENCES, theme: 'light' as const }
    const { lastFrame } = render(<App initialWidth={80} initialHeight={24} prefs={prefs} />)
    await settle()
    const lines = (lastFrame() ?? '').split('\n')
    expect(lines).toHaveLength(24)
    for (const line of lines) {
      expect(stringWidth(stripAnsi(line))).toBe(80)
      expect(line.startsWith(WHITE)).toBe(true)
    }
  })

  it('keeps a painted margin: a blank row on top, two columns each side', async () => {
    const prefs = { ...DEFAULT_PREFERENCES, theme: 'light' as const }
    const { lastFrame } = render(<App initialWidth={80} initialHeight={24} prefs={prefs} />)
    await settle()
    const lines = (lastFrame() ?? '').split('\n').map((l) => stripAnsi(l))
    expect(lines[0]?.trim()).toBe('')
    for (const line of lines) {
      expect(line.slice(0, 2)).toBe('  ')
      expect(line.slice(-2)).toBe('  ')
    }
  })

  it('leaves dark to the terminal', async () => {
    const prefs = { ...DEFAULT_PREFERENCES, theme: 'dark' as const }
    const { lastFrame } = render(<App initialWidth={80} initialHeight={24} prefs={prefs} />)
    await settle()
    expect(lastFrame() ?? '').not.toContain(WHITE)
  })
})
