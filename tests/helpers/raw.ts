import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import sharp from 'sharp'

/**
 * Camera RAW fixtures, built byte by byte: no library Forge depends on can
 * write one, and real camera files are tens of megabytes.
 *
 * `makeDng` is a genuine DNG that macOS decodes as RAW. The others are only
 * headers — enough for content detection and the orientation read, never for
 * a decode.
 */

type Entry = [tag: number, type: number, values: number[] | string]

const BYTE = 1
const ASCII = 2
const SHORT = 3
const LONG = 4
const RATIONAL = 5
const SRATIONAL = 10

const WIDTHS: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 10: 8 }

/**
 * A little-endian TIFF image file directory laid out at `at`: the bytes, and
 * where values too long for an entry went (straight after it).
 */
function directory(entries: Entry[], at: number, next = 0): Buffer {
  const sorted = [...entries].sort((a, b) => a[0] - b[0])
  const head = Buffer.alloc(2 + sorted.length * 12 + 4)
  head.writeUInt16LE(sorted.length, 0)
  const spill: Buffer[] = []
  let spillAt = at + head.length
  sorted.forEach(([tag, type, values], i) => {
    const p = 2 + i * 12
    head.writeUInt16LE(tag, p)
    head.writeUInt16LE(type, p + 2)
    let data: Buffer
    if (typeof values === 'string') {
      data = Buffer.from(`${values}\0`, 'latin1')
      head.writeUInt32LE(data.length, p + 4)
    } else {
      const rational = type === RATIONAL || type === SRATIONAL
      head.writeUInt32LE(rational ? values.length / 2 : values.length, p + 4)
      const width = rational ? 4 : (WIDTHS[type] ?? 1)
      data = Buffer.alloc(values.length * width)
      values.forEach((v, k) => {
        if (type === BYTE) data.writeUInt8(v, k)
        else if (type === SHORT) data.writeUInt16LE(v, k * 2)
        else if (type === SRATIONAL) data.writeInt32LE(v, k * 4)
        else data.writeUInt32LE(v, k * 4)
      })
    }
    if (data.length <= 4) {
      data.copy(head, p + 8)
    } else {
      head.writeUInt32LE(spillAt, p + 8)
      const padded = data.length % 2 ? Buffer.concat([data, Buffer.alloc(1)]) : data
      spill.push(padded)
      spillAt += padded.length
    }
  })
  head.writeUInt32LE(next, head.length - 4)
  return Buffer.concat([head, ...spill])
}

/** A TIFF-structured file: `magic` (II*\0 for TIFF) and one directory. */
export function tiffBytes(entries: Entry[], magic = 'II*\0'): Buffer {
  const header = Buffer.alloc(8)
  header.write(magic, 0, 'latin1')
  header.writeUInt32LE(8, 4)
  return Buffer.concat([header, directory(entries, 8)])
}

export interface DngOptions {
  /**
   * Below about 300 pixels a side macOS reads a DNG as a plain TIFF and
   * returns its preview (measured: 256×192 is TIFF, 320×240 is RAW).
   */
  width?: number
  height?: number
  orientation?: number
}

/**
 * A DNG laid out the way a camera writes one: a small green preview in the
 * first directory — what a TIFF reader such as Sharp sees — and the real
 * picture, a Bayer mosaic, in a sub-directory only a RAW decoder reads.
 *
 * The picture is a gradient: red rises left to right, green top to bottom,
 * blue fixed at half. A converted file that is green all over, or 16×12, came
 * from the preview.
 */
export function dngBytes({ width = 320, height = 240, orientation = 1 }: DngOptions = {}): Buffer {
  const pw = 16
  const ph = 12
  const preview = Buffer.alloc(pw * ph * 3)
  for (let i = 0; i < pw * ph; i++) preview[i * 3 + 1] = 255

  const mosaic = Buffer.alloc(width * height * 2)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const r = Math.round((x / (width - 1)) * 65535)
      const g = Math.round((y / (height - 1)) * 65535)
      // RGGB: red, green / green, blue.
      const v = y % 2 === 0 ? (x % 2 === 0 ? r : g) : x % 2 === 0 ? g : 32768
      mosaic.writeUInt16LE(v, (y * width + x) * 2)
    }
  }

  const previewAt = 8
  const mosaicAt = previewAt + preview.length
  const rawAt = mosaicAt + mosaic.length
  const raw = directory(
    [
      [254, LONG, [0]],
      [256, LONG, [width]],
      [257, LONG, [height]],
      [258, SHORT, [16]],
      [259, SHORT, [1]],
      [262, SHORT, [32803]],
      [273, LONG, [mosaicAt]],
      [277, SHORT, [1]],
      [278, LONG, [height]],
      [279, LONG, [mosaic.length]],
      [284, SHORT, [1]],
      [33421, SHORT, [2, 2]],
      [33422, BYTE, [0, 1, 1, 2]],
      [50710, BYTE, [0, 1, 2]],
      [50717, LONG, [65535]],
    ],
    rawAt,
  )
  const firstAt = rawAt + raw.length
  const first = directory(
    [
      [254, LONG, [1]],
      [256, LONG, [pw]],
      [257, LONG, [ph]],
      [258, SHORT, [8, 8, 8]],
      [259, SHORT, [1]],
      [262, SHORT, [2]],
      [271, ASCII, 'Forge'],
      [272, ASCII, 'Test Camera'],
      [273, LONG, [previewAt]],
      [274, SHORT, [orientation]],
      [277, SHORT, [3]],
      [278, LONG, [ph]],
      [279, LONG, [preview.length]],
      [284, SHORT, [1]],
      [330, LONG, [rawAt]],
      [50706, BYTE, [1, 4, 0, 0]],
      [50707, BYTE, [1, 1, 0, 0]],
      [50708, ASCII, 'Forge Test Camera'],
      // XYZ to linear sRGB, so the camera's colours are sRGB's.
      [
        50721,
        SRATIONAL,
        [
          32406, 10000, -15372, 10000, -4986, 10000, -9689, 10000, 18758, 10000, 415, 10000, 557,
          10000, -2040, 10000, 10570, 10000,
        ],
      ],
      [50728, RATIONAL, [1, 1, 1, 1, 1, 1]],
      [50778, SHORT, [21]],
    ],
    firstAt,
  )
  const header = Buffer.alloc(8)
  header.write('II*\0', 0, 'latin1')
  header.writeUInt32LE(firstAt, 4)
  return Buffer.concat([header, preview, mosaic, raw, first])
}

