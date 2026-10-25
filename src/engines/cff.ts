/**
 * The part of a CFF font (the outlines of an OpenType .otf or .ttc: Noto Sans
 * CJK on Linux, Hiragino and Apple SD Gothic on a Mac) that a PDF needs: the
 * glyph each character code stands for, and a copy of the font cut down to the
 * glyphs a document uses. Reads the bytes it is given; touches no file.
 *
 * A font such as Noto Sans CJK is 16 MB, nearly all of it outlines and the
 * subroutines they share. The copy keeps every glyph number the original has,
 * empties the outlines nobody drew, empties every subroutine no kept glyph
 * reaches (found by reading the glyphs' Type 2 charstrings), and drops the
 * glyphs nobody drew. A CID-keyed font (Noto Sans CJK) is renumbered, its
 * charset still saying which CID each glyph is, so a PDF's codes do not change.
 * What is left is a few kilobytes.
 */

const INT_5 = 29
const OP = {
  charset: 15,
  encoding: 16,
  charStrings: 17,
  private: 18,
  subrs: 19,
  ros: 1230,
  fdArray: 1236,
  fdSelect: 1237,
} as const

/** A DICT entry: its operator, the numbers before it, and the bytes it was written in. */
interface Entry {
  op: number
  operands: number[]
  raw: Uint8Array
}

interface Index {
  items: Uint8Array[]
  /** One past the last byte of the INDEX in the font. */
  end: number
}

function readIndex(b: Uint8Array, at: number): Index {
  const count = (b[at] ?? 0) * 256 + (b[at + 1] ?? 0)
  if (count === 0) return { items: [], end: at + 2 }
  const offSize = b[at + 2] ?? 1
  const offsets: number[] = []
  let p = at + 3
  for (let i = 0; i <= count; i++) {
    let v = 0
    for (let k = 0; k < offSize; k++) v = v * 256 + (b[p + k] ?? 0)
    offsets.push(v)
    p += offSize
  }
  const base = p - 1
  const items: Uint8Array[] = []
  for (let i = 0; i < count; i++)
    items.push(b.subarray(base + (offsets[i] ?? 0), base + (offsets[i + 1] ?? 0)))
  return { items, end: base + (offsets[count] ?? 1) }
}

function writeIndex(items: Uint8Array[]): Uint8Array {
  if (items.length === 0) return new Uint8Array([0, 0])
  const total = items.reduce((n, i) => n + i.length, 0) + 1
  const offSize = total < 256 ? 1 : total < 65536 ? 2 : total < 16_777_216 ? 3 : 4
  const out = new Uint8Array(3 + (items.length + 1) * offSize + total - 1)
  out[0] = items.length >> 8
  out[1] = items.length & 255
  out[2] = offSize
  let off = 1
  let p = 3
  const put = (v: number) => {
    for (let k = offSize - 1; k >= 0; k--) out[p++] = (v >> (8 * k)) & 255
  }
  put(off)
  for (const item of items) {
    off += item.length
    put(off)
  }
  for (const item of items) {
    out.set(item, p)
    p += item.length
  }
  return out
}

function parseDict(d: Uint8Array): Entry[] {
  const entries: Entry[] = []
  let operands: number[] = []
  let start = 0
  let i = 0
  while (i < d.length) {
    const b = d[i] ?? 0
    if (b <= 21) {
      let op = b
      i++
      if (b === 12) {
        op = 1200 + (d[i] ?? 0)
        i++
      }
      entries.push({ op, operands, raw: d.subarray(start, i) })
      operands = []
      start = i
    } else if (b === 28) {
      operands.push(((((d[i + 1] ?? 0) << 8) | (d[i + 2] ?? 0)) << 16) >> 16)
      i += 3
    } else if (b === INT_5) {
      operands.push(
        ((d[i + 1] ?? 0) << 24) |
          ((d[i + 2] ?? 0) << 16) |
          ((d[i + 3] ?? 0) << 8) |
          (d[i + 4] ?? 0),
      )
      i += 5
    } else if (b === 30) {
      i++
      while (i < d.length && ((d[i] ?? 0) & 15) !== 15 && (d[i] ?? 0) >> 4 !== 15) i++
      i++
      operands.push(0)
    } else if (b >= 32 && b <= 246) {
      operands.push(b - 139)
      i++
    } else if (b >= 247 && b <= 250) {
      operands.push((b - 247) * 256 + (d[i + 1] ?? 0) + 108)
      i += 2
    } else if (b >= 251 && b <= 254) {
      operands.push(-(b - 251) * 256 - (d[i + 1] ?? 0) - 108)
      i += 2
    } else {
      i++
    }
  }
  return entries
}

