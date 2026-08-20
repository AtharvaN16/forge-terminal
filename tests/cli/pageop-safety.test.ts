import { existsSync } from 'node:fs'
import { basename, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseArgs } from '../../src/cli/args.js'
import { execute } from '../../src/cli/execute.js'
import { makePdf, makeTempDir, pdfPageCount } from '../helpers/fixtures.js'

describe('page-op write safety, end to end', () => {
  it('refuses to merge its own previous output back into itself on a second run', async () => {
    const dir = await makeTempDir()
    await makePdf(dir, 'a.pdf', 2)
    await makePdf(dir, 'b.pdf', 3)
    const mergedPath = join(dir, `${basename(dir)}-merged.pdf`)

    const first = await execute(parseArgs([join(dir, '*.pdf'), '--merge']))
    expect(first.exitCode).toBe(0)
    expect(await pdfPageCount(mergedPath)).toBe(5)

    // The glob now also matches run 1's own output.
    const second = await execute(parseArgs([join(dir, '*.pdf'), '--merge']))
    expect(second.exitCode).toBe(1)
    expect(second.stderr.join('\n')).toContain(basename(mergedPath))

    // Refused, not silently doubled — still 5 pages, not 10.
    expect(await pdfPageCount(mergedPath)).toBe(5)
  })

  it('lets --force merge the previous output into itself, since that is what --force is for', async () => {
    const dir = await makeTempDir()
    await makePdf(dir, 'a.pdf', 2)
    await makePdf(dir, 'b.pdf', 3)
    const mergedPath = join(dir, `${basename(dir)}-merged.pdf`)

    expect((await execute(parseArgs([join(dir, '*.pdf'), '--merge']))).exitCode).toBe(0)
    expect(await pdfPageCount(mergedPath)).toBe(5)

    const forced = await execute(parseArgs([join(dir, '*.pdf'), '--merge', '--force']))
    expect(forced.exitCode).toBe(0)
    // a.pdf(2) + b.pdf(3) + the previous merged.pdf(5) = 10.
    expect(await pdfPageCount(mergedPath)).toBe(10)
  })

  it('refuses to replace its own previous rotate output without --force, then allows it with --force', async () => {
    const dir = await makeTempDir()
    const a = await makePdf(dir, 'a.pdf', 2)
    const rotated = join(dir, 'a-rotated.pdf')

    const first = await execute(parseArgs([a, '--rotate', '90']))
    expect(first.exitCode).toBe(0)
    expect(existsSync(rotated)).toBe(true)

    const second = await execute(parseArgs([a, '--rotate', '90']))
    expect(second.exitCode).toBe(1)
    expect(second.stderr.join('\n')).toContain('a-rotated.pdf')

    const third = await execute(parseArgs([a, '--rotate', '90', '--force']))
    expect(third.exitCode).toBe(0)
  })

  it('refuses a split whose output would replace its own source', async () => {
    const dir = await makeTempDir()
    // A single-page source named so its one split output — "-1" appended —
    // collides with an existing file already sitting at that exact name.
    const a = await makePdf(dir, 'a.pdf', 2)
    const collidingOutput = join(dir, 'a-1.pdf')
    await makePdf(dir, 'a-1.pdf', 1)

    const result = await execute(parseArgs([a, '--split', 'at=1']))
    expect(result.exitCode).toBe(1)
    expect(result.stderr.join('\n')).toContain(basename(collidingOutput))
    // Refused before writing: the pre-existing file is untouched.
    expect(await pdfPageCount(collidingOutput)).toBe(1)
  })
})
