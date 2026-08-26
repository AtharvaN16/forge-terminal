import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { render } from 'ink-testing-library'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_PREFERENCES } from '../../src/config/preferences.js'
import { App } from '../../src/shell/App.js'
import { DARK, LIGHT } from '../../src/shell/theme.js'

vi.hoisted(() => {
  process.env.FORCE_COLOR = '3'
  process.env.NO_COLOR = ''
})

const ENTER = String.fromCharCode(13)
const settle = (ms = 200) => new Promise((r) => setTimeout(r, ms))

const rgb = (hex: string) => {
  const n = Number.parseInt(hex.slice(1), 16)
  return `${(n >> 16) & 255};${(n >> 8) & 255};${n & 255}`
}

/**
 * `/theme` persists the choice, so the config this test writes must be its
 * own — without this it would overwrite the real one in the user's home.
 */
let dir: string
const saved = process.env.XDG_CONFIG_HOME

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'forge-theme-bg-'))
  process.env.XDG_CONFIG_HOME = dir
})

afterEach(() => {
  if (saved === undefined) delete process.env.XDG_CONFIG_HOME
  else process.env.XDG_CONFIG_HOME = saved
})

/**
 * Pins the bug where `App`'s own top-level `palette` came from `useTheme()`,
 * which resolves against whatever provider wraps `<App>` from the *outside*
 * (launch.tsx's, fixed at the palette computed once at launch) rather than
 * the live `theme` state. A component cannot read context from a provider it
 * renders as its own descendant, so App's own elements — the mode header
 * background among them — kept the launch palette forever.
 */
describe('mode header background follows the chosen theme', () => {
  it('paints the dark palette background when launched with the dark theme', () => {
    const prefs = { ...DEFAULT_PREFERENCES, theme: 'dark' as const }
    const frame = render(<App initialWidth={80} prefs={prefs} />).lastFrame() ?? ''
    expect(frame).toContain(rgb(DARK.modeConvertBg))
  })

  it('paints the light palette background when launched with the light theme', () => {
    const prefs = { ...DEFAULT_PREFERENCES, theme: 'light' as const }
    const frame = render(<App initialWidth={80} prefs={prefs} />).lastFrame() ?? ''
    expect(frame).toContain(rgb(LIGHT.modeConvertBg))
    expect(frame).not.toContain(rgb(DARK.modeConvertBg))
  })

  /**
   * The symptom as reported: switching theme mid-session repainted the
   * components that call `useTheme()` themselves, but not the bands App draws
   * from its own `palette` — so the background visibly did not change.
   */
  it('repaints the background when /theme switches the theme mid-session', async () => {
    const prefs = { ...DEFAULT_PREFERENCES, theme: 'light' as const }
    const { stdin, lastFrame } = render(<App initialWidth={80} prefs={prefs} />)
    expect(lastFrame() ?? '').toContain(rgb(LIGHT.modeConvertBg))

    stdin.write('/theme')
    await settle()
    stdin.write(ENTER)
    await settle(300)
    stdin.write(ENTER) // first row is Dark
    await settle(300)

    const frame = lastFrame() ?? ''
    expect(frame).toContain(rgb(DARK.modeConvertBg))
    expect(frame).not.toContain(rgb(LIGHT.modeConvertBg))
  })
})
