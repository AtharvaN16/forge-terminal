import { appendFileSync, mkdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Windows runs an Explorer menu item once per selected file, each in its own
 * process at about the same moment. These gather them back into one run, so
 * twelve images sharpened give one notification, not twelve.
 *
 * Each process adds its file to a spool and tries to take a lock. The one
 * that gets it waits `wait` ms for the rest to land, takes the whole spool and
 * returns it; the others return null and exit. One that arrives after the
 * spool was taken finds its file still there and runs it itself.
 *
 * A Mac Quick Action gets every file in one call and has no need of this.
 */
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** A lock older than this was left by a process that died holding it. */
const STALE_MS = 15_000

export async function gather(
  dir: string,
  action: string,
  path: string,
  wait = 400,
): Promise<string[] | null> {
  mkdirSync(dir, { recursive: true })
  const spool = join(dir, `${action}.spool`)
  const lock = join(dir, `${action}.lock`)
  appendFileSync(spool, `${path}\n`)
  const listed = () => {
    try {
      return readFileSync(spool, 'utf8').split('\n').filter(Boolean)
    } catch {
      return []
    }
  }
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      mkdirSync(lock)
    } catch {
      try {
        if (Date.now() - statSync(lock).mtimeMs > STALE_MS)
          rmSync(lock, { recursive: true, force: true })
      } catch {}
      await sleep(wait * 1.5)
      if (!listed().includes(path)) return null
      continue
    }
    try {
      await sleep(wait)
      const paths = [...new Set(listed())]
      rmSync(spool, { force: true })
      return paths
    } finally {
      rmSync(lock, { recursive: true, force: true })
    }
  }
  return [path]
}
