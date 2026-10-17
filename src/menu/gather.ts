import { appendFileSync, mkdirSync, readFileSync, renameSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Windows runs an Explorer menu item once per selected file, each in its own
 * process, started over a second or so when there are many. These gather
 * them back into one run, so twelve images sharpened give one notification
 * and one window, not twelve.
 *
 * Each process adds its file to a spool and tries to take a lock. The one
 * that gets it waits until the spool has been quiet for `quiet` ms (never
 * longer than `cap` in all), then takes the spool by renaming it, so a file
 * added while it reads lands in a fresh spool rather than being lost. The
 * others wait for the lock to go: if their file was taken they return null
 * and exit; if it came too late, one of them leads the next run.
 *
 * A Mac Quick Action gets every file in one call and has no need of this.
 */
export interface GatherTiming {
  quiet: number
  cap: number
  poll: number
}
const DEFAULT: GatherTiming = { quiet: 500, cap: 3000, poll: 50 }

/** A lock older than this was left by a process that died holding it. */
const STALE_MS = 15_000

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export async function gather(
  dir: string,
  action: string,
  path: string,
  timing: GatherTiming = DEFAULT,
): Promise<string[] | null> {
  mkdirSync(dir, { recursive: true })
  const spool = join(dir, `${action}.spool`)
  const lock = join(dir, `${action}.lock`)
  const lines = (file: string) => {
    try {
      return readFileSync(file, 'utf8').split('\n').filter(Boolean)
    } catch {
      return []
    }
  }
  const size = () => {
    try {
      return statSync(spool).size
    } catch {
      return 0
    }
  }
  appendFileSync(spool, `${path}\n`)
  for (;;) {
    try {
      mkdirSync(lock)
    } catch {
      // Someone else is gathering. Wait for them to finish, then see whether
      // they took this file.
      try {
        if (Date.now() - statSync(lock).mtimeMs > STALE_MS)
          rmSync(lock, { recursive: true, force: true })
      } catch {}
      await sleep(timing.poll)
      if (!lines(spool).includes(path)) return null
      continue
    }
    try {
      const started = Date.now()
      let seen = size()
      let quietSince = Date.now()
      while (Date.now() - quietSince < timing.quiet && Date.now() - started < timing.cap) {
        await sleep(timing.poll)
        const now = size()
        if (now !== seen) {
          seen = now
          quietSince = Date.now()
        }
      }
      const taken = `${spool}.${process.pid}.${Date.now()}`
      try {
        renameSync(spool, taken)
      } catch {
        return [path]
      }
      const paths = [...new Set(lines(taken))]
      rmSync(taken, { force: true })
      return paths
    } finally {
      rmSync(lock, { recursive: true, force: true })
    }
  }
}
