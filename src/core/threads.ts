import { availableParallelism } from 'node:os'

/**
 * How many files are converted at once: one per core, at most eight, the
 * most a batch's memory is allowed to multiply by.
 *
 * Measured 2026-10-25 on an 8-core M2, 50 JPEGs with --max-size 50kb: 4
 * workers 10.2 s, 8 workers 10.3 s, 8 workers with 8 libuv threads 7.5 s.
 * Sharp runs on libuv's threadpool, which has 4 threads unless told
 * otherwise, so more workers alone only queue behind them; the two have to
 * grow together (`sizeThreadpool`).
 */
export function workerCount(): number {
  return Math.max(1, Math.min(availableParallelism(), 8))
}

/**
 * Gives libuv a thread for every worker, unless the size was set by whoever
 * started Forge. libuv reads it once, when the threadpool is first used, so
 * this runs first thing in the entry point, before any file is read.
 */
export function sizeThreadpool(env: NodeJS.ProcessEnv = process.env): void {
  if (env.UV_THREADPOOL_SIZE === undefined) env.UV_THREADPOOL_SIZE = String(workerCount())
}
