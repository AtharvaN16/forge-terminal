/**
 * A transcript or a page's text as a PDF, written here: the counterpart of
 * `pagesDocx`, for every machine where Apple's helper does not set documents
 * (Windows, Linux, a Mac before macOS 26). Plain A4 pages with Word's own
 * 1-inch margins, the sizes of `STYLE` in core/transcribe/output.ts, wrapped
 * paragraphs, lists, ruled tables, and a page break between a read document's
 * pages.
 *
 * Type is Noto Sans (SIL Open Font License; assets/fonts/OFL.txt), Regular and
 * Bold, cut down to Latin, Greek and Cyrillic. Whatever else a transcript has
 * (Chinese, Japanese, Korean, Arabic, Hebrew, Thai, symbols) is set in a font
 * the computer already has (`system-fonts.ts`), found per character, cut down
 * to the glyphs used and embedded: Forge ships none of them. Arabic is joined
 * (`arabic.ts`) and Hebrew and Arabic run right to left (`bidi.ts`). A writing
 * system that must be rearranged to be read (Hindi, Bengali, Tamil...) is not
 * set, and a character no font has is drawn as the box of Noto Sans's .notdef,
 * never as a question mark; `onMissing` says which writing systems those were.
 *
 * Fonts are put in the file by hand through pdf-lib's low-level objects, not by
 * `@pdf-lib/fontkit`, which alone would add 940 KB to the package (`ttf.ts`,
 * `cff.ts`). Each file carries only the glyphs it uses.
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gunzipSync } from 'node:zlib'
import { baseOf, hasArabic, joinArabic } from '../core/transcribe/arabic.js'
import { isRtl, visualOrder } from '../core/transcribe/bidi.js'
import type { PageText, Piece } from '../core/transcribe/page-text.js'
import {
  eastAsianLanguage,
  type Script,
  SET_HERE,
  scriptLabel,
  scriptOf,
} from '../core/transcribe/scripts.js'
import { loadPdfLib } from './libs.js'
import {
  candidates,
  type Deps,
  type LoadedFont,
  loadFont,
  type Need,
  realDeps,
} from './system-fonts.js'
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

/** One font as a PDF holds it: the glyphs drawn from it so far are what its subset must keep. */
class PdfFont {
  /** The character codes drawn, and the glyph and the text each stands for. */
  readonly used = new Map<number, { gid: number; text: string }>()
  private readonly widths = new Map<number, number>()
  constructor(
    readonly font: Font,
    readonly resource: string,
    readonly name: string,
    /** Drawn with a stroke as well as a fill, since the font has no bold of its own. */
    readonly synthetic: boolean,
    readonly isBold: boolean,
  ) {}

  /** A glyph's advance in points per point of type. */
  advance(gid: number): number {
    let w = this.widths.get(gid)
    if (w === undefined) {
      w = this.font.advance(gid) / this.font.unitsPerEm
      this.widths.set(gid, w)
    }
    return w
  }

  /** The two-byte code a glyph is drawn by, noting what it stands for. */
  code(gid: number, text: string): number {
    const code = this.font.codeOf(gid)
    if (!this.used.has(code)) this.used.set(code, { gid, text })
    return code
  }
}

interface Pick {
  pf: PdfFont
  gid: number
}

/** The fonts of a document, in the order a character looks for its glyph: Noto Sans, then what the computer gave. */
class Chain {
  private readonly fonts: Array<{ regular: PdfFont; bold: PdfFont }> = []
  private readonly picks = new Map<number, [number, number] | null>()
  private count = 0
  /** The writing systems of the characters no font had. */
  readonly missing = new Set<Script | 'other'>()
  private readonly notdef: { regular: PdfFont; bold: PdfFont }

  constructor(noto: Record<Weight, Font>) {
    const entry = {
      regular: new PdfFont(noto.regular, this.next(), 'NotoSans-Regular', false, false),
      bold: new PdfFont(noto.bold, this.next(), 'NotoSans-Bold', false, true),
    }
    this.fonts.push(entry)
    this.notdef = entry
  }

