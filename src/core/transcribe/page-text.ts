/**
 * A picture's or a PDF's text (spec 2026-10-23-extract-text-design §4), from
 * what the helper's `read` reports Vision saw. Vision reads; Forge decides the
 * order and the headings, then writes the words three ways: Markdown for the
 * file, the bare words for the clipboard and Text, HTML for Word and PDF.
 * Nothing here rewrites what was read. Pure.
 */
import { escapeHtml, STYLE } from './output.js'

/** Normalised to the page, origin top-left: x, y, width, height. */
export type Box = readonly [number, number, number, number]

export type ListMarker = 'bullet' | 'hyphen' | 'decimal' | 'lowercase' | 'uppercase'

export type ReadBlock =
  | {
      kind: 'text'
      text: string
      /** Vision took it for the page's title. */
      title: boolean
      lines: number
      /** The median height of its lines, normalised to the page. */
      lineHeight: number
      box: Box
    }
  | { kind: 'list'; items: Array<{ marker: ListMarker; text: string }>; box: Box }
  | { kind: 'table'; rows: string[][]; box: Box }

export interface ReadPage {
  blocks: ReadBlock[]
  /** From the line reader, not the document reader: each block is one line. */
  lines?: true
}

export type Piece =
  | { kind: 'heading'; level: 1 | 2; text: string }
  | { kind: 'paragraph'; text: string }
  | { kind: 'list'; ordered: boolean; items: string[] }
  | { kind: 'table'; rows: string[][] }

/** One list of pieces per page, in reading order. */
export type PageText = Piece[][]

type TextBlock = Extract<ReadBlock, { kind: 'text' }>

const centreIn = (b: Box, outer: Box) => {
  const x = b[0] + b[2] / 2
  const y = b[1] + b[3] / 2
  return x >= outer[0] && x <= outer[0] + outer[2] && y >= outer[1] && y <= outer[1] + outer[3]
}

/** A list's or table's text is among Vision's paragraphs too: it belongs to that block. */
function absorb(blocks: readonly ReadBlock[]): ReadBlock[] {
  const holders = blocks.filter((b) => b.kind !== 'text').map((b) => b.box)
  return blocks.filter((b) => b.kind !== 'text' || !holders.some((h) => centreIn(b.box, h)))
}

/** Space between blocks smaller than this does not separate them. */
const GAP = 0.002

/** The blocks in runs along one axis, a run ending where nothing overlaps the next block. */
function runs(blocks: readonly ReadBlock[], axis: 0 | 1): ReadBlock[][] {
  const start = (b: ReadBlock) => b.box[axis]
  const end = (b: ReadBlock) => b.box[axis] + (axis === 0 ? b.box[2] : b.box[3])
  const sorted = [...blocks].sort((a, b) => start(a) - start(b))
  const out: ReadBlock[][] = []
  let reach = -1
  for (const b of sorted) {
    const last = out[out.length - 1]
    if (last && start(b) <= reach + GAP) {
      last.push(b)
      reach = Math.max(reach, end(b))
    } else {
      out.push([b])
      reach = end(b)
    }
  }
  return out
}

/** The blocks cut in two across the page at its widest gap, or undefined where none runs across. */
function cutAcross(blocks: readonly ReadBlock[]): [ReadBlock[], ReadBlock[]] | undefined {
  const bands = runs(blocks, 1)
  if (bands.length < 2) return undefined
  const bottom = (band: ReadBlock[]) => Math.max(...band.map((b) => b.box[1] + b.box[3]))
  const top = (band: ReadBlock[]) => Math.min(...band.map((b) => b.box[1]))
  let at = 1
  for (let i = 2; i < bands.length; i++) {
    const gap = (k: number) => top(bands[k] ?? []) - bottom(bands[k - 1] ?? [])
    if (gap(i) > gap(at)) at = i
  }
  return [bands.slice(0, at).flat(), bands.slice(at).flat()]
}

/**
 * Reading order by cutting the page (XY-cut): into columns where a gap runs
 * top to bottom, else in two across its widest gap, and again inside each
 * part. A heading across two columns blocks the column cut, so it is cut off
 * above them and read first, then each column down; cutting at every gap
 * across at once would read the columns row by row. Vision's own paragraph
 * order is not used: it put a table's cells ahead of the paragraph above the
 * table (§9).
 */
