import { mkdir, utimes, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { findByName, isNameQuery, isOwnPlace, tilde } from '../../src/shell/find-files.js'
import { searchingRows, suggestionRows, width } from '../../src/shell/home-art.js'
import { DARK, modePalette } from '../../src/shell/theme.js'
import { makeTempDir } from '../helpers/fixtures.js'

describe('isNameQuery', () => {
  it('is a name: two characters or more, no slash, not ~ or . first', () => {
    expect(isNameQuery('rec', 'darwin')).toBe(true)
    expect(isNameQuery('receipt march', 'darwin')).toBe(true)
    expect(isNameQuery('r', 'darwin')).toBe(false)
    expect(isNameQuery('~/Desk', 'darwin')).toBe(false)
    expect(isNameQuery('./a', 'darwin')).toBe(false)
    expect(isNameQuery('/Users', 'darwin')).toBe(false)
    expect(isNameQuery('src/a', 'darwin')).toBe(false)
    expect(isNameQuery('C:\\Users', 'win32')).toBe(false)
    expect(isNameQuery('docs\\a', 'win32')).toBe(false)
  })
})

describe('isOwnPlace', () => {
  const home = '/Users/me'
  it('keeps the places files are kept, iCloud Drive among them', () => {
    expect(isOwnPlace('/Users/me/Downloads/a.png', home)).toBe(true)
    expect(isOwnPlace('/Users/me/Library/Mobile Documents/com~apple~CloudDocs/a.pdf', home)).toBe(
      true,
    )
  })
  it('leaves out hidden folders, node_modules, Library, packages and other homes', () => {
    expect(isOwnPlace('/Users/me/.cache/a.png', home)).toBe(false)
    expect(isOwnPlace('/Users/me/code/node_modules/x/a.png', home)).toBe(false)
    expect(isOwnPlace('/Users/me/Library/Caches/a.png', home)).toBe(false)
    expect(isOwnPlace('/Users/me/Pictures/Photos Library.photoslibrary/a.heic', home)).toBe(false)
    expect(isOwnPlace('/Applications/X.app/Contents/a.png', home)).toBe(false)
    expect(isOwnPlace('/Users/me/Desktop/.secret.png', home)).toBe(false)
  })
})

describe('tilde', () => {
  it('shows the home folder as ~', () => {
    expect(tilde('/Users/me/Downloads', '/Users/me')).toBe('~/Downloads')
    expect(tilde('/Users/me', '/Users/me')).toBe('~')
    expect(tilde('/Volumes/x', '/Users/me')).toBe('/Volumes/x')
  })
})

describe('findByName, reading Desktop, Downloads and Documents (no Spotlight off a Mac)', () => {
  async function homeWith() {
    const home = await makeTempDir()
    for (const d of ['Desktop', 'Downloads', 'Documents', 'Documents/Taxes', 'Desktop/.hidden'])
      await mkdir(join(home, d), { recursive: true })
    const put = async (path: string, ageDays: number) => {
      await writeFile(join(home, path), 'x')
      const t = Date.now() / 1000 - ageDays * 86400
      await utimes(join(home, path), t, t)
    }
    await put('Downloads/receipt march.pdf', 0)
    await put('Desktop/Receipt.png', 3)
    await put('Documents/Taxes/receipt-old.jpg', 1)
    await put('Desktop/receipt notes.txt', 0)
    await put('Desktop/.hidden/receipt.png', 0)
    await mkdir(join(home, 'Documents/receipts'))
    return home
  }

  it('finds files Forge reads and folders, by part of the name, any case', async () => {
    const home = await homeWith()
    const found = await findByName('RECEIPT', { home, platform: 'linux' })
    const names = found.map((f) => f.label)
    expect(names).toContain('receipt march.pdf')
    expect(names).toContain('Receipt.png')
    expect(names).toContain('receipt-old.jpg')
    expect(names).toContain('receipts/')
    // Not a kind Forge reads, and not a hidden folder.
    expect(names).not.toContain('receipt notes.txt')
    expect(found.filter((f) => f.label === 'receipt.png')).toHaveLength(0)
  })

  it('puts Desktop and Downloads first, newest first, and says where each is', async () => {
    const home = await homeWith()
    const found = await findByName('receipt', { home, platform: 'linux' })
    expect(found[0]).toMatchObject({ label: 'receipt march.pdf', where: '~/Downloads' })
    expect(found[1]).toMatchObject({ label: 'Receipt.png', where: '~/Desktop' })
    const old = found.find((f) => f.label === 'receipt-old.jpg')
    expect(old?.where).toBe('~/Documents/Taxes')
  })

  it('gives Tab the whole path, escaped as a Finder drop is', async () => {
    const home = await homeWith()
    const found = await findByName('march', { home, platform: 'linux' })
    expect(found[0]?.insert).toBe('~/Downloads/receipt\\ march.pdf')
  })

  it('looks for nothing under two characters', async () => {
    const home = await homeWith()
    expect(await findByName('r', { home, platform: 'linux' })).toEqual([])
  })
})

describe('suggestionRows (S2)', () => {
  const p = modePalette(DARK, 'convert')
  const items = [
    { name: 'receipt-march.pdf', where: '~/Downloads' },
    { name: 'Receipt.png', where: '~/Desktop' },
  ]
  const text = (rows: ReturnType<typeof suggestionRows>) =>
    rows.map((r) => r.map((run) => run.text).join(''))

  it('fills the surface: a blank, a row each, blanks to the end, every row the surface’s width', () => {
    const rows = suggestionRows({
      width: 80,
      rows: 8,
      palette: p,
      mode: 'convert',
      items,
      selected: 0,
    })
    expect(rows).toHaveLength(8)
    for (const r of rows) expect(width(r)).toBe(78)
    const lines = text(rows)
    expect(lines[0]?.trim()).toBe('')
    expect(lines[1]).toMatch(/^ {6}receipt-march\.pdf +~\/Downloads +$/)
    expect(lines[2]).toMatch(/ Receipt\.png +~\/Desktop +$/)
  })

  it('lights only the chosen row, by its text alone: no band, no strip; the rest faded', () => {
    const rows = suggestionRows({
      width: 80,
      rows: 8,
      palette: p,
      mode: 'convert',
      items,
      selected: 1,
    })
    const run = (row: number, t: string) => rows[row]?.find((r) => r.text === t)
    expect(run(2, 'Receipt.png')).toMatchObject({ fg: p.fg, bold: true, bg: p.selectionBg })
    expect(run(2, '~/Desktop')).toMatchObject({ fg: p.fg, bg: p.selectionBg })
    expect(run(1, 'receipt-march.pdf')).toMatchObject({ fg: p.dim, bg: p.selectionBg })
    expect(run(1, '~/Downloads')).toMatchObject({ fg: p.border })
    expect(rows.flat().some((r) => r.text.includes('▌') || r.bg === p.panelBand)).toBe(false)
  })

  it('keeps the chosen row in view', () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ name: `f${i}.png`, where: '~' }))
    const lines = text(
      suggestionRows({
        width: 80,
        rows: 8,
        palette: p,
        mode: 'convert',
        items: many,
        selected: 15,
      }),
    )
    expect(lines.some((l) => l.includes('f15.png'))).toBe(true)
    expect(lines.some((l) => l.includes('f0.png'))).toBe(false)
  })
})