  private next(): string {
    return `F${++this.count}`
  }

  /** The font the whole line is measured by: Noto Sans's. */
  get primary(): Font {
    return this.notdef.regular.font
  }

  all(): PdfFont[] {
    return this.fonts.flatMap((f) => [f.regular, f.bold])
  }

  /** Adds a computer's font, behind the ones already in; it has one weight, so bold is drawn by stroking it. */
  add(name: string, font: Font): void {
    this.fonts.push({
      regular: new PdfFont(font, this.next(), name, false, false),
      bold: new PdfFont(font, this.next(), name, true, true),
    })
    this.picks.clear()
  }

  get fontCount(): number {
    return this.fonts.length
  }

  has(cp: number): boolean {
    return this.fonts.some((f) => f.regular.font.glyphOf(cp) !== undefined)
  }

  pick(cp: number, bold: boolean): Pick {
    let at = this.picks.get(cp)
    if (at === undefined) {
      at = null
      for (let i = 0; i < this.fonts.length; i++) {
        const g = this.fonts[i]?.regular.font.glyphOf(cp)
        if (g !== undefined) {
          at = [i, g]
          break
        }
      }
      this.picks.set(cp, at)
    }
    if (at === null) {
      this.missing.add(scriptOf(cp) ?? 'other')
      return { pf: bold ? this.notdef.bold : this.notdef.regular, gid: 0 }
    }
    const f = this.fonts[at[0]]
    return { pf: (bold ? f?.bold : f?.regular) ?? this.notdef.regular, gid: at[1] }
  }

  /** A string's width in points. */
  width(text: string, size: number, bold: boolean): number {
    let w = 0
    for (const ch of text) {
      const { pf, gid } = this.pick(ch.codePointAt(0) ?? 0, bold)
      w += pf.advance(gid)
    }
    return w * size
  }

  /** A string as runs of one font each, each as the hex of its two-byte codes. */
  runs(text: string, bold: boolean): Array<{ pf: PdfFont; hex: string; width: number }> {
    const out: Array<{ pf: PdfFont; hex: string; width: number }> = []
    for (const ch of text) {
      const cp = ch.codePointAt(0) ?? 0
      const { pf, gid } = this.pick(cp, bold)
      // What copying this text out of the PDF gives: the letters of a joined form, and a box's own mark.
      const text = gid === 0 ? '\uFFFD' : cp >= 0xfb50 && cp <= 0xfeff ? baseOf(cp) : ch
      const hex = pf.code(gid, text).toString(16).padStart(4, '0')
      const last = out.at(-1)
      if (last && last.pf === pf) {
        last.hex += hex
        last.width += pf.advance(gid)
      } else out.push({ pf, hex, width: pf.advance(gid) })
    }
    return out
  }
}

/** Marks that take no room: soft hyphen, zero-width spaces and direction marks. A joiner (200C, 200D) stays until Arabic is joined. */
const NO_ROOM = /[\u00AD\u200B\u200E\u200F\u2028\u2029\u202A-\u202E\u2060\u2066-\u2069\uFEFF]/g
/** Tabs and every width of space, which a PDF would draw as one gap. */
const SPACES = /[\t\u00A0\u2000-\u200A\u202F\u205F\u3000]/g
/** Control characters other than the line break. */
const CONTROLS = /[^\P{Cc}\n]/gu

/** The text with its odd spaces and invisible marks gone, composed. A joiner stays. */
function tidy(text: string): string {
  return text.replace(SPACES, ' ').replace(NO_ROOM, '').replace(CONTROLS, '').normalize('NFC')
}

