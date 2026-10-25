import { describe, expect, it } from 'vitest'
import { type Row, width } from '../../src/shell/home-art.js'
import { DARK, menuPalette, modePalette } from '../../src/shell/theme.js'
import { lastNoteStart, noteCard, noteLines } from '../../src/shell/update-art.js'

const text = (row: Row) => row.map((r) => r.text).join('')
const NOTES = [
  { title: 'Watch a folder', text: 'Drop a folder on Convert and it converts what lands there.' },
  { title: 'Presets', text: 'Save what Done did.' },
]

describe('noteLines', () => {
  it('puts each name in a column as wide as the longest, its sentence beside it, a blank line between', () => {
    const { rows, items } = noteLines({ palette: DARK, notes: NOTES, width: 50 })
    expect(rows.map(text)).toEqual([
      'Watch a folder   Drop a folder on Convert and it',
      '                 converts what lands there.',
      '',
      'Presets          Save what Done did.',
    ])
    expect(items).toEqual([0, 0, 0, 1])
    expect(rows[0]?.[0]).toMatchObject({ fg: DARK.fg, bold: true })
    expect(rows[0]?.[1]).toMatchObject({ fg: DARK.dim })
  })
})

describe('lastNoteStart', () => {
  it('is the first note from which the rest fits, so a scroll ends on a whole note', () => {
    // Notes start at lines 0, 3 and 6; nine lines in all.
    const items = [0, 0, 0, 1, 1, 1, 2, 2, 2]
    expect(lastNoteStart(items, 9)).toBe(0)
    expect(lastNoteStart(items, 6)).toBe(3)
    expect(lastNoteStart(items, 4)).toBe(6)
    // A note longer than the window still gets a start.
    expect(lastNoteStart(items, 2)).toBe(6)
  })
})

describe('noteCard', () => {
  const W = 60
  const laid = (notes = NOTES) => noteLines({ palette: DARK, notes, width: W - 6 })

  it('is a grey card under a grey “what’s new” chip and the version, every row its full width', () => {
    const card = noteCard({
      palette: DARK,
      version: '0.4.0',
      laid: laid(),
      width: W,
      start: 0,
      room: 6,
      lit: false,
    })
    expect(card).toHaveLength(6 + 3)
    expect(text(card[0] as Row)).toMatch(/^ what's new {2}in 0\.4\.0 *$/)
    expect(card[0]?.[0]).toMatchObject({ bg: DARK.panelBand, fg: DARK.fg, bold: true })
    for (const row of card) {
      expect(width(row)).toBe(W)
      for (const run of row) expect(run.bg).toBeDefined()
    }
    expect(text(card[2] as Row)).toMatch(/^ {2}Watch a folder/)
    // Everything fits: no bar, no note.
    expect(card.map(text).join('\n')).not.toMatch(/[│┃]|more/)
  })

  it('is the dark grey of a frame inside the popup, whatever mode the shell is in', () => {
    // Opened from compress, the palette's band is compress's blue-green tint.
    const p = menuPalette(modePalette(DARK, 'compress'))
    expect(p.band).not.toBe(DARK.shelf)
    const card = noteCard({
      palette: p,
      version: '0.4.0',
      laid: laid(),
      width: W,
      start: 0,
      room: 6,
      lit: false,
    })
    for (const row of card.slice(1)) for (const run of row) expect(run.bg).toBe(DARK.shelf)
  })

  it('past its room, a bar on its last column and “↓ n more” for the notes wholly below', () => {
    const many = Array.from({ length: 6 }, (_, i) => ({ title: `N${i}`, text: 'One line.' }))
    const card = noteCard({
      palette: DARK,
      version: '0.4.0',
      laid: laid(many),
      width: W,
      start: 0,
      room: 5,
      lit: false,
    })
    const body = card.slice(2, 7)
    for (const row of body) expect(text(row).at(-2)).toMatch(/[│┃]/)
    // Shown: N0, N1, N2 (lines 0, 2, 4); N3, N4, N5 below.
    expect(text(card[7] as Row).trimEnd()).toMatch(/↓ 3 more$/)
    expect(text(card[7] as Row).trimEnd().length).toBe(W - 1)
  })

  it('the thumb brightens while the notes are chosen', () => {
    const many = Array.from({ length: 6 }, (_, i) => ({ title: `N${i}`, text: 'One line.' }))
    const thumb = (lit: boolean) =>
      noteCard({
        palette: DARK,
        version: '0.4.0',
        laid: laid(many),
        width: W,
        start: 0,
        room: 5,
        lit,
      })
        .flat()
        .find((r) => r.text === '┃')
    expect(thumb(false)?.fg).toBe(DARK.dim)
    expect(thumb(true)?.fg).toBe(DARK.fg)
  })

  it('at the end says nothing more: what scrolled off the top was already read', () => {
    const many = Array.from({ length: 6 }, (_, i) => ({ title: `N${i}`, text: 'One line.' }))
    const l = laid(many)
    const card = noteCard({
      palette: DARK,
      version: '0.4.0',
      laid: l,
      width: W,
      start: lastNoteStart(l.items, 5),
      room: 5,
      lit: true,
    })
    expect(card.map(text).join('\n')).not.toContain('more')
    expect(card.map(text).join('\n')).toContain('N5')
  })
})
