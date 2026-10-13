import { describe, expect, it } from 'vitest'
import { listCommands } from '../../src/shell/commands.js'
import { homeLayout } from '../../src/shell/components/Home.js'
import { commandRows, HOME_MARGIN, type Row, width } from '../../src/shell/home-art.js'
import { DARK } from '../../src/shell/theme.js'

/**
 * S2 (mockups/commands-scroll-2026-10.html, picked 2026-10-13): when the
 * list has more rows than the panel, a thin bar on its right edge and a
 * "↓ n more" on its bottom edge say so. At 80 × 24 /update was one row
 * below the panel, and nothing showed it.
 */
const text = (row: Row) => row.map((r) => r.text).join('')
const BAR = 80 - HOME_MARGIN - 1

function panel(selected: number, rows?: number) {
  const layout = homeLayout(80, 24)
  return commandRows({
    width: 80,
    palette: DARK,
    ...listCommands(''),
    selected,
    rows: rows ?? layout.surface,
    max: rows ?? layout.surface + layout.list - 1,
  })
}

describe('the commands list says when it scrolls', () => {
  const last = listCommands('').items.length - 1

  it('draws a bar on the right edge and says how many rows are below', () => {
    const out = panel(0)
    const bar = out.slice(1, -1).map((r) => [...text(r)][BAR])
    expect(bar.every((ch) => ch === '┃' || ch === '│')).toBe(true)
    expect(bar[0]).toBe('┃')
    expect(bar.at(-1)).toBe('│')
    expect(text(out.at(-1) as Row)).toContain('↓ 1 more')
    // The bar takes a fill cell: no row is wider than an unbarred one.
    for (const r of out) expect(width(r)).toBe(80 - HOME_MARGIN)
  })

  it('moves the thumb to the bottom and says what is above at the end', () => {
    const out = panel(last)
    const bar = out.slice(1, -1).map((r) => [...text(r)][BAR])
    expect(bar[0]).toBe('│')
    expect(bar.at(-1)).toBe('┃')
    expect(text(out.at(-1) as Row)).toContain('↑ 1 more')
  })

  it('draws nothing when the whole list fits', () => {
    const out = panel(0, 20)
    expect(out.map(text).join('\n')).not.toMatch(/[┃│]|more/)
  })
})
