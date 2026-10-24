import { dirname, join } from 'node:path'
import { putBack, saveCopy, type Taken, takeImage, undoClip } from '../core/clip.js'
import { clipboardUnavailable, noClipboardImage, nothingToUndo } from '../core/errors.js'
import { FORMATS } from '../core/formats.js'
import { runJson } from '../core/report-data.js'
import type { FormatId } from '../core/types.js'
import { formatBytes } from '../core/units.js'
import { probe } from '../engines/registry.js'
import { VERSION } from '../shell/theme.js'
import { displayPath } from '../utils/display-path.js'
import { clipboardSupported, type Pasteboard, systemPasteboard } from '../utils/pasteboard.js'
import type { ClipIntent, CompressIntent, ConvertIntent } from './args.js'
import {
  type ExecuteOptions,
  type ExecuteResult,
  type RunReport,
  renderRun,
  runIntent,
} from './execute.js'
import { changePhrase } from './report.js'

/** What a clip run did with its result. */
export type ClipStatus = 'placed' | 'changed'

export interface ClipOutcome {
  report: RunReport
  status: ClipStatus
  /** The result, in the workspace. */
  output: string
  source: { format: FormatId; bytes: number }
  target: FormatId
  /** With --save: the copy written there. With `changed`: the file it went to instead. */
  saved?: string
}

/** Where the dependencies come from: the real clipboard, unless a test gives its own. */
export interface ClipDeps {
  pasteboard?: Pasteboard
  /** The workspace folder; the system temp folder by default. */
  root?: string
  /** The default folder: where a result goes when the clipboard changed. */
  fallback?: string
}

async function defaultFolder(deps: ClipDeps): Promise<string> {
  if (deps.fallback !== undefined) return deps.fallback
  const { loadPreferences, expandTilde } = await import('../config/preferences.js')
  return expandTilde((await loadPreferences()).prefs.defaultOutput)
}

function pasteboardFor(deps: ClipDeps): Pasteboard {
  if (deps.pasteboard) return deps.pasteboard
  if (!clipboardSupported()) throw clipboardUnavailable()
  return systemPasteboard()
}

/** The intent that turns the copied image into its result, in the run's own folder. */
function runnable(intent: ClipIntent, taken: Taken, from: FormatId, target: FormatId) {
  const output = join(taken.outDir, `Copied image${FORMATS[target].extensions[0]}`)
  const common = {
    inputs: [taken.source],
    output,
    force: false,
    recursive: false,
    debug: intent.debug,
  }
  const options = {
    background: '#ffffff',
    keepMetadata: false,
    ...(intent.quality === undefined ? {} : { quality: intent.quality }),
  }
  if (target === from) {
    const compress: CompressIntent = {
      kind: 'compress',
      ...common,
      options,
      ...(intent.quality === undefined ? {} : { quality: intent.quality }),
      ...(intent.maxBytes === undefined ? {} : { maxBytes: intent.maxBytes }),
    }
    return compress
  }
  const convert: ConvertIntent = {
    kind: 'convert',
    ...common,
    target,
    options,
    ...(intent.maxBytes === undefined ? {} : { maxBytes: intent.maxBytes }),
  }
  return convert
}

/**
 * Reads the copied image, runs it, and puts the result back. Throws a
 * ForgeError when there is nothing to run, or the result is not worth
 * putting back; returns the run's own failures in the report.
 */
export async function runClip(
  intent: ClipIntent,
  opts: ExecuteOptions & { clip?: ClipDeps } = {},
): Promise<ClipOutcome | { report: RunReport; status: 'failed' }> {
  const deps = opts.clip ?? {}
  const pb = pasteboardFor(deps)
  const taken = await takeImage(pb, deps.root)
  if (!taken) throw noClipboardImage((await pb.peek()).text ? 'text' : 'nothing')

  const source = await probe(taken.source)
  const target = intent.target ?? source.format
  const run = runnable(intent, taken, source.format, target)
  const report = await runIntent(run, opts)
  const result = report.results[0]
  if (!result || report.failures.length > 0) return { report, status: 'failed' }

  // Compressing never comes out larger: the engine refuses that before
  // writing (`cannot-compress-more`), so it arrives above as a failure.
  const output = result.job.outputs[0] as string
  const base = { report, output, source: { format: source.format, bytes: source.bytes }, target }
  if ((await putBack(pb, taken, output, target)) === 'changed') {
    return { ...base, status: 'changed', saved: await saveCopy(output, await defaultFolder(deps)) }
  }
  if (intent.save === undefined) return { ...base, status: 'placed' }
  const folder = intent.save === true ? await defaultFolder(deps) : intent.save
  const { expandTilde } = await import('../config/preferences.js')
  return { ...base, status: 'placed', saved: await saveCopy(output, expandTilde(folder)) }
}

export function clipLines(o: ClipOutcome): string[] {
  const as = o.target === o.source.format ? '' : `  as ${FORMATS[o.target].label}`
  const sizes = `  ${formatBytes(o.source.bytes)} → ${formatBytes(o.report.outputBytes)} · ${changePhrase(o.source.bytes, o.report.outputBytes)}`
  if (o.status === 'changed') {
    const verb = o.target === o.source.format ? 'compressed' : 'converted'
    return [
      `✓ Copied image → ${displayPath(o.saved as string)}${as}`,
      sizes,
      '',
      '⚠ Clipboard changed',
      '  The file you uploaded is no longer in the clipboard.',
      `  The ${verb} image is saved to ${displayPath(dirname(o.saved as string))}.`,
    ]
  }
  const saved = o.saved === undefined ? '' : ` + ${displayPath(o.saved)}`
  return [`✓ Copied image → clipboard${as}${saved}`, sizes]
}

/** Puts the last original back; throws when none is kept. */
export async function runUndo(deps: ClipDeps): Promise<void> {
  if (!(await undoClip(pasteboardFor(deps), deps.root))) throw nothingToUndo()
}

/** `forge clip`, as text or JSON. */
export async function runClipCommand(
  intent: ClipIntent,
  opts: ExecuteOptions & { clip?: ClipDeps; json: boolean; debug: boolean },
): Promise<ExecuteResult> {
  if (intent.undo) {
    await runUndo(opts.clip ?? {})
    return {
      exitCode: 0,
      stdout: opts.json
        ? [JSON.stringify({ forge: VERSION, ok: true, clipboard: 'restored' })]
        : ['✓ The original is back on the clipboard'],
      stderr: [],
    }
  }
  const outcome = await runClip(intent, opts)
  if (outcome.status === 'failed') return renderRun(outcome.report, opts)
  if (opts.json) {
    const doc = {
      ...runJson(VERSION, outcome.report),
      clipboard: outcome.status,
      ...(outcome.saved === undefined ? {} : { saved: outcome.saved }),
    }
    return { exitCode: 0, stdout: [JSON.stringify(doc)], stderr: [] }
  }
  return { exitCode: 0, stdout: clipLines(outcome), stderr: [] }
}
