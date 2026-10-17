import type { ForgeError } from './errors.js'
import { type PlanEvent, type RunOutcome, runPlan } from './execute-jobs.js'
import {
  type FolderScan,
  type KindAnswer,
  type KindId,
  kindOf,
  planFolderFile,
  readFolderFile,
} from './folder.js'
import { resolveConcurrency } from './run.js'
import type { Job, Phase, Result, SourceInfo } from './types.js'
import { watchFolder } from './watch.js'

/** Each kind's answer; a kind without one is left alone. */
export type KindAnswers = Partial<Record<KindId, KindAnswer>>

/** A file left alone, and why, as its row says it. */
export interface LeftAlone {
  path: string
  reason: string
}

/**
 * Plans every file of a scan with its kind's answer: the jobs to run and
 * what is left alone. `claimed` is filled with every output planned, which
 * is what keeps the watcher from picking up Forge's own writes afterwards.
 */
export function planFolder(
  sources: SourceInfo[],
  answers: KindAnswers,
  claimed: Set<string>,
  destination?: string,
): { jobs: Job[]; left: LeftAlone[] } {
  const jobs: Job[] = []
  const left: LeftAlone[] = []
  for (const source of sources) {
    const answer = answers[kindOf(source)]
    if (!answer) {
      left.push({ path: source.path, reason: notKind(answers) })
      continue
    }
    const planned = planFolderFile(source, answer, claimed, destination)
    if ('job' in planned) jobs.push(planned.job)
    else left.push({ path: source.path, reason: planned.left })
  }
  return { jobs, left }
}

/**
 * Converts what a folder holds now, before watching starts: one write-safety
 * pass and one pool over every job, as any batch (`runPlan`).
 */
export async function convertFolder(
  scan: FolderScan,
  answers: KindAnswers,
  opts: {
    destination?: string | undefined
    onEvent?: (event: PlanEvent) => void
    signal?: AbortSignal
    concurrency?: number
  } = {},
): Promise<{ outcome: RunOutcome; left: LeftAlone[]; claimed: Set<string>; jobs: Job[] }> {
  const claimed = new Set<string>()
  const { jobs, left } = planFolder(scan.sources, answers, claimed, opts.destination)
  const outcome = await runPlan(jobs, {
    force: false,
    ...(opts.concurrency === undefined ? {} : { concurrency: opts.concurrency }),
    ...(opts.onEvent ? { onEvent: opts.onEvent } : {}),
    ...(opts.signal ? { signal: opts.signal } : {}),
  })
  return { outcome, left, claimed, jobs }
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

const A_KIND: Record<KindId, string> = {
  images: 'an image',
  pdfs: 'a PDF',
  documents: 'a document',
  videos: 'a video',
  audio: 'audio',
  other: 'a file Forge reads',
}

/** Why a file of a kind with no answer is left alone: "not an image", "not an image or a PDF". */
function notKind(answers: KindAnswers): string {
  const kinds = (Object.keys(answers) as KindId[]).filter((k) => answers[k])
  if (kinds.length === 0) return 'not supported'
  const named = kinds.map((k) => A_KIND[k])
  return `not ${named.length === 1 ? named[0] : `${named.slice(0, -1).join(', ')} or ${named.at(-1)}`}`
}

/** Why a kind Forge cannot read is left alone. */
const unreadWhy = (kind: 'videos' | 'audio' | 'other', sniffed: string): string =>
  kind === 'other' ? (sniffed === 'text' ? 'a text file' : 'not supported') : 'not yet supported'

/**
 * Watches `dir` and converts each file that lands with its kind's answer,
 * up to `concurrency` at a time (default as any batch: up to 4). `known` are
 * the files already handled; `claimed` the outputs Forge has written or is
 * writing, which are never picked up as new files. Every outcome is an event;
 * nothing is printed, nothing is drawn.
 */
export function startWatch(opts: {
  dir: string
  answers: KindAnswers
  known: Iterable<string>
  claimed: Set<string>
  destination?: string | undefined
  onEvent: (event: WatchEvent) => void
  settleMs?: number
  pollMs?: number
  concurrency?: number
}): WatchSession {
  const limit = resolveConcurrency(opts.concurrency)
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
    const { jobs, left } = planFolder([read.source], opts.answers, opts.claimed, opts.destination)
    const [gone] = left
    if (gone) {
      opts.onEvent({ type: 'left', path, reason: gone.reason })
      return
    }
    const outcome = await runPlan(jobs, {
      force: false,
      concurrency: 1,
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
    const [result] = outcome.results
    const failure = [...outcome.refusals, ...outcome.failures][0]
    if (result) opts.onEvent({ type: 'converted', path, result })
    else if (failure) opts.onEvent({ type: 'failed', path, error: failure.error })
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
