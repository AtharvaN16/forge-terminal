import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildPlan } from '../../src/core/plan.js'
import { resolveInputs } from '../../src/core/resolve.js'
import { type RunEvent, runJobs } from '../../src/core/run.js'
import type { ConvertOptions, Job } from '../../src/core/types.js'
import { probe } from '../../src/engines/registry.js'
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

  it('returns an empty summary for no jobs', async () => {
    const summary = await runJobs([], {})
    expect(summary.results).toEqual([])
    expect(summary.outputBytes).toBe(0)
  })
})
