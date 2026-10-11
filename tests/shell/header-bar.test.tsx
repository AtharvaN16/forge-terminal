import { homedir } from 'node:os'
import { join } from 'node:path'
import { render } from 'ink-testing-library'
import stringWidth from 'string-width'
import { describe, expect, it } from 'vitest'
import { HeaderBar, isWorking } from '../../src/shell/components/HeaderBar.js'
import { ThemeProvider } from '../../src/shell/ThemeContext.js'
import { DARK } from '../../src/shell/theme.js'

const desktop = join(homedir(), 'Desktop')
const frame = (p: Partial<Parameters<typeof HeaderBar>[0]> = {}) =>
  render(
    <ThemeProvider palette={DARK}>
      <HeaderBar mode="convert" defaultOutput={desktop} width={90} {...p} />
    </ThemeProvider>,
  ).lastFrame() ?? ''

// ink-testing-library trims trailing spaces from a frame, so the bar's last
// padding column (filled with the mode colour in a real terminal) is not
// visible here: a bar that ends exactly at the edge measures width - 1.
describe('header bar', () => {
  it('names the product and the mode, with the default folder on the right', () => {
    const f = frame()
    expect(f).toMatch(/^ ↔ FORGE {3}convert +~\/Desktop$/)
    expect(stringWidth(f)).toBe(89)
  })
  it('carries the staged file when given one', () => {
    expect(frame({ detail: 'report.pdf' })).toContain('convert · report.pdf')
  })
  it('uses each mode marker', () => {
    expect(frame({ mode: 'compress' })).toContain('↓ FORGE   compress')
    expect(frame({ mode: 'pdf' })).toContain('▣ FORGE   pdf')
  })
  it('shrinks to the marker and mode when compact', () => {
    const f = frame({ width: 50 })
    expect(f).toBe(' ↔ convert')
  })
  it('ellipses a long default folder instead of overflowing', () => {
    const f = frame({ defaultOutput: join(homedir(), 'deep/'.repeat(30), 'out'), width: 70 })
    expect(stringWidth(f)).toBe(69)
    expect(f).toContain('…')
  })
})

describe('isWorking', () => {
  it('is false only at an empty idle prompt and on the theme picker', () => {
    expect(isWorking('idle', 0)).toBe(false)
    expect(isWorking('theme', 0)).toBe(false)
    expect(isWorking('idle', 1)).toBe(true)
    expect(isWorking('target', 1)).toBe(true)
    expect(isWorking('result', 0)).toBe(true)
  })
})