function order(blocks: readonly ReadBlock[]): ReadBlock[] {
  if (blocks.length <= 1) return [...blocks]
  const columns = runs(blocks, 0)
  if (columns.length > 1) return columns.flatMap(order)
  const halves = cutAcross(blocks)
  if (halves) return halves.flatMap(order)
  return [...blocks].sort((a, b) => a.box[1] - b.box[1] || a.box[0] - b.box[0])
}

/** The line reader's lines, joined where the next sits close under the last, at the same left edge. */
function paragraphsOf(lines: readonly TextBlock[]): TextBlock[] {
  const out: TextBlock[] = []
  for (const line of lines) {
    const last = out[out.length - 1]
    const h = Math.max(line.lineHeight, last?.lineHeight ?? 0)
    const close =
      last !== undefined &&
      line.box[1] - (last.box[1] + last.box[3]) < h &&
      Math.abs(line.box[0] - last.box[0]) < 2 * h
    if (!close) {
      out.push({ ...line })
      continue
    }
    const right = Math.max(last.box[0] + last.box[2], line.box[0] + line.box[2])
    const bottom = line.box[1] + line.box[3]
    out[out.length - 1] = {
      ...last,
      text: `${last.text} ${line.text}`,
      lines: last.lines + 1,
      box: [last.box[0], last.box[1], right - last.box[0], bottom - last.box[1]],
    }
  }
  return out
}

/** The height of a body line: the median over every line on the page, so a long paragraph outweighs a heading. */
function bodyLine(blocks: readonly TextBlock[]): number {
  const heights = blocks.flatMap((b) => Array<number>(Math.max(1, b.lines)).fill(b.lineHeight))
  heights.sort((a, b) => a - b)
  return heights[Math.floor(heights.length / 2)] ?? 0
}

/**
 * How much taller than a body line a heading's line is. A 38 pt heading over
 * 28 pt text measures 1.37 on a clean page. On a blurred phone photo of it
 * (fixture photo) the heading and a body line full of "@" and brackets
 * measure the same, so no threshold tells them apart there: it errs towards
 * a paragraph, since a heading missed loses nothing and a false one misleads.
 */
const STANDS_OUT = 1.2
const HEADING_MAX = 80

const oneLine = (s: string) => s.replace(/\s*\n\s*/g, ' ').trim()

function piece(b: ReadBlock, body: number, alone: boolean): Piece {
  if (b.kind === 'list')
    return {
      kind: 'list',
      ordered: b.items.some(
        (i) => i.marker === 'decimal' || i.marker === 'lowercase' || i.marker === 'uppercase',
      ),
      items: b.items.map((i) => oneLine(i.text)),
    }
  if (b.kind === 'table') {
    const width = Math.max(...b.rows.map((r) => r.length))
    return {
      kind: 'table',
      rows: b.rows.map((r) => Array.from({ length: width }, (_, i) => oneLine(r[i] ?? ''))),
    }
  }
  const text = oneLine(b.text)
  const big = !alone && b.lineHeight >= body * STANDS_OUT
  const heading = big && b.lines === 1 && text.length <= HEADING_MAX && !/[.,;:!?]$/.test(text)
  if (heading) return { kind: 'heading', level: b.title ? 1 : 2, text }
  return { kind: 'paragraph', text }
}

export function pageText(pages: readonly ReadPage[]): PageText {
  return pages.map((page) => {
    let blocks = order(absorb(page.blocks.filter((b) => b.kind !== 'text' || b.text.trim() !== '')))
    if (page.lines) blocks = paragraphsOf(blocks.filter((b): b is TextBlock => b.kind === 'text'))
    const texts = blocks.filter((b): b is TextBlock => b.kind === 'text')
    const body = bodyLine(texts)
    return blocks.map((b) => piece(b, body, blocks.length === 1))
  })
}

export const hasText = (doc: PageText): boolean => doc.some((page) => page.length > 0)

// Markdown

