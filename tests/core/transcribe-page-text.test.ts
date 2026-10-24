import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  hasText,
  pageHtml,
  pageMarkdown,
  pagePlain,
  pageText,
  type ReadBlock,
  type ReadPage,
} from '../../src/core/transcribe/page-text.js'

/**
 * A picture's or a PDF's text, from what the helper's `read` saw (spec
 * 2026-10-23-extract-text-design §4): Forge orders Vision's blocks, decides
 * the headings and writes the file. The fixtures are the helper's real output
 * (tests/fixtures/README.md, `read/`).
 */
const recorded = (name: string): ReadPage[] =>
  JSON.parse(readFileSync(join(__dirname, '..', 'fixtures', 'read', `${name}.json`), 'utf8')).pages

const text = (t: string, box: [number, number, number, number], more: Partial<ReadBlock> = {}) =>
  ({ kind: 'text', text: t, title: false, lines: 1, lineHeight: 0.016, box, ...more }) as ReadBlock

describe('a page drawn for the spike', () => {
  const md = pageMarkdown(pageText(recorded('doc')))

  it('reads in the order of the page, the table where it stands', () => {
    expect(md).toBe(
      [
        '# Quarterly Field Report',
        '',
        'The survey ran from 3 March to 28 April across four regions. Response rates were higher than expected in the north, where volunteers visited every household twice before marking it as absent.',
        '',
        '## Key findings',
        '',
        '- Water access improved in 62% of villages',
        '- Two clinics closed; one reopened in June',
        '- Average travel time fell from 41 to 27 minutes',
        '',
        '| Region | Households | Responded | Rate |',
        '| --- | --- | --- | --- |',
        '| North | 1,240 | 1,118 | 90% |',
        '| South | 980 | 702 | 72% |',
        '| East | 1,505 | 1,190 | 79% |',
        '| West | 860 | 611 | 71% |',
        '',
        'Contact: field-office@example.org • +1 (415) 555-0134',
        '',
      ].join('\n'),
    )
  })

  const shape = (name: string, headings = true) =>
    pageText(recorded(name))[0]?.map((p) =>
      p.kind === 'heading' ? (headings ? `h${p.level}` : 'paragraph') : p.kind,
    )

  it('comes out the same white on black', () => {
    expect(shape('dark')).toEqual(shape('doc'))
  })

  it('reads a phone photo, upright or stored sideways, in the same order', () => {
    // Blur makes a heading's size unreadable (STANDS_OUT): one may come out a paragraph.
    expect(shape('photo', false)).toEqual(shape('doc', false))
    expect(shape('sideways', false)).toEqual(shape('doc', false))
    expect(pageText(recorded('photo'))[0]?.[0]).toEqual({
      kind: 'heading',
      level: 1,
      text: 'Quarterly Field Report',
    })
  })
})

describe('reading order', () => {
  it('goes down the first column, then the second', () => {
    // Vision dropped the full stop after "number 82" at a line's end: the order is what counts.
    const words = pagePlain(pageText(recorded('columns')))
    const numbers = [...words.matchAll(/number\s+(\d+)\.?/g)].map((m) => Number(m[1]))
    expect(numbers).toEqual(Array.from({ length: 90 }, (_, i) => i + 1))
  })

  it('reads a heading across both columns before either column', () => {
    const page: ReadPage = {
      blocks: [
        text('Right top', [0.55, 0.2, 0.35, 0.1], { lines: 4 }),
        text('Left top', [0.1, 0.2, 0.35, 0.1], { lines: 4 }),
        text('Left bottom', [0.1, 0.35, 0.35, 0.1], { lines: 4 }),
        text('Across', [0.1, 0.05, 0.8, 0.05], { lineHeight: 0.04 }),
        text('Right bottom', [0.55, 0.35, 0.35, 0.1], { lines: 4 }),
      ],
    }
    expect(
      pagePlain(pageText([page]))
        .trimEnd()
        .split('\n\n'),
    ).toEqual(['Across', 'Left top', 'Left bottom', 'Right top', 'Right bottom'])
  })
})

describe('headings', () => {
  it('are only lines that stand out by size, so a page of one size has none', () => {
    const doc = pageText(recorded('cjk'))
    expect(doc[0]?.every((p) => p.kind === 'paragraph')).toBe(true)
  })

  it('are never the only text there is', () => {
    expect(pageText(recorded('ligatures'))).toEqual([
      [{ kind: 'paragraph', text: 'office affine flight waffle efficient' }],
    ])
  })

  it('end with no full stop and fit on one short line', () => {
    const page: ReadPage = {
      blocks: [
        text('A big sentence that ends.', [0.1, 0.1, 0.5, 0.03], { lineHeight: 0.03 }),
        text('Body text that runs on.', [0.1, 0.2, 0.5, 0.05], { lines: 3 }),
      ],
    }
    expect(pageText([page])[0]?.[0]).toEqual({
      kind: 'paragraph',
      text: 'A big sentence that ends.',
    })
  })
})

describe('lists and tables', () => {
  it('number a numbered list', () => {
    const page: ReadPage = {
      blocks: [
        {
          kind: 'list',
          items: [
            { marker: 'decimal', text: 'First' },
            { marker: 'decimal', text: 'Second' },
          ],
          box: [0.1, 0.1, 0.5, 0.1],
        },
      ],
    }
    expect(pageMarkdown(pageText([page]))).toBe('1. First\n2. Second\n')
  })

  it('give a ragged table even rows', () => {
    const page: ReadPage = {
      blocks: [{ kind: 'table', rows: [['a', 'b', 'c'], ['d']], box: [0.1, 0.1, 0.5, 0.1] }],
    }
    expect(pageMarkdown(pageText([page]))).toBe('| a | b | c |\n| --- | --- | --- |\n| d |  |  |\n')
  })
})

