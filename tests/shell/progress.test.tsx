import { render } from 'ink-testing-library'
import { createElement } from 'react'
import stringWidth from 'string-width'
import { describe, expect, it } from 'vitest'
import { Progress } from '../../src/shell/components/Progress.js'

const frame = (props: Record<string, unknown>) => {
  const { lastFrame } = render(
    createElement(Progress, { label: 'RENDERING', width: 60, ...props } as never),
  )
  return lastFrame() ?? ''
}

describe('Progress', () => {
  it('states a real position, not a percentage of nothing', () => {
    expect(frame({ done: 112, total: 248 })).toContain('page 112 of 248')
  })

  it('fills in proportion to the work done', () => {
    const early = frame({ done: 1, total: 100 })
    const late = frame({ done: 99, total: 100 })
    const knobAt = (s: string) => s.indexOf('●')
    expect(knobAt(early)).toBeLessThan(knobAt(late))
  })

  it('shows the current item when given one', () => {
    expect(frame({ done: 3, total: 9, detail: 'report-003.jpg' })).toContain('report-003.jpg')
  })

  it('renders every line within the given width', () => {
    const lines = frame({ done: 5, total: 9, detail: 'x'.repeat(200) }).split('\n')
    for (const line of lines) expect(stringWidth(line)).toBeLessThanOrEqual(60)
  })

  it('reads without colour', () => {
    // The count carries the meaning; the bar is decoration. Strip ANSI and
    // the frame must still say where it is.
    const plain = frame({ done: 2, total: 4 }).replace(/\[[0-9;]*m/g, '')
    expect(plain).toContain('page 2 of 4')
  })
})
