import { describe, expect, it } from 'vitest'
import { DARK, LIGHT, NEUTRAL, type Palette, colourProp, paletteFor } from '../../src/shell/theme.js'

const KEYS: (keyof Palette)[] = [
  'name',
  'fg',
  'dim',
  'accent',
  'ok',
  'warn',
  'fail',
  'tag',
  'label',
  'border',
  'selectionBg',
]

describe('palettes', () => {
  it('both themes define every key', () => {
    for (const p of [DARK, LIGHT]) {
      for (const k of KEYS) {
        expect(p[k], `${p.name} is missing ${k}`).toBeTruthy()
      }
    }
  })

  it('the two palettes are genuinely different, not one dimmed', () => {
    const differing = KEYS.filter((k) => k !== 'name').filter((k) => DARK[k] !== LIGHT[k])
    expect(differing.length).toBeGreaterThan(6)
  })

  it('paletteFor maps the stored theme value', () => {
    expect(paletteFor('dark')).toBe(DARK)
    expect(paletteFor('light')).toBe(LIGHT)
  })

  it('paletteFor falls back to neutral when no theme has been chosen', () => {
    expect(paletteFor(undefined)).toBe(NEUTRAL)
  })

  it('neutral sets no background fill, so it is legible on either terminal', () => {
    expect(NEUTRAL.selectionBg).toBe('')
  })

  it('neutral sets no foreground either, inheriting the terminal default', () => {
    expect(NEUTRAL.fg).toBe('')
  })
})

describe('colourProp', () => {
  it('turns an empty palette value into undefined, which Ink reads as unset', () => {
    expect(colourProp('')).toBeUndefined()
  })

  it('passes a real colour through untouched', () => {
    expect(colourProp('#e5a23c')).toBe('#e5a23c')
    expect(colourProp('green')).toBe('green')
  })
})
