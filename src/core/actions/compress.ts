import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { expandTilde, type Preferences } from '../../config/preferences.js'
import { invalidArguments } from '../errors.js'
import { FORMATS, primaryExtension } from '../formats.js'
import type { SourceInfo } from '../types.js'
import type { Action, OptionSpec, PathPreset } from './index.js'

/**
 * The suffix that keeps a compressed file from landing on its source.
 *
 * Compression keeps the extension, so without this the default output *is*
 * the input whenever "Same folder" is chosen, and `buildPlan` would refuse
 * every run under the never-write-over-the-input rule. The name step comes
 * after, so this is a default the user can overwrite rather than a rule.
 */
const SUFFIX = '-small'

function labelFor(path: string, sourceDir: string): string {
  if (path === sourceDir) return 'Same folder'
  if (path === join(homedir(), 'Desktop')) return 'Desktop'
  if (path === join(homedir(), 'Downloads')) return 'Downloads'
  return path.split('/').pop() || path
}

function destinationPath(source: SourceInfo, prefs: Preferences): OptionSpec {
  const here = dirname(source.path)
  const preferred = expandTilde(prefs.defaultOutput)

  const candidates: PathPreset[] = [
    { label: labelFor(preferred, here), path: preferred },
    { label: 'Desktop', path: join(homedir(), 'Desktop') },
    { label: 'Same folder', path: here },
    { label: 'Downloads', path: join(homedir(), 'Downloads') },
  ]

  // Two presets can resolve to one folder — the configured default is often
  // Desktop. Select keys rows by path, so an undeduped collision is two
  // components sharing one identity, which React refuses to render reliably.
  const seen = new Set<string>()
  const presets = candidates.filter((preset) => {
    if (seen.has(preset.path)) return false
    seen.add(preset.path)
    return true
  })

  return { kind: 'path', id: 'destination', label: 'Save to', default: preferred, presets }
}

export const compressAction: Action = {
  id: 'compress',
  label: 'Compress',
  hint: 'make it smaller',

  /**
   * Only formats with a quality dial.
   *
   * Compressing a PNG by quality is not something the encoder can do —
   * `formats.ts` declares PNG lossless and `engines/image.ts` encodes it
   * losslessly on purpose — so offering it here would promise something that
   * cannot happen. Making a PNG smaller means changing its format, which is
   * what `/convert` is for.
   */
  appliesTo: (source) => FORMATS[source.format].lossy,

  options(source, values, prefs) {
    const specs: OptionSpec[] = [
      {
        kind: 'select',
        id: 'mode',
        label: `Compress ${source.path.split('/').pop() ?? 'this file'}`,
        choices: [
          { value: 'quality', label: 'By quality', hint: 'pick a level, see the result' },
          { value: 'size', label: 'To a target size', hint: 'smallest quality that fits' },
        ],
        default: 'quality',
      },
    ]

    if (values.mode === 'quality') {
      specs.push({
        kind: 'slider',
        id: 'quality',
        label: 'Quality',
        min: 1,
        max: 100,
        step: 5,
        default: prefs.quality,
      })
    } else if (values.mode === 'size') {
      specs.push({
        kind: 'text',
        id: 'size',
        label: 'Target size',
        placeholder: 'e.g. 500kb or 2mb',
      })
    } else {
      // Nothing further is knowable until the mode is answered — the steps
      // after it differ entirely.
      return specs
    }

    specs.push(destinationPath(source, prefs))
    return specs
  },

  plan(source, values) {
    const mode = values.mode
    if (mode !== 'quality' && mode !== 'size') {
      throw invalidArguments(
        `compressAction.plan() needs a mode of "quality" or "size", got ${JSON.stringify(mode)}.`,
        'This is a caller bug, not a user-facing condition: walk options() before calling plan().',
      )
    }

    const stem = (source.path.split('/').pop() ?? 'file').replace(/\.[^.]+$/, '')
    const destination =
      typeof values.destination === 'string' ? values.destination : dirname(source.path)
    const output = `${destination}/${stem}${SUFFIX}${primaryExtension(source.format)}`

    return [
      {
        op: 'convert',
        sources: [source],
        // The whole point of the action: the format does not change.
        target: source.format,
        outputs: [output],
        options: {
          background: '#ffffff',
          keepMetadata: false,
          // In size mode the quality is the search's answer, not the user's,
          // so none is carried here — the caller fills it in once found.
          ...(mode === 'quality' && typeof values.quality === 'number'
            ? { quality: values.quality }
            : {}),
        },
      },
    ]
  },
}
