import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { render } from 'ink-testing-library'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_PREFERENCES, loadPreferences } from '../../src/config/preferences.js'
import { App } from '../../src/shell/App.js'

const ENTER = String.fromCharCode(13)
const DOWN = `${String.fromCharCode(27)}[B`
const settle = (ms = 150) => new Promise((r) => setTimeout(r, ms))

let dir: string
const saved = process.env.XDG_CONFIG_HOME

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'forge-theme-'))
  process.env.XDG_CONFIG_HOME = dir
})

afterEach(() => {
  if (saved === undefined) delete process.env.XDG_CONFIG_HOME
  else process.env.XDG_CONFIG_HOME = saved
})

describe('first run theme picker', () => {
  it('appears when no theme has been chosen', () => {
    const frame = render(<App initialWidth={80} prefs={DEFAULT_PREFERENCES} />).lastFrame() ?? ''
    expect(frame).toMatch(/theme/i)
    expect(frame).toContain('Dark')
    expect(frame).toContain('Light')
  })

  it('does not appear once a theme is stored', () => {
    const prefs = { ...DEFAULT_PREFERENCES, theme: 'dark' as const }
    const frame = render(<App initialWidth={80} prefs={prefs} />).lastFrame() ?? ''
    expect(frame).not.toContain('Light')
    expect(frame.toLowerCase()).toContain('drop a file')
  })

  it('writes the choice and moves on to the prompt', async () => {
    const { stdin, lastFrame } = render(<App initialWidth={80} prefs={DEFAULT_PREFERENCES} />)
    stdin.write(DOWN)
    await settle()
    stdin.write(ENTER)
    await settle(300)
    expect((await loadPreferences()).prefs.theme).toBe('light')
    expect((lastFrame() ?? '').toLowerCase()).toContain('drop a file')
  })

  it('stores dark when dark is chosen', async () => {
    const { stdin } = render(<App initialWidth={80} prefs={DEFAULT_PREFERENCES} />)
    stdin.write(ENTER)
    await settle(300)
    expect((await loadPreferences()).prefs.theme).toBe('dark')
  })

  it('draws no background fill while the theme is unknown', () => {
    // The picker renders before we know the terminal's background, so a
    // hardcoded band could land dark-on-dark or light-on-light.
    const frame = render(<App initialWidth={80} prefs={DEFAULT_PREFERENCES} />).lastFrame() ?? ''
    expect(frame).not.toContain('[48;2;')
  })

  it('offers /theme as the way back', () => {
    const frame = render(<App initialWidth={80} prefs={DEFAULT_PREFERENCES} />).lastFrame() ?? ''
    expect(frame).toContain('/theme')
  })

  it('/theme reopens the picker from the prompt', async () => {
    const prefs = { ...DEFAULT_PREFERENCES, theme: 'dark' as const }
    const { stdin, lastFrame } = render(<App initialWidth={80} prefs={prefs} />)
    stdin.write('/theme')
    await settle()
    stdin.write(ENTER)
    await settle(300)
    const frame = lastFrame() ?? ''
    expect(frame).toContain('Dark')
    expect(frame).toContain('Light')
  })
})
