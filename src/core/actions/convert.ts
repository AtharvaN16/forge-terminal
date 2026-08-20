import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { expandTilde, type Preferences } from '../../config/preferences.js'
import { targetsFor } from '../capabilities.js'
import { invalidArguments } from '../errors.js'
import { FORMATS, formatById } from '../formats.js'
import { resolveOutputPath } from '../output-path.js'
import type { ConvertOptions, FormatId, FormatSpec, SourceInfo } from '../types.js'
import type { Action, OptionSpec, PathPreset } from './index.js'

function targetSelect(source: SourceInfo): OptionSpec {
  // Converting a file to its own format changes nothing the user can see,
  // so it is never offered here (the CLI's separate `--to jpeg` recompress
  // flow is unaffected — that goes through core/plan.ts, not this file).
  const targets = targetsFor(source).filter((t) => t.id !== source.format)
  const first = targets[0]
  return {
    kind: 'select',
    id: 'target',
    // Names the source format explicitly, so it reads as "pick something
    // else" rather than leaving the user to wonder why their own format
    // is missing from the list.
    label: `Convert ${FORMATS[source.format].label} to`,
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

/**
 * Names a path the way the built-in presets do, so a hoisted default is not
 * shown as a bare path when it happens to be one of them.
 */
function labelFor(path: string, sourceDir: string): string {
  if (path === sourceDir) return 'Same folder'
  if (path === join(homedir(), 'Desktop')) return 'Desktop'
  if (path === join(homedir(), 'Downloads')) return 'Downloads'
  if (path === join(sourceDir, 'converted')) return 'New subfolder'
  return path.split('/').pop() || path
}

function destinationPath(source: SourceInfo, prefs: Preferences): OptionSpec {
  const here = dirname(source.path)
  const preferred = expandTilde(prefs.defaultOutput)

  // The configured default leads, listed explicitly so that a default
  // pointing somewhere none of the built-ins cover still appears at all. When
  // it *is* one of them, the dedupe below collapses the pair and this entry
  // wins — which is why it carries the built-in's label rather than a path.
  const candidates: PathPreset[] = [
    { label: labelFor(preferred, here), path: preferred },
    { label: 'Desktop', path: join(homedir(), 'Desktop') },
    { label: 'Same folder', path: here },
    { label: 'Downloads', path: join(homedir(), 'Downloads') },
    { label: 'New subfolder', path: join(here, 'converted') },
  ]
  // Two presets can resolve to the identical folder — e.g. "Same folder" and
  // "Downloads" collide whenever the source file already lives in
  // ~/Downloads. `Select` keys each row by its path, so an undeduped
  // collision here is not cosmetic: React treats it as two components
  // sharing one identity and refuses to render reliably. Keep the earlier
  // (more specific) preset and drop the redundant one.
  const seen = new Set<string>()
  const presets = candidates.filter((preset) => {
    if (seen.has(preset.path)) return false
    seen.add(preset.path)
    return true
  })
  return {
    kind: 'path',
    id: 'destination',
    label: 'Save to',
    default: preferred,
    presets,
  }
}

export const convertAction: Action = {
  id: 'convert',
  label: 'Convert',
  hint: 'to another format',

  appliesTo: () => true,

  options(source, values, prefs) {
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
        default: prefs.quality,
      })
    }

    specs.push(destinationPath(source, prefs))
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
