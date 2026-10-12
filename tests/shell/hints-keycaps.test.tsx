import { render } from 'ink-testing-library'
import type { ReactElement } from 'react'
import { describe, expect, it } from 'vitest'
import { HintBar } from '../../src/shell/components/HintBar.js'
import { Hints } from '../../src/shell/components/Hints.js'
import { ThemeProvider } from '../../src/shell/ThemeContext.js'
import { DARK, NEUTRAL } from '../../src/shell/theme.js'

const pairs: Array<[string, string]> = [
  ['↵', 'confirm'],
  ['esc', 'back'],
]
const frame = (node: ReactElement, palette = DARK) =>
  render(<ThemeProvider palette={palette}>{node}</ThemeProvider>).lastFrame() ?? ''

describe('keycap hints', () => {
  it('pads each key into a cap and drops the │ dividers', () => {
    const f = frame(<Hints pairs={pairs} />)
    expect(f).toContain(' ↵  confirm')
    expect(f).toContain(' esc  back')
    expect(f).not.toContain('│')
  })

  it('separates pairs by five spaces, or three when compact', () => {
    // The gap is measured to the start of the next cap, whose own padding
    // adds one more space before the key.
    expect(frame(<Hints pairs={pairs} />)).toContain('confirm      esc')
    expect(frame(<Hints pairs={pairs} compact />)).toContain('confirm    esc')
  })

  it('brackets keys when there is no fill to draw them on', () => {
    const f = frame(<Hints pairs={pairs} />, NEUTRAL)
    expect(f).toContain('[↵] confirm')
    expect(f).toContain('[esc] back')
  })

  it('brackets keys under NO_COLOR even when the theme has a fill', () => {
    // NO_COLOR strips the fill, which would leave ` ↵ ` looking like text.
    const before = process.env.NO_COLOR
    process.env.NO_COLOR = '1'
    try {
      expect(frame(<Hints pairs={pairs} />, DARK)).toContain('[↵] confirm')
    } finally {
      if (before === undefined) delete process.env.NO_COLOR
      else process.env.NO_COLOR = before
    }
  })

  it('never wraps: the quiet footnote gives up items from its right end first', () => {
    // F1: the main keys never shrink and the row is always one line, so a
    // narrow terminal loses footnote items rather than breaking the row.
    const many: Array<[string, string]> = [
      ['↑↓', 'choose'],
      ['↵', 'confirm'],
      ['1–3', 'mode'],
      ['esc', 'back'],
    ]
    for (const width of [40, 48, 72]) {
      const rows = frame(<HintBar width={width} pairs={many} />).split('\n')
      const keys = rows.at(-1) ?? ''
      expect(keys).toContain('↑↓  choose')
      expect(keys).toContain('↵  confirm')
      for (const r of rows) expect(r.length).toBeLessThanOrEqual(width)
    }
    expect(frame(<HintBar width={72} pairs={many} />)).toContain(
      '1–3 mode · esc back · ctrl-c quit',
    )
  })

  it('draws a rule the full width above the hint bar', () => {
    const rows = frame(<HintBar width={60} pairs={pairs} />).split('\n')
    const rule = rows.indexOf('─'.repeat(60))
    expect(rule).toBeGreaterThan(-1)
    expect(rows[rule + 1]).toContain('confirm')
  })
})
