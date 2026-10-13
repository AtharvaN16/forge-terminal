import { render } from 'ink-testing-library'
import stripAnsi from 'strip-ansi'
import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_PREFERENCES } from '../../src/config/preferences.js'
import { App, PAINT_INSET } from '../../src/shell/App.js'

vi.hoisted(() => {
  process.env.FORCE_COLOR = '3'
  process.env.NO_COLOR = ''
})

/** Whether the terminal's background follows the canvas (see `useTerminalBackground`). */
const follows = vi.hoisted(() => ({ now: false }))
vi.mock('../../src/shell/useTerminalBackground.js', () => ({
  useTerminalBackground: () => follows.now,
}))

const settle = (ms = 800) => new Promise((r) => setTimeout(r, ms))

async function frame(followed: boolean) {
  follows.now = followed
  const prefs = { ...DEFAULT_PREFERENCES, theme: 'dark' as const }
  const app = render(<App initialWidth={80} initialHeight={24} prefs={prefs} />)
  await settle()
  const lines = (app.lastFrame() ?? '').split('\n').map((l) => stripAnsi(l))
  app.unmount()
  return lines
}

const ruleOf = (lines: string[]) => lines.findLast((l) => /─{20,}/.test(l))?.trim() ?? ''
const bandAt = (lines: string[]) => lines.findIndex((l) => l.includes('╱'))

describe('a canvas the terminal’s background follows', () => {
  it('needs no margin of its own: the full width, and no blank row on top', async () => {
    const own = await frame(false)
    const followed = await frame(true)
    expect(ruleOf(own)).toHaveLength(80 - 2 * PAINT_INSET)
    expect(ruleOf(followed)).toHaveLength(80)
    expect(bandAt(followed)).toBe(bandAt(own) - 1)
    expect(followed).toHaveLength(24)
  })
})
