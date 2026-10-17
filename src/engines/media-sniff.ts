/**
 * Video and sound recognised by their first bytes (invariant 3), without
 * ffmpeg: so a video dropped on a Mac without it is still known for what it
 * is, and offered the download rather than refused.
 */

/** The formats a head of bytes can be recognised as. */
export type MediaFormat =
  | 'mp4'
  | 'mov'
  | 'm4a'
  | 'webm'
  | 'mkv'
  | 'avi'
  | 'wav'
  | 'aiff'
  | 'flac'
  | 'mp3'
  | 'opus'
  | 'ogg'

/** How many bytes `sniffMedia` wants. */
export const SNIFF_BYTES = 64

const text = (b: Buffer, at: number, n: number) => b.subarray(at, at + n).toString('latin1')

/** ISO media brands that are pictures, not video: HEIC and AVIF share the ftyp box. */
const PICTURE_BRANDS = new Set([
  'heic',
  'heix',
  'hevc',
  'hevx',
  'heim',
  'heis',
  'mif1',
  'msf1',
  'avif',
  'avis',
  // Canon's raw photos.
  'crx ',
])
const SOUND_BRANDS = new Set(['M4A ', 'M4B ', 'M4P ', 'F4A ', 'F4B '])

function ftyp(head: Buffer): MediaFormat | undefined {
  const brand = text(head, 8, 4)
  if (PICTURE_BRANDS.has(brand)) return undefined
  if (brand === 'qt  ') return 'mov'
  if (SOUND_BRANDS.has(brand)) return 'm4a'
  return 'mp4'
}

/** The format of a file starting with `head`, or undefined when it is not video or sound. */
export function sniffMedia(head: Buffer): MediaFormat | undefined {
  if (head.length < 4) return undefined
  if (text(head, 4, 4) === 'ftyp') return ftyp(head)
  if (head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3) {
    // EBML: the doctype names WebM; anything else is Matroska.
    return head.includes('webm', 0, 'latin1') ? 'webm' : 'mkv'
  }
  const four = text(head, 0, 4)
  if (four === 'RIFF') {
    const kind = text(head, 8, 4)
    if (kind === 'WAVE') return 'wav'
    if (kind === 'AVI ') return 'avi'
    return undefined
  }
  if (four === 'FORM') {
    const kind = text(head, 8, 4)
    return kind === 'AIFF' || kind === 'AIFC' ? 'aiff' : undefined
  }
  if (four === 'fLaC') return 'flac'
  if (four === 'OggS') return head.includes('OpusHead', 0, 'latin1') ? 'opus' : 'ogg'
  if (text(head, 0, 3) === 'ID3') return 'mp3'
  // An MPEG audio frame: eleven sync bits, then layer III.
  if (head[0] === 0xff && ((head[1] ?? 0) & 0xe0) === 0xe0 && ((head[1] ?? 0) & 0x06) === 0x02) {
    return 'mp3'
  }
  return undefined
}
