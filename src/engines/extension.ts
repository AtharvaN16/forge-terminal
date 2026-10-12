import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { boostTooLarge, conversionFailed, extensionMissing, isForgeError } from '../core/errors.js'
import { boostOverLimit } from '../core/extension-targets.js'
import { FORMATS } from '../core/formats.js'
import type { Job, Progress, Result, Warning } from '../core/types.js'
import { decodeToPng, encode, writeAtomic } from './image.js'
import { loadSharp } from './libs.js'
import type { Engine } from './types.js'

/** The boost runner's own limits, checked here first. */
const fits = (width: number, height: number, scale: number): boolean =>
  boostOverLimit(width, height, scale) === undefined

/**
 * The largest boost factor below `below` that keeps the output within the
 * limits, or 0 when none does. Worked out from the probed size, so a source
 * that is too large is refused before it is decoded, naming a factor that
 * will actually work.
 */
export function maxBoost(width: number, height: number, below = Number.POSITIVE_INFINITY): number {
  return [4, 2].find((s) => s < below && fits(width, height, s)) ?? 0
}

/**
 * Runs `boost` and `remove-background` jobs through an installed extension.
 *
 * It reads and writes no formats of its own — `reads`/`writes` are empty, so
 * `targetsFor` is unchanged — and it is selected by `ops` only. The extension
 * code (`src/extensions/`) is imported when a job runs, never at load, so a
 * plain conversion does not pay for it (spec §4.2).
 */
async function run(
  job: Job,
  onPhase: (progress: Progress) => void,
  signal?: AbortSignal,
): Promise<Result> {
  if (job.op !== 'boost' && job.op !== 'remove-background') {
    throw new Error(`the extension engine cannot ${job.op}`)
  }
  // A cancelled batch keeps handing jobs to the pool; start no decode for them.
  if (signal?.aborted) throw signal.reason ?? new Error('aborted')
  const source = job.sources[0]
  const output = job.outputs[0]
  const id = job.op
  if (job.op === 'boost' && !fits(source.width, source.height, job.scale)) {
    throw boostTooLarge(source.path, maxBoost(source.width, source.height), job.scale)
  }

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

    // The child's own work has no knowable fraction (invariant 7): one phase,
    // once the tool is this job's. Until then, if another forge has it, the
    // job is waiting, and says so rather than claiming the model is running.
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
    await runExtension(ext, args, {
      subject: source.path,
      what: `${toolVerb(job)} is running on ${basename(source.path)}`,
      onWait: () => onPhase({ phase: 'waiting' }),
      onStart: () => onPhase({ phase: 'encoding' }),
      ...(job.op === 'boost' ? { maxScale: maxBoost(source.width, source.height, job.scale) } : {}),
      ...(signal === undefined ? {} : { signal }),
    })

    const sharp = await loadSharp()
    let pipeline = sharp(result)
    // Alpha is flattened only when the target cannot carry it (invariant 5).
    if (!FORMATS[job.target].hasAlpha)
      pipeline = pipeline.flatten({ background: job.options.background })
    const encoded = await encode(pipeline, job.target, job.options.quality).toBuffer()

    onPhase({ phase: 'writing' })
    const outputBytes = await writeAtomic(encoded, output)
    return { job, outputBytes, warnings }
  } catch (cause) {
    throw isForgeError(cause) ? cause : conversionFailed(source.path, cause)
  } finally {
    await rm(work, { recursive: true, force: true }).catch(() => {})
  }
}

/** The job as the shell names it, for another forge's manage screen. Scale 1 is Sharpen. */
function toolVerb(job: Job): string {
  if (job.op !== 'boost') return 'Remove background'
  return job.scale === 2 || job.scale === 4 ? `Boost resolution ${job.scale}×` : 'Sharpen'
}

export const extensionEngine: Engine = {
  id: 'extension',
  reads: new Set(),
  writes: new Set(),
  ops: new Set<Job['op']>(['boost', 'remove-background']),
  probe: () => Promise.reject(new Error('the extension engine reads no files')),
  run,
}
