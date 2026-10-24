/**
 * Just enough of a TrueType file to put it in a PDF: which glyph a character
 * has, how wide it is, and a copy of the font cut down to the glyphs a
 * document uses. `@pdf-lib/fontkit` does this and more, but it ships as one
 * 940 KB file that cannot be trimmed, and Forge's package is kept small. Reads
 * the bytes it is given; touches no file.
 */

export interface Font {
  unitsPerEm: number
  ascent: number
  descent: number
  capHeight: number
  /** xMin, yMin, xMax, yMax in font units. */
  bbox: readonly [number, number, number, number]
  /** The glyph for a code point, or undefined when the font has none. */
  glyphOf(codePoint: number): number | undefined
  /** A glyph's advance in font units. */
  advance(glyph: number): number
  /** The font keeping only these glyphs (and .notdef); glyph numbers stay as they are. */
  subset(glyphs: Iterable<number>): Uint8Array
}

const MORE_COMPONENTS = 0x20
const ARG_WORDS = 0x01
const HAVE_SCALE = 0x08
const HAVE_XY_SCALE = 0x40
const HAVE_2X2 = 0x80

export function readFont(bytes: Uint8Array): Font {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const tables = new Map<string, { offset: number; length: number }>()
  const count = view.getUint16(4)
  for (let i = 0; i < count; i++) {
    const at = 12 + i * 16
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
    glyphOf: (cp) => {
      const g = cmap(cp)
      return g === undefined || g === 0 ? undefined : g
    },
    advance: (g) => view.getUint16(hmtx + Math.min(g, metrics - 1) * 4),
    subset(glyphs) {
      const keep = new Set<number>()
      const todo = [0, ...glyphs]
      for (let g = todo.pop(); g !== undefined; g = todo.pop()) {
        if (keep.has(g)) continue
        keep.add(g)
        todo.push(...parts(g))
      }
      // glyf with only the kept glyphs' outlines; every other glyph is empty, so
      // numbers (and so the PDF's character codes) are the font's own.
      const offsets = new Uint32Array(glyphCount + 1)
      const chunks: Uint8Array[] = []
      let size = 0
      for (let g = 0; g < glyphCount; g++) {
        offsets[g] = size
        if (!keep.has(g)) continue
        const [from, to] = glyphRange(g)
        const data = bytes.subarray(glyf.offset + from, glyf.offset + to)
        chunks.push(data)
        size += data.length
        const pad = (4 - (size % 4)) % 4
        if (pad) {
          chunks.push(new Uint8Array(pad))
          size += pad
        }
      }
      offsets[glyphCount] = size
      const newGlyf = new Uint8Array(size)
      let at = 0
      for (const c of chunks) {
        newGlyf.set(c, at)
        at += c.length
      }
      const newLoca = new Uint8Array((glyphCount + 1) * 4)
      const locaView = new DataView(newLoca.buffer)
      offsets.forEach((o, i) => {
        locaView.setUint32(i * 4, o)
      })
      // Uint8Array.from: a Buffer's own slice() shares memory with the original.
      const newHead = Uint8Array.from(bytes.subarray(head, head + table('head').length))
      const headView = new DataView(newHead.buffer)
      headView.setUint32(8, 0) // checkSumAdjustment: readers do not check it
      headView.setInt16(50, 1) // indexToLocFormat: the long form written above
      const copy = (tag: string) => {
        const t = table(tag)
        return bytes.subarray(t.offset, t.offset + t.length)
      }
      return sfnt([
        ['glyf', newGlyf],
        ['head', newHead],
        ['hhea', copy('hhea')],
        ['hmtx', copy('hmtx')],
        ['loca', newLoca],
        ['maxp', copy('maxp')],
      ])
    },
  }
}

/** A lookup from a code point to a glyph, from the font's format 4 (Basic Multilingual Plane) cmap. */
function readCmap(view: DataView, cmap: number): (cp: number) => number | undefined {
  const subtables = view.getUint16(cmap + 2)
  for (let i = 0; i < subtables; i++) {
    const platform = view.getUint16(cmap + 4 + i * 8)
    const encoding = view.getUint16(cmap + 4 + i * 8 + 2)
    const at = cmap + view.getUint32(cmap + 4 + i * 8 + 4)
    // Windows Unicode BMP, or Unicode platform: both are format 4 in the fonts Forge ships.
    if (!((platform === 3 && encoding === 1) || platform === 0) || view.getUint16(at) !== 4)
      continue
    const segments = view.getUint16(at + 6) / 2
    const ends = at + 14
    const starts = ends + segments * 2 + 2
    const deltas = starts + segments * 2
    const ranges = deltas + segments * 2
    return (cp) => {
      if (cp > 0xffff) return undefined
      for (let s = 0; s < segments; s++) {
        if (cp > view.getUint16(ends + s * 2)) continue
        if (cp < view.getUint16(starts + s * 2)) return undefined
        const offset = view.getUint16(ranges + s * 2)
        if (offset === 0) return (cp + view.getInt16(deltas + s * 2)) & 0xffff
        const g = view.getUint16(
          ranges + s * 2 + offset + (cp - view.getUint16(starts + s * 2)) * 2,
        )
        return g === 0 ? undefined : (g + view.getInt16(deltas + s * 2)) & 0xffff
      }
      return undefined
    }
  }
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
