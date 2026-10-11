import { render } from 'ink-testing-library'
import type { ReactElement } from 'react'
import { describe, expect, it } from 'vitest'
import { Select } from '../../src/shell/components/Select.js'
import { ThemeProvider } from '../../src/shell/ThemeContext.js'
import { DARK, NEUTRAL } from '../../src/shell/theme.js'

const items = [
  { value: 'webp', label: 'WebP', hint: 'smaller, keeps transparency' },
  { value: 'png', label: 'PNG', hint: 'lossless' },
]

const frameOf = (node: ReactElement) =>
  render(<ThemeProvider palette={DARK}>{node}</ThemeProvider>).lastFrame() ?? ''

describe('Select rows', () => {
  it('marks the selection with a glyph, so meaning survives without colour', () => {
    expect(frameOf(<Select width={50} items={items} onSubmit={() => {}} />)).toContain('▌ WebP')
  })

  it('leaves unselected rows unmarked', () => {
    const frame = frameOf(<Select width={50} items={items} onSubmit={() => {}} />)
    const row = frame.split('\n').find((l) => l.includes('PNG')) ?? ''
    expect(row).not.toContain('▌')
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

describe('the picker (spec 2026-10-11 picker §1)', () => {
  const formats = [
    { value: 'webp', label: 'WebP', hint: 'smaller, modern' },
    { value: 'png', label: 'PNG', hint: 'lossless' },
    { value: 'merge', label: 'Merge', hint: 'needs 2+ files', disabled: true },
  ]
  const DOWN = `${String.fromCharCode(27)}[B`
  const settle = () => new Promise((r) => setTimeout(r, 60))

  it('speaks only for the highlighted row', async () => {
    const app = render(
      <ThemeProvider palette={DARK}>
        <Select width={50} items={formats} onSubmit={() => {}} />
      </ThemeProvider>,
    )
    expect(app.lastFrame()).toContain('smaller, modern')
    expect(app.lastFrame()).not.toContain('lossless')
    app.stdin.write(DOWN)
    await settle()
    expect(app.lastFrame()).toContain('lossless')
    expect(app.lastFrame()).not.toContain('smaller, modern')
  })

  it('keeps a disabled row’s reason, which is not a description', () => {
    expect(frameOf(<Select width={50} items={formats} onSubmit={() => {}} />)).toContain(
      'needs 2+ files',
    )
  })

  it('lets the caller say something else on the highlighted row', () => {
    const asked: string[] = []
    const frame = frameOf(
      <Select
        width={50}
        items={formats}
        onSubmit={() => {}}
        speak={(item) => {
          asked.push(item.value)
          return '74.6 KB'
        }}
      />,
    )
    expect(frame).toContain('74.6 KB')
    expect(frame).not.toContain('smaller, modern')
    expect(asked.every((v) => v === 'webp')).toBe(true)
  })

  it('puts a badge at the far end of its row, whether or not it is highlighted', () => {
    const tagged = [
      { value: 'a', label: 'Desktop' },
      { value: 'b', label: 'Downloads', badge: 'default' },
    ]
    const frame = frameOf(<Select width={40} items={tagged} onSubmit={() => {}} />)
    const row = frame.split('\n').find((l) => l.includes('Downloads')) ?? ''
    expect(row.trimEnd().endsWith('★ default')).toBe(true)
    expect(row.trimEnd().length).toBe(40)
  })

  it('shows every hint when the list is found by its hints', () => {
    const frame = frameOf(<Select width={50} items={formats} onSubmit={() => {}} hints="every" />)
    expect(frame).toContain('smaller, modern')
    expect(frame).toContain('lossless')
  })

  it('marks the selection by shape alone when there is no colour', () => {
    const frame =
      render(
        <ThemeProvider palette={NEUTRAL}>
          <Select width={40} items={formats} onSubmit={() => {}} />
        </ThemeProvider>,
      ).lastFrame() ?? ''
    expect(frame.split('\n')[0]?.startsWith('▌ WebP')).toBe(true)
  })
})
