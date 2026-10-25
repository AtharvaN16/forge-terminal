import { constants } from 'node:fs'
import { access, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { Metadata, Sharp } from 'sharp'
import { prepareOutputDir, renameAtomic, tempBeside } from '../core/atomic.js'
import { type Aspect, aspectLabel, type Box, largestBox, type Thumb } from '../core/crop.js'
import {
  animatedCrop,
  animatedRotate,
  animatedTrim,
  cannotCompressMore,
  classifyWriteError,
  conversionFailed,
  corruptFormatSource,
  corruptSource,
  fileNotFound,
  heicDecoderUnavailable,
  isForgeError,
  notADirectory,
  notAFile,
  nothingToCrop,
  nothingToTrim,
  pathTooLong,
  permissionDenied,
  rawCameraUnsupported,
  rawDecoderUnavailable,
  resizeTooLarge,
  symlinkLoop,
  unreadablePath,
  unsupportedSource,
} from '../core/errors.js'
import { FORMATS } from '../core/formats.js'
import { resizedSize, type Size, sizeOverLimit } from '../core/size.js'
import type {
  ConvertOptions,
  FormatId,
  ImageInfo,
  Job,
  Progress,
  Result,
  SourceInfo,
  Warning,
} from '../core/types.js'
import { displayName } from '../utils/display-path.js'
import { decodedInput } from './decoded.js'
import { heicDecodable, heicInfo, looksLikeHeic } from './heic.js'
import { loadSharp } from './libs.js'
import { rawDecodable, rawSize, sniffRaw } from './raw.js'
import type { Engine, Measurer } from './types.js'

const READS: ReadonlySet<FormatId> = new Set<FormatId>([
  'jpeg',
  'png',
  'webp',
  'avif',
  'heic',
  // Read everywhere, as HEIC is: sips decodes it on a Mac, the raw extension
  // elsewhere, and probing a RAW without either says how to get one
  // (engines/raw.ts, `rawDecodable`).
  'raw',
  'gif',
  'tiff',
])

/** heic and raw are absent deliberately: sharp encodes neither. */
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
   * Sharp's prebuilt libvips has no HEVC decoder, so it cannot decode a HEIC's
   * pixels at all. Before 0.35.5 it could not even read a real photo's
   * metadata: an iPhone HEIC is a tiled grid cross-referenced through the
   * ISO-BMFF `iref` box, and older libheif rejected more than 16 references
   * as a security limit — a 12MP photo has 48 — so routing HEIC through
   * Sharp reported "Damaged image" for precisely the files people convert.
   * See engines/heic.ts.
   */
  if (await looksLikeHeic(path)) {
    if (!(await heicDecodable())) throw heicDecoderUnavailable(path)
    let info: Awaited<ReturnType<typeof heicInfo>>
    try {
      info = await heicInfo(path)
    } catch (cause) {
      // looksLikeHeic already read the ftyp box, so the format is known here
      // — unlike the generic sharp.metadata() failure below, this message
      // can and should say HEIC rather than falling back to "unrecognised".
      throw corruptFormatSource(path, 'heic', cause)
    }
    if (info.width === 0 || info.height === 0) throw corruptFormatSource(path, 'heic', undefined)
    return {
      kind: 'image',
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

  /**
   * Camera RAW is identified from its own bytes too, before Sharp, which
   * would open most RAW files as a TIFF and report the preview inside them.
   * See engines/raw.ts.
   */
  const raw = await sniffRaw(path)
  if (raw) {
    if (!(await rawDecodable())) throw rawDecoderUnavailable(path)
    let size: Awaited<ReturnType<typeof rawSize>>
    try {
      size = await rawSize(path, raw)
    } catch (cause) {
      throw corruptFormatSource(path, 'raw', cause)
    }
    if (!size) throw rawCameraUnsupported(path)
    return {
      kind: 'image',
      path,
      format: 'raw',
      width: size.width,
      height: size.height,
      bytes: stats.size,
      hasAlpha: false,
      frames: 1,
    }
  }

  // Loaded here, after the HEIC and RAW branches, which are measured with
  // sips (or their extension, off a Mac) and never need Sharp to probe.
  const sharp = await loadSharp()
  let meta: Metadata
  try {
    meta = await sharp(path).metadata()
  } catch (cause) {
    throw corruptSource(path, cause)
  }

  return {
    kind: 'image',
    path,
    format: identify(path, meta),
    // The upright size, which is what every pipeline produces (`.rotate()`
    // first) and so the only size the card, Resize and the file names can
    // honestly say. `meta.width` is the stored size, sideways for a phone photo.
    width: meta.autoOrient?.width ?? meta.width ?? 0,
    height: meta.autoOrient?.height ?? meta.height ?? 0,
    bytes: stats.size,
    hasAlpha: meta.hasAlpha ?? false,
    frames: meta.pages ?? 1,
  }
}

/**
 * The single place a target format is dispatched to a Sharp encoder call.
 * Exported so `engines/pdfium.ts` can reuse it for the PDF-rasterisation
 * path rather than keeping a second, divergent dispatch — a hand-rolled
 * `target === 'png' ? ... : ...` there once silently dropped PNG's
 * `compressionLevel: 9` and would have silently emitted JPEG bytes for any
 * third format `WRITES` ever gained, which is exactly the hardcoded
 * output-format decision invariant 2 exists to prevent.
 */
export function encode(
  pipeline: Sharp,
  target: FormatId,
  quality?: number,
  /** `/compress`'s own settings: a quantisable target is cut to a palette. */
  compress?: ConvertOptions['compress'],
): Sharp {
  const q = quality ?? FORMATS[target].defaultQuality
  if (compress && FORMATS[target].quantisable) return quantise(pipeline, target, quality, compress)
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
    case 'raw':
      throw new Error('raw is not writable; the capability graph should have prevented this')
    case 'pdf':
      throw new Error('pdf is not an image target; the capability graph should have prevented this')
    case 'docx':
      throw new Error(
        'docx is not an image target; the capability graph should have prevented this',
      )
    case 'doc':
      throw new Error('doc is not an image target; the capability graph should have prevented this')
    default:
      throw new Error(
        `${target} is not an image target; the capability graph should have prevented this`,
      )
  }
}

/**
 * PNG and GIF made smaller by losing something, which only `/compress` asks
 * for: `/convert` keeps both lossless.
 *
 * A PNG becomes a palette of at most 256 colours (libimagequant), `quality`
 * deciding how far the colours may drift. A GIF is a palette already, so what
 * it can give is between frames: at a lower quality a pixel that barely
 * changed from the last frame is left as it was (`interFrameMaxError`, 0–32),
 * which is where an animation's bytes go. No frame is dropped: one that comes
 * out the same as the frame before is merged into it, its time added on, so
 * the animation plays exactly as long.
 *
 * Flat colours unless dithering is asked for: dither scatters dots that
 * compress worse, and on flat art it measured twice the bytes.
 */
function quantise(
  pipeline: Sharp,
  target: FormatId,
  quality: number | undefined,
  { dither }: { dither: boolean },
): Sharp {
  const q = quality ?? 100
  const amount = dither ? 1 : 0
  if (target === 'gif') {
    return pipeline.gif({ interFrameMaxError: Math.round((32 * (100 - q)) / 100), dither: amount })
  }
  return pipeline.png({
    palette: true,
    quality: q,
    dither: amount,
    compressionLevel: 9,
    effort: 10,
  })
}

/** Whether an encode to `target` keeps every frame of `source`: an animation into a format that can animate. */
const keepsFrames = (source: SourceInfo, target: FormatId): boolean =>
  source.kind === 'image' && source.frames > 1 && FORMATS[target].animatable

/**
 * Writes via a sibling temp file and renames. A crash mid-write can then never
 * leave a truncated file where a good one used to be, and overwriting in place
 * is safe because the original is only replaced once the new file is complete.
 */
export async function writeAtomic(bytes: Buffer, output: string): Promise<number> {
  const _dir = dirname(output)
  await prepareOutputDir(output)

  const temp = tempBeside(output)
  try {
    await writeFile(temp, bytes)
    await renameAtomic(temp, output)
    return bytes.length
  } catch (cause) {
    // `force` only swallows ENOENT. A cleanup failure (EACCES, EBUSY, ...)
    // must never replace the real write error that is about to be thrown.
    await rm(temp, { force: true }).catch(() => {})
    throw classifyWriteError(output, cause)
  }
}

/**
 * Builds the pipeline both callers encode from, up to but not including the
 * encode itself.
 *
 * Shared rather than duplicated so the correctness rules hold on both paths:
 * HEIC and RAW decoded through sips, `.rotate()` before anything else, alpha
 * flattened for a target that cannot carry it, EXIF stripped unless asked
 * for. A second copy of this would be a second place for those to drift.
 */
async function pipelineFor(
  source: SourceInfo,
  target: FormatId,
  options: ConvertOptions,
  animated: boolean,
  /**
   * The source already in memory, for the target-size search, which encodes
   * from the same bytes up to eight times. A HEIC or RAW arrives here
   * already decoded to PNG (see `readOnce`), so it skips the sips step.
   */
  input?: Buffer,
  /**
   * The size Resize writes, resolved once by the caller (`run`) from the
   * upright — and, with a trim or a crop, the cut — size. Passed in so this
   * never measures; a resize without one is only derivable when nothing is cut.
   */
  outputSize?: Size,
): Promise<{ pipeline: Sharp }> {
  // The image engine only ever builds a pipeline for an image — the registry
  // routes jobs to an engine by `reads`/`writes`, so a document source
  // reaching here would be a caller bug, not a condition a user can trigger.
  if (source.kind !== 'image') {
    throw new Error('pipelineFor received a non-image source')
  }

  /**
   * HEIC and RAW cannot be decoded by the bundled libvips (engines/heic.ts,
   * engines/raw.ts), so they are transcoded to PNG by `sips` first and the
   * ordinary pipeline runs on that (engines/decoded.ts, which keeps the last
   * few). Everything downstream is unchanged; only what Sharp opens differs.
   */
  const opened = input ?? (await decodedInput(source.path, source.format))

  const sharp = await loadSharp()
  let pipeline = sharp(opened, animated ? { animated: true } : {})

  // Rule 1: EXIF orientation, before anything else. Verified safe on
  // animated input — page count survives.
  //
  // Applies to a decoded HEIC or RAW too. Measured, because the opposite seemed
  // more likely: an oriented JPEG stored 40x80/orientation-6 becomes an
  // 80x40 HEIC with the rotation baked in, and `sips` then decodes that
  // back to a 40x80 PNG *carrying orientation 6* in an eXIf chunk. So the
  // intermediate needs rotating exactly like any other source, and
  // skipping it here shipped every HEIC photo on its side.
  pipeline = pipeline.rotate()

  // Trim or crop, then resize (specs 2026-10-12, 2026-10-13), on the upright
  // image: a crop's box is in upright pixels. Both sides are given to Sharp
  // with `fill`, so its own rounding never disagrees with the size the file
  // name and the card state.
  if (options.trim) pipeline = pipeline.trim()
  if (options.crop) {
    if (!options.crop.box) throw new Error('pipelineFor needs the crop placed (run does it)')
    pipeline = pipeline.extract(options.crop.box)
  }
  if (options.resize) {
    if (!outputSize && (options.trim || options.crop)) {
      throw new Error('pipelineFor needs the resolved size to resize a cut image')
    }
    const size = outputSize ?? resizedSize(source, options.resize)
    pipeline = pipeline.resize(size.width, size.height, { fit: 'fill' })
  }
  // Rotate, last: the crop's box and the resize are of the upright picture.
  // Sharp keeps the EXIF orientation applied above when an angle follows it.
  if (options.rotate) pipeline = pipeline.rotate(options.rotate)

  // Rule 2: composite onto a background when the target has no alpha channel.
  if (source.hasAlpha && !FORMATS[target].hasAlpha) {
    pipeline = pipeline.flatten({ background: options.background })
  }

  // Rule 3: strip EXIF/GPS by default, always keep the colour profile so
  // colours do not shift on wide-gamut displays.
  pipeline = options.keepMetadata ? pipeline.keepMetadata() : pipeline.keepIccProfile()

  return { pipeline }
}

/**
 * Decodes any readable image to an upright PNG at `dest`, for an extension to
 * read. Goes through `pipelineFor`, so EXIF rotation (rule 1) and the HEIC
 * path are the ones every conversion uses; the first frame only.
 */
export async function decodeToPng(source: SourceInfo, dest: string): Promise<void> {
  const options: ConvertOptions = { background: '#ffffff', keepMetadata: false }
  const { pipeline } = await pipelineFor(source, 'png', options, false)
  await pipeline.png({ compressionLevel: 1 }).toFile(dest)
}

/**
 * Encodes without touching the disk.
 *
 * The target-size search calls this once per attempt and only ever needs the
 * byte count, so writing a temp file each time would be wasted I/O — and one
 * left behind by a failed attempt would be litter.
 */
export async function encodeToBuffer(
  source: SourceInfo,
  target: FormatId,
  options: ConvertOptions,
): Promise<Buffer> {
  // Every frame, as the conversion keeps them: a size measured from the
  // first frame of an animation is a size nobody will get.
  const { pipeline } = await pipelineFor(source, target, options, keepsFrames(source, target))
  return await encode(pipeline, target, options.quality, options.compress).toBuffer()
}

export interface ImageMeasure {
  /** The size after EXIF rotation. */
  upright: Size
  /** What a trim would leave; `'nothing'` when there are no empty edges. */
  trimmed: Size | 'nothing' | 'animated'
}

/**
 * What Trim and Resize need to know about an image: its upright size, and
 * what a trim would leave of it. The trim is really run, on the upright
 * pixels, because "empty" is a question about pixels the probe never reads.
 * An animation is not measured; Trim does not apply to one.
 */
export async function measureImage(source: ImageInfo): Promise<ImageMeasure> {
  const upright = { width: source.width, height: source.height }
  if (source.frames > 1) return { upright, trimmed: 'animated' }

  const opened = await decodedInput(source.path, source.format)
  try {
    const sharp = await loadSharp()
    // Encoded at quality 1 only because Sharp reports the trimmed size with the
    // encoded buffer; the bytes are thrown away.
    const { info } = await sharp(opened)
      .rotate()
      .trim()
      .jpeg({ quality: 1 })
      .toBuffer({ resolveWithObject: true })
    return info.width === upright.width && info.height === upright.height
      ? { upright, trimmed: 'nothing' }
      : { upright, trimmed: { width: info.width, height: info.height } }
  } catch (cause) {
    throw isForgeError(cause) ? cause : conversionFailed(source.path, cause)
  }
}

/** What the crop preview reads, once per source: the upright size, and a thumbnail. */
export interface CropView {
  size: Size
  thumb: Thumb
}

/** The thumbnail's long side: enough for the preview's dots and for attention. */
const CROP_VIEW_SIDE = 1024

/**
 * The upright image decoded once to at most 1024 px on its long side (never
 * enlarged), as raw RGB, and its alpha when any of it is see-through: the
 * colours under transparency are hidden (often black, or a removed
 * background's), so the preview draws them on a checkerboard and attention
 * never sees them. Through `pipelineFor`, so the HEIC path and EXIF rotation
 * are the ones every conversion uses.
 */
export async function loadCropView(source: ImageInfo): Promise<CropView> {
  const options: ConvertOptions = { background: '#ffffff', keepMetadata: false }
  const { pipeline } = await pipelineFor(source, 'png', options, false)
  try {
    const { data, info } = await pipeline
      .resize(CROP_VIEW_SIDE, CROP_VIEW_SIDE, { fit: 'inside', withoutEnlargement: true })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true })
    const n = info.width * info.height
    const c = info.channels
    const rgb = new Uint8Array(n * 3)
    const alpha = new Uint8Array(n)
    let clear = false
    for (let i = 0; i < n; i++) {
      // Grey and alpha (two channels) spreads its grey to all three.
      for (let k = 0; k < 3; k++) rgb[i * 3 + k] = data[i * c + (c >= 4 ? k : 0)] ?? 0
      alpha[i] = data[i * c + c - 1] ?? 255
      if (alpha[i] !== 255) clear = true
    }
    return {
      size: { width: source.width, height: source.height },
      thumb: { width: info.width, height: info.height, rgb, ...(clear ? { alpha } : {}) },
    }
  } catch (cause) {
    throw isForgeError(cause) ? cause : conversionFailed(source.path, cause)
  }
}

