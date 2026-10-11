import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import sharp from 'sharp'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { runPlan } from '../../src/core/execute-jobs.js'
import { buildPlan } from '../../src/core/plan.js'
import { resolveInputs } from '../../src/core/resolve.js'
import type { ConvertOptions, DocumentInfo, Job } from '../../src/core/types.js'
import type { Engine } from '../../src/engines/types.js'
import { makeJpeg, makePng, makeTempDir } from '../helpers/fixtures.js'

let dir: string

beforeAll(async () => {
  dir = await makeTempDir()
})

const scan = (path = '/scan.pdf'): DocumentInfo => ({
  kind: 'document',
  path,
  format: 'pdf',
  bytes: 5_000_000,
  pages: 3,
  encrypted: false,
})

let n = 0
const jobFor = (output?: string): Job => ({
  op: 'convert',
  sources: [scan()],
  // Unique per job so write-safety's collision rule never fires by accident.
  outputs: [output ?? join(dir, `out-${n++}.pdf`)],
  target: 'pdf',
  options: { background: '#ffffff', keepMetadata: false },
})

/**
 * A stub at the `Engine` seam keeps these tests arithmetic rather than
 * twenty-second PDF encodes. The real encoders are covered against real files
 * in the engine measurer suites; what is under test here is which rung
 * `runPlan` settles on and what it hands to `run`.
 */
const stubEngine = (
  ladder: Array<Partial<ConvertOptions>>,
  sizeFor: (options: ConvertOptions) => number,
): Engine => ({
  id: 'stub',
  reads: new Set(['pdf']),
  writes: new Set(['pdf']),
  ops: new Set<Job['op']>(['convert']),
  probe: vi.fn(),
  run: vi.fn(async (job: Job) => ({ job, outputBytes: 1, warnings: [] })),
  measurer: vi.fn(async () => ({
    ladder,
    measure: async (options: ConvertOptions) => sizeFor(options),
  })),
})

