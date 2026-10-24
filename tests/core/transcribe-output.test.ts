import { describe, expect, it } from 'vitest'
import { transcriptMarkdown } from '../../src/core/transcribe/markdown.js'
import {
  DEFAULT_OUTPUT,
  markdownHtml,
  markdownPages,
  markdownText,
  OUTPUTS,
  outputExt,
  outputsFor,
} from '../../src/core/transcribe/output.js'

/**
 * What transcribe can write (mockups/transcribe-2026-10-round4.html, tab 3,
 * T1, approved 2026-10-22): Markdown, Word, PDF or text. The .md is the one
 * the others are made from; these turn it into HTML (for Word and PDF) and
 * into plain text.
 */
const RESULT = {
  seconds: 75,
  segments: [
    { start: 0, end: 3, text: 'Hello & welcome.' },
    { start: 70, end: 72, text: 'Now, <milk>.' },
  ],
  notes: {
    summary: 'About tea.',
    parts: [
      { start: 0, heading: 'Welcome', points: ['Tea first.', 'Then cake.'], refused: false },
      { start: 70, heading: 'Milk', points: ['Milk last.'], refused: false },
    ],
  },
}
const MD = transcriptMarkdown(RESULT, { title: 'Tea talk', from: 'https://youtu.be/abc' })

describe('the formats', () => {
  it('are Markdown, Word, PDF and text, in that order, Markdown first', () => {
    expect(OUTPUTS.map((o) => [o.label, o.ext])).toEqual([
      ['Markdown', '.md'],
      ['Word', '.docx'],
      ['PDF', '.pdf'],
      ['Text', '.txt'],
    ])
    expect(DEFAULT_OUTPUT).toBe('md')
    expect(outputExt('pdf')).toBe('.pdf')
  })
})

describe('markdownText', () => {
  it('drops the marks and keeps the words, lines and times', () => {
    const text = markdownText(MD)
    expect(text.split('\n').slice(0, 6)).toEqual([
      'Tea talk',
      '',
      'https://youtu.be/abc',
      '',
      'About tea.',
      '',
    ])
    expect(text).toContain('\nNotes\n')
    expect(text).toContain('\nWelcome · 0:00\n')
    expect(text).toContain('\n- Tea first.\n')
    expect(text).toContain('\n0:00 Hello & welcome.\n')
    expect(text).toContain(
      '\nSummary and notes by Apple Intelligence. They may contain mistakes.\n',
    )
    // No Markdown left; what was said ("<milk>") stays as it was said.
    expect(text).not.toMatch(/^#|\*\*|^_|^<http/m)
    expect(text).toContain('\n1:10 Now, <milk>.\n')
  })
})

describe('markdownHtml', () => {
  const html = markdownHtml(MD)

  it('is a whole UTF-8 document titled after the talk', () => {
    expect(html).toMatch(/^<!doctype html>/)
    expect(html).toContain('<meta charset="utf-8">')
    expect(html).toContain('<title>Tea talk</title>')
  })

  it('turns headings, the link, points and times into their tags', () => {
    expect(html).toContain('<h1>Tea talk</h1>')
    expect(html).toContain('<p><a href="https://youtu.be/abc">https://youtu.be/abc</a></p>')
    expect(html).toContain('<h2>Notes</h2>')
    expect(html).toContain('<h3>Welcome · 0:00</h3>')
    expect(html).toContain('<ul><li>Tea first.</li><li>Then cake.</li></ul>')
    expect(html).toContain('<p><b>0:00</b> Hello &amp; welcome.</p>')
    expect(html).toContain(
      '<p><i>Summary and notes by Apple Intelligence. They may contain mistakes.</i></p>',
    )
  })

  it('escapes what was said, so speech never becomes markup', () => {
    expect(html).toContain('Now, &lt;milk&gt;.')
    expect(html).not.toContain('<milk>')
  })
})

describe('outputsFor', () => {
  it("offers every format where Apple's helper sets documents, all but PDF elsewhere", () => {
    expect(outputsFor({ render: true }).map((o) => o.id)).toEqual(['md', 'docx', 'pdf', 'txt'])
    expect(outputsFor({ render: false }).map((o) => o.id)).toEqual(['md', 'docx', 'txt'])
  })
})

describe('markdownPages (Word written by Forge, off the Mac)', () => {
  const md = transcriptMarkdown(RESULT, { title: 'Tea', from: 'tea.m4a' })
  const [page] = markdownPages(md)

  it('is one page with the same headings, points and timed paragraphs as the HTML', () => {
    expect(markdownPages(md)).toHaveLength(1)
    expect(page?.[0]).toEqual({ kind: 'heading', level: 1, text: 'Tea' })
    expect(page).toContainEqual({
      kind: 'list',
      ordered: false,
      items: ['Tea first.', 'Then cake.'],
    })
    expect(page).toContainEqual({ kind: 'paragraph', text: '0:00 Hello & welcome.' })
  })

  it('keeps what was said as words, never markup', () => {
    expect(page).toContainEqual({ kind: 'paragraph', text: '1:10 Now, <milk>.' })
  })

  it("has no heading deeper than Word's second level", () => {
    for (const p of page ?? []) if (p.kind === 'heading') expect(p.level).toBeLessThanOrEqual(2)
  })
})
