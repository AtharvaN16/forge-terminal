import { existsSync } from 'node:fs'
import { basename, dirname, extname, join } from 'node:path'
import { expandTilde } from '../config/preferences.js'
import { targetsFor } from '../core/capabilities.js'
import { FORMATS, primaryExtension } from '../core/formats.js'
import type { Pass, Preset } from '../core/preset.js'
import type { Aspect, FormatId, ResizeSpec, SourceInfo } from '../core/types.js'

/**
 * Running a saved preset next time (decided, mockups/presets-ux-2026-10-round10.html):
 * which presets fit what is staged (p presets in the field, the Presets tab
 * in Convert to), what each pass of a run is called on the working screen
 * (R6), and where the run's file goes. Pure but for `existsSync` as the
 * default of `presetOutput`'s `exists`.
 */

/**
 * The presets that can run on `source`: every preset is made from an image's
 * steps, so it fits an image whose format can become the preset's.
 */
export function presetsFor(presets: readonly Preset[], source: SourceInfo): Preset[] {
  if (source.kind !== 'image') return []
  const can = new Set(targetsFor(source).map((t) => t.id))
  return presets.filter(
    (p) => p.steps.to === undefined || p.steps.to === source.format || can.has(p.steps.to),
  )
}

const formatLabel = (f: FormatId) => FORMATS[f]?.label ?? f.toUpperCase()

/** What each pass of a run is called: the steps it carries, as the chain says them. */
export function passLabels(passes: readonly Pass[], source: FormatId): string[][] {
  return passes.map((pass): string[] => {
    const shaped = (p: { trim?: true; crop?: Aspect; resize?: ResizeSpec }) => [
      ...(p.resize ? [resizeText(p.resize)] : []),
      ...(p.trim ? ['Trim'] : []),
      ...(p.crop ? [`${p.crop.w}:${p.crop.h}`] : []),
    ]
    if (pass.kind === 'cut') return shaped(pass)
    if (pass.kind === 'cutout') return ['Remove background']
    if (pass.kind === 'boost') return [pass.scale === 1 ? 'Sharpen' : `Boost ${pass.scale}×`]
    const kept = pass.target === source
    const format = kept
      ? pass.quality !== undefined
        ? [`quality ${pass.quality}`]
        : [formatLabel(pass.target)]
      : [`${formatLabel(pass.target)}${pass.quality === undefined ? '' : ` ${pass.quality}`}`]
    return [
      ...format,
      ...shaped(pass),
      ...(pass.maxBytes ? [`under ${Math.round(pass.maxBytes / 1000)} KB`] : []),
    ]
  })
}

function resizeText(spec: ResizeSpec): string {
  return 'width' in spec
    ? `${spec.width} wide`
    : 'height' in spec
      ? `${spec.height} high`
      : `${spec.percent}%`
}

/**
 * Where a run's file goes: the preset's folder (Same location, and for now
 * Ask each time, beside the file — as `forge --preset` does), named as the
 * file in the format the preset makes. Never over a file that is there, nor
 * over the original: those become "name (1).jpg".
 */
export function presetOutput(
  preset: Preset,
  source: SourceInfo,
  exists: (path: string) => boolean = existsSync,
): string {
  const folder =
    preset.saveTo === 'same' || preset.saveTo === 'ask'
      ? dirname(source.path)
      : expandTilde(preset.saveTo)
  const target = preset.steps.to ?? source.format
  const stem = basename(source.path, extname(source.path))
  const ext = primaryExtension(target)
  const taken = (p: string) => p === source.path || exists(p)
  let out = join(folder, `${stem}${ext}`)
  for (let n = 1; taken(out) && n < 10_000; n++) out = join(folder, `${stem} (${n})${ext}`)
  return out
}
