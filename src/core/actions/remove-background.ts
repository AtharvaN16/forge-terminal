import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { expandTilde, type Preferences } from '../../config/preferences.js'
import { type Target, targetsFor } from '../capabilities.js'
import { invalidArguments, unsupportedBackgroundTarget } from '../errors.js'
import { FORMATS, formatById } from '../formats.js'
import { resolveOutputPath } from '../output-path.js'
import type { ImageInfo, SourceInfo } from '../types.js'
import type { Action, OptionSpec, PathPreset } from './index.js'

const soleStillImage = (sources: SourceInfo[]): ImageInfo | undefined => {
  const source = sources.length === 1 ? sources[0] : undefined
  return source?.kind === 'image' && source.frames === 1 ? source : undefined
}

export function backgroundTargetsFor(source: ImageInfo): Target[] {
  return targetsFor(source).filter((target) => FORMATS[target.id].hasAlpha)
}

function labelFor(path: string, sourceDir: string): string {
  if (path === sourceDir) return 'Same folder'
  if (path === join(homedir(), 'Desktop')) return 'Desktop'
  if (path === join(homedir(), 'Downloads')) return 'Downloads'
  return path.split('/').pop() || path
}

function destinationPath(source: ImageInfo, prefs: Preferences): OptionSpec {
  const here = dirname(source.path)
  const preferred = expandTilde(prefs.defaultOutput)
  const candidates: PathPreset[] = [
    { label: labelFor(preferred, here), path: preferred },
    { label: 'Desktop', path: join(homedir(), 'Desktop') },
    { label: 'Same folder', path: here },
    { label: 'Downloads', path: join(homedir(), 'Downloads') },
  ]
  const seen = new Set<string>()
  const presets = candidates.filter((preset) => {
    if (seen.has(preset.path)) return false
    seen.add(preset.path)
    return true
  })
  return { kind: 'path', id: 'destination', label: 'Save to', default: preferred, presets }
}

export const removeBackgroundAction: Action = {
  id: 'remove-background',
  label: 'Remove background',
  hint: 'make the background transparent',

  appliesTo: (sources) => soleStillImage(sources) !== undefined,

  unavailable: (sources) => {
    const source = sources[0]
    if (sources.length !== 1) return 'needs one image'
    if (source?.kind !== 'image') return 'images only'
    if (source.frames > 1) return 'still images only'
    return undefined
  },

  options(sources, values, prefs) {
    const source = soleStillImage(sources)
    if (!source) return []
    const targets = backgroundTargetsFor(source)
    const specs: OptionSpec[] = [
      {
        kind: 'select',
        id: 'target',
        label: 'Save the transparent image as',
        choices: targets.map((target) => ({
          value: target.id,
          label: target.label,
          hint: target.hint,
        })),
        default: targets[0]?.id ?? '',
      },
    ]

    const target = typeof values.target === 'string' ? formatById(values.target) : undefined
    if (!target) return specs
    if (target.lossy) {
      specs.push({
        kind: 'slider',
        id: 'quality',
        label: 'Quality',
        min: 1,
        max: 100,
        step: 5,
        default: prefs.quality,
      })
    }
    specs.push(destinationPath(source, prefs))
    return specs
  },

  plan(sources, values) {
    const source = soleStillImage(sources)
    if (!source) {
      throw invalidArguments('removeBackgroundAction.plan() needs exactly one still image.')
    }

    const target = typeof values.target === 'string' ? formatById(values.target) : undefined
    const available = backgroundTargetsFor(source).map((candidate) => candidate.id)
    if (!target || !available.includes(target.id)) {
      throw unsupportedBackgroundTarget(source, String(values.target ?? ''), available)
    }

    const outputValue = typeof values.output === 'string' ? values.output : undefined
    const destination = typeof values.destination === 'string' ? values.destination : undefined
    const sourceRoot = typeof values.sourceRoot === 'string' ? values.sourceRoot : undefined
    const output = resolveOutputPath({
      sourcePath: source.path,
      target: target.id,
      suffix: 'no-bg',
      ...(outputValue !== undefined
        ? { output: outputValue }
        : destination !== undefined
          ? { output: `${destination}/` }
          : {}),
      ...(sourceRoot === undefined ? {} : { sourceRoot }),
    })

    return [
      {
        op: 'remove-background',
        sources: [source],
        outputs: [output],
        target: target.id,
        options: {
          keepMetadata: values.keepMetadata === true,
          ...(target.lossy && typeof values.quality === 'number'
            ? { quality: values.quality }
            : {}),
        },
      },
    ]
  },
}