describe('runPlan', () => {
  /**
   * The bug this module exists to remove: the shell offered "compress to a
   * target size" on a PDF, collected the number, and never ran a search.
   */
  it('descends the ladder until a rung reaches the target', async () => {
    // 150 dpi never fits; 120 dpi fits at quality 50 or below.
    const engine = stubEngine(
      [{ dpi: 150 }, { dpi: 120 }, { dpi: 96 }, { dpi: 72 }],
      ({ dpi, quality }) => (dpi === 150 ? 900_000 : (quality ?? 100) <= 50 ? 400_000 : 800_000),
    )

    const outcome = await runPlan([jobFor()], {
      force: true,
      targetBytes: 500_000,
      engineFor: () => engine,
    })

    expect(outcome.unreachable).toHaveLength(0)
    expect(outcome.results).toHaveLength(1)

    const ran = (engine.run as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as Extract<
      Job,
      { op: 'convert' }
    >
    expect(ran.options.dpi).toBe(120)
    expect(ran.options.quality).toBeLessThanOrEqual(50)
  })

  it('leaves a job alone when no target size is asked for', async () => {
    const engine = stubEngine([{ dpi: 150 }], () => 1)

    const outcome = await runPlan([jobFor()], { force: true, engineFor: () => engine })

    expect(outcome.results).toHaveLength(1)
    expect(engine.measurer).not.toHaveBeenCalled()
  })

  it('reports the smallest achievable when no rung reaches the target', async () => {
    const engine = stubEngine([{ dpi: 150 }, { dpi: 72 }], ({ dpi }) =>
      dpi === 72 ? 780_000 : 900_000,
    )

    const outcome = await runPlan([jobFor()], {
      force: true,
      targetBytes: 500_000,
      engineFor: () => engine,
    })

    expect(outcome.results).toHaveLength(0)
    expect(outcome.unreachable).toHaveLength(1)
    expect(outcome.unreachable[0]?.smallest).toBe(780_000)
    expect(outcome.unreachable[0]?.settings.dpi).toBe(72)
    expect(engine.run).not.toHaveBeenCalled()
  })

  /**
   * Ordering guarantee: write-safety is cheap and the search is up to
   * thirty-two encodes, so a job that will be refused is never searched.
   */
  it('refuses on write safety before measuring anything', async () => {
    const taken = join(dir, 'already-here.pdf')
    await writeFile(taken, 'x')
    const engine = stubEngine([{}], () => 1)

    const outcome = await runPlan([jobFor(taken)], {
      force: false,
      targetBytes: 500_000,
      engineFor: () => engine,
    })

    expect(outcome.refusals).toHaveLength(1)
    expect(outcome.refusals[0]?.error.code).toBe('output-exists')
    expect(engine.measurer).not.toHaveBeenCalled()
  })

  it('refuses rather than throwing when the engine cannot be searched', async () => {
    const engine: Engine = { ...stubEngine([{}], () => 1) }
    engine.measurer = undefined

    const outcome = await runPlan([jobFor()], {
      force: true,
      targetBytes: 500_000,
      engineFor: () => engine,
    })

    expect(outcome.results).toHaveLength(0)
    expect(outcome.refusals).toHaveLength(1)
    expect(engine.run).not.toHaveBeenCalled()
  })

  /**
   * Per rung, never across. How many rungs a search needs is not knowable
   * before it needs them, so a cross-rung total would be invented — which is
   * what invariant 7 forbids.
   */
  it('emits attempt events carrying the rung they belong to', async () => {
    const engine = stubEngine([{ dpi: 150 }, { dpi: 120 }], ({ dpi, quality }) =>
      dpi === 150 ? 900_000 : (quality ?? 100) <= 50 ? 400_000 : 800_000,
    )
    const attempts: Array<{ attempt: number; of: number; rung: Partial<ConvertOptions> }> = []

    await runPlan([jobFor()], {
      force: true,
      targetBytes: 500_000,
      engineFor: () => engine,
      onEvent: (event) => {
        if (event.type === 'search:attempt') {
          attempts.push({ attempt: event.attempt, of: event.of, rung: event.rung })
        }
      },
    })

    expect(attempts.length).toBeGreaterThan(0)
    expect(attempts.every((a) => a.attempt >= 1 && a.attempt <= a.of)).toBe(true)
    expect(new Set(attempts.map((a) => a.rung.dpi))).toEqual(new Set([150, 120]))
  })
})

/**
 * These rules used to be asserted against `buildPlan`, which enforced them for
 * conversions while page operations and the compress path each had to remember
 * to call `checkWriteSafety` themselves. `runPlan` applies them to every job
 * whatever planned it, so the assertions belong here now.
 */
describe('runPlan write safety', () => {
  const options: ConvertOptions = { background: '#ffffff', keepMetadata: false }

  const planFor = async (inputs: string[], target: 'png' | 'jpeg' | 'webp') => {
    const resolved = await resolveInputs(inputs, { recursive: false })
    return buildPlan({ resolved, target, options, force: false })
  }

  it('refuses to overwrite an existing output without force', async () => {
    const d = await makeTempDir()
    const a = await makeJpeg(d, 'a.jpg')
    await makePng(d, 'a.png')

    const outcome = await runPlan((await planFor([a], 'png')).jobs, { force: false })

    expect(outcome.refusals[0]?.error.code).toBe('output-exists')
    expect(outcome.results).toHaveLength(0)
  })

  it('allows the overwrite with force', async () => {
    const d = await makeTempDir()
    const a = await makeJpeg(d, 'a.jpg')
    await makePng(d, 'a.png')

    const outcome = await runPlan((await planFor([a], 'png')).jobs, { force: true })

    expect(outcome.refusals).toHaveLength(0)
    expect(outcome.results).toHaveLength(1)
  })

  it('refuses to write over its own input without force', async () => {
    const d = await makeTempDir()
    const a = await makeJpeg(d, 'a.jpg')

    const outcome = await runPlan((await planFor([a], 'jpeg')).jobs, { force: false })

    expect(outcome.refusals[0]?.error.code).toBe('output-is-input')
  })

  it('refuses two sources that would clobber the same output, keeping only one job', async () => {
    const d = await makeTempDir()
    const jpg = await makeJpeg(d, 'logo.jpg')
    const webp = join(d, 'logo.webp')
    await sharp(jpg).webp().toFile(webp)

    const outcome = await runPlan((await planFor([jpg, webp], 'png')).jobs, { force: false })

    expect(outcome.results).toHaveLength(1)
    expect(outcome.refusals).toHaveLength(1)
    expect(outcome.refusals[0]?.error.code).toBe('output-collision')
    expect(outcome.refusals[0]?.error.detail).toContain('logo.jpg')
    expect(outcome.refusals[0]?.error.detail).toContain('logo.webp')
    expect(outcome.refusals[0]?.error.detail).toContain('logo.png')
  })

  /** Force means overwrite-on-disk, never let two writes fight each other. */
  it('still refuses the collision with force', async () => {
    const d = await makeTempDir()
    const jpg = await makeJpeg(d, 'logo.jpg')
    const webp = join(d, 'logo.webp')
    await sharp(jpg).webp().toFile(webp)

    const outcome = await runPlan((await planFor([jpg, webp], 'png')).jobs, { force: true })

    expect(outcome.results).toHaveLength(1)
    expect(outcome.refusals).toHaveLength(1)
    expect(outcome.refusals[0]?.error.code).toBe('output-collision')
  })
})

describe('runPlan cancellation', () => {
  it('runs nothing and reports cancelled when the signal aborts mid-search', async () => {
    const controller = new AbortController()
    let measures = 0
    const engine = stubEngine([{ dpi: 150 }, { dpi: 72 }], () => {
      measures += 1
      if (measures === 2) controller.abort()
      // Never fits, so an uncancelled search would walk the whole ladder.
      return 900_000
    })

    const outcome = await runPlan([jobFor()], {
      force: true,
      targetBytes: 500_000,
      engineFor: () => engine,
      signal: controller.signal,
    })

    expect(outcome.cancelled).toBe(true)
    // A cancelled search settles nothing, so there is nothing safe to write —
    // and nothing to ask the user about either.
    expect(outcome.results).toHaveLength(0)
    expect(outcome.unreachable).toHaveLength(0)
    expect(engine.run).not.toHaveBeenCalled()
  })
})

describe('runPlan searches in parallel', () => {
  /** A stub whose `measure` waits, so overlapping searches are observable. */
  const slowEngine = (fitsAt: number, onMeasure: () => void = () => {}) => {
    let inFlight = 0
    const stats = { peak: 0, measures: 0 }
    const engine: Engine = {
      id: 'slow',
      reads: new Set(['pdf']),
      writes: new Set(['pdf']),
      ops: new Set<Job['op']>(['convert']),
      probe: vi.fn(),
      run: vi.fn(async (job: Job) => ({ job, outputBytes: 1, warnings: [] })),
      measurer: vi.fn(async () => ({
        ladder: [{}],
        measure: async (options: ConvertOptions) => {
          inFlight += 1
          stats.peak = Math.max(stats.peak, inFlight)
          stats.measures += 1
          onMeasure()
          await new Promise((r) => setTimeout(r, 5))
          inFlight -= 1
          return (options.quality ?? 100) <= fitsAt ? 100 : 1_000_000
        },
      })),
    }
    return { engine, stats }
  }

  it('searches up to `concurrency` files at once', async () => {
    const { engine, stats } = slowEngine(50)
    const jobs = [jobFor(), jobFor(), jobFor(), jobFor()]
    const outcome = await runPlan(jobs, {
      force: true,
      targetBytes: 500,
      concurrency: 4,
      engineFor: () => engine,
    })
    expect(stats.peak).toBe(4)
    expect(outcome.results).toHaveLength(4)
  })

  it('runs the settled jobs in their original order, whichever search finished first', async () => {
    const { engine } = slowEngine(50)
    const jobs = [jobFor(), jobFor(), jobFor()]
    await runPlan(jobs, { force: true, targetBytes: 500, concurrency: 3, engineFor: () => engine })
    const ran = (engine.run as ReturnType<typeof vi.fn>).mock.calls.map(
      (c) => (c[0] as Job).outputs[0],
    )
    expect(ran).toEqual(jobs.map((j) => j.outputs[0]))
  })

  it('reports each finished search as a real count, never a percentage', async () => {
    const { engine } = slowEngine(50)
    const settled: Array<{ completed: number; total: number }> = []
    await runPlan([jobFor(), jobFor(), jobFor()], {
      force: true,
      targetBytes: 500,
      engineFor: () => engine,
      onEvent: (event) => {
        if (event.type === 'search:settled') {
          settled.push({ completed: event.completed, total: event.total })
        }
      },
    })
    expect(settled.map((s) => s.completed)).toEqual([1, 2, 3])
    expect(settled.every((s) => s.total === 3)).toBe(true)
  })

  it('refuses unsafe writes before any search starts', async () => {
    const d = await makeTempDir()
    const existing = join(d, 'taken.pdf')
    await writeFile(existing, 'already here')
    const { engine } = slowEngine(50)
    const outcome = await runPlan([jobFor(existing), jobFor()], {
      force: false,
      targetBytes: 500,
      engineFor: () => engine,
    })
    expect(outcome.refusals.map((r) => r.error.code)).toEqual(['output-exists'])
    // One measurer: the refused job was never searched.
    expect(engine.measurer).toHaveBeenCalledTimes(1)
  })

  // Review Focus 1.
  it('on cancel, writes nothing and starts no encode after it resolves', async () => {
    const controller = new AbortController()
    const { engine, stats } = slowEngine(0, () => {
      // Abort on the third measure. Four searches are in flight by then.
      if (stats.measures === 3) controller.abort()
    })
    const outcome = await runPlan([jobFor(), jobFor(), jobFor(), jobFor(), jobFor(), jobFor()], {
      force: true,
      targetBytes: 500,
      concurrency: 4,
      engineFor: () => engine,
      signal: controller.signal,
    })
    expect(outcome.cancelled).toBe(true)
    expect(outcome.results).toEqual([])
    expect(engine.run).not.toHaveBeenCalled()
    const atResolve = stats.measures
    await new Promise((r) => setTimeout(r, 30))
    expect(stats.measures).toBe(atResolve)
  })

  // Review Focus 2.
  it('reports a search that throws as that file failing, and still runs the rest', async () => {
    const good = stubEngine([{}], ({ quality }) => ((quality ?? 100) <= 50 ? 100 : 1_000_000))
    const bad: Engine = {
      ...good,
      measurer: vi.fn(async () => ({
        ladder: [{}],
        measure: async () => {
          throw new Error('decoder blew up')
        },
      })),
    }
    const broken = jobFor()
    const fine = jobFor()
    const outcome = await runPlan([broken, fine], {
      force: true,
      targetBytes: 500,
      engineFor: (job) => (job === broken ? bad : good),
    })
    expect(outcome.failures).toHaveLength(1)
    expect(outcome.failures[0]?.error.code).toBe('conversion-failed')
    expect(outcome.results.map((r) => r.job)).toEqual([fine])
  })
})
