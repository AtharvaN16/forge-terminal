import stringWidth from 'string-width'
import { describe, expect, it } from 'vitest'
import {
  changePhrase,
  type DoneFacts,
  doneBody,
  doneLayout,
  doneNotes,
  receiptBars,
  wrapWords,
} from '../../src/shell/done-art.js'
import { type Row, width } from '../../src/shell/home-art.js'
import { DARK, LIGHT, modePalette, NEUTRAL } from '../../src/shell/theme.js'

const P = modePalette(DARK, 'convert')
const text = (row: Row | undefined) => (row ?? []).map((r) => r.text).join('')

/** Each cell of a row with its style, so a test can ask what is at a column. */
const cells = (row: Row | undefined) =>
  (row ?? []).flatMap((run) =>
    [...run.text].map((ch) => ({ ch, fg: run.fg, bg: run.bg, bold: run.bold ?? false })),
  )

/** The page's first sample: a PNG converted to a smaller JPEG. */
const cv: DoneFacts = {
  mode: 'convert',
  before: { format: 'PNG', name: 'test.png', bytes: 122_000 },
  after: { name: 'test.jpg', bytes: 74_600 },
  folder: '~/Desktop',
}
/** The third: a GIF converted to a PNG that came out larger. */
const gif: DoneFacts = {
  mode: 'convert',
  before: { format: 'GIF', name: 'party.gif', bytes: 1_100_000 },
  after: { name: 'party.png', bytes: 1_600_000 },
  folder: '~/Desktop',
}

/** Rows of the body, by what they are. */
const ROW = { beforeTab: 0, beforeTop: 1, beforeMid: 2, arrow: 4, head: 5, afterTab: 6 }
const AFTER = { top: 7, mid: 8, bottom: 9 }
const CHANGE = 10
const FOLDER = 12

describe('receiptBars', () => {
  it('gives the larger side every cell and scales the other', () => {
    expect(receiptBars(122_449, 76_390, 24)).toEqual({ before: 24, after: 15, grew: false })
    expect(receiptBars(100, 400, 24)).toEqual({ before: 6, after: 24, grew: true })
    expect(receiptBars(500, 500, 24)).toEqual({ before: 24, after: 24, grew: false })
  })
  it('never draws an empty bar for a non-zero size', () => {
    expect(receiptBars(10_000_000, 1, 24).after).toBe(1)
  })
  it('survives zero bytes on either side', () => {
    expect(receiptBars(0, 0, 24)).toEqual({ before: 24, after: 24, grew: false })
    expect(receiptBars(100, 0, 24)).toEqual({ before: 24, after: 0, grew: false })
  })
})

describe('wrapWords', () => {
  it('wraps on spaces and never exceeds the width', () => {
    expect(wrapWords('one two three four five six seven', 10)).toEqual([
      'one two',
      'three four',
      'five six',
      'seven',
    ])
  })
  it('hard-breaks a word longer than the width', () => {
    expect(wrapWords('abcdefghijkl', 5)).toEqual(['abcde', 'fghij', 'kl'])
  })
  it('breaks a word by columns, not characters: a wide (CJK) word is never wider than the line', () => {
    const lines = wrapWords('海辺の夕日二〇二六年.jpg', 10)
    expect(lines).toEqual(['海辺の夕日', '二〇二六年', '.jpg'])
    for (const line of lines) expect(stringWidth(line)).toBeLessThanOrEqual(10)
    // A line one column short of a wide character cannot take it.
    expect(wrapWords('海海海', 5)).toEqual(['海海', '海'])
  })
})

describe('changePhrase', () => {
  it('says how much smaller or larger, or that nothing changed', () => {
    expect(changePhrase(122_449, 76_390)).toBe('37.6% smaller')
    expect(changePhrase(100, 150)).toBe('50% larger')
    expect(changePhrase(100, 100)).toBe('same size')
  })
})