/** A number as five bytes, so a DICT's size does not depend on the values in it. */
function int5(v: number): number[] {
  return [INT_5, (v >> 24) & 255, (v >> 16) & 255, (v >> 8) & 255, v & 255]
}

function operator(op: number): number[] {
  return op >= 1200 ? [12, op - 1200] : [op]
}

/** An entry with new operands, in fixed-width form. */
function entryWith(op: number, operands: number[]): Uint8Array {
  return Uint8Array.from([...operands.flatMap(int5), ...operator(op)])
}

function dictBytes(entries: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(entries.reduce((n, e) => n + e.length, 0))
  let p = 0
  for (const e of entries) {
    out.set(e, p)
    p += e.length
  }
  return out
}

const entryOf = (entries: Entry[], op: number) => entries.find((e) => e.op === op)

function subrBias(count: number): number {
  return count < 1240 ? 107 : count < 33_900 ? 1131 : 32_768
}

export interface Cff {
  /** Whether character codes are the font's CIDs (a CID-keyed font) or its glyph numbers. */
  cidKeyed: boolean
  glyphCount: number
  /** The character code a glyph is drawn by: its CID when the font is CID-keyed, else its number. */
  codeOf(glyph: number): number
  /** The font with only these glyphs (and .notdef) drawn; the glyph numbers stay as they were. */
  subset(glyphs: Iterable<number>): Uint8Array
}

