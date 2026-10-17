import { describe, expect, it } from 'vitest'
import { fieldKey } from '../../src/shell/field-key.js'
import { DARK, NEUTRAL } from '../../src/shell/theme.js'

describe('fieldKey', () => {
  it('draws the key on a chip in the colour, and the words after it in the same colour', () => {
    const row = fieldKey({
      palette: DARK,
      key: '⌘V',
      words: 'to paste from clipboard',
      colour: '#79c98b',
    })
    expect(row).toEqual([
      { text: ' ⌘V ', fg: DARK.ink, bg: '#79c98b', bold: true },
      { text: ' to paste from clipboard', fg: '#79c98b' },
    ])
  })

  it('takes the chip’s text colour when the fill is not a mode’s colour', () => {
    const row = fieldKey({
      palette: DARK,
      key: '↵',
      words: 'done',
      colour: DARK.border,
      ink: DARK.canvas,
    })
    expect(row[0]).toEqual({ text: ' ↵ ', fg: DARK.canvas, bg: DARK.border, bold: true })
  })

  it('brackets the key where there is no fill to draw a chip', () => {
    const row = fieldKey({
      palette: NEUTRAL,
      key: '⌘V',
      words: 'to paste from clipboard',
      colour: '',
    })
    expect(row.map((r) => r.text).join('')).toBe('[⌘V] to paste from clipboard')
    expect(row.some((r) => r.bg)).toBe(false)
  })
})
