/**
 * A transcript or a page's text as a PDF, written here: the counterpart of
 * `pagesDocx`, for every machine where Apple's helper does not set documents
 * (Windows, Linux, a Mac before macOS 26). Plain A4 pages with Word's own
 * 1-inch margins, the sizes of `STYLE` in core/transcribe/output.ts, wrapped
 * paragraphs, lists, ruled tables, and a page break between a read document's
 * pages.
 *
 * Type is Noto Sans (SIL Open Font License; assets/fonts/OFL.txt), Regular and
 * Bold, cut down to Latin, Greek and Cyrillic, because a PDF's built-in fonts
 * stop at Western European and transcripts can be in any language. It is put
 * in the file by hand through pdf-lib's low-level objects, not by
 * `@pdf-lib/fontkit`, which alone would add 940 KB to the package (`ttf.ts`).
 * Each file carries only the glyphs it uses.
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gunzipSync } from 'node:zlib'
import type { PageText, Piece } from '../core/transcribe/page-text.js'
import { loadPdfLib } from './libs.js'
import { type Font, readFont } from './ttf.js'

// A4 in points, and Word's margins on it.
const PAGE_WIDTH = 595.28
const PAGE_HEIGHT = 841.89
const MARGIN = 72
const TEXT_WIDTH = PAGE_WIDTH - 2 * MARGIN
const TEXT_HEIGHT = PAGE_HEIGHT - 2 * MARGIN

/** The sizes of output.ts STYLE (11 pt body at 1.45, 20 / 15 pt headings), all in points. */
const BODY = { size: 11, leading: 16, after: 8 }
const H1 = { size: 20, leading: 26, before: 0, after: 6 }
const H2 = { size: 15, leading: 20, before: 18, after: 6 }
const ITEM_AFTER = 4
const LIST_INDENT = 24
const CELL = { size: 10, leading: 14, padX: 6, padY: 3 }
const TABLE_AFTER = 12

// #1d1d1f for type, #c7c7cc for rules (as the HTML does), a quiet grey behind a table's header.
const INK = 0.114
const RULE = 0.78
const HEADER_FILL = 0.95

const FILES = { regular: 'NotoSans-Regular.ttf.gz', bold: 'NotoSans-Bold.ttf.gz' } as const

/** Where the font files may be: beside the bundle (dist/fonts, published) or the repo's own (run from source). */
export function fontDirs(here: string): string[] {
  return [join(here, 'fonts'), join(here, '..', 'fonts'), join(here, '..', '..', 'assets', 'fonts')]
}

type Weight = keyof typeof FILES

let fonts: Record<Weight, Font> | undefined

function loadFonts(): Record<Weight, Font> {
  if (fonts) return fonts
  const dir = fontDirs(dirname(fileURLToPath(import.meta.url))).find((d) =>
    existsSync(join(d, FILES.regular)),
  )
  if (dir === undefined) throw new Error('the PDF fonts are missing from this install')
  const read = (w: Weight) => readFont(gunzipSync(readFileSync(join(dir, FILES[w]))))
  fonts = { regular: read('regular'), bold: read('bold') }
  return fonts
}

/** The letters a face has drawn so far: what its subset must keep. */
class Face {
  readonly used = new Map<number, number>()
  private readonly widths = new Map<string, number>()
  constructor(
    readonly font: Font,
    readonly resource: string,
  ) {}

  /** A string's width in points. Every character in it has a glyph (`clean`). */
  width(text: string, size: number): number {
    let units = 0
    for (const ch of text) {
      let w = this.widths.get(ch)
      if (w === undefined) {
        w = this.font.advance(this.glyph(ch))
        this.widths.set(ch, w)
      }
      units += w
    }
    return (units * size) / this.font.unitsPerEm
  }

  private glyph(ch: string): number {
    return this.font.glyphOf(ch.codePointAt(0) ?? 0xfffd) ?? this.font.glyphOf(0x3f) ?? 0
  }

