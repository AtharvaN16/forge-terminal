import { basename } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { CallToolResult } from '@modelcontextprotocol/server'
import type { CompressIntent, ConvertIntent, PageOpIntent } from '../cli/args.js'
import { type RunReport, runIntent } from '../cli/execute.js'
import { formatMatrix } from '../core/capabilities.js'
import { parseHex } from '../core/colour/space.js'
import { type ForgeError, invalidArguments, isForgeError } from '../core/errors.js'
import { probeFiles } from '../core/probe-report.js'
import {
  errorJson,
  type FailureJson,
  formatsJson,
  type PaletteJson,
  probeJson,
  type RunJson,
  runJson,
  type ScaleJson,
} from '../core/report-data.js'
import { parseSize } from '../core/units.js'
import { VERSION } from '../shell/theme.js'
import type {
  CompressArgs,
  ConvertArgs,
  PaletteArgs,
  PdfArgs,
  ProbeArgs,
  ScaleArgs,
} from './schemas.js'

/**
 * The server's stdin is the protocol. Nothing a tool runs may prompt or read
 * it. An encrypted PDF takes the `password` argument or is refused.
 */
const NO_PROMPT = { interactive: false } as const

/**
 * The SDK runs tools/call requests concurrently. Each writing call checks its
 * outputs before writing, so two calls in flight could both pass the check and
 * the second rename would silently replace the first file (spec §3.5: never
 * overwrites unless overwrite:true). Writing calls therefore run one at a time.
 * Read-only tools do not wait. A failed call settles its link in the chain
 * like any other, so it never jams the ones behind it.
 */
let writes: Promise<unknown> = Promise.resolve()
function oneWriterAtATime<T>(work: () => Promise<T>): Promise<T> {
  const run = writes.then(work, work)
  writes = run.catch(() => undefined)
  return run
}

const runWriting = (intent: Parameters<typeof runIntent>[0]): Promise<RunReport> =>
  oneWriterAtATime(() => runIntent(intent, NO_PROMPT))

function failureLine(f: FailureJson): string {
  const where = f.path === undefined ? '' : ` (${f.path})`
  const hint = f.hint === undefined ? '' : ` ${f.hint}`
  return `✕ ${f.title}${where}: ${f.detail}${hint}`
}

/**
 * Spec §3.5: `structuredContent` in the §3.2 shape, a text summary, and a
 * `resource_link` per output. It never returns file contents. `isError` is set
 * when anything failed, and the same document still says what did succeed.
 */
function runResult(doc: RunJson): CallToolResult {
  const lines = doc.results.map((r) => `✓ ${r.source} → ${r.outputs.join(', ')}`)
  lines.push(...doc.failures.map(failureLine))
  const links = doc.results
    .flatMap((r) => r.outputs)
    .map((output) => ({
      type: 'resource_link' as const,
      uri: pathToFileURL(output).href,
      name: basename(output),
    }))
  return {
    content: [{ type: 'text', text: lines.join('\n') || 'Nothing to do.' }, ...links],
    structuredContent: { ...doc },
    isError: !doc.ok,
  }
}

const fromReport = (report: RunReport): CallToolResult => runResult(runJson(VERSION, report))
const refuse = (error: ForgeError): CallToolResult => runResult(errorJson(VERSION, error))

export async function probeTool(args: ProbeArgs): Promise<CallToolResult> {
  const doc = probeJson(VERSION, await probeFiles(args.paths))
  const lines = doc.probes.map((p) => {
    const size = p.pages === undefined ? `${p.width}×${p.height}` : `${p.pages} pages`
    return `${p.path}: ${p.format}, ${p.bytes} bytes, ${size}${p.encrypted ? ', password-protected' : ''}. Can become: ${p.targets.join(', ')}. Actions: ${p.actions.join(', ')}.`
  })
  lines.push(...doc.failures.map(failureLine))
  return {
    content: [{ type: 'text', text: lines.join('\n') }],
    structuredContent: { ...doc },
    isError: !doc.ok,
  }
}

export function formatsTool(): CallToolResult {
  const doc = formatsJson(VERSION, formatMatrix())
  const text = doc.formats
    .map((f) => {
      const can = f.read && f.write ? 'read and write' : f.read ? 'read only' : 'write only'
      return `${f.id} (${f.extensions.join(' ')}): ${can}`
    })
    .join('\n')
  return { content: [{ type: 'text', text }], structuredContent: { ...doc } }
}

