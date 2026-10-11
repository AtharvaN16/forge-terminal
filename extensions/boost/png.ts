/**
 * A small PNG reader and a streaming PNG writer, with no dependencies.
 *
 * The boost runner is a self-contained payload — it cannot reach Forge's
 * sharp — and its input is always a PNG Forge prepared, so this only has to
 * read what a PNG encoder produces and write 8-bit RGB or RGBA.
 */

import { closeSync, openSync, readFileSync, writeSync } from 'node:fs'
import { createDeflate, inflateSync } from 'node:zlib'

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

export class PngError extends Error {}

export interface PngHeader {
  width: number
  height: number
  bitDepth: number
  colorType: number
  interlace: number
}

export interface DecodedPng {
  width: number
  height: number
  /** 8-bit RGBA, row-major. */
  rgba: Uint8Array
  /** True when any pixel is not fully opaque. */
  hasAlpha: boolean
}

function chunks(buf: Buffer): { type: string; data: Buffer }[] {
  if (buf.length < 8 || !buf.subarray(0, 8).equals(SIGNATURE)) throw new PngError('not a PNG file')
  const out: { type: string; data: Buffer }[] = []
  let p = 8
  while (p + 8 <= buf.length) {
    const len = buf.readUInt32BE(p)
    const type = buf.toString('latin1', p + 4, p + 8)
    if (p + 12 + len > buf.length) throw new PngError('truncated PNG')
    out.push({ type, data: buf.subarray(p + 8, p + 8 + len) })
    p += 12 + len
    if (type === 'IEND') return out
  }
  throw new PngError('truncated PNG')
}

function header(ihdr: Buffer | undefined): PngHeader {
  if (!ihdr || ihdr.length < 13) throw new PngError('PNG has no header')
  const h = {
    width: ihdr.readUInt32BE(0),
    height: ihdr.readUInt32BE(4),
    bitDepth: ihdr[8] ?? 0,
    colorType: ihdr[9] ?? 0,
    interlace: ihdr[12] ?? 0,
  }
  const depths: Record<number, number[]> = {
    0: [1, 2, 4, 8, 16],
    2: [8, 16],
    3: [1, 2, 4, 8],
    4: [8, 16],
    6: [8, 16],
  }
  if (h.width === 0 || h.height === 0) throw new PngError('PNG has no pixels')
  if (!depths[h.colorType]?.includes(h.bitDepth)) throw new PngError('unsupported PNG pixel format')
  return h
}

/** Reads only the header — cheap, so size limits are checked before decoding. */
export function readPngHeader(path: string): PngHeader {
  const buf = readFileSync(path)
  return header(chunks(buf).find((c) => c.type === 'IHDR')?.data)
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c
  const pa = Math.abs(p - a)
  const pb = Math.abs(p - b)
  const pc = Math.abs(p - c)
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c
}

