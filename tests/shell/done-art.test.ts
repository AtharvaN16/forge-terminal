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

/** Rows of the body, by what they are. */
const ROW = { chip: 0, top: 1, mid: 2, bottom: 3, gap: 4, sizes: 5 }

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

describe('the Done body (B6a)', () => {
  it('reads top to bottom: the formats, one bar, a blank row, then was and now', () => {
    const rows = doneBody({ palette: P, facts: cv, width: 80 })
    expect(rows).toHaveLength(6)
    expect(text(rows[ROW.chip])).toBe('   PNG → JPEG ')
    expect(text(rows[ROW.gap])).toBe('')
    expect(text(rows[ROW.sizes])).toMatch(/^ {3}now {2}74\.6 KB +was {2}122 KB $/)
    expect(width(rows[ROW.sizes] ?? [])).toBe(78)
  })

  it('draws each size as a badge (N6): the word on the key grey, the new size on a green tint', () => {
    const row = cells(doneBody({ palette: P, facts: cv, width: 80 })[ROW.sizes])
    const word = row.slice(2, 7)
    expect(word.map((c) => c.ch).join('')).toBe(' now ')
    expect(word.every((c) => c.bg === DARK.keycapBg)).toBe(true)
    const size = row.slice(7, 7 + ' 74.6 KB '.length)
    expect(size.map((c) => c.ch).join('')).toBe(' 74.6 KB ')
    expect(size.every((c) => c.bg === mix(DARK.ok, DARK.canvas, 0.8))).toBe(true)
    expect(size[1]).toMatchObject({ fg: DARK.ok, bold: true })
    expect(row[1]?.bg).toBeUndefined()
    // The old size: the same shape, quieter — the word on the key grey, the size on the bar's grey.
    expect(row.at(-2)).toMatchObject({ ch: 'B', fg: DARK.dim, bg: DARK.panelBand })
  })

  it('draws the formats on a chip of the mode’s tint, in its colour', () => {
    const chip = cells(doneBody({ palette: P, facts: cv, width: 80 })[ROW.chip])[3]
    expect(chip).toMatchObject({
      ch: 'P',
      fg: DARK.modeConvert,
      bg: DARK.modeConvertBg,
      bold: true,
    })
  })

  it('says the format once when it did not change', () => {
    const same: DoneFacts = { ...cv, after: { ...cv.after, format: 'PNG', name: 'test.png' } }
    expect(text(doneBody({ palette: P, facts: same, width: 80 })[ROW.chip])).toBe('   PNG ')
  })

  it('is one bar as long as the larger file: the new file on the band, what went away hatched', () => {
    const rows = doneBody({ palette: P, facts: cv, width: 80 })
    // 76 cells for 122 KB; 74.6 KB is round(76 × 74.6 / 122) = 46.
    for (const r of [ROW.top, ROW.bottom]) {
      const row = cells(rows[r])
      expect(row).toHaveLength(78)
      expect(row.slice(2, 48).every((c) => c.bg === DARK.panelBand)).toBe(true)
      for (const c of row.slice(48))
        expect(c).toMatchObject({ ch: '╱', fg: DARK.shedHatch, bg: undefined })
    }
  })

  it('scales to the terminal: the bar is the width less its margins', () => {
    const rows = doneBody({ palette: P, facts: cv, width: 120 })
    expect(cells(rows[ROW.top])).toHaveLength(118)
    expect(cells(rows[ROW.top]).filter((c) => c.bg === DARK.panelBand)).toHaveLength(
      Math.round((116 * 74.6) / 122),
    )
  })

  it('says what changed inside the hatching, knocked out of it and flush to the bar’s end', () => {
    const mid = doneBody({ palette: P, facts: cv, width: 80 })[ROW.mid]
    expect(text(mid)).toMatch(/ 47\.4 KB saved · 38\.9% smaller$/)
    const row = cells(mid)
    expect(row).toHaveLength(78)
    expect(row.at(-1)).toMatchObject({ ch: 'r', fg: DARK.ok, bold: true, bg: undefined })
    // Where the label is narrower than the hatching, hatching runs up to it.
    const wide = cells(doneBody({ palette: P, facts: cv, width: 120 })[ROW.mid])
    const at = wide.length - ' 47.4 KB saved · 38.9% smaller'.length
    expect(wide[at - 1]).toMatchObject({ ch: '╱', fg: DARK.shedHatch })
    expect(wide[at]).toMatchObject({ ch: ' ', bg: undefined })
  })

  it('names the new file on the band, a cell clear of the hatching', () => {
    const mid = text(doneBody({ palette: P, facts: cv, width: 80 })[ROW.mid])
    expect(mid).toMatch(/^ {3}✓ test\.jpg {2,}/)
    expect(cells(doneBody({ palette: P, facts: cv, width: 80 })[ROW.mid])[5]).toMatchObject({
      ch: 't',
      fg: DARK.fg,
      bold: true,
      bg: DARK.panelBand,
    })
  })

  it('keeps the scale honest when the new file is too small for its name: the name runs on', () => {
    // 2.4 MB to 80 KB: the band is round(76 × 0.08 / 2.4) = 3 cells.
    const tiny: DoneFacts = {
      mode: 'compress',
      before: { format: 'JPEG', name: 'photo.jpg', bytes: 2_400_000 },
      after: { format: 'JPEG', name: 'photo.jpg', bytes: 80_000 },
    }
    const rows = doneBody({ palette: modePalette(DARK, 'compress'), facts: tiny, width: 80 })
    for (const r of [ROW.top, ROW.mid, ROW.bottom]) {
      expect(cells(rows[r]).filter((c) => c.bg === DARK.panelBand)).toHaveLength(3)
      expect(width(rows[r] ?? [])).toBe(78)
    }
    expect(text(rows[ROW.mid])).toMatch(/^ {3}✓ photo\.jpg ╱+ 2\.3 MB saved · 96\.7% smaller$/)
  })

  it('draws a file that grew as one bar its new length: the old length on the band, the growth a fill', () => {
    const rows = doneBody({ palette: P, facts: gif, width: 80 })
    // 1.1 MB of 1.6 MB is round(76 × 1.1 / 1.6) = 52 cells.
    for (const r of [ROW.top, ROW.mid, ROW.bottom]) {
      const row = cells(rows[r])
      expect(row).toHaveLength(78)
      expect(row.slice(2, 54).every((c) => c.bg === DARK.panelBand)).toBe(true)
      expect(row.slice(54).every((c) => c.bg === DARK.grownFill)).toBe(true)
      expect(text(rows[r])).not.toContain('╱')
    }
    expect(text(rows[ROW.mid])).toMatch(/ \+500 KB · 45\.5% larger$/)
    expect(cells(rows[ROW.mid]).at(-1)).toMatchObject({
      fg: DARK.larger,
      bold: true,
      bg: DARK.grownFill,
    })
  })

  it('puts the smaller size on the left: was then now for a file that grew', () => {
    const sizes = doneBody({ palette: P, facts: gif, width: 80 })[ROW.sizes]
    expect(text(sizes)).toMatch(/^ {3}was {2}1\.1 MB +now {2}1\.6 MB $/)
    expect(width(sizes ?? [])).toBe(78)
    const row = cells(sizes)
    // The new size on an orange tint: the file grew.
    const tint = mix(DARK.larger, DARK.canvas, 0.8)
    expect(row.at(-2)).toMatchObject({ ch: 'B', fg: DARK.larger, bold: true, bg: tint })
    expect(row.at(-1)).toMatchObject({ ch: ' ', bg: tint })
    expect(row[8]).toMatchObject({ ch: '1', fg: DARK.dim, bold: false })
  })

  it('gives a narrow bar to the name first: the change shortens, then goes', () => {
    const at = (w: number) => text(doneBody({ palette: P, facts: cv, width: w })[ROW.mid])
    // Room for both: the whole change.
    expect(at(80)).toContain('47.4 KB saved · 38.9% smaller')
    // Not for the whole change: the percentage alone, the name still whole.
    expect(at(44)).toMatch(/✓ test\.jpg .* 38\.9% smaller$/)
    expect(at(44)).not.toContain('saved')
    // Not even for that: the name alone.
    expect(at(24)).toContain('✓ test.jpg')
    expect(at(24)).not.toContain('%')
  })

  it('names the folder under the sizes when asked to, for the scrollback', () => {
    const rows = doneBody({ palette: P, facts: cv, width: 80, folder: '~/d/nonexistent/out' })
    expect(rows).toHaveLength(8)
    expect(text(rows[6])).toBe('')
    expect(text(rows[7])).toBe('   in ~/d/nonexistent/out')
    expect(doneBody({ palette: P, facts: cv, width: 80 })).toHaveLength(6)
  })

  it('draws the same size as one full bar, saying so', () => {
    const same: DoneFacts = { ...cv, after: { ...cv.after, bytes: 122_000 } }
    const rows = doneBody({ palette: P, facts: same, width: 80 })
    expect(text(rows[ROW.mid])).not.toContain('╱')
    expect(cells(rows[ROW.top]).filter((c) => c.bg === DARK.panelBand)).toHaveLength(76)
    expect(text(rows[ROW.mid])).toMatch(/same size $/)
  })

  it('tints the hatching and the fill: the outcome’s colour stepped back towards the background', () => {
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
    for (const w of [40, 60, 80]) {
      const rows = doneBody({ palette: P, facts, width: w })
      for (const row of rows) expect(width(row)).toBeLessThanOrEqual(w - 2)
      expect(text(rows[ROW.mid])).toContain('…')
    }
  })

  it('draws without fills where there are none, the words and the shape still in place', () => {
    const rows = doneBody({ palette: NEUTRAL, facts: gif, width: 80 })
    for (const row of rows) for (const run of row) expect(run.bg ?? '').toBe('')
    expect(text(rows[ROW.mid])).toContain('✓ party.png')
    // Without a fill to draw the growth in, it is drawn in shade.
    expect(text(rows[ROW.top])).toMatch(/▒+$/)
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

  it('starts a smaller file’s band at the old length and pulls it back to the new one', () => {
    // 46 of 76 cells at rest; at the start, all 76 are band.
    const start = cells(at(cv, 0, 0)[ROW.top])
    expect(start.slice(2).every((c) => c.bg === DARK.panelBand)).toBe(true)
    const half = cells(at(cv, 0.5, 0)[ROW.top])
    const band = half.slice(2).filter((c) => c.bg === DARK.panelBand).length
    expect(band).toBe(61)
    expect(half.slice(2 + band).every((c) => c.ch === '╱')).toBe(true)
  })

  it('pushes a larger file’s growth out from the old length into its fill', () => {
    // 52 cells of band at every step; the 24 of growth arrive left to right.
    const start = cells(at(gif, 0, 0)[ROW.top])
    expect(start.slice(2, 54).every((c) => c.bg === DARK.panelBand)).toBe(true)
    expect(start.slice(54).every((c) => c.bg === undefined && c.ch === ' ')).toBe(true)
    const half = cells(at(gif, 0.5, 0)[ROW.top])
    expect(half.slice(54, 66).every((c) => c.bg === DARK.grownFill)).toBe(true)
    expect(half.slice(66).every((c) => c.bg === undefined)).toBe(true)
  })

  it('names the new file throughout, and writes the change only as it settles', () => {
    expect(text(at(cv, 0, 0)[ROW.mid])).toContain('✓ test.jpg')
    expect(text(at(cv, 1, 0)[ROW.mid])).not.toContain('smaller')
    const fading = cells(at(cv, 1, 0.5)[ROW.mid]).at(-1)
    expect(fading?.fg).toBe(mix(DARK.canvas, DARK.ok, 0.5))
  })

  it('is the resting bar once both are done', () => {
    expect(at(cv, 1, 1)).toEqual(doneBody({ palette: P, facts: cv, width: 80 }))
    expect(at(gif, 1, 1)).toEqual(doneBody({ palette: P, facts: gif, width: 80 }))
  })
})
