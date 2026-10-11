import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseArgs } from '../../src/cli/args.js'
import { execute } from '../../src/cli/execute.js'
import { makeNoisyOrientedJpeg, makeTempDir } from '../helpers/fixtures.js'

describe('parallel searches do not share settings', () => {
  it('each file in a batch settles on the quality it would settle on alone', async () => {
    const dir = await makeTempDir()
    const batchDir = join(dir, 'batch')
    const { mkdir } = await import('node:fs/promises')
    await mkdir(batchDir)
    // Two sources that need different qualities under one limit: the big one
    // must drop well below 100, the small one fits at 100.
    const big = await makeNoisyOrientedJpeg(batchDir, 'big.jpg', 1, 400, 300)
    const small = await makeNoisyOrientedJpeg(batchDir, 'small.jpg', 1, 80, 80)
    const args = ['--to', 'webp', '--max-size', '15kb']

    const solo = async (source: string, name: string) => {
      const out = join(dir, name)
      const r = await execute(parseArgs([source, ...args, '-o', out]))
      expect(r.exitCode).toBe(0)
      return readFile(out)
    }
    const soloBig = await solo(big, 'solo-big.webp')
    const soloSmall = await solo(small, 'solo-small.webp')
    expect(soloBig.length).toBeLessThan(soloSmall.length * 4) // sanity: both fitted

    const outDir = join(dir, 'out')
    const r = await execute(parseArgs([batchDir, ...args, '-o', `${outDir}/`]))
    expect(r.exitCode).toBe(0)
    expect(await readFile(join(outDir, 'big.webp'))).toEqual(soloBig)
    expect(await readFile(join(outDir, 'small.webp'))).toEqual(soloSmall)
  })
})
