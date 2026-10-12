import { describe, expect, it } from 'vitest'
import { brandRows, surfaceRows, tabRows } from '../../src/shell/home-art.js'
import { DARK, modePalette } from '../../src/shell/theme.js'
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
    expect(text).not.toContain('v0.1.0')
    for (const r of rows) expect(r.map((run) => run.text).join('').length).toBeLessThanOrEqual(38)
  })
})

describe('the mode tabs (mockup tab 2, D2)', () => {
  const rowText = (rows: { text: string }[][], i: number) =>
    rows[i]?.map((run) => run.text).join('') ?? ''
  const TABS = ' 1 convert   2 compress   3 pdf   4 colour   / commands  '

  it('has four modes; the destination alone when label and destination will not both fit', () => {
    const rows = tabRows({
      width: 80,
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
      width: 80,
      palette: modePalette(DARK, 'colour'),
      mode: 'colour',
      savesTo: '~/Desktop',
      right: { label: 'copies to', value: 'clipboard' },
    })
    expect(rowText(rows, 1).endsWith('clipboard ')).toBe(true)
    expect(rows[1]?.find((run) => run.text === 'colour')?.bold).toBe(true)
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
