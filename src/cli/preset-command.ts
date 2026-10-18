import { expandTilde, loadPreferences } from '../config/preferences.js'
import { invalidArguments, unsupportedOperation } from '../core/errors.js'
import { resolveOutputPath, sameFile, uniqueOutputPath } from '../core/output-path.js'
import { passesFor } from '../core/preset.js'
import { runPreset } from '../core/preset-run.js'
import { type InputFailure, resolveInputs } from '../core/resolve.js'
import type { Result } from '../core/types.js'
import type { PresetIntent } from './args.js'
import type { RunReport } from './execute.js'

/**
 * `forge photo.png --preset blog`: the preset's passes on each image, from
 * the original, saved where the preset says unless `--output` says otherwise.
 * A result that would land on its own source becomes `photo (1).png` — a
 * preset never writes over the original.
 */
export async function runPresetCommand(intent: PresetIntent): Promise<RunReport> {
  const { prefs } = await loadPreferences()
  const presets = prefs.presets ?? []
  const preset = presets.find((p) => p.name === intent.name)
  if (!preset) {
    const names = presets.map((p) => p.name)
    throw invalidArguments(
      `No preset is called ${intent.name}.`,
      names.length > 0
        ? `Saved presets: ${names.join(', ')}.`
        : 'Save one from Done with p, after a conversion.',
    )
  }

  const resolved = await resolveInputs(intent.inputs, { recursive: intent.recursive })
  const results: Result[] = []
  const failures: InputFailure[] = [...resolved.failures]
  let inputBytes = 0
  let outputBytes = 0
  const folder =
    intent.output ??
    (preset.saveTo === 'same' || preset.saveTo === 'ask' ? undefined : expandTilde(preset.saveTo))

  for (const source of resolved.sources) {
    if (source.kind !== 'image') {
      failures.push({
        path: source.path,
        error: unsupportedOperation(
          'preset',
          'presets work on images',
          'Try an image such as a JPEG, PNG, WebP or HEIC file.',
        ),
      })
      continue
    }
    const passes = passesFor(preset.steps, source.format)
    const last = passes[passes.length - 1]
    if (last?.kind !== 'encode') continue
    let output = resolveOutputPath({
      sourcePath: source.path,
      target: last.target,
      ...(folder === undefined ? {} : { output: folder }),
      ...(resolved.roots.get(source.path) ? { sourceRoot: resolved.roots.get(source.path) } : {}),
    })
    if (sameFile(output, source.path)) output = uniqueOutputPath(output)
    const outcome = await runPreset(source, passes, output, { force: intent.force })
    if (outcome.kind === 'done') {
      results.push(outcome.result)
      inputBytes += source.bytes
      outputBytes += outcome.result.outputBytes
    } else if (outcome.kind === 'unreachable') {
      failures.push({ path: source.path, error: outcome.entry.error })
    } else if (outcome.kind !== 'cancelled') {
      failures.push({ path: source.path, error: outcome.error })
    }
  }
  return { kind: 'preset', results, failures, inputBytes, outputBytes }
}
