/**
 * What transcribe can write (mockups/transcribe-2026-10-round4.html, tab 3,
 * T1, approved 2026-10-22): Markdown, Word, PDF or text, chosen on its own
 * step after Transcribe to. These are the transcript's own formats, not
 * conversion targets — transcribe never goes through `targetsFor`.
 *
 * The .md from `transcriptMarkdown` is the one source: Word and PDF are made
 * from its HTML (by the helper, on the Mac), text from its words. Both
 * functions read only the Markdown that function writes. Pure.
 */

import type { PageText } from './page-text.js'

export const OUTPUTS = [
  { id: 'md', label: 'Markdown', ext: '.md' },
  { id: 'docx', label: 'Word', ext: '.docx' },
  { id: 'pdf', label: 'PDF', ext: '.pdf' },
  { id: 'txt', label: 'Text', ext: '.txt' },
] as const

export type Output = (typeof OUTPUTS)[number]['id']

export const DEFAULT_OUTPUT: Output = 'md'

/**
 * The formats this machine can write: every one where Apple's helper sets
 * documents (`render`), and all but PDF elsewhere, where Word is written by
 * Forge (`markdownPages`) and nothing sets a PDF yet.
 */
export function outputsFor(can: { render: boolean }): (typeof OUTPUTS)[number][] {
  return OUTPUTS.filter((o) => o.id !== 'pdf' || can.render)
}

export const isOutput = (v: unknown): v is Output => OUTPUTS.some((o) => o.id === v)

export const outputExt = (id: Output): string => OUTPUTS.find((o) => o.id === id)?.ext ?? '.md'
export const outputLabel = (id: Output): string =>
  OUTPUTS.find((o) => o.id === id)?.label ?? 'Markdown'

/** One line of the .md, read for what it is. */
type Line =
  | { kind: 'heading'; level: 1 | 2 | 3; text: string }
  | { kind: 'link'; url: string }
  | { kind: 'point'; text: string }
  | { kind: 'timed'; time: string; text: string }
  | { kind: 'aside'; text: string }
  | { kind: 'text'; text: string }
  | { kind: 'blank' }

function read(line: string): Line {
  const heading = /^(#{1,3}) (.*)$/.exec(line)
  if (heading)
    return { kind: 'heading', level: heading[1]?.length as 1 | 2 | 3, text: heading[2] ?? '' }
  const link = /^<(https?:\/\/\S+)>$/.exec(line)
  if (link) return { kind: 'link', url: link[1] ?? '' }
  if (line.startsWith('- ')) return { kind: 'point', text: line.slice(2) }
  const timed = /^\*\*([0-9:]+)\*\* (.*)$/.exec(line)
  if (timed) return { kind: 'timed', time: timed[1] ?? '', text: timed[2] ?? '' }
  const aside = /^_(.*)_$/.exec(line)
  if (aside) return { kind: 'aside', text: aside[1] ?? '' }
  return line.trim() === '' ? { kind: 'blank' } : { kind: 'text', text: line }
}

/** One line's words without its marks. */
function words(line: Line): string {
  if (line.kind === 'blank') return ''
  if (line.kind === 'link') return line.url
  if (line.kind === 'point') return `- ${line.text}`
  if (line.kind === 'timed') return `${line.time} ${line.text}`
  return line.text
}

/** The words without the marks: headings and the link bare, a time before its paragraph. */
export function markdownText(md: string): string {
  return md
    .split('\n')
    .map((raw) => words(read(raw)))
    .join('\n')
}

export const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** Plain and readable on a page: the Mac's own type, no colour but the link's. */
export const STYLE = [
  'body{font-family:-apple-system,"Helvetica Neue",Helvetica,sans-serif;font-size:11pt;line-height:1.45;color:#1d1d1f}',
  'h1{font-size:20pt;margin:0 0 6pt}',
  'h2{font-size:15pt;margin:18pt 0 6pt}',
  'h3{font-size:12pt;margin:12pt 0 4pt}',
  'p,ul{margin:0 0 8pt}',
  // AppKit's HTML reader keeps no space after a list; the items' own does the work.
  'li{margin-bottom:4pt}',
  'a{color:#0b57d0}',
  'i{color:#6e6e73}',
].join('')

/**
 * The .md as pages of pieces, for Word written by Forge where Apple's helper
 * does not run: the same headings, points and paragraphs its HTML has, one
 * page. A timed paragraph keeps its time in front; a level-3 heading is
 * Word's second level, the deepest a page's text has.
 */
export function markdownPages(md: string): PageText {
  const page: PageText[number] = []
  let points: string[] = []
  const flush = () => {
    if (points.length) page.push({ kind: 'list', ordered: false, items: points })
    points = []
  }
  for (const line of md.split('\n').map(read)) {
    if (line.kind === 'point') {
      points.push(line.text)
      continue
    }
    flush()
    if (line.kind === 'heading')
      page.push({ kind: 'heading', level: line.level === 1 ? 1 : 2, text: line.text })
    else if (line.kind === 'link') page.push({ kind: 'paragraph', text: line.url })
    else if (line.kind === 'timed')
      page.push({ kind: 'paragraph', text: `${line.time} ${line.text}` })
    else if (line.kind === 'aside' || line.kind === 'text')
      page.push({ kind: 'paragraph', text: line.text })
  }
  flush()
  return [page]
}

/** A whole HTML document of the .md, for the helper to set as Word or PDF. */
export function markdownHtml(md: string): string {
  const lines = md.split('\n').map(read)
  const title = lines.find((l) => l.kind === 'heading' && l.level === 1)
  const body: string[] = []
  let points: string[] = []
  const flush = () => {
    if (points.length) body.push(`<ul>${points.map((p) => `<li>${p}</li>`).join('')}</ul>`)
    points = []
  }
  for (const line of lines) {
    if (line.kind === 'point') {
      points.push(escapeHtml(line.text))
      continue
    }
    flush()
    if (line.kind === 'heading')
      body.push(`<h${line.level}>${escapeHtml(line.text)}</h${line.level}>`)
    else if (line.kind === 'link') {
      const url = escapeHtml(line.url)
      body.push(`<p><a href="${url}">${url}</a></p>`)
    } else if (line.kind === 'timed')
      body.push(`<p><b>${escapeHtml(line.time)}</b> ${escapeHtml(line.text)}</p>`)
    else if (line.kind === 'aside') body.push(`<p><i>${escapeHtml(line.text)}</i></p>`)
    else if (line.kind === 'text') body.push(`<p>${escapeHtml(line.text)}</p>`)
  }
  flush()
  const name = title?.kind === 'heading' ? escapeHtml(title.text) : 'Transcript'
  return [
    '<!doctype html>',
    `<html><head><meta charset="utf-8"><title>${name}</title><style>${STYLE}</style></head><body>`,
    ...body,
    '</body></html>',
  ].join('\n')
}
