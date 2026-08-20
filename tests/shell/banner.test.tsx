import { render } from 'ink-testing-library'
import type { ReactElement } from 'react'
import { describe, expect, it } from 'vitest'
import { DEFAULT_PREFERENCES } from '../../src/config/preferences.js'
import { App } from '../../src/shell/App.js'
import { Banner, FULL_WIDTH, MARK, WORDMARK } from '../../src/shell/components/Banner.js'
import { playIntro } from '../../src/shell/intro.js'
import { ANVIL, composeMark, HAMMER, MARK_HEIGHT, MARK_WIDTH, SWING } from '../../src/shell/mark.js'
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

  it('the mark is at least as tall as the wordmark it sits beside', () => {
    expect(MARK.length).toBeGreaterThanOrEqual(WORDMARK.length)
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

describe('the intro', () => {
  /** Captures what would have been written to the terminal. */
  function capture() {
    const out: string[] = []
    return { out, write: (s: string) => void out.push(s) }
  }

  const ESC = String.fromCharCode(27)
  const UP = new RegExp(`${ESC}\\[\\d+A`, 'g')
  const SGR = new RegExp(`${ESC}\\[[0-9;]*[A-Za-z]`, 'g')
  const strip = (s: string) => s.replace(SGR, '')

  const opts = (over: Record<string, unknown> = {}) => ({
    width: 100,
    palette: DARK,
    version: '0.1.0',
    defaultOutput: '~/Desktop',
    colour: true,
    frameMs: 0,
    ...over,
  })

  it('draws the mark and the wordmark on every launch', async () => {
    const { out, write } = capture()
    await playIntro({ ...opts(), write })
    const text = strip(out.join(''))
    expect(text).toContain('\u2588')
    expect(text).toContain('0.1.0')
  })

  it('shows the configured default output folder', async () => {
    const { out, write } = capture()
    await playIntro({ ...opts({ defaultOutput: '~/Pictures' }), write })
    expect(strip(out.join(''))).toContain('~/Pictures')
  })

  it('moves the cursor back up between frames, so it redraws in place', async () => {
    const { out, write } = capture()
    await playIntro({ ...opts(), write })
    const ups = out.join('').match(UP) ?? []
    // One fewer than the frames: the last is left on screen on purpose, which
    // is what turns the loop into ordinary scrollback.
    expect(ups.length).toBe(SWING.length - 1)
    expect(ups.every((u) => u === `${ESC}[${MARK_HEIGHT}A`)).toBe(true)
  })

  it('plays no loop at all without colour — there is nothing to see', async () => {
    const { out, write } = capture()
    await playIntro({ ...opts({ colour: false }), write })
    expect(out.join('').match(UP)).toBe(null)
    expect(out.join('')).toContain('\u2588')
  })

  it('falls back to a one-line header when the terminal is too narrow', async () => {
    const { out, write } = capture()
    await playIntro({ ...opts({ width: 40 }), write })
    expect(out.join('')).not.toContain('\u2588')
    expect(out.join('')).toContain('Forge')
  })

  it('does not draw the banner inside Ink — the intro already did', () => {
    const prefs = { ...DEFAULT_PREFERENCES, theme: 'dark' as const }
    const frame = render(<App initialWidth={100} prefs={prefs} />).lastFrame() ?? ''
    expect(frame).not.toContain(
      '\u2590\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u258c',
    )
  })
})

describe('the mark', () => {
  it('every composed frame is the same shape, or the art shears', () => {
    for (const step of SWING) {
      const f = composeMark(step)
      expect(f.length).toBe(MARK_HEIGHT)
      expect(new Set(f.map((r) => r.length))).toEqual(new Set([MARK_WIDTH]))
    }
  })

  it('the handle is centred on the head, not half a column off', () => {
    const head = HAMMER.find((r) => r.includes('█████')) ?? ''
    const shaft = HAMMER[0] ?? ''
    const centre = (s: string) =>
      (s.indexOf(s.trim()[0] ?? '') + s.lastIndexOf(s.trim().at(-1) ?? '')) / 2
    expect(centre(shaft)).toBe(centre(head))
  })

  it('the handle is attached to the head, with no gap between them', () => {
    const lastHandle = HAMMER.map((r) => r.includes('║')).lastIndexOf(true)
    const firstHead = HAMMER.findIndex((r) => r.includes('█'))
    expect(firstHead).toBe(lastHandle + 1)
  })

  it('the anvil never moves — only the hammer and sparks do', () => {
    for (const step of SWING) {
      expect(composeMark(step).slice(-ANVIL.length)).toEqual([...ANVIL])
    }
  })

  it('sparks appear on the strike and not while the hammer is raised', () => {
    const sparky = SWING.map((s) => /[|/*.']/.test(composeMark(s).join('')))
    expect(sparky[0]).toBe(false)
    expect(sparky[2]).toBe(true)
  })

  it('renders without overflowing', () => {
    const frame = frameOf(<Banner width={100} version="0.1.0" defaultOutput="~/Desktop" />)
    for (const line of frame.split(String.fromCharCode(10)))
      expect(line.length).toBeLessThanOrEqual(100)
  })
})

describe('the hammer stays whole', () => {
  it('the head is visible on every step of the swing', () => {
    // A positive offset pushes the head onto the anvil's own row, where the
    // anvil overwrites it — the hammer loses its head and only the handle
    // shows. This pins the offsets against that.
    for (const [i, step] of SWING.entries()) {
      const sky = composeMark(step).slice(0, MARK_HEIGHT - ANVIL.length)
      expect(
        sky.some((r) => r.includes('█████')),
        `step ${i}`,
      ).toBe(true)
    }
  })

  it('the handle sits directly on the head in every step', () => {
    for (const step of SWING) {
      const sky = composeMark(step).slice(0, MARK_HEIGHT - ANVIL.length)
      const head = sky.findIndex((r) => r.includes('█████'))
      const handleRows = sky.map((r) => r.includes('║'))
      const lastHandle = handleRows.lastIndexOf(true)
      if (lastHandle !== -1) expect(head).toBe(lastHandle + 1)
    }
  })

  it('rests on the strike, not mid-lift', () => {
    const last = SWING[SWING.length - 1]
    expect(last?.hot).toBe(true)
  })
})
