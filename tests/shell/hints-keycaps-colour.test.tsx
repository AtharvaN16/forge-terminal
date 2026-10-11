import { render } from 'ink-testing-library'
import { describe, expect, it, vi } from 'vitest'
import { Hints } from '../../src/shell/components/Hints.js'
import { ThemeProvider } from '../../src/shell/ThemeContext.js'
import { DARK } from '../../src/shell/theme.js'

vi.hoisted(() => {
  process.env.FORCE_COLOR = '3'
  process.env.NO_COLOR = ''
})

const rgb = (hex: string) => {
  const n = Number.parseInt(hex.slice(1), 16)
  return `${(n >> 16) & 255};${(n >> 8) & 255};${n & 255}`
}

describe('keycap colour', () => {
  it('fills the cap with keycapBg and never uses the accent', () => {
    const f =
      render(
        <ThemeProvider palette={DARK}>
          <Hints pairs={[['↵', 'go']]} />
        </ThemeProvider>,
      ).lastFrame() ?? ''
    expect(f).toContain(`48;2;${rgb(DARK.keycapBg)}`)
    expect(f).not.toContain(`38;2;${rgb(DARK.accent)}`)
  })
})
