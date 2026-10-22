import { existsSync } from 'node:fs'
import { basename, dirname, extname, join } from 'node:path'
import { compressAction } from './actions/compress.js'
import { convertAction } from './actions/convert.js'
import { boostAction, removeBackgroundAction } from './actions/extension.js'
import { resizeAction, trimAction } from './actions/resize.js'
import { targetIdsFor } from './capabilities.js'
import { type PlanEvent, type RunOutcome, runPlan } from './execute-jobs.js'
import { boostOverLimit } from './extension-targets.js'
import type { KindAnswer, KindId } from './folder.js'
import { kindOf } from './folder.js'
import { FORMATS } from './formats.js'
import { fitName } from './output-path.js'
import { keptFormat } from './resize.js'
import type { ImageInfo, Job, ResizeSpec, Result, SourceInfo } from './types.js'
import { formatBytes } from './units.js'

/**
 * Several files at once, as the shell does them (mockups/batch-2026-10.html):
 * one answer for the whole batch, each file planned and run on its own, and
 * every file's fate told — done, failed, or left alone and why. A folder and
 * a drop of several files are both a batch; only a folder is watched after.
 */

/** Each kind's answer; a kind without one is left alone. */
export type KindAnswers = Partial<Record<KindId, KindAnswer>>

/** What is done to every file: converted with its kind's answer, or compressed. */
export type Recipe =
  | { op: 'convert'; answers: KindAnswers }
  /** Compressed at a quality, or each file to fit under `targetBytes`. */
  | { op: 'compress'; quality?: number; targetBytes?: number }
  /** One of Edit's tools on every image: Boost's scale, Resize's size. */
  | { op: 'edit'; tool: BatchEditTool; scale?: number; resize?: ResizeSpec }

/** An edit recipe: one tool, run on every image. */
export type EditRecipe = Extract<Recipe, { op: 'edit' }>

/**
 * The edit tools a batch runs on every image. Not Crop to shape: where to
 * cut is a choice made for each picture, so it is one image at a time.
 */
export type BatchEditTool = 'sharpen' | 'boost' | 'cutout' | 'trim' | 'resize'

/**
 * What to do with a file whose output is already on disk. `leave` it alone
 * ("already converted": a folder dropped again, or watched), `ask` (the
 * jobs come back as `taken`, for one question about all of them), `number`
 * the new one past it (Keep both), or `replace` it.
 */
export type Existing = 'leave' | 'ask' | 'number' | 'replace'

