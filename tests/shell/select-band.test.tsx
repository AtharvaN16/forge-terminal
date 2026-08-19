import { render } from 'ink-testing-library'
import type { ReactElement } from 'react'
import { describe, expect, it } from 'vitest'
import { Select } from '../../src/shell/components/Select.js'
import { ThemeProvider } from '../../src/shell/ThemeContext.js'
import { DARK } from '../../src/shell/theme.js'

const items = [
  { value: 'webp', label: 'WebP', hint: 'smaller, keeps transparency' },
  { value: 'png', label: 'PNG', hint: 'lossless' },
]

const frameOf = (node: ReactElement) =>
  render(<ThemeProvider palette={DARK}>{node}</ThemeProvider>).lastFrame() ?? ''

describe('Select rows', () => {
  it('marks the selection with a glyph, so meaning survives without colour', () => {
    expect(frameOf(<Select width={50} items={items} onSubmit={() => {}} />)).toContain('❯ WebP')
  })

  it('leaves unselected rows unmarked', () => {
    const frame = frameOf(<Select width={50} items={items} onSubmit={() => {}} />)
    const row = frame.split('\n').find((l) => l.includes('PNG')) ?? ''
    expect(row).not.toContain('❯')
    expect(row.trimStart().startsWith('PNG')).toBe(true)
  })

  it('never draws a row wider than the width it was given', () => {
    for (const w of [20, 30, 40, 80]) {
      const frame = frameOf(<Select width={w} items={items} onSubmit={() => {}} />)
      for (const line of frame.split('\n')) expect(line.length).toBeLessThanOrEqual(w)
    }
  })

  it('truncates a long hint rather than wrapping it onto a second line', () => {
    const long = [{ value: 'a', label: 'WebP', hint: 'x'.repeat(200) }]
    const frame = frameOf(<Select width={30} items={long} onSubmit={() => {}} />)
    expect(frame.split('\n').filter((l) => l.trim().length > 0).length).toBe(1)
    expect(frame).toContain('…')
  })

  it('budgets the hint in terminal columns, not code units', () => {
    // Each CJK glyph is two columns but one code point. A length-based budget
    // would fit 20 of them into a 24-column row and overflow by 16 columns.
    const wide = [{ value: 'a', label: 'X', hint: '日'.repeat(20) }]
    const frame = frameOf(<Select width={24} items={wide} onSubmit={() => {}} />)
    for (const line of frame.split('\n')) {
      const columns = [...line].reduce((n, ch) => n + (/[　-鿿]/.test(ch) ? 2 : 1), 0)
      expect(columns).toBeLessThanOrEqual(24)
    }
  })

  it('renders nothing for an empty list rather than an empty band', () => {
    expect(frameOf(<Select width={40} items={[]} onSubmit={() => {}} />)).toBe('')
  })
})
