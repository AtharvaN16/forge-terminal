import { readFile, stat } from 'node:fs/promises'
import { heicDecoderUnavailable } from '../core/errors.js'
import type { FormatId } from '../core/types.js'
import { decodeHeic, heicDecodable } from './heic.js'
import { decodeRaw } from './raw.js'

/**
 * What Sharp opens for an image at `path`: the file itself, or — for the two
 * formats Sharp cannot decode, HEIC and camera RAW — the bytes of the PNG the
 * system decoded it to (engines/heic.ts, engines/raw.ts). Bytes rather than
 * the temporary file, so nothing is left on disk to clean up: the PNG is read
 * and deleted as soon as it is written. Encoding from those bytes runs the
 * same libvips decode as encoding from the file, so the output is the same.
 *
 * Either way the caller rotates first (invariant 4). `sips` keeps a photo's
 * orientation as EXIF in the PNG rather than turning its pixels — measured
 * for both formats — so skipping `.rotate()` because "sips already did it"
 * leaves a portrait photo on its side.
 */
export async function decodedInput(path: string, format: FormatId): Promise<string | Buffer> {
  if (format !== 'heic' && format !== 'raw') return path
  return cachedDecode(path, format)
}

/**
 * How much decoded PNG is kept. One photo is looked at by several steps in a
 * row — Trim's measure, the crop preview, the size search, the run, the
 * close-up on Done — and each used to run sips (seconds for a RAW) again.
 * Four entries, one per batch worker at the default pool size, so a batch
 * that measures then runs each file still finds its own. 256 MB, because
 * the PNG is big: a 12 MP HEIC decodes to about 20–35 MB, a 48 MP RAW to
 * well over 100 MB, and this is memory held between steps for nothing else.
 * A decode bigger than the whole limit is not kept at all.
 */
const ENTRIES = 4
const BYTES = 256 * 1024 * 1024
let limitBytes = BYTES

interface Entry {
  /** The file as it was when decoded: a changed file is decoded afresh. */
  size: number
  mtimeMs: number
  png: Promise<Buffer>
  /** The PNG's length once decoded; 0 while it is still decoding. */
  bytes: number
}

/** Least recently used first: a Map keeps insertion order, and a hit moves to the end. */
const cache = new Map<string, Entry>()

/**
 * The decoded PNG, from the cache when the file's size and modified time
 * still match what was decoded. The promise is kept, not the bytes, so two
 * steps asking at once share one decode. A failure is not kept: a decoder
 * that was missing can be installed, and the next ask should try again.
 */
async function cachedDecode(path: string, format: 'heic' | 'raw'): Promise<Buffer> {
  const { size, mtimeMs } = await stat(path)
  const key = `${format}\0${path}`
  const hit = cache.get(key)
  cache.delete(key)
  if (hit && hit.size === size && hit.mtimeMs === mtimeMs) {
    cache.set(key, hit)
    return hit.png
  }
  const entry: Entry = { size, mtimeMs, png: decode(path, format), bytes: 0 }
  cache.set(key, entry)
  entry.png.then(
    (png) => {
      entry.bytes = png.length
      if (png.length > limitBytes && cache.get(key) === entry) cache.delete(key)
      evict()
    },
    () => {
      if (cache.get(key) === entry) cache.delete(key)
    },
  )
  return entry.png
}

function evict(): void {
  let total = 0
  for (const e of cache.values()) total += e.bytes
  for (const [key, e] of cache) {
    if (cache.size <= ENTRIES && total <= limitBytes) break
    cache.delete(key)
    total -= e.bytes
  }
}

async function decode(path: string, format: 'heic' | 'raw'): Promise<Buffer> {
  if (format === 'heic' && !(await heicDecodable())) throw heicDecoderUnavailable(path)
  const decoded = format === 'heic' ? await decodeHeic(path) : await decodeRaw(path)
  try {
    return await readFile(decoded.path)
  } finally {
    await decoded.cleanup()
  }
}

/** Only for tests: forgets every decode. */
export function clearDecodedCacheForTests(): void {
  cache.clear()
}

/** Only for tests: a smaller byte limit, so eviction is tested without 256 MB of PNG. Undefined restores it. */
export function limitDecodedCacheForTests(bytes: number | undefined): void {
  limitBytes = bytes ?? BYTES
}
