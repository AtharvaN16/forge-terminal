import { describe, expect, it } from 'vitest'
import { contrast } from '../../src/core/colour/contrast.js'
import { parseHex, type Rgb, rgbToOklab, toLch } from '../../src/core/colour/space.js'
import {
  brandRows,
  type FormatKinds,
  formatRows,
  HOME_MARGIN,
  MODE_FORMATS,
  menuHintRow,
  oppositeColour,
  stagedListRows,
  surfaceRows,
  tabRows,
  width,
} from '../../src/shell/home-art.js'
import type { StagedFile, StagedView } from '../../src/shell/stage.js'
import { DARK, LIGHT, modeColours, modePalette, VERSION } from '../../src/shell/theme.js'
import { describeRow, fixtureRow, MOCKUP, runsRow } from './home-cells.js'

const [empty, typing, compress, pdfTyping] = MOCKUP as [
  (typeof MOCKUP)[0],
  (typeof MOCKUP)[0],
  (typeof MOCKUP)[0],
  (typeof MOCKUP)[0],
]

/** How far apart two colours are, in RGB. */
const distance = (a: string | null, b: string | null) => {
  const c = (h: string | null) =>
    [1, 3, 5].map((i) => Number.parseInt((h ?? '#000000').slice(i, i + 2), 16))
  const [x, y] = [c(a), c(b)]
  return Math.hypot(...x.map((v, i) => v - (y[i] ?? 0)))
}

/**
 * The drop surface against D2, with round 5's one decided change: the dots
 * are brighter. Every cell is D2's — the dots in the same places — and every
 * dot stands at least as far from the fill as D2's did.
 */
function expectSurface(rows: Parameters<typeof runsRow>[0][], frame: typeof empty, from: number) {
  rows.forEach((row, i) => {
    const actual = runsRow(row)
    const expected = fixtureRow(frame, from + i)
    const asD2 = actual.map((c, x) => (c.ch === '·' ? { ...c, fg: expected[x]?.fg ?? null } : c))
    expect(describeRow(asD2, expected), `${frame.label}, row ${from + i}`).toBe('equal')
    actual.forEach((c, x) => {
      if (c.ch !== '·') return
      const was = expected[x]
      expect(distance(c.fg, c.bg)).toBeGreaterThanOrEqual(
        distance(was?.fg ?? null, was?.bg ?? null),
      )
    })
  })
}

/** Every listed row of `frame`, starting at `from`, equals `rows`. */
function expectRows(rows: Parameters<typeof runsRow>[0][], frame: typeof empty, from: number) {
  rows.forEach((row, i) => {
    const actual = runsRow(row)
    const expected = fixtureRow(frame, from + i)
    expect(describeRow(actual, expected), `${frame.label}, row ${from + i}`).toBe('equal')
  })
}

describe('the brand band (mockup tab 3, T4 + V2)', () => {
  it('knocks FORGE and the version out of the convert gradient', () => {
    const rows = brandRows({ width: 80, palette: modePalette(DARK, 'convert'), mode: 'convert' })
    expect(rows).toHaveLength(3)
    expectRows(rows, empty, 1)
  })

  it('takes the compress gradient in compress mode', () => {
    const rows = brandRows({ width: 80, palette: modePalette(DARK, 'compress'), mode: 'compress' })
    expectRows(rows, compress, 1)
  })

  it('takes the pdf gradient in pdf mode, and does not dim while typing', () => {
    const rows = brandRows({ width: 80, palette: modePalette(DARK, 'pdf'), mode: 'pdf' })
    expectRows(rows, pdfTyping, 1)
  })

  it('leaves the version out when the band is too short to hold it', () => {
    const rows = brandRows({ width: 38, palette: modePalette(DARK, 'convert'), mode: 'convert' })
    const text = rows.map((r) => r.map((run) => run.text).join('')).join('\n')
    expect(text).not.toContain(`v${VERSION}`)
    for (const r of rows) expect(r.map((run) => run.text).join('').length).toBeLessThanOrEqual(38)
  })
})

