import { describe, expect, it } from 'vitest'
import { contrast, onWhiteAndBlack, rate } from '../../../src/core/colour/contrast.js'
import { hueName } from '../../../src/core/colour/names.js'
import { parseHex } from '../../../src/core/colour/space.js'

const hex = (h: string) => parseHex(h) as NonNullable<ReturnType<typeof parseHex>>

describe('contrast', () => {
  it('is the WCAG 2 ratio', () => {
    expect(contrast(hex('#000000'), hex('#FFFFFF'))).toBeCloseTo(21, 5)
    expect(contrast(hex('#777777'), hex('#FFFFFF'))).toBeCloseTo(4.48, 2)
    expect(contrast(hex('#FFFFFF'), hex('#777777'))).toBeCloseTo(4.48, 2)
  })

  it('rates at the WCAG thresholds', () => {
    expect([7, 6.99, 4.5, 4.49, 3, 2.99].map(rate)).toEqual([
      'AAA',
      'AA',
      'AA',
      'large',
      'large',
      'fails',
    ])
  })

  it('gives white and black to one decimal', () => {
    expect(onWhiteAndBlack(hex('#6579FD'))).toEqual({ white: 3.7, black: 5.7 })
  })
})

describe('hueName', () => {
  it('names the family, or grey when there is no colour to name', () => {
    const names = [
      '#FF0000',
      '#FF8000',
      '#FFFF00',
      '#00FF00',
      '#00FFFF',
      '#0000FF',
      '#6579FD',
      '#808080',
      '#FFFFFF',
    ].map((h) => hueName(hex(h)))
    expect(names).toEqual([
      'red',
      'orange',
      'yellow',
      'green',
      'cyan',
      'blue',
      'blue',
      'grey',
      'grey',
    ])
  })
})
