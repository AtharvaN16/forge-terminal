import { describe, expect, it } from 'vitest'
import type { Row } from '../../src/shell/home-art.js'
import { openEditor, press, withMissing, withReasons } from '../../src/shell/preset-editor.js'
import { editorLines, subLines } from '../../src/shell/preset-editor-art.js'
import { DARK, modePalette } from '../../src/shell/theme.js'

const P = modePalette(DARK, 'convert')
const text = (row: Row | undefined) => (row ?? []).map((r) => r.text).join('')
const open = () =>
  openEditor({
    target: 'webp',
    quality: 80,
    targets: ['jpeg', 'webp', 'avif'],
    scales: [2, 3, 4],
    cutout: true,
  })
const foot: Row[] = [[{ text: '✓ photo.webp   now 2 MB' }]]

describe('the Continue editing window’s lines', () => {
  it('draws a row per operation: ● or ○, its name, its value, — for none', () => {
    const lines = editorLines(P, open(), foot, 66).map(text)
    expect(lines[0]).toBe('')
    expect(lines[1]).toMatch(/^ {3}● Convert to {9}WebP/)
    expect(lines[2]).toMatch(/^ {3}● Quality {12}80/)
    expect(lines[4]).toMatch(/^ {3}○ Resize {13}—/)
    expect(lines[9]).toMatch(/^ {3}○ Remove background {2}—/)
  })

  it('marks the lit row with ›, and › after its value when → opens a window of its own', () => {
    const lines = editorLines(P, open(), foot, 66).map(text)
    expect(lines[3]).toMatch(/^ › ○ Compress {11}— {2}›/)
    const trim = editorLines(P, press(press(press(open(), 'down'), 'down'), 'space'), foot, 66).map(
      text,
    )
    expect(trim[5]).toMatch(/^ › ● Trim edges\s*$/)
  })

  it('makes the lit quality row its slider', () => {
    const lines = editorLines(P, press(open(), 'up'), foot, 66)
    expect(text(lines[2])).toContain(' 80 ')
    expect(lines[2]?.some((r) => r.bg === DARK.thumb)).toBe(true)
  })

  it('keeps an unselected answer, faint', () => {
    const e = [
      'down',
      'right',
      { digit: '8' },
      { digit: '0' },
      { digit: '0' },
      'enter',
      'space',
    ].reduce((s, k) => press(s, k as Parameters<typeof press>[1]), open())
    const row = editorLines(P, e, foot, 66)[4]
    expect(text(row)).toContain('800 wide')
    expect(row?.find((r) => r.text.includes('800'))?.fg).toBe(DARK.faint)
  })

  it('dims a row that cannot apply, its reason where the value would be', () => {
    const e = withReasons(open(), { trim: 'no empty edges' })
    const row = editorLines(P, e, foot, 66)[5]
    expect(text(row)).toMatch(/^ {3}○ Trim edges {9}no empty edges/)
    expect(row?.every((r) => !r.text.trim() || r.fg === DARK.faint || r.fg === P.accent)).toBe(true)
  })

  it('says not added on a row whose extension is missing', () => {
    const row = editorLines(P, withMissing(open(), { sharpen: 41_000_000 }), foot, 66)[7]
    expect(text(row)).toMatch(/^ {3}○ Sharpen {12}not added/)
  })

  it('spins on the row being rerun', () => {
    const e = press(press(press(open(), 'down'), 'down'), 'space') // Trim edges
    const row = editorLines(P, e, foot, 66, { id: 'trim', glyph: '⠹' })[5]
    expect(text(row)).toMatch(/● Trim edges {9}⠹/)
  })

  it('ends in the file as it is now, a blank row either side', () => {
    const lines = editorLines(P, open(), foot, 66).map(text)
    expect(lines.slice(-3)).toEqual(['', '   ✓ photo.webp   now 2 MB', ''])
  })
})

describe('a row’s own window', () => {
  it('lists what Convert to can become, the current one lit', () => {
    const e = press(press(press(open(), 'up'), 'up'), 'right')
    const lines = subLines(P, e, 40).map(text)
    expect(lines.filter((l) => l.startsWith(' › '))).toEqual([expect.stringMatching(/^ › WebP/)])
    expect(lines).toContain(`   JPEG${' '.repeat(33)}`)
  })

  it('lists the four shapes with the size each cuts', () => {
    const e = press(press(press(press(open(), 'down'), 'down'), 'down'), 'right')
    const lines = subLines(P, e, 40, { width: 3024, height: 2016 }).map(text)
    expect(lines.some((l) => /16:9 +3024×1701/.test(l))).toBe(true)
  })

  it('shows the number being typed, with its unit', () => {
    const e = press(press(open(), 'right'), { digit: '5' })
    const lines = subLines(P, e, 40).map(text)
    expect(lines.some((l) => l.includes('To a target size') && l.includes('5'))).toBe(true)
  })

  it('offers the extension with its size, then says it is adding it', () => {
    const at = ['down', 'down', 'down', 'down'] as const
    const e = withMissing(
      at.reduce((x, k) => press(x, k), open()),
      { sharpen: 41_000_000 },
    )
    const offer = press(e, 'space')
    expect(subLines(P, offer, 40).map(text).join('\n')).toContain('add · 41 MB')
    expect(subLines(P, press(offer, 'enter'), 40).map(text).join('\n')).toContain('adding')
  })
})
