import { describe, expect, it } from 'vitest'
import type { ImageInfo } from '../../src/core/types.js'
import { editRows } from '../../src/shell/edit.js'
import type { Row } from '../../src/shell/home-art.js'
import {
  exactFromWidth,
  exactPairRows,
  resizeResultRows,
  resizeSliderRows,
} from '../../src/shell/resize-art.js'
import { DARK } from '../../src/shell/theme.js'

const text = (row: Row | undefined) => (row ?? []).map((r) => r.text).join('')
const PHOTO = { width: 4032, height: 3024 }

describe('Resize’s slider (H3)', () => {
  it('centres 100 %, says which way is which, and offers # on the band’s row', () => {
    const [band, ends] = resizeSliderRows({ palette: DARK, percent: 100 })
    expect(text(band).indexOf(' 100% ')).toBe(2 + Math.round((48 - 6) / 2))
    expect(text(ends).trim()).toMatch(/^smaller +same size +larger$/)
    const centre = text(ends).indexOf('same size') + 'same size'.length / 2
    expect(Math.abs(centre - (2 + 48 / 2))).toBeLessThanOrEqual(1)
    expect(text(band)).toMatch(/ # {2}type an exact size$/)
  })

  it('says what the size becomes, and that past 100 % it is softer', () => {
    const at = (percent: number) =>
      resizeResultRows({ palette: DARK, from: PHOTO, percent }).map((r) => text(r).trim())
    expect(at(100)).toEqual(['same size · 4032 × 3024'])
    expect(at(50)).toEqual(['becomes 2016 × 1512'])
    expect(at(150)).toEqual([
      'becomes 6048 × 4536',
      'stretched, so softer · Boost resolution adds detail',
    ])
  })
})

describe('the exact pair (X)', () => {
  it('keeps the shape from a typed width, and draws the side that follows dim', () => {
    expect(exactFromWidth(PHOTO, 1200)).toEqual({ width: 1200, height: 900 })
    const rows = exactPairRows({
      palette: DARK,
      mode: 'edit',
      width: '1200',
      height: '900',
      focus: 'width',
      follows: true,
    })
    const mid = rows[1] ?? []
    expect(mid.find((r) => r.text === '1200')?.fg).toBe(DARK.fg)
    expect(mid.find((r) => r.text === '900')?.fg).toBe(DARK.dim)
    expect(text(mid)).toContain('keeps its shape')
  })
})

describe('the Trim row', () => {
  it('is dimmed, saying why, when there is nothing to trim or it is an animation', () => {
    const img = {
      kind: 'image',
      path: '/p/a.png',
      format: 'png',
      bytes: 1,
      hasAlpha: false,
      frames: 1,
      ...PHOTO,
    } as ImageInfo
    const trim = (trimmed: 'nothing' | 'animated') =>
      editRows(img, { upright: PHOTO, trimmed }).find((r) => r.id === 'trim')?.tooLarge
    expect([trim('nothing'), trim('animated')]).toEqual(['no empty edges', 'animated'])
  })
})
