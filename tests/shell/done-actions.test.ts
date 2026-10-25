import { describe, expect, it } from 'vitest'
import { type DoneAction, doneActionRows } from '../../src/shell/done-art.js'
import type { Row } from '../../src/shell/home-art.js'
import { DARK, modePalette, NEUTRAL } from '../../src/shell/theme.js'

/**
 * Done's way on (mockups/done-next-2026-10-round9.html, Y31): a frame in the
 * shelf grey holding every action but Home, spaced evenly; a cell of
 * canvas; then Home as its own block in the mode's tint, ending on the
 * block's edge. Both three rows tall. The selected action fills all three
 * rows: a grey one in the key caps' grey, Home in the bright mode colour.
 */
const P = modePalette(DARK, 'convert')
const W = 80
const ACTIONS: DoneAction[] = [
  { key: 'o', label: 'open' },
  { key: 'f', label: 'finder' },
  { key: 'p', label: 'save as preset' },
  { key: 'e', label: 'continue editing' },
]
const HOME = ACTIONS.length

const text = (row: Row | undefined) => (row ?? []).map((r) => r.text).join('')
const cells = (row: Row | undefined) =>
  (row ?? []).flatMap((run) =>
    [...run.text].map((ch) => ({ ch, fg: run.fg, bg: run.bg, bold: run.bold ?? false })),
  )
const draw = (selected: number, width = W, actions = ACTIONS) =>
  doneActionRows({ palette: P, mode: 'convert', actions, selected, width }) ?? []

describe('doneActionRows', () => {
  it('draws three rows inside the margins', () => {
    const rows = draw(HOME)
    expect(rows).toHaveLength(3)
    for (const row of rows) expect(text(row).length).toBe(W - 2)
  })

  it('puts every key beside its word, in order', () => {
    const middle = text(draw(HOME)[1])
    expect(middle).toMatch(/^ {3,}o open /)
    for (const a of ACTIONS) expect(middle).toContain(`${a.key} ${a.label}`)
    expect(middle.indexOf('open')).toBeLessThan(middle.indexOf('finder'))
    expect(middle.indexOf('save as preset')).toBeLessThan(middle.indexOf('continue editing'))
  })

  it('spaces the actions evenly: the same grey before the first, between each, and after the last', () => {
    const three = ACTIONS.slice(0, 2).concat({ key: 'c', label: 'copy' })
    const middle = text(draw(HOME, 100, three)[1])
    const frame = middle.slice(2, middle.length - '  ↵ Home  '.length - 1)
    const gaps = frame.split(/ ?[ofc] (?:open|finder|copy) /).map((g) => g.length)
    expect(gaps).toHaveLength(4)
    expect(Math.max(...gaps) - Math.min(...gaps)).toBeLessThanOrEqual(1)
  })

  it('fills the frame with the shelf grey from the margin', () => {
    for (const row of draw(HOME)) expect(cells(row)[2]?.bg).toBe(P.shelf)
  })

  it('ends with Home as its own block: two cells of tint either side, a cell of canvas before it', () => {
    const rows = draw(OPEN_SELECTED)
    const middle = text(rows[1])
    expect(middle.endsWith('  ↵ Home  ')).toBe(true)
    const homeAt = W - 2 - '  ↵ Home  '.length
    for (const row of rows) {
      const c = cells(row)
      expect(c[homeAt]?.bg).toBe(P.modeConvertBg)
      expect(c[W - 3]?.bg).toBe(P.modeConvertBg)
      expect(c[homeAt - 1]?.bg).toBeUndefined()
      expect(c[homeAt - 2]?.bg).toBe(P.shelf)
    }
    expect(cells(rows[1])[middle.indexOf('Home')]?.fg).toBe(P.modeConvert)
  })

  it('fills a selected grey action all three rows in the key caps’ grey, its words bright', () => {
    const rows = draw(1)
    const at = text(rows[1]).indexOf('f finder') - 1
    const span = ' f finder '.length
    for (const row of rows)
      for (let x = at; x < at + span; x++) expect(cells(row)[x]?.bg).toBe(P.keycapBg)
    expect(cells(rows[1])[text(rows[1]).indexOf('finder')]).toMatchObject({ fg: P.fg, bold: true })
    expect(cells(rows[0])[at - 1]?.bg).toBe(P.shelf)
  })

  it('leaves an unselected action’s word dim', () => {
    const middle = draw(HOME)[1]
    expect(cells(middle)[text(middle).indexOf('finder')]?.fg).toBe(P.dim)
  })

  it('turns Home the bright mode colour, dark words, while it is selected', () => {
    const rows = draw(HOME)
    const at = text(rows[1]).indexOf('Home')
    for (const row of rows) expect(cells(row)[at]?.bg).toBe(P.modeConvert)
    expect(cells(rows[1])[at]?.fg).toBe(P.ink)
  })

  it('gives up where the actions cannot fit, so the screen can fall back to keys', () => {
    expect(
      doneActionRows({ palette: P, mode: 'convert', actions: ACTIONS, selected: HOME, width: 60 }),
    ).toBeUndefined()
  })

  it('names Home with any word it is given', () => {
    const rows =
      doneActionRows({
        palette: P,
        mode: 'compress',
        actions: ACTIONS.slice(0, 2),
        selected: 2,
        width: W,
        home: 'Done',
      }) ?? []
    expect(text(rows[1]).endsWith('  ↵ Done  ')).toBe(true)
  })
})

const OPEN_SELECTED = 0

describe('doneActionRows, in the first-run palette', () => {
  it('still shows which action is selected where there are no greys to fill with', () => {
    const N = modePalette(NEUTRAL, 'convert')
    const rows =
      doneActionRows({ palette: N, mode: 'convert', actions: ACTIONS, selected: 1, width: W }) ?? []
    const at = text(rows[1]).indexOf('finder')
    expect(cells(rows[1])[at]?.bg).toBe(N.modeConvert)
  })
})
