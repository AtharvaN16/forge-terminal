import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildPlan } from '../../src/core/plan.js'
import { resolveInputs } from '../../src/core/resolve.js'
import { pool, type RunEvent, resolveConcurrency, runJobs } from '../../src/core/run.js'
import type { ConvertOptions, Job } from '../../src/core/types.js'
import { soundEngine, videoEngine } from '../../src/engines/media.js'
import { probe } from '../../src/engines/registry.js'
import type { Engine } from '../../src/engines/types.js'
import { makeCorruptFile, makeJpeg, makeTempDir } from '../helpers/fixtures.js'

const options: ConvertOptions = { background: '#ffffff', keepMetadata: false }

async function planFor(dir: string, count: number): Promise<Job[]> {
  for (let i = 0; i < count; i++) await makeJpeg(dir, `f${i}.jpg`)
  const resolved = await resolveInputs([dir], { recursive: false })
  const plan = await buildPlan({ resolved, target: 'webp', options, force: false })
  return plan.jobs
}

describe('runJobs', () => {
  it('converts every job and totals the byte counts', async () => {
    const dir = await makeTempDir()
    const summary = await runJobs(await planFor(dir, 5), {})
    expect(summary.results).toHaveLength(5)
    expect(summary.failures).toHaveLength(0)
    expect(summary.inputBytes).toBeGreaterThan(0)
    expect(summary.outputBytes).toBeGreaterThan(0)
  })

  it('emits real progress events, one done per job, ending with batch:done', async () => {
    const dir = await makeTempDir()
    const jobs = await planFor(dir, 4)
    const events: RunEvent[] = []
    await runJobs(jobs, { onEvent: (e) => events.push(e) })

    expect(events.filter((e) => e.type === 'job:start')).toHaveLength(4)
    expect(events.filter((e) => e.type === 'job:done')).toHaveLength(4)
    expect(events.at(-1)?.type).toBe('batch:done')
  })

  it('never exceeds the concurrency limit', async () => {
    const dir = await makeTempDir()
    const jobs = await planFor(dir, 12)
    let live = 0
    let peak = 0
    await runJobs(jobs, {
      concurrency: 3,
      onEvent: (e) => {
        if (e.type === 'job:start') peak = Math.max(peak, ++live)
        if (e.type === 'job:done' || e.type === 'job:error') live--
      },
    })
    expect(peak).toBeLessThanOrEqual(3)
  })

  it('keeps going after one job fails and reports it', async () => {
    const dir = await makeTempDir()
    const jobs = await planFor(dir, 3)
    const bad = await makeCorruptFile(dir, 'bad.bin')
    const template = jobs[0]
    if (!template) throw new Error('planFor(dir, 3) produced no jobs')
    if (template.op !== 'convert') throw new Error('planFor produced a non-convert job')
    const broken: Job = {
      ...template,
      sources: [{ ...template.sources[0], path: bad }],
      outputs: [join(dir, 'bad.webp')],
    }

    const summary = await runJobs([...jobs, broken], {})
    expect(summary.results).toHaveLength(3)
    expect(summary.failures).toHaveLength(1)
    expect(summary.failures[0]?.error.code).toBe('conversion-failed')
  })

  it('never lets a non-finite concurrency value yield zero workers', async () => {
    const dir = await makeTempDir()
    const jobs = await planFor(dir, 3)
    const summary = await runJobs(jobs, { concurrency: Number.NaN })
    expect(summary.results).toHaveLength(3)
  })

  it('emits job:error, not just a silent failure, when no engine can write the target', async () => {
    const dir = await makeTempDir()
    const jpg = await makeJpeg(dir, 'a.jpg')
    const source = await probe(jpg)
    // heic is readable but no engine writes it — engineForJob returns
    // undefined, exercising the run loop's no-engine branch directly.
    const job: Job = {
      op: 'convert',
      sources: [source],
      outputs: [join(dir, 'a.heic')],
      target: 'heic',
      options,
    }

    const events: RunEvent[] = []
    const summary = await runJobs([job], { onEvent: (e) => events.push(e) })

    expect(summary.failures).toHaveLength(1)
    expect(events.filter((e) => e.type === 'job:error')).toHaveLength(1)
    expect(events.at(-1)?.type).toBe('batch:done')
  })

  it('reports results in job order, not completion order', async () => {
    const dir = await makeTempDir()
    const jobs = await planFor(dir, 3)
    // The first job finishes last, the last first.
    const delays = [30, 15, 0]
    const summary = await runJobs(jobs, {
      concurrency: 3,
      engineFor: () =>
        ({
          id: 'stub',
          reads: new Set(),
          writes: new Set(),
          run: async (job: Job) => {
            await new Promise((r) => setTimeout(r, delays[jobs.indexOf(job)]))
            return { job, outputBytes: 1, warnings: [] }
          },
        }) as never,
    })
    expect(summary.results.map((r) => r.job)).toEqual(jobs)
  })

  /**
   * ffmpeg's x264 already uses every core, so a second encode beside it only
   * contends. Pictures keep their pool around it; the limit still counts it.
   */
  it('runs jobs of an engine marked alone one at a time, beside the others', async () => {
    const dir = await makeTempDir()
    const jobs = await planFor(dir, 8)
    let live = 0
    let peak = 0
    let liveAlone = 0
    let peakAlone = 0
    let peakPlain = 0
    let livePlain = 0
    const stub = (alone: boolean): Engine =>
      ({
        id: alone ? 'alone' : 'plain',
        reads: new Set(),
        writes: new Set(),
        ops: new Set(['convert']),
        ...(alone ? { alone: true } : {}),
        run: async (job: Job) => {
          peak = Math.max(peak, ++live)
          if (alone) peakAlone = Math.max(peakAlone, ++liveAlone)
          else peakPlain = Math.max(peakPlain, ++livePlain)
          await new Promise((r) => setTimeout(r, 10))
          live--
          if (alone) liveAlone--
          else livePlain--
          return { job, outputBytes: 1, warnings: [] }
        },
      }) as never
    const alone = stub(true)
    const plain = stub(false)
    const completed: number[] = []
    const summary = await runJobs(jobs, {
      concurrency: 4,
      engineFor: (job) => (jobs.indexOf(job) % 2 === 0 ? alone : plain),
      onEvent: (e) => {
        if (e.type === 'job:done') completed.push(e.completed)
      },
    })
    expect(peakAlone).toBe(1)
    expect(peakPlain).toBeGreaterThan(1)
    expect(peak).toBeLessThanOrEqual(4)
    expect(completed).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
    expect(summary.results.map((r) => r.job)).toEqual(jobs)
  })

  it('marks the video and sound engines alone', () => {
    expect(videoEngine.alone).toBe(true)
    expect(soundEngine.alone).toBe(true)
  })

  it('returns an empty summary for no jobs', async () => {
    const summary = await runJobs([], {})
    expect(summary.results).toEqual([])
    expect(summary.outputBytes).toBe(0)
  })
})