export function readCff(b: Uint8Array): Cff {
  const hdrSize = b[2] ?? 4
  const names = readIndex(b, hdrSize)
  const tops = readIndex(b, names.end)
  const strings = readIndex(b, tops.end)
  const gsubrs = readIndex(b, strings.end)
  const topEntries = parseDict(tops.items[0] ?? new Uint8Array())
  const cidKeyed = entryOf(topEntries, OP.ros) !== undefined

  const charStringsAt = entryOf(topEntries, OP.charStrings)?.operands[0] ?? 0
  const charStrings = readIndex(b, charStringsAt)
  const glyphCount = charStrings.items.length

  // charset: the number each glyph is known by (a CID, or a string id).
  const charsetAt = entryOf(topEntries, OP.charset)?.operands[0] ?? 0
  const charset = new Array<number>(glyphCount).fill(0)
  if (charsetAt <= 2) {
    for (let g = 0; g < glyphCount; g++) charset[g] = g
  } else {
    const format = b[charsetAt] ?? 0
    let p = charsetAt + 1
    let g = 1
    if (format === 0) {
      for (; g < glyphCount; g++, p += 2) charset[g] = ((b[p] ?? 0) << 8) | (b[p + 1] ?? 0)
    } else {
      while (g < glyphCount) {
        const first = ((b[p] ?? 0) << 8) | (b[p + 1] ?? 0)
        let left = b[p + 2] ?? 0
        p += 3
        if (format === 2) {
          left = (left << 8) | (b[p] ?? 0)
          p++
        }
        for (let k = 0; k <= left && g < glyphCount; k++, g++) charset[g] = first + k
      }
    }
  }

  // FDSelect, and each font dict's private dict and local subroutines.
  const fdArrayAt = entryOf(topEntries, OP.fdArray)?.operands[0]
  const fdSelectAt = entryOf(topEntries, OP.fdSelect)?.operands[0]
  const fdDicts = fdArrayAt === undefined ? [] : readIndex(b, fdArrayAt).items.map(parseDict)
  const fdOf = new Array<number>(glyphCount).fill(0)
  if (fdSelectAt !== undefined) {
    const format = b[fdSelectAt] ?? 0
    if (format === 0) for (let g = 0; g < glyphCount; g++) fdOf[g] = b[fdSelectAt + 1 + g] ?? 0
    else {
      const nRanges = ((b[fdSelectAt + 1] ?? 0) << 8) | (b[fdSelectAt + 2] ?? 0)
      let p = fdSelectAt + 3
      for (let r = 0; r < nRanges; r++, p += 3) {
        const first = ((b[p] ?? 0) << 8) | (b[p + 1] ?? 0)
        const next = ((b[p + 3] ?? 0) << 8) | (b[p + 4] ?? 0)
        for (let g = first; g < next && g < glyphCount; g++) fdOf[g] = b[p + 2] ?? 0
      }
    }
  }
  interface Priv {
    dict: Entry[]
    subrs: Uint8Array[]
  }
  const privateOf = (dict: Entry[]): Priv => {
    const [size, at] = entryOf(dict, OP.private)?.operands ?? []
    if (size === undefined || at === undefined) return { dict: [], subrs: [] }
    const pd = parseDict(b.subarray(at, at + size))
    const subrsAt = entryOf(pd, OP.subrs)?.operands[0]
    return { dict: pd, subrs: subrsAt === undefined ? [] : readIndex(b, at + subrsAt).items }
  }
  const topPrivate = privateOf(topEntries)
  const privates: Priv[] = fdDicts.length > 0 ? fdDicts.map(privateOf) : [topPrivate]

  return {
    cidKeyed,
    glyphCount,
    codeOf: (g) => (cidKeyed ? (charset[g] ?? 0) : g),
    subset(glyphs) {
      const keep = new Set<number>([0])
      for (const g of glyphs) if (g >= 0 && g < glyphCount) keep.add(g)
      const count = Math.max(...keep) + 1

      // Each kept glyph with the subroutines it calls written into it, so the font
      // needs none. A glyph this cannot do that for (arithmetic in its charstring,
      // a subroutine number it cannot see) sends the whole font the other way:
      // its subroutines are kept, less the ones nothing reaches.
      const flat = new Map<number, Uint8Array>()
      for (const g of keep) {
        const f = flatten(
          charStrings.items[g] ?? new Uint8Array(),
          (privates[fdOf[g] ?? 0] ?? topPrivate).subrs,
          gsubrs.items,
        )
        if (!f) {
          flat.clear()
          break
        }
        flat.set(g, f)
      }
      const flattened = flat.size === keep.size
      const usedLocal = privates.map(() => new Set<number>())
      const usedGlobal = new Set<number>()
      if (!flattened)
        for (const g of keep)
          scan(charStrings.items[g] ?? new Uint8Array(), privates[fdOf[g] ?? 0] ?? topPrivate, {
            local: usedLocal[fdOf[g] ?? 0] ?? new Set(),
            global: usedGlobal,
            gsubrs: gsubrs.items,
          })
      const body = (g: number) => (flattened ? flat.get(g) : charStrings.items[g])

      const END = new Uint8Array([14])
      const RET = new Uint8Array([11])
      // A CID-keyed font keeps only the glyphs drawn, in their old order, and the
      // charset says which CID each is. Any other font keeps its numbers, since a
      // PDF draws those by glyph number; it only ends after the last glyph kept.
      const order = cidKeyed
        ? [...keep].sort((x, y) => x - y)
        : Array.from({ length: count }, (_, g) => g)
      /**
       * A subroutine list with the unused ones emptied, and cut after the last
       * used one. A charstring finds a subroutine by its number plus a bias that
       * depends on how many there are, so the list is never cut below the size
       * class it was in: 1240 for the middle one, 33900 for the top.
       */
      const thin = (items: Uint8Array[], used: Set<number>) => {
        if (used.size === 0) return []
        const floor = items.length >= 33_900 ? 33_900 : items.length >= 1240 ? 1240 : 0
        const last = Math.max(...used) + 1
        return items.slice(0, Math.max(last, floor)).map((s, i) => (used.has(i) ? s : RET))
      }
      const outGlobal = writeIndex(flattened ? [] : thin(gsubrs.items, usedGlobal))
      const outStrings = writeIndex(order.map((g) => (keep.has(g) ? (body(g) ?? END) : END)))

      // charset, as ranges of consecutive numbers; FDSelect, as ranges of one font dict.
      const outCharset = encodeCharset(order.map((g) => charset[g] ?? 0))
      const outFdSelect =
        fdDicts.length > 0 ? encodeFdSelect(order.map((g) => fdOf[g] ?? 0)) : undefined

      // Private dicts, each followed by its local subroutines.
      const privBlocks = privates.map((p, i) => {
        const subrs = writeIndex(flattened ? [] : thin(p.subrs, usedLocal[i] ?? new Set()))
        const entries = p.dict.filter((e) => e.op !== OP.subrs).map((e) => e.raw)
        const hasSubrs = !flattened && p.subrs.length > 0
        const fixed = hasSubrs ? entryWith(OP.subrs, [0]) : new Uint8Array()
        const size = dictBytes([...entries]).length + fixed.length
        const dict = dictBytes([...entries, ...(hasSubrs ? [entryWith(OP.subrs, [size])] : [])])
        return { dict, subrs: hasSubrs ? subrs : new Uint8Array() }
      })

      // Lay out: header, names, top dict, strings, global subrs, charset, FDSelect,
      // CharStrings, font dicts, then the private dicts and their subroutines.
      const head = Uint8Array.from([1, 0, 4, 4])
      const nameIndex = writeIndex(names.items)
      const stringIndex = writeIndex(strings.items)
      const topShape = (o: {
        charset: number
        charStrings: number
        fdArray: number
        fdSelect: number
        priv: [number, number]
      }) => {
        const out: Uint8Array[] = []
        for (const e of topEntries) {
          if (e.op === OP.charset) out.push(entryWith(OP.charset, [o.charset]))
          else if (e.op === OP.charStrings) out.push(entryWith(OP.charStrings, [o.charStrings]))
          else if (e.op === OP.fdArray) out.push(entryWith(OP.fdArray, [o.fdArray]))
          else if (e.op === OP.fdSelect) out.push(entryWith(OP.fdSelect, [o.fdSelect]))
          else if (e.op === OP.private) out.push(entryWith(OP.private, [...o.priv]))
          else if (e.op === OP.encoding) out.push(entryWith(OP.encoding, [0]))
          else out.push(e.raw)
        }
        return writeIndex([dictBytes(out)])
      }
      const topSize = topShape({
        charset: 0,
        charStrings: 0,
        fdArray: 0,
        fdSelect: 0,
        priv: [0, 0],
      }).length
      let at = head.length + nameIndex.length + topSize + stringIndex.length + outGlobal.length
      const charsetAtOut = at
      at += outCharset.length
      const fdSelectAtOut = at
      at += outFdSelect?.length ?? 0
      const charStringsAtOut = at
      at += outStrings.length
      // Font dicts are sized before their private offsets are known: fixed-width operands.
      const fdShape = (offsets: Array<[number, number]>) =>
        writeIndex(
          fdDicts.map((d, i) =>
            dictBytes(
              d.map((e) =>
                e.op === OP.private ? entryWith(OP.private, [...(offsets[i] ?? [0, 0])]) : e.raw,
              ),
            ),
          ),
        )
      const fdArrayAtOut = at
      at += fdDicts.length > 0 ? fdShape(fdDicts.map(() => [0, 0])).length : 0
      const privAt: Array<[number, number]> = []
      for (const block of privBlocks) {
        privAt.push([block.dict.length, at])
        at += block.dict.length + block.subrs.length
      }
      const top = topShape({
        charset: charsetAtOut,
        charStrings: charStringsAtOut,
        fdArray: fdArrayAtOut,
        fdSelect: fdSelectAtOut,
        priv: privAt[0] ?? [0, 0],
      })
      const parts: Uint8Array[] = [
        head,
        nameIndex,
        top,
        stringIndex,
        outGlobal,
        outCharset,
        ...(outFdSelect ? [outFdSelect] : []),
        outStrings,
        ...(fdDicts.length > 0 ? [fdShape(privAt)] : []),
        ...privBlocks.flatMap((p) => [p.dict, p.subrs]),
      ]
      const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
      let p = 0
      for (const part of parts) {
        out.set(part, p)
        p += part.length
      }
      return out
    },
  }
}

