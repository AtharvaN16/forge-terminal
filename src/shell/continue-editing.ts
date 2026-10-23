import { shapesFor } from '../core/crop.js'
import { FORMATS } from '../core/formats.js'
import type { PresetSteps } from '../core/preset.js'
import type { Aspect, FormatId, ResizeSpec } from '../core/types.js'

/**
 * Continue editing, decided (mockups/presets-ux-2026-10-round10.html): Done
 * is the hub. Continue editing does one more thing to the file and brings
 * you back to Done; Done's strip says the chain of steps; Save as preset
 * saves that chain. Every step is redone from the original, so the steps are
 * a set of answers (`PresetSteps`), not a stack of files.
 *
 * Pure: the list's operations, what each does to the steps, and how the
 * chain and Undo say a step.
 */
export type Op = 'compress' | 'resize' | 'crop' | 'trim' | 'format' | 'sharpen' | 'boost' | 'cutout'

/** The list's operations, in the decided order and words. */
export const OPS: ReadonlyArray<{ op: Op; label: string }> = [
  { op: 'compress', label: 'Compress' },
  { op: 'resize', label: 'Resize' },
  { op: 'crop', label: 'Crop to shape' },
  { op: 'trim', label: 'Trim edges' },
  { op: 'format', label: 'Convert to another format' },
  { op: 'sharpen', label: 'Sharpen' },
  { op: 'boost', label: 'Boost resolution' },
  { op: 'cutout', label: 'Remove background' },
]

/** One step, with its answer. */
export type Step =
  | { op: 'compress'; quality: number }
  | { op: 'compress'; bytes: number }
  | { op: 'resize'; spec: ResizeSpec }
  | { op: 'crop'; aspect: Aspect }
  | { op: 'trim' }
  | { op: 'format'; to: FormatId; quality?: number | undefined }
  | { op: 'sharpen' }
  | { op: 'boost'; scale: 2 | 3 | 4 }
  | { op: 'cutout' }

const formatLabel = (f: FormatId) => FORMATS[f]?.label ?? f.toUpperCase()
const sizeLabel = (bytes: number) => `under ${Math.round(bytes / 1000)} KB`
const resizeLabel = (spec: ResizeSpec) =>
  'width' in spec
    ? `${spec.width} wide`
    : 'height' in spec
      ? `${spec.height} high`
      : `${spec.percent}%`

/** The steps with one more thing done to them. */
export function withStep(steps: PresetSteps, step: Step): PresetSteps {
  const next: PresetSteps = { ...steps }
  switch (step.op) {
    case 'compress':
      if ('quality' in step) {
        // By quality: that quality, smaller or nothing, as /compress does.
        delete next.maxBytes
        next.quality = step.quality
        next.compress = steps.compress ?? { dither: false }
      } else {
        // To a size: the quality there stays as the most the search may use.
        next.maxBytes = step.bytes
      }
      return next
    case 'resize':
      next.resize = step.spec
      return next
    case 'crop':
      next.crop = step.aspect
      return next
    case 'trim':
      next.trim = true
      return next
    case 'format':
      next.to = step.to
      if (step.quality === undefined) delete next.quality
      else next.quality = step.quality
      return next
    case 'sharpen':
      next.sharpen = true
      return next
    case 'boost':
      next.boost = step.scale
      return next
    case 'cutout':
      next.removeBackground = true
      return next
  }
}

/** What Undo calls a step: the way the chain says it. */
export function stepLabel(step: Step): string {
  switch (step.op) {
    case 'compress':
      return 'quality' in step ? `quality ${step.quality}` : sizeLabel(step.bytes)
    case 'resize':
      return resizeLabel(step.spec)
    case 'crop':
      return `${step.aspect.w}:${step.aspect.h}`
    case 'trim':
      return 'Trim'
    case 'format':
      return `${formatLabel(step.to)}${step.quality === undefined ? '' : ` ${step.quality}`}`
    case 'sharpen':
      return 'Sharpen'
    case 'boost':
      return `Boost ${step.scale}×`
    case 'cutout':
      return 'Remove background'
  }
}

/**
 * The chain on Done's strip after the source, in Forge's order: the format
 * (or, where it kept the format, the quality it was compressed at), the
 * size, the cut, the models, then a target size.
 */
export function chainLabels(source: FormatId, steps: PresetSteps): string[] {
  const kept = steps.to === undefined || steps.to === source
  const format =
    !kept && steps.to
      ? [`${formatLabel(steps.to)}${steps.quality === undefined ? '' : ` ${steps.quality}`}`]
      : steps.quality !== undefined
        ? [`quality ${steps.quality}`]
        : []
  return [
    ...format,
    ...(steps.resize ? [resizeLabel(steps.resize)] : []),
    ...(steps.trim ? ['Trim'] : []),
    ...(steps.crop ? [`${steps.crop.w}:${steps.crop.h}`] : []),
    ...(steps.sharpen && !steps.boost ? ['Sharpen'] : []),
    ...(steps.boost ? [`Boost ${steps.boost}×`] : []),
    ...(steps.removeBackground ? ['Remove background'] : []),
    ...(steps.maxBytes ? [sizeLabel(steps.maxBytes)] : []),
  ]
}

/**
 * Why an operation cannot apply to this image, in the Edit picker's words: an
 * animation cannot be trimmed or cropped, a picture with no plain border has
 * nothing to trim, a 1 × 1 one has no shape to cut. `measure` arrives once
 * the image has been read; until then only what the probe knows is said.
 */
export function reasonsFor(
  image: { width: number; height: number; frames: number },
  measure: { trimmed: unknown } | undefined,
): Partial<Record<Op, string>> {
  if (image.frames > 1) return { trim: 'animated', crop: 'animated' }
  const reasons: Partial<Record<Op, string>> = {}
  if (measure?.trimmed === 'nothing') reasons.trim = 'no empty edges'
  if (shapesFor(image).length === 0) reasons.crop = 'no shape to cut'
  return reasons
}
