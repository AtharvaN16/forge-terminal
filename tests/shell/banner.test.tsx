import { render } from 'ink-testing-library'
import type { ReactElement } from 'react'
import { describe, expect, it } from 'vitest'
import { DEFAULT_PREFERENCES } from '../../src/config/preferences.js'
import { App } from '../../src/shell/App.js'
import {
  Banner,
  FULL_WIDTH,
  MARK,
  MARK_FRAMES,
  WORDMARK,
} from '../../src/shell/components/Banner.js'
import { ThemeProvider } from '../../src/shell/ThemeContext.js'
import { DARK, LIGHT } from '../../src/shell/theme.js'

const frameOf = (node: ReactElement, palette = DARK) =>
  render(<ThemeProvider palette={palette}>{node}</ThemeProvider>).lastFrame() ?? ''

describe('banner art', () => {
  it('the wordmark rows are all the same width, or the letters shear', () => {
    expect(new Set(WORDMARK.map((r) => r.length)).size).toBe(1)
  })

  it('the mark rows are all the same width', () => {
    expect(new Set(MARK.map((r) => r.length)).size).toBe(1)
  })

  it('mark and wordmark are the same height, so they sit side by side', () => {
    expect(MARK.length).toBe(WORDMARK.length)
  })

  it('the wordmark has an outline, not just a fill', () => {
    // The edge glyphs are what make O and G distinguishable at six rows.
    const all = WORDMARK.join('')
    expect(all).toContain('╗')
    expect(all).toContain('║')
    expect(all).toContain('╚')
  })
})

describe('banner rendering', () => {
  it('draws mark and wordmark at normal width', () => {
    const frame = frameOf(<Banner width={100} version="0.1.0" defaultOutput="~/Desktop" />)
    expect(frame).toContain('█')
    expect(frame).toContain('0.1.0')
    expect(frame).toContain('~/Desktop')
  })

  it('falls back to a one-line header in the compact band', () => {
    const frame = frameOf(<Banner width={50} version="0.1.0" defaultOutput="~/Desktop" />)
    expect(frame).not.toContain('█')
    expect(frame).toContain('Forge')
    expect(frame.split('\n').filter((l) => l.trim().length > 0).length).toBe(1)
  })

  it('falls back below the width the art actually needs', () => {
    const frame = frameOf(<Banner width={FULL_WIDTH - 1} version="0.1.0" defaultOutput="~/x" />)
    expect(frame).not.toContain('█')
  })

  it('never overflows the terminal', () => {
    for (const w of [40, 50, 56, 60, 80, 100, 120]) {
      const frame = frameOf(<Banner width={w} version="0.1.0" defaultOutput="~/Desktop" />)
      for (const line of frame.split('\n')) expect(line.length).toBeLessThanOrEqual(w)
    }
  })

  it('renders in either palette', () => {
    for (const palette of [DARK, LIGHT]) {
      expect(
        frameOf(<Banner width={100} version="0.1.0" defaultOutput="~/x" />, palette),
      ).toContain('█')
    }
  })
})

describe('banner in the shell', () => {
  // The banner is committed to <Static> from an effect — Static output is
  // flushed above everything that re-renders, which is the only way it stays
  // at the top of the session — so it is not in the very first frame.
  const settle = (ms = 80) => new Promise((r) => setTimeout(r, ms))

  it('shows on every launch, not just the first', async () => {
    const prefs = { ...DEFAULT_PREFERENCES, theme: 'dark' as const }
    const { lastFrame } = render(<App initialWidth={100} prefs={prefs} />)
    await settle()
    expect(lastFrame() ?? '').toContain('█')
  })

  it('shows the configured default output folder', async () => {
    const prefs = { ...DEFAULT_PREFERENCES, theme: 'dark' as const, defaultOutput: '~/Pictures' }
    const { lastFrame } = render(<App initialWidth={100} prefs={prefs} />)
    await settle()
    expect(lastFrame() ?? '').toContain('~/Pictures')
  })

  it('does not compete with the first-run theme picker', () => {
    const frame = render(<App initialWidth={100} prefs={DEFAULT_PREFERENCES} />).lastFrame() ?? ''
    expect(frame).not.toContain('█')
    expect(frame).toContain('Dark')
  })
})

describe('animated mark', () => {
  it('every frame is the same shape, or the art shears', () => {
    for (const f of MARK_FRAMES) {
      expect(f.length, 'row count').toBe(WORDMARK.length)
      expect(new Set(f.map((r) => r.length)).size, 'row widths').toBe(1)
      expect(f[0]?.length).toBe(MARK_FRAMES[0]?.[0]?.length)
    }
  })

  it('the anvil itself never moves — only the hammer and sparks do', () => {
    // Rows 2-5 are the anvil. If they differed between frames the whole mark
    // would jitter rather than the hammer swinging against a fixed anvil.
    for (const row of [2, 3, 4, 5]) {
      const distinct = new Set(MARK_FRAMES.map((f) => f[row]))
      expect(distinct.size, `anvil row ${row}`).toBe(1)
    }
  })

  it('sparks appear on the strike and not while the hammer is raised', () => {
    const hasSparks = MARK_FRAMES.map((f) => f.join('').includes('✦'))
    expect(hasSparks[0]).toBe(false)
    expect(hasSparks[2]).toBe(true)
  })

  it('renders every frame without overflowing', () => {
    for (let f = 0; f < MARK_FRAMES.length; f++) {
      const frame = frameOf(
        <Banner width={100} version="0.1.0" defaultOutput="~/Desktop" frame={f} />,
      )
      for (const line of frame.split('\n')) expect(line.length).toBeLessThanOrEqual(100)
    }
  })

  it('settles into scrollback rather than animating forever', async () => {
    const prefs = { ...DEFAULT_PREFERENCES, theme: 'dark' as const }
    const { lastFrame } = render(<App initialWidth={100} prefs={prefs} />)
    await new Promise((r) => setTimeout(r, 1400))
    // Once settled the banner lives in <Static>; exactly one is ever drawn.
    const marks = (lastFrame() ?? '').split('\n').filter((l) => l.includes('▐██████████'))
    expect(marks.length).toBeLessThanOrEqual(1)
  }, 10_000)
})