describe('the mode tabs (mockup tab 2, D2)', () => {
  const rowText = (rows: { text: string }[][], i: number) =>
    rows[i]?.map((run) => run.text).join('') ?? ''
  const TABS = ' 1 convert   2 compress   3 pdf   4 edit   5 transcribe   6 colour  '

  it('has the six modes, no menu tab, and nothing at the row’s right', () => {
    const rows = tabRows({ palette: modePalette(DARK, 'convert'), mode: 'convert' })
    // No "saves to ~/Desktop": the owner took it out (2026-10-13).
    expect(rowText(rows, 1)).toBe(`  ${TABS}`)
    // H2: the active tab on a dark grey chip, the rest bare; no lip above it
    // (a half-cell lip drew as a hairline in Terminal.app).
    expect(rowText(rows, 0).trim()).toBe('')
    expect(rows[1]?.find((run) => run.text === 'convert')?.bg).toBe(DARK.tabChip)
    expect(rows[1]?.find((run) => run.text === 'compress')?.bg).toBeUndefined()
  })

  it('says nothing of the clipboard in colour mode either', () => {
    const rows = tabRows({ palette: modePalette(DARK, 'colour'), mode: 'colour' })
    expect(rowText(rows, 1)).toBe(`  ${TABS}`)
    expect(rows[1]?.find((run) => run.text === 'colour')?.bold).toBe(true)
  })

  it('moves the tab to the mode pressed', () => {
    const rows = tabRows({
      palette: modePalette(DARK, 'edit'),
      mode: 'edit',
    })
    expect(rows[1]?.find((run) => run.text === 'edit')?.bold).toBe(true)
    expect(rows[1]?.find((run) => run.text === '4')?.fg).toBe(DARK.modeEdit)
  })
})

describe('the "/ menu" hint (mockups/transcribe-2026-10-round2.html, "/ menu")', () => {
  const text = (row: { text: string }[]) => row.map((run) => run.text).join('')

  it('sits right-aligned, its last cell one short of the edge, the slash on a keycap', () => {
    const row = menuHintRow({ palette: modePalette(DARK, 'convert'), width: 80, open: false })
    expect(text(row)).toBe(`${' '.repeat(71)} /  menu `)
    expect(text(row)).toHaveLength(80)
    expect(row.find((run) => run.text === ' / ')).toMatchObject({ fg: DARK.fg, bg: DARK.keycapBg })
    expect(row.find((run) => run.text === ' menu')).toMatchObject({ fg: DARK.dim })
  })

  it('turns the menu’s gold while the menu is open', () => {
    const row = menuHintRow({ palette: modePalette(DARK, 'transcribe'), width: 80, open: true })
    expect(row.find((run) => run.text === ' / ')).toMatchObject({
      fg: DARK.ink,
      bg: DARK.brand,
      bold: true,
    })
    expect(row.find((run) => run.text === ' menu')).toMatchObject({ fg: DARK.brand, bold: true })
  })

  it('keeps to the width it is given', () => {
    expect(text(menuHintRow({ palette: DARK, width: 40, open: false }))).toHaveLength(40)
  })

  it('says a mode’s note at the left end, dim, and drops it where it does not fit', () => {
    const note = 'Currently only English transcription supported'
    const row = menuHintRow({ palette: DARK, width: 80, open: false, note })
    expect(text(row)).toHaveLength(80)
    expect(text(row).startsWith(`${' '.repeat(HOME_MARGIN + 1)}${note}`)).toBe(true)
    expect(text(row).endsWith(' /  menu ')).toBe(true)
    expect(row.find((run) => run.text === note)).toMatchObject({ fg: DARK.dim })
    const narrow = menuHintRow({ palette: DARK, width: 50, open: false, note })
    expect(text(narrow)).toHaveLength(50)
    expect(text(narrow)).not.toContain('English')
  })
})

describe('the drop surface (mockup tab 2, D2)', () => {
  const surface = (frame: typeof empty, kinds: string) =>
    surfaceRows({
      width: 80,
      rows: 8,
      palette: modePalette(DARK, frame.mode),
      mode: frame.mode,
      typing: frame.text !== '',
      kinds,
    })

  it('draws the dot grid in the gradient with the words in a clean cut-out', () => {
    expectSurface(surface(empty, 'images · HEIC · PDF · Word'), empty, 7)
  })

  it('dims, words and dots both, while a path is being typed', () => {
    expectSurface(surface(typing, 'images · HEIC · PDF · Word'), typing, 7)
  })

  it('is tinted by the pdf gradient in pdf mode', () => {
    expectSurface(surface(pdfTyping, 'split · merge · rotate'), pdfTyping, 7)
  })

  it('keeps the words when it is shorter than the mockup', () => {
    const rows = surfaceRows({
      width: 80,
      rows: 4,
      palette: modePalette(DARK, 'convert'),
      mode: 'convert',
      typing: false,
      kinds: 'images',
    })
    expect(rows).toHaveLength(4)
    const text = rows.map((r) => r.map((run) => run.text).join(''))
    expect(text[1]).toContain('Drop a file here')
    expect(text[2]).toContain('images')
  })
})

