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
import { mix, type Row, width } from '../../src/shell/home-art.js'
import { DARK, LIGHT, modePalette, NEUTRAL } from '../../src/shell/theme.js'

const P = modePalette(DARK, 'convert')
const text = (row: Row | undefined) => (row ?? []).map((r) => r.text).join('')

/** Each cell of a row with its style, so a test can ask what is at a column. */
const cells = (row: Row | undefined) =>
  (row ?? []).flatMap((run) =>
    [...run.text].map((ch) => ({ ch, fg: run.fg, bg: run.bg, bold: run.bold ?? false })),
  )

/** A PNG converted to a smaller JPEG. */
const cv: DoneFacts = {
  mode: 'convert',
  before: { format: 'PNG', name: 'test.png', bytes: 122_000 },
  after: { format: 'JPEG', name: 'test.jpg', bytes: 74_600 },
}
/** A GIF converted to a PNG that came out larger. */
const gif: DoneFacts = {
  mode: 'convert',
  before: { format: 'GIF', name: 'party.gif', bytes: 1_100_000 },
  after: { format: 'PNG', name: 'party.png', bytes: 1_600_000 },
}

/** Rows of the body, by what they are: the strip (three), the bar (five), a gap, the sizes (two). */
const ROW = {
  stripTop: 0,
  strip: 1,
  stripBottom: 2,
  barTop: 3,
  mid: 5,
  barBottom: 7,
  gap: 8,
  words: 9,
  sizes: 10,
}

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

