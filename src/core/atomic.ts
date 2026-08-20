import { randomBytes } from 'node:crypto'
import { mkdir, rename, rm, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { outputInvalid } from './errors.js'

/**
 * Invariant 6: temp file, then rename. Never a partial file at the real path.
 *
 * Shared by every engine that writes bytes it already holds in memory (as
 * opposed to `image.ts`'s Sharp-pipeline variant, which streams an encode
 * straight to the temp file and is a genuinely different function — see that
 * file's own `writeAtomic`).
 *
 * Cleanup must never mask the original error: if the write or rename fails
 * and the best-effort `rm` of the temp file then *also* fails (EACCES, EBUSY,
 * ...), the caller must still see the real cause, not the cleanup failure.
 */
export async function writeAtomic(path: string, bytes: Uint8Array): Promise<number> {
  const dir = dirname(path)
  try {
    await mkdir(dir, { recursive: true })
  } catch (cause) {
    throw outputInvalid(path, cause)
  }

  const temp = `${path}.${randomBytes(6).toString('hex')}.tmp`
  try {
    await writeFile(temp, bytes)
    await rename(temp, path)
    return bytes.byteLength
  } catch (e) {
    // `force` only swallows ENOENT. A cleanup failure (EACCES, EBUSY, ...)
    // must never replace the real error that is about to be thrown.
    await rm(temp, { force: true }).catch(() => {})
    throw e
  }
}
