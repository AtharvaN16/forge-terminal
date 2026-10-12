import { rename } from 'node:fs/promises'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renameAtomic, WINDOWS_RENAME_ATTEMPTS_LONG } from '../../src/core/atomic.js'
import { moveIntoPlace } from '../../src/extensions/manager.js'
import { extractTar, unsafeArchivePath } from '../../src/extensions/tar.js'
import { makeTempDir } from '../helpers/fixtures.js'

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return { ...actual, rename: vi.fn(actual.rename) }
})

beforeEach(async () => {
  const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')
  vi.mocked(rename).mockReset()
  vi.mocked(rename).mockImplementation(actual.rename)
})

/** A one-entry ustar archive: just the fields extractTar reads. */
function tarOf(name: string, body = 'x'): Buffer {
  const header = Buffer.alloc(512)
  header.write(name, 0, 'utf8')
  header.write('0000644\0', 100, 'ascii')
  header.write(`${body.length.toString(8).padStart(11, '0')}\0`, 124, 'ascii')
  header.write('0', 156, 'ascii')
  const data = Buffer.alloc(512)
  data.write(body, 0, 'utf8')
  return Buffer.concat([header, data, Buffer.alloc(1024)])
}

describe('archive entry names', () => {
  it('refuses what Windows would read as a stream, a device or a different name', () => {
    for (const bad of [
      'a:b',
      'lib/evil.dll:zone',
      'NUL',
      'dir/con.txt',
      'LPT1.log',
      'x.',
      'dir /a',
    ]) {
      expect(unsafeArchivePath(bad), bad).toBe(true)
    }
    for (const good of ['./', 'manifest.json', 'lib/onnxruntime.1.23.2.dll', 'console.js']) {
      expect(unsafeArchivePath(good), good).toBe(false)
    }
  })

  it('stops extraction at such a name, on every platform', async () => {
    const dir = await makeTempDir()
    await expect(extractTar(tarOf('runner.mjs:hidden'), dir)).rejects.toThrow('unsafe path')
    await expect(extractTar(tarOf('NUL.txt'), dir)).rejects.toThrow('unsafe path')
    await extractTar(tarOf('lib/ok.txt'), dir)
  })
})

describe('moving an unpacked extension into place on Windows', () => {
  const busy = () => Object.assign(new Error('EBUSY'), { code: 'EBUSY' })

  it('allows about 4.5 s for a scanner to let go', async () => {
    vi.mocked(rename).mockRejectedValue(busy())
    const wait = vi.fn(async (_ms: number) => {})
    await expect(
      renameAtomic('a', 'b', 'win32', wait, WINDOWS_RENAME_ATTEMPTS_LONG),
    ).rejects.toThrow('EBUSY')
    expect(wait.mock.calls.map((c) => c[0])).toEqual([50, 100, 200, 400, 800, 1000, 1000, 1000])
  })

  it('reports a rename that still fails as an install failure', async () => {
    const dir = await makeTempDir()
    const err = await moveIntoPlace(dir, join(dir, 'missing', '1.0.0'), 'heic', 'win32').catch(
      (e: unknown) => e,
    )
    expect(err).toMatchObject({ code: 'extension-corrupt' })
  })

  it('on macOS leaves the error as it was', async () => {
    const dir = await makeTempDir()
    const err = await moveIntoPlace(dir, join(dir, 'missing', '1.0.0'), 'boost', 'darwin').catch(
      (e: unknown) => e,
    )
    expect(err).toMatchObject({ code: 'ENOENT' })
  })
})