  /** The glyph numbers of a string as the 4-digit hex a PDF's two-byte codes are written in. */
  encode(text: string): string {
    let hex = ''
    for (const ch of text) {
      const g = this.glyph(ch)
      if (!this.used.has(g)) this.used.set(g, ch.codePointAt(0) ?? 0x3f)
      hex += g.toString(16).padStart(4, '0')
    }
    return hex
  }
}

/** Marks that take no room: soft hyphen, zero-width and direction marks. */
const NO_ROOM = /[\u00AD\u200B-\u200F\u2028\u2029\u202A-\u202E\u2060\u2066-\u2069\uFEFF]/g
/** Tabs and every width of space, which a PDF would draw as one gap. */
const SPACES = /[\t\u00A0\u2000-\u200A\u202F\u205F\u3000]/g
/** Control characters other than the line break. */
const CONTROLS = /[^\P{Cc}\n]/gu

/**
 * The text as the font can draw it. A character the font lacks must not crash
 * the writer or leave a gap, so it becomes a plain letter where it is a letter
 * with a mark the font lacks (NFKD, mark dropped: "ǎ" → "a"), else "?" — one for
 * each character, so Chinese, Arabic, Hindi and emoji, which the Latin, Greek
 * and Cyrillic font has no glyphs for, read as "??" rather than vanish.
 */
export function clean(text: string, has: (codePoint: number) => boolean): string {
  const out: string[] = []
  const folded = text
    .replace(SPACES, ' ')
    .replace(NO_ROOM, '')
    .replace(CONTROLS, '')
    .normalize('NFC')
  for (const ch of folded) {
    const cp = ch.codePointAt(0) ?? 0x3f
    if (ch === '\n' || has(cp)) {
      out.push(ch)
      continue
    }
    const plain = ch.normalize('NFKD').replace(/\p{M}/gu, '')
    out.push(plain !== '' && [...plain].every((c) => has(c.codePointAt(0) ?? 0)) ? plain : '?')
  }
  return out.join('')
}

/** Lines of at most `width` points: at spaces, and inside a word that is longer than a line. */
function wrap(text: string, face: Face, size: number, width: number): string[] {
  const lines: string[] = []
  for (const paragraph of text.split('\n')) {
    let line = ''
    let lineWidth = 0
    const space = face.width(' ', size)
    for (const word of paragraph.split(' ').filter(Boolean)) {
      const w = face.width(word, size)
      if (w > width) {
        // An address or a long run of letters: broken where the line ends.
        if (line !== '') lines.push(line)
        line = ''
        lineWidth = 0
        for (const ch of word) {
          const cw = face.width(ch, size)
          if (lineWidth + cw > width && line !== '') {
            lines.push(line)
            line = ''
            lineWidth = 0
          }
          line += ch
          lineWidth += cw
        }
      } else if (line === '') {
        line = word
        lineWidth = w
      } else if (lineWidth + space + w <= width) {
        line += ` ${word}`
        lineWidth += space + w
      } else {
        lines.push(line)
        line = word
        lineWidth = w
      }
    }
    lines.push(line)
  }
  return lines
}

const n = (x: number) => (Math.round(x * 100) / 100).toString()

/** Lays pieces out down pages, remembering the drawing of each as a PDF content stream. */
class Layout {
  readonly pages: string[][] = []
  private ops: string[] = []
  /** Points used from the top of the text area. */
  private y = 0
  /** The bottom margin the last block asked for; the next block's top margin may swallow it, as in HTML. */
  private owed = 0

  constructor(
    private readonly regular: Face,
    private readonly bold: Face,
  ) {}

  get remaining(): number {
    return TEXT_HEIGHT - this.y
  }

  get atTop(): boolean {
    return this.y === 0
  }

  newPage(): void {
    this.ops = [`${n(INK)} g`]
    this.pages.push(this.ops)
    this.y = 0
    this.owed = 0
  }

  /** The gap between blocks: the larger of the last one's bottom margin and this one's top. */
  gap(before: number): void {
    if (this.y > 0) this.y += Math.max(this.owed, before)
    this.owed = 0
  }

