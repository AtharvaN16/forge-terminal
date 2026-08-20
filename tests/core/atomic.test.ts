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

const { rm, writeFile } = vi.hoisted(() => ({ rm: vi.fn(), writeFile: vi.fn() }))

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return { ...actual, rm, writeFile }
})

describe('core writeAtomic', () => {
  it('writes bytes to the target path via a temp file, then rename', async () => {
    const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')
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
