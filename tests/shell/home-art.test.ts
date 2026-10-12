import { describe, expect, it } from 'vitest'
import { brandRows, stagedListRows, surfaceRows, tabRows, width } from '../../src/shell/home-art.js'
import type { StagedFile, StagedView } from '../../src/shell/stage.js'
import { DARK, modePalette, VERSION } from '../../src/shell/theme.js'
import { describeRow, fixtureRow, MOCKUP, runsRow } from './home-cells.js'

const [empty, typing, compress, pdfTyping] = MOCKUP as [
  (typeof MOCKUP)[0],
  (typeof MOCKUP)[0],
  (typeof MOCKUP)[0],
  (typeof MOCKUP)[0],
]

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
  const TABS = ' 1 convert   2 compress   3 pdf   4 colour   5 enhance   / commands  '

  it('has five modes; the destination alone when label and destination will not both fit', () => {
    const rows = tabRows({
      width: 92,
      palette: modePalette(DARK, 'convert'),
      mode: 'convert',
      savesTo: '~/Desktop',
    })
    expect(rowText(rows, 1)).toBe(`  ${TABS}${' '.repeat(9)}~/Desktop `)
    // The active tab is fused to the panel: a lip above it in the panel's fill.
    expect(rows[0]?.find((run) => run.text.startsWith('▄'))?.fg).toBe(DARK.selectionBg)
  })

  it('says where results go in full when there is room', () => {
    const rows = tabRows({
      width: 120,
      palette: modePalette(DARK, 'convert'),
      mode: 'convert',
      savesTo: '~/Desktop',
    })
    expect(rowText(rows, 1).endsWith('saves to ~/Desktop ')).toBe(true)
  })

  it('in colour mode results go to the clipboard', () => {
    const rows = tabRows({
      width: 90,
      palette: modePalette(DARK, 'colour'),
      mode: 'colour',
      savesTo: '~/Desktop',
      right: { label: 'copies to', value: 'clipboard' },
    })
    expect(rowText(rows, 1).endsWith('clipboard ')).toBe(true)
    expect(rows[1]?.find((run) => run.text === 'colour')?.bold).toBe(true)
  })

  it('moves the tab to the mode pressed', () => {
    const rows = tabRows({
      width: 80,
      palette: modePalette(DARK, 'enhance'),
      mode: 'enhance',
      savesTo: '~/Desktop',
    })
    expect(rows[1]?.find((run) => run.text === 'enhance')?.bold).toBe(true)
    expect(rows[1]?.find((run) => run.text === '5')?.fg).toBe(DARK.modeEnhance)
  })

  it('drops the folder before it would collide with the tabs', () => {
    const rows = tabRows({
      width: 50,
      palette: modePalette(DARK, 'convert'),
      mode: 'convert',
      savesTo: '~/Desktop',
    })
    const text = rows[1]?.map((run) => run.text).join('') ?? ''
    expect(text).toContain('3 pdf')
    expect(text).not.toContain('saves to')
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
    expectRows(surface(empty, 'images · HEIC · PDF · Word'), empty, 7)
  })

  it('dims, words and dots both, while a path is being typed', () => {
    expectRows(surface(typing, 'images · HEIC · PDF · Word'), typing, 7)
  })

  it('is tinted by the pdf gradient in pdf mode', () => {
    expectRows(surface(pdfTyping, 'split · merge · rotate'), pdfTyping, 7)
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
