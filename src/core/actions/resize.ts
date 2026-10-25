import { cropSuffix, largestBox } from '../crop.js'
import { type DebandLevelId, debandSuffix, isDebandLevel } from '../deband.js'
import { canDither, ditherSuffix, ditherTarget, isDitherColours } from '../dither.js'
import { FORMATS } from '../formats.js'
import { placeOutput, suffixedImagePath } from '../output-path.js'
import { keptFormat, resizedSize, sizeSuffix, specSuffix } from '../resize.js'
import { isTurn, turnSuffix } from '../turn.js'
import type {
  ConvertOptions,
  CropSpec,
  FormatId,
  ImageInfo,
  Job,
  ResizeSpec,
  SourceInfo,
  Turn,
} from '../types.js'
import { answer } from './destination.js'
import type { Action, OptionSpec } from './index.js'

/**
 * Trim edges, Resize (spec 2026-10-12) and Crop to shape (spec 2026-10-13):
 * options on the ordinary convert job, planned together because they share a
 * name, a format rule and a destination. The engine does the work
 * (`pipelineFor`); this only decides what is asked of it and where the result
 * goes.
 */

export interface EditRequest {
  trim: boolean
  resize?: ResizeSpec
  /** Never with `trim`: two cuts whose order would surprise. */
  crop?: CropSpec
  /** A quarter turn or a half, after the rest. */
  rotate?: Turn
  /** Remove banding: how hard. Its own, never with the rest. */
  deband?: DebandLevelId
  /** Dither: the colours to cut it to. Its own, never with the rest. */
  dither?: number
  /** Absent means the source's own format (`keptFormat`). */
  target?: FormatId
  output?: string
  roots?: Map<string, string>
  /** The shell's Save as answers, read through `answer()` like rotate does. */
  destination?: unknown
  name?: unknown
  background: string
  keepMetadata: boolean
  quality?: number
}

/**
 * What the name says. With a trim and a resize the trimmed size is unknown at
 * plan time, so the name carries the spec instead of a size.
 */
function suffixFor(source: ImageInfo, req: EditRequest): string {
  if (req.dither) return ditherSuffix(req.dither)
  if (req.deband) return debandSuffix(req.deband)
  if (!req.rotate) return sizeAndCutSuffix(source, req)
  const turned = turnSuffix(req.rotate)
  return req.trim || req.crop || req.resize ? `${sizeAndCutSuffix(source, req)}-${turned}` : turned
}

function sizeAndCutSuffix(source: ImageInfo, req: EditRequest): string {
  if (req.crop) {
    const shape = cropSuffix(req.crop.aspect)
    if (!req.resize) return shape
    // Known at plan time: the box given, else the largest, which is what the
    // engine cuts when it places the box itself.
    const cut = req.crop.box ?? largestBox(source, req.crop.aspect)
    return `${shape}-${sizeSuffix(resizedSize(cut, req.resize))}`
  }
  if (req.trim && req.resize) return `trimmed-${specSuffix(req.resize)}`
  if (req.resize) return sizeSuffix(resizedSize(source, req.resize))
  return 'trimmed'
}

/** One convert job per image. */
export function planEdit(images: ImageInfo[], req: EditRequest): Job[] {
  if (req.trim && req.crop) throw new Error('planEdit cannot trim and crop the same image')
  return images.map((source) => {
    const target = req.target ?? (req.dither ? ditherTarget(source) : keptFormat(source))
    const options: ConvertOptions = {
      background: req.background,
      keepMetadata: req.keepMetadata,
      ...(req.quality === undefined ? {} : { quality: req.quality }),
      ...(req.trim ? { trim: true } : {}),
      ...(req.resize ? { resize: req.resize } : {}),
      ...(req.crop ? { crop: req.crop } : {}),
      ...(req.rotate ? { rotate: req.rotate } : {}),
      ...(req.dither ? { dither: req.dither } : {}),
      ...(req.deband ? { deband: req.deband } : {}),
      // A smoothed gradient re-encoded at a lossy format's everyday quality
      // gets its stripes back from the encoder; at 95 it keeps them away.
      ...(req.deband && req.quality === undefined && FORMATS[target].lossy ? { quality: 95 } : {}),
    }
    const root = req.roots?.get(source.path)
    const named = suffixedImagePath({
      sourcePath: source.path,
      target,
      suffix: suffixFor(source, req),
      ...(req.output === undefined ? {} : { output: req.output }),
      ...(root === undefined ? {} : { sourceRoot: root }),
    })
    return {
      op: 'convert' as const,
      sources: [source],
      outputs: [placeOutput(named, answer(req.destination), answer(req.name))],
      target,
      options,
    }
  })
}

