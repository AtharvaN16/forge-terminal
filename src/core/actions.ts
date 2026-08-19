import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { targetsFor } from './capabilities.js'
import { FORMATS } from './formats.js'
import { resolveOutputPath } from './output-path.js'
import type { ConvertOptions, FormatId, Job, SourceInfo } from './types.js'

export interface Choice {
  value: string
  label: string
  hint?: string
}

export interface PathPreset {
  label: string
  path: string
}

export type OptionSpec =
  | { kind: 'select'; id: string; label: string; choices: Choice[]; default: string }
  | {
      kind: 'slider'
      id: string
      label: string
      min: number
      max: number
      step: number
      default: number
    }
  | { kind: 'path'; id: string; label: string; default: string; presets: PathPreset[] }

export interface Action {
  id: string
  label: string
  hint: string
  appliesTo(source: SourceInfo): boolean
  /**
   * Takes the answers so far, because some options depend on earlier ones —
   * the quality slider only makes sense once a lossy target is chosen.
   * (Spec §6 declared this without the second parameter; see the plan.)
   */
  options(source: SourceInfo, values: Record<string, unknown>): OptionSpec[]
  plan(source: SourceInfo, values: Record<string, unknown>): Job[]
}

const DEFAULT_QUALITY = 80

function targetSelect(source: SourceInfo): OptionSpec {
  const targets = targetsFor(source)
  const first = targets[0]
  return {
    kind: 'select',
    id: 'target',
    label: 'Convert to',
    choices: targets.map((t) => ({ value: t.id, label: t.label, hint: t.hint })),
    default: first ? first.id : '',
  }
}

function destinationPath(source: SourceInfo): OptionSpec {
  const here = dirname(source.path)
  return {
    kind: 'path',
    id: 'destination',
    label: 'Save to',
    default: here,
    presets: [
      { label: 'Same folder', path: here },
      { label: 'New subfolder', path: join(here, 'converted') },
      { label: 'Downloads', path: join(homedir(), 'Downloads') },
    ],
  }
}

export const convertAction: Action = {
  id: 'convert',
  label: 'Convert',
  hint: 'to another format',

  appliesTo: () => true,

  options(source, values) {
    const specs: OptionSpec[] = [targetSelect(source)]

    const target = values.target
    if (typeof target !== 'string') return specs

    const spec = FORMATS[target as FormatId]
    if (spec?.lossy) {
      specs.push({
        kind: 'slider',
        id: 'quality',
        label: 'Quality',
        min: 1,
        max: 100,
        step: 5,
        default: DEFAULT_QUALITY,
      })
    }

    specs.push(destinationPath(source))
    return specs
  },

  plan(source, values) {
    const target = values.target as FormatId
    const spec = FORMATS[target]

    const options: ConvertOptions = {
      background: '#ffffff',
      keepMetadata: false,
    }
    if (spec?.lossy && typeof values.quality === 'number') options.quality = values.quality

    const destination = typeof values.destination === 'string' ? values.destination : undefined
    const output = resolveOutputPath({
      sourcePath: source.path,
      target,
      ...(destination === undefined ? {} : { output: `${destination}/` }),
    })

    return [{ source, target, output, options }]
  },
}

export const ACTIONS: Action[] = [convertAction]

export function actionsFor(source: SourceInfo): Action[] {
  return ACTIONS.filter((a) => a.appliesTo(source))
}
