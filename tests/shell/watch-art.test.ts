import stringWidth from 'string-width'
import { describe, expect, it } from 'vitest'
import type { FolderKind } from '../../src/core/folder.js'
import { folderCardOnDots, type Row } from '../../src/shell/home-art.js'
import { DARK, modeColours, modePalette } from '../../src/shell/theme.js'
import {
  folderCardLines,
  folderFacts,
  hairlineRow,
  kindRow,
  kindWindowLines,
  pillRuns,
  type WatchedFile,
  watchedRow,
  watchListRows,
} from '../../src/shell/watch-art.js'

const palette = modePalette(DARK, 'convert')
const text = (row: Row) => row.map((r) => r.text).join('')
const texts = (rows: Row[]) => rows.map(text)

const kind = (id: FolderKind['id'], count: number, bytes: number, why?: string): FolderKind => ({
  id,
  count,
  bytes,
  sources: [],
  ...(why ? { why } : {}),
})

describe('folderCardLines', () => {
  it('is today’s file card with FOLDER – the name in its top edge', () => {
    const rows = folderCardLines({
      palette,
      mode: 'convert',
      name: 'images',
      lines: ['24 images · 86.4 MB'],
      width: 80,
    })
    expect(texts(rows)).toEqual([
      `╭─ FOLDER – images ${'─'.repeat(32)}╮`,
      `│ 24 images · 86.4 MB${' '.repeat(29)} │`,
      `╰${'─'.repeat(50)}╯`,
    ])
    const tag = rows[0]?.find((r) => r.text === 'FOLDER')
    expect(tag).toMatchObject({ fg: modeColours(palette, 'convert').fg, bold: true })
    expect(rows[0]?.find((r) => r.text === 'images')).toMatchObject({ bold: true })
  })

  it('cuts a long name in the middle and keeps a little of the edge after it', () => {
    const [top] = folderCardLines({
      palette,
      mode: 'convert',
      name: 'Portfolio 2026 – final selects for the new website',
      lines: ['x'],
      width: 80,
    })
    const t = text(top ?? [])
    expect(stringWidth(t)).toBe(52)
    expect(t).toMatch(/…/)
    expect(t).toMatch(/ ───╮$/)
  })

  it('every row is the card’s width', () => {
    const rows = folderCardLines({
      palette,
      mode: 'convert',
      name: 'images',
      lines: ['24 files · 101 MB', '18 images · 3 PDFs · 2 videos · 1 other'],
      width: 80,
    })
    expect(rows.map((r) => stringWidth(text(r)))).toEqual([52, 52, 52, 52])
  })
})

describe('folderCardOnDots', () => {
  it('sits the card on the drop zone’s dots', () => {
    const card = folderCardLines({
      palette,
      mode: 'convert',
      name: 'images',
      lines: ['a'],
      width: 80,
    })
    const rows = folderCardOnDots({ width: 80, rows: 7, palette, mode: 'convert', card })
    expect(rows).toHaveLength(7)
    expect(texts(rows).some((t) => t.includes('FOLDER – images'))).toBe(true)
    expect(texts(rows).some((t) => t.includes('·'))).toBe(true)
  })
})

describe('folderFacts', () => {
  it('counts one kind by its own name', () => {
    expect(
      folderFacts({ kinds: [kind('images', 24, 86_400_000)], bytes: 86_400_000, files: 24 }),
    ).toEqual(['24 images · 86.4 MB'])
    expect(folderFacts({ kinds: [kind('pdfs', 1, 2_000)], bytes: 2_000, files: 1 })).toEqual([
      '1 PDF · 2 KB',
    ])
  })

  it('counts a mixed folder as files, then each kind', () => {
    expect(
      folderFacts({
        kinds: [
          kind('images', 18, 1),
          kind('pdfs', 3, 1),
          kind('videos', 2, 1, 'not yet supported'),
          kind('other', 1, 1, 'a text file'),
        ],
        bytes: 101_000_000,
        files: 24,
      }),
    ).toEqual(['24 files · 101 MB', '18 images · 3 PDFs · 2 videos · 1 other'])
  })
})

describe('hairlineRow', () => {
  it('is a rule the width of the content, lit near the light', () => {
    const row = hairlineRow({ palette, mode: 'convert', width: 80, at: 10 })
    expect(stringWidth(text(row))).toBe(80 - 3)
    const cells = row.filter((r) => r.text === '─')
    expect(cells).toHaveLength(74)
    expect(cells[10]?.fg).not.toBe(cells[60]?.fg)
  })

  it('is one quiet grey with no light', () => {
    const row = hairlineRow({ palette, mode: 'convert', width: 80 })
    expect(new Set(row.filter((r) => r.text === '─').map((r) => r.fg))).toEqual(
      new Set([palette.faint]),
    )
  })
})

const file = (over: Partial<WatchedFile>): WatchedFile => ({
  path: '/x/IMG_4112.HEIC',
  at: '14:06',
  state: 'done',
  ...over,
})