/** What transparency is laid on for attention: flat and colourless, so it holds nothing to find. */
const ATTENTION_UNDER = 128

/**
 * Where the largest box of `aspect` goes: Sharp's attention strategy on the
 * thumbnail, its offset scaled back to full size. Attention is a guess (it can
 * prefer a bright sky to a person), which is why the shell shows a preview.
 * A transparent thumbnail is flattened onto mid grey first: attention reads
 * RGB only, and the colours under transparency (a removed background's) would
 * otherwise pull the box towards what is no longer there.
 */
export async function guessCrop(view: CropView, aspect: Aspect): Promise<Box> {
  const { thumb, size } = view
  const small = largestBox(thumb, aspect)
  const sharp = await loadSharp()
  const { info } = await sharp(seenOnGrey(thumb), {
    raw: { width: thumb.width, height: thumb.height, channels: 3 },
  })
    .resize(small.width, small.height, { fit: 'cover', position: sharp.strategy.attention })
    .raw()
    .toBuffer({ resolveWithObject: true })
  const box = largestBox(size, aspect)
  // Sharp reports where it cut as a negative offset (or 0).
  const left = Math.round((-(info.cropOffsetLeft ?? 0) * size.width) / thumb.width)
  const top = Math.round((-(info.cropOffsetTop ?? 0) * size.height) / thumb.height)
  return {
    ...box,
    left: Math.min(Math.max(left, 0), size.width - box.width),
    top: Math.min(Math.max(top, 0), size.height - box.height),
  }
}

