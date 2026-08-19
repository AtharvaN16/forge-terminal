import { describe, expect, it } from 'vitest'
import {
  colourProp,
  DARK,
  LIGHT,
  NEUTRAL,
  type Palette,
  paletteFor,
} from '../../src/shell/theme.js'

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

/**
 * Relative luminance and contrast ratio per WCAG 2.1. Kept here rather than
 * in src/: nothing the app does at runtime needs it, but a palette edit that
 * quietly drops a colour below the threshold is exactly the regression that
 * would otherwise ship unnoticed — it looked fine on the machine that made it.
 */
function luminance(hex: string): number {
  const n = Number.parseInt(hex.slice(1), 16)
  const channels = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * (channels[0] ?? 0) + 0.7152 * (channels[1] ?? 0) + 0.0722 * (channels[2] ?? 0)
}

function contrast(a: string, b: string): number {
  const x = luminance(a)
  const y = luminance(b)
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)
}

describe('palette contrast', () => {
  // Representative backgrounds: a typical dark terminal, and plain white.
  const DARK_BG = '#1e1e1e'
  const LIGHT_BG = '#ffffff'

  const TEXT_KEYS = ['fg', 'dim', 'accent', 'ok', 'warn', 'fail', 'tag', 'label'] as const

  it('every dark text colour clears 4.5:1 on a dark terminal', () => {
    for (const k of TEXT_KEYS) {
      expect(contrast(DARK[k], DARK_BG), `DARK.${k}`).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('every light text colour clears 4.5:1 on white', () => {
    for (const k of TEXT_KEYS) {
      expect(contrast(LIGHT[k], LIGHT_BG), `LIGHT.${k}`).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('borders clear the 3:1 wanted for a boundary, within rounding', () => {
    expect(contrast(DARK.border, DARK_BG)).toBeGreaterThanOrEqual(2.9)
    expect(contrast(LIGHT.border, LIGHT_BG)).toBeGreaterThanOrEqual(2.9)
  })

  it('each palette is unreadable on the other background, which is why there are two', () => {
    // Not a curiosity: this is the failure the theme setting exists to avoid,
    // and it is worth pinning that it really is a failure.
    expect(contrast(DARK.fg, LIGHT_BG)).toBeLessThan(2)
    expect(contrast(LIGHT.fg, DARK_BG)).toBeLessThan(2)
  })
})
