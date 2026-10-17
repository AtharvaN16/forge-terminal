import { join } from 'node:path'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { runPlan } from '../../src/core/execute-jobs.js'
import type { Job, MediaInfo } from '../../src/core/types.js'
import type { Engine } from '../../src/engines/types.js'
import { makeTempDir } from '../helpers/fixtures.js'

let dir: string
beforeAll(async () => {
  dir = await makeTempDir()
})

const MB = 1_000_000
const recording: MediaInfo = {
  kind: 'media',
  path: '/rec/rec.mov',
  format: 'mov',
  bytes: 20 * MB,
  facts: {
    duration: 130,
    video: { codec: 'h264', width: 2940, height: 1912, fps: 60, rotation: 0, hdr: false },
    audio: { codec: 'aac', channels: 2, sampleRate: 48000 },
  },
}
let n = 0
const compress = (source: MediaInfo = recording): Job => ({
  op: 'convert',
  sources: [source],
  outputs: [join(dir, `out-${n++}.mov`)],
  target: 'mov',
  options: { background: '#ffffff', keepMetadata: false, compress: { dither: false } },
})
/** A media engine at the seam: its floor is arithmetic, so a stub says it. */
const engine = (floor: number): Engine => ({
  id: 'stub-video',
  reads: new Set(['mov']),
  writes: new Set(['mov']),
  ops: new Set<Job['op']>(['convert']),
  probe: vi.fn(),
  run: vi.fn(async (job: Job) => ({ job, outputBytes: 1, warnings: [] })),
  sizeTo: (_job, target) => (target < floor ? { floor } : undefined),
})

describe('runPlan, for a video size', () => {
  it('runs the encode at the size when it can be reached', async () => {
    const e = engine(2 * MB)
    const outcome = await runPlan([compress()], {
      force: true,
      targetBytes: 10 * MB,
      engineFor: () => e,
    })
    expect(outcome.results).toHaveLength(1)
    const ran = (e.run as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as Extract<
      Job,
      { op: 'convert' }
    >
    expect(ran.options.media?.targetBytes).toBe(10 * MB)
  })

  it('says how small it can get, under its floor, and runs nothing', async () => {
    const e = engine(2 * MB)
    const outcome = await runPlan([compress()], {
      force: true,
      targetBytes: 1 * MB,
      engineFor: () => e,
    })
    expect(outcome.unreachable[0]?.smallest).toBe(2 * MB)
    expect(e.run).not.toHaveBeenCalled()
  })

  it('writes nothing for a file already under the size', async () => {
    const e = engine(2 * MB)
    const outcome = await runPlan([compress()], {
      force: true,
      targetBytes: 25 * MB,
      engineFor: () => e,
    })
    expect(outcome.failures[0]?.error).toMatchObject({ code: 'cannot-compress-more' })
    expect(outcome.failures[0]?.error.message).toMatch(/already/)
    expect(e.run).not.toHaveBeenCalled()
  })

  it('says it cannot get smaller when even its floor is over the file', async () => {
    const e = engine(30 * MB)
    const outcome = await runPlan([compress()], {
      force: true,
      targetBytes: 5 * MB,
      engineFor: () => e,
    })
    expect(outcome.failures[0]?.error).toMatchObject({ code: 'cannot-compress-more' })
    expect(e.run).not.toHaveBeenCalled()
  })
})
