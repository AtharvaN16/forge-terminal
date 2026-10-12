// tests/core/atomic.test.ts
//
// Isolated in its own file because it mocks node:fs/promises at module scope
// — mixing that with the real filesystem calls the rest of the suite relies
// on would risk cross-test contamination within one file. Mirrors
// tests/engines/write-atomic-cleanup.test.ts, which covers image.ts's
// pipeline-taking sibling.
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { makeTempDir } from '../helpers/fixtures.js'

const { rename, rm, writeFile } = vi.hoisted(() => ({
  rename: vi.fn(),
  rm: vi.fn(),
  writeFile: vi.fn(),
}))

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return { ...actual, rename, rm, writeFile }
})

describe('core writeAtomic', () => {
  it('writes bytes to the target path via a temp file, then rename', async () => {
    const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')
    rename.mockImplementation(actual.rename)
    rm.mockImplementation(actual.rm)
    writeFile.mockImplementation(actual.writeFile)
    const { writeAtomic } = await import('../../src/core/atomic.js')

    const dir = await makeTempDir()
    const out = join(dir, 'a.bin')
    const bytes = new Uint8Array([1, 2, 3, 4])

    const written = await writeAtomic(out, bytes)

    expect(written).toBe(4)
    expect(await readFile(out)).toEqual(Buffer.from(bytes))
  })

  it('surfaces the original write error even when temp-file cleanup itself fails', async () => {
    writeFile.mockRejectedValue(Object.assign(new Error('ENOSPC: no space left on device'), {}))
    rm.mockRejectedValue(
      Object.assign(new Error('permission denied on cleanup'), { code: 'EACCES' }),
    )
    const { writeAtomic } = await import('../../src/core/atomic.js')

    const dir = await makeTempDir()
    const out = join(dir, 'a.bin')

    const error = await writeAtomic(out, new Uint8Array([1])).catch((e: unknown) => e)
    expect(String(error)).toContain('ENOSPC')
    // The failed rm() must never replace the real cause with its own error.
    expect(String(error)).not.toContain('permission denied on cleanup')
  })
})

describe('renameAtomic', () => {
  const busy = () => Object.assign(new Error('EBUSY: resource busy or locked'), { code: 'EBUSY' })
  const noWait = () => vi.fn(async (_ms: number) => {})

  it('on win32 retries a transient EBUSY with backoff until it succeeds', async () => {
    rename.mockReset()
    rename
      .mockRejectedValueOnce(busy())
      .mockRejectedValueOnce(busy())
      .mockResolvedValueOnce(undefined)
    const wait = noWait()
    const { renameAtomic } = await import('../../src/core/atomic.js')

    await renameAtomic('a', 'b', 'win32', wait)

    expect(rename).toHaveBeenCalledTimes(3)
    expect(wait.mock.calls.map((c) => c[0])).toEqual([50, 100])
  })

  it('on win32 gives up after five attempts with the last error', async () => {
    rename.mockReset()
    rename.mockRejectedValue(busy())
    const wait = noWait()
    const { renameAtomic } = await import('../../src/core/atomic.js')

    await expect(renameAtomic('a', 'b', 'win32', wait)).rejects.toThrow('EBUSY')

    expect(rename).toHaveBeenCalledTimes(5)
    expect(wait.mock.calls.map((c) => c[0])).toEqual([50, 100, 200, 400])
  })

  it('on win32 does not retry an error that is not transient', async () => {
    rename.mockReset()
    rename.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }))
    const { renameAtomic } = await import('../../src/core/atomic.js')

    await expect(renameAtomic('a', 'b', 'win32', noWait())).rejects.toThrow('ENOENT')

    expect(rename).toHaveBeenCalledTimes(1)
  })

  it('on darwin never retries, even for EBUSY', async () => {
    rename.mockReset()
    rename.mockRejectedValue(busy())
    const wait = noWait()
    const { renameAtomic } = await import('../../src/core/atomic.js')

    await expect(renameAtomic('a', 'b', 'darwin', wait)).rejects.toThrow('EBUSY')

    expect(rename).toHaveBeenCalledTimes(1)
    expect(wait).not.toHaveBeenCalled()
  })
})
