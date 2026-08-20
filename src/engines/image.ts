import { randomBytes } from 'node:crypto'
import { constants } from 'node:fs'
import { access, mkdir, rename, rm, stat } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import type { Metadata, Sharp } from 'sharp'
import sharp from 'sharp'
import {
  conversionFailed,
  corruptSource,
  fileNotFound,
  heicDecoderUnavailable,
  isForgeError,
  notADirectory,
  notAFile,
  outputInvalid,
  pathTooLong,
  permissionDenied,
  symlinkLoop,
  unreadablePath,
  unsupportedSource,
} from '../core/errors.js'
import { FORMATS } from '../core/formats.js'
import type { FormatId, Job, Phase, Result, SourceInfo, Warning } from '../core/types.js'
import { decodeHeic, heicDecodable, heicInfo, looksLikeHeic } from './heic.js'
import type { Engine } from './types.js'

const READS: ReadonlySet<FormatId> = new Set<FormatId>([
  'jpeg',
  'png',
  'webp',
  'avif',
  'heic',
  'gif',
  'tiff',
])

/** heic is absent deliberately: sharp cannot encode HEVC. */
const WRITES: ReadonlySet<FormatId> = new Set<FormatId>([
  'jpeg',
  'png',
  'webp',
  'avif',
  'gif',
  'tiff',
])

const DIRECT: Record<string, FormatId> = {
  jpeg: 'jpeg',
  png: 'png',
  webp: 'webp',
  gif: 'gif',
  tiff: 'tiff',
}

/**
 * Sharp reports HEIC and AVIF with the same format string. The compression
 * field is the only thing separating them, and getting it wrong would offer
 * HEIC as a writable target — which fails at encode time.
 */
function identify(path: string, meta: Metadata): FormatId {
  if (meta.format === 'heif') return meta.compression === 'av1' ? 'avif' : 'heic'
  const id = DIRECT[meta.format ?? '']
  if (!id) throw unsupportedSource(path, meta.format ?? 'an unknown format')
  return id
}

/**
 * `stat`'s error taxonomy must be total, not partial: this is called
 * directly by the interactive shell (unlike the CLI's `resolveInputs`,
 * which stats every input up front and only ever forwards `probe` a path
 * already known to exist), so a typed or pasted path reaches this
 * unfiltered. Every errno not given a specific, well-worded error above
 * still becomes a `ForgeError` via `unreadablePath` — never a raw `Error`
 * left to escape as an unhandled rejection.
 */
async function probe(path: string): Promise<SourceInfo> {
  let stats: Awaited<ReturnType<typeof stat>>
  try {
    stats = await stat(path)
  } catch (cause) {
    const code = (cause as NodeJS.ErrnoException).code
    if (code === 'ENOENT') throw fileNotFound(path)
    if (code === 'EACCES' || code === 'EPERM') throw permissionDenied(path)
    if (code === 'ENOTDIR') throw notADirectory(path)
    if (code === 'ELOOP') throw symlinkLoop(path)
    if (code === 'ENAMETOOLONG') throw pathTooLong(path)
    throw unreadablePath(path, cause)
  }

  if (!stats.isFile()) throw notAFile(path)

  // Sharp gives an unreadable file the same message as a corrupt one and never
  // sets error.code, so readability has to be established before it is involved.
  try {
    await access(path, constants.R_OK)
  } catch {
    throw permissionDenied(path)
  }

  /**
   * HEIC is identified from its own container bytes and measured with `sips`,
   * never through Sharp.
   *
   * Sharp cannot read a real photo's metadata at all: an iPhone HEIC is a
   * tiled grid whose tiles are cross-referenced through the ISO-BMFF `iref`
   * box, and libheif rejects more than 16 references as a security limit —
   * a 12MP photo has 48. Routing HEIC through Sharp therefore reported
   * "Damaged image" for precisely the files people convert, while small
   * single-tile fixtures passed. See engines/heic.ts.
   */
  if (await looksLikeHeic(path)) {
    if (!(await heicDecodable())) throw heicDecoderUnavailable(path)
    let info: Awaited<ReturnType<typeof heicInfo>>
    try {
      info = await heicInfo(path)
    } catch (cause) {
      throw corruptSource(path, cause)
    }
    if (info.width === 0 || info.height === 0) throw corruptSource(path, undefined)
    return {
      path,
      format: 'heic',
      width: info.width,
      height: info.height,
      bytes: stats.size,
      hasAlpha: info.hasAlpha,
      // A HEIC image sequence exists but Forge treats one photo as one frame;
      // the decode step hands Sharp a single still either way.
      frames: 1,
    }
  }

  let meta: Metadata
  try {
    meta = await sharp(path).metadata()
  } catch (cause) {
    throw corruptSource(path, cause)
  }

  return {
    path,
    format: identify(path, meta),
    width: meta.width ?? 0,
    height: meta.height ?? 0,
    bytes: stats.size,
    hasAlpha: meta.hasAlpha ?? false,
    frames: meta.pages ?? 1,
  }
}

const DEFAULT_QUALITY: Partial<Record<FormatId, number>> = {
  jpeg: 82,
  webp: 80,
  avif: 50,
}

