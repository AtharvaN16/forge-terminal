import { render } from 'ink-testing-library'
import { createElement } from 'react'
import stringWidth from 'string-width'
import { describe, expect, it, vi } from 'vitest'
import { gridLayout, PageGrid } from '../../src/shell/components/PageGrid.js'

const lines = (props: Record<string, unknown>) => {
  const { lastFrame } = render(createElement(PageGrid, props as never))
  return (lastFrame() ?? '').split('\n').filter((l) => l.trim() !== '')
}

const ESC = String.fromCharCode(27)
const RIGHT = `${ESC}[C`
const LEFT = `${ESC}[D`
const ENTER = String.fromCharCode(13)
const SPACE = ' '
const PGDN = `${ESC}[6~`
const PGUP = `${ESC}[5~`

const settle = () => new Promise((r) => setTimeout(r, 60))

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
    // At this width, gridLayout(248, 80, 24) gives 5 full rows of 7 cells
    // (perRow) a screen, none of them the document's last row — every one
    // therefore carries a trailing gap (the row-boundary cut point), so
    // this now checks that "same width" holds across all five rows, not
    // just within a single one as it did when pageCount fit on one row.
    const rows = lines({ ...base, pageCount: 248, mode: 'gap' })
    const cellLines = rows.filter((l) => /[╭│╰]/.test(l))
    expect(cellLines.length).toBeGreaterThan(3) // several rows actually rendered
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

  it('cuts at a row boundary — the gap between one row and the next', () => {
    // gridLayout(12, 40, 24).perRow === 4, so pages 1-4, 5-8 and 9-12 land
    // in three separate rows. Gap 3, between page 4 and page 5, is the
    // trailing gap at the end of the first row: the row-boundary cut that
    // used to have nowhere to render and nowhere for the cursor to reach.
    const rows = lines({ ...base, pageCount: 12, width: 40, mode: 'gap', cuts: [3] })
    expect(rows.join('\n')).toContain('2 files')
    const rowOneNumbers = rows.find((l) => l.includes('│') && l.includes('4'))
    const rowTwoNumbers = rows.find((l) => l.includes('│') && l.includes('8') && !l.includes('4'))
    expect(rowOneNumbers).toBeDefined()
    expect(rowOneNumbers ?? '').toContain('┃')
    expect(rowTwoNumbers).toBeDefined()
    expect(rowTwoNumbers ?? '').not.toContain('┃')
  })
})

