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
  it('fuses the active tab to the panel and puts the folder at the right', () => {
    const rows = tabRows({
      width: 80,
      palette: modePalette(DARK, 'convert'),
      mode: 'convert',
      savesTo: '~/Desktop',
    })
    expectRows(rows, empty, 5)
  })

  it('moves the tab to the mode pressed', () => {
    const rows = tabRows({
      width: 80,
      palette: modePalette(DARK, 'compress'),
      mode: 'compress',
      savesTo: '~/Desktop',
    })
    expectRows(rows, compress, 5)
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