/** A charset, glyph 1 on: runs of consecutive numbers (format 2), or each number alone (format 0), whichever is shorter. */
function encodeCharset(charset: number[]): Uint8Array {
  const ranges: number[] = [2]
  let g = 1
  while (g < charset.length) {
    const first = charset[g] ?? 0
    let left = 0
    while (g + left + 1 < charset.length && (charset[g + left + 1] ?? 0) === first + left + 1)
      left++
    ranges.push(first >> 8, first & 255, left >> 8, left & 255)
    g += left + 1
  }
  const each = 1 + 2 * Math.max(0, charset.length - 1)
  if (ranges.length <= each) return Uint8Array.from(ranges)
  const out = [0]
  for (let k = 1; k < charset.length; k++) out.push((charset[k] ?? 0) >> 8, (charset[k] ?? 0) & 255)
  return Uint8Array.from(out)
}

/** An FDSelect (format 3): runs of glyphs on one font dict. */
function encodeFdSelect(fd: number[]): Uint8Array {
  const ranges: number[] = []
  let last = -1
  let n = 0
  fd.forEach((v, g) => {
    if (v !== last) {
      ranges.push(g >> 8, g & 255, v)
      last = v
      n++
    }
  })
  return Uint8Array.from([3, n >> 8, n & 255, ...ranges, fd.length >> 8, fd.length & 255])
}