/**
 * The text as the fonts can draw it: Arabic joined into the forms a font has,
 * a letter that has an accent the fonts lack as the plain letter (NFKD, mark
 * dropped: "ǎ" → "a"), and every other character as it is. One no font has is
 * drawn as a box by `Chain.pick`, and counted in `missing`: it is never turned
 * into a question mark, which would read as one that was typed.
 */
export function clean(text: string, has: (codePoint: number) => boolean): string {
  let t = tidy(text)
  if (hasArabic(t)) t = joinArabic(t, has)
  t = t.replace(/[\u200C\u200D]/g, '')
  const out: string[] = []
  for (const ch of t) {
    const cp = ch.codePointAt(0) ?? 0
    if (ch === '\n' || has(cp)) {
      out.push(ch)
      continue
    }
    const plain = ch.normalize('NFKD').replace(/\p{M}/gu, '')
    out.push(plain !== '' && [...plain].every((c) => has(c.codePointAt(0) ?? 0)) ? plain : ch)
  }
  return out.join('')
}

const EAST_ASIAN: ReadonlySet<Script | undefined> = new Set<Script>(['han', 'kana', 'hangul'])

/** Closing punctuation that may not begin a line, and opening that may not end one (CJK), as code points. */
const NOT_FIRST = new Set(
  [
    0x3001, 0x3002, 0xff0c, 0xff0e, 0xff1a, 0xff1b, 0xff01, 0xff1f, 0xff09, 0xff3d, 0xff5d, 0x3015,
    0x3009, 0x300b, 0x300d, 0x300f, 0x3011, 0x3019, 0x3017, 0x301f, 0x2019, 0x201d, 0x203c, 0x30fc,
    0x3005, 0x30fb, 0x2026, 0x2025, 0x25, 0x309d, 0x309e, 0x30fd, 0x30fe,
  ].map((cp) => String.fromCodePoint(cp)),
)
const NOT_LAST = new Set(
  [
    0xff08, 0xff3b, 0xff5b, 0x3014, 0x3008, 0x300a, 0x300c, 0x300e, 0x3010, 0x3018, 0x3016, 0x301d,
    0x2018, 0x201c,
  ].map((cp) => String.fromCodePoint(cp)),
)

/** Lines of at most `width` points: at spaces, and inside a word that is longer than a line. */
function wrap(text: string, chain: Chain, bold: boolean, size: number, width: number): string[] {
  const lines: string[] = []
  const w = (s: string) => chain.width(s, size, bold)
  for (const paragraph of text.split('\n')) {
    let line = ''
    let lineWidth = 0
    const space = w(' ')
    for (const word of paragraph.split(' ').filter(Boolean)) {
      const ww = w(word)
      // Chinese, Japanese and Korean have no spaces to break at: a run of it that does not fit
      // after the words before it fills the rest of their line, as an address too long for a line does.
      const asia = [...word].some((c) => EAST_ASIAN.has(scriptOf(c.codePointAt(0) ?? 0) as Script))
      if (ww > width || (asia && line !== '' && lineWidth + space + ww > width)) {
        // It fills the rest of this line and goes on, broken where each line ends.
        if (line !== '') {
          if (lineWidth + space + w([...word][0] ?? '') <= width) {
            line += ' '
            lineWidth += space
          } else {
            lines.push(line)
            line = ''
            lineWidth = 0
          }
        }
        for (const ch of word) {
          const cw = w(ch)
          const prev = [...line].at(-1)
          const hang = NOT_FIRST.has(ch) && lineWidth + cw <= width * 1.15
          if (lineWidth + cw > width && line !== '' && !hang) {
            // An opening bracket goes to the next line with what it opens.
            if (prev !== undefined && NOT_LAST.has(prev)) {
              lines.push([...line].slice(0, -1).join(''))
              line = prev
              lineWidth = w(prev)
            } else {
              lines.push(line)
              line = ''
              lineWidth = 0
            }
          }
          line += ch
          lineWidth += cw
        }
      } else if (line === '') {
        line = word
        lineWidth = ww
      } else if (lineWidth + space + ww <= width) {
        line += ` ${word}`
        lineWidth += space + ww
      } else {
        lines.push(line)
        line = word
        lineWidth = ww
      }
    }
    lines.push(line)
  }
  return lines
}