export async function makeDng(dir: string, name: string, options?: DngOptions): Promise<string> {
  const path = join(dir, name)
  await writeFile(path, dngBytes(options))
  return path
}

/**
 * A camera's own TIFF: made by a NIKON, but an ordinary RGB picture with no
 * mosaic anywhere. Not RAW, whatever its maker.
 */
export function cameraTiffBytes(): Buffer {
  return tiffBytes([
    [256, LONG, [4]],
    [257, LONG, [4]],
    [262, SHORT, [2]],
    [271, ASCII, 'NIKON CORPORATION'],
    [274, SHORT, [1]],
  ])
}

/** A NEF's first directory: Nikon's maker, a preview, and the mosaic in a sub-directory. */
export function nefBytes(orientation = 1): Buffer {
  const sub = [
    [254, LONG, [0]],
    [262, SHORT, [32803]],
  ] satisfies Entry[]
  // The sub-directory goes after the first; its offset is known once the
  // first is laid out, and the first's length does not depend on the value.
  const first = (subAt: number): Entry[] => [
    [254, LONG, [1]],
    [262, SHORT, [2]],
    [271, ASCII, 'NIKON CORPORATION'],
    [274, SHORT, [orientation]],
    [330, LONG, [subAt]],
  ]
  const head = tiffBytes(first(0))
  const subAt = head.length + (head.length % 2)
  return Buffer.concat([
    tiffBytes(first(subAt)),
    Buffer.alloc(subAt - head.length),
    directory(sub, subAt),
  ])
}

/** A Canon CR2 header: a TIFF whose header carries "CR", version 2, after the usual eight bytes. */
export function cr2Bytes(orientation = 1): Buffer {
  const header = Buffer.alloc(16)
  header.write('II*\0', 0, 'latin1')
  header.writeUInt32LE(16, 4)
  header.write('CR\x02\0', 8, 'latin1')
  return Buffer.concat([
    header,
    directory(
      [
        [271, ASCII, 'Canon'],
        [274, SHORT, [orientation]],
      ],
      16,
    ),
  ])
}

/** An Olympus ORF header: a TIFF in all but its magic. */
export function orfBytes(orientation = 1): Buffer {
  return tiffBytes(
    [
      [271, ASCII, 'OLYMPUS IMAGING CORP.'],
      [274, SHORT, [orientation]],
    ],
    'IIRO',
  )
}

/** A Panasonic RW2 header: likewise TIFF-shaped, with magic IIU\0. */
export function rw2Bytes(orientation = 1): Buffer {
  return tiffBytes(
    [
      [271, ASCII, 'Panasonic'],
      [274, SHORT, [orientation]],
    ],
    'IIU\0',
  )
}

/**
 * A Fujifilm RAF: a fixed header naming where an embedded JPEG is, and that
 * JPEG's EXIF, which is where the orientation lives.
 */
export async function rafBytes(orientation = 1): Promise<Buffer> {
  const jpeg = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#808080' } })
    .withMetadata({ orientation })
    .jpeg()
    .toBuffer()
  const header = Buffer.alloc(160)
  header.write('FUJIFILMCCD-RAW 0201FF383501', 0, 'latin1')
  header.writeUInt32BE(header.length, 84)
  header.writeUInt32BE(jpeg.length, 88)
  return Buffer.concat([header, jpeg])
}

function box(type: string, ...body: Buffer[]): Buffer {
  const content = Buffer.concat(body)
  const head = Buffer.alloc(8)
  head.writeUInt32BE(8 + content.length, 0)
  head.write(type, 4, 'latin1')
  return Buffer.concat([head, content])
}

/** Canon's CR3: ISO media, `crx ` brand, its first TIFF directory in moov/uuid/CMT1. */
export function cr3Bytes(orientation = 1): Buffer {
  const ftyp = box('ftyp', Buffer.from('crx \0\0\0\x01crx isom', 'latin1'))
  const canon = Buffer.from('85c0b687820f11e08111f4ce462b6a48', 'hex')
  const cmt1 = box(
    'CMT1',
    tiffBytes([
      [271, ASCII, 'Canon'],
      [274, SHORT, [orientation]],
    ]),
  )
  return Buffer.concat([ftyp, box('moov', box('uuid', canon, box('CNCV', Buffer.alloc(4)), cmt1))])
}