export function decodePng(path: string): DecodedPng {
  const all = chunks(readFileSync(path))
  const h = header(all.find((c) => c.type === 'IHDR')?.data)
  if (h.interlace !== 0) throw new PngError('interlaced PNG is not supported')
  const palette = all.find((c) => c.type === 'PLTE')?.data
  const trns = all.find((c) => c.type === 'tRNS')?.data
  if (h.colorType === 3 && !palette) throw new PngError('palette PNG has no palette')

  let raw: Buffer
  try {
    raw = inflateSync(Buffer.concat(all.filter((c) => c.type === 'IDAT').map((c) => c.data)))
  } catch {
    throw new PngError('PNG image data is corrupt')
  }

  const samples = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[h.colorType] ?? 1
  const bitsPerPixel = samples * h.bitDepth
  const bpp = Math.max(1, bitsPerPixel >> 3)
  const stride = Math.ceil((h.width * bitsPerPixel) / 8)
  if (raw.length < (stride + 1) * h.height) throw new PngError('PNG image data is truncated')

  const { width: W, height: H } = h
  const rgba = new Uint8Array(W * H * 4)
  let prev = new Uint8Array(stride)
  let cur = new Uint8Array(stride)
  const maxv = (1 << h.bitDepth) - 1
  const trnsGrey = h.colorType === 0 && trns && trns.length >= 2 ? trns.readUInt16BE(0) : -1
  const trnsRgb =
    h.colorType === 2 && trns && trns.length >= 6
      ? [trns.readUInt16BE(0), trns.readUInt16BE(2), trns.readUInt16BE(4)]
      : undefined
  let hasAlpha = false

  for (let y = 0; y < H; y++) {
    const off = y * (stride + 1)
    const filter = raw[off]
    for (let i = 0; i < stride; i++) {
      const x = raw[off + 1 + i] ?? 0
      const a = i >= bpp ? (cur[i - bpp] ?? 0) : 0
      const b = prev[i] ?? 0
      const c = i >= bpp ? (prev[i - bpp] ?? 0) : 0
      let v: number
      if (filter === 0) v = x
      else if (filter === 1) v = x + a
      else if (filter === 2) v = x + b
      else if (filter === 3) v = x + ((a + b) >> 1)
      else if (filter === 4) v = x + paeth(a, b, c)
      else throw new PngError('PNG image data is corrupt')
      cur[i] = v & 0xff
    }

    // One sample at index s of this row, scaled to 8 bits (and its raw value).
    const sample = (s: number): [number, number] => {
      if (h.bitDepth === 16) {
        const hi = cur[s * 2] ?? 0
        return [hi, (hi << 8) | (cur[s * 2 + 1] ?? 0)]
      }
      if (h.bitDepth === 8) {
        const v = cur[s] ?? 0
        return [v, v]
      }
      const bit = s * h.bitDepth
      const v = ((cur[bit >> 3] ?? 0) >> (8 - h.bitDepth - (bit & 7))) & maxv
      return [h.colorType === 3 ? v : Math.round((v * 255) / maxv), v]
    }

    for (let x = 0; x < W; x++) {
      const o = (y * W + x) * 4
      let r: number
      let g: number
      let bl: number
      let al = 255
      if (h.colorType === 0) {
        const [v, rv] = sample(x)
        r = g = bl = v
        if (rv === trnsGrey) al = 0
      } else if (h.colorType === 2) {
        const [rr, r16] = sample(x * 3)
        const [gg, g16] = sample(x * 3 + 1)
        const [bb, b16] = sample(x * 3 + 2)
        r = rr
        g = gg
        bl = bb
        if (trnsRgb && r16 === trnsRgb[0] && g16 === trnsRgb[1] && b16 === trnsRgb[2]) al = 0
      } else if (h.colorType === 3) {
        const [, idx] = sample(x)
        r = palette?.[idx * 3] ?? 0
        g = palette?.[idx * 3 + 1] ?? 0
        bl = palette?.[idx * 3 + 2] ?? 0
        al = trns && idx < trns.length ? (trns[idx] ?? 255) : 255
      } else if (h.colorType === 4) {
        r = g = bl = sample(x * 2)[0]
        al = sample(x * 2 + 1)[0]
      } else {
        r = sample(x * 4)[0]
        g = sample(x * 4 + 1)[0]
        bl = sample(x * 4 + 2)[0]
        al = sample(x * 4 + 3)[0]
      }
      rgba[o] = r
      rgba[o + 1] = g
      rgba[o + 2] = bl
      rgba[o + 3] = al
      if (al !== 255) hasAlpha = true
    }
    const t = prev
    prev = cur
    cur = t
  }
  return { width: W, height: H, rgba, hasAlpha }
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

function crc32(parts: Uint8Array[]): number {
  let c = 0xffffffff
  for (const p of parts)
    for (let i = 0; i < p.length; i++) c = (CRC_TABLE[(c ^ (p[i] ?? 0)) & 0xff] ?? 0) ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

/**
 * Writes a PNG row band by row band, so the whole output never has to sit in
 * memory at once. Rows are filtered with the usual minimum-sum heuristic.
 */
export class PngWriter {
  private readonly fd: number
  private readonly channels: number
  private readonly stride: number
  private prev: Uint8Array
  private readonly deflate = createDeflate({ level: 6 })
  private readonly done: Promise<void>

  constructor(path: string, width: number, height: number, alpha: boolean) {
    this.channels = alpha ? 4 : 3
    this.stride = width * this.channels
    this.prev = new Uint8Array(this.stride)
    this.fd = openSync(path, 'w')
    writeSync(this.fd, SIGNATURE)
    const ihdr = Buffer.alloc(13)
    ihdr.writeUInt32BE(width, 0)
    ihdr.writeUInt32BE(height, 4)
    ihdr[8] = 8
    ihdr[9] = alpha ? 6 : 2
    this.chunk('IHDR', ihdr)
    this.deflate.on('data', (d: Buffer) => this.chunk('IDAT', d))
    this.done = new Promise((resolve, reject) => {
      this.deflate.on('end', resolve)
      this.deflate.on('error', reject)
    })
  }

  private chunk(type: string, data: Uint8Array): void {
    const head = Buffer.alloc(8)
    head.writeUInt32BE(data.length, 0)
    head.write(type, 4, 'latin1')
    const tail = Buffer.alloc(4)
    tail.writeUInt32BE(crc32([head.subarray(4), data]), 0)
    writeSync(this.fd, head)
    writeSync(this.fd, data)
    writeSync(this.fd, tail)
  }

  /** `rows` holds whole rows of 8-bit pixels with this writer's channel count. */
  async writeRows(rows: Uint8Array): Promise<void> {
    const n = rows.length / this.stride
    const out = Buffer.alloc(n * (this.stride + 1))
    const cand = Array.from({ length: 5 }, () => new Uint8Array(this.stride))
    const bpp = this.channels
    for (let y = 0; y < n; y++) {
      const row = rows.subarray(y * this.stride, (y + 1) * this.stride)
      const up = this.prev
      let best = 0
      let bestSum = Number.POSITIVE_INFINITY
      for (let f = 0; f < 5; f++) {
        const c = cand[f] as Uint8Array
        let sum = 0
        for (let i = 0; i < this.stride; i++) {
          const x = row[i] ?? 0
          const a = i >= bpp ? (row[i - bpp] ?? 0) : 0
          const b = up[i] ?? 0
          const cc = i >= bpp ? (up[i - bpp] ?? 0) : 0
          const v =
            f === 0
              ? x
              : f === 1
                ? x - a
                : f === 2
                  ? x - b
                  : f === 3
                    ? x - ((a + b) >> 1)
                    : x - paeth(a, b, cc)
          const byte = v & 0xff
          c[i] = byte
          sum += byte < 128 ? byte : 256 - byte
        }
        if (sum < bestSum) {
          bestSum = sum
          best = f
        }
      }
      const o = y * (this.stride + 1)
      out[o] = best
      out.set(cand[best] as Uint8Array, o + 1)
      this.prev = row
    }
    this.prev = Uint8Array.from(this.prev)
    await new Promise<void>((resolve, reject) =>
      this.deflate.write(out, (err) => (err ? reject(err) : resolve())),
    )
  }

  async close(): Promise<void> {
    this.deflate.end()
    await this.done
    this.chunk('IEND', new Uint8Array(0))
    closeSync(this.fd)
  }
}
