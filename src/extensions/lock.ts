import { randomBytes } from 'node:crypto'
import { link, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { extensionBusy } from '../core/errors.js'
import { extensionsRoot } from './paths.js'

/**
 * Who is using an extension right now, across every forge process on this
 * Mac: one file per tool, `<extensionsRoot>/.locks/<id>.lock`, holding the
 * holder's pid and what it is doing. A job holds it while the model runs
 * (`runExtension`), and `removeExtension` holds it while it deletes, so a
 * model is never deleted under a running job and two forges never run the
 * same heavy tool at once.
 */
export interface LockHolder {
  pid: number
  /** What the holder is doing, as a sentence ("Boost resolution 4× is running on portrait.jpg"). */
  what?: string
}

interface LockFile extends LockHolder {
  token: string
  at: number
}

/** A lock older than this belongs to no job, whatever its pid says (a reused pid would otherwise block forever). */
const MAX_AGE_MS = 12 * 60 * 60 * 1000
/** How long a job waits for another forge to finish with the tool before it gives up. */
export const WAIT_MS = 10 * 60 * 1000
const POLL_MS = 200

function lockDir(): string {
  return join(extensionsRoot(), '.locks')
}

function lockPath(id: string): string {
  return join(lockDir(), `${id}.lock`)
}

/** Whether a process with this pid exists. EPERM means it does, as someone else's. */
function alive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM'
  }
}

async function readLock(path: string): Promise<LockFile | undefined> {
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8')) as Partial<LockFile>
    if (typeof parsed.pid !== 'number' || typeof parsed.token !== 'string') return undefined
    return parsed as LockFile
  } catch {
    return undefined
  }
}

async function stale(path: string, held: LockFile | undefined): Promise<boolean> {
  // Unreadable content cannot be a torn write — locks are created whole (see
  // `tryAcquire`) — so it is debris.
  if (held === undefined) return true
  if (!alive(held.pid)) return true
  const age = await stat(path).catch(() => undefined)
  return age !== undefined && Date.now() - age.mtimeMs > MAX_AGE_MS
}

/**
 * Moves a stale lock aside and deletes it. The rename is atomic, so of two
 * forges reclaiming the same stale lock only one moves it; the other finds
 * nothing and simply tries to create its own.
 */
async function reclaim(path: string): Promise<void> {
  const aside = `${path}.stale-${randomBytes(4).toString('hex')}`
  try {
    await rename(path, aside)
  } catch {
    return
  }
  const moved = await readLock(aside)
  if (moved !== undefined && !(await stale(aside, moved))) {
    // A live lock was created between our read and the rename: put it back.
    await link(aside, path).catch(() => {})
  }
  await rm(aside, { force: true })
}

/**
 * One attempt. The lock's content is written to a private temp file first,
 * then `link`ed into place: link fails with EEXIST exactly as an O_EXCL
 * create does, but the lock appears with its content already in it, so a
 * reader never sees a half-written lock.
 */
async function tryAcquire(id: string, what: string | undefined): Promise<LockFile | undefined> {
  await mkdir(lockDir(), { recursive: true })
  const path = lockPath(id)
  const mine: LockFile = {
    pid: process.pid,
    token: randomBytes(8).toString('hex'),
    at: Date.now(),
    ...(what !== undefined ? { what } : {}),
  }
  const tmp = `${path}.${mine.token}`
  await writeFile(tmp, JSON.stringify(mine), { flag: 'wx' })
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        await link(tmp, path)
        return mine
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e
      }
      if (!(await stale(path, await readLock(path)))) return undefined
      await reclaim(path)
    }
    return undefined
  } finally {
    await rm(tmp, { force: true })
  }
}

async function release(id: string, mine: LockFile): Promise<void> {
  const path = lockPath(id)
  // Only our own: if it was reclaimed and re-taken meanwhile, it is not ours to delete.
  if ((await readLock(path))?.token === mine.token) await rm(path, { force: true })
}

/** Who holds the tool's lock, if a live process does. Never throws. */
export async function extensionInUse(id: string): Promise<LockHolder | undefined> {
  const path = lockPath(id)
  const held = await readLock(path)
  if (held === undefined || (await stale(path, held))) return undefined
  return { pid: held.pid, ...(held.what !== undefined ? { what: held.what } : {}) }
}

/**
 * Runs `fn` holding the tool's lock. If another forge holds it, waits for it
 * (polling) up to `waitMs` — a second job on the same tool queues behind the
 * first rather than failing, as two jobs in one forge already do — then
 * throws `extension-in-use`. `waitMs: 0` refuses at once (remove does).
 */
export async function withExtensionLock<T>(
  id: string,
  fn: () => Promise<T>,
  opts: { what?: string; waitMs?: number; signal?: AbortSignal; action?: 'run' | 'remove' } = {},
): Promise<T> {
  const deadline = Date.now() + (opts.waitMs ?? WAIT_MS)
  let mine = await tryAcquire(id, opts.what)
  while (mine === undefined) {
    if (opts.signal?.aborted) throw opts.signal.reason ?? new Error('aborted')
    if (Date.now() >= deadline) {
      throw extensionBusy(id, await extensionInUse(id), opts.action ?? 'run')
    }
    await new Promise((r) => setTimeout(r, POLL_MS))
    mine = await tryAcquire(id, opts.what)
  }
  try {
    return await fn()
  } finally {
    await release(id, mine)
  }
}