/** Marks anywhere: a backslash, emphasis, code, links, HTML; an underscore only at a word's edge. */
function escapeInline(s: string): string {
  return s
    .replace(/[\\`*[\]<]/g, (c) => `\\${c}`)
    .replace(/(^|[^\p{L}\p{N}])_|_(?=[^\p{L}\p{N}]|$)/gu, (m) => m.replace('_', '\\_'))
}

/** Marks a block's first characters would make: a heading, a quote, a point, a numbered item. */
function escapeStart(s: string): string {
  return s.replace(/^(#|>|[-+](?= )|(?<=^\d+)\.(?= ))/, '\\$1').replace(/^(\d+)\.(?= )/, '$1\\.')
}

const md = (s: string) => escapeStart(escapeInline(s))

function pieceMarkdown(p: Piece): string {
  if (p.kind === 'heading') return `${'#'.repeat(p.level)} ${escapeInline(p.text)}`
  if (p.kind === 'paragraph') return md(p.text)
  if (p.kind === 'list')
    return p.items.map((t, i) => `${p.ordered ? `${i + 1}.` : '-'} ${md(t)}`).join('\n')
  const cell = (s: string) => escapeInline(s).replace(/\|/g, '\\|')
  const row = (r: string[]) => `| ${r.map(cell).join(' | ')} |`
  const [head = [], ...rest] = p.rows
  return [row(head), `| ${head.map(() => '---').join(' | ')} |`, ...rest.map(row)].join('\n')
}

const filled = (doc: PageText) => doc.filter((page) => page.length > 0)

export function pageMarkdown(doc: PageText): string {
  const pages = filled(doc).map((page) => page.map(pieceMarkdown).join('\n\n'))
  return pages.length ? `${pages.join('\n\n---\n\n')}\n` : ''
}

// The bare words

function piecePlain(p: Piece): string {
  if (p.kind === 'heading' || p.kind === 'paragraph') return p.text
  if (p.kind === 'list')
    return p.items.map((t, i) => `${p.ordered ? `${i + 1}.` : '-'} ${t}`).join('\n')
  return p.rows.map((r) => r.join('\t')).join('\n')
}

/** What the clipboard and a .txt get: the words as read, no marks and no escapes. */
export function pagePlain(doc: PageText): string {
  const pages = filled(doc).map((page) => page.map(piecePlain).join('\n\n'))
  return pages.length ? `${pages.join('\n\n')}\n` : ''
}

// HTML, for Word and PDF set by Apple's helper (`render`) and the clipboard's rich copy

const TABLE_STYLE =
  'table{border-collapse:collapse;width:100%;margin:0 0 8pt}th,td{border:1px solid #c7c7cc;padding:2pt 6pt;text-align:left;vertical-align:top}ol{margin:0 0 8pt}'

/** AppKit's HTML reader keeps no margin round a table (nor a margin-top after one): a small empty paragraph does it. */
const SPACER = '<p style="margin:0;font-size:5pt">&nbsp;</p>'

function pieceHtml(p: Piece): string {
  if (p.kind === 'heading') return `<h${p.level}>${escapeHtml(p.text)}</h${p.level}>`
  if (p.kind === 'paragraph') return `<p>${escapeHtml(p.text)}</p>`
  if (p.kind === 'list') {
    const tag = p.ordered ? 'ol' : 'ul'
    return `<${tag}>${p.items.map((t) => `<li>${escapeHtml(t)}</li>`).join('')}</${tag}>`
  }
  const [head = [], ...rest] = p.rows
  const cells = (r: string[], tag: 'th' | 'td') =>
    `<tr>${r.map((c) => `<${tag}>${escapeHtml(c)}</${tag}>`).join('')}</tr>`
  const table = `<table>${cells(head, 'th')}${rest.map((r) => cells(r, 'td')).join('')}</table>`
  return `${SPACER}${table}${SPACER}`
}

/** A whole HTML document, named after the file it was read from. */
export function pageHtml(doc: PageText, name: string): string {
  const body = filled(doc).map((page) => page.map(pieceHtml).join('\n'))
  return [
    '<!doctype html>',
    `<html><head><meta charset="utf-8"><title>${escapeHtml(name)}</title><style>${STYLE}${TABLE_STYLE}</style></head><body>`,
    body.join('\n<hr>\n'),
    '</body></html>',
  ].join('\n')
}
