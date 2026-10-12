import { targetIdsFor } from '../capabilities.js'
import { unsupportedTarget } from '../errors.js'
import { removeBackgroundTargetRefusal } from '../extension-targets.js'
import { FORMATS } from '../formats.js'
import { suffixedImagePath } from '../output-path.js'
import type { FormatId, ImageInfo, Job, SourceInfo } from '../types.js'
import type { Action, OptionSpec } from './index.js'

/**
 * The two actions an optional extension contributes (spec §5.3).
 *
 * Declared here, offered by `actionsFor` only when the extension is installed
 * (`requires`). They are deliberately not in `ACTIONS`: that list is the
 * always-present set, and `PAGE_OPS` in the MCP schemas is derived from it.
 */

const imagesOnly = (sources: SourceInfo[]): ImageInfo[] | undefined =>
  sources.length > 0 && sources.every((s) => s.kind === 'image')
    ? (sources as ImageInfo[])
    : undefined

/** A target the image engine can write for this source, else the refusal. */
export function extensionTargetError(source: SourceInfo, target: FormatId) {
  const available = targetIdsFor(source)
  return available.includes(target) ? undefined : unsupportedTarget(source, target, available)
}

interface Planned {
  target: FormatId
  scale?: 1 | 2 | 4
  output?: string
  roots?: Map<string, string>
  background: string
  keepMetadata: boolean
  quality?: number
}

function common(values: Record<string, unknown>): Planned {
  return {
    target: (values.target as FormatId | undefined) ?? 'png',
    background: typeof values.background === 'string' ? values.background : '#ffffff',
    keepMetadata: values.keepMetadata === true,
    ...(typeof values.output === 'string' ? { output: values.output } : {}),
    ...(values.roots instanceof Map ? { roots: values.roots as Map<string, string> } : {}),
    ...(typeof values.quality === 'number' ? { quality: values.quality } : {}),
  }
}

const targetOption = (): OptionSpec => ({
  kind: 'select',
  id: 'target',
  label: 'Save as',
  default: 'png',
  choices: [{ value: 'png', label: 'PNG', hint: FORMATS.png.hint }],
})

/** What a boost job adds to the name: `-sharp` at 1×, else `-2x` / `-4x`. */
export const boostSuffix = (scale: 1 | 2 | 4): string => (scale === 1 ? 'sharp' : `${scale}x`)

export const boostAction: Action = {
  id: 'boost',
  label: 'Boost resolution',
  verb: 'Boosting',
  hint: 'sharper, at its size or at 2× or 4×',
  requires: 'boost',
  appliesTo: (sources) => imagesOnly(sources) !== undefined,
  unavailable: () => 'images only',
  options: (): OptionSpec[] => [
    {
      kind: 'select',
      id: 'scale',
      label: 'Scale',
      default: '2',
      choices: [
        { value: '1', label: 'Sharpen', hint: 'the same size, sharper' },
        { value: '2', label: '2×', hint: 'twice the width and height' },
        { value: '4', label: '4×', hint: 'four times the width and height' },
      ],
    },
    targetOption(),
  ],
  plan(sources, values): Job[] {
    const images = imagesOnly(sources)
    if (!images) return []
    const p = common(values)
    const asked = Number(values.scale ?? 2)
    const scale = asked === 4 ? 4 : asked === 1 ? 1 : 2
    return images.map((source) => ({
      op: 'boost' as const,
      sources: [source],
      outputs: [
        suffixedImagePath({
          sourcePath: source.path,
          target: p.target,
          suffix: boostSuffix(scale),
          ...(p.output === undefined ? {} : { output: p.output }),
          ...(p.roots?.get(source.path) === undefined
            ? {}
            : { sourceRoot: p.roots.get(source.path) as string }),
        }),
      ],
      scale,
      target: p.target,
      options: {
        background: p.background,
        keepMetadata: p.keepMetadata,
        ...(p.quality === undefined ? {} : { quality: p.quality }),
      },
    }))
  },
}

export const removeBackgroundAction: Action = {
  id: 'remove-background',
  label: 'Remove background',
  verb: 'Removing',
  hint: 'cut out the subject',
  requires: 'remove-background',
  appliesTo: (sources) => imagesOnly(sources) !== undefined,
  unavailable: () => 'images only',
  options: (): OptionSpec[] => [targetOption()],
  plan(sources, values): Job[] {
    const images = imagesOnly(sources)
    if (!images) return []
    const p = common(values)
    return images.map((source) => ({
      op: 'remove-background' as const,
      sources: [source],
      outputs: [
        suffixedImagePath({
          sourcePath: source.path,
          target: p.target,
          suffix: 'cutout',
          ...(p.output === undefined ? {} : { output: p.output }),
          ...(p.roots?.get(source.path) === undefined
            ? {}
            : { sourceRoot: p.roots.get(source.path) as string }),
        }),
      ],
      target: p.target,
      options: {
        background: p.background,
        keepMetadata: p.keepMetadata,
        ...(p.quality === undefined ? {} : { quality: p.quality }),
      },
    }))
  },
}

export { removeBackgroundTargetRefusal }
