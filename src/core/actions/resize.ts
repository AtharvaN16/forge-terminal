import { placeOutput, suffixedImagePath } from '../output-path.js'
import { keptFormat, resizedSize, sizeSuffix, specSuffix } from '../resize.js'
import type { ConvertOptions, FormatId, ImageInfo, Job, ResizeSpec, SourceInfo } from '../types.js'
import { answer } from './destination.js'
import type { Action, OptionSpec } from './index.js'

/**
 * Trim edges and Resize (spec 2026-10-12): two options on the ordinary
 * convert job, planned together because they share a name, a format rule and
 * a destination. The engine does the work (`pipelineFor`); this only decides
 * what is asked of it and where the result goes.
 */

export interface EditRequest {
  trim: boolean
  resize?: ResizeSpec
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
  if (req.trim && req.resize) return `trimmed-${specSuffix(req.resize)}`
  if (req.resize) return sizeSuffix(resizedSize(source, req.resize))
  return 'trimmed'
}

/** One convert job per image. */
export function planEdit(images: ImageInfo[], req: EditRequest): Job[] {
  return images.map((source) => {
    const target = req.target ?? keptFormat(source)
    const options: ConvertOptions = {
      background: req.background,
      keepMetadata: req.keepMetadata,
      ...(req.quality === undefined ? {} : { quality: req.quality }),
      ...(req.trim ? { trim: true } : {}),
      ...(req.resize ? { resize: req.resize } : {}),
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

function actionFor(id: 'trim' | 'resize', label: string, verb: string, hint: string): Action {
  return {
    id,
    label,
    verb,
    hint,
    // An animation cannot be trimmed (the engine refuses one), only resized.
    appliesTo: (sources) =>
      imagesOnly(sources)?.every((s) => id === 'resize' || s.frames <= 1) === true,
    unavailable: (sources) => (imagesOnly(sources) ? 'animated' : 'images only'),
    // The shell asks its own questions (the slider, the exact-size pair).
    options: (): OptionSpec[] => [],
    plan(sources, values): Job[] {
      const images = imagesOnly(sources)
      if (!images) return []
      return planEdit(images, {
        trim: id === 'trim' || values.trim === true,
        ...(isSpec(values.resize) ? { resize: values.resize } : {}),
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
