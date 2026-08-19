import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { targetsFor } from './capabilities.js'
import { invalidArguments } from './errors.js'
import { FORMATS, formatById } from './formats.js'
import { resolveOutputPath } from './output-path.js'
import type { ConvertOptions, FormatId, FormatSpec, Job, SourceInfo } from './types.js'

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

/**
 * plan() cannot trust `values.target` the way options() can afford to — a
 * caller (in practice, the shell) is expected to reach plan() only after
 * walking options(), but nothing enforces that. An unchecked `as FormatId`
 * here would let a missing, empty, or bogus target slip through and crash
 * deep inside resolveOutputPath instead of failing at the boundary with a
 * message that says what went wrong.
 */
function requireTarget(values: Record<string, unknown>): FormatSpec {
  const raw = values.target
  const spec = typeof raw === 'string' ? formatById(raw) : undefined
  if (!spec) {
    throw invalidArguments(
      `convertAction.plan() requires a valid target format, got ${JSON.stringify(raw)}.`,
      'This is a caller bug, not a user-facing condition: call options() and pass one of the target select choices before calling plan().',
    )
  }
  return spec
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
    const spec = requireTarget(values)
    const target = spec.id

    const options: ConvertOptions = {
      background: '#ffffff',
      keepMetadata: false,
    }
    if (spec.lossy && typeof values.quality === 'number') options.quality = values.quality

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
