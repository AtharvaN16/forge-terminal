import { describe, expect, it } from 'vitest'
import { CSS_NAMES, XKCD_NAMES } from '../../../src/core/colour/colour-names.js'
import { parseColour } from '../../../src/core/colour/parse.js'
import { parseHex, toHex } from '../../../src/core/colour/space.js'

const hex = (input: string) => {
  const p = parseColour(input)
  return p && toHex(p.rgb)
}

describe('parseColour: hex', () => {
  it('reads three and six digits exactly as parseHex does', () => {
    for (const s of ['#abc', 'abc', '#6579FD', '6579fd', '  #6579FD  ', '#000', '#FFFFFF']) {
      expect(parseColour(s)?.rgb, s).toEqual(parseHex(s))
      expect(parseColour(s)?.alpha, s).toBeUndefined()
    }
  })

  it('reads four and eight digits, the last pair being alpha', () => {
    expect(parseColour('#ABCD')).toEqual({ rgb: { r: 170, g: 187, b: 204 }, alpha: 0xdd / 255 })
    expect(parseColour('6579fd80')).toEqual({ rgb: { r: 101, g: 121, b: 253 }, alpha: 128 / 255 })
  })
})

describe('parseColour: rgb()', () => {
  it('reads the modern space syntax', () => {
    expect(parseColour('rgb(210 4 45)')).toEqual({ rgb: { r: 210, g: 4, b: 45 } })
    expect(parseColour('  RGB(  210   4 45 )  ')).toEqual({ rgb: { r: 210, g: 4, b: 45 } })
  })

  it('reads the legacy comma syntax, with and without alpha', () => {
    expect(parseColour('rgb(210,4,45)')).toEqual({ rgb: { r: 210, g: 4, b: 45 } })
    expect(parseColour('rgba(210, 4, 45, 0.5)')).toEqual({
      rgb: { r: 210, g: 4, b: 45 },
      alpha: 0.5,
    })
  })

  it('reads percentages and a slash alpha', () => {
    expect(parseColour('rgb(82% 2% 18% / 50%)')).toEqual({
      rgb: { r: 209, g: 5, b: 46 },
      alpha: 0.5,
    })
    expect(parseColour('rgba(100% 0% 0%/0.25)')).toEqual({
      rgb: { r: 255, g: 0, b: 0 },
      alpha: 0.25,
    })
  })
})

describe('parseColour: hsl()', () => {
  it('reads a bare hue, deg, turn and rad', () => {
    expect(hex('hsl(230 97% 69%)')).toBe(hex('hsl(230deg, 97%, 69%)'))
    expect(hex('hsl(230 97% 69%)')).toBe('#637DFD')
    expect(hex('hsl(0.5turn 50% 50%)')).toBe('#40BFBF')
    expect(hex(`hsl(${Math.PI}rad 50% 50%)`)).toBe('#40BFBF')
    expect(hex('hsl(0 100% 50%)')).toBe('#FF0000')
    expect(hex('hsl(480 100% 50%)')).toBe('#00FF00')
  })

  it('reads an alpha, legacy or modern', () => {
    expect(parseColour('hsla(0, 100%, 50%, 0.3)')?.alpha).toBe(0.3)
    expect(parseColour('hsl(0 100% 50% / 30%)')?.alpha).toBe(0.3)
  })
})

describe('parseColour: oklch() and oklab()', () => {
  const near = (input: string, want: string) => {
    const got = parseColour(input)?.rgb
    const w = parseHex(want)
    expect(got, input).toBeDefined()
    if (!got || !w) return
    for (const k of ['r', 'g', 'b'] as const)
      expect(Math.abs(got[k] - w[k]), `${input} ${k}`).toBeLessThanOrEqual(1)
  }

  it('reads L as a percentage or 0–1, C as a number or a percentage of 0.4', () => {
    near('oklch(63% 0.196 273)', '#6579FD')
    near('oklch(0.63 0.196 273)', '#6579FD')
    near('oklch(63% 49% 273deg)', '#6579FD')
    expect(parseColour('oklch(63% 0.196 273 / 0.5)')?.alpha).toBe(0.5)
  })

  it('clamps a colour outside sRGB rather than refusing it', () => {
    expect(hex('oklch(60% 0.4 30)')).toMatch(/^#[0-9A-F]{6}$/)
  })

  it('reads oklab the same way', () => {
    near('oklab(0.628 0.2249 0.1258)', '#FF0000')
    near('oklab(62.8% 56.2% 31.4%)', '#FF0000')
    expect(parseColour('oklab(1 0 0)')?.rgb).toEqual({ r: 255, g: 255, b: 255 })
  })
})

describe('parseColour: names', () => {
  it('knows the CSS names, any case', () => {
    expect(hex('crimson')).toBe('#DC143C')
    expect(hex('CRIMSON')).toBe('#DC143C')
    expect(hex('rebeccapurple')).toBe('#663399')
    expect(hex('grey')).toBe('#808080')
  })

  it('knows the xkcd names, spaces, hyphens and underscores alike', () => {
    for (const s of ['cherry red', 'Cherry-Red', 'cherryred', 'cherry_red', '  cherry   red ']) {
      expect(hex(s), s).toBe('#F7022A')
    }
  })

  it('lets CSS win where both lists have a name', () => {
    expect(XKCD_NAMES.crimson).toBeDefined()
    expect(hex('crimson')).toBe(CSS_NAMES.crimson?.toUpperCase())
  })

  it('carries the full lists', () => {
    expect(Object.keys(CSS_NAMES)).toHaveLength(148)
    expect(Object.keys(XKCD_NAMES)).toHaveLength(949)
    expect(CSS_NAMES.transparent).toBeUndefined()
    expect(CSS_NAMES.currentcolor).toBeUndefined()
  })
})

describe('parseColour: refusals', () => {
  it('refuses what it cannot read', () => {
    for (const bad of [
      '',
      '   ',
      'rgb(300 0 0)',
      'rgb(-1 0 0)',
      'rgb(101% 0% 0%)',
      'rgb(1 2)',
      'rgb(1 2 3 4)',
      'rgb(1, 2 3)',
      'rgb(1 2 3 / 2)',
      'rgb(1 2 3',
      'hsl(0 120% 50%)',
      'hsl(0 50 50)',
      'hsl(0deg 50% 50% / 150%)',
      'oklch(1.2 0.1 0)',
      'oklch(50% -0.1 0)',
      'oklch(0.5, 0.1, 0)',
      'oklab(0.5 0.1)',
      'cmyk(0 0 0 0)',
      '#12',
      '#12345',
      '#1234567',
      '#GGG',
      'notacolour',
    ]) {
      expect(parseColour(bad), bad).toBeUndefined()
    }
  })
})
