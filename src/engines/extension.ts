import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { conversionFailed, extensionMissing, isForgeError } from '../core/errors.js'
import { FORMATS } from '../core/formats.js'
import type { Job, Progress, Result, Warning } from '../core/types.js'
import { decodeToPng, encode, writeAtomic } from './image.js'
import { loadSharp } from './libs.js'
import type { Engine } from './types.js'

/**
 * Runs `boost` and `remove-background` jobs through an installed extension.
 *
 * It reads and writes no formats of its own — `reads`/`writes` are empty, so
 * `targetsFor` is unchanged — and it is selected by `ops` only. The extension
 * code (`src/extensions/`) is imported when a job runs, never at load, so a
 * plain conversion does not pay for it (spec §4.2).
 */
async function run(job: Job, onPhase: (progress: Progress) => void): Promise<Result> {
  if (job.op !== 'boost' && job.op !== 'remove-background') {
    throw new Error(`the extension engine cannot ${job.op}`)
  }
  const source = job.sources[0]
  const output = job.outputs[0]
  const id = job.op

  const { installed, extensionsRoot } = await import('../extensions/paths.js')
  const ext = await installed(id)
  if (!ext) throw extensionMissing(id)
  const { runExtension } = await import('../extensions/run.js')

  const warnings: Warning[] = []
  if (source.frames > 1) {
    warnings.push({
      code: 'animation-flattened',
      message: `${basename(source.path)} has ${source.frames} frames. Only the first frame was used.`,
    })
  }

  const work = await mkdtemp(join(tmpdir(), 'forge-ext-'))
  try {
    onPhase({ phase: 'decoding' })
    const input = join(work, 'in.png')
    const result = join(work, 'out.png')
    await decodeToPng(source, input)

    // The child's own work has no knowable fraction (invariant 7): one phase.
    onPhase({ phase: 'encoding' })
    // The contract: boost takes flags; the cutout helper takes `<in> <out>`.
    const args =
      job.op === 'boost'
        ? [
            '--in',
            input,
            '--out',
            result,
            '--scale',
            String(job.scale),
            '--cache',
            join(extensionsRoot(), 'boost', 'cache'),
          ]
        : [input, result]
    await runExtension(ext, args)

    onPhase({ phase: 'writing' })
    const sharp = await loadSharp()
    let pipeline = sharp(result)
    // Alpha is flattened only when the target cannot carry it (invariant 5).
    if (!FORMATS[job.target].hasAlpha)
      pipeline = pipeline.flatten({ background: job.options.background })
    const outputBytes = await writeAtomic(encode(pipeline, job.target, job.options.quality), output)
    return { job, outputBytes, warnings }
  } catch (cause) {
    throw isForgeError(cause) ? cause : conversionFailed(source.path, cause)
  } finally {
    await rm(work, { recursive: true, force: true }).catch(() => {})
  }
}

export const extensionEngine: Engine = {
  id: 'extension',
  reads: new Set(),
  writes: new Set(),
  ops: new Set<Job['op']>(['boost', 'remove-background']),
  probe: () => Promise.reject(new Error('the extension engine reads no files')),
  run,
}
