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

describe('reaching a size that quality alone cannot', () => {
  it('drops resolution further rather than giving up', async () => {
    // A 300 dpi scan against a target far below what re-encoding reaches at
    // the 150 dpi default. The user named a number; getting there is what it
    // costs, and refusing would send them to a website that would have done
    // exactly this.
    const dir = await makeTempDir()
    const src = await makeScannedPdf(dir, 'scan.pdf', { dpi: 300, pages: 5 })
    const limit = 40_000

    const result = await run([src, '--max-size', '40kb'])
    expect(result.exitCode).toBe(0)

    const after = (await stat(join(dir, 'scan-small.pdf'))).size
    expect(after).toBeLessThanOrEqual(limit)
    // A two-dimensional search on a 5-page 300 dpi scan: up to four
    // resolution rungs, each a full quality bisection. About 5s alone, more
    // when the suite is loaded, so the default 20s ceiling is not enough.
  }, 60_000)

  it('still refuses when even the lowest settings cannot reach the target', async () => {
    // Honesty at the floor: a target nothing can reach must fail, not write
    // something over the limit and call it done.
    const dir = await makeTempDir()
    const src = await makeScannedPdf(dir, 'scan.pdf', { dpi: 300, pages: 5 })
    const result = await run([src, '--max-size', '1kb'])
    expect(result.exitCode).not.toBe(0)
  }, 60_000)
})

describe('--dpi on a compression', () => {
  it('is carried through when typed, so a scan can keep its resolution', () => {
    const intent = parseArgs(['node', 'forge', 'scan.pdf', '--quality', '40', '--dpi', '300'])
    expect(intent.kind).toBe('compress')
    if (intent.kind !== 'compress') return
    expect(intent.dpi).toBe(300)
  })

  it('is absent when not typed, so the engine default applies', () => {
    // Commander defaults --dpi to 150 for conversions, so this asserts the
    // parse can tell a real 150 from a fallback. Reading process.argv here
    // instead would pass in the shipped CLI and silently fail under test.
    const intent = parseArgs(['node', 'forge', 'scan.pdf', '--quality', '40'])
    if (intent.kind !== 'compress') return
    expect(intent.dpi).toBeUndefined()
  })

  it('rejects a resolution outside the usable range', () => {
    expect(() =>
      parseArgs(['node', 'forge', 'scan.pdf', '--quality', '40', '--dpi', '9']),
    ).toThrow()
  })
})

describe('--dpi is honoured in both modes, not just one', () => {
  it('keeps resolution in quality mode when asked', async () => {
    // Found by running the binary: --dpi was wired into the target-size
    // search and nowhere else, so quality mode silently used the 150 default
    // and produced a byte-identical file whatever was passed. The same seam
    // shape as --background and --quality before it.
    const dir = await makeTempDir()
    const src = await makeScannedPdf(dir, 'scan.pdf', { dpi: 300, pages: 2 })

    await run([src, '--quality', '50', '--dpi', '300'])
    const kept = (await stat(join(dir, 'scan-small.pdf'))).size

    await run([src, '--quality', '50', '--force'])
    const defaulted = (await stat(join(dir, 'scan-small.pdf'))).size

    // Keeping 300 dpi must produce a materially larger file than dropping
    // to 150. Equal sizes mean the flag did nothing.
    expect(kept).toBeGreaterThan(defaulted * 1.5)
  })
})

describe('the search reports where it has got to', () => {
  it('names the resolution and a real attempt index, never a percentage', async () => {
    // Invariant 7: the search cannot know which resolution rung will succeed,
    // so a percentage would be invented. Its position inside the current rung
    // is real and bounded, and that is what it reports.
    const dir = await makeTempDir()
    const src = await makeScannedPdf(dir, 'scan.pdf', { dpi: 300, pages: 2 })
    const seen: string[] = []

    await execute(parseArgs(['node', 'forge', src, '--max-size', '80kb']), {
      onSearch: (status) => seen.push(status),
    })

    expect(seen.length).toBeGreaterThan(0)
    expect(seen[0]).toMatch(/^\d+ dpi · attempt \d+ of \d+$/)
    // No invented progress anywhere in it.
    expect(seen.join(' ')).not.toMatch(/%/)
    // The attempt index stays inside the bound it declares.
    for (const line of seen) {
      const [, n, of] = line.match(/attempt (\d+) of (\d+)/) ?? []
      expect(Number(n)).toBeLessThanOrEqual(Number(of))
    }
  }, 60_000)

  it('says nothing when there is no search to report', async () => {
    // Quality mode encodes once. A spinner there would flash for no reason.
    const dir = await makeTempDir()
    const src = await makeScannedPdf(dir, 'scan.pdf', { pages: 2 })
    const seen: string[] = []
    await execute(parseArgs(['node', 'forge', src, '--quality', '50']), {
      onSearch: (status) => seen.push(status),
    })
    expect(seen).toEqual([])
  })
})
