import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseArgs } from '../../src/cli/args.js'
import { execute } from '../../src/cli/execute.js'
import { makeNoisyOrientedJpeg, makeTempDir } from '../helpers/fixtures.js'

describe('a batch search reports per file', () => {
  it('counts finished files, since several searches run at once', async () => {
    const dir = await makeTempDir()
    for (const n of [1, 2, 3]) await makeNoisyOrientedJpeg(dir, `p${n}.jpg`)
    const seen: string[] = []
    const result = await execute(
      parseArgs([dir, '--max-size', '6kb', '-o', `${join(dir, 'out')}/`]),
      { onSearch: (status) => seen.push(status) },
    )
    expect(result.exitCode).toBe(0)
    // Interleaved per-attempt counters from three files would read as one
    // counter jumping around. A batch reports completed files instead.
    expect(seen).toEqual(['1 of 3 searched', '2 of 3 searched', '3 of 3 searched'])
  })
})