describe('the Done body (round 24)', () => {
  it('reads top to bottom: the strip, the bar, a blank row, then the sizes stacked', () => {
    const rows = doneBody({ palette: P, facts: cv, width: 80 })
    expect(rows).toHaveLength(11)
    expect(text(rows[ROW.strip])).toMatch(/^ {2} PNG → JPEG +47\.4 KB saved · 38\.9% smaller $/)
    expect(text(rows[ROW.gap])).toBe('')
    expect(text(rows[ROW.words])).toMatch(/^ {2}now +was$/)
    expect(text(rows[ROW.sizes])).toMatch(/^ {2}74\.6 KB +122 KB$/)
    for (const r of [ROW.strip, ROW.words, ROW.sizes]) expect(width(rows[r] ?? [])).toBe(78)
  })

  it('draws the strip on the shelf grey, with half a row of it above and below', () => {
    const rows = doneBody({ palette: P, facts: cv, width: 80 })
    const strip = cells(rows[ROW.strip])
    expect(strip).toHaveLength(78)
    expect(strip.slice(0, 2).every((c) => c.bg === undefined)).toBe(true)
    expect(strip.slice(2).every((c) => c.bg === DARK.shelf)).toBe(true)
    for (const [r, ch] of [
      [ROW.stripTop, '▄'],
      [ROW.stripBottom, '▀'],
    ] as const) {
      const half = cells(rows[r])
      expect(half).toHaveLength(78)
      for (const c of half.slice(2)) expect(c).toMatchObject({ ch, fg: DARK.shelf, bg: undefined })
    }
  })

  it('writes the formats quiet up to the new one, white and bold, and the change in green', () => {
    const strip = cells(doneBody({ palette: P, facts: cv, width: 80 })[ROW.strip])
    expect(strip[3]).toMatchObject({ ch: 'P', fg: DARK.dim, bold: false })
    expect(strip[7]).toMatchObject({ ch: '→', fg: DARK.border })
    expect(strip[9]).toMatchObject({ ch: 'J', fg: DARK.fg, bold: true })
    const at = 78 - ' 47.4 KB saved · 38.9% smaller '.length + 1
    expect(strip[at]).toMatchObject({ ch: '4', fg: DARK.ok, bold: true, bg: DARK.shelf })
  })

  it('says the format once when it did not change, white and bold', () => {
    const same: DoneFacts = { ...cv, after: { ...cv.after, format: 'PNG', name: 'test.png' } }
    const strip = doneBody({ palette: P, facts: same, width: 80 })[ROW.strip]
    expect(text(strip)).toMatch(/^ {3}PNG {2,}\S/)
    expect(text(strip)).not.toContain('→')
    expect(cells(strip)[3]).toMatchObject({ ch: 'P', fg: DARK.fg, bold: true })
  })

  it('writes every step of a chain, the last one leading', () => {
    const rows = doneBody({ palette: P, facts: cv, width: 80, chain: ['PNG', 'JPEG', 'WebP'] })
    expect(text(rows[ROW.strip])).toMatch(/^ {3}PNG → JPEG → WebP +47\.4 KB/)
    const strip = cells(rows[ROW.strip])
    expect(strip[9]).toMatchObject({ ch: 'J', fg: DARK.dim, bold: false })
    expect(strip[16]).toMatchObject({ ch: 'W', fg: DARK.fg, bold: true })
  })

  it('is a bar five rows tall as long as the larger file: the new file on the mode’s band, the rest hatched grey', () => {
    const rows = doneBody({ palette: P, facts: cv, width: 80 })
    const band = mix(DARK.modeConvert, DARK.canvas, 0.5)
    const hatch = mix(DARK.border, DARK.canvas, 0.55)
    // 76 cells for 122 KB; 74.6 KB is round(76 × 74.6 / 122) = 46.
    for (const r of [ROW.barTop, ROW.barTop + 1, ROW.barBottom - 1, ROW.barBottom]) {
      const row = cells(rows[r])
      expect(row).toHaveLength(78)
      expect(row.slice(2, 48).every((c) => c.bg === band)).toBe(true)
      for (const c of row.slice(48)) expect(c).toMatchObject({ ch: '╱', fg: hatch, bg: undefined })
    }
  })

  it('takes each mode’s own colour for the band', () => {
    const p = modePalette(DARK, 'compress')
    const row = cells(
      doneBody({ palette: p, facts: { ...cv, mode: 'compress' }, width: 80 })[ROW.barTop],
    )
    expect(row[2]?.bg).toBe(mix(DARK.modeCompress, DARK.canvas, 0.5))
  })

  it('scales to the terminal: the bar is the width less its margins', () => {
    const rows = doneBody({ palette: P, facts: cv, width: 120 })
    const band = mix(DARK.modeConvert, DARK.canvas, 0.5)
    expect(cells(rows[ROW.barTop])).toHaveLength(118)
    expect(cells(rows[ROW.barTop]).filter((c) => c.bg === band)).toHaveLength(
      Math.round((116 * 74.6) / 122),
    )
  })

  it('names the new file on the bar’s middle row, a cell clear of the hatching, and nothing else', () => {
    const mid = doneBody({ palette: P, facts: cv, width: 80 })[ROW.mid]
    // The band is wider than the name here, so the band runs on past it.
    expect(text(mid)).toMatch(/^ {3}✓ test\.jpg +╱+$/)
    expect(cells(mid)[5]).toMatchObject({
      ch: 't',
      fg: DARK.fg,
      bold: true,
      bg: mix(DARK.modeConvert, DARK.canvas, 0.5),
    })
  })

  it('keeps the scale honest when the new file is too small for its name: the name runs on', () => {
    // 2.4 MB to 80 KB: the band is round(76 × 0.08 / 2.4) = 3 cells.
    const tiny: DoneFacts = {
      mode: 'compress',
      before: { format: 'JPEG', name: 'photo.jpg', bytes: 2_400_000 },
      after: { format: 'JPEG', name: 'photo.jpg', bytes: 80_000 },
    }
    const p = modePalette(DARK, 'compress')
    const band = mix(DARK.modeCompress, DARK.canvas, 0.5)
    const rows = doneBody({ palette: p, facts: tiny, width: 80 })
    for (const r of [ROW.barTop, ROW.mid, ROW.barBottom]) {
      expect(cells(rows[r]).filter((c) => c.bg === band)).toHaveLength(3)
      expect(width(rows[r] ?? [])).toBe(78)
    }
    expect(text(rows[ROW.mid])).toMatch(/^ {3}✓ photo\.jpg ╱+$/)
    expect(text(rows[ROW.strip])).toContain('2.3 MB saved · 96.7% smaller')
  })

  it('draws a file that grew as the band to the old length and the growth a fill, the change in orange', () => {
    const rows = doneBody({ palette: P, facts: gif, width: 80 })
    const band = mix(DARK.modeConvert, DARK.canvas, 0.5)
    // 1.1 MB of 1.6 MB is round(76 × 1.1 / 1.6) = 52 cells.
    for (const r of [ROW.barTop, ROW.mid, ROW.barBottom]) {
      const row = cells(rows[r])
      expect(row).toHaveLength(78)
      expect(row.slice(2, 54).every((c) => c.bg === band)).toBe(true)
      expect(row.slice(54).every((c) => c.bg === DARK.grownFill)).toBe(true)
      expect(text(rows[r])).not.toContain('╱')
    }
    expect(text(rows[ROW.strip])).toMatch(/ \+500 KB · 45\.5% larger $/)
    expect(cells(rows[ROW.strip]).at(-2)).toMatchObject({
      fg: DARK.larger,
      bold: true,
      bg: DARK.shelf,
    })
  })

  it('stacks the sizes, the word quiet over the size, the smaller file on the left', () => {
    const shrank = doneBody({ palette: P, facts: cv, width: 80 })
    expect(cells(shrank[ROW.words])[2]).toMatchObject({ ch: 'n', fg: DARK.dim })
    expect(cells(shrank[ROW.words]).at(-1)).toMatchObject({ ch: 's', fg: DARK.border })
    expect(cells(shrank[ROW.sizes])[2]).toMatchObject({ ch: '7', fg: DARK.ok, bold: true })
    expect(cells(shrank[ROW.sizes]).at(-1)).toMatchObject({ ch: 'B', fg: DARK.fg, bold: true })
    // A file that grew: was on the left, now on the right, in orange.
    const grew = doneBody({ palette: P, facts: gif, width: 80 })
    expect(text(grew[ROW.words])).toMatch(/^ {2}was +now$/)
    expect(text(grew[ROW.sizes])).toMatch(/^ {2}1\.1 MB +1\.6 MB$/)
    expect(cells(grew[ROW.sizes]).at(-1)).toMatchObject({ ch: 'B', fg: DARK.larger, bold: true })
    expect(cells(grew[ROW.sizes])[2]).toMatchObject({ ch: '1', fg: DARK.fg, bold: true })
  })

  it('gives a narrow strip to the formats first: the change shortens, then goes', () => {
    const at = (w: number) => text(doneBody({ palette: P, facts: cv, width: w })[ROW.strip])
    expect(at(80)).toContain('47.4 KB saved · 38.9% smaller')
    expect(at(44)).toMatch(/PNG → JPEG .* 38\.9% smaller $/)
    expect(at(44)).not.toContain('saved')
    expect(at(24)).toContain('PNG → JPEG')
    expect(at(24)).not.toContain('%')
  })

  it('steps back when asked to make room: a three-row bar, no half rows, no gap — six rows, as before', () => {
    const rows = doneBody({ palette: P, facts: cv, width: 80, compact: true })
    expect(rows).toHaveLength(6)
    expect(text(rows[0])).toMatch(/^ {2} PNG → JPEG +47\.4 KB saved · 38\.9% smaller $/)
    expect(text(rows[2])).toMatch(/^ {3}✓ test\.jpg +╱+$/)
    expect(text(rows[4])).toMatch(/^ {2}now +was$/)
    expect(text(rows[5])).toMatch(/^ {2}74\.6 KB +122 KB$/)
  })

  it('names the folder under the sizes when asked to, for the scrollback', () => {
    const rows = doneBody({ palette: P, facts: cv, width: 80, folder: '~/d/nonexistent/out' })
    expect(rows).toHaveLength(13)
    expect(text(rows[11])).toBe('')
    expect(text(rows[12])).toBe('   in ~/d/nonexistent/out')
    expect(doneBody({ palette: P, facts: cv, width: 80 })).toHaveLength(11)
  })

  it('draws the same size as one full band, saying so quietly', () => {
    const same: DoneFacts = { ...cv, after: { ...cv.after, bytes: 122_000 } }
    const rows = doneBody({ palette: P, facts: same, width: 80 })
    const band = mix(DARK.modeConvert, DARK.canvas, 0.5)
    expect(text(rows[ROW.mid])).not.toContain('╱')
    expect(cells(rows[ROW.barTop]).filter((c) => c.bg === band)).toHaveLength(76)
    expect(text(rows[ROW.strip])).toMatch(/same size $/)
    expect(cells(rows[ROW.strip]).at(-2)).toMatchObject({ fg: DARK.dim, bold: false })
  })

  it('tints the growth’s fill: the outcome’s colour stepped back towards the background', () => {
    for (const p of [DARK, LIGHT]) {
      expect(p.shedHatch).toBe(mix(p.canvas, p.ok, 0.5))
      expect(p.grownFill).toBe(mix(p.canvas, p.larger, 0.16))
    }
  })

  it('cuts long names from the middle so no row passes the block', () => {
    const long = 'Screenshot 2026-08-17 at 3.52.36 PM with an absurdly long suffix'
    const facts: DoneFacts = {
      mode: 'convert',
      before: { format: 'PNG', name: `${long}.png`, bytes: 122_000 },
      after: { format: 'JPEG', name: `${long}.jpg`, bytes: 74_600 },
    }
    for (const w of [40, 60]) {
      const rows = doneBody({ palette: P, facts, width: w })
      for (const row of rows) expect(width(row)).toBeLessThanOrEqual(w - 2)
      expect(text(rows[ROW.mid])).toContain('…')
    }
    // With the change out of the bar, the bar's whole width is the name's.
    expect(text(doneBody({ palette: P, facts, width: 80 })[ROW.mid])).toContain(`${long}.jpg`)
  })

  it('draws without fills where there are none, the words and the shape still in place', () => {
    const rows = doneBody({ palette: NEUTRAL, facts: gif, width: 80 })
    for (const row of rows) for (const run of row) expect(run.bg ?? '').toBe('')
    expect(text(rows[ROW.strip])).toContain('GIF → PNG')
    expect(text(rows[ROW.mid])).toContain('✓ party.png')
    // Without a fill to draw the growth in, it is drawn in shade.
    expect(text(rows[ROW.barTop])).toMatch(/▒+$/)
    // No shelf to draw half rows in: they are blank.
    expect(text(rows[ROW.stripTop])).toBe('')
    expect(text(rows[ROW.stripBottom])).toBe('')
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
    // 24 rows: the bar and a blank; the rule and the keys; 18 rows between,
    // less a row of margin either side. The body is six rows.
    expect(doneLayout({ height: 24, body: 6, notes: 0 })).toEqual({
      top: 5,
      between: 0,
      bottom: 9,
    })
  })

  it('ends the notes four rows above the keys, at least a row under the body', () => {
    expect(doneLayout({ height: 24, body: 6, notes: 1 })).toEqual({ top: 5, between: 5, bottom: 3 })
    expect(doneLayout({ height: 24, body: 6, notes: 2 })).toEqual({ top: 5, between: 4, bottom: 3 })
    expect(doneLayout({ height: 24, body: 6, notes: 4 })).toEqual({ top: 5, between: 2, bottom: 3 })
    // A short screen gives up the rows above the body first.
    expect(doneLayout({ height: 18, body: 6, notes: 4 })).toEqual({ top: 0, between: 1, bottom: 3 })
  })

  it('always adds up to the height, giving up blank rows before anything else', () => {
    for (let height = 10; height <= 40; height++) {
      for (const notes of [0, 1, 3]) {
        const { top, between, bottom } = doneLayout({ height, body: 6, notes })
        for (const n of [top, between, bottom]) expect(n).toBeGreaterThanOrEqual(0)
        // The bar and a blank, the body and notes, the rule and the keys.
        const total = 2 + top + 6 + between + notes + bottom + 2
        expect(total).toBe(Math.max(height, 2 + 6 + (notes ? 1 + notes : 0) + 2))
        if (notes) expect(between).toBeGreaterThanOrEqual(1)
      }
    }
  })
})

