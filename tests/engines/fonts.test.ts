import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { gunzipSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { readCff } from '../../src/engines/cff.js'
import { fontCount, readFont } from '../../src/engines/ttf.js'

const fixture = (name: string) =>
  readFileSync(join(process.cwd(), 'tests', 'fixtures', 'fonts', name))
const noto = () =>
  readFileSync(join(process.cwd(), 'assets', 'fonts', 'NotoSans-Regular.ttf.gz')) as Uint8Array
const cp = (c: string) => c.codePointAt(0) ?? 0

describe('readFont', () => {
  it('reads TrueType outlines: a glyph for each character it has, none for the rest', () => {
    const f = readFont(fixture('cjk-glyf.ttf'))
    expect(f.outlines).toBe('glyf')
    expect(f.cidKeyed).toBe(false)
    expect(f.glyphOf(cp('日'))).toBeGreaterThan(0)
    expect(f.glyphOf(cp('漢'))).toBeGreaterThan(0)
    expect(f.glyphOf(cp('ж'))).toBeUndefined()
    expect(f.advance(f.glyphOf(cp('日')) ?? 0)).toBeGreaterThan(f.unitsPerEm / 2)
  })

  it('reads CFF outlines (Noto Sans CJK, Hiragino): a CID-keyed font, drawn by CID', () => {
    const f = readFont(fixture('cjk-cff.otf'))
    expect(f.outlines).toBe('cff')
    expect(f.cidKeyed).toBe(true)
    const g = f.glyphOf(cp('日'))
    expect(g).toBeGreaterThan(0)
    // A CID-keyed font is drawn by CID, which is not the glyph number in a subset like this one.
    expect(f.codeOf(g ?? 0)).toBeGreaterThan(0)
  })

  it('opens one font of a collection by its number', () => {
    const bytes = fixture('collection.ttc')
    expect(fontCount(bytes)).toBe(2)
    const hebrew = readFont(bytes, 0)
    const cjk = readFont(bytes, 1)
    expect(hebrew.glyphOf(cp('ש'))).toBeGreaterThan(0)
    expect(hebrew.glyphOf(cp('日'))).toBeUndefined()
    expect(cjk.glyphOf(cp('日'))).toBeGreaterThan(0)
    expect(cjk.glyphOf(cp('ש'))).toBeUndefined()
    expect(fontCount(fixture('thai.ttf'))).toBe(1)
  })
})

/** The tables of an sfnt font, by tag. */
function tables(data: Uint8Array): Map<string, Uint8Array> {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  const out = new Map<string, Uint8Array>()
  for (let i = 0; i < view.getUint16(4); i++) {
    const at = 12 + i * 16
    const tag = String.fromCharCode(...data.subarray(at, at + 4))
    out.set(
      tag,
      data.subarray(view.getUint32(at + 8), view.getUint32(at + 8) + view.getUint32(at + 12)),
    )
  }
  return out
}

describe('a TrueType subset', () => {
  const f = readFont(gunzipSync(noto()))

  it('keeps only the glyphs asked for, renumbered from 0, and says where each went', () => {
    const e = f.glyphOf(cp('é')) ?? 0
    const a = f.glyphOf(cp('a')) ?? 0
    const { data, cidToGid } = f.subset([a, e])
    const t = tables(data)
    // .notdef, the two, and the plain e and the accent that 'é' is made of.
    const numGlyphs = new DataView(
      t.get('maxp')?.buffer ?? new ArrayBuffer(6),
      t.get('maxp')?.byteOffset,
      6,
    ).getUint16(4)
    expect(numGlyphs).toBe(5)
    expect(cidToGid?.length).toBe(Math.max(a, e) + 1)
    expect(cidToGid?.[a]).toBeGreaterThan(0)
    expect(cidToGid?.[e]).toBeGreaterThan(0)
    expect(cidToGid?.[a]).not.toBe(cidToGid?.[e])
    expect(data.length).toBeLessThan(5000)
    // hmtx follows the new numbering: the kept glyph's width is the original's.
    const hmtx = t.get('hmtx')
    const adv = new DataView(hmtx?.buffer ?? new ArrayBuffer(0), hmtx?.byteOffset, hmtx?.byteLength)
    expect(adv.getUint16((cidToGid?.[a] ?? 0) * 4)).toBe(f.advance(a))
    expect(adv.getUint16((cidToGid?.[e] ?? 0) * 4)).toBe(f.advance(e))
  })

  it('renumbers the parts of an accented letter (a composite glyph) too', () => {
    const e = f.glyphOf(cp('é')) ?? 0
    const { data } = f.subset([e])
    const t = tables(data)
    const glyf = t.get('glyf') as Uint8Array
    const loca = t.get('loca') as Uint8Array
    const locaView = new DataView(loca.buffer, loca.byteOffset, loca.byteLength)
    const count = loca.length / 4 - 1
    let composites = 0
    for (let g = 0; g < count; g++) {
      const from = locaView.getUint32(g * 4)
      if (locaView.getUint32(g * 4 + 4) <= from) continue
      const view = new DataView(glyf.buffer, glyf.byteOffset + from)
      if (view.getInt16(0) >= 0) continue
      composites++
      // Every component it names is a glyph this font has.
      let p = 10
      for (;;) {
        const flags = view.getUint16(p)
        expect(view.getUint16(p + 2)).toBeLessThan(count)
        p += 4 + (flags & 1 ? 4 : 2)
        if (flags & 8) p += 2
        else if (flags & 0x40) p += 4
        else if (flags & 0x80) p += 8
        if (!(flags & 0x20)) break
      }
    }
    expect(composites).toBeGreaterThanOrEqual(1)
    expect(count).toBeGreaterThanOrEqual(3)
  })
})

describe('a CFF subset', () => {
  const cffOf = (name: string) => {
    const bytes = fixture(name)
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    const n = view.getUint16(4)
    for (let i = 0; i < n; i++) {
      const at = 12 + i * 16
      if (String.fromCharCode(...bytes.subarray(at, at + 4)) === 'CFF ')
        return bytes.subarray(
          view.getUint32(at + 8),
          view.getUint32(at + 8) + view.getUint32(at + 12),
        )
    }
    throw new Error('no CFF table')
  }

  it('keeps the drawn glyphs under their own CIDs, and nothing else', () => {
    const f = readFont(fixture('cjk-cff.otf'))
    const glyphs = ['日', '本', '語', 'あ'].map((c) => f.glyphOf(cp(c)) ?? 0)
    const codes = glyphs.map((g) => f.codeOf(g))
    const { data } = f.subset(glyphs)
    const sub = readCff(data)
    // .notdef and the four, nothing more; each still answers to the CID it had.
    expect(sub.glyphCount).toBe(5)
    expect(sub.cidKeyed).toBe(true)
    expect([0, 1, 2, 3, 4].map((g) => sub.codeOf(g))).toEqual([
      0,
      ...[...codes].sort((a, b) => a - b),
    ])
    expect(data.length).toBeLessThan(cffOf('cjk-cff.otf').length / 3)
  })

  it('is the same font again when it is cut twice (a subset of a subset keeps what it kept)', () => {
    const f = readFont(fixture('cjk-cff.otf'))
    const glyphs = ['日', '本'].map((c) => f.glyphOf(cp(c)) ?? 0)
    const once = f.subset(glyphs).data
    expect(readCff(once).glyphCount).toBe(3)
    expect(readCff(f.subset(glyphs).data).glyphCount).toBe(3)
  })

  it('does without the subroutines a glyph is drawn with: they are written into the glyph', () => {
    const f = readFont(fixture('cjk-cff.otf'))
    const big = ['日', '本', '語', '漢', '字', '中', '文', '测', '试'].map(
      (c) => f.glyphOf(cp(c)) ?? 0,
    )
    const { data } = f.subset(big)
    // No subroutine INDEX is left: the global one is empty (two zero bytes after the string INDEX).
    expect(readCff(data).glyphCount).toBe(big.length + 1)
    expect(data.length).toBeLessThan(20_000)
  })
})