  bottom(after: number): void {
    this.owed = after
  }

  advance(by: number): void {
    this.y += by
  }

  /** One line of text with its top edge at `top` below the text area's top. */
  text(face: Face, size: number, leading: number, left: number, top: number, text: string): void {
    if (text === '') return
    const { font } = face
    const content = ((font.ascent - font.descent) * size) / font.unitsPerEm
    const baseline = top + (leading - content) / 2 + (font.ascent * size) / font.unitsPerEm
    this.ops.push(
      `BT /${face.resource} ${n(size)} Tf ${n(MARGIN + left)} ${n(PAGE_HEIGHT - MARGIN - baseline)} Td <${face.encode(text)}> Tj ET`,
    )
  }

  /** A rectangle of the text area: filled with a grey, or outlined. */
  rect(left: number, top: number, width: number, height: number, paint: 'fill' | 'stroke'): void {
    const box = `${n(MARGIN + left)} ${n(PAGE_HEIGHT - MARGIN - top - height)} ${n(width)} ${n(height)} re`
    if (paint === 'fill') this.ops.push(`${n(HEADER_FILL)} g ${box} f ${n(INK)} g`)
    else this.ops.push(`${n(RULE)} G 0.5 w ${box} S`)
  }

  /** Lines of one block, breaking over pages. */
  lines(
    face: Face,
    size: number,
    leading: number,
    left: number,
    width: number,
    text: string,
    first?: string,
  ): void {
    wrap(text, face, size, width).forEach((line, i) => {
      if (this.remaining < leading) this.newPage()
      // The label first, so text read back out of the file has it before its item.
      if (i === 0 && first !== undefined)
        this.text(face, size, leading, left - face.width(first, size), this.y, first)
      this.text(face, size, leading, left, this.y, line)
      this.advance(leading)
    })
  }

  heading(level: 1 | 2, text: string): void {
    const style = level === 1 ? H1 : H2
    const lines = wrap(text, this.bold, style.size, TEXT_WIDTH)
    this.gap(style.before)
    // Not alone at the foot of a page: room for its lines and two of what follows.
    if (this.remaining < lines.length * style.leading + style.after + 2 * BODY.leading) {
      this.newPage()
    }
    this.lines(this.bold, style.size, style.leading, 0, TEXT_WIDTH, text)
    this.bottom(style.after)
  }

  paragraph(text: string): void {
    this.gap(0)
    this.lines(this.regular, BODY.size, BODY.leading, 0, TEXT_WIDTH, text)
    this.bottom(BODY.after)
  }

  list(ordered: boolean, items: string[]): void {
    this.gap(0)
    items.forEach((item, i) => {
      if (i > 0) this.advance(ITEM_AFTER)
      const label = ordered ? `${i + 1}. ` : '• '
      this.lines(
        this.regular,
        BODY.size,
        BODY.leading,
        LIST_INDENT,
        TEXT_WIDTH - LIST_INDENT,
        item,
        label,
      )
    })
    this.bottom(BODY.after)
  }

