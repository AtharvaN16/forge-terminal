import { randomBytes } from 'node:crypto'
import { constants } from 'node:fs'
import { access, mkdir, rename, rm, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { classifyWriteError, outputInvalid, outputPermissionDenied } from './errors.js'

/**
 * Makes sure the folder `output` will be written into exists and is writable,
 * and says which it is when it is not.
 *
 * The writability check is what catches a read-only destination. `mkdir -p`
 * succeeds on a folder that already exists, and Sharp's own write error
 * carries no errno — only "system error: Permission denied" in its message —
 * so without this a locked folder surfaced as a generic "Conversion failed".
 * Inputs have always been checked the same way (`engines/image.ts`, spec
 * §11); this is the output side. Shared by both atomic writers below and in
 * `engines/image.ts`, so every engine reports it the same way.
 */
export async function prepareOutputDir(output: string): Promise<void> {
  const dir = dirname(output)
  try {
    await mkdir(dir, { recursive: true })
  } catch (cause) {
    const classified = classifyWriteError(output, cause)
    throw classified === cause ? outputInvalid(output, cause) : classified
  }
  try {
    await access(dir, constants.W_OK)
  } catch (cause) {
    throw outputPermissionDenied(output, cause)
  }
}

/** Windows holds a just-written file open for a moment (antivirus, the search indexer). */
const WINDOWS_RETRYABLE = new Set(['EPERM', 'EBUSY', 'EACCES'])
const WINDOWS_RENAME_ATTEMPTS = 5

/**
 * `rename`, made safe to call on Windows. There a freshly written temp file is
 * often still held by a scanner or indexer, so the rename fails transiently
 * with EPERM/EBUSY/EACCES; it succeeds a few tens of milliseconds later. Retry
 * only those, with a short backoff (50, 100, 200, 400 ms), then give up with
 * the last error. Everywhere else it is exactly `rename` — a failure there is
 * real and retrying would only hide it.
 */
export async function renameAtomic(
  from: string,
  to: string,
  platform: NodeJS.Platform = process.platform,
  wait: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
): Promise<void> {
  if (platform !== 'win32') {
    await rename(from, to)
    return
  }
  for (let attempt = 1; ; attempt++) {
    try {
      await rename(from, to)
      return
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code
      if (attempt >= WINDOWS_RENAME_ATTEMPTS || !code || !WINDOWS_RETRYABLE.has(code)) throw e
      await wait(50 * 2 ** (attempt - 1))
    }
  }
}

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
  await prepareOutputDir(path)

  const temp = `${path}.${randomBytes(6).toString('hex')}.tmp`
  try {
    await writeFile(temp, bytes)
    await renameAtomic(temp, path)
    return bytes.byteLength
  } catch (e) {
    // `force` only swallows ENOENT. A cleanup failure (EACCES, EBUSY, ...)
    // must never replace the real error that is about to be thrown.
    await rm(temp, { force: true }).catch(() => {})
    throw classifyWriteError(path, e)
  }
}
