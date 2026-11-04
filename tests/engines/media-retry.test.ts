// tests/engines/media-retry.test.ts
//
// Its own file because it mocks node:fs/promises' `stat` at module scope, to
// make the first two-pass encode look like a near miss: the engine then aims
// lower and encodes again, which a real clip will not reliably trigger.
import { basename, join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { ConvertOptions, Job, MediaInfo } from '../../src/core/types.js'
import { videoEngine } from '../../src/engines/media.js'
import { makeTempDir } from '../helpers/fixtures.js'
import { ffmpegHere, makeClip } from '../helpers/media.js'

const { missOnce } = vi.hoisted(() => ({ missOnce: { armed: false } }))

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...actual,
    stat: async (...args: Parameters<typeof actual.stat>) => {
      const s = await actual.stat(...args)
      // The first look at the encode's temp file says it came out too big.
      if (missOnce.armed && basename(String(args[0])).startsWith('.forge-')) {
        missOnce.armed = false
        return Object.assign(Object.create(Object.getPrototypeOf(s)), s, { size: 1e12 })
      }
      return s
    },
  }
})

const options = (over: Partial<ConvertOptions> = {}): ConvertOptions => ({
  background: '#ffffff',
  keepMetadata: false,
  ...over,
})

describe.skipIf(!ffmpegHere)('a size missed by a near margin', () => {
  it('counts the passes of the retry on from the first try’s, not from 1 again', async () => {
    const clip = await makeClip({ seconds: 2, width: 320, height: 240 })
    const source = (await videoEngine.probe(clip)) as MediaInfo
    const out = join(await makeTempDir(), 'out.mov')
    const j: Job = {
      op: 'convert',
      sources: [source],
      outputs: [out],
      target: 'mov',
      options: options({ compress: { dither: false }, media: { targetBytes: 200_000 } }),
    }
    const seen: string[] = []
    missOnce.armed = true
    await videoEngine.run(j, (p) => {
      if (p.phase !== 'time' || !p.pass) return
      const label = `${p.pass.at} of ${p.pass.of}`
      if (seen.at(-1) !== label) seen.push(label)
    })
    expect(seen).toEqual(['1 of 2', '2 of 2', '3 of 4', '4 of 4'])
  })
})
