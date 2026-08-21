import { stat } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseArgs } from '../../src/cli/args.js'
import { execute } from '../../src/cli/execute.js'
import { makePdf, makeScannedPdf, makeTempDir } from '../helpers/fixtures.js'

const run = (argv: string[]) => execute(parseArgs(['node', 'forge', ...argv]))

describe('compressing a PDF from the command line', () => {
  it('shrinks a scan by quality', async () => {
    const dir = await makeTempDir()
    const src = await makeScannedPdf(dir, 'scan.pdf', { pages: 4 })
    const before = (await stat(src)).size

    const result = await run([src, '--quality', '35'])
    expect(result.exitCode).toBe(0)

    const after = (await stat(join(dir, 'scan-small.pdf'))).size
    expect(after).toBeLessThan(before * 0.6)
  })

  it('hits a target size, which is the whole point of an upload limit', async () => {
    // The reported use case: a portal that refuses anything over a limit.
    // Quality mode makes you guess; this has to actually land under it.
    const dir = await makeTempDir()
    const src = await makeScannedPdf(dir, 'scan.pdf', { pages: 6 })
    const limit = 120_000

    const result = await run([src, '--max-size', '120kb'])
    expect(result.exitCode).toBe(0)

    const after = (await stat(join(dir, 'scan-small.pdf'))).size
    expect(after).toBeLessThanOrEqual(limit)
    // And not absurdly under it — a search that just slammed to quality 1
    // would "succeed" while throwing away far more than asked.
    expect(after).toBeGreaterThan(limit * 0.25)
  })

  it('refuses a text-only PDF instead of writing a pointless copy', async () => {
    const dir = await makeTempDir()
    const src = await makePdf(dir, 'text.pdf', 5)
    const result = await run([src, '--quality', '40'])
    expect(result.exitCode).not.toBe(0)
    expect(result.stderr.join(' ')).toMatch(/compress/i)
  })
})