describe('the staged list', () => {
  const palette = modePalette(DARK, 'convert')
  const file = (name: string): StagedFile => ({ name, tag: 'PNG', size: '1.0 MB', facts: '' })
  const view = (names: string[], fresh = 0): StagedView => ({
    files: names.map(file),
    headline: `${names.length} images`,
    total: '9.0 MB',
    fresh,
  })
  const list = (v: StagedView, rows = 8, columns = 80) =>
    stagedListRows({ width: columns, rows, palette, mode: 'convert', view: v })
  const text = (rows: ReturnType<typeof list>) => rows.map((r) => r.map((run) => run.text).join(''))
  const eight = Array.from({ length: 8 }, (_, i) => `img${i}.png`)

  it('keeps the headline and "+5 more" on a 4-row panel, every row the same width', () => {
    const rows = list(view(eight), 4)
    expect(rows).toHaveLength(4)
    expect(text(rows).join('\n')).toContain('8 images')
    expect(text(rows).join('\n')).toContain('+5 more')
    for (const row of rows) expect(width(row)).toBe(80 - 2)
  })

  it('bands only the rows that just arrived', () => {
    const banded = list(view(['a.png', 'b.png', 'c.png'], 2)).map((row) =>
      row.some((run) => run.bg === palette.panelBand),
    )
    // blank, headline, blank, then a, b, c
    expect(banded).toEqual([false, false, false, false, true, true, false, false])
  })

  it('never lets a long name push a row past the terminal, or its size off the end', () => {
    for (const columns of [80, 40]) {
      const rows = list(view([`${'x'.repeat(60)}.png`, `${'y'.repeat(60)}.png`], 1), 8, columns)
      const named = text(rows).filter((t) => t.includes('…'))
      expect(named).toHaveLength(2)
      for (const t of named) {
        expect(t.split('…')).toHaveLength(2)
        expect(t).toContain('1.0 MB')
      }
      for (const row of rows) expect(width(row)).toBeLessThanOrEqual(columns)
    }
  })
})

describe('the band says when a newer Forge is out (N1)', () => {
  const line = (rows: ReturnType<typeof brandRows>) =>
    (rows.at(-1) ?? []).map((r) => r.text).join('')

  it('puts “/update is available ·” before the version, on the baseline', () => {
    const rows = brandRows({
      width: 80,
      palette: modePalette(DARK, 'convert'),
      mode: 'convert',
      update: '9.9.9',
    })
    expect(line(rows)).toContain(`/update is available · v${VERSION}`)
    expect(width(rows.at(-1) ?? [])).toBe(
      width(
        brandRows({ width: 80, palette: modePalette(DARK, 'convert'), mode: 'convert' }).at(-1) ??
          [],
      ),
    )
  })

  it('draws the words in the opposite of the mode’s colour', () => {
    for (const mode of ['convert', 'compress', 'pdf', 'edit', 'colour'] as const) {
      const p = modePalette(DARK, mode)
      const rows = brandRows({ width: 80, palette: p, mode, update: '9.9.9' })
      const note = (rows.at(-1) ?? []).find((r) => r.text === '/update is available')
      expect(note?.fg).toBe(oppositeColour(p, mode))
      expect(note?.bold).toBe(true)
    }
  })

  it('leaves the words out, keeping the version, when the band is too short for both', () => {
    const rows = brandRows({
      width: 60,
      palette: modePalette(DARK, 'convert'),
      mode: 'convert',
      update: '9.9.9',
    })
    expect(line(rows)).not.toContain('/update')
    expect(line(rows)).toContain(`v${VERSION}`)
  })
})

