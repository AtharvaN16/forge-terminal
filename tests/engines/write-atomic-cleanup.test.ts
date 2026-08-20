// tests/engines/write-atomic-cleanup.test.ts
//
// Isolated in its own file because it mocks node:fs/promises at module scope
// — mixing that with the real filesystem calls the rest of the convert suite
// relies on would risk cross-test contamination within one file.
import { describe, expect, it, vi } from 'vitest'
import type { ForgeError } from '../../src/core/errors.js'
import { isForgeError } from '../../src/core/errors.js'
import type { Job } from '../../src/core/types.js'
import { makeCorruptFile, makeJpeg, makeTempDir } from '../helpers/fixtures.js'

const { rm } = vi.hoisted(() => ({ rm: vi.fn() }))

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return { ...actual, rm }
})

describe('writeAtomic cleanup', () => {
  it('surfaces the original encode error even when temp-file cleanup itself fails', async () => {
    rm.mockRejectedValue(
      Object.assign(new Error('permission denied on cleanup'), { code: 'EACCES' }),
    )

    const { imageEngine } = await import('../../src/engines/image.js')
    const { probe } = await import('../../src/engines/registry.js')

    const dir = await makeTempDir()
    const good = await makeJpeg(dir, 'good.jpg')
    const source = await probe(good)
    const bad = await makeCorruptFile(dir, 'bad.bin')

    const doomed: Job = {
      op: 'convert',
      sources: [{ ...source, path: bad }],
      outputs: [`${dir}/out.webp`],
      target: 'webp',
      options: { background: '#ffffff', keepMetadata: false },
    }

    const error = await imageEngine.run(doomed, () => {}).catch((e: unknown) => e)
    expect(isForgeError(error)).toBe(true)
    // The failed rm() must never replace the real cause with its own error.
    const cause = (error as ForgeError).cause
    expect(String(cause)).not.toContain('permission denied on cleanup')
  })
})
