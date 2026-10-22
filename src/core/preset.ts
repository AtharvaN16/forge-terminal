import { formatById } from './formats.js'
import type { Aspect, FormatId, ResizeSpec } from './types.js'

/**
 * A preset (mockups/presets-2026-10.html): the operations kept from a
 * Continue editing window, under a name, with where it saves. Each step is a
 * rule that fits any image, rerun from the original in Forge's own order —
 * so it holds what was selected, never the order it was selected in.
 */
export interface PresetSteps {
  /** Convert to. Absent keeps the source's format. */
  to?: FormatId
  quality?: number
  /** Compress to a target size: the search picks the quality. */
  maxBytes?: number
  resize?: ResizeSpec
  trim?: boolean
  /** Crop to shape, placed around the subject as Forge does when unplaced. */
  crop?: Aspect
  sharpen?: boolean
  boost?: 2 | 3 | 4
  removeBackground?: boolean
  /** What goes behind a cut-out when the format has no transparency. */
  behind?: 'white' | 'black'
  /**
   * Made by `/compress`: smaller than the original or nothing, and a PNG or
   * GIF cut to a palette at the quality. A target size always compresses.
   */
  compress?: { dither: boolean }
}

export interface Preset {
  name: string
  steps: PresetSteps
  /** A folder (`~` unexpanded), `same` for the source's own folder, or `ask` each time. */
  saveTo: string
}

/** Letters, digits and dashes, not starting with a dash: `/blog` and `--preset blog` both work. */
export const isPresetName = (name: string): boolean => /^[A-Za-z0-9][A-Za-z0-9-]*$/.test(name)

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)
const isWhole = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v > 0

function parseResize(v: unknown): ResizeSpec | undefined {
  if (!isRecord(v)) return undefined
  const keys = Object.keys(v)
  if (keys.length !== 1) return undefined
  if (isWhole(v.width)) return { width: v.width }
  if (isWhole(v.height)) return { height: v.height }
  if (isWhole(v.percent)) return { percent: v.percent }
  return undefined
}

/** The steps, or undefined when any of them is not one Forge can run. */
function parseSteps(v: unknown): PresetSteps | undefined {
  if (!isRecord(v)) return undefined
  const steps: PresetSteps = {}
  if (v.to !== undefined) {
    if (typeof v.to !== 'string' || !formatById(v.to)) return undefined
    steps.to = v.to as FormatId
  }
  if (v.quality !== undefined) {
    if (!isWhole(v.quality) || v.quality > 100) return undefined
    steps.quality = v.quality
  }
  if (v.maxBytes !== undefined) {
    if (!isWhole(v.maxBytes)) return undefined
    steps.maxBytes = v.maxBytes
  }
  if (v.resize !== undefined) {
    const resize = parseResize(v.resize)
    if (!resize) return undefined
    steps.resize = resize
  }
  for (const flag of ['trim', 'sharpen', 'removeBackground'] as const) {
    if (v[flag] === undefined) continue
    if (typeof v[flag] !== 'boolean') return undefined
    steps[flag] = v[flag]
  }
  if (v.crop !== undefined) {
    if (!isRecord(v.crop) || !isWhole(v.crop.w) || !isWhole(v.crop.h)) return undefined
    steps.crop = { w: v.crop.w, h: v.crop.h }
  }
  if (v.boost !== undefined) {
    if (v.boost !== 2 && v.boost !== 3 && v.boost !== 4) return undefined
    steps.boost = v.boost
  }
  if (v.compress !== undefined) {
    if (!isRecord(v.compress) || typeof v.compress.dither !== 'boolean') return undefined
    steps.compress = { dither: v.compress.dither }
  }
  if (v.behind !== undefined) {
    if (v.behind !== 'white' && v.behind !== 'black') return undefined
    steps.behind = v.behind
  }
  return steps
}

/** A preset as read from the config, or undefined when any part of it is wrong. */
export function parsePreset(raw: unknown): Preset | undefined {
  if (!isRecord(raw)) return undefined
  if (typeof raw.name !== 'string' || !isPresetName(raw.name)) return undefined
  if (typeof raw.saveTo !== 'string' || raw.saveTo.trim() === '') return undefined
  const steps = parseSteps(raw.steps)
  if (!steps) return undefined
  return { name: raw.name, steps, saveTo: raw.saveTo }
}

/**
 * One pass of a preset's run. Forge runs a preset from the original, in its
 * own order — cut, then the on-device models, then one encode that resizes —
 * whatever order the rows were selected in. Every pass but the last writes a
 * lossless PNG, so nothing is encoded twice.
 */
export type Pass =
  | { kind: 'cut'; trim?: true; crop?: Aspect; resize?: ResizeSpec }
  | { kind: 'cutout' }
  | { kind: 'boost'; scale: 1 | 2 | 3 | 4 }
  | {
      kind: 'encode'
      target: FormatId
      quality?: number
      maxBytes?: number
      resize?: ResizeSpec
      trim?: true
      crop?: Aspect
      /** What goes behind a cut-out the target cannot keep transparent. */
      background?: string
      compress?: { dither: boolean }
    }

const BEHIND = { white: '#ffffff', black: '#000000' } as const

/** The passes `steps` take on a file in `sourceFormat`; none when nothing is selected. */
export function passesFor(steps: PresetSteps, sourceFormat: FormatId): Pass[] {
  const enhance: Pass[] = []
  if (steps.removeBackground) enhance.push({ kind: 'cutout' })
  if (steps.boost) enhance.push({ kind: 'boost', scale: steps.boost })
  else if (steps.sharpen) enhance.push({ kind: 'boost', scale: 1 })

  const cuts: Pass[] = []
  if (steps.trim) cuts.push({ kind: 'cut', trim: true })
  if (steps.crop) cuts.push({ kind: 'cut', crop: steps.crop })

  const target = steps.to ?? sourceFormat
  const encode: Extract<Pass, { kind: 'encode' }> = { kind: 'encode', target }
  // With a target size, the quality is the most the size search may use.
  if (steps.quality !== undefined) encode.quality = steps.quality
  if (steps.maxBytes) encode.maxBytes = steps.maxBytes
  if (steps.compress || steps.maxBytes) encode.compress = steps.compress ?? { dither: false }
  if (steps.resize) encode.resize = steps.resize
  // The engine cuts and encodes in one go when nothing runs between them.
  if (enhance.length === 0) {
    const last = cuts.pop()
    if (last?.kind === 'cut') {
      if (last.trim) encode.trim = true
      if (last.crop) encode.crop = last.crop
    }
  }
  // The size search measures by encoding alone: whatever cuts or resizes
  // runs in a lossless pass first.
  if (encode.maxBytes && (encode.trim || encode.crop || encode.resize)) {
    const { trim, crop, resize } = encode
    cuts.push({
      kind: 'cut',
      ...(trim ? { trim } : {}),
      ...(crop ? { crop } : {}),
      ...(resize ? { resize } : {}),
    })
    delete encode.trim
    delete encode.crop
    delete encode.resize
  }
  if (steps.removeBackground && !formatById(target)?.hasAlpha) {
    encode.background = BEHIND[steps.behind ?? 'white']
  }

  const nothing =
    cuts.length === 0 &&
    enhance.length === 0 &&
    Object.keys(encode).length === 2 &&
    steps.to === undefined
  if (nothing) return []
  // A cut that carries the resize runs after the models, right before the encode.
  const shaped = cuts.filter((c) => c.kind === 'cut' && c.resize)
  const before = cuts.filter((c) => !shaped.includes(c))
  return [...before, ...enhance, ...shaped, encode]
}