describe('PageGrid keyboard interaction', () => {
  const base = { pageCount: 7, selected: [], cuts: [], onCancel: () => {}, width: 80, height: 24 }

  /**
   * Ink's input parser only splits a written chunk into separate events at
   * escape-sequence boundaries — arrow keys bundle fine one after another
   * (`Select.test.tsx` already relies on this), but two *plain* characters
   * back to back, like space directly followed by enter, collapse into one
   * unrecognized blob that matches neither `input === ' '` nor
   * `key.return`. Measured: `stdin.write(SPACE + ENTER)` in one call never
   * reaches either branch; writing them separately with a settle between
   * does. So SPACE and ENTER — and any other trailing plain keys — always
   * get their own `stdin.write()` here, even though arrow bursts don't.
   */
  const press = async (stdin: { write: (input: string) => void }, ...keys: string[]) => {
    for (const key of keys) {
      stdin.write(key)
      await settle()
    }
  }

  it('space toggles the page under the cursor in cell mode, reported on enter', async () => {
    const onSubmit = vi.fn()
    const { stdin } = render(createElement(PageGrid, { ...base, mode: 'cell', onSubmit } as never))
    await press(stdin, RIGHT + RIGHT, SPACE, ENTER)
    expect(onSubmit).toHaveBeenCalledWith([2])
  })

  it('space toggles the gap under the cursor in gap mode, reported on enter', async () => {
    const onSubmit = vi.fn()
    const { stdin } = render(createElement(PageGrid, { ...base, mode: 'gap', onSubmit } as never))
    await press(stdin, SPACE, ENTER)
    expect(onSubmit).toHaveBeenCalledWith([0])
  })

  it('arrows reach the row-boundary gap by plain within-row movement', async () => {
    // Same 4-cells-a-row layout as the geometry test above. Three RIGHTs
    // from the first gap (index 0) land on index 3 — the row's trailing
    // gap, which is the boundary cut between page 4 and page 5.
    const onSubmit = vi.fn()
    const { stdin } = render(
      createElement(PageGrid, {
        ...base,
        pageCount: 12,
        width: 40,
        mode: 'gap',
        onSubmit,
      } as never),
    )
    await press(stdin, RIGHT + RIGHT + RIGHT, SPACE, ENTER)
    expect(onSubmit).toHaveBeenCalledWith([3])
  })

  it('right wraps past the row-boundary gap into the first gap of the next row', async () => {
    const onSubmit = vi.fn()
    const { stdin } = render(
      createElement(PageGrid, {
        ...base,
        pageCount: 12,
        width: 40,
        mode: 'gap',
        onSubmit,
      } as never),
    )
    // A fourth RIGHT, past the row-boundary gap reached by the first
    // three, has nowhere to clamp to within row one — it wraps to row
    // two's first gap (index 4, between page 5 and page 6) instead of
    // getting stuck on the boundary gap.
    await press(stdin, RIGHT + RIGHT + RIGHT + RIGHT, SPACE, ENTER)
    expect(onSubmit).toHaveBeenCalledWith([4])
  })

  it('left wraps back across the row boundary into the previous row', async () => {
    const onSubmit = vi.fn()
    const { stdin } = render(
      createElement(PageGrid, {
        ...base,
        pageCount: 12,
        width: 40,
        mode: 'gap',
        onSubmit,
      } as never),
    )
    // Wrap forward into row two (as above), then one LEFT should wrap back
    // to row one's last gap — the same row-boundary gap, not stuck at row
    // two's first column nor skipping past it to row one's second-to-last.
    await press(stdin, RIGHT + RIGHT + RIGHT + RIGHT + LEFT, SPACE, ENTER)
    expect(onSubmit).toHaveBeenCalledWith([3])
  })

  it('a selects every page, and clears the selection on a second press', async () => {
    const { stdin, lastFrame } = render(
      createElement(PageGrid, { ...base, mode: 'cell', onSubmit: () => {} } as never),
    )
    stdin.write('a')
    await settle()
    expect(lastFrame()).toContain('7 of 7 selected')
    stdin.write('a')
    await settle()
    expect(lastFrame()).toContain('0 of 7 selected')
  })

  it('a cuts every gap, and clears the cuts on a second press', async () => {
    const { stdin, lastFrame } = render(
      createElement(PageGrid, { ...base, mode: 'gap', onSubmit: () => {} } as never),
    )
    stdin.write('a')
    await settle()
    expect(lastFrame()).toContain('7 files') // 6 gaps cut → 7 resulting files
    stdin.write('a')
    await settle()
    expect(lastFrame()).toContain('1 file')
  })

  it('pgdn and pgup move the visible page range on a document that does not fit', async () => {
    const { stdin, lastFrame } = render(
      createElement(PageGrid, {
        ...base,
        pageCount: 248,
        mode: 'cell',
        onSubmit: () => {},
      } as never),
    )
    expect(lastFrame()).toContain('pages 1–35 of 248')
    stdin.write(PGDN)
    await settle()
    expect(lastFrame()).toContain('pages 36–70 of 248')
    stdin.write(PGUP)
    await settle()
    expect(lastFrame()).toContain('pages 1–35 of 248')
  })

  it('r and g call onToggleView and otherwise do nothing on their own', async () => {
    const onToggleView = vi.fn()
    const { stdin, lastFrame } = render(
      createElement(PageGrid, { ...base, mode: 'cell', onSubmit: () => {}, onToggleView } as never),
    )
    stdin.write('r')
    await settle()
    stdin.write('g')
    await settle()
    expect(onToggleView).toHaveBeenCalledTimes(2)
    // Neither key moved the cursor or changed the selection.
    expect(lastFrame()).toContain('0 of 7 selected')
  })

  it('ignores r and g when no onToggleView is given', async () => {
    const { stdin, lastFrame } = render(
      createElement(PageGrid, { ...base, mode: 'cell', onSubmit: () => {} } as never),
    )
    const before = lastFrame()
    stdin.write('r')
    await settle()
    stdin.write('g')
    await settle()
    expect(lastFrame()).toBe(before)
  })
})