/** A file left alone, and why, as its row says it. */
export interface LeftAlone {
  path: string
  reason: string
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

/** Why compress has nothing to do with a file, in a row's few words. */
function nothingToCompress(source: SourceInfo): string {
  if (source.kind === 'document')
    return source.format === 'pdf' ? 'no images to shrink' : 'nothing to compress'
  return `${FORMATS[source.format].label} is lossless`
}

/** One image's edit job, or why the tool leaves it as it is. */
function editJob(
  source: SourceInfo,
  recipe: Extract<Recipe, { op: 'edit' }>,
  destination: string | undefined,
): { job: Job } | { left: string } {
  if (source.kind !== 'image') return { left: 'images only' }
  const image: ImageInfo = source
  const where = destination === undefined ? {} : { output: destination }
  if (recipe.tool === 'sharpen' || recipe.tool === 'boost') {
    const scale = recipe.tool === 'sharpen' ? 1 : (recipe.scale ?? 2)
    if (boostOverLimit(image.width, image.height, scale))
      return { left: scale === 1 ? 'too large' : `too large for ${scale}×` }
    const [job] = boostAction.plan([image], {
      scale: String(scale),
      target: keptFormat(image),
      ...where,
    })
    return job ? { job } : { left: 'not supported' }
  }
  if (recipe.tool === 'cutout') {
    const [job] = removeBackgroundAction.plan([image], { target: 'png', ...where })
    return job ? { job } : { left: 'not supported' }
  }
  if (recipe.tool === 'trim' && image.frames > 1) return { left: 'animated' }
  const action = recipe.tool === 'trim' ? trimAction : resizeAction
  const [job] = action.plan([image], {
    target: keptFormat(image),
    ...(recipe.resize ? { resize: recipe.resize } : {}),
    ...where,
  })
  return job ? { job } : { left: 'not supported' }
}

/** One file's job for the recipe, before anything on disk is looked at; or why not. */
function jobFor(
  source: SourceInfo,
  recipe: Recipe,
  destination: string | undefined,
): { job: Job } | { left: string } {
  if (recipe.op === 'edit') return editJob(source, recipe, destination)
  // Video and sound go one at a time: each has its own length and floor.
  if (source.kind === 'media') return { left: 'one at a time' }
  const where = destination === undefined ? {} : { destination }
  if (recipe.op === 'compress') {
    if (!compressAction.appliesTo([source])) return { left: nothingToCompress(source) }
    // Already under the size: re-encoding would only lose quality for nothing.
    if (recipe.targetBytes !== undefined && source.bytes <= recipe.targetBytes)
      return { left: 'already under that size' }
    const [job] = compressAction.plan([source], {
      mode: recipe.targetBytes === undefined ? 'quality' : 'size',
      ...(recipe.quality === undefined ? {} : { quality: recipe.quality }),
      ...where,
    })
    return job ? { job } : { left: 'not supported' }
  }
  const answer = recipe.answers[kindOf(source)]
  if (!answer) return { left: notKind(recipe.answers) }
  if (source.format === answer.target) return { left: `already ${FORMATS[answer.target].label}` }
  if (!targetIdsFor(source).includes(answer.target)) {
    return { left: `can’t become ${FORMATS[answer.target].label}` }
  }
  const [job] = convertAction.plan([source], {
    target: answer.target,
    ...(answer.quality === undefined ? {} : { quality: answer.quality }),
    ...(answer.dpi === undefined ? {} : { dpi: String(answer.dpi) }),
    pages: 'all',
    ...where,
  })
  return job?.op === 'convert' ? { job } : { left: 'not supported' }
}

/** `o`, or `o` numbered (`hero (1).webp`) past every name in `taken` and, if asked, on disk. */
function numbered(o: string, taken: (path: string) => boolean): string {
  if (!taken(o)) return o
  const ext = extname(o)
  const stem = basename(o, ext)
  for (let n = 1; ; n++) {
    const candidate = join(dirname(o), fitName(stem, ` (${n})${ext}`))
    if (!taken(candidate) && !existsSync(candidate)) return candidate
  }
}

/**
 * One file's job, or why it is left alone. `claimed` holds the outputs this
 * run (or a watch) has already planned, so two files that would take one
 * name keep both (`hero (1).webp`) — nobody is there to ask. Every output
 * planned is added to it.
 */
export function planBatchFile(
  source: SourceInfo,
  recipe: Recipe,
  claimed: Set<string>,
  opts: { destination?: string | undefined; existing?: Existing } = {},
): { job: Job; taken?: true } | { left: string } {
  const existing = opts.existing ?? 'leave'
  const planned = jobFor(source, recipe, opts.destination)
  if (!('job' in planned)) return planned
  const { job } = planned
  const onDisk = job.outputs.some((o) => existsSync(o) && !claimed.has(o))
  if (onDisk && existing === 'leave') {
    return {
      left:
        recipe.op === 'compress'
          ? 'already compressed'
          : recipe.op === 'edit'
            ? 'already edited'
            : 'already converted',
    }
  }
  const taken =
    existing === 'number'
      ? (o: string) => claimed.has(o) || existsSync(o)
      : (o: string) => claimed.has(o)
  job.outputs = job.outputs.map((o) => numbered(o, taken)) as typeof job.outputs
  for (const o of job.outputs) claimed.add(o)
  return onDisk && existing === 'ask' ? { job, taken: true } : { job }
}

/** One folder file's job with its kind's answer, as `forge watch` plans each file. */
export function planFolderFile(
  source: SourceInfo,
  answer: KindAnswer,
  claimed: Set<string>,
  destination?: string,
): { job: Job; taken?: true } | { left: string } {
  const recipe: Recipe = { op: 'convert', answers: { [kindOf(source)]: answer } }
  return planBatchFile(source, recipe, claimed, { destination })
}

/**
 * Plans every file: the jobs to run, what is left alone, and — when asked —
 * the jobs whose outputs are already on disk (`taken`, also among `jobs`).
 */
export function planBatch(
  sources: SourceInfo[],
  recipe: Recipe,
  claimed: Set<string>,
  opts: { destination?: string | undefined; existing?: Existing } = {},
): { jobs: Job[]; left: LeftAlone[]; taken: Job[] } {
  const jobs: Job[] = []
  const left: LeftAlone[] = []
  const taken: Job[] = []
  for (const source of sources) {
    const planned = planBatchFile(source, recipe, claimed, opts)
    if ('job' in planned) {
      jobs.push(planned.job)
      if (planned.taken) taken.push(planned.job)
    } else left.push({ path: source.path, reason: planned.left })
  }
  return { jobs, left, taken }
}

export interface BatchRun {
  outcome: RunOutcome
  left: LeftAlone[]
  claimed: Set<string>
  jobs: Job[]
}

/**
 * Plans and runs a batch: one write-safety pass and one pool over every
 * job, as any batch (`runPlan`). A target size is searched for each file.
 */
export async function runBatch(
  sources: SourceInfo[],
  recipe: Recipe,
  opts: {
    destination?: string | undefined
    existing?: Existing
    onEvent?: (event: PlanEvent) => void
    signal?: AbortSignal
    concurrency?: number
  } = {},
): Promise<BatchRun> {
  const claimed = new Set<string>()
  const existing = opts.existing ?? 'leave'
  const { jobs, left } = planBatch(sources, recipe, claimed, {
    destination: opts.destination,
    existing,
  })
  const outcome = await runPlan(jobs, {
    force: existing === 'replace',
    ...(recipe.op === 'compress' && recipe.targetBytes !== undefined
      ? { targetBytes: recipe.targetBytes }
      : {}),
    ...(opts.concurrency === undefined ? {} : { concurrency: opts.concurrency }),
    ...(opts.onEvent ? { onEvent: opts.onEvent } : {}),
    ...(opts.signal ? { signal: opts.signal } : {}),
  })
  return { outcome, left, claimed, jobs }
}

/** What became of one file of a batch, as its row tells it. */
export interface BatchRow {
  path: string
  state: 'done' | 'failed' | 'left'
  result?: Result
  /** Failed or left alone: why, in a few words. */
  reason?: string
}

/**
 * Every file of a batch, in the order given, with what became of it. A file
 * already under a target size, or that can't get under it, was left as it
 * was — not a failure: there was nothing wrong with it.
 */
export function batchRows(sources: SourceInfo[], run: BatchRun): BatchRow[] {
  const { outcome, left } = run
  const by = new Map<string, BatchRow>()
  for (const r of outcome.results) {
    const path = r.job.sources[0].path
    by.set(path, { path, state: 'done', result: r })
  }
  for (const f of [...outcome.refusals, ...outcome.failures]) {
    // Compress never writes a file that is no smaller: nothing wrong with it.
    if (f.error.code === 'cannot-compress-more') {
      const reason =
        f.error.short === 'nothing written' ? 'can’t get smaller' : 'already under that size'
      by.set(f.path, { path: f.path, state: 'left', reason })
    } else if (f.error.code === 'nothing-to-trim') {
      by.set(f.path, { path: f.path, state: 'left', reason: 'no empty edges' })
    } else {
      // A failure in the few words the home and watch rows use: "damaged file".
      by.set(f.path, { path: f.path, state: 'failed', reason: f.error.title.toLowerCase() })
    }
  }
  for (const u of outcome.unreachable) {
    const path = u.job.sources[0].path
    by.set(path, { path, state: 'left', reason: `can’t get below ${formatBytes(u.smallest)}` })
  }
  for (const l of left) by.set(l.path, { path: l.path, state: 'left', reason: l.reason })
  return sources.map(
    (s) =>
      by.get(s.path) ?? {
        path: s.path,
        state: 'left',
        reason: outcome.cancelled ? 'stopped' : 'not run',
      },
  )
}
