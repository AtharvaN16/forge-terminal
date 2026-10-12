import { describe, expect, it } from 'vitest'
import {
  type FolderRowSpec,
  fieldBlank,
  folderRow,
  listAt,
  sentenceRow,
} from '../../src/shell/save-as-art.js'
import { DARK, LIGHT, modePalette, NEUTRAL } from '../../src/shell/theme.js'
import {
  describeRow,
  type FixtureFrame,
  fixtureRow,
  loadFixture,
  runsRow,
  shifted,
} from './home-cells.js'

/** P1, from scripts/save-as-mockup-fixture.mjs. */
const P1 = loadFixture('save-as-mockup.json') as FixtureFrame[]
const frame = (label: string) => P1.find((f) => f.label === label) as FixtureFrame
/** A mockup row, moved to where the app draws the field: flush left. */
const at = (label: string, row: number) => shifted(fixtureRow(frame(label), row))

const palette = modePalette(DARK, 'convert')
const W = 76

/** The mockup's example folders, with Desktop the default. */
const FOLDERS: Array<Omit<FolderRowSpec, 'palette' | 'width' | 'at'>> = [
  { label: 'Same folder', path: '~/Pictures' },
  { label: 'Desktop', path: '~/Desktop' },
  { label: 'Downloads', path: '~/Downloads' },
  { label: 'Documents', path: '~/Documents' },
  { label: 'New folder…', path: '', quiet: true },
]

describe('the Save as field, against P1', () => {
  it('pads the field with a blank row of its fill above and below the sentence', () => {
    expect(describeRow(runsRow(fieldBlank({ palette, width: W })), at('name, header', 10))).toBe(
      'equal',
    )
    expect(describeRow(runsRow(fieldBlank({ palette, width: W })), at('name, header', 12))).toBe(
      'equal',
    )
  })

  it('reads as one sentence while the name is focused: the folder on a light grey fill, ▾ after it', () => {
    const row = sentenceRow({
      palette,
      width: W,
      name: 'header',
      ext: '.jpg',
      focus: 'name',
      folder: 'Desktop',
    })
    expect(describeRow(runsRow(row), at('name, header', 11))).toBe('equal')
  })

  it('dims the name and makes the folder a white pill once the folder is focused', () => {
    const row = sentenceRow({
      palette,
      width: W,
      name: 'header',
      ext: '.jpg',
      focus: 'folder',
      folder: 'Downloads',
    })
    expect(describeRow(runsRow(row), at('folder, Downloads', 11))).toBe('equal')
  })

  it('lines the folder names up under the pill, the strip one column left of it', () => {
    expect(listAt('header', '.jpg')).toBe(18)
  })

  it('lists the folders inside the field: the highlighted one on a grey band with its path, the default tagged at the far end', () => {
    const f = frame('folder, Desktop')
    FOLDERS.forEach((spec, i) => {
      const row = folderRow({
        palette,
        width: W,
        at: listAt('header', '.jpg'),
        ...spec,
        selected: i === 1,
        isDefault: i === 1,
      })
      expect(describeRow(runsRow(row), shifted(fixtureRow(f, 13 + i)))).toBe('equal')
    })
  })

  it('keeps the tag on the default when another folder is highlighted', () => {
    const f = frame('folder, Downloads')
    FOLDERS.forEach((spec, i) => {
      const row = folderRow({
        palette,
        width: W,
        at: listAt('header', '.jpg'),
        ...spec,
        selected: i === 2,
        isDefault: i === 1,
      })
      expect(describeRow(runsRow(row), shifted(fixtureRow(f, 13 + i)))).toBe('equal')
    })
  })

  it('moves the tag the moment the default changes', () => {
    const f = frame('folder, Downloads made default')
    FOLDERS.forEach((spec, i) => {
      const row = folderRow({
        palette,
        width: W,
        at: listAt('header', '.jpg'),
        ...spec,
        selected: i === 2,
        isDefault: i === 2,
      })
      expect(describeRow(runsRow(row), shifted(fixtureRow(f, 13 + i)))).toBe('equal')
    })
  })
})

const text = (row: ReturnType<typeof sentenceRow>) => row.map((r) => r.text).join('')

