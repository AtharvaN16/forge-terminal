import { render } from 'ink-testing-library'
import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_PREFERENCES } from '../../src/config/preferences.js'
import { App } from '../../src/shell/App.js'
import { ThemeProvider } from '../../src/shell/ThemeContext.js'
import { DARK, LIGHT, type Palette } from '../../src/shell/theme.js'

/**
 * Chalk (via Ink) reads colour support once, when its module graph first
 * loads, and vitest externalises node_modules — so a `process.env.FORCE_COLOR`
 * assignment inside a test body is far too late to matter. `vi.hoisted` runs
 * above the imports, which is the only point at which setting it has any
 * effect. Same reasoning as tests/shell/select.test.tsx.
 *
 * Without this the frames below carry no SGR sequences at all and every
 * assertion in this file would pass while proving nothing.
 */
vi.hoisted(() => {
  process.env.FORCE_COLOR = '3'
  process.env.NO_COLOR = ''
})

/** '#e5a23c' -> '229;162;60', the body of an SGR truecolor sequence. */
function rgb(hex: string): string {
  const n = Number.parseInt(hex.slice(1), 16)
  return `${(n >> 16) & 255};${(n >> 8) & 255};${n & 255}`
}

const themed = (palette: Palette) => {
  const prefs = { ...DEFAULT_PREFERENCES, theme: palette.name as 'dark' | 'light' }
  return (
    render(
      <ThemeProvider palette={palette}>
        <App initialWidth={100} prefs={prefs} />
      </ThemeProvider>,
    ).lastFrame() ?? ''
  )
}

describe('palettes actually reach the terminal', () => {
  it('emits truecolor at all, or the rest of this file proves nothing', () => {
    expect(themed(DARK)).toContain('[38;2;')
  })

  it('the dark theme emits its own accent', () => {
    expect(themed(DARK)).toContain(rgb(DARK.accent))
  })

  it('the light theme emits its own accent, and not the dark one', () => {
    const frame = themed(LIGHT)
    expect(frame).toContain(rgb(LIGHT.accent))
    expect(frame).not.toContain(rgb(DARK.accent))
  })

  it('the two themes render genuinely different output', () => {
    expect(themed(DARK)).not.toBe(themed(LIGHT))
  })

  it('each theme uses its own foreground for the wordmark face', () => {
    expect(themed(DARK)).toContain(rgb(DARK.fg))
    expect(themed(LIGHT)).toContain(rgb(LIGHT.fg))
  })
})
