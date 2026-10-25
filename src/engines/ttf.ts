/**
 * Just enough of an OpenType font (a .ttf, an .otf, or one font of a .ttc) to
 * put it in a PDF: which glyph a character has, how wide it is, and a copy of
 * the font cut down to the glyphs a document uses. `@pdf-lib/fontkit` does
 * this and more, but it ships as one 940 KB file that cannot be trimmed, and
 * Forge's package is kept small. TrueType outlines are cut here; CFF outlines
 * (Noto Sans CJK, Hiragino) in cff.ts. Reads the bytes it is given; touches no file.
 */
import { type Cff, readCff } from './cff.js'

export interface Font {
  unitsPerEm: number
  ascent: number
  descent: number
  capHeight: number
  /** xMin, yMin, xMax, yMax in font units. */
  bbox: readonly [number, number, number, number]
  /** `glyf` is a TrueType font program in a PDF (FontFile2); `cff` a CFF one (FontFile3). */
  outlines: 'glyf' | 'cff'
  /**
   * A variable font: its outlines are its default master, which is often the
   * thinnest weight, and the variations that make the others are not applied.
   */
  variable: boolean
  /** Whether the CFF font's character codes are its own CIDs, not glyph numbers. */
  cidKeyed: boolean
  /** The glyph for a code point, or undefined when the font has none. */
  glyphOf(codePoint: number): number | undefined
  /** The two-byte character code a PDF draws a glyph by: its number, or its CID in a CID-keyed CFF font. */
  codeOf(glyph: number): number
  /** A glyph's advance in font units. */
  advance(glyph: number): number
  /**
   * The font keeping only these glyphs (and .notdef). A TrueType font as an
   * sfnt file, a CFF one as a bare CFF font. The PDF's character codes stay
   * the ones `codeOf` gave; a TrueType subset renumbers its glyphs, and
   * `cidToGid` (indexed by code) says where each went.
   */
  subset(glyphs: Iterable<number>): { data: Uint8Array; cidToGid?: Uint16Array }
}

const MORE_COMPONENTS = 0x20
const ARG_WORDS = 0x01
const HAVE_SCALE = 0x08
const HAVE_XY_SCALE = 0x40
const HAVE_2X2 = 0x80

/** How many fonts a file holds: more than one in a .ttc. */
export function fontCount(bytes: Uint8Array): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  return String.fromCharCode(...bytes.subarray(0, 4)) === 'ttcf' ? view.getUint32(8) : 1
}

