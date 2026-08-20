import { render } from 'ink-testing-library'
import { createElement } from 'react'
import stringWidth from 'string-width'
import { describe, expect, it } from 'vitest'
import { gridLayout, PageGrid } from '../../src/shell/components/PageGrid.js'

const lines = (props: Record<string, unknown>) => {
  const { lastFrame } = render(createElement(PageGrid, props as never))
  return (lastFrame() ?? '').split('\n').filter((l) => l.trim() !== '')
}

describe('gridLayout', () => {
  it('sizes the cell from the document, not the visible page', () => {
    expect(gridLayout(248, 80, 24).cellWidth).toBe(7)
    expect(gridLayout(9, 80, 24).cellWidth).toBe(5)
  })

  it('fits as many cells per row as the width allows', () => {
    expect(gridLayout(9, 80, 24).perRow).toBeGreaterThan(gridLayout(9, 40, 24).perRow)
  })

  it('always places at least one cell per row', () => {
    expect(gridLayout(248, 20, 24).perRow).toBeGreaterThanOrEqual(1)
  })

  it('caps rows against the terminal height', () => {
    expect(gridLayout(248, 80, 12).rowsPerPage).toBeLessThan(gridLayout(248, 80, 40).rowsPerPage)
  })
})

describe('PageGrid geometry', () => {
  const base = {
    pageCount: 7,
    selected: [],
    cuts: [],
    onSubmit: () => {},
    onCancel: () => {},
    width: 80,
    height: 24,
  }

  it('draws the three lines of a row to one width', () => {
    const rows = lines({ ...base, mode: 'gap' })
    const cellLines = rows.filter((l) => /[╭│╰]/.test(l))
    // Not `cellLines.map(stringWidth)` — the classic `.map(parseInt)` trap,
    // except here it's a hard strict-mode type error rather than a silent
    // bug: `map` also passes the array index, and `stringWidth`'s second
    // parameter is typed `Options`, which `number` isn't assignable to.
    expect(new Set(cellLines.map((l) => stringWidth(l))).size).toBe(1)
  })

  it('right-aligns page numbers so units share a column', () => {
    const rows = lines({ ...base, pageCount: 12, mode: 'cell' })
    const numberRow = rows.find((l) => l.includes('│')) ?? ''
    expect(numberRow).toContain('  1 ')
  })

  it('marks a cut with the heavy bar and an uncut gap with the dashed one', () => {
    const rows = lines({ ...base, mode: 'gap', cuts: [0] }).join('\n')
    expect(rows).toContain('┃')
    expect(rows).toContain('┆')
  })

  it('never draws scissors, which some terminals render two columns wide', () => {
    expect(lines({ ...base, mode: 'gap', cuts: [0] }).join('\n')).not.toContain('✂')
  })

  it('marks a selected page in the top border', () => {
    expect(lines({ ...base, mode: 'cell', selected: [1] }).join('\n')).toContain('╭─✓─╮')
  })

  it('shows the paging position for a document that does not fit', () => {
    expect(lines({ ...base, pageCount: 248, mode: 'cell' }).join('\n')).toContain('of 248')
  })

  it('counts decisions made off-screen in the header', () => {
    const rows = lines({ ...base, pageCount: 248, mode: 'gap', cuts: [200] }).join('\n')
    expect(rows).toContain('2 files')
  })
})
