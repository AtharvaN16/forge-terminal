import { basename, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { CallToolResult } from '@modelcontextprotocol/server'
import type {
  ClipIntent,
  CompressIntent,
  ConvertIntent,
  EditIntent,
  ExtensionOpIntent,
  PageOpIntent,
  TranscribeIntent,
} from '../cli/args.js'
import { type ClipDeps, clipLines, runClip, runUndo } from '../cli/clip-command.js'
import { type RunReport, runIntent } from '../cli/execute.js'
import { formatMatrix } from '../core/capabilities.js'
import { type CardItem, card, scaleCard } from '../core/colour/card.js'
import { wholePercents } from '../core/colour/palette.js'
import { parseColour } from '../core/colour/parse.js'
import { scale } from '../core/colour/scale.js'
import { toHex } from '../core/colour/space.js'
import { type CropSpec, parseAspect } from '../core/crop.js'
import {
  clipboardUnavailable,
  type ForgeError,
  invalidArguments,
  isForgeError,
} from '../core/errors.js'
import { sniffKind } from '../core/folder.js'
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
import { DEFAULT_DETAIL } from '../core/transcribe/detail.js'
import { readLink } from '../core/transcribe/links.js'
import { clock } from '../core/transcribe/markdown.js'
import { parseSize } from '../core/units.js'
import type { ReadEvent, TranscribeEvent } from '../engines/transcribe.js'
import { VERSION } from '../shell/theme.js'
import { clipboardSupported, type Pasteboard, systemPasteboard } from '../utils/pasteboard.js'
import type {
  CardArgs,
  ClipArgs,
  CompressArgs,
  ConvertArgs,
  PaletteArgs,
  PdfArgs,
  ProbeArgs,
  ReadTextArgs,
  ScaleArgs,
  TranscribeArgs,
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

/** `signal` is the tool call's own: a client that cancels the call kills an extension's child. */
const runWriting = (
  intent: Parameters<typeof runIntent>[0],
  signal?: AbortSignal,
): Promise<RunReport> =>
  oneWriterAtATime(() =>
    runIntent(intent, signal === undefined ? NO_PROMPT : { ...NO_PROMPT, signal }),
  )

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

export async function convertTool(
  args: ConvertArgs,
  signal?: AbortSignal,
): Promise<CallToolResult> {
  const asked = [
    ...(args.sharpen === true ? ['sharpen'] : []),
    ...(args.boost !== undefined ? ['boost'] : []),
    ...(args.removeBackground === true ? ['removeBackground'] : []),
  ]
  const editing = args.trim === true || args.crop !== undefined || args.resize !== undefined
  if (editing) {
    // The CLI's own refusals for --trim/--crop/--resize beside another operation.
    const what = args.crop !== undefined ? 'crop' : args.trim === true ? 'trim' : 'resize'
    const clash = [
      ...(args.crop !== undefined && args.trim === true ? ['trim'] : []),
      ...asked,
      // Every edit works on images only: pages are refused with each, as the CLI does.
      ...(args.pages !== undefined ? ['pages'] : []),
    ][0]
    if (clash !== undefined) {
      return refuse(
        invalidArguments(
          `${what} cannot be combined with ${clash}.`,
          'Run them one after the other.',
        ),
      )
    }
    let crop: CropSpec | undefined
    if (args.crop !== undefined) {
      try {
        crop = { aspect: parseAspect(args.crop) }
      } catch (e) {
        if (!isForgeError(e)) throw e
        return refuse(invalidArguments(e.detail, 'Try crop "1:1" or "16:9".'))
      }
    }
    const edit: EditIntent = {
      kind: 'edit',
      inputs: args.paths,
      trim: args.trim === true,
      options: {
        background: args.background ?? '#ffffff',
        keepMetadata: args.keepMetadata ?? false,
        ...(args.quality === undefined ? {} : { quality: args.quality }),
      },
      force: args.overwrite ?? false,
      recursive: args.recursive ?? false,
      debug: false,
      ...(crop === undefined ? {} : { crop }),
      ...(args.resize === undefined ? {} : { resize: args.resize }),
      ...(args.to === undefined ? {} : { target: args.to }),
      ...(args.output === undefined ? {} : { output: args.output }),
    }
    return fromReport(await runWriting(edit))
  }
  if (args.to === undefined) {
    return refuse(
      invalidArguments(
        'forge_convert needs `to`, the target format.',
        "Only trim, crop and resize may leave it out, to keep each image's own format.",
      ),
    )
  }
  const to = args.to
  if (asked.length > 0) {
    if (asked.length > 1) {
      return refuse(invalidArguments(`Use one operation at a time — got ${asked.join(' and ')}.`))
    }
    const scale = args.sharpen === true ? 1 : args.boost
    // Same intent the CLI builds from --sharpen / --boost / --remove-bg, and the same
    // checks: the extension must be installed, and a cutout needs alpha.
    const op: ExtensionOpIntent = {
      kind: 'extension-op',
      op: scale !== undefined ? 'boost' : 'remove-background',
      inputs: args.paths,
      target: to,
      options: {
        background: args.background ?? '#ffffff',
        keepMetadata: args.keepMetadata ?? false,
        ...(args.quality === undefined ? {} : { quality: args.quality }),
      },
      force: args.overwrite ?? false,
      recursive: args.recursive ?? false,
      debug: false,
      ...(scale === undefined ? {} : { scale }),
      ...(args.output === undefined ? {} : { output: args.output }),
    }
    return fromReport(await runWriting(op, signal))
  }
  const intent: ConvertIntent = {
    kind: 'convert',
    inputs: args.paths,
    target: to,
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
 * `forge clip` for an agent: the copied image, compressed or converted and
 * put back. Serialised with the other writing tools, since a clipboard is as
 * shared as a folder.
 */
export async function clipTool(args: ClipArgs, deps: ClipDeps = {}): Promise<CallToolResult> {
  try {
    if (args.undo) {
      await oneWriterAtATime(() => runUndo(deps))
      return {
        content: [{ type: 'text', text: '✓ The original is back on the clipboard' }],
        structuredContent: {
          ...runJson(VERSION, { results: [], failures: [] }),
          clipboard: 'restored',
        },
        isError: false,
      }
    }
    const intent: ClipIntent = { kind: 'clip', undo: false, debug: false }
    if (args.to !== undefined) intent.target = args.to
    if (args.quality !== undefined) intent.quality = args.quality
    if (args.save !== undefined) intent.save = args.save
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
    const outcome = await oneWriterAtATime(() => runClip(intent, { ...NO_PROMPT, clip: deps }))
    if (outcome.status === 'failed') return fromReport(outcome.report)
    const doc = runJson(VERSION, outcome.report)
    const result = runResult(doc)
    return {
      ...result,
      content: [
        { type: 'text', text: clipLines(outcome).join('\n') },
        ...(result.content ?? []).slice(1),
      ],
      structuredContent: {
        ...doc,
        clipboard: outcome.status,
        ...(outcome.saved === undefined ? {} : { saved: outcome.saved }),
      },
    }
  } catch (e) {
    if (!isForgeError(e)) throw e
    return refuse(e)
  }
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

/** Where a card goes when asked: the clipboard forge_clip uses, or the system's. */
function pasteboardOf(deps: ClipDeps): Pasteboard {
  if (deps.pasteboard) return deps.pasteboard
  if (!clipboardSupported()) throw clipboardUnavailable()
  return systemPasteboard()
}

const PASTE = process.platform === 'darwin' ? '⌘V' : 'Ctrl+V'

/**
 * A colour tool's card, as asked: handed back (`svg`), put on the clipboard
 * (`copy`), or both. Copied, it is plain text only, as the app's c copies it,
 * so Figma pastes shapes. Copied and not asked for, it is not handed back:
 * the agent has no use for the SVG and it would fill its context.
 */
async function withCard(
  base: CallToolResult,
  svg: () => string,
  want: { svg?: boolean | undefined; copy?: boolean | undefined; swatches: number },
  deps: ClipDeps,
): Promise<CallToolResult> {
  if (!want.svg && !want.copy) return base
  const card = svg()
  const content = [...base.content]
  if (want.copy) {
    try {
      await pasteboardOf(deps).writeText(card, '')
    } catch (e) {
      const why = isForgeError(e) ? e.detail : e instanceof Error ? e.message : String(e)
      return textError(`The card could not be put on the clipboard: ${why}`)
    }
    const n = want.swatches
    content.push({
      type: 'text',
      text: `Copied a card of ${n} swatch${n === 1 ? '' : 'es'} to the clipboard. Paste it into Figma with ${PASTE}: one layer per colour.`,
    })
  }
  if (want.svg) content.push({ type: 'text', text: card })
  return { ...base, content }
}

/**
 * Colour tools call the CLI's own runners and readers, and return the very
 * document `forge palette --json` prints, so the two cannot drift.
 */
export async function paletteTool(args: PaletteArgs, deps: ClipDeps = {}): Promise<CallToolResult> {
  const inside = args.inside === undefined ? undefined : parseColour(args.inside)?.rgb
  if (args.inside !== undefined && !inside) {
    return textError(`${args.inside} is not a colour. Try #RRGGBB.`)
  }
  try {
    const { readPalette } = await import('../cli/colour.js')
    const read = await readPalette({
      kind: 'palette',
      input: args.path,
      svg: false,
      ...(inside ? { inside } : {}),
    })
    const doc = read.doc as PaletteJson
    const pcts = wholePercents(doc.palette.colours.map((c) => c.share))
    const text = doc.palette.colours.map((c, i) => `${c.hex} ${pcts[i]}%`).join('\n')
    const base: CallToolResult = {
      content: [{ type: 'text', text }],
      structuredContent: { ...doc },
    }
    return await withCard(
      base,
      read.svg,
      { svg: args.svg, copy: args.copy, swatches: doc.palette.colours.length },
      deps,
    )
  } catch (e) {
    if (isForgeError(e)) return textError(`${e.title}: ${e.detail}${e.hint ? ` ${e.hint}` : ''}`)
    throw e
  }
}

export async function scaleTool(args: ScaleArgs, deps: ClipDeps = {}): Promise<CallToolResult> {
  const colour = parseColour(args.colour)?.rgb
  if (!colour) {
    return textError(
      `${args.colour} is not a colour. Try #RRGGBB, rgb(), hsl(), oklch() or a colour name.`,
    )
  }
  const { runScale } = await import('../cli/colour.js')
  const out = await runScale({ kind: 'scale', colour, svg: false }, { json: true, colour: false })
  const doc = JSON.parse(out.stdout[0] ?? '{}') as ScaleJson
  const text = doc.scale.steps
    .map((s) => `${s.step} ${s.hex} white ${s.white} black ${s.black}`)
    .join('\n')
  const base: CallToolResult = { content: [{ type: 'text', text }], structuredContent: { ...doc } }
  const svg = () => scaleCard(colour, scale(colour))
  return withCard(
    base,
    svg,
    { svg: args.svg, copy: args.copy, swatches: doc.scale.steps.length },
    deps,
  )
}

/**
 * Colours an agent was given in words, drawn as the same card `forge scale
 * --svg` prints. The SVG is the whole answer: piped to the clipboard, Figma
 * pastes it as one layer per colour, named as written. Any entry that is not
 * a colour refuses the card, every bad one listed, so nothing half-right lands.
 */
export async function cardTool(args: CardArgs, deps: ClipDeps = {}): Promise<CallToolResult> {
  const items: CardItem[] = []
  const bad: string[] = []
  for (const { name, colour } of args.colours) {
    const parsed = parseColour(colour)
    if (!parsed) {
      bad.push(`${name}: ${colour}`)
      continue
    }
    const hex = toHex(parsed.rgb)
    const alpha = parsed.alpha !== undefined && parsed.alpha < 1 ? parsed.alpha : undefined
    items.push({
      id: name,
      name,
      value: alpha === undefined ? hex : `${hex} ${Math.round(alpha * 100)}%`,
      hex,
      ...(alpha === undefined ? {} : { alpha }),
    })
  }
  if (bad.length > 0) {
    return textError(
      `Not ${bad.length === 1 ? 'a colour' : 'colours'}: ${bad.join(', ')}. Try #RRGGBB, rgb(), hsl(), oklch() or a colour name.`,
    )
  }
  const n = items.length
  const subtitle = args.subtitle ?? `${n} colour${n === 1 ? '' : 's'}`
  const svg = () => card(args.title, subtitle, items, args.theme, { perRow: 8 })
  // The card is this tool's answer, so it is handed back unless it was copied instead.
  if (!args.copy) return { content: [{ type: 'text', text: svg() }] }
  return withCard({ content: [] }, svg, { copy: true, swatches: n }, deps)
}

// ── Transcribe and read text ─────────────────────────────────────────────

/** What a long tool call can say while it runs, when the client asked (MCP progress). */
export interface Progress {
  signal?: AbortSignal
  /** Called with each fact; nothing when the client gave no progress token. */
  report?: (message: string) => void
}

/** Speech models and Vision are heavy: one at a time, apart from the file writes. */
let listening: Promise<unknown> = Promise.resolve()
function oneListenerAtATime<T>(work: () => Promise<T>): Promise<T> {
  const run = listening.then(work, work)
  listening = run.catch(() => undefined)
  return run
}

/** An hour's transcript is ~60,000 characters; past this the file holds the rest. */
const MAX_TEXT = 200_000

function factOf(e: TranscribeEvent | ReadEvent): string {
  if (e.kind === 'model') return `getting the speech model, ${Math.round(e.fraction * 100)}%`
  if (e.kind === 'heard') return `heard ${clock(e.seconds)} of ${clock(e.of)}`
  if (e.kind === 'notes') return `writing notes, part ${e.part} of ${e.of}`
  return `reading page ${e.page} of ${e.of}`
}

async function defaultFolder(deps: { folder?: string }): Promise<string> {
  if (deps.folder !== undefined) return deps.folder
  const { loadPreferences, expandTilde } = await import('../config/preferences.js')
  return expandTilde((await loadPreferences()).prefs.defaultOutput)
}

/**
 * `forge transcribe` for an agent. Unlike the other tools, the reply carries
 * the file's contents, as Markdown whatever was written: an agent asks
 * because it cannot listen or read a scan, so the words are the answer
 * (colour spec's MCP note; transcribe spec §4.5). The file is still written,
 * and linked, as the CLI writes it.
 */
export async function transcribeTool(
  args: TranscribeArgs,
  progress: Progress = {},
  deps: { folder?: string } = {},
): Promise<CallToolResult> {
  const link = readLink(args.source) !== undefined
  const folder = link && args.output === undefined ? await defaultFolder(deps) : undefined
  const intent: TranscribeIntent = {
    kind: 'transcribe',
    input: args.source,
    notes: args.to !== 'transcript',
    transcript: args.to !== 'notes',
    ...(args.to === undefined ? {} : { to: args.to }),
    detail: args.detail ?? DEFAULT_DETAIL,
    ...(args.language === undefined ? {} : { language: args.language }),
    ...(args.format === undefined ? {} : { format: args.format }),
    ...(folder !== undefined
      ? { output: `${folder}${sep}` }
      : args.output === undefined
        ? {}
        : { output: args.output }),
    force: args.overwrite === true,
    debug: false,
  }
  const out: string[] = []
  const err: string[] = []
  let doc: { path: string; markdown: string } | undefined
  const { runTranscribeCommand } = await import('../cli/transcribe-command.js')
  const code = await oneListenerAtATime(() =>
    runTranscribeCommand(intent, {
      out: (l) => out.push(l),
      err: (l) => err.push(l),
      ...(progress.signal ? { signal: progress.signal } : {}),
      ...(progress.report ? { onProgress: (e) => progress.report?.(factOf(e)) } : {}),
      document: (d) => {
        doc = d
      },
    }),
  )
  const said = (lines: string[]) =>
    lines
      .map((l) => l.trim())
      .filter(Boolean)
      .join(' ')
  if (code !== 0 || doc === undefined) return textError(said(err) || 'Transcribe failed.')
  const { path, markdown } = doc
  const text =
    markdown.length > MAX_TEXT
      ? `${markdown.slice(0, MAX_TEXT)}\n\n[The rest is in ${path}]`
      : markdown
  return {
    content: [
      { type: 'text', text: [...out, ...err].join('\n') },
      { type: 'resource_link', uri: pathToFileURL(path).href, name: basename(path) },
      { type: 'text', text },
    ],
  }
}

/** `forge_read_text`: the same as transcribe on a picture or PDF; a recording is transcribe's. */
export async function readTextTool(
  args: ReadTextArgs,
  progress: Progress = {},
): Promise<CallToolResult> {
  const kind = await sniffKind(args.path).catch(() => undefined)
  if (kind === 'video' || kind === 'audio') {
    return textError(
      `${basename(args.path)} is a recording, not a picture or PDF. Use forge_transcribe for what is said in it.`,
    )
  }
  const { path, ...rest } = args
  return transcribeTool({ source: path, ...rest }, progress)
}
