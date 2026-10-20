import { describe, expect, it } from 'vitest'
import {
  clock,
  DISCLAIMER,
  paragraphs,
  type Segment,
  transcriptMarkdown,
} from '../../src/core/transcribe/markdown.js'

const words = (n: number, word = 'word') => Array.from({ length: n }, () => word).join(' ')
const seg = (start: number, end: number, text: string): Segment => ({ start, end, text })

describe('clock', () => {
  it.each([
    [0, '0:00'],
    [9.6, '0:09'],
    [854.2, '14:14'],
    [3717.9, '1:01:57'],
  ])('writes %s seconds as %s', (s, want) => {
    expect(clock(s)).toBe(want)
  })
})

describe('paragraphs', () => {
  it('joins short sentences into one paragraph', () => {
    expect(paragraphs([seg(0, 2, 'One.'), seg(2.1, 4, 'Two.')])).toEqual([
      { start: 0, text: 'One. Two.' },
    ])
  })

  it('breaks at a pause once a paragraph has 60 words', () => {
    const out = paragraphs([seg(0, 20, words(60)), seg(21.5, 23, 'After the pause.')])
    expect(out.map((p) => p.start)).toEqual([0, 21.5])
  })

  it('keeps going through a pause before 60 words', () => {
    const out = paragraphs([seg(0, 20, words(59)), seg(21.5, 23, 'Still the same.')])
    expect(out).toHaveLength(1)
  })

  it('breaks at a silence of more than 10 s, however short the paragraph', () => {
    const out = paragraphs([seg(0, 2, 'Short.'), seg(12.5, 14, 'Much later.')])
    expect(out.map((p) => p.start)).toEqual([0, 12.5])
  })

  it('breaks without a pause at 140 words', () => {
    const out = paragraphs([seg(0, 40, words(140)), seg(40, 41, 'Next.')])
    expect(out.map((p) => p.start)).toEqual([0, 40])
  })
})

describe('transcriptMarkdown', () => {
  const segments = [
    seg(0, 3, 'Hello and welcome.'),
    seg(3.2, 6, 'Today is about tea.'),
    seg(70, 72, 'Now, milk.'),
  ]

  it('writes notes first, then the transcript under the same headings', () => {
    const md = transcriptMarkdown(
      {
        seconds: 75,
        segments,
        notes: {
          summary: 'A short talk about tea.',
          parts: [
            { start: 0, heading: 'Welcome', points: ['It is about tea.'], refused: false },
            {
              start: 70,
              heading: 'Milk',
              points: ['Milk goes in last.', 'Or first.'],
              refused: false,
            },
          ],
        },
      },
      { title: 'Tea talk', from: 'https://www.youtube.com/watch?v=jNQXAC9IVRw' },
    )
    expect(md).toBe(
      [
        '# Tea talk',
        '',
        '<https://www.youtube.com/watch?v=jNQXAC9IVRw>',
        '',
        'A short talk about tea.',
        '',
        '## Notes',
        '',
        '### Welcome · 0:00',
        '',
        '- It is about tea.',
        '',
        '### Milk · 1:10',
        '',
        '- Milk goes in last.',
        '- Or first.',
        '',
        '## Transcript',
        '',
        '### Welcome · 0:00',
        '',
        '**0:00** Hello and welcome. Today is about tea.',
        '',
        '### Milk · 1:10',
        '',
        '**1:10** Now, milk.',
        '',
        `_${DISCLAIMER}_`,
        '',
      ].join('\n'),
    )
  })

  it('leaves the transcript out when only the notes are wanted', () => {
    const md = transcriptMarkdown(
      {
        seconds: 75,
        segments,
        notes: {
          summary: 'A short talk.',
          parts: [{ start: 0, heading: 'Welcome', points: ['Hi.'], refused: false }],
        },
      },
      { title: 'Tea talk', from: 'tea.m4a' },
      { transcript: false },
    )
    expect(md).toContain('## Notes\n\n### Welcome · 0:00\n\n- Hi.')
    expect(md).not.toContain('## Transcript')
    expect(md).not.toContain('**0:00**')
    expect(md.trimEnd().endsWith(`_${DISCLAIMER}_`)).toBe(true)
    expect(md).toContain('tea.m4a')
  })

  it('names a refused part by its number and gives it no notes', () => {
    const md = transcriptMarkdown(
      {
        seconds: 75,
        segments,
        notes: {
          summary: 'A short talk.',
          parts: [
            { start: 0, heading: 'Welcome', points: ['Hi.'], refused: false },
            { start: 70, heading: '', points: [], refused: true },
          ],
        },
      },
      { title: 'Tea talk', from: 'tea.m4a' },
    )
    expect(md).toContain(
      '## Notes\n\n### Welcome · 0:00\n\n- Hi.\n\n### Part 2 · 1:10\n\n## Transcript',
    )
    expect(md).toContain('### Part 2 · 1:10\n\n**1:10** Now, milk.')
  })

  it('writes only the transcript, with no headings or disclaimer, when there are no notes', () => {
    const md = transcriptMarkdown({ seconds: 75, segments }, { title: 'Tea talk', from: 'tea.m4a' })
    expect(md).toBe(
      [
        '# Tea talk',
        '',
        'tea.m4a',
        '',
        '**0:00** Hello and welcome. Today is about tea.',
        '',
        '**1:10** Now, milk.',
        '',
      ].join('\n'),
    )
  })
})