describe('oppositeColour', () => {
  const hue = (hex: string) => toLch(rgbToOklab(parseHex(hex) as Rgb)).h

  it('turns each mode’s colour half way round, and reads at 4.5:1 on the canvas', () => {
    for (const base of [DARK, LIGHT]) {
      for (const mode of ['convert', 'compress', 'pdf', 'edit', 'colour'] as const) {
        const c = oppositeColour(base, mode)
        const turn = Math.abs(((hue(c) - hue(modeColours(base, mode).fg) + 540) % 360) - 180)
        expect(turn, `${base.name} ${mode}`).toBeGreaterThan(150)
        expect(contrast(parseHex(c) as Rgb, parseHex(base.canvas) as Rgb)).toBeGreaterThanOrEqual(
          4.5,
        )
      }
    }
  })
})

describe('formatRows', () => {
  const text = (rows: ReturnType<typeof formatRows>) =>
    rows.map((r) => r.map((run) => run.text).join(''))
  const p = modePalette(DARK, 'convert')
  const art = { width: 80, palette: p, mode: 'convert' as const }

  it('fills the surface exactly: a title, a rule, a line a kind, every row as wide as the surface', () => {
    const rows = formatRows({ ...art, rows: 8, kinds: MODE_FORMATS.convert ?? [] })
    expect(rows).toHaveLength(8)
    for (const r of rows) expect(width(r)).toBe(78)
    const lines = text(rows)
    expect(lines[1]).toContain('Supported formats')
    expect(lines[2]).toContain('──────')
    expect(lines[3]).toMatch(/Images +JPEG · PNG · WebP · AVIF · HEIC · GIF · TIFF/)
    expect(lines.join('\n')).not.toContain('↓')
  })

  it('draws on the surface’s fill, with no dots', () => {
    const rows = formatRows({ ...art, rows: 8, kinds: MODE_FORMATS.convert ?? [] })
    for (const r of rows.flat()) {
      expect(r.text).not.toContain('·'.repeat(2))
      if (r.text.trim() === '') expect(r.bg ?? p.selectionBg).toBe(p.selectionBg)
    }
  })

  it('past its rows keeps the first lines and says how many are left, with a bar', () => {
    const many: FormatKinds = Array.from(
      { length: 9 },
      (_, i) => [`Kind${i}`, 'AAA · BBB'] as const,
    )
    const rows = formatRows({ ...art, rows: 8, kinds: many })
    const lines = text(rows)
    expect(rows).toHaveLength(8)
    // Title and rule, four lines, then the note on the last row.
    expect(lines[3]).toContain('Kind0')
    expect(lines[6]).toContain('Kind3')
    expect(lines[6]).not.toContain('Kind4')
    expect(lines[7]).toContain('↓ 5 more')
    expect(lines.slice(3, 7).every((l) => /[┃│]$/.test(l))).toBe(true)
  })

  it('breaks a line longer than the surface under itself, the kind not repeated', () => {
    const long: FormatKinds = [
      ['Archives', Array.from({ length: 30 }, (_, i) => `F${i}`).join(' · ')],
    ]
    const lines = text(formatRows({ ...art, rows: 8, kinds: long }))
    expect(lines[3]).toContain('Archives')
    expect(lines[3]).toMatch(/ ·\s*$/)
    expect(lines[4]).not.toContain('Archives')
    expect(lines[4]).toMatch(/F\d+/)
  })

  it('a short surface gives up its top blank, then its rule, to keep lines', () => {
    const four = text(formatRows({ ...art, rows: 4, kinds: MODE_FORMATS.convert ?? [] }))
    expect(four[0]).toContain('Supported formats')
    expect(four[1]).not.toContain('──')
    expect(four.join('\n')).toContain('↓')
    expect(four).toHaveLength(4)
  })

  it('lists convert’s formats from the format table: no HEVC (never a source), Word once', () => {
    const all = (MODE_FORMATS.convert ?? []).map(([, f]) => f).join(' · ')
    expect(all).toContain('MKV')
    expect(all).not.toContain('HEVC')
    expect(all.match(/Word/g)).toHaveLength(1)
    // Compress takes no HEIC or TIFF: nothing writes HEIC, TIFF has no quality dial.
    expect((MODE_FORMATS.compress ?? []).map(([, f]) => f).join(' ')).not.toMatch(/HEIC|TIFF/)
  })
})