const n = (x: number) => (Math.round(x * 100) / 100).toString()

/** A box on the text area: where text may run, left to right. */
interface Box {
  left: number
  width: number
}

/** Lays pieces out down pages, remembering the drawing of each as a PDF content stream. */
class Layout {
  readonly pages: string[][] = []
  private ops: string[] = []
  /** Points used from the top of the text area. */
  private y = 0
  /** The bottom margin the last block asked for; the next block's top margin may swallow it, as in HTML. */
  private owed = 0

  constructor(private readonly chain: Chain) {}

  get remaining(): number {
    return TEXT_HEIGHT - this.y
  }

  get atTop(): boolean {
    return this.y === 0
  }

  newPage(): void {
    this.ops = [`${n(INK)} g ${n(INK)} G`]
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

  /**
   * One line of text with its top edge at `top` below the text area's top, in
   * `box`: left-aligned, or right-aligned where `rtl`. It is put in the order
   * it is drawn left to right (`visualOrder`) before anything is measured.
   */
  text(
    bold: boolean,
    size: number,
    leading: number,
    box: Box,
    top: number,
    text: string,
    rtl: boolean,
  ): void {
    if (text === '') return
    const { primary } = this.chain
    const content = ((primary.ascent - primary.descent) * size) / primary.unitsPerEm
    const baseline = top + (leading - content) / 2 + (primary.ascent * size) / primary.unitsPerEm
    const runs = this.chain.runs(visualOrder(text, rtl), bold)
    const total = runs.reduce((sum, r) => sum + r.width, 0) * size
    let x = MARGIN + (rtl ? box.left + box.width - total : box.left)
    const y = n(PAGE_HEIGHT - MARGIN - baseline)
    for (const r of runs) {
      // A font with no bold is drawn filled and stroked, a hair thicker.
      const bolden = r.pf.synthetic ? `2 Tr ${n(size * 0.035)} w ` : ''
      const unbolden = r.pf.synthetic ? ' 0 Tr' : ''
      this.ops.push(
        `BT /${r.pf.resource} ${n(size)} Tf ${bolden}${n(x)} ${y} Td <${r.hex}> Tj${unbolden} ET`,
      )
      x += r.width * size
    }
  }

  /** A rectangle of the text area: filled with a grey, or outlined. */
  rect(left: number, top: number, width: number, height: number, paint: 'fill' | 'stroke'): void {
    const box = `${n(MARGIN + left)} ${n(PAGE_HEIGHT - MARGIN - top - height)} ${n(width)} ${n(height)} re`
    if (paint === 'fill') this.ops.push(`${n(HEADER_FILL)} g ${box} f ${n(INK)} g`)
    else this.ops.push(`${n(RULE)} G 0.5 w ${box} S ${n(INK)} G`)
  }

  /**
   * Lines of one block, breaking over pages. A `label` (a bullet, a number) sits
   * in `indent` points at the start of the first line: at the left, or at the
   * right of a block that runs right to left.
   */
  lines(
    bold: boolean,
    size: number,
    leading: number,
    box: Box,
    text: string,
    label?: { text: string; indent: number },
  ): void {
    const rtl = isRtl(text)
    const indent = label?.indent ?? 0
    const inner: Box = { left: rtl ? box.left : box.left + indent, width: box.width - indent }
    wrap(text, this.chain, bold, size, inner.width).forEach((line, i) => {
      if (this.remaining < leading) this.newPage()
      // The label first, so text read back out of the file has it before its item.
      if (i === 0 && label !== undefined) {
        const w = this.chain.width(label.text, size, bold)
        const at: Box = rtl
          ? { left: box.left + box.width - w, width: w }
          : { left: inner.left - w, width: w }
        this.text(bold, size, leading, at, this.y, label.text, false)
      }
      this.text(bold, size, leading, inner, this.y, line, rtl)
      this.advance(leading)
    })
  }

  heading(level: 1 | 2, text: string): void {
    const style = level === 1 ? H1 : H2
    const lines = wrap(text, this.chain, true, style.size, TEXT_WIDTH)
    this.gap(style.before)
    // Not alone at the foot of a page: room for its lines and two of what follows.
    if (this.remaining < lines.length * style.leading + style.after + 2 * BODY.leading) {
      this.newPage()
    }
    this.lines(true, style.size, style.leading, { left: 0, width: TEXT_WIDTH }, text)
    this.bottom(style.after)
  }

  paragraph(text: string): void {
    this.gap(0)
    this.lines(false, BODY.size, BODY.leading, { left: 0, width: TEXT_WIDTH }, text)
    this.bottom(BODY.after)
  }

  list(ordered: boolean, items: string[]): void {
    this.gap(0)
    items.forEach((item, i) => {
      if (i > 0) this.advance(ITEM_AFTER)
      const label = ordered ? `${i + 1}. ` : '• '
      this.lines(false, BODY.size, BODY.leading, { left: 0, width: TEXT_WIDTH }, item, {
        text: label,
        indent: LIST_INDENT,
      })
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
      const bold = r === 0
      for (let c = 0; c < columns; c++) {
        const text = row[c] ?? ''
        natural[c] = Math.max(
          natural[c] ?? 0,
          this.chain.width(text.replace(/\n/g, ' '), CELL.size, bold) + inner,
        )
        // The longest word, or for text with no spaces (Chinese) a few characters: as narrow as a column goes.
        const longest = Math.max(
          0,
          ...text
            .split(/\s+/)
            .map((w) => Math.min(this.chain.width(w, CELL.size, bold), CELL.size * 3)),
        )
        least[c] = Math.max(least[c] ?? 0, longest + inner)
      }
    }
    const widths = columnWidths(natural, least, TEXT_WIDTH)
    const lefts = widths.map((_, c) => widths.slice(0, c).reduce((a, b) => a + b, 0))

    const cells = (r: number): string[][] =>
      widths.map((w, c) => wrap(rows[r]?.[c] ?? '', this.chain, r === 0, CELL.size, w - inner))
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
        const cell = rows[r]?.[c] ?? ''
        const rtl = isRtl(cell)
        ;(lines[c] ?? []).slice(from, from + count).forEach((line, i) => {
          this.text(
            r === 0,
            CELL.size,
            CELL.leading,
            { left: left + CELL.padX, width: width - inner },
            this.y + CELL.padY + i * CELL.leading,
            line,
            rtl,
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

/** Every string of a document, as the pieces hold them. */
function strings(doc: PageText): string[] {
  return doc.flatMap((page) =>
    page.flatMap((p) => {
      if (p.kind === 'heading' || p.kind === 'paragraph') return [p.text]
      if (p.kind === 'list') return p.items
      return p.rows.flat()
    }),
  )
}

/** The most fonts taken from the computer for one document. */
const MAX_SYSTEM_FONTS = 8

/**
 * The computer's fonts for the characters Noto Sans lacks: per writing system,
 * its candidates in turn, each kept if it holds any of what is still needed.
 * Writing systems that have to be rearranged to be read are not looked for.
 */
async function addSystemFonts(
  chain: Chain,
  text: string,
  lang: string | undefined,
  deps: Deps,
): Promise<void> {
  const wanted = new Map<Script | 'other', number[]>()
  for (const ch of new Set(text)) {
    const cp = ch.codePointAt(0) ?? 0
    if (cp < 0x80 || ch === '\n' || chain.has(cp)) continue
    // Presentation forms are asked of the font that has the letters themselves.
    if (cp >= 0xfb50 && cp <= 0xfeff) continue
    const script = scriptOf(cp) ?? 'other'
    if (script !== 'other' && script !== 'symbols' && script !== 'emoji' && !SET_HERE.has(script)) {
      chain.missing.add(script)
      continue
    }
    wanted.set(script, [...(wanted.get(script) ?? []), cp])
  }
  const eastAsia = eastAsianLanguage(text, lang)
  let taken = 0
  for (const [script, cps] of wanted) {
    let remaining = cps
    const need: Need = { script, lang: eastAsia, codePoint: cps[0] ?? 0 }
    // A variable font draws its default master, often the thinnest weight: it is
    // taken only for what no ordinary font of the computer's has.
    const variable: LoadedFont[] = []
    const take = (loaded: LoadedFont) => {
      const covered = remaining.filter((cp) => loaded.font.glyphOf(cp) !== undefined)
      if (covered.length === 0) return
      chain.add(loaded.name, loaded.font)
      taken++
      remaining = remaining.filter((cp) => !covered.includes(cp))
    }
    for (const ref of await candidates(need, deps)) {
      if (remaining.length === 0 || taken >= MAX_SYSTEM_FONTS) break
      const loaded = loadFont(ref, deps)
      if (!loaded) continue
      if (loaded.font.variable) variable.push(loaded)
      else take(loaded)
    }
    for (const loaded of variable) {
      if (remaining.length === 0 || taken >= MAX_SYSTEM_FONTS) break
      take(loaded)
    }
  }
}

export interface PdfOptions {
  title: string
  /** The language the text was spoken or written in (`ja`, `zh-TW`), which settles how Han characters are drawn. */
  lang?: string
  /** Where fonts come from: the computer's own, unless a test says otherwise. */
  fonts?: Deps
  /** Told, once, the writing systems it had no font or no way to set (never called when there are none). */
  onMissing?: (scripts: string[]) => void
}

export async function pagesPdf(doc: PageText, opts: PdfOptions): Promise<Buffer> {
  const { PDFDocument, PDFName, PDFString } = await loadPdfLib()
  const chain = new Chain(loadFonts())

  // What the document needs, before any of it is laid out: tidied only, since joining Arabic waits for its font.
  const text = strings(doc).map(tidy).join('\n')
  await addSystemFonts(chain, text, opts.lang, opts.fonts ?? realDeps)

  const layout = new Layout(chain)
  const prepared = (s: string) => clean(s, (cp) => chain.has(cp))
  const place = (piece: Piece) => {
    if (piece.kind === 'heading') layout.heading(piece.level, prepared(piece.text))
    else if (piece.kind === 'paragraph') layout.paragraph(prepared(piece.text))
    else if (piece.kind === 'list') layout.list(piece.ordered, piece.items.map(prepared))
    else layout.table(piece.rows.map((r) => r.map(prepared)))
  }
  for (const page of doc.filter((p) => p.length > 0)) {
    layout.newPage()
    for (const piece of page) place(piece)
  }
  if (layout.pages.length === 0) layout.newPage()

  const pdf = await PDFDocument.create({ updateMetadata: false })
  pdf.setTitle(opts.title)
  pdf.setProducer('Forge')
  pdf.setCreator('Forge')
  const { context } = pdf

  const fontRefs = new Map<PdfFont, ReturnType<typeof context.nextRef>>()
  const embedded = new Map<Font, PdfFont>()
  let tag = 0
  for (const pf of chain.all()) {
    if (pf.used.size === 0) continue
    const ref = context.nextRef()
    fontRefs.set(pf, ref)
    const { font } = pf
    const codes = [...pf.used.keys()].sort((a, b) => a - b)
    const gids = codes.map((c) => pf.used.get(c)?.gid ?? 0)
    // A synthetic bold shares its regular's font program: the file is written once.
    const twin = pf.synthetic ? embedded.get(font) : undefined
    const scale = 1000 / font.unitsPerEm
    // Six capitals before the name mark a subset font, as PDF asks.
    const prefix = `F${String.fromCharCode(65 + ((tag >> 8) % 26), 65 + ((tag >> 4) % 26), 65 + ((tag >> 2) % 26), 65 + (tag % 26), 65 + ((tag * 7) % 26))}`
    tag++
    const name = `${prefix}+${pf.name.replace(/[^A-Za-z0-9-]/g, '')}`
    void twin
    const { data, cidToGid } = font.subset(gids)
    const isCff = font.outlines === 'cff'
    const file = context.register(
      isCff
        ? context.flateStream(data, { Subtype: 'CIDFontType0C' })
        : context.flateStream(data, { Length1: data.length }),
    )
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
        StemV: pf.isBold ? 140 : 80,
        ...(isCff ? { FontFile3: file } : { FontFile2: file }),
      }),
    )
    const widths: Array<number | number[]> = codes.flatMap((c, i) => [
      c,
      [Math.round(font.advance(gids[i] ?? 0) * scale)],
    ])
    const map = cidToGid
      ? context.register(
          context.flateStream(new Uint8Array(new Uint16Array(swap16(cidToGid)).buffer)),
        )
      : undefined
    const descendant = context.register(
      context.obj({
        Type: 'Font',
        Subtype: isCff ? 'CIDFontType0' : 'CIDFontType2',
        BaseFont: name,
        CIDSystemInfo: context.obj({
          Registry: PDFString.of('Adobe'),
          Ordering: PDFString.of('Identity'),
          Supplement: 0,
        }),
        FontDescriptor: descriptor,
        DW: 0,
        W: widths,
        ...(isCff ? {} : { CIDToGIDMap: map ?? 'Identity' }),
      }),
    )
    // Without this, copying text out of the PDF gives glyph numbers, not letters.
    const toUnicode = context.register(context.flateStream(toUnicodeMap(pf.used)))
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
    if (!pf.synthetic) embedded.set(font, pf)
  }

  for (const ops of layout.pages) {
    const page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT])
    for (const [pf, ref] of fontRefs) page.node.setFontDictionary(PDFName.of(pf.resource), ref)
    page.node.set(PDFName.of('Contents'), context.register(context.flateStream(ops.join('\n'))))
  }
  if (chain.missing.size > 0) opts.onMissing?.([...chain.missing].map(label))
  return Buffer.from(await pdf.save())
}

const label = (s: Script | 'other') => (s === 'other' ? 'symbols' : scriptLabel(s))

/** A table of 16-bit numbers as the big-endian bytes a PDF reads. */
function swap16(a: Uint16Array): Uint16Array {
  const out = new Uint16Array(a.length)
  for (let i = 0; i < a.length; i++) out[i] = (((a[i] ?? 0) & 255) << 8) | ((a[i] ?? 0) >> 8)
  return out
}

/** A ToUnicode CMap: which text each character code stands for. */
function toUnicodeMap(used: Map<number, { gid: number; text: string }>): string {
  const entries = [...used].sort(([a], [b]) => a - b)
  const hex = (v: number) => v.toString(16).padStart(4, '0')
  const utf16 = (s: string) =>
    [...s]
      .flatMap((ch) => {
        const cp = ch.codePointAt(0) ?? 0xfffd
        if (cp < 0x10000) return [hex(cp)]
        const v = cp - 0x10000
        return [hex(0xd800 + (v >> 10)), hex(0xdc00 + (v & 0x3ff))]
      })
      .join('')
  const blocks: string[] = []
  for (let i = 0; i < entries.length; i += 100) {
    const chunk = entries.slice(i, i + 100)
    blocks.push(
      `${chunk.length} beginbfchar\n${chunk.map(([code, u]) => `<${hex(code)}> <${utf16(u.text)}>`).join('\n')}\nendbfchar`,
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
