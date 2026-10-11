import { basename, dirname } from 'node:path'
import { readableFormats, writableFormats } from '../core/capabilities.js'
import { renderError } from '../core/errors.js'
import { FORMATS } from '../core/formats.js'
import type { InputFailure } from '../core/resolve.js'
import type { RunSummary } from '../core/run.js'
import { formatBytes, percentChange } from '../core/units.js'
import { displayPath } from '../utils/display-path.js'

/**
 * Where a report's paths are shown relative to. Defaults to the real process;
 * tests pass their own.
 */
interface Where {
  cwd?: string
  home?: string
}

const placesFor = (where: Where) => ({
  cwd: where.cwd ?? process.cwd(),
  ...(where.home === undefined ? {} : { home: where.home }),
})

/**
 * ` in <folder>/` for a set of outputs, or nothing when that folder is the
 * cwd — there, the folder goes without saying, exactly as a bare filename
 * does for a single output.
 */
function inFolder(output: string, where: Where): string {
  const shown = displayPath(dirname(output), placesFor(where))
  if (shown === '.') return ''
  return ` in ${shown.endsWith('/') ? shown : `${shown}/`}`
}

function changePhrase(from: number, to: number): string {
  const { pct, direction } = percentChange(from, to)
  if (direction === 'same') return 'same size'
  return `${pct}% ${direction}`
}

/**
 * One converted source. Usually one output too, but a single PDF rasterised
 * to several pages is still one *result* — one job, one source — with many
 * `outputs`. `summary.results.length === 1` is what routes execute() here
 * rather than to `reportBatch`, so this has to handle that shape itself
 * rather than assuming `outputs[0]` is the whole story (phase 4a's own
 * version of phase 3's worst defect: code that quietly only ever looked at
 * the first output).
 */
export function reportSingle(summary: RunSummary, where: Where = {}): string[] {
  const result = summary.results[0]
  if (!result) return []

  const source = result.job.sources[0]
  const outputs = result.job.outputs

  if (outputs.length > 1) {
    const lines = [
      `✓ ${basename(source.path)} → ${outputs.length} files${inFolder(outputs[0], where)}`,
      `  ${outputs.map((o) => basename(o)).join(', ')}`,
      `  ${formatBytes(source.bytes)} → ${formatBytes(result.outputBytes)} total`,
    ]
    for (const warning of result.warnings) lines.push('', `⚠ ${warning.message}`)
    return lines
  }

  // The output as a path, not a bare name: `-o out/` and `-o deep/dir/`
  // used to print byte-identical lines (audit #9). Inside cwd it is relative,
  // so the ordinary alongside-the-source case still reads `photo.png`.
  const lines = [
    `✓ ${basename(source.path)} → ${displayPath(outputs[0], placesFor(where))}`,
    `  ${formatBytes(source.bytes)} → ${formatBytes(result.outputBytes)} · ${changePhrase(source.bytes, result.outputBytes)}`,
  ]
  for (const warning of result.warnings) lines.push('', `⚠ ${warning.message}`)
  return lines
}

export function reportBatch(summary: RunSummary, output?: string): string[] {
  const lines = [
    `✓ ${summary.results.length} converted`,
    `  ${formatBytes(summary.inputBytes)} → ${formatBytes(summary.outputBytes)} · ${changePhrase(summary.inputBytes, summary.outputBytes)}`,
  ]

  const warnings = summary.results.flatMap((r) => r.warnings)
  if (warnings.length > 0) {
    lines.push('')
    for (const w of warnings) lines.push(`⚠ ${w.message}`)
  }

  if (output) lines.push('', `Output: ${output}`)
  return lines
}

/**
 * A page operation's result names its outputs instead of showing a size
 * change — "4.2 MB → 4.3 MB" says nothing useful for a split into 4 files,
 * unlike a conversion where the before/after size is the whole point.
 */
export function reportPageOp(summary: RunSummary, where: Where = {}): string[] {
  const outputs = summary.results.flatMap((r) => r.job.outputs)
  const names = outputs.map((o) => basename(o)).join(', ')
  const noun = outputs.length === 1 ? 'file' : 'files'

  const folder = outputs[0] === undefined ? '' : inFolder(outputs[0], where)
  const lines = [`✓ ${outputs.length} ${noun} · ${names}${folder}`]
  const warnings = summary.results.flatMap((r) => r.warnings)
  for (const warning of warnings) lines.push('', `⚠ ${warning.message}`)
  return lines
}

export function reportFailures(failures: InputFailure[], opts: { debug: boolean }): string[] {
  if (failures.length === 0) return []
  const lines: string[] = []
  for (const failure of failures) {
    lines.push(...renderError(failure.error, { debug: opts.debug }), '')
  }
  return lines
}

export function reportFormats(): string[] {
  const readable = new Set(readableFormats())
  const writable = new Set(writableFormats())

  const lines = ['Formats', '']
  for (const id of readable) {
    const spec = FORMATS[id]
    const capability = writable.has(id) ? 'read and write' : 'read only'
    lines.push(`  ${spec.label.padEnd(6)} ${spec.extensions.join(' ').padEnd(12)} ${capability}`)
  }

  // Derived from the capability table, not hardcoded — this would otherwise
  // become a lie the day any engine can encode a format it currently cannot.
  const readOnly = [...readable].filter((id) => !writable.has(id)).map((id) => FORMATS[id].label)
  if (readOnly.length > 0) {
    const names = readOnly.join(', ')
    const [verb, noun] = readOnly.length === 1 ? ['is', 'it'] : ['are', 'them']
    lines.push('', `${names} ${verb} read only because Forge cannot yet write ${noun}.`)
  }
  return lines
}