describe('the Done body (K3·a)', () => {
  it('reads top to bottom: before tab, panel, arrow, after tab, panel, change, folder', () => {
    const rows = doneBody({ palette: P, facts: cv, width: 80 })
    expect(rows).toHaveLength(13)
    expect(text(rows[ROW.beforeTab])).toBe('   before ')
    expect(text(rows[ROW.beforeMid])).toMatch(/^ {3}PNG {3}test\.png +122 KB $/)
    expect(text(rows[ROW.arrow])).toBe('    │')
    expect(text(rows[ROW.head])).toBe('    ▼')
    expect(text(rows[ROW.afterTab])).toBe('   after ')
    expect(text(rows[AFTER.mid])).toMatch(/^ {3}✓ test\.jpg +74\.6 KB ╱+$/)
    expect(text(rows[CHANGE]).trim()).toBe('38.9% smaller')
    expect(text(rows[11])).toBe('')
    expect(text(rows[FOLDER])).toBe('   in ~/Desktop')
  })

  it('measures both panels on one scale, the larger filling the block', () => {
    const rows = doneBody({ palette: P, facts: cv, width: 80 })
    // 76 cells for 122 KB; 74.6 KB is round(76 × 74.6 / 122) = 46.
    const top = cells(rows[ROW.beforeTop])
    expect(top.filter((c) => c.bg === DARK.selectionBg)).toHaveLength(76)
    const after = cells(rows[AFTER.top])
    expect(after.filter((c) => c.bg === DARK.panelBand)).toHaveLength(46)
    expect(width(rows[ROW.beforeTop] ?? [])).toBe(78)
  })

  it('scales to the terminal: the block is the width less its margins', () => {
    const rows = doneBody({ palette: P, facts: cv, width: 120 })
    expect(cells(rows[ROW.beforeTop]).filter((c) => c.bg === DARK.selectionBg)).toHaveLength(116)
  })

  it('hatches what a smaller file shed in faint, its size just past its panel', () => {
    const rows = doneBody({ palette: P, facts: cv, width: 80 })
    const mid = cells(rows[AFTER.mid])
    // The panel runs from column 2 for 46 cells; the size follows one cell on.
    expect(mid[49]).toMatchObject({ ch: '7', fg: DARK.fg, bold: true, bg: undefined })
    expect(text(rows[AFTER.mid]).slice(48, 57)).toBe(' 74.6 KB ')
    for (const r of [AFTER.top, AFTER.mid, AFTER.bottom]) {
      const row = cells(rows[r])
      expect(row).toHaveLength(78)
      expect(row.at(-1)).toMatchObject({ ch: '╱', fg: DARK.faint })
    }
    expect(cells(rows[AFTER.top])[48]).toMatchObject({ ch: '╱', fg: DARK.faint })
  })

  it('draws a file that grew as long as the old one, the growth in orange hatching', () => {
    const rows = doneBody({ palette: P, facts: gif, width: 80 })
    // 1.1 MB of 1.6 MB is round(76 × 1.1 / 1.6) = 52 cells.
    expect(cells(rows[ROW.beforeTop]).filter((c) => c.bg === DARK.selectionBg)).toHaveLength(52)
    for (const r of [AFTER.top, AFTER.mid, AFTER.bottom]) {
      const row = cells(rows[r])
      expect(row.filter((c) => c.bg === DARK.panelBand)).toHaveLength(52)
      expect(row.slice(54)).toHaveLength(24)
      for (const c of row.slice(54)) expect(c).toMatchObject({ ch: '╱', fg: DARK.grownHatch })
    }
    // The size sits inside the panel, right-aligned with a cell to spare.
    expect(text(rows[AFTER.mid]).slice(0, 54)).toMatch(/ 1\.6 MB $/)
    expect(cells(rows[AFTER.mid])[47]).toMatchObject({ ch: '1', fg: DARK.fg, bold: true })
  })

  it('mixes the orange into the background at 80% for the growth hatching', () => {
    expect(DARK.grownHatch).toBe('#c88041')
    expect(LIGHT.grownHatch).toBe('#b07933')
    expect(NEUTRAL.grownHatch).toBe(NEUTRAL.larger)
  })

  it('puts the change under the after panel, ending where the longer panel ends', () => {
    const shed = cells(doneBody({ palette: P, facts: cv, width: 80 })[CHANGE])
    expect(shed).toHaveLength(78)
    expect(shed.at(-1)).toMatchObject({ ch: 'r', fg: DARK.ok, bold: true })
    const grew = doneBody({ palette: P, facts: gif, width: 80 })[CHANGE]
    expect(text(grew)).toMatch(/45\.5% larger$/)
    expect(cells(grew).at(-1)).toMatchObject({ fg: DARK.larger, bold: true })
    expect(width(grew ?? [])).toBe(78)
  })

  it('points from before to after in the mode colour', () => {
    for (const mode of ['convert', 'compress', 'pdf'] as const) {
      const p = modePalette(DARK, mode)
      const rows = doneBody({ palette: p, facts: { ...cv, mode }, width: 80 })
      const colour = { convert: DARK.modeConvert, compress: DARK.modeCompress, pdf: DARK.modePdf }[
        mode
      ]
      expect(cells(rows[ROW.arrow])[4]).toMatchObject({ ch: '│', fg: colour, bold: false })
      expect(cells(rows[ROW.head])[4]).toMatchObject({ ch: '▼', fg: colour, bold: true })
    }
  })

  it('draws the tabs in their panels’ fills: before quiet, after bold', () => {
    const rows = doneBody({ palette: P, facts: cv, width: 80 })
    expect(cells(rows[ROW.beforeTab])[3]).toMatchObject({
      ch: 'b',
      fg: DARK.dim,
      bg: DARK.selectionBg,
      bold: false,
    })
    expect(cells(rows[ROW.afterTab])[3]).toMatchObject({
      ch: 'a',
      fg: DARK.fg,
      bg: DARK.panelBand,
      bold: true,
    })
  })

  it('keeps the scale honest when a panel is too short for its words', () => {
    // 2.4 MB to 80 KB: the after panel is round(76 × 0.08 / 2.4) = 3 cells.
    const tiny: DoneFacts = {
      mode: 'compress',
      before: { format: 'JPEG', name: 'photo.jpg', bytes: 2_400_000 },
      after: { name: 'photo.jpg', bytes: 80_000 },
      folder: '~/Desktop',
    }
    const rows = doneBody({ palette: modePalette(DARK, 'compress'), facts: tiny, width: 80 })
    for (const r of [AFTER.top, AFTER.mid, AFTER.bottom]) {
      expect(cells(rows[r]).filter((c) => c.bg === DARK.panelBand)).toHaveLength(3)
      expect(width(rows[r] ?? [])).toBe(78)
    }
    // The words run on past the fill; the hatching starts after the size.
    expect(text(rows[AFTER.mid])).toMatch(/^ {3}✓ photo\.jpg 80 KB ╱+$/)
    expect(text(rows[AFTER.top])).toMatch(/^ {5}╱{73}$/)
  })

  it('keeps the words of a short before panel too, the fill still true', () => {
    const big: DoneFacts = {
      mode: 'convert',
      before: { format: 'JPEG', name: 'photo.jpg', bytes: 50_000 },
      after: { name: 'photo.png', bytes: 2_000_000 },
      folder: '~/Desktop',
    }
    const rows = doneBody({ palette: P, facts: big, width: 80 })
    expect(cells(rows[ROW.beforeMid]).filter((c) => c.bg === DARK.selectionBg)).toHaveLength(2)
    expect(text(rows[ROW.beforeMid])).toMatch(/^ {3}JPEG {3}photo\.jpg 50 KB $/)
  })

  it('draws the same size without hatching, the size inside the panel', () => {
    const same: DoneFacts = { ...cv, after: { name: 'test.jpg', bytes: 122_000 } }
    const rows = doneBody({ palette: P, facts: same, width: 80 })
    expect(text(rows[AFTER.mid])).not.toContain('╱')
    expect(text(rows[AFTER.mid])).toMatch(/122 KB $/)
    expect(width(rows[AFTER.mid] ?? [])).toBe(78)
    expect(text(rows[CHANGE]).trim()).toBe('same size')
  })

  it('never puts the size past the block when the file barely shrank', () => {
    const close: DoneFacts = { ...cv, after: { name: 'test.jpg', bytes: 120_000 } }
    const rows = doneBody({ palette: P, facts: close, width: 80 })
    for (const row of rows) expect(width(row)).toBeLessThanOrEqual(78)
    expect(text(rows[AFTER.mid])).toContain('120 KB')
  })

  it('cuts long names from the middle so no row passes the block', () => {
    const long = 'Screenshot 2026-08-17 at 3.52.36 PM with an absurdly long suffix'
    const facts: DoneFacts = {
      mode: 'convert',
      before: { format: 'PNG', name: `${long}.png`, bytes: 122_000 },
      after: { name: `${long}.jpg`, bytes: 74_600 },
      folder: '~/Pictures/some/very/deep/folder/that/goes/on/and/on/and/on/for/a/while/longer',
    }
    for (const w of [40, 60, 80]) {
      const rows = doneBody({ palette: P, facts, width: w })
      for (const row of rows) expect(width(row)).toBeLessThanOrEqual(w - 2)
      expect(text(rows[ROW.beforeMid])).toContain('…')
      expect(text(rows[FOLDER])).toContain('…')
    }
  })

  it('draws without fills where there are none, the words still in place', () => {
    const rows = doneBody({ palette: NEUTRAL, facts: cv, width: 80 })
    for (const row of rows) for (const run of row) expect(run.bg ?? '').toBe('')
    expect(text(rows[AFTER.mid])).toContain('✓ test.jpg')
  })
})