describe('watchedRow', () => {
  it('says what a converted file became, its size and when', () => {
    const t = text(
      watchedRow({
        palette,
        mode: 'convert',
        width: 80,
        file: file({ from: 'HEIC', to: 'WebP', bytes: 412_000 }),
      }),
    )
    expect(t).toMatch(/^ {2} ✓ IMG_4112\.HEIC +HEIC → WebP +412 KB +14:06$/)
    expect(stringWidth(t)).toBe(78)
  })

  it('shows a running file’s phase and clock', () => {
    const t = text(
      watchedRow({
        palette,
        mode: 'convert',
        width: 80,
        spinner: '⠹',
        file: file({ state: 'running', phase: 'Encoding WebP', clock: '4.1s' }),
      }),
    )
    expect(t).toMatch(/^ {3}⠹ IMG_4112\.HEIC +Encoding WebP +4\.1s$/)
  })

  it('says why a file failed, tinted', () => {
    const row = watchedRow({
      palette,
      mode: 'convert',
      width: 80,
      file: file({ state: 'failed', reason: 'damaged file' }),
    })
    expect(text(row)).toMatch(/✕ IMG_4112\.HEIC +damaged file/)
    expect(row.some((r) => r.bg === palette.failTint)).toBe(true)
  })

  it('marks a file left alone with a dash and why', () => {
    const t = text(
      watchedRow({
        palette,
        mode: 'convert',
        width: 80,
        file: file({ state: 'left', reason: 'not an image' }),
      }),
    )
    expect(t).toMatch(/^ {3}– IMG_4112\.HEIC +not an image +14:06$/)
  })
})

describe('watchListRows', () => {
  const rows = (n: number): Row[] => Array.from({ length: n }, (_, i) => [{ text: `row ${i}` }])

  it('shows every row under a blank one while they fit', () => {
    expect(
      texts(watchListRows({ palette, rows: rows(3), room: 5, width: 80, failedAt: [] })),
    ).toEqual(['', 'row 0', 'row 1', 'row 2'])
  })

  it('follows the newest: the last rows, with a bar at the end', () => {
    const out = texts(watchListRows({ palette, rows: rows(20), room: 5, width: 80, failedAt: [] }))
    expect(out[0]).toBe('')
    expect(out.slice(1).map((t) => t.split(/\s+/).slice(0, 2).join(' '))).toEqual([
      'row 15',
      'row 16',
      'row 17',
      'row 18',
      'row 19',
    ])
    expect(out.slice(1).every((t) => /[│┃]$/.test(t))).toBe(true)
    expect(out.at(-1)?.endsWith('┃')).toBe(true)
  })

  it('counts a failure that has scrolled off the top over the list', () => {
    const out = texts(watchListRows({ palette, rows: rows(20), room: 5, width: 80, failedAt: [6] }))
    expect(out[0]?.trim()).toBe('↑ 1 failed')
  })

  it('scrolled up, it stays put and says what landed below', () => {
    const out = texts(
      watchListRows({
        palette,
        rows: rows(20),
        room: 5,
        width: 80,
        failedAt: [],
        back: 6,
        fresh: 1,
      }),
    )
    expect(out.slice(1, 5).map((t) => t.split(/\s+/).slice(0, 2).join(' '))).toEqual([
      'row 10',
      'row 11',
      'row 12',
      'row 13',
    ])
    expect(out.at(-1)?.trim()).toBe('↓ 1 new')
  })
})

describe('kindRow', () => {
  it('puts the count first, then the kind and its answer', () => {
    const t = text(
      kindRow({
        palette,
        mode: 'convert',
        kind: kind('images', 18, 1),
        answer: 'WebP · 80',
        selected: false,
      }),
    )
    expect(t).toBe('     18  Images    WebP · 80')
  })

  it('marks a kind Forge cannot convert with a dash and why', () => {
    const t = text(
      kindRow({
        palette,
        mode: 'convert',
        kind: kind('videos', 2, 1, 'not yet supported'),
        selected: false,
      }),
    )
    expect(t).toBe('      2  Videos    –  not yet supported')
  })

  it('the chosen row sits on the band with the mode’s mark', () => {
    const row = kindRow({
      palette,
      mode: 'convert',
      kind: kind('pdfs', 3, 1),
      answer: 'PNG · 150 dpi',
      selected: true,
    })
    expect(text(row)).toMatch(/^ {2}▌ {3}3 {2}PDFs {6}PNG · 150 dpi +$/)
    expect(row.some((r) => r.bg === palette.listBand)).toBe(true)
  })
})

describe('pillRuns', () => {
  it('is Enhance’s pill: an arrow lit where ←→ can still go', () => {
    const runs = pillRuns({ palette, mode: 'convert', label: '300 dpi', at: 2, of: 3 })
    expect(text(runs)).toBe(' ‹ 300 dpi › ')
    expect(runs[0]).toMatchObject({ fg: modeColours(palette, 'convert').fg, bold: true })
    expect(runs[2]).toMatchObject({ fg: palette.border })
    expect(runs[1]).toMatchObject({ fg: palette.fg, bold: true, bg: palette.folderChip })
  })
})

describe('kindWindowLines', () => {
  it('puts the setting in hand on the pill, the other plain, under a blank row', () => {
    const lines = kindWindowLines({
      palette,
      mode: 'convert',
      inner: 54,
      focus: 0,
      settings: [
        { label: 'Format', kind: 'pill', value: 'PNG', at: 1, of: 4 },
        { label: 'Resolution', kind: 'pill', value: '150 dpi', at: 1, of: 3 },
      ],
    })
    expect(texts(lines).map((t) => t.trimEnd())).toEqual([
      '',
      ' › Format         ‹ PNG ›',
      '   Resolution       150 dpi',
      '',
    ])
    expect(lines[1]?.every((r) => r.bg !== undefined)).toBe(true)
  })

  it('draws quality as the quality screen’s slider', () => {
    const lines = kindWindowLines({
      palette,
      mode: 'convert',
      inner: 54,
      focus: 1,
      settings: [
        { label: 'Format', kind: 'pill', value: 'WebP', at: 2, of: 7 },
        { label: 'Quality', kind: 'slider', value: 80, min: 1, max: 100 },
      ],
    })
    const quality = lines.find((l) => text(l).includes('Quality')) ?? []
    expect(text(quality)).toMatch(/Quality +.* 80 /)
    expect(quality.some((r) => r.bg === palette.thumb)).toBe(true)
  })
})
