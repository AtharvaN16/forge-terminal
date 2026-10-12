import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { runExtension } from '../../src/extensions/run.js'
import { makeTempDir } from '../helpers/fixtures.js'

// The cross-process lock is not what this is about; each job just runs.
vi.mock('../../src/extensions/lock.js', () => ({
  withExtensionLock: (_id: string, fn: () => Promise<unknown>) => fn(),
}))

/** A node "extension" that answers after `ms`. */
async function slowRunner(ms: number): Promise<string> {
  const path = join(await makeTempDir(), 'runner.mjs')
  await writeFile(
    path,
    `setTimeout(() => console.log(JSON.stringify({ ok: true, width: 1, height: 1, ms: ${ms} })), ${ms})`,
  )
  return path
}

/** Which of a slow boost and a quick heic job, started in that order, finishes first. */
async function finishOrder(platform: NodeJS.Platform): Promise<string[]> {
  const order: string[] = []
  const boost = runExtension({ id: 'boost', entry: await slowRunner(800), kind: 'node' }, [], {
    platform,
  }).then(() => order.push('boost'))
  const heic = runExtension({ id: 'heic', entry: await slowRunner(0), kind: 'node' }, [], {
    platform,
  }).then(() => order.push('heic'))
  await Promise.all([boost, heic])
  return order
}

describe('extension jobs in one process', () => {
  it('on Windows queue per extension: a HEIC job does not wait behind a Boost', async () => {
    expect(await finishOrder('win32')).toEqual(['heic', 'boost'])
  })

  it('on macOS still run one at a time', async () => {
    expect(await finishOrder('darwin')).toEqual(['boost', 'heic'])
  })
})