describe('the Markdown keeps the text the text', () => {
  const md = (t: string) =>
    pageMarkdown(pageText([{ blocks: [text(t, [0.1, 0.1, 0.5, 0.05], { lines: 2 })] }]))

  it('escapes what Markdown would read as marks', () => {
    expect(md('# not a heading')).toBe('\\# not a heading\n')
    expect(md('- not a point')).toBe('\\- not a point\n')
    expect(md('1. not a list')).toBe('1\\. not a list\n')
    expect(md('*bold* and `code` and [link]')).toBe('\\*bold\\* and \\`code\\` and \\[link\\]\n')
    expect(md('<b> and a\\b')).toBe('\\<b> and a\\\\b\n')
  })

  it('leaves an underscore inside a word alone', () => {
    expect(md('snake_case and _this_')).toBe('snake_case and \\_this\\_\n')
  })

  it('escapes a pipe in a table cell', () => {
    const page: ReadPage = {
      blocks: [{ kind: 'table', rows: [['a|b'], ['c']], box: [0.1, 0.1, 0.5, 0.1] }],
    }
    expect(pageMarkdown(pageText([page]))).toContain('| a\\|b |')
  })
})

describe('the plain words', () => {
  it('have no marks: a heading bare, a table in tabs', () => {
    expect(pagePlain(pageText(recorded('doc')))).toBe(
      [
        'Quarterly Field Report',
        '',
        'The survey ran from 3 March to 28 April across four regions. Response rates were higher than expected in the north, where volunteers visited every household twice before marking it as absent.',
        '',
        'Key findings',
        '',
        '- Water access improved in 62% of villages',
        '- Two clinics closed; one reopened in June',
        '- Average travel time fell from 41 to 27 minutes',
        '',
        'Region\tHouseholds\tResponded\tRate',
        'North\t1,240\t1,118\t90%',
        'South\t980\t702\t72%',
        'East\t1,505\t1,190\t79%',
        'West\t860\t611\t71%',
        '',
        'Contact: field-office@example.org • +1 (415) 555-0134',
        '',
      ].join('\n'),
    )
  })

  it('are never escaped', () => {
    const doc = pageText([{ blocks: [text('# snake_case *x*', [0.1, 0.1, 0.5, 0.05])] }])
    expect(pagePlain(doc)).toBe('# snake_case *x*\n')
  })
})

describe('pages', () => {
  const two = pageText([
    { blocks: [text('One', [0.1, 0.1, 0.5, 0.05], { lines: 2 })] },
    { blocks: [] },
    { blocks: [text('Two', [0.1, 0.1, 0.5, 0.05], { lines: 2 })] },
  ])

  it('are ruled apart in Markdown, a page with no text left out', () => {
    expect(pageMarkdown(two)).toBe('One\n\n---\n\nTwo\n')
  })

  it('are a blank line apart in the plain words', () => {
    expect(pagePlain(two)).toBe('One\n\nTwo\n')
  })
})

describe('whether there is any text', () => {
  it('is no for a page Vision found nothing on', () => {
    expect(hasText(pageText(recorded('hebrew')))).toBe(false)
  })

  it('is yes for the spike page', () => {
    expect(hasText(pageText(recorded('doc')))).toBe(true)
  })
})

describe('a page from the line reader (no document reader)', () => {
  it('joins lines close together into one paragraph', () => {
    const page: ReadPage = {
      lines: true,
      blocks: [
        text('The first line', [0.1, 0.1, 0.5, 0.02], { lineHeight: 0.02 }),
        text('and the second.', [0.1, 0.125, 0.5, 0.02], { lineHeight: 0.02 }),
        text('A new paragraph.', [0.1, 0.3, 0.5, 0.02], { lineHeight: 0.02 }),
      ],
    }
    expect(pagePlain(pageText([page]))).toBe('The first line and the second.\n\nA new paragraph.\n')
  })
})

describe('the HTML for Word and PDF', () => {
  const html = pageHtml(pageText(recorded('doc')), 'shot.png')

  it('has the headings, the list and the table', () => {
    expect(html).toContain('<h1>Quarterly Field Report</h1>')
    expect(html).toContain('<h2>Key findings</h2>')
    expect(html).toContain('<li>Two clinics closed; one reopened in June</li>')
    expect(html).toContain('<th>Region</th>')
    expect(html).toContain('<td>1,240</td>')
  })

  it('escapes the text and names the document after the file', () => {
    const doc = pageText([
      { blocks: [text('Fish & <chips>', [0.1, 0.1, 0.5, 0.05], { lines: 2 })] },
    ])
    const out = pageHtml(doc, 'menu.png')
    expect(out).toContain('<p>Fish &amp; &lt;chips&gt;</p>')
    expect(out).toContain('<title>menu.png</title>')
  })

  it('spreads a table across the page, a little space above and below it', () => {
    expect(html).toContain('table{border-collapse:collapse;width:100%')
    // AppKit's HTML reader keeps no margin round a table: a small empty paragraph does it.
    const gap = '<p style="margin:0;font-size:5pt">&nbsp;</p>'
    expect(html).toContain(`${gap}<table>`)
    expect(html).toContain(`</table>${gap}`)
  })

  it('numbers a numbered list', () => {
    const doc = pageText([
      {
        blocks: [
          { kind: 'list', items: [{ marker: 'decimal', text: 'A' }], box: [0.1, 0.1, 0.5, 0.1] },
        ],
      },
    ])
    expect(pageHtml(doc, 'x.png')).toContain('<ol><li>A</li></ol>')
  })
})