export async function convertTool(args: ConvertArgs): Promise<CallToolResult> {
  const intent: ConvertIntent = {
    kind: 'convert',
    inputs: args.paths,
    target: args.to,
    options: {
      background: args.background ?? '#ffffff',
      keepMetadata: args.keepMetadata ?? false,
      ...(args.quality === undefined ? {} : { quality: args.quality }),
    },
    force: args.overwrite ?? false,
    recursive: args.recursive ?? false,
    debug: false,
    dpi: args.dpi ?? 150,
    passwordStdin: false,
    ...(args.output === undefined ? {} : { output: args.output }),
    ...(args.pages === undefined ? {} : { pages: args.pages }),
    ...(args.password === undefined ? {} : { password: args.password }),
  }
  return fromReport(await runWriting(intent))
}

export async function compressTool(args: CompressArgs): Promise<CallToolResult> {
  const intent: CompressIntent = {
    kind: 'compress',
    inputs: args.paths,
    options: { background: '#ffffff', keepMetadata: false },
    force: args.overwrite ?? false,
    recursive: false,
    debug: false,
  }
  if (args.quality !== undefined) intent.quality = args.quality
  if (args.maxSize !== undefined) {
    const maxBytes = parseSize(args.maxSize)
    if (maxBytes === undefined) {
      return refuse(
        invalidArguments(
          `${args.maxSize} is not a size.`,
          'Try a number with a unit, for example 500kb, 2mb or 1.5mb.',
        ),
      )
    }
    intent.maxBytes = maxBytes
  }
  if (args.dpi !== undefined) intent.dpi = args.dpi
  if (args.output !== undefined) intent.output = args.output
  return fromReport(await runWriting(intent))
}

/**
 * Builds the same `PageOpIntent` that `cli/args.ts` builds from flags. The
 * per-operation requirements it checks are the ones `parseArgs` enforces, and
 * they are reported in the same `invalid-arguments` shape.
 */
export async function pdfTool(args: PdfArgs): Promise<CallToolResult> {
  const intent: PageOpIntent = {
    kind: 'pageop',
    action: args.op,
    inputs: args.paths,
    force: args.overwrite ?? false,
    debug: false,
  }
  if (args.op === 'extract' || args.op === 'delete') {
    if (args.pages === undefined) {
      return refuse(invalidArguments(`${args.op} needs pages, for example "3-7,12".`))
    }
    intent.pages = args.pages
    if (args.op === 'extract' && args.separate === true) intent.separate = true
  }
  if (args.op === 'rotate') {
    if (args.degrees === undefined) {
      return refuse(invalidArguments('rotate needs degrees: 90, 180 or 270.'))
    }
    intent.rotate = args.degrees
  }
  if (args.op === 'split') {
    if (args.split === undefined) {
      return refuse(invalidArguments('split needs a split mode: every-page, every-n or points.'))
    }
    intent.split = args.split
  }
  return fromReport(await runWriting(intent))
}

/**
 * A refusal from a colour tool. Text only, no `structuredContent`: the error
 * document is RunOutput-shaped, and the tool's declared output schema is the
 * palette or scale document, which a refusal must not claim to be.
 */
function textError(text: string): CallToolResult {
  return { content: [{ type: 'text', text }], isError: true }
}

/**
 * Colour tools call the CLI's own runners with `json: true` and return the
 * very document `forge palette --json` prints, so the two cannot drift.
 */
export async function paletteTool(args: PaletteArgs): Promise<CallToolResult> {
  const inside = args.inside === undefined ? undefined : parseHex(args.inside)
  if (args.inside !== undefined && !inside) {
    return textError(`${args.inside} is not a colour. Try #RRGGBB.`)
  }
  try {
    const { runPalette } = await import('../cli/colour.js')
    const out = await runPalette(
      { kind: 'palette', input: args.path, svg: false, ...(inside ? { inside } : {}) },
      { json: true, colour: false },
    )
    const doc = JSON.parse(out.stdout[0] ?? '{}') as PaletteJson
    const text = doc.palette.colours.map((c) => `${c.hex} ${Math.round(c.share * 100)}%`).join('\n')
    return { content: [{ type: 'text', text }], structuredContent: { ...doc } }
  } catch (e) {
    if (isForgeError(e)) return textError(`${e.title}: ${e.detail}`)
    throw e
  }
}

export async function scaleTool(args: ScaleArgs): Promise<CallToolResult> {
  const colour = parseHex(args.colour)
  if (!colour) return textError(`${args.colour} is not a colour. Try #RRGGBB.`)
  const { runScale } = await import('../cli/colour.js')
  const out = await runScale({ kind: 'scale', colour, svg: false }, { json: true, colour: false })
  const doc = JSON.parse(out.stdout[0] ?? '{}') as ScaleJson
  const text = doc.scale.steps
    .map((s) => `${s.step} ${s.hex} white ${s.white} black ${s.black}`)
    .join('\n')
  return { content: [{ type: 'text', text }], structuredContent: { ...doc } }
}