describe('searchingRows (L1)', () => {
  const p = modePalette(DARK, 'convert')
  it('is the surface’s fill and one line in its middle: the spinner, then “Searching your Mac”', () => {
    const rows = searchingRows({ width: 80, rows: 8, palette: p, mode: 'convert', glyph: '⠹' })
    expect(rows).toHaveLength(8)
    for (const r of rows) expect(width(r)).toBe(78)
    const lines = rows.map((r) => r.map((run) => run.text).join(''))
    expect(lines.filter((l) => l.trim() !== '')).toEqual([
      expect.stringContaining('⠹ Searching your Mac'),
    ])
    expect(lines[3]?.trim()).toBe('⠹ Searching your Mac')
    // Centred on the surface.
    const at = lines[3]?.indexOf('⠹') ?? 0
    const end = (lines[3]?.indexOf('Mac') ?? 0) + 3
    expect(Math.abs(at - 2 - (78 - end))).toBeLessThanOrEqual(1)
    const glyph = rows[3]?.find((r) => r.text.startsWith('⠹'))
    expect(glyph).toMatchObject({ fg: p.accent, bold: true, bg: p.selectionBg })
    expect(rows[3]?.find((r) => r.text === 'Searching your Mac')).toMatchObject({ fg: p.dim })
  })
})
