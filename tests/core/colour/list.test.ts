import { describe, expect, it } from 'vitest'
import { readColourList } from '../../../src/core/colour/list.js'

const pairs = (text: string) => readColourList(text).colours.map((c) => [c.name, c.hex])

describe('readColourList', () => {
  describe('design tokens (JSON)', () => {
    it('reads DTCG tokens, a lone top-level group dropped, groups joined by /', () => {
      const text = JSON.stringify({
        color: {
          bg: { $type: 'color', $value: '#f8f1e6', $description: 'background' },
          // Number-like keys come out in ascending order, as JSON objects keep them.
          blue: {
            600: { $type: 'color', $value: '#1c50b5' },
            500: { $value: '#2e62c9' },
          },
        },
      })
      expect(pairs(text)).toEqual([
        ['bg', '#F8F1E6'],
        ['blue/500', '#2E62C9'],
        ['blue/600', '#1C50B5'],
      ])
    })

    it('follows an alias to the colour it names', () => {
      const text = JSON.stringify({
        blue: { 500: { $value: '#2e62c9' } },
        accent: { $value: '{blue.500}' },
      })
      expect(pairs(text)).toEqual([
        ['blue/500', '#2E62C9'],
        ['accent', '#2E62C9'],
      ])
    })

    it('reads a flat name-to-colour object, and leaves out tokens that are not colours', () => {
      const text = JSON.stringify({ bg: '#fff', ink: 'rgb(30 26 21)', space: { $value: '4px' } })
      expect(pairs(text)).toEqual([
        ['bg', '#FFFFFF'],
        ['ink', '#1E1A15'],
      ])
      expect(readColourList(text).bad).toEqual([])
    })

    it('reads a list of { name, hex } objects', () => {
      const text = JSON.stringify([
        { name: 'bg', hex: '#f8f1e6' },
        { name: 'ink', colour: '#1e1a15' },
      ])
      expect(pairs(text)).toEqual([
        ['bg', '#F8F1E6'],
        ['ink', '#1E1A15'],
      ])
    })

    it('a colour token whose value is not a colour is bad, by name', () => {
      const text = JSON.stringify({ bg: { $type: 'color', $value: 'brand blue' } })
      expect(readColourList(text).bad).toEqual(['bg: brand blue'])
    })
  })

  describe('lines', () => {
    it('reads CSV with a header, by its name and hex columns, quoted commas kept', () => {
      const text = 'name,hex,note\nbg,#f8f1e6,"background, warm"\n"blue-600",#1c50b5,links\n'
      expect(pairs(text)).toEqual([
        ['bg', '#F8F1E6'],
        ['blue-600', '#1C50B5'],
      ])
    })

    it('reads CSV whose colour column comes first', () => {
      expect(pairs('colour,name\n#f8f1e6,bg\n')).toEqual([['bg', '#F8F1E6']])
    })

    it('reads CSS custom properties, comments and the rule around them left out', () => {
      const text = [
        ':root {',
        '  --color-bg: #f8f1e6; /* background */',
        '  --color-ink: rgb(30 26 21);',
        '  --radius: 4px;',
        '}',
      ].join('\n')
      expect(pairs(text)).toEqual([
        ['color-bg', '#F8F1E6'],
        ['color-ink', '#1E1A15'],
      ])
      expect(readColourList(text).bad).toEqual([])
    })

    it('reads name and colour separated by spaces, a tab, a colon or an equals sign', () => {
      const text = 'bg  #f8f1e6\nink\t#1e1a15\nline: #ddd7cd\nblue-600 = #1c50b5\n'
      expect(pairs(text)).toEqual([
        ['bg', '#F8F1E6'],
        ['ink', '#1E1A15'],
        ['line', '#DDD7CD'],
        ['blue-600', '#1C50B5'],
      ])
    })

    it('reads the colour first and the name after, and a colour alone named by its hex', () => {
      expect(pairs('#f8f1e6 warm paper\n#1c50b5\n')).toEqual([
        ['warm paper', '#F8F1E6'],
        ['#1C50B5', '#1C50B5'],
      ])
    })

    it('reads a colour with spaces in it, and a list item marker', () => {
      expect(pairs('- ink: rgb(30 26 21)\n* text secondary  oklch(0.45 0.01 70)\n')).toEqual([
        ['ink', '#1E1A15'],
        ['text secondary', expect.stringMatching(/^#[0-9A-F]{6}$/)],
      ])
    })

    it('skips blank lines and comments, and lists every other line it cannot read', () => {
      const text = '# Cream blue\n// made by hand\n\nbg #f8f1e6\naccent to be decided\nline #12\n'
      const out = readColourList(text)
      expect(out.colours.map((c) => c.name)).toEqual(['bg'])
      expect(out.bad).toEqual(['accent to be decided', 'line #12'])
    })

    it('keeps a see-through colour see-through', () => {
      const [c] = readColourList('scrim #00000080\n').colours
      expect(c?.hex).toBe('#000000')
      expect(c?.alpha).toBeCloseTo(0.5, 2)
    })
  })

  it('finds nothing in text with no colours', () => {
    expect(readColourList('hello\nworld\n')).toEqual({ colours: [], bad: ['hello', 'world'] })
    expect(readColourList('')).toEqual({ colours: [], bad: [] })
  })
})