describe('the Done bar drawing itself once (M5a)', () => {
  const at = (facts: DoneFacts, bar: number, label: number) =>
    doneBody({ palette: P, facts, width: 80, draw: { bar, label } })
  const band = mix(DARK.modeConvert, DARK.canvas, 0.5)

  it('starts a smaller file’s band at the old length and pulls it back to the new one', () => {
    // 46 of 76 cells at rest; at the start, all 76 are band.
    const start = cells(at(cv, 0, 0)[ROW.barTop])
    expect(start.slice(2).every((c) => c.bg === band)).toBe(true)
    const half = cells(at(cv, 0.5, 0)[ROW.barTop])
    const n = half.slice(2).filter((c) => c.bg === band).length
    expect(n).toBe(61)
    expect(half.slice(2 + n).every((c) => c.ch === '╱')).toBe(true)
  })

  it('pushes a larger file’s growth out from the old length into its fill', () => {
    // 52 cells of band at every step; the 24 of growth arrive left to right.
    const start = cells(at(gif, 0, 0)[ROW.barTop])
    expect(start.slice(2, 54).every((c) => c.bg === band)).toBe(true)
    expect(start.slice(54).every((c) => c.bg === undefined && c.ch === ' ')).toBe(true)
    const half = cells(at(gif, 0.5, 0)[ROW.barTop])
    expect(half.slice(54, 66).every((c) => c.bg === DARK.grownFill)).toBe(true)
    expect(half.slice(66).every((c) => c.bg === undefined)).toBe(true)
  })

  it('names the new file throughout, and writes the change only as it settles', () => {
    expect(text(at(cv, 0, 0)[ROW.mid])).toContain('✓ test.jpg')
    expect(text(at(cv, 1, 0)[ROW.strip])).not.toContain('smaller')
    // Fading in, the change comes up out of the strip's grey.
    const fading = cells(at(cv, 1, 0.5)[ROW.strip]).at(-2)
    expect(fading?.fg).toBe(mix(DARK.shelf, DARK.ok, 0.5))
  })

  it('is the resting bar once both are done', () => {
    expect(at(cv, 1, 1)).toEqual(doneBody({ palette: P, facts: cv, width: 80 }))
    expect(at(gif, 1, 1)).toEqual(doneBody({ palette: P, facts: gif, width: 80 }))
  })
})
