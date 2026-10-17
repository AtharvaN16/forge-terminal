import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { gather } from '../../src/menu/gather.js'

const dir = () => mkdtempSync(join(tmpdir(), 'forge-gather-'))
const fast = { quiet: 60, cap: 2000, poll: 10 }
const later = (ms: number) => new Promise((r) => setTimeout(r, ms))

describe('gather', () => {
  it('returns a lone file straight back once things are quiet', async () => {
    expect(await gather(dir(), 'sharpen', 'C:\\a.png', fast)).toEqual(['C:\\a.png'])
  })

  it('gives every file clicked at once to the first process, and nothing to the rest', async () => {
    const d = dir()
    const runs = await Promise.all([
      gather(d, 'sharpen', 'C:\\a.png', fast),
      gather(d, 'sharpen', 'C:\\b.png', fast),
      gather(d, 'sharpen', 'C:\\c.png', fast),
    ])
    const leaders = runs.filter((r) => r !== null)
    expect(leaders).toHaveLength(1)
    expect([...(leaders[0] ?? [])].sort()).toEqual(['C:\\a.png', 'C:\\b.png', 'C:\\c.png'])
  })

  it('waits for slow starters, as long as each lands before things go quiet', async () => {
    const d = dir()
    const runs = await Promise.all(
      ['a', 'b', 'c', 'd', 'e'].map(async (n, i) => {
        await later(i * 40) // each well inside the 60 ms quiet spell after the last
        return gather(d, 'sharpen', `C:\\${n}.png`, fast)
      }),
    )
    const leaders = runs.filter((r) => r !== null)
    expect(leaders).toHaveLength(1)
    expect(leaders[0]).toHaveLength(5)
  })

  it('stops waiting at the cap, however steadily files keep arriving', async () => {
    const d = dir()
    const started = Date.now()
    const runs = await Promise.all(
      Array.from({ length: 12 }, async (_, i) => {
        await later(i * 40)
        return gather(d, 'sharpen', `C:\\${i}.png`, { quiet: 60, cap: 200, poll: 10 })
      }),
    )
    expect(Date.now() - started).toBeLessThan(1500)
    // every file is run exactly once, by however many leaders it took
    const all = runs.flatMap((r) => r ?? [])
    expect(all.sort()).toEqual(Array.from({ length: 12 }, (_, i) => `C:\\${i}.png`).sort())
  })

  it('keeps different actions apart', async () => {
    const d = dir()
    const [a, b] = await Promise.all([
      gather(d, 'sharpen', 'C:\\a.png', fast),
      gather(d, 'convert', 'C:\\b.png', fast),
    ])
    expect([a, b]).toEqual([['C:\\a.png'], ['C:\\b.png']])
  })

  it('lets the next click start afresh once a run has taken its files', async () => {
    const d = dir()
    await gather(d, 'sharpen', 'C:\\a.png', fast)
    expect(await gather(d, 'sharpen', 'C:\\b.png', fast)).toEqual(['C:\\b.png'])
  })
})