export function readFont(bytes: Uint8Array, index = 0): Font {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const dir =
    String.fromCharCode(...bytes.subarray(0, 4)) === 'ttcf' ? view.getUint32(12 + index * 4) : 0
  const tables = new Map<string, { offset: number; length: number }>()
  const count = view.getUint16(dir + 4)
  for (let i = 0; i < count; i++) {
    const at = dir + 12 + i * 16
    const tag = String.fromCharCode(...bytes.subarray(at, at + 4))
    tables.set(tag, { offset: view.getUint32(at + 8), length: view.getUint32(at + 12) })
  }
  const table = (tag: string) => {
    const t = tables.get(tag)
    if (!t) throw new Error(`font has no ${tag} table`)
    return t
  }

  const head = table('head').offset
  const unitsPerEm = view.getUint16(head + 18)
  const longLoca = view.getInt16(head + 50) === 1
  const bbox = [
    view.getInt16(head + 36),
    view.getInt16(head + 38),
    view.getInt16(head + 40),
    view.getInt16(head + 42),
  ] as const
  const hhea = table('hhea').offset
  const ascent = view.getInt16(hhea + 4)
  const descent = view.getInt16(hhea + 6)
  const metrics = view.getUint16(hhea + 34)
  const glyphCount = view.getUint16(table('maxp').offset + 4)
  const hmtx = table('hmtx').offset
  const os2 = tables.get('OS/2')
  // sCapHeight exists from OS/2 version 2; Noto's is 714 of 1000.
  const capHeight =
    os2 && view.getUint16(os2.offset) >= 2
      ? view.getInt16(os2.offset + 88)
      : Math.round(unitsPerEm * 0.714)

  const cmap = readCmap(view, table('cmap').offset)
  const advance = (g: number) => view.getUint16(hmtx + Math.min(g, metrics - 1) * 4)
  const lsb = (g: number) =>
    g < metrics
      ? view.getInt16(hmtx + g * 4 + 2)
      : view.getInt16(hmtx + metrics * 4 + (g - metrics) * 2)
  const glyphOf = (cp: number) => {
    const g = cmap(cp)
    return g === undefined || g === 0 || g >= glyphCount ? undefined : g
  }
  const copy = (tag: string) => {
    const t = table(tag)
    return bytes.subarray(t.offset, t.offset + t.length)
  }

  const cffTable = tables.get('CFF ')
  if (cffTable) {
    const cff: Cff = readCff(bytes.subarray(cffTable.offset, cffTable.offset + cffTable.length))
    return {
      unitsPerEm,
      ascent,
      descent,
      capHeight,
      bbox,
      outlines: 'cff',
      variable: tables.has('fvar'),
      cidKeyed: cff.cidKeyed,
      glyphOf,
      codeOf: (g) => cff.codeOf(g),
      advance,
      subset: (glyphs) => ({ data: cff.subset(glyphs) }),
    }
  }

  const loca = table('loca').offset
  const glyf = table('glyf')
  const glyphRange = (g: number): [number, number] =>
    longLoca
      ? [view.getUint32(loca + g * 4), view.getUint32(loca + g * 4 + 4)]
      : [view.getUint16(loca + g * 2) * 2, view.getUint16(loca + g * 2 + 2) * 2]

  /** The glyphs a composite glyph is made of. */
  const parts = (g: number): number[] => {
    const [from, to] = glyphRange(g)
    if (to <= from) return []
    const at = glyf.offset + from
    if (view.getInt16(at) >= 0) return []
    const out: number[] = []
    let p = at + 10
    for (;;) {
      const flags = view.getUint16(p)
      out.push(view.getUint16(p + 2))
      p += 4 + (flags & ARG_WORDS ? 4 : 2)
      if (flags & HAVE_SCALE) p += 2
      else if (flags & HAVE_XY_SCALE) p += 4
      else if (flags & HAVE_2X2) p += 8
      if (!(flags & MORE_COMPONENTS)) break
    }
    return out
  }

  return {
    unitsPerEm,
    ascent,
    descent,
    capHeight,
    bbox,
    outlines: 'glyf',
    variable: tables.has('fvar'),
    cidKeyed: false,
    glyphOf,
    codeOf: (g) => g,
    advance,
    subset(glyphs) {
      const keep = new Set<number>()
      const todo = [0, ...glyphs]
      for (let g = todo.pop(); g !== undefined; g = todo.pop()) {
        if (keep.has(g)) continue
        keep.add(g)
        todo.push(...parts(g))
      }
      // The kept glyphs, numbered afresh from 0 in their old order: a 50,000 glyph
      // CJK font would otherwise carry 50,000 entries in loca and hmtx for the
      // dozens a document uses. `cidToGid` tells the PDF where each went, so the
      // codes it draws by stay the font's own numbers.
      const order = [...keep].sort((x, y) => x - y)
      const renumber = new Map(order.map((g, i) => [g, i]))
      const offsets = new Uint32Array(order.length + 1)
      const chunks: Uint8Array[] = []
      let size = 0
      order.forEach((g, i) => {
        offsets[i] = size
        const [from, to] = glyphRange(g)
        if (to > from) {
          const data = Uint8Array.from(bytes.subarray(glyf.offset + from, glyf.offset + to))
          // A composite glyph names the glyphs it is made of by number.
          if (new DataView(data.buffer).getInt16(0) < 0) renumberParts(data, renumber)
          chunks.push(data)
          size += data.length
          const pad = (4 - (size % 4)) % 4
          if (pad) {
            chunks.push(new Uint8Array(pad))
            size += pad
          }
        }
      })
      offsets[order.length] = size
      const newGlyf = new Uint8Array(size)
      let at = 0
      for (const c of chunks) {
        newGlyf.set(c, at)
        at += c.length
      }
      const newLoca = new Uint8Array((order.length + 1) * 4)
      const locaView = new DataView(newLoca.buffer)
      offsets.forEach((o, i) => {
        locaView.setUint32(i * 4, o)
      })
      const newHmtx = new Uint8Array(order.length * 4)
      const hmtxView = new DataView(newHmtx.buffer)
      order.forEach((g, i) => {
        hmtxView.setUint16(i * 4, advance(g))
        hmtxView.setInt16(i * 4 + 2, lsb(g))
      })
      // Uint8Array.from: a Buffer's own slice() shares memory with the original.
      const newHead = Uint8Array.from(bytes.subarray(head, head + table('head').length))
      const headView = new DataView(newHead.buffer)
      headView.setUint32(8, 0) // checkSumAdjustment: readers do not check it
      headView.setInt16(50, 1) // indexToLocFormat: the long form written above
      const newHhea = Uint8Array.from(copy('hhea'))
      new DataView(newHhea.buffer).setUint16(34, order.length) // numberOfHMetrics
      const newMaxp = Uint8Array.from(copy('maxp'))
      new DataView(newMaxp.buffer).setUint16(4, order.length) // numGlyphs
      const cidToGid = new Uint16Array((order.at(-1) ?? 0) + 1)
      for (const [g, i] of renumber) cidToGid[g] = i
      return {
        data: sfnt([
          ['glyf', newGlyf],
          ['head', newHead],
          ['hhea', newHhea],
          ['hmtx', newHmtx],
          ['loca', newLoca],
          ['maxp', newMaxp],
        ]),
        cidToGid,
      }
    },
  }
}

