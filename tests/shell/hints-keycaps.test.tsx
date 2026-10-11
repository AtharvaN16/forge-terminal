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

  it('draws no rule above the hint bar', () => {
    const f = frame(<HintBar width={60} pairs={pairs} />)
    expect(f).not.toContain('─')
    expect(f).toContain('confirm')
  })
})
