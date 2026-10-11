import { describe, expect, it } from 'vitest'
import {
  DARK,
  LIGHT,
  MODE_MARKERS,
  modeColours,
  modePalette,
  NEUTRAL,
} from '../../src/shell/theme.js'

describe('modePalette', () => {
  it('gives the role colours to the mode', () => {
    for (const base of [DARK, LIGHT, NEUTRAL]) {
      const c = modePalette(base, 'compress')
      expect(c.accent).toBe(base.modeCompress)
      expect(c.tag).toBe(base.modeCompress)
      expect(c.label).toBe(base.modeCompress)
      expect(modePalette(base, 'convert').accent).toBe(base.modeConvert)
      expect(modePalette(base, 'pdf').accent).toBe(base.modePdf)
    }
  })

  it('never moves the outcome colours or the brand', () => {
    const c = modePalette(DARK, 'pdf')
    expect(c.ok).toBe(DARK.ok)
    expect(c.fail).toBe(DARK.fail)
    expect(c.warn).toBe(DARK.warn)
    expect(c.larger).toBe(DARK.larger)
    expect(c.brand).toBe(DARK.brand)
  })

  it('keeps NEUTRAL on ANSI names so first run reads on any background', () => {
    expect(modePalette(NEUTRAL, 'convert').accent).toBe('cyan')
  })

  it('pairs each mode with its fill and marker', () => {
    expect(modeColours(DARK, 'convert')).toEqual({ fg: DARK.modeConvert, bg: DARK.modeConvertBg })
    expect(modeColours(DARK, 'pdf')).toEqual({ fg: DARK.modePdf, bg: DARK.modePdfBg })
    expect(MODE_MARKERS).toEqual({ convert: '↔', compress: '↓', pdf: '▣' })
  })

  it('defines brand and keycapBg on every real palette', () => {
    for (const p of [DARK, LIGHT]) {
      expect(p.brand).toMatch(/^#[0-9a-f]{6}$/)
      expect(p.keycapBg).toMatch(/^#[0-9a-f]{6}$/)
    }
    expect(NEUTRAL.keycapBg).toBe('')
  })
})
