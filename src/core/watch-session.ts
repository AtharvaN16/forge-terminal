import {
  type BatchRun,
  batchRows,
  type KindAnswers,
  type LeftAlone,
  planBatch,
  type Recipe,
  runBatch,
} from './batch.js'
import type { ForgeError } from './errors.js'
import { type PlanEvent, runPlan } from './execute-jobs.js'
import { type FolderScan, readFolderFile } from './folder.js'
import { resolveConcurrency } from './run.js'
import type { Job, Phase, Result, SourceInfo } from './types.js'
import { watchFolder } from './watch.js'

export type { KindAnswers, LeftAlone, Recipe } from './batch.js'

/** A convert's kind answers as a recipe; a recipe as it is. */
const recipeOf = (r: KindAnswers | Recipe): Recipe =>
  'op' in r && (r.op === 'convert' || r.op === 'compress')
    ? (r as Recipe)
    : { op: 'convert', answers: r as KindAnswers }

/**
 * Plans every file of a scan with its kind's answer (or a compress): the
 * jobs to run and what is left alone. `claimed` is filled with every output
 * planned, which is what keeps the watcher from picking up Forge's own
 * writes afterwards.
 */
export function planFolder(
  sources: SourceInfo[],
  answers: KindAnswers | Recipe,
  claimed: Set<string>,
  destination?: string,
): { jobs: Job[]; left: LeftAlone[] } {
  const { jobs, left } = planBatch(sources, recipeOf(answers), claimed, { destination })
  return { jobs, left }
}

/**
 * Converts (or compresses) what a folder holds now, before watching starts:
 * one write-safety pass and one pool over every job, as any batch.
 */
export async function convertFolder(
  scan: FolderScan,
  answers: KindAnswers | Recipe,
  opts: {
    destination?: string | undefined
    onEvent?: (event: PlanEvent) => void
    signal?: AbortSignal
    concurrency?: number
  } = {},
): Promise<BatchRun> {
  return runBatch(scan.sources, recipeOf(answers), opts)
}

/** What happened to a file that landed while watching, as it happens. */
export type WatchEvent =
  | { type: 'arrived'; path: string }
  /** `job` once there is one: before it, the file is being read and probed. */
  | { type: 'phase'; path: string; phase: Phase; job?: Job }
  | { type: 'converted'; path: string; result: Result }
  | { type: 'left'; path: string; reason: string }
  | { type: 'failed'; path: string; error: ForgeError }

export interface WatchSession {
  /** Stops watching, then waits for the files already being converted. */
  stop(): Promise<void>
}

/** Why a kind Forge cannot read is left alone. */
const unreadWhy = (kind: 'videos' | 'audio' | 'other', sniffed: string): string =>
  kind === 'other' ? (sniffed === 'text' ? 'a text file' : 'not supported') : 'not yet supported'

/**
 * Watches `dir` and converts (or compresses) each file that lands, up to
 * `concurrency` at a time (default as any batch: up to 4). `known` are the
 * files already handled; `claimed` the outputs Forge has written or is
 * writing, which are never picked up as new files. Every outcome is an event;
 * nothing is printed, nothing is drawn.
 */
export function startWatch(opts: {
  dir: string
  /** What is done to each file that lands: a convert's kind answers, or a recipe. */
  answers: KindAnswers | Recipe
  known: Iterable<string>
  claimed: Set<string>
  destination?: string | undefined
  onEvent: (event: WatchEvent) => void
  settleMs?: number
  pollMs?: number
  concurrency?: number
}): WatchSession {
  const limit = resolveConcurrency(opts.concurrency)
  const recipe = recipeOf(opts.answers)
  const queue: string[] = []
  const running = new Set<Promise<void>>()
  let stopped = false

  const convert = async (path: string): Promise<void> => {
    opts.onEvent({ type: 'arrived', path })
    opts.onEvent({ type: 'phase', path, phase: 'reading' })
    const read = await readFolderFile(path)
    if (read.kind === 'failed') {
      opts.onEvent({ type: 'failed', path, error: read.failure.error })
      return
    }
    if (read.kind !== 'source') {
      opts.onEvent({ type: 'left', path, reason: unreadWhy(read.kind, read.sniffed) })
      return
    }
    const { jobs, left } = planFolder([read.source], recipe, opts.claimed, opts.destination)
    const [gone] = left
    if (gone) {
      opts.onEvent({ type: 'left', path, reason: gone.reason })
      return
    }
    const outcome = await runPlan(jobs, {
      force: false,
      concurrency: 1,
      ...(recipe.op === 'compress' && recipe.targetBytes !== undefined
        ? { targetBytes: recipe.targetBytes }
        : {}),
      onEvent: (event: PlanEvent) => {
        if (
          event.type === 'job:phase' &&
          'phase' in event.progress &&
          event.progress.phase !== 'page' &&
          event.progress.phase !== 'time'
        ) {
          opts.onEvent({ type: 'phase', path, phase: event.progress.phase, job: event.job })
        }
      },
    })
    // Told as any batch tells a file: done, failed, or left alone and why.
    const [row] = batchRows([read.source], { outcome, left: [], claimed: opts.claimed, jobs })
    if (row?.result) opts.onEvent({ type: 'converted', path, result: row.result })
    else if (row?.state === 'left') opts.onEvent({ type: 'left', path, reason: row.reason ?? '' })
    else {
      const failure = [...outcome.refusals, ...outcome.failures][0]
      if (failure) opts.onEvent({ type: 'failed', path, error: failure.error })
    }
  }

  const next = (): void => {
    while (!stopped && running.size < limit && queue.length > 0) {
      const path = queue.shift() as string
      const task: Promise<void> = convert(path)
        .catch(() => {})
        .finally(() => {
          running.delete(task)
          next()
        })
      running.add(task)
    }
  }

  const watcher = watchFolder(opts.dir, opts.known, {
    ...(opts.settleMs === undefined ? {} : { settleMs: opts.settleMs }),
    ...(opts.pollMs === undefined ? {} : { pollMs: opts.pollMs }),
    ignore: (path) => opts.claimed.has(path),
    onFile: (path) => {
      queue.push(path)
      next()
    },
  })

  return {
    async stop() {
      stopped = true
      watcher.close()
      queue.length = 0
      await Promise.all([...running])
    },
  }
}
