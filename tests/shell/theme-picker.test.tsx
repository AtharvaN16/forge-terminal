import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { render } from 'ink-testing-library'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_PREFERENCES, loadPreferences } from '../../src/config/preferences.js'
import { App } from '../../src/shell/App.js'
import { ThemePicker } from '../../src/shell/components/ThemePicker.js'

const ENTER = String.fromCharCode(13)
const UP = `${String.fromCharCode(27)}[A`
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
    // Light is listed first; the cursor opens on Dark.
    stdin.write(UP)
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

const tick = () => new Promise((r) => setTimeout(r, 30))
const ESC = String.fromCharCode(27)

describe('esc in the theme picker', () => {
  it('/theme, then esc: back on the commands, Theme still highlighted, the theme unchanged', async () => {
    const prefs = { ...DEFAULT_PREFERENCES, theme: 'dark' as const }
    const { stdin, lastFrame } = render(<App initialWidth={80} prefs={prefs} />)
    stdin.write('/theme')
    await settle()
    stdin.write(ENTER)
    await settle(300)
    // Reopened, the picker is a setting inside the / menu's popup: its bar, named Theme.
    expect(lastFrame() ?? '').toMatch(/menu ╱{4,}.*Theme/)
    expect(lastFrame() ?? '').not.toContain('Select theme')
    expect(lastFrame() ?? '').toMatch(/esc +back/)
    stdin.write(ESC)
    await settle(300)
    const frame = lastFrame() ?? ''
    expect(frame).not.toMatch(/Theme ╱/)
    expect(frame).toContain('▌ /theme')
    // The menu's list again, Theme still chosen.
    expect(frame).toContain('/convert')
    expect((await loadPreferences()).prefs.theme).toBeUndefined()
  })

  it('on first run there is nothing to go back to: no esc', async () => {
    const { stdin, lastFrame } = render(<App initialWidth={80} prefs={DEFAULT_PREFERENCES} />)
    expect(lastFrame() ?? '').not.toContain('esc')
    stdin.write(ESC)
    await settle(300)
    expect(lastFrame() ?? '').toContain('Select theme')
  })
})

describe('the theme picker (round 5)', () => {
  it('says "Select theme", a blank row, then Light and Dark — no hints', () => {
    const lines = (render(<ThemePicker width={80} onChoose={() => {}} />).lastFrame() ?? '')
      .split('\n')
      .map((l) => l.trimEnd())
    // On home's margins (2026-10-20): the title and the list start at column 2.
    expect(lines[0]).toBe('  Select theme')
    expect(lines[1]).toBe('')
    expect(lines[2]).toMatch(/^ {4}Light$/)
    expect(lines[3]).toMatch(/^ {2}▌ Dark$/)
    const all = lines.join('\n')
    expect(all).not.toContain('background')
    expect(all).not.toContain('suits')
    expect(all).not.toContain('/theme')
  })

  it('closes with a rule across the width and the keys under it', () => {
    const lines = (render(<ThemePicker width={60} onChoose={() => {}} />).lastFrame() ?? '').split(
      '\n',
    )
    // The rule sits on the app's margins (2026-10-20): two columns in, two short.
    const rule = lines.indexOf(`  ${'─'.repeat(56)}`)
    expect(rule).toBeGreaterThan(3)
    expect(lines[rule + 1]).toMatch(/↑↓.*choose.*↵.*confirm/)
  })

  it('chooses the highlighted theme with ↵, and moves with the arrows', async () => {
    const onChoose = vi.fn()
    const { stdin } = render(<ThemePicker width={80} onChoose={onChoose} />)
    await tick()
    stdin.write('\u001b[A')
    await tick()
    stdin.write('\r')
    await tick()
    expect(onChoose).toHaveBeenCalledWith('light')
  })
})