/** The thumbnail's RGB with any transparency laid on `ATTENTION_UNDER` grey. */
function seenOnGrey(thumb: Thumb): Uint8Array {
  const { alpha } = thumb
  if (!alpha) return thumb.rgb
  const out = new Uint8Array(thumb.rgb.length)
  for (let i = 0; i < out.length; i++) {
    const a = (alpha[Math.floor(i / 3)] ?? 255) / 255
    out[i] = Math.round(ATTENTION_UNDER + ((thumb.rgb[i] ?? 0) - ATTENTION_UNDER) * a)
  }
  return out
}

async function run(job: Job, onPhase: (progress: Progress) => void): Promise<Result> {
  if (job.op !== 'convert') {
    throw new Error(`image engine cannot ${job.op}`)
  }
  const source = job.sources[0]
  const output = job.outputs[0]

  // Same reasoning as pipelineFor: the registry only ever routes an image
  // source to this engine.
  if (source.kind !== 'image') {
    throw new Error('the image engine cannot convert a document source')
  }

  const spec = FORMATS[job.target]
  const warnings: Warning[] = []

  onPhase({ phase: 'reading' })
  const isAnimated = source.frames > 1
  const keepFrames = keepsFrames(source, job.target)

  // Rule 4: never drop frames silently.
  if (isAnimated && !spec.animatable) {
    warnings.push({
      code: 'animation-flattened',
      message:
        `${displayName(source.path)} has ${source.frames} frames, ` +
        `and ${spec.label} cannot animate. Only the first frame was converted.`,
    })
  }

  // Trim, crop and resize are decided here, once, before anything is
  // written: the refusals, the "nothing trimmed/cropped" warnings, where the
  // crop goes, and the size the pipeline gets.
  let options = job.options
  let outputSize: Size | undefined
  if (options.rotate && isAnimated) throw animatedRotate(source.path)
  if (options.trim || options.crop || options.resize) {
    let base: Size = { width: source.width, height: source.height }
    if (options.trim && options.crop) throw new Error('a job cannot both trim and crop')
    if (options.crop) {
      if (isAnimated) throw animatedCrop(source.path)
      const { aspect } = options.crop
      const whole = (b: Box) => b.width === source.width && b.height === source.height
      const largest = largestBox(base, aspect)
      // Placing is only worth a decode when there is somewhere to place it.
      const box =
        options.crop.box ??
        (whole(largest) ? largest : await guessCrop(await loadCropView(source), aspect))
      if (whole(box)) {
        if (!options.resize) throw nothingToCrop(source.path, aspectLabel(aspect))
        warnings.push({
          code: 'nothing-cropped',
          message: `${displayName(source.path)} is already ${aspectLabel(aspect)}; resized only.`,
        })
        const { crop: _, ...rest } = options
        options = rest
      } else {
        options = { ...options, crop: { aspect, box } }
        base = { width: box.width, height: box.height }
      }
    }
    if (options.trim) {
      if (isAnimated) throw animatedTrim(source.path)
      const { trimmed } = await measureImage(source)
      if (trimmed === 'nothing') {
        if (!options.resize) throw nothingToTrim(source.path)
        warnings.push({
          code: 'nothing-trimmed',
          message: `${displayName(source.path)} has no empty edges; resized only.`,
        })
      } else if (trimmed !== 'animated') {
        base = trimmed
      }
    }
    if (options.resize) {
      outputSize = resizedSize(base, options.resize)
      if (sizeOverLimit(outputSize)) throw resizeTooLarge(source.path, outputSize)
    }
  }

  onPhase({ phase: 'decoding' })
  const { pipeline } = await pipelineFor(
    source,
    job.target,
    options,
    keepFrames,
    undefined,
    outputSize,
  )

  try {
    // A folder that cannot be written is found before a long encode, not after.
    await prepareOutputDir(output)
    // Encoded in memory, then written: Sharp encodes as it streams into a
    // file, so writing straight from the pipeline would report "writing"
    // for the whole of an encode that has not happened yet. The phases the
    // shell shows (W5) are the true ones only if each is its own step.
    onPhase({ phase: 'encoding' })
    const encoded = await encode(pipeline, job.target, options.quality, options.compress).toBuffer()

    // `/compress` promises smaller. Refused before the write, so a bigger
    // file never lands, not even for a moment.
    if (options.compress && encoded.length >= source.bytes) {
      throw cannotCompressMore(source.path, source.bytes, encoded.length)
    }

    onPhase({ phase: 'writing' })
    const outputBytes = await writeAtomic(encoded, output)
    return { job, outputBytes, warnings }
  } catch (cause) {
    // `writeAtomic` already names what it knows — an undirectory-able
    // destination becomes `outputInvalid` ("Cannot write there / Check that
    // the path is valid and that you have permission"). Wrapping that in the
    // generic `conversionFailed` threw away the better message and replaced
    // its hint with "run again with --debug", which the interactive shell has
    // no equivalent for. Only an unnamed failure gets the generic wrapper;
    // `run.ts` makes the same distinction the same way.
    throw isForgeError(cause) ? cause : conversionFailed(source.path, cause)
  }
}

