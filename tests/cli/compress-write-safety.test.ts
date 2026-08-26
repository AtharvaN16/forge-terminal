import { stat } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseArgs } from '../../src/cli/args.js'
import { execute } from '../../src/cli/execute.js'
import { makeScannedPdf, makeTempDir } from '../helpers/fixtures.js'

const run = (argv: string[]) => execute(parseArgs(['node', 'forge', ...argv]))

/**
 * The compress path never called `checkWriteSafety`. Every other path did —
 * `buildPlan` for conversions, `execute.ts` directly for page operations, the
 * shell for its PDF flow — so compressing twice silently replaced the first
 * output while `forge convert` would have refused.
 */
describe('compress write safety', () => {
  it('refuses to replace an existing output without --force', async () => {
    const dir = await makeTempDir()
    const src = await makeScannedPdf(dir, 'scan.pdf', { pages: 3 })

    const first = await run([src, '--quality', '40'])
    expect(first.exitCode).toBe(0)
    const written = (await stat(join(dir, 'scan-small.pdf'))).size

    const second = await run([src, '--quality', '20'])

    expect(second.exitCode).toBe(1)
    expect(second.stderr.join(' ')).toMatch(/exists/i)
    // Untouched: a refusal must not have written anything.
    expect((await stat(join(dir, 'scan-small.pdf'))).size).toBe(written)
  })

  it('replaces it when --force is passed', async () => {
    const dir = await makeTempDir()
    const src = await makeScannedPdf(dir, 'scan.pdf', { pages: 3 })

    expect((await run([src, '--quality', '60'])).exitCode).toBe(0)
    const before = (await stat(join(dir, 'scan-small.pdf'))).size

    const forced = await run([src, '--quality', '5', '--force'])

    expect(forced.exitCode).toBe(0)
    expect((await stat(join(dir, 'scan-small.pdf'))).size).toBeLessThan(before)
  })
})