/** Rewrites, in place, the glyph numbers a composite glyph's components name. */
function renumberParts(data: Uint8Array, renumber: Map<number, number>): void {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  let p = 10
  for (;;) {
    const flags = view.getUint16(p)
    view.setUint16(p + 2, renumber.get(view.getUint16(p + 2)) ?? 0)
    p += 4 + (flags & ARG_WORDS ? 4 : 2)
    if (flags & HAVE_SCALE) p += 2
    else if (flags & HAVE_XY_SCALE) p += 4
    else if (flags & HAVE_2X2) p += 8
    if (!(flags & MORE_COMPONENTS)) break
  }
}

/** The index of the last element of a sorted `starts` that is at or below `cp`, or -1. */
function floorIndex(starts: Uint32Array, cp: number): number {
  let lo = 0
  let hi = starts.length - 1
  let at = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if ((starts[mid] ?? 0) <= cp) {
      at = mid
      lo = mid + 1
    } else hi = mid - 1
  }
  return at
}

/**
 * A lookup from a code point to a glyph from the font's Unicode cmap: format
 * 12 (the whole of Unicode) where it has one, else format 4 (the Basic
 * Multilingual Plane).
 */
function readCmap(view: DataView, cmap: number): (cp: number) => number | undefined {
  const subtables = view.getUint16(cmap + 2)
  let bmp: ((cp: number) => number | undefined) | undefined
  for (let i = 0; i < subtables; i++) {
    const platform = view.getUint16(cmap + 4 + i * 8)
    const encoding = view.getUint16(cmap + 4 + i * 8 + 2)
    const at = cmap + view.getUint32(cmap + 4 + i * 8 + 4)
    const format = view.getUint16(at)
    const unicode = (platform === 3 && (encoding === 1 || encoding === 10)) || platform === 0
    if (!unicode) continue
    if (format === 12) {
      const groups = view.getUint32(at + 12)
      const starts = new Uint32Array(groups)
      for (let k = 0; k < groups; k++) starts[k] = view.getUint32(at + 16 + k * 12)
      return (cp) => {
        const k = floorIndex(starts, cp)
        if (k < 0) return undefined
        const end = view.getUint32(at + 16 + k * 12 + 4)
        if (cp > end) return undefined
        return view.getUint32(at + 16 + k * 12 + 8) + (cp - (starts[k] ?? 0))
      }
    }
    if (format === 4 && bmp === undefined) {
      const segments = view.getUint16(at + 6) / 2
      const ends = at + 14
      const starts = ends + segments * 2 + 2
      const deltas = starts + segments * 2
      const ranges = deltas + segments * 2
      const segStarts = new Uint32Array(segments)
      for (let s = 0; s < segments; s++) segStarts[s] = view.getUint16(starts + s * 2)
      bmp = (cp) => {
        if (cp > 0xffff) return undefined
        // Segments are sorted by their ends, and so by their starts.
        const s = floorIndex(segStarts, cp)
        if (s < 0 || cp > view.getUint16(ends + s * 2)) return undefined
        const offset = view.getUint16(ranges + s * 2)
        if (offset === 0) return (cp + view.getInt16(deltas + s * 2)) & 0xffff
        const g = view.getUint16(ranges + s * 2 + offset + (cp - (segStarts[s] ?? 0)) * 2)
        return g === 0 ? undefined : (g + view.getInt16(deltas + s * 2)) & 0xffff
      }
    }
  }
  if (bmp) return bmp
  throw new Error('font has no Unicode cmap')
}

function checksum(data: Uint8Array): number {
  const padded = new Uint8Array(Math.ceil(data.length / 4) * 4)
  padded.set(data)
  const view = new DataView(padded.buffer)
  let sum = 0
  for (let i = 0; i < padded.length; i += 4) sum = (sum + view.getUint32(i)) >>> 0
  return sum
}

/** A font file of these tables, in tag order, each padded to four bytes. */
function sfnt(tables: Array<[string, Uint8Array]>): Uint8Array {
  const sorted = [...tables].sort(([a], [b]) => (a < b ? -1 : 1))
  const header = 12 + sorted.length * 16
  const total = sorted.reduce((n, [, d]) => n + Math.ceil(d.length / 4) * 4, header)
  const out = new Uint8Array(total)
  const view = new DataView(out.buffer)
  view.setUint32(0, 0x00010000)
  view.setUint16(4, sorted.length)
  const log = Math.floor(Math.log2(sorted.length))
  view.setUint16(6, 2 ** log * 16)
  view.setUint16(8, log)
  view.setUint16(10, sorted.length * 16 - 2 ** log * 16)
  let at = header
  sorted.forEach(([tag, data], i) => {
    const entry = 12 + i * 16
    out.set(new TextEncoder().encode(tag), entry)
    view.setUint32(entry + 4, checksum(data))
    view.setUint32(entry + 8, at)
    view.setUint32(entry + 12, data.length)
    out.set(data, at)
    at += Math.ceil(data.length / 4) * 4
  })
  return out
}