/**
 * The source's bytes, read once for a search that encodes from them
 * repeatedly. A HEIC or RAW is decoded through sips here, once, and handed on
 * as the decoded PNG. Per attempt that decode was the most expensive step.
 *
 * Bytes rather than decoded pixels on purpose: encoding from a buffer runs
 * the same libvips decode as encoding from the file, so every measured size
 * is byte-identical to the real encode, and the quality the search settles on
 * cannot move (spec §3).
 */
async function readOnce(source: ImageInfo): Promise<Buffer> {
  const opened = await decodedInput(source.path, source.format)
  return typeof opened === 'string' ? await readFile(opened) : opened
}

/**
 * One rung: an image has a single lever, quality.
 *
 * The resolution ladder lives in the PDF engine, which is the only module that
 * knows why 150 → 120 → 96 → 72 and not some other sequence.
 */
async function measurer(job: Job): Promise<Measurer | undefined> {
  if (job.op !== 'convert') return undefined
  // A lossless target has no quality to search: `encode` ignores quality for
  // PNG, GIF and TIFF, so every attempt would measure the same bytes.
  // Declining makes `runPlan` refuse with a reason instead of "searching" a
  // dial that is not connected to anything. `/compress` connects one to PNG
  // and GIF.
  const spec = FORMATS[job.target]
  if (!spec.lossy && !(spec.quantisable && job.options.compress)) return undefined
  const source = job.sources[0]
  if (source.kind !== 'image') return undefined

  const input = await readOnce(source)
  return {
    ladder: [{}],
    measure: async (options) => {
      const { pipeline } = await pipelineFor(
        source,
        job.target,
        options,
        keepsFrames(source, job.target),
        input,
      )
      return (await encode(pipeline, job.target, options.quality, options.compress).toBuffer())
        .length
    },
  }
}

export const imageEngine: Engine = {
  id: 'image',
  reads: READS,
  writes: WRITES,
  ops: new Set<Job['op']>(['convert']),
  probe,
  run,
  measurer,
}
