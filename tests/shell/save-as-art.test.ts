import stringWidth from 'string-width'
import { describe, expect, it } from 'vitest'
import { mix, type Row } from '../../src/shell/home-art.js'
import {
  edgeColour,
  fieldRow,
  filesRow,
  folderRow,
  NAME_WIDTH,
  type PathLine,
  pathRow,
  ruleRow,
  underlineRow,
} from '../../src/shell/save-as-art.js'
import { DARK, LIGHT, modePalette, NEUTRAL } from '../../src/shell/theme.js'

const palette = modePalette(DARK, 'convert')
const W = 76
const text = (row: Row) => row.map((r) => r.text).join('')
const cells = (row: Row) =>
  row.flatMap((run) =>
    [...run.text].map((ch) => ({ ch, fg: run.fg, bg: run.bg, bold: run.bold ?? false })),
  )

const PATHS: PathLine[] = [
  { kind: 'rest' },
  { kind: 'empty' },
  { kind: 'typing', text: '~/Documents/Sc', ghost: 'ans/', note: 'complete', highlighted: true },
  { kind: 'typing', text: '~/Documents/Invoices 2026', note: 'new', highlighted: true },
  { kind: 'typing', text: 'zzz', note: 'nomatch', highlighted: true },
  { kind: 'place', label: 'Scans', path: '~/Documents/Scans', highlighted: true },
]

describe('the Save as block (V10c)', () => {
  it('edges every row in the mode’s colour stepped into the field’s fill', () => {
    const row = fieldRow({ palette, width: W })
    expect(edgeColour(palette)).toBe(mix(DARK.selectionBg, DARK.modeConvert, 0.7))
    expect(cells(row)[0]).toMatchObject({ ch: ' ', bg: edgeColour(palette) })
    expect(
      cells(row)
        .slice(1)
        .every((c) => c.bg === DARK.selectionBg),
    ).toBe(true)
  })

  it('underlines the name’s box in the mode’s colour, under it exactly', () => {
    const row = cells(underlineRow({ palette, width: W }))
    const line = row.map((c, i) => (c.ch === '▔' ? i : -1)).filter((i) => i >= 0)
    expect(line).toHaveLength(NAME_WIDTH)
    expect(line[0]).toBe(11)
    expect(row[11]).toMatchObject({ fg: DARK.modeConvert })
  })

  it('parts the name from the folders with a quiet rule', () => {
    expect(text(ruleRow({ palette, width: W }))).toMatch(/^ {3}─{70} {3}$/)
    expect(cells(ruleRow({ palette, width: W }))[3]).toMatchObject({ fg: DARK.faint })
  })

  it('says what will be written in place of a name, for many files', () => {
    expect(text(filesRow({ palette, width: W, names: 'report-1.jpg … 12 files' }))).toMatch(
      /^ {3}files {3}report-1\.jpg … 12 files +$/,
    )
  })

  it('draws every row exactly the field wide', () => {
    for (const width of [W, 56, 40]) {
      const rows: Row[] = [
        fieldRow({ palette, width }),
        underlineRow({ palette, width }),
        ruleRow({ palette, width }),
        filesRow({ palette, width, names: 'a very long list of names that goes on and on and on' }),
        folderRow({
          palette,
          width,
          label: 'Same folder',
          path: '~/Pictures',
          selected: true,
          isDefault: true,
        }),
        folderRow({ palette, width, label: 'Downloads', path: '~/Downloads' }),
        ...PATHS.map((line) => pathRow({ palette, width, line })),
      ]
      for (const row of rows) expect(stringWidth(text(row))).toBe(width)
    }
  })
})

describe('the Save as folders (V10c)', () => {
  it('draws the highlighted one on a grey band: the white strip, its name bold, its path', () => {
    const row = folderRow({
      palette,
      width: W,
      first: true,
      label: 'Desktop',
      path: '~/Desktop',
      selected: true,
    })
    expect(text(row)).toMatch(/^ {3}to {6}▌ Desktop {9}~\/Desktop +$/)
    const c = cells(row)
    expect(c[11]).toMatchObject({ ch: '▌', fg: DARK.fg, bg: DARK.fieldBand })
    expect(c[13]).toMatchObject({ ch: 'D', fg: DARK.fg, bold: true, bg: DARK.fieldBand })
  })

  it('keeps the rest lean: a name each, no path', () => {
    const row = folderRow({ palette, width: W, label: 'Downloads', path: '~/Downloads' })
    expect(text(row)).toMatch(/^ {13}Downloads +$/)
    expect(cells(row)[13]).toMatchObject({ fg: DARK.dim, bg: DARK.selectionBg })
  })

  it('tags the default at the far end, a cell in, whether or not it is highlighted', () => {
    for (const selected of [true, false]) {
      const row = folderRow({
        palette,
        width: W,
        label: 'Desktop',
        path: '~/Desktop',
        isDefault: true,
        selected,
      })
      expect(text(row)).toMatch(/ default {3}$/)
      const c = cells(row)
      expect(c[W - 4]).toMatchObject({ ch: 't', fg: DARK.defaultTag, bg: DARK.defaultTagBg })
    }
  })
})