describe('the Save as field, off the mockup', () => {
  it('shows a typed filter in the pill, the caret after it', () => {
    const row = sentenceRow({
      palette,
      width: W,
      name: 'header',
      ext: '.jpg',
      focus: 'folder',
      folder: 'Dow',
      query: true,
    })
    expect(text(row)).toMatch(/^ › header\.jpg {3}in {2}Dow {2}/)
    // The caret is the cell after the query, drawn in the pill's ink.
    const caret = row.find((r) => r.text === ' ' && r.bg === palette.ink)
    expect(caret).toBeDefined()
  })

  it('cuts a long name from the middle in folder focus, so the list keeps its room', () => {
    const name = 'a-really-long-file-name-that-would-push-the-folder-list-off-the-edge'
    const row = sentenceRow({
      palette,
      width: W,
      name,
      ext: '.jpg',
      focus: 'folder',
      folder: 'Desktop',
    })
    expect(text(row).length).toBe(W)
    expect(text(row)).toContain('…')
    expect(text(row)).toContain(' Desktop ')
    expect(listAt(name, '.jpg', W)).toBeLessThanOrEqual(W - 30)
  })

  it('cuts a long path on the highlighted row before it reaches the tag', () => {
    const row = folderRow({
      palette,
      width: W,
      at: 18,
      label: 'Same folder',
      path: '~/Documents/Projects/2026/Photography/Raw exports/second pass',
      selected: true,
      isDefault: true,
    })
    expect(text(row).length).toBe(W)
    // The tag, its own cell, then the field's two cells past the list's edge.
    expect(text(row)).toContain('…')
    expect(text(row)).toMatch(/second pass +default {4}$/)
  })

  it('draws every row exactly the field wide', () => {
    for (const width of [40, 60, 76]) {
      const rows = [
        fieldBlank({ palette, width }),
        sentenceRow({
          palette,
          width,
          name: 'header',
          ext: '.jpg',
          focus: 'name',
          folder: 'Desktop',
        }),
        folderRow({
          palette,
          width,
          at: listAt('header', '.jpg', width),
          label: 'Desktop',
          path: '~/Desktop',
          selected: true,
          isDefault: true,
        }),
      ]
      for (const row of rows) expect(text(row).length).toBe(width)
    }
  })

  it('has every colour it needs in the light theme too', () => {
    const light = modePalette(LIGHT, 'convert')
    const row = folderRow({
      palette: light,
      width: W,
      at: 18,
      label: 'Desktop',
      path: '~/Desktop',
      selected: true,
      isDefault: true,
    })
    expect(row.some((r) => r.bg === LIGHT.fieldBand)).toBe(true)
    expect(row.some((r) => r.bg === LIGHT.defaultTagBg && r.fg === LIGHT.defaultTag)).toBe(true)
  })
})

describe('the Save as field without colour', () => {
  const plain = { palette: modePalette(NEUTRAL, 'convert'), width: W, plain: true }

  it('draws no fill anywhere', () => {
    const rows = [
      sentenceRow({ ...plain, name: 'header', ext: '.jpg', focus: 'folder', folder: 'Desktop' }),
      folderRow({
        ...plain,
        at: 18,
        label: 'Desktop',
        path: '~/Desktop',
        selected: true,
        isDefault: true,
      }),
    ]
    for (const row of rows) for (const run of row) expect(run.bg ?? '').toBe('')
  })

  it('brackets the pill, so the focused folder still reads by shape', () => {
    const focused = sentenceRow({
      ...plain,
      name: 'header',
      ext: '.jpg',
      focus: 'folder',
      folder: 'Desktop',
    })
    expect(text(focused)).toMatch(/^ › header\.jpg {3}in \[Desktop\]/)
    const resting = sentenceRow({
      ...plain,
      name: 'header',
      ext: '.jpg',
      focus: 'name',
      folder: 'Desktop',
    })
    expect(text(resting)).toMatch(/^ › header\.jpg {3}in {2}Desktop ▾/)
  })

  it('keeps the strip on the highlighted row, and the tag as a word', () => {
    const row = folderRow({
      ...plain,
      at: 18,
      label: 'Desktop',
      path: '~/Desktop',
      selected: true,
      isDefault: true,
    })
    expect(text(row)).toMatch(/^ {18}▌ Desktop {5}~\/Desktop +default {4}$/)
  })
})
