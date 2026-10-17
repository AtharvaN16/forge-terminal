import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseArgs } from '../../src/cli/args.js'
import { execute } from '../../src/cli/execute.js'
import { makeNoiseImage, makeTempDir } from '../helpers/fixtures.js'

const run = (argv: string[]) => execute(parseArgs(argv))

/**
 * The compress branch built its failure list from its own refusals and
 * `runPlan`'s outcome but never from `resolveInputs`' failures, so a missing
 * input vanished: `forge missing.jpg --quality 40` printed nothing and exited
 * 0. A conversion reports the same file as not found and exits 1.
 */
describe('compress with a missing input', () => {
  it('exits 1 and names the missing file, as a conversion does', async () => {
    const dir = await makeTempDir()
    const ghost = join(dir, 'ghost.jpg')

    const compressed = await run([ghost, '--quality', '40'])
    const converted = await run([ghost, '--to', 'webp'])

    expect(compressed.exitCode).toBe(1)
    expect(compressed.stderr.join('\n')).toContain('ghost.jpg')
    expect(compressed.stderr.join('\n')).toMatch(/not found/i)
    expect(compressed.stderr).toEqual(converted.stderr)
  })

  it('still compresses the files that do exist, and reports the one that does not', async () => {
    const dir = await makeTempDir()
    const real = await makeNoiseImage(dir, 'noisy.jpg', 64, 'jpeg')

    const out = await run([real, join(dir, 'ghost.jpg'), '--quality', '40'])

    expect(out.exitCode).toBe(1)
    expect(out.stdout.join('\n')).toContain('noisy-small.jpg')
    expect(out.stderr.join('\n')).toContain('ghost.jpg')
  })
})
