import { describe, expect, it } from 'vitest'
import { windowOver } from '../../src/shell/colour/system-art.js'
import { blank } from '../../src/shell/home-art.js'
import { DARK } from '../../src/shell/theme.js'

const text = (row: { text: string }[] | undefined) => (row ?? []).map((r) => r.text).join('')

describe('windowOver', () => {
  const under = Array.from({ length: 10 }, () => [blank(80)])
  const lines = [[{ text: 'hello' }]]

  it('centres the window when no left edge is given', () => {
    const rows = windowOver(DARK, under, { title: 'T', lines, width: 20, columns: 80, top: 2 })
    expect(text(rows[2]).indexOf('╭')).toBe(30)
  })

  it('opens at a given left edge: a row’s own window, under the row', () => {
    const rows = windowOver(DARK, under, {
      title: 'T',
      lines,
      width: 20,
      columns: 80,
      top: 2,
      left: 25,
    })
    expect(text(rows[2]).indexOf('╭')).toBe(25)
    expect(text(rows[3])).toContain('│hello')
  })
})