describe('the Done notes', () => {
  it('puts offers first, then warnings word-wrapped, three cells in', () => {
    const rows = doneNotes({
      palette: P,
      offers: ['✧ WebP would be 590 KB, 27% smaller again.'],
      warnings: [
        'party.gif has 12 frames, and PNG cannot animate. Only the first frame was converted.',
      ],
      width: 80,
    })
    expect(rows.map(text)).toEqual([
      '   ✧ WebP would be 590 KB, 27% smaller again.',
      '   ⚠ party.gif has 12 frames, and PNG cannot animate. Only the first frame',
      '   was converted.',
    ])
    expect(rows[0]?.[1]).toMatchObject({ fg: P.accent })
    expect(rows[1]?.[1]).toMatchObject({ fg: DARK.warn })
  })
})

describe('the Done layout', () => {
  it('sits the body a row above the middle of the space between bar and keys', () => {
    // 24 rows: the bar, a blank, then 19 rows the body is centred in.
    expect(doneLayout({ height: 24, body: 13, notes: 0 })).toEqual({
      top: 2,
      between: 0,
      bottom: 6,
    })
  })

  it('ends the notes four rows above the keys, at least a row under the body', () => {
    expect(doneLayout({ height: 24, body: 13, notes: 1 })).toEqual({
      top: 2,
      between: 2,
      bottom: 3,
    })
    expect(doneLayout({ height: 24, body: 13, notes: 2 })).toEqual({
      top: 2,
      between: 1,
      bottom: 3,
    })
    expect(doneLayout({ height: 24, body: 13, notes: 4 })).toEqual({
      top: 0,
      between: 1,
      bottom: 3,
    })
  })

  it('always adds up to the height, giving up blank rows before anything else', () => {
    for (let height = 12; height <= 40; height++) {
      for (const notes of [0, 1, 3]) {
        const { top, between, bottom } = doneLayout({ height, body: 13, notes })
        for (const n of [top, between, bottom]) expect(n).toBeGreaterThanOrEqual(0)
        const total = 2 + top + 13 + between + notes + bottom + 1
        expect(total).toBe(Math.max(height, 2 + 13 + (notes ? 1 + notes : 0) + 1))
        if (notes) expect(between).toBeGreaterThanOrEqual(1)
      }
    }
  })
})