function encode(pipeline: Sharp, target: FormatId, quality?: number): Sharp {
  const q = quality ?? DEFAULT_QUALITY[target]
  switch (target) {
    case 'jpeg':
      return pipeline.jpeg({ quality: q, mozjpeg: true })
    case 'webp':
      return pipeline.webp({ quality: q })
    case 'avif':
      return pipeline.avif({ quality: q })
    case 'png':
      // sharp's `effort` option on PNG is not a CPU dial — it turns on
      // `palette: true`, which quantises to <=256 colours. `formats.ts`
      // declares PNG lossless, so encoding must actually be lossless.
      return pipeline.png({ compressionLevel: 9 })
    case 'gif':
      return pipeline.gif()
    case 'tiff':
      // The default `compression` is 'jpeg', which is lossy. `formats.ts`
      // declares TIFF lossless (hint: 'archival'), so the encoder must match.
      return pipeline.tiff({ compression: 'deflate' })
    case 'heic':
      throw new Error('heic is not writable; the capability graph should have prevented this')
  }
}

/**
 * Writes via a sibling temp file and renames. A crash mid-encode can then never
 * leave a truncated file where a good one used to be, and overwriting in place
 * is safe because the original is only replaced once the new file is complete.
 */
async function writeAtomic(pipeline: Sharp, output: string): Promise<number> {
  const dir = dirname(output)
  try {
    await mkdir(dir, { recursive: true })
  } catch (cause) {
    throw outputInvalid(output, cause)
  }

  const temp = join(dir, `.forge-tmp-${randomBytes(6).toString('hex')}-${basename(output)}`)
  try {
    const info = await pipeline.toFile(temp)
    await rename(temp, output)
    return info.size
  } catch (cause) {
    // `force` only swallows ENOENT. A cleanup failure (EACCES, EBUSY, ...)
    // must never replace the real encode error that is about to be thrown.
    await rm(temp, { force: true }).catch(() => {})
    throw cause
  }
}

async function convert(job: Job, onPhase: (phase: Phase) => void): Promise<Result> {
  const spec = FORMATS[job.target]
  const warnings: Warning[] = []

  onPhase('reading')
  const isAnimated = job.source.frames > 1
  const keepFrames = isAnimated && spec.animatable

  // Rule 4: never drop frames silently.
  if (isAnimated && !spec.animatable) {
    warnings.push({
      code: 'animation-flattened',
      message:
        `${basename(job.source.path)} has ${job.source.frames} frames, ` +
        `and ${spec.label} cannot animate. Only the first frame was converted.`,
    })
  }

  onPhase('decoding')

  /**
   * HEIC cannot be decoded by the bundled libvips (see engines/heic.ts), so
   * it is transcoded to a temporary PNG by `sips` first and the ordinary
   * pipeline runs on that. Everything downstream is unchanged; only the file
   * Sharp opens differs.
   */
  if (job.source.format === 'heic' && !(await heicDecodable())) {
    throw heicDecoderUnavailable(job.source.path)
  }
  const heic = job.source.format === 'heic' ? await decodeHeic(job.source.path) : undefined
  const input = heic?.path ?? job.source.path

  try {
    let pipeline = sharp(input, keepFrames ? { animated: true } : {})

    // Rule 1: EXIF orientation, before anything else. Verified safe on
    // animated input — page count survives.
    //
    // Applies to a decoded HEIC too. Measured, because the opposite seemed
    // more likely: an oriented JPEG stored 40x80/orientation-6 becomes an
    // 80x40 HEIC with the rotation baked in, and `sips` then decodes that
    // back to a 40x80 PNG *carrying orientation 6* in an eXIf chunk. So the
    // intermediate needs rotating exactly like any other source, and
    // skipping it here shipped every HEIC photo on its side.
    pipeline = pipeline.rotate()

    // Rule 2: composite onto a background when the target has no alpha channel.
    if (job.source.hasAlpha && !spec.hasAlpha) {
      pipeline = pipeline.flatten({ background: job.options.background })
    }

    // Rule 3: strip EXIF/GPS by default, always keep the colour profile so
    // colours do not shift on wide-gamut displays.
    pipeline = job.options.keepMetadata ? pipeline.keepMetadata() : pipeline.keepIccProfile()

    onPhase('encoding')
    pipeline = encode(pipeline, job.target, job.options.quality)

    onPhase('writing')
    const outputBytes = await writeAtomic(pipeline, job.output)
    return { job, outputBytes, warnings }
  } catch (cause) {
    // `writeAtomic` already names what it knows — an undirectory-able
    // destination becomes `outputInvalid` ("Cannot write there / Check that
    // the path is valid and that you have permission"). Wrapping that in the
    // generic `conversionFailed` threw away the better message and replaced
    // its hint with "run again with --debug", which the interactive shell has
    // no equivalent for. Only an unnamed failure gets the generic wrapper;
    // `run.ts` makes the same distinction the same way.
    throw isForgeError(cause) ? cause : conversionFailed(job.source.path, cause)
  } finally {
    // Runs on every path, including the throw above: a temp decode left on
    // disk after a failed conversion is exactly the litter invariant 6 exists
    // to prevent.
    await heic?.cleanup()
  }
}

export const imageEngine: Engine = {
  id: 'image',
  reads: READS,
  writes: WRITES,
  probe,
  convert,
}
