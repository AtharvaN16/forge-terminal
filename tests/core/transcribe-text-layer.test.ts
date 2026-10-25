import { describe, expect, it } from 'vitest'
import { distance, layerWords, mendLine, mendPage } from '../../src/core/transcribe/text-layer.js'

describe('the text layer mends what OCR broke at ligatures', () => {
  const words = layerWords('office aﬃne ﬂight waﬄe eﬃcient')

  it('unfolds the ligatures the PDF stored as single letters', () => {
    expect([...words]).toEqual(['office', 'affine', 'flight', 'waffle', 'efficient'])
  })

  it('joins and mends the pieces at 150 and 200 dpi alike', () => {
    expect(mendLine('office affi n fl ight waff e ficient', words)).toBe(
      'office affine flight waffle efficient',
    )
    expect(mendLine('offi ce affi n fi ight waff e ffi cient', words)).toBe(
      'office affine flight waffle efficient',
    )
  })

  it('writes nothing that is not on the page, and leaves words of the page alone', () => {
    expect(mendLine('a cat sat', words)).toBe('a cat sat')
    expect(mendLine('flight office', words)).toBe('flight office')
  })

  it('keeps punctuation where it was read', () => {
    expect(mendLine('(waff e),', words)).toBe('(waffle),')
  })

  it('does nothing without a text layer (a scan)', () => {
    const page = {
      blocks: [
        {
          kind: 'text' as const,
          text: 'waff e',
          title: false,
          lines: 1,
          lineHeight: 0.01,
          box: [0, 0, 1, 1] as const,
        },
      ],
    }
    expect(mendPage(page, '')).toBe(page)
  })

  it('mends lists and tables too', () => {
    const page = {
      blocks: [
        {
          kind: 'list' as const,
          items: [{ marker: 'bullet' as const, text: 'waff e' }],
          box: [0, 0, 1, 1] as const,
        },
        { kind: 'table' as const, rows: [['fl ight', 'office']], box: [0, 0, 1, 1] as const },
      ],
    }
    expect(mendPage(page, 'waﬄe ﬂight office').blocks).toEqual([
      { kind: 'list', items: [{ marker: 'bullet', text: 'waffle' }], box: [0, 0, 1, 1] },
      { kind: 'table', rows: [['flight', 'office']], box: [0, 0, 1, 1] },
    ])
  })

  it('counts edits, giving up past the limit', () => {
    expect(distance('waffe', 'waffle', 1)).toBe(1)
    expect(distance('cat', 'efficient', 2)).toBe(3)
  })
})