  table(rows: string[][]): void {
    if (rows.length === 0) return
    this.gap(0)
    const columns = Math.max(...rows.map((r) => r.length))
    const inner = CELL.padX * 2
    const natural = Array<number>(columns).fill(0)
    const least = Array<number>(columns).fill(0)
    for (const [r, row] of rows.entries()) {
      const face = r === 0 ? this.bold : this.regular
      for (let c = 0; c < columns; c++) {
        const text = row[c] ?? ''
        natural[c] = Math.max(
          natural[c] ?? 0,
          face.width(text.replace(/\n/g, ' '), CELL.size) + inner,
        )
        const longest = Math.max(0, ...text.split(/\s+/).map((w) => face.width(w, CELL.size)))
        least[c] = Math.max(least[c] ?? 0, longest + inner)
      }
    }
    const widths = columnWidths(natural, least, TEXT_WIDTH)
    const lefts = widths.map((_, c) => widths.slice(0, c).reduce((a, b) => a + b, 0))

    const cells = (r: number): string[][] =>
      widths.map((w, c) =>
        wrap(rows[r]?.[c] ?? '', r === 0 ? this.bold : this.regular, CELL.size, w - inner),
      )
    const head = cells(0)
    const headHeight = Math.max(...head.map((l) => l.length)) * CELL.leading + 2 * CELL.padY

    /** Some of a row's lines, from `from`, as the cells of one page. */
    const draw = (r: number, lines: string[][], from: number, count: number) => {
      const height = count * CELL.leading + 2 * CELL.padY
      for (let c = 0; c < columns; c++) {
        const left = lefts[c] ?? 0
        const width = widths[c] ?? 0
        if (r === 0) this.rect(left, this.y, width, height, 'fill')
        this.rect(left, this.y, width, height, 'stroke')
        ;(lines[c] ?? []).slice(from, from + count).forEach((line, i) => {
          this.text(
            r === 0 ? this.bold : this.regular,
            CELL.size,
            CELL.leading,
            left + CELL.padX,
            this.y + CELL.padY + i * CELL.leading,
            line,
          )
        })
      }
      this.advance(height)
    }

    /** A page break inside the table; the header row is set again at the top of the next page. */
    const carryOn = (r: number) => {
      this.newPage()
      if (r > 0 && headHeight < TEXT_HEIGHT / 2)
        draw(0, head, 0, Math.max(...head.map((l) => l.length)))
    }

    for (let r = 0; r < rows.length; r++) {
      const lines = r === 0 ? head : cells(r)
      const total = Math.max(...lines.map((l) => l.length))
      let done = 0
      while (done < total) {
        const fits = Math.floor((this.remaining - 2 * CELL.padY) / CELL.leading)
        const wholeRow = (total - done) * CELL.leading + 2 * CELL.padY
        // A row that would fit a fresh page goes there whole; only a taller one is split.
        if (
          fits < 1 ||
          (fits < total - done && !this.atTop && wholeRow <= TEXT_HEIGHT - headHeight)
        ) {
          carryOn(r)
          continue
        }
        const count = Math.min(total - done, fits)
        draw(r, lines, done, count)
        done += count
        if (done < total) carryOn(r)
      }
    }
    this.bottom(TABLE_AFTER)
  }
}

/**
 * Column widths for a table that fills the text width: as wide as their
 * contents want when there is room (stretched to fill), else squeezed towards
 * the longest word in each, which is as narrow as a column can go without
 * breaking words.
 */
function columnWidths(natural: number[], least: number[], available: number): number[] {
  const wanted = natural.reduce((a, b) => a + b, 0)
  if (wanted <= available) return natural.map((w) => (w * available) / wanted)
  const floor = least.reduce((a, b) => a + b, 0)
  if (floor >= available) return least.map((w) => (w * available) / floor)
  const k = (available - floor) / (wanted - floor)
  return natural.map((w, c) => (least[c] ?? 0) + (w - (least[c] ?? 0)) * k)
}

/** One piece onto the pages. */
function place(layout: Layout, piece: Piece, has: (cp: number) => boolean): void {
  const text = (s: string) => clean(s, has)
  if (piece.kind === 'heading') layout.heading(piece.level, text(piece.text))
  else if (piece.kind === 'paragraph') layout.paragraph(text(piece.text))
  else if (piece.kind === 'list') layout.list(piece.ordered, piece.items.map(text))
  else layout.table(piece.rows.map((r) => r.map(text)))
}