const imagesOnly = (sources: SourceInfo[]): ImageInfo[] | undefined =>
  sources.length > 0 && sources.every((s) => s.kind === 'image')
    ? (sources as ImageInfo[])
    : undefined

const isSpec = (v: unknown): v is ResizeSpec =>
  typeof v === 'object' && v !== null && ('percent' in v || 'width' in v || 'height' in v)

const isCrop = (v: unknown): v is CropSpec =>
  typeof v === 'object' &&
  v !== null &&
  'aspect' in v &&
  typeof v.aspect === 'object' &&
  v.aspect !== null &&
  'w' in v.aspect &&
  'h' in v.aspect

function actionFor(
  id: 'trim' | 'resize' | 'crop' | 'turn' | 'dither' | 'deband',
  label: string,
  verb: string,
  hint: string,
): Action {
  return {
    id,
    label,
    verb,
    hint,
    // An animation cannot be trimmed or cropped (the engine refuses one), only resized.
    appliesTo: (sources) =>
      imagesOnly(sources)?.every((s) =>
        id === 'resize' ? true : id === 'dither' ? canDither(s) : s.frames <= 1,
      ) === true,
    unavailable: (sources) => (imagesOnly(sources) ? 'animated' : 'images only'),
    // The shell asks its own questions (the slider, the exact-size pair).
    options: (): OptionSpec[] => [],
    plan(sources, values): Job[] {
      const images = imagesOnly(sources)
      if (!images) return []
      // A crop is nothing without its shape; the shell and the CLI always give one.
      if (id === 'crop' && !isCrop(values.crop)) return []
      // …and a rotation is nothing without its turn.
      if (id === 'turn' && !isTurn(values.turn)) return []
      // …and a deband is nothing without its level, nor possible on an animation.
      if (id === 'deband' && (!isDebandLevel(values.deband) || images.some((s) => s.frames > 1)))
        return []
      // …and a dither is nothing without its colours, nor possible on an animation but a GIF.
      if (id === 'dither' && (!isDitherColours(values.dither) || !images.every(canDither)))
        return []
      return planEdit(images, {
        trim: id === 'trim' || values.trim === true,
        ...(isTurn(values.turn) ? { rotate: values.turn } : {}),
        ...(id === 'dither' && isDitherColours(values.dither) ? { dither: values.dither } : {}),
        ...(id === 'deband' && isDebandLevel(values.deband) ? { deband: values.deband } : {}),
        ...(isSpec(values.resize) ? { resize: values.resize } : {}),
        ...(isCrop(values.crop) ? { crop: values.crop } : {}),
        ...(typeof values.target === 'string' ? { target: values.target as FormatId } : {}),
        ...(typeof values.output === 'string' ? { output: values.output } : {}),
        ...(values.roots instanceof Map ? { roots: values.roots as Map<string, string> } : {}),
        destination: values.destination,
        name: values.name,
        background: typeof values.background === 'string' ? values.background : '#ffffff',
        keepMetadata: values.keepMetadata === true,
        ...(typeof values.quality === 'number' ? { quality: values.quality } : {}),
      })
    },
  }
}

export const trimAction: Action = actionFor(
  'trim',
  'Trim edges',
  'Trimming edges',
  'cut empty borders',
)
export const resizeAction: Action = actionFor('resize', 'Resize', 'Resizing', 'smaller or larger')
export const cropAction: Action = actionFor('crop', 'Crop to shape', 'Cropping', 'change the shape')
export const turnAction: Action = actionFor('turn', 'Rotate', 'Rotating', 'turn it')
export const ditherAction: Action = actionFor(
  'dither',
  'Dither',
  'Dithering',
  'fewer colours, scattered',
)
export const debandAction: Action = actionFor(
  'deband',
  'Remove banding',
  'Removing banding',
  'smooth out stripes',
)