describe('pool', () => {
  it('runs at most `limit` tasks at once and every item exactly once', async () => {
    let inFlight = 0
    let peak = 0
    const seen: number[] = []
    await pool([0, 1, 2, 3, 4, 5, 6, 7], 3, async (item) => {
      inFlight += 1
      peak = Math.max(peak, inFlight)
      await new Promise((r) => setTimeout(r, 5))
      seen.push(item)
      inFlight -= 1
    })
    expect(peak).toBe(3)
    expect([...seen].sort()).toEqual([0, 1, 2, 3, 4, 5, 6, 7])
  })

  it('still runs every item when the limit is not a finite number', async () => {
    const seen: number[] = []
    await pool([0, 1, 2], Number.NaN, async (item) => {
      seen.push(item)
    })
    expect(seen.sort()).toEqual([0, 1, 2])
  })

  it('runs the items marked alone one at a time, and the rest around them', async () => {
    let inFlight = 0
    let peak = 0
    let alone = 0
    let peakAlone = 0
    const seen: number[] = []
    const isAlone = (item: number) => item < 4
    await pool(
      [0, 1, 2, 3, 4, 5, 6, 7],
      3,
      async (item) => {
        peak = Math.max(peak, ++inFlight)
        if (isAlone(item)) peakAlone = Math.max(peakAlone, ++alone)
        await new Promise((r) => setTimeout(r, 5))
        seen.push(item)
        inFlight -= 1
        if (isAlone(item)) alone -= 1
      },
      isAlone,
    )
    expect(peakAlone).toBe(1)
    // Held-back items do not hold a worker: the rest still fill the pool.
    expect(peak).toBe(3)
    expect([...seen].sort()).toEqual([0, 1, 2, 3, 4, 5, 6, 7])
  })

  it('does nothing for no items', async () => {
    let calls = 0
    await pool([], 4, async () => {
      calls += 1
    })
    expect(calls).toBe(0)
  })
})

describe('resolveConcurrency', () => {
  it('never collapses to zero workers', () => {
    expect(resolveConcurrency(Number.NaN)).toBeGreaterThanOrEqual(1)
    expect(resolveConcurrency(0)).toBe(1)
    expect(resolveConcurrency(Number.POSITIVE_INFINITY)).toBeGreaterThanOrEqual(1)
    expect(resolveConcurrency(3)).toBe(3)
  })
})