export async function pagesPdf(doc: PageText, opts: { title: string }): Promise<Buffer> {
  const { PDFDocument, PDFName, PDFString } = await loadPdfLib()
  const { regular, bold } = loadFonts()
  const faces = { regular: new Face(regular, 'F1'), bold: new Face(bold, 'F2') }
  const has = (cp: number) => regular.glyphOf(cp) !== undefined && bold.glyphOf(cp) !== undefined

  const layout = new Layout(faces.regular, faces.bold)
  for (const page of doc.filter((p) => p.length > 0)) {
    layout.newPage()
    for (const piece of page) place(layout, piece, has)
  }
  if (layout.pages.length === 0) layout.newPage()

  const pdf = await PDFDocument.create({ updateMetadata: false })
  pdf.setTitle(opts.title)
  pdf.setProducer('Forge')
  pdf.setCreator('Forge')
  const { context } = pdf

  const fontRefs = new Map<Face, ReturnType<typeof context.nextRef>>()
  for (const face of Object.values(faces)) {
    if (face.used.size === 0) continue
    const ref = context.nextRef()
    fontRefs.set(face, ref)
    const { font } = face
    const glyphs = [...face.used.keys()].sort((a, b) => a - b)
    const subset = font.subset(glyphs)
    const file = context.register(context.flateStream(subset, { Length1: subset.length }))
    const scale = 1000 / font.unitsPerEm
    // Six capitals before the name mark a subset font, as PDF asks.
    const name = face === faces.bold ? 'FORGEB+NotoSans-Bold' : 'FORGER+NotoSans-Regular'
    const descriptor = context.register(
      context.obj({
        Type: 'FontDescriptor',
        FontName: name,
        Flags: 4,
        FontBBox: font.bbox.map((v) => Math.round(v * scale)),
        ItalicAngle: 0,
        Ascent: Math.round(font.ascent * scale),
        Descent: Math.round(font.descent * scale),
        CapHeight: Math.round(font.capHeight * scale),
        StemV: face === faces.bold ? 140 : 80,
        FontFile2: file,
      }),
    )
    const widths: Array<number | number[]> = glyphs.flatMap((g) => [
      g,
      [Math.round(font.advance(g) * scale)],
    ])
    const descendant = context.register(
      context.obj({
        Type: 'Font',
        Subtype: 'CIDFontType2',
        BaseFont: name,
        CIDSystemInfo: context.obj({
          Registry: PDFString.of('Adobe'),
          Ordering: PDFString.of('Identity'),
          Supplement: 0,
        }),
        FontDescriptor: descriptor,
        DW: 0,
        W: widths,
        CIDToGIDMap: 'Identity',
      }),
    )
    // Without this, copying text out of the PDF gives glyph numbers, not letters.
    const toUnicode = context.register(context.flateStream(toUnicodeMap(face.used)))
    context.assign(
      ref,
      context.obj({
        Type: 'Font',
        Subtype: 'Type0',
        BaseFont: name,
        Encoding: 'Identity-H',
        DescendantFonts: [descendant],
        ToUnicode: toUnicode,
      }),
    )
  }

  for (const ops of layout.pages) {
    const page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT])
    for (const [face, ref] of fontRefs) page.node.setFontDictionary(PDFName.of(face.resource), ref)
    page.node.set(PDFName.of('Contents'), context.register(context.flateStream(ops.join('\n'))))
  }
  return Buffer.from(await pdf.save())
}

/** A ToUnicode CMap: which character each glyph number stands for. */
function toUnicodeMap(used: Map<number, number>): string {
  const entries = [...used].sort(([a], [b]) => a - b)
  const hex = (v: number) => v.toString(16).padStart(4, '0')
  const blocks: string[] = []
  for (let i = 0; i < entries.length; i += 100) {
    const chunk = entries.slice(i, i + 100)
    blocks.push(
      `${chunk.length} beginbfchar\n${chunk.map(([g, cp]) => `<${hex(g)}> <${hex(cp)}>`).join('\n')}\nendbfchar`,
    )
  }
  return [
    '/CIDInit /ProcessSet findresource begin',
    '12 dict begin',
    'begincmap',
    '/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def',
    '/CMapName /Adobe-Identity-UCS def',
    '/CMapType 2 def',
    '1 begincodespacerange\n<0000> <FFFF>\nendcodespacerange',
    ...blocks,
    'endcmap',
    'CMapName currentdict /CMap defineresource pop',
    'end',
    'end',
  ].join('\n')
}
