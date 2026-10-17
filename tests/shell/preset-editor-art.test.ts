import { describe, expect, it } from 'vitest'
import type { Row } from '../../src/shell/home-art.js'
import { openEditor, press } from '../../src/shell/preset-editor.js'
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
const foot: Row = [{ text: '✓ photo.webp   now 2 MB' }]

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
})
