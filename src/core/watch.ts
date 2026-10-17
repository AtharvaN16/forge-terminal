import { type FSWatcher, watch } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { isIgnoredName } from './folder.js'

export interface WatchFolderOptions {
  /** How long a file must stay the same size and age before it is read: 1 s. */
  settleMs?: number
  /** How often the folder is looked at again, whatever the OS reports: 500 ms. */
  pollMs?: number
  /** A path never to hand over: the files Forge itself is writing. */
  ignore?: (path: string) => boolean
  /** A new file, finished: it has not changed for `settleMs`. */
  onFile: (path: string) => void
}

export interface FolderWatch {
  close(): void
}

/**
 * Watches one folder (one level, as a folder drop reads it) for files that
 * arrive, and hands each over once it has stopped changing — a screenshot
 * being written, a copy or a download is never read half-done (spec: watch,
 * "How it behaves"). Hidden files, temp files and unfinished downloads are
 * never handed over; nor is anything `ignore` claims.
 *
 * The folder is looked at every `pollMs` as well as whenever the OS says it
 * changed: `fs.watch` can miss events (and does across sleep), and a look is
 * cheap — one readdir, and a stat per file not yet settled. A file that goes
 * away and comes back is new again. Data only: what to do with a file is the
 * caller's business.
 */
export function watchFolder(
  dir: string,
  known: Iterable<string>,
  opts: WatchFolderOptions,
): FolderWatch {
  const abs = resolve(dir)
  const settleMs = opts.settleMs ?? 1000
  const pollMs = opts.pollMs ?? 500
  // Files handed over (or there from the start), and files still settling.
  const done = new Set<string>([...known].map((p) => resolve(p)))
  const pending = new Map<string, { size: number; mtimeMs: number; since: number }>()
  let closed = false
  let looking = false
  let again = false

  const look = async (): Promise<void> => {
    if (closed) return
    if (looking) {
      again = true
      return
    }
    looking = true
    try {
      const entries = await readdir(abs, { withFileTypes: true }).catch(() => [])
      const present = new Set<string>()
      for (const entry of entries) {
        if (!entry.isFile() || isIgnoredName(entry.name)) continue
        const path = join(abs, entry.name)
        present.add(path)
        if (done.has(path) || opts.ignore?.(path)) continue
        const s = await stat(path).catch(() => undefined)
        if (!s || closed) continue
        const now = Date.now()
        const was = pending.get(path)
        if (!was || was.size !== s.size || was.mtimeMs !== s.mtimeMs) {
          pending.set(path, { size: s.size, mtimeMs: s.mtimeMs, since: now })
          continue
        }
        if (now - was.since < settleMs) continue
        pending.delete(path)
        done.add(path)
        opts.onFile(path)
      }
      // Gone: forget it, so the same name arriving later is new again.
      for (const path of [...done, ...pending.keys()]) {
        if (!present.has(path)) {
          done.delete(path)
          pending.delete(path)
        }
      }
    } finally {
      looking = false
      if (again && !closed) {
        again = false
        void look()
      }
    }
  }

  const timer = setInterval(() => void look(), pollMs)
  let watcher: FSWatcher | undefined
  try {
    watcher = watch(abs, { persistent: false }, () => void look())
    watcher.on('error', () => {})
  } catch {
    // Polling alone still finds every file, only a little later.
  }
  void look()

  return {
    close() {
      closed = true
      clearInterval(timer)
      watcher?.close()
    },
  }
}
