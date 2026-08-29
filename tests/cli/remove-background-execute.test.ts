import { writeFile } from 'node:fs/promises'
import { describe, expect, it, vi } from 'vitest'
import { parseArgs } from '../../src/cli/args.js'
import { execute } from '../../src/cli/execute.js'
import type { Job } from '../../src/core/types.js'
import type { Engine } from '../../src/engines/types.js'
import { makeJpeg, makePdf, makeTempDir } from '../helpers/fixtures.js'

function fakeEngine(run = vi.fn()): Engine {
  return {
    id: 'fake-background-removal',
    reads: new Set(),
    writes: new Set(),
    ops: new Set(['remove-background']),
    probe: async () => {
      throw new Error('not used')
    },
    run: async (job) => {
      run(job)
      await writeFile(job.outputs[0] ?? '', 'cutout')
      return { job, outputBytes: 6, warnings: [] }
    },
  }
}

const engineFor = (engine: Engine) => (job: Job) =>
  job.op === 'remove-background' ? engine : undefined

describe('execute --remove-background', () => {
  it('plans, runs and reports a default PNG cutout', async () => {
    const dir = await makeTempDir()
    const input = await makeJpeg(dir, 'product.jpg')
    const run = vi.fn()
    const result = await execute(parseArgs([input, '--remove-background']), {
      engineFor: engineFor(fakeEngine(run)),
    })

    expect(result.exitCode).toBe(0)
    expect(result.stdout.join('\n')).toContain('background removed')
    expect(result.stdout.join('\n')).toContain('product-no-bg.png')
    const job = run.mock.calls[0]?.[0] as Job | undefined
    expect(job?.op).toBe('remove-background')
    expect(job && 'target' in job ? job.target : undefined).toBe('png')
  })

  it('refuses a document without invoking the model engine', async () => {
    const dir = await makeTempDir()
    const input = await makePdf(dir, 'report.pdf')
    const run = vi.fn()
    const result = await execute(parseArgs([input, '--remove-background']), {
      engineFor: engineFor(fakeEngine(run)),
    })

    expect(result.exitCode).toBe(1)
    expect(result.stderr.join('\n')).toContain('needs an image')
    expect(run).not.toHaveBeenCalled()
  })

  it('refuses an opaque target before invoking the model engine', async () => {
    const dir = await makeTempDir()
    const input = await makeJpeg(dir, 'product.jpg')
    const run = vi.fn()
    const result = await execute(parseArgs([input, '--remove-background', '--to', 'jpeg']), {
      engineFor: engineFor(fakeEngine(run)),
    })

    expect(result.exitCode).toBe(1)
    expect(result.stderr.join('\n')).toContain('transparency')
    expect(run).not.toHaveBeenCalled()
  })

  it('reports a semantic batch result and real completion events', async () => {
    const dir = await makeTempDir()
    await makeJpeg(dir, 'one.jpg')
    await makeJpeg(dir, 'two.jpg')
    const events: Array<{ completed: number; total: number }> = []
    const result = await execute(parseArgs([dir, '--remove-background']), {
      engineFor: engineFor(fakeEngine()),
      onProgress: (progress) => events.push(progress),
    })

    expect(result.exitCode).toBe(0)
    expect(result.stdout.join('\n')).toContain('2 backgrounds removed')
    expect(events[0]).toEqual({ completed: 0, total: 2 })
    expect(events.at(-1)).toEqual({ completed: 2, total: 2 })
  })
})
