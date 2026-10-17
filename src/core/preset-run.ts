import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { probe as probeFile } from '../engines/registry.js'
import { conversionFailed, type ForgeError, isForgeError } from './errors.js'
import { type PlanEvent, type RunPolicy, runPlan, type UnreachableTarget } from './execute-jobs.js'
import type { Pass } from './preset.js'
import type { ConvertOptions, ImageInfo, Job, Result, SourceInfo } from './types.js'

export type PresetOutcome =
  | { kind: 'done'; result: Result }
  /** A pass threw: which one, so the shell can mark its row. Nothing was written. */
  | { kind: 'failed'; pass: Pass; error: ForgeError }
  /** Write safety refused the result (it exists, or is the source): retryable with `force`. */
  | { kind: 'refused'; error: ForgeError }
  | { kind: 'unreachable'; entry: UnreachableTarget }
  | { kind: 'cancelled' }

export interface PresetPolicy {
  force: boolean
  signal?: AbortSignal
  onEvent?: (event: PlanEvent) => void
  /** Test seam: reads what a pass wrote. */
  probe?: (path: string) => Promise<SourceInfo>
}

const BASE: ConvertOptions = { background: '#ffffff', keepMetadata: false }

/** The job one pass runs on `source`, writing `output`. */
function jobFor(pass: Pass, source: ImageInfo, output: string): Job {
  switch (pass.kind) {
    case 'cut':
      return {
        op: 'convert',
        sources: [source],
        outputs: [output],
        target: 'png',
        options: {
          ...BASE,
          ...(pass.trim ? { trim: true } : {}),
          ...(pass.crop ? { crop: { aspect: pass.crop } } : {}),
          ...(pass.resize ? { resize: pass.resize } : {}),
        },
      }
    case 'cutout':
      return {
        op: 'remove-background',
        sources: [source],
        outputs: [output],
        target: 'png',
        options: BASE,
      }
    case 'boost':
      return {
        op: 'boost',
        sources: [source],
        outputs: [output],
        scale: pass.scale,
        target: 'png',
        options: BASE,
      }
    case 'encode':
      return {
        op: 'convert',
        sources: [source],
        outputs: [output],
        target: pass.target,
        options: {
          ...BASE,
          ...(pass.background ? { background: pass.background } : {}),
          ...(pass.quality !== undefined ? { quality: pass.quality } : {}),
          ...(pass.trim ? { trim: true } : {}),
          ...(pass.crop ? { crop: { aspect: pass.crop } } : {}),
          ...(pass.resize ? { resize: pass.resize } : {}),
        },
      }
  }
}

/**
 * Runs a preset's passes on `source`, from the original: every pass but the
 * last writes a lossless PNG to a temp folder, the last writes `output`. The
 * temp folder goes whatever happens, so only the result is ever left behind.
 */
export async function runPreset(
  source: ImageInfo,
  passes: Pass[],
  output: string,
  policy: PresetPolicy,
): Promise<PresetOutcome> {
  const probe = policy.probe ?? probeFile
  const temp = await mkdtemp(join(tmpdir(), 'forge-preset-'))
  const run: RunPolicy = {
    force: policy.force,
    ...(policy.signal ? { signal: policy.signal } : {}),
    ...(policy.onEvent ? { onEvent: policy.onEvent } : {}),
  }
  try {
    let current = source
    for (const [i, pass] of passes.entries()) {
      const last = i === passes.length - 1
      const to = last ? output : join(temp, `${i}.png`)
      const outcome = await runPlan([jobFor(pass, current, to)], {
        ...run,
        // Temp files are ours to replace; only the result answers to `force`.
        ...(last ? {} : { force: true }),
        ...(last && pass.kind === 'encode' && pass.maxBytes ? { targetBytes: pass.maxBytes } : {}),
      })
      if (outcome.cancelled) return { kind: 'cancelled' }
      const refusal = outcome.refusals[0]
      if (refusal) return { kind: 'refused', error: refusal.error }
      const unreachable = outcome.unreachable[0]
      if (unreachable) return { kind: 'unreachable', entry: unreachable }
      const failure = outcome.failures[0]
      if (failure) return { kind: 'failed', pass, error: failure.error }
      const result = outcome.results[0]
      if (!result)
        return { kind: 'failed', pass, error: conversionFailed(source.path, 'no result') }
      if (last) {
        // The last pass read a temp PNG; what was run is the original.
        const job =
          result.job.op === 'convert'
            ? { ...result.job, sources: [source] as [ImageInfo] }
            : result.job
        return { kind: 'done', result: { ...result, job } }
      }
      const next = await probe(to)
      if (next.kind !== 'image') {
        return { kind: 'failed', pass, error: conversionFailed(source.path, 'not an image') }
      }
      current = next
    }
    return {
      kind: 'failed',
      pass: { kind: 'encode', target: source.format },
      error: conversionFailed(source.path, 'nothing to run'),
    }
  } catch (e) {
    return {
      kind: 'failed',
      pass: passes[passes.length - 1] ?? { kind: 'encode', target: source.format },
      error: isForgeError(e) ? e : conversionFailed(source.path, e),
    }
  } finally {
    await rm(temp, { recursive: true, force: true })
  }
}
