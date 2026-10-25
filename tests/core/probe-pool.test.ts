import { mkdir, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { corruptSource } from '../../src/core/errors.js'
import { scanFolder } from '../../src/core/folder.js'
import { resolveDirectory, resolveInputs } from '../../src/core/resolve.js'
import { defaultConcurrency } from '../../src/core/run.js'
import type { SourceInfo } from '../../src/core/types.js'
import { makeTempDir } from '../helpers/fixtures.js'

/**
 * Probing a HEIC or RAW on a Mac spawns `sips`, so a folder of them probed
 * one by one waits on each in turn. They are probed through the run pool
 * instead; what comes back, and in what order, must not change.
 *
 * The probe is a stand-in that finishes the earliest file last, so a result
 * slotted in completion order would show.
 */
const live = vi.hoisted(() => ({ now: 0, peak: 0 }))
vi.mock('../../src/engines/registry.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../src/engines/registry.js')>()
  return {
    ...real,
    probe: async (path: string): Promise<SourceInfo> => {
      live.peak = Math.max(live.peak, ++live.now)
      // Names are n.jpg: lower numbers wait longer.
      const n = Number(basename(path).split('.')[0]?.replace(/\D/g, '') || 0)
      await new Promise((r) => setTimeout(r, Math.max(0, 40 - n * 4)))
      live.now--
      if (basename(path).startsWith('bad')) throw corruptSource(path, undefined)
      if (basename(path).startsWith('odd')) throw new Error(`odd ${basename(path)}`)
      return {
        kind: 'image',
        path,
        format: 'jpeg',
        bytes: 1,
        width: 1,
        height: 1,
        hasAlpha: false,
        frames: 1,
      }
    },
  }
})

afterEach(() => {
  live.now = 0
  live.peak = 0
})

async function files(dir: string, names: string[]): Promise<string[]> {
  for (const name of names) await writeFile(join(dir, name), 'x')
  return names.map((n) => join(dir, n))
}

const named = (list: { path: string }[]) => list.map((s) => basename(s.path))

describe('probing several files', () => {
  it('resolveInputs probes several at once, in a bounded pool, keeping their order', async () => {
    const dir = await makeTempDir()
    const paths = await files(dir, ['1.jpg', '2.jpg', 'bad3.jpg', '4.jpg', '5.jpg', 'bad6.jpg'])
    const missing = join(dir, 'missing.jpg')
    const { sources, failures } = await resolveInputs(
      [paths[0], paths[1], paths[2], missing, paths[3], paths[4], paths[5]] as string[],
      { recursive: false },
    )
    expect(named(sources)).toEqual(['1.jpg', '2.jpg', '4.jpg', '5.jpg'])
    // Failures in input order, the missing file among them where it was named.
    expect(named(failures)).toEqual(['bad3.jpg', 'missing.jpg', 'bad6.jpg'])
    expect(live.peak).toBeGreaterThan(1)
    expect(live.peak).toBeLessThanOrEqual(defaultConcurrency())
  })

  it('resolveInputs keeps a directory scan in name order, and its roots', async () => {
    const dir = await makeTempDir()
    const sub = join(dir, 'in')
    await mkdir(sub)
    await files(sub, ['1.jpg', '2.jpg', '3.jpg', '4.jpg', '5.jpg'])
    const { sources, roots } = await resolveInputs([sub], { recursive: false })
    expect(named(sources)).toEqual(['1.jpg', '2.jpg', '3.jpg', '4.jpg', '5.jpg'])
    expect([...roots.values()]).toEqual([sub, sub, sub, sub, sub])
    expect(live.peak).toBeGreaterThan(1)
  })

  it('resolveInputs still throws for a named file that fails oddly: the first one named', async () => {
    const dir = await makeTempDir()
    const paths = await files(dir, ['1.jpg', 'odd2.jpg', 'odd3.jpg'])
    await expect(resolveInputs(paths, { recursive: false })).rejects.toThrow('odd odd2.jpg')
  })

  it('resolveDirectory probes several at once, keeping name order', async () => {
    const dir = await makeTempDir()
    await files(dir, ['1.jpg', '2.jpg', 'bad3.jpg', '4.jpg', '5.jpg'])
    const { sources, failures } = await resolveDirectory(dir, { recursive: false })
    expect(named(sources)).toEqual(['1.jpg', '2.jpg', '4.jpg', '5.jpg'])
    expect(named(failures)).toEqual(['bad3.jpg'])
    expect(live.peak).toBeGreaterThan(1)
    expect(live.peak).toBeLessThanOrEqual(defaultConcurrency())
  })

  it('scanFolder probes several at once, keeping name order', async () => {
    const dir = await makeTempDir()
    await files(dir, ['1.jpg', '2.jpg', 'bad3.jpg', '4.jpg', '5.jpg', '6.jpg'])
    const scan = await scanFolder(dir)
    expect(named(scan.sources)).toEqual(['1.jpg', '2.jpg', '4.jpg', '5.jpg', '6.jpg'])
    expect(named(scan.failures)).toEqual(['bad3.jpg'])
    // The scan's own order (localeCompare), whatever order the probes end in.
    expect(scan.paths.map((p) => basename(p))).toEqual([
      '1.jpg',
      '2.jpg',
      '4.jpg',
      '5.jpg',
      '6.jpg',
      'bad3.jpg',
    ])
    expect(live.peak).toBeGreaterThan(1)
    expect(live.peak).toBeLessThanOrEqual(defaultConcurrency())
  })
})
