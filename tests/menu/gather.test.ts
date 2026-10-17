import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { gather } from '../../src/menu/gather.js'

const dir = () => mkdtempSync(join(tmpdir(), 'forge-gather-'))

describe('gather', () => {
  it('returns a lone file straight back once the wait is over', async () => {
    expect(await gather(dir(), 'sharpen', 'C:\\a.png', 20)).toEqual(['C:\\a.png'])
  })

  it('gives every file clicked at once to the first process, and nothing to the rest', async () => {
    const d = dir()
    const runs = await Promise.all([
      gather(d, 'sharpen', 'C:\\a.png', 80),
      gather(d, 'sharpen', 'C:\\b.png', 80),
      gather(d, 'sharpen', 'C:\\c.png', 80),
    ])
    const leaders = runs.filter((r) => r !== null)
    expect(leaders).toHaveLength(1)
    expect([...(leaders[0] ?? [])].sort()).toEqual(['C:\\a.png', 'C:\\b.png', 'C:\\c.png'])
  })

  it('keeps different actions apart', async () => {
    const d = dir()
    const [a, b] = await Promise.all([
      gather(d, 'sharpen', 'C:\\a.png', 40),
      gather(d, 'convert', 'C:\\b.png', 40),
    ])
    expect([a, b]).toEqual([['C:\\a.png'], ['C:\\b.png']])
  })

  it('lets the next click start afresh once a run has taken its files', async () => {
    const d = dir()
    await gather(d, 'sharpen', 'C:\\a.png', 20)
    expect(await gather(d, 'sharpen', 'C:\\b.png', 20)).toEqual(['C:\\b.png'])
  })
})