describe('the Save as path row (V10c)', () => {
  it('invites a path at rest', () => {
    expect(text(pathRow({ palette, width: W, line: { kind: 'rest' } }))).toMatch(
      /^ {13}Type the path here {2}or drop a folder +$/,
    )
  })

  it('puts the caret on the invitation when highlighted with nothing typed', () => {
    const row = pathRow({ palette, width: W, line: { kind: 'empty' } })
    expect(text(row)).toMatch(/^ {11}▌ Type the path here/)
    expect(cells(row)[13]).toMatchObject({ ch: 'T', bg: DARK.dim })
  })

  it('shows the rest of a matching folder dim, and "tab completes" where the default’s tag sits', () => {
    const row = pathRow({ palette, width: W, line: PATHS[2] as PathLine })
    expect(text(row)).toMatch(/▌ ~\/Documents\/Sc ans\/ +tab completes {2}$/)
    const c = cells(row)
    const ghost = text(row).indexOf('ans/')
    expect(c[ghost]).toMatchObject({ fg: DARK.border })
    // The caret: a cell of the text's colour, after what is typed.
    expect(c[ghost - 1]).toMatchObject({ ch: ' ', bg: DARK.fg })
  })

  it('tags a folder that does not exist yet in blue, where the default’s tag sits', () => {
    const row = pathRow({ palette, width: W, line: PATHS[3] as PathLine })
    expect(text(row)).toMatch(/ new folder {3}$/)
    const c = cells(row)
    expect(c[W - 4]).toMatchObject({ ch: 'r', fg: DARK.newTag, bg: DARK.newTagBg })
    const tagged = folderRow({ palette, width: W, label: 'Desktop', path: '', isDefault: true })
    // Both tags end on the same cell.
    expect(text(row).trimEnd().length).toBe(text(tagged).trimEnd().length)
  })

  it('says when nothing matches', () => {
    expect(text(pathRow({ palette, width: W, line: PATHS[4] as PathLine }))).toMatch(
      /▌ zzz +no match {2}$/,
    )
  })

  it('fills with a dropped folder: its name, and where it is', () => {
    expect(text(pathRow({ palette, width: W, line: PATHS[5] as PathLine }))).toMatch(
      /▌ Scans +~\/Documents\/Scans +$/,
    )
  })

  it('keeps the end of a long path, where the typing is', () => {
    const long = `~/${'deep/'.repeat(20)}folder`
    const row = text(
      pathRow({ palette, width: W, line: { kind: 'typing', text: long, highlighted: true } }),
    )
    expect(row).toContain('…')
    expect(row).toContain('deep/folder')
  })
})

describe('the Save as block without colour', () => {
  it('draws no fill anywhere, the edge a rule and the caret a glyph', () => {
    const rows = [
      fieldRow({ palette: NEUTRAL, width: W }),
      underlineRow({ palette: NEUTRAL, width: W }),
      folderRow({
        palette: NEUTRAL,
        width: W,
        label: 'Desktop',
        path: '~/Desktop',
        selected: true,
        isDefault: true,
      }),
      ...PATHS.map((line) => pathRow({ palette: NEUTRAL, width: W, line })),
    ]
    for (const row of rows) for (const run of row) expect(run.bg ?? '').toBe('')
    expect(text(rows[0] as Row)[0]).toBe('│')
    expect(text(pathRow({ palette: NEUTRAL, width: W, line: PATHS[2] as PathLine }))).toContain(
      'Sc▏ans/',
    )
  })

  it('has every colour it needs in the light theme too', () => {
    for (const key of [
      'fieldBand',
      'defaultTag',
      'defaultTagBg',
      'newTag',
      'newTagBg',
      'faint',
    ] as const) {
      expect(LIGHT[key]).toMatch(/^#[0-9a-f]{6}$/)
    }
  })
})