/**
 * One glyph's charstring with every subroutine call replaced by what it calls,
 * or undefined when it cannot be done safely. A call is a number pushed just
 * before the operator; the number is cut out and the subroutine's own bytes
 * (less their `return`) go in its place.
 */
function flatten(
  cs: Uint8Array,
  localSubrs: Uint8Array[],
  globalSubrs: Uint8Array[],
): Uint8Array | undefined {
  const out: number[] = []
  // Where each number now on the stack begins in `out`, and how long it is.
  const at: number[] = []
  const len: number[] = []
  const vals: number[] = []
  let stems = 0
  let failed = false
  const clear = () => {
    at.length = 0
    len.length = 0
    vals.length = 0
  }
  const push = (v: number, bytes: number[]) => {
    at.push(out.length)
    len.push(bytes.length)
    vals.push(v)
    out.push(...bytes)
  }
  // Returns true once the glyph has ended (endchar), false on a return.
  const run = (code: Uint8Array, depth: number): boolean => {
    if (depth > 10) {
      failed = true
      return true
    }
    let i = 0
    while (i < code.length && !failed) {
      const b = code[i] ?? 0
      i++
      if (b === 28) {
        const raw = [28, code[i] ?? 0, code[i + 1] ?? 0]
        push(((((code[i] ?? 0) << 8) | (code[i + 1] ?? 0)) << 16) >> 16, raw)
        i += 2
      } else if (b >= 32 && b <= 246) push(b - 139, [b])
      else if (b >= 247 && b <= 250) {
        push((b - 247) * 256 + (code[i] ?? 0) + 108, [b, code[i] ?? 0])
        i++
      } else if (b >= 251 && b <= 254) {
        push(-(b - 251) * 256 - (code[i] ?? 0) - 108, [b, code[i] ?? 0])
        i++
      } else if (b === 255) {
        push(0, [255, code[i] ?? 0, code[i + 1] ?? 0, code[i + 2] ?? 0, code[i + 3] ?? 0])
        i += 4
      } else if (b === 10 || b === 29) {
        const list = b === 10 ? localSubrs : globalSubrs
        const n = vals.pop()
        const start = at.pop()
        const size = len.pop()
        // The number must be the last thing written, or it cannot be cut out.
        if (
          n === undefined ||
          start === undefined ||
          size === undefined ||
          start + size !== out.length
        ) {
          failed = true
          return true
        }
        const sub = list[n + subrBias(list.length)]
        if (sub === undefined) {
          failed = true
          return true
        }
        out.length = start
        if (run(sub, depth + 1)) return true
      } else if (b === 11) return false
      else if (b === 14) {
        out.push(14)
        return true
      } else if (b === 1 || b === 3 || b === 18 || b === 23) {
        stems += vals.length >> 1
        clear()
        out.push(b)
      } else if (b === 19 || b === 20) {
        stems += vals.length >> 1
        clear()
        const mask = (stems + 7) >> 3
        out.push(b, ...Array.from(code.subarray(i, i + mask)))
        i += mask
      } else if (b === 12) {
        const b2 = code[i++] ?? 0
        if (b2 >= 34 && b2 <= 37) {
          clear()
          out.push(12, b2)
        } else {
          failed = true
          return true
        }
      } else {
        clear()
        out.push(b)
      }
    }
    return false
  }
  const ended = run(cs, 0)
  if (failed) return undefined
  if (!ended) out.push(14)
  return Uint8Array.from(out)
}

