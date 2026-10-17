import { readdir, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import {
  type ForgeError,
  fileNotFound,
  invalidArguments,
  isForgeError,
  renderError,
} from '../core/errors.js'
import { type FolderScan, isIgnoredName, type KindAnswer, scanFolder } from '../core/folder.js'
import { FORMATS } from '../core/formats.js'
import { failureJson, resultJson } from '../core/report-data.js'
import type { InputFailure } from '../core/resolve.js'
import type { Result } from '../core/types.js'
import { formatBytes } from '../core/units.js'
import {
  convertFolder,
  type KindAnswers,
  type LeftAlone,
  startWatch,
} from '../core/watch-session.js'
import { VERSION } from '../shell/theme.js'
import { displayName } from '../utils/display-path.js'
import type { WatchIntent } from './args.js'

export interface WatchIo {
  /** One line of output: text for a person, or one JSON document with `json`. */
  out: (line: string) => void
  json: boolean
  /** ctrl-c: stop watching, finish what is being converted, say the totals. */
  signal: AbortSignal
  /** Test seams: how long a file must sit still, and how often the folder is looked at. */
  settleMs?: number
  pollMs?: number
}

/** "✓ 28 converted · 1 failed · 1 left alone": only the parts that happened, but always the count. */
function totals(converted: number, failed: number, left: number, to?: string): string {
  return [
    `✓ ${converted} converted${to ? ` to ${to}` : ''}`,
    ...(failed ? [`${failed} failed`] : []),
    ...(left ? [`${left} left alone`] : []),
  ].join(' · ')
}

const resultLine = (result: Result): string => {
  const [first, ...rest] = result.job.outputs
  const out = `${displayName(first ?? '')}${rest.length ? ` + ${rest.length} more` : ''}`
  return `✓ ${displayName(result.job.sources[0].path)} → ${out}   ${formatBytes(result.outputBytes)}`
}
const failedLine = (path: string, error: ForgeError) =>
  `✕ ${displayName(path)}   ${error.title.toLowerCase()}`
const leftLine = (l: LeftAlone) => `– ${displayName(l.path)}   ${l.reason}`

/**
 * `forge watch`: converts what the folder holds (unless `--new-only`), then
 * every file that lands in it, a line each, until ctrl-c; then the totals.
 * The target applies to every kind that can become it; anything else is
 * left alone, with why. Never prints itself — `io.out` is how the entry
 * point, the one layer that writes to a stream, gets each line.
 */
export async function runWatch(intent: WatchIntent, io: WatchIo): Promise<0 | 1 | 2> {
  const dir = resolve(intent.folder)
  const json = (event: string, data: Record<string, unknown>) =>
    io.out(JSON.stringify({ forge: VERSION, event, ...data }))
  try {
    const s = await stat(dir).catch(() => undefined)
    if (!s) throw fileNotFound(dir)
    if (!s.isDirectory()) {
      throw invalidArguments(
        `${displayName(dir)} is not a folder.`,
        `forge watch watches a folder. Try: forge watch ${displayName(resolve(dir, '..'))} --to ${intent.target}`,
      )
    }
  } catch (e) {
    if (!isForgeError(e)) throw e
    if (io.json) json('error', { ok: false, failures: [failureJson({ error: e })] })
    else for (const line of renderError(e, { debug: intent.debug })) io.out(line)
    return 2
  }

  const answer: KindAnswer = {
    target: intent.target,
    ...(intent.quality === undefined ? {} : { quality: intent.quality }),
    dpi: intent.dpi ?? 150,
  }
  // Every kind Forge converts takes the one target; a file that cannot become it is left alone.
  const answers: KindAnswers = { images: answer, pdfs: answer, documents: answer }
  const destination = intent.output === undefined ? undefined : resolve(intent.output)
  const label = FORMATS[intent.target].label

  let converted = 0
  const failures: InputFailure[] = []
  const left: LeftAlone[] = []
  let claimed = new Set<string>()
  let known: string[]

  if (intent.newOnly) {
    const entries = await readdir(dir, { withFileTypes: true })
    known = entries
      .filter((e) => e.isFile() && !isIgnoredName(e.name))
      .map((e) => join(dir, e.name))
  } else {
    const scan: FolderScan = await scanFolder(dir)
    known = scan.paths
    const run = await convertFolder(scan, answers, { destination })
    claimed = run.claimed
    const runFailures = [...scan.failures, ...run.outcome.refusals, ...run.outcome.failures]
    // Files Forge cannot read at all are left alone with their kind's reason.
    const unread = scan.kinds.flatMap((k) => (k.why ? [{ count: k.count, why: k.why }] : []))
    const leftCount = run.left.length + unread.reduce((n, k) => n + k.count, 0)
    converted += run.outcome.results.length
    failures.push(...runFailures)
    left.push(...run.left)
    if (io.json) {
      json('converted-existing', {
        ok: runFailures.length === 0,
        results: run.outcome.results.map(resultJson),
        failures: runFailures.map(failureJson),
        leftAlone: run.left,
      })
    } else if (scan.paths.length > 0) {
      io.out(totals(run.outcome.results.length, runFailures.length, leftCount, label))
      for (const f of runFailures) io.out(failedLine(f.path, f.error))
    }
    for (const k of unread) for (let i = 0; i < k.count; i++) left.push({ path: '', reason: k.why })
  }

  if (io.json) json('watching', { folder: dir, ...(destination ? { output: destination } : {}) })
  else {
    io.out(
      `Watching ${displayName(dir)} · any new files you add will be converted · ctrl-c to stop`,
    )
  }

  const session = startWatch({
    dir,
    answers,
    known,
    claimed,
    destination,
    ...(io.settleMs === undefined ? {} : { settleMs: io.settleMs }),
    ...(io.pollMs === undefined ? {} : { pollMs: io.pollMs }),
    onEvent: (event) => {
      if (event.type === 'converted') {
        converted++
        if (io.json) json('converted', { result: resultJson(event.result) })
        else io.out(resultLine(event.result))
      } else if (event.type === 'failed') {
        failures.push({ path: event.path, error: event.error })
        if (io.json)
          json('failed', { failure: failureJson({ path: event.path, error: event.error }) })
        else io.out(failedLine(event.path, event.error))
      } else if (event.type === 'left') {
        left.push({ path: event.path, reason: event.reason })
        if (io.json) json('left-alone', { path: event.path, reason: event.reason })
        else io.out(leftLine({ path: event.path, reason: event.reason }))
      }
    },
  })

  await new Promise<void>((done) => {
    if (io.signal.aborted) done()
    else io.signal.addEventListener('abort', () => done(), { once: true })
  })
  await session.stop()

  if (io.json) {
    json('stopped', { converted, failed: failures.length, leftAlone: left.length })
  } else io.out(totals(converted, failures.length, left.length))
  return failures.length > 0 ? 1 : 0
}