interface Scan {
  local: Set<number>
  global: Set<number>
  gsubrs: Uint8Array[]
}

/**
 * Reads one glyph's Type 2 charstring (and the subroutines it calls) for the
 * subroutines it uses. A stack of numbers is kept only as far as it takes to
 * know which subroutine a call names and how many bytes a hint mask has; a
 * charstring that does something else (arithmetic, say) marks every subroutine
 * used, which costs size, never correctness.
 */
function scan(cs: Uint8Array, priv: { subrs: Uint8Array[] }, into: Scan): void {
  const seen = new Set<string>()
  let unsafe = false
  let stems = 0
  const stack: number[] = []
  const run = (code: Uint8Array, depth: number): boolean => {
    if (depth > 10) {
      unsafe = true
      return true
    }
    let i = 0
    while (i < code.length) {
      const b = code[i] ?? 0
      i++
      if (b >= 32 || b === 28) {
        if (b === 28) {
          stack.push(((((code[i] ?? 0) << 8) | (code[i + 1] ?? 0)) << 16) >> 16)
          i += 2
        } else if (b <= 246) stack.push(b - 139)
        else if (b <= 250) stack.push((b - 247) * 256 + (code[i++] ?? 0) + 108)
        else if (b <= 254) stack.push(-(b - 251) * 256 - (code[i++] ?? 0) - 108)
        else {
          stack.push(
            (((code[i] ?? 0) << 24) |
              ((code[i + 1] ?? 0) << 16) |
              ((code[i + 2] ?? 0) << 8) |
              (code[i + 3] ?? 0)) /
              65536,
          )
          i += 4
        }
        continue
      }
      if (b === 10 || b === 29) {
        const list = b === 10 ? priv.subrs : into.gsubrs
        const n = stack.pop()
        if (n === undefined) {
          unsafe = true
          return true
        }
        const idx = n + subrBias(list.length)
        const sub = list[idx]
        if (sub === undefined) {
          unsafe = true
          return true
        }
        const key = `${b}:${idx}:${stems}`
        if (!seen.has(key)) {
          seen.add(key)
          ;(b === 10 ? into.local : into.global).add(idx)
          if (run(sub, depth + 1)) return true
        }
        continue
      }
      if (b === 11) return false
      if (b === 14) return true
      if (b === 1 || b === 3 || b === 18 || b === 23) {
        stems += stack.length >> 1
        stack.length = 0
        continue
      }
      if (b === 19 || b === 20) {
        stems += stack.length >> 1
        stack.length = 0
        i += (stems + 7) >> 3
        continue
      }
      if (b === 12) {
        const b2 = code[i++] ?? 0
        // The flex operators only draw; the rest do arithmetic this does not follow.
        if (b2 >= 34 && b2 <= 37) stack.length = 0
        else {
          unsafe = true
          return true
        }
        continue
      }
      // moveto, lineto, curveto and their kin: they use the stack up.
      stack.length = 0
    }
    return false
  }
  run(cs, 0)
  if (unsafe) {
    priv.subrs.forEach((_, k) => {
      into.local.add(k)
    })
    into.gsubrs.forEach((_, k) => {
      into.global.add(k)
    })
  }
}
