import { Command, CommanderError } from 'commander'
import { parseColour } from '../core/colour/parse.js'
import type { Rgb } from '../core/colour/space.js'
import { parseAspect } from '../core/crop.js'
import { invalidArguments, invalidDpi } from '../core/errors.js'
import type { BoostScale } from '../core/extension-targets.js'
import { removeBackgroundTargetRefusal } from '../core/extension-targets.js'
import { formatById } from '../core/formats.js'
import { RESIZE_MAX } from '../core/resize.js'
import { parseCut } from '../core/timecode.js'
import { DEFAULT_DETAIL, DETAILS, type Detail } from '../core/transcribe/detail.js'
import { OUTPUTS, type Output } from '../core/transcribe/output.js'
import type { ConvertOptions, CropSpec, FormatId, MediaOptions, ResizeSpec } from '../core/types.js'
import { parseSize } from '../core/units.js'
import { VERSION } from '../shell/theme.js'
import { CONFIG_KEYS, type ConfigIntent, type ConfigKey } from './config-command.js'

export interface ConvertIntent {
  kind: 'convert'
  inputs: string[]
  target: FormatId
  output?: string
  options: ConvertOptions
  force: boolean
  recursive: boolean
  concurrency?: number
  debug: boolean
  /** Rasterisation resolution, 36-600. Only meaningful when a source is a PDF. */
  dpi?: number
  /** Raw range text from --pages, e.g. "3-7,12" — unparsed, since the page count needed to validate it is only known once a source is probed. */
  pages?: string
  /** Read an encrypted source's password from stdin instead of prompting. */
  passwordStdin?: boolean
  /**
   * An encrypted source's password, supplied directly. Only the MCP server sets
   * this, from its tool argument. The CLI has no flag for it, by design
   * (invariant 8: never from argv).
   */
  password?: string
  /**
   * Set by --max-size alongside --to: the converted file must fit this many
   * bytes, and the search decides the quality. It used to be parsed and then
   * dropped on this path (spec §4.6).
   */
  maxBytes?: number
}

/**
 * Compression through flags. `--quality` without `--to` has been reserved for
 * this since the original spec (§315) and errored until now with "No target
 * format given".
 */
export interface CompressIntent {
  kind: 'compress'
  inputs: string[]
  /** Set by --quality. Mutually exclusive with maxBytes. */
  quality?: number
  /** Set by --max-size. The search decides the quality. */
  maxBytes?: number
  /**
   * Set by --dpi. Only meaningful for a PDF, where compression can also
   * reduce image resolution — by far the larger of the two levers. Absent
   * means the 150 dpi default; pass the scan's own resolution to keep every
   * pixel and trade only quality.
   */
  dpi?: number
  /**
   * Set by -o. A directory receives `<name>-small.<ext>`; a filename is used
   * as-is — the same file-or-directory reading a conversion's `--output` gets
   * from `looksLikeDirectory`. Absent means beside the source.
   */
  output?: string
  options: ConvertOptions
  force: boolean
  recursive: boolean
  concurrency?: number
  debug: boolean
}

/**
 * A page operation on one or more PDFs: merge, split, extract, delete or
 * rotate. Kept as its own `kind` — distinct from `ConvertIntent` — because it
 * has no target format and, for split/extract/delete/rotate, exactly one
 * input rather than a batch. `action` mirrors `Action['id']` from
 * `core/actions`, which is how `execute()` looks the action up.
 */
export interface PageOpIntent {
  kind: 'pageop'
  action: 'merge' | 'split' | 'extract' | 'delete' | 'rotate'
  inputs: string[]
  /** Raw range text for --extract / --delete, parsed once the page count is known. */
  pages?: string
  /** With --extract, write one file per page instead of one file. */
  separate?: boolean
  /** Degrees for --rotate: 90, 180 or 270. */
  rotate?: number
  split?:
    | { mode: 'every-page' }
    | { mode: 'every-n'; n: number }
    | { mode: 'points'; after: number[] }
  /** Overrides write-safety's refusal to replace an existing file or an input. */
  force: boolean
  debug: boolean
}

/**
 * `--sharpen`, `--boost [2|3|4]` and `--remove-bg`: an image operation run by an optional
 * extension (spec §5). Its own `kind` because it has an operation where a
 * conversion has only a target, and it fails differently when the extension
 * is absent.
 */
export interface ExtensionOpIntent {
  kind: 'extension-op'
  op: 'boost' | 'remove-background'
  /** Only for boost; 1 is `--sharpen`. */
  scale?: 1 | BoostScale
  inputs: string[]
  /** The output format. PNG unless `--to` says otherwise. */
  target: FormatId
  output?: string
  options: ConvertOptions
  force: boolean
  recursive: boolean
  concurrency?: number
  debug: boolean
}

/**
 * `--trim`, `--crop`, `--resize`, `--width`, `--height`: cut empty edges or
 * cut to a shape, and/or change the size, keeping the source's own format
 * unless `--to` says otherwise (resize-and-trim spec §3.4, crop spec §3.3). The work is options on an ordinary convert job
 * (`planEdit`); the intent is its own `kind` because there may be no target.
 */
/**
 * `--preset name`: run a preset saved from Done (mockups/presets-2026-10.html)
 * on each input. The preset says what to do and where to save; `--output`
 * and `--force` are the only things that change it.
 */
export interface PresetIntent {
  kind: 'preset'
  inputs: string[]
  name: string
  output?: string
  force: boolean
  recursive: boolean
  debug: boolean
  /**
   * A name taken becomes `photo (1).jpg` rather than a refusal: the
   * right-click menu's preset items, which have no one to ask.
   */
  keepBoth?: boolean
}

export interface EditIntent {
  kind: 'edit'
  inputs: string[]
  trim: boolean
  /** Never with `trim`. No box: the engine places the largest by attention. */
  crop?: CropSpec
  resize?: ResizeSpec
  /** Absent means each source's own format. */
  target?: FormatId
  output?: string
  options: ConvertOptions
  /** A video's or sound file's cut, mute, speed…; refused for an image. */
  media?: MediaOptions
  force: boolean
  recursive: boolean
  concurrency?: number
  debug: boolean
}

/** `forge probe <files...>`: what each file is and what Forge can do with it (spec §3.3). */
export interface ProbeIntent {
  kind: 'probe'
  inputs: string[]
}

/** `forge extensions [add|remove <id>]`: the optional extras, offline by default. */
export interface ExtensionsIntent {
  kind: 'extensions'
  action: 'list' | 'add' | 'remove'
  id?: string
}

/** `forge palette <image>`: an image's main colours (colour spec §7.1). */
export interface PaletteIntent {
  kind: 'palette'
  input: string
  /** `--inside <hex>`: the shades of the palette colour nearest this one. */
  inside?: Rgb
  svg: boolean
}

/** `forge scale <colour>`: 50–950 with the colour at 500. */
export interface ScaleIntent {
  kind: 'scale'
  colour: Rgb
  svg: boolean
}

/**
 * `forge clip`: the copied image, compressed (or with `--to`, converted) and
 * put back on the clipboard. No inputs: the clipboard is the input and the
 * destination.
 */
export interface ClipIntent {
  kind: 'clip'
  /** Put the last original back instead. Takes no other flag. */
  undo: boolean
  target?: FormatId
  quality?: number
  maxBytes?: number
  /** Also write the result to a folder; `true` is the default folder. */
  save?: string | true
  debug: boolean
}

/**
 * `forge watch <folder> --to <format>`: converts what the folder holds, then
 * every file that lands in it, until ctrl-c. One folder, one level, as a
 * folder drop reads it.
 */
export interface WatchIntent {
  kind: 'watch'
  folder: string
  target: FormatId
  quality?: number
  /** A PDF rendered to an image: 36-600, 150 when not given. */
  dpi?: number
  /** Where outputs go; beside each file when not given. */
  output?: string
  /** Leave what is there alone; convert only what lands. */
  newOnly: boolean
  debug: boolean
}

/**
 * `forge transcribe <file|link>`: a video or audio file, or a YouTube link,
 * into a Markdown, Word, PDF or text file (spec 2026-10-17-transcribe-design §4.5).
 */
export interface TranscribeIntent {
  kind: 'transcribe'
  /** A path or a link, as typed. */
  input: string
  /** Summary and notes (`--to all`, the default, and `--to notes`). */
  notes: boolean
  /** The transcript itself: false for `--to notes`, the notes alone. */
  transcript: boolean
  /** How much the notes say (`--detail`); no effect on a transcript alone. */
  detail: Detail
  /** The spoken language, when it is not the Mac's own: `hi`, `fr-FR`. */
  language?: string
  /** `--format`; when absent, `-o`'s extension if it is one of ours, else Markdown. */
  format?: Output
  output?: string
  force: boolean
  debug: boolean
}

export type Intent =
  | TranscribeIntent
  | WatchIntent
  | ClipIntent
  | ConvertIntent
  | CompressIntent
  | PageOpIntent
  | ExtensionOpIntent
  | EditIntent
  | PresetIntent
  | ProbeIntent
  | ExtensionsIntent
  | PaletteIntent
  | ScaleIntent
  | { kind: 'formats' }
  | { kind: 'shell' }
  /** `forge update`: check npm now and install a newer Forge. */
  | { kind: 'update' }
  /** `forge uninstall`: take the right-click menu out, then have npm remove Forge. */
  | { kind: 'uninstall' }
  | ConfigIntent

/**
 * `config` is parsed before Commander sees the argv at all. Commander is
 * configured with a variadic `[inputs...]` argument, so it would otherwise
 * take `config` for a filename and `set`/`output` for two more — the
 * subcommand has to be claimed first or it is indistinguishable from a
 * conversion of three files that do not exist.
 */
function parseConfigArgs(argv: string[]): ConfigIntent {
  const [, action, key, ...rest] = argv

  if (action === undefined || action === 'list') return { kind: 'config', action: 'list' }
  if (action === 'path') return { kind: 'config', action: 'path' }

  if (action === 'set') {
    if (key === undefined || !CONFIG_KEYS.includes(key as ConfigKey)) {
      throw invalidArguments(
        `Unknown config setting ${key ?? '(none)'}.`,
        `Try one of: ${CONFIG_KEYS.join(', ')}.`,
      )
    }
    // Joined rather than taken as a single token: an unquoted path with a
    // space in it arrives as several argv entries, and rejecting that would
    // be a papercut on exactly the folders people actually have.
    const value = rest.join(' ')
    if (value.length === 0) throw invalidArguments(`forge config set ${key} needs a value.`)
    return { kind: 'config', action: 'set', key: key as ConfigKey, value }
  }

  throw invalidArguments(
    `Unknown config action ${action}.`,
    'Try: forge config list, forge config set <setting> <value>, or forge config path.',
  )
}

const ALIASES: Record<string, string> = { jpg: 'jpeg', tif: 'tiff', heif: 'heic' }

function parseTarget(raw: string): FormatId {
  const key = raw.toLowerCase().replace(/^\./, '')
  const spec = formatById(ALIASES[key] ?? key)
  if (!spec) {
    throw invalidArguments(
      `${raw} is not a format Forge knows.`,
      'Run forge --formats to see what is available.',
    )
  }
  return spec.id
}

/** A number from a flag, within bounds, or a refusal that names the flag. */
function bounded(flag: string, raw: unknown, min: number, max: number, example: string): number {
  const n = Number(String(raw).replace(/k$/i, ''))
  if (!Number.isFinite(n) || n < min || n > max) {
    throw invalidArguments(
      `${flag} takes ${min} to ${max}, not ${raw}.`,
      `For example ${flag} ${example}.`,
    )
  }
  return n
}

/** --cut, --mute, --speed, --fps, --bitrate and --loudness (video spec §3.8). */
function parseMediaFlags(opts: Record<string, unknown>): MediaOptions | undefined {
  const m: MediaOptions = {}
  if (opts.cut !== undefined) {
    const cut = parseCut(String(opts.cut))
    if (!cut) {
      throw invalidArguments(
        `--cut takes a start and an end, the end after the start, not ${opts.cut}.`,
        'For example --cut 0:03.2-0:41, or --cut 0:10- to keep from 0:10 to the end.',
      )
    }
    m.cut = cut.end === undefined ? { start: cut.start } : { start: cut.start, end: cut.end }
  }
  if (opts.mute) m.mute = true
  if (opts.speed !== undefined) m.speed = bounded('--speed', opts.speed, 0.25, 4, '2')
  if (opts.fps !== undefined) m.fps = bounded('--fps', opts.fps, 1, 120, '30')
  if (opts.bitrate !== undefined) {
    m.bitrate = Math.round(bounded('--bitrate', opts.bitrate, 32, 320, '128k'))
  }
  if (opts.loudness !== undefined) m.loudness = bounded('--loudness', opts.loudness, -70, -5, '-16')
  return Object.keys(m).length ? m : undefined
}

function parseQuality(raw: string): number {
  const n = Number(raw)
  if (!Number.isInteger(n) || n < 1 || n > 100) {
    throw invalidArguments(`Quality must be a whole number between 1 and 100, not ${raw}.`)
  }
  return n
}

function wholePixels(flag: string, raw: unknown): number {
  const n = /^\d+$/.test(String(raw)) ? Number(raw) : Number.NaN
  if (!Number.isInteger(n) || n < 1) {
    throw invalidArguments(`${flag} takes a whole number of pixels, at least 1, not ${raw}.`)
  }
  return n
}

/** `--resize 50%` or `--resize 50`: a percent of the upright size, 1-200. */
function parsePercent(raw: unknown): number {
  const text = String(raw)
  const n = /^\d+(\.\d+)?%?$/.test(text) ? Number.parseFloat(text) : Number.NaN
  if (!(n >= 1 && n <= RESIZE_MAX)) {
    throw invalidArguments(
      `--resize takes a percent from 1 to ${RESIZE_MAX}, not ${raw}.`,
      'Try --resize 50% to halve, or --width 1200 for an exact width.',
    )
  }
  return n
}

function parseConcurrency(raw: string): number {
  const n = Number(raw)
  if (!Number.isInteger(n) || n < 1) {
    throw invalidArguments(`Concurrency must be a positive whole number, not ${raw}.`)
  }
  return n
}

/**
 * The exit-code contract (spec §3.4), printed under --help and in the README.
 * The rule behind it: if the same flags could succeed on a different file, a
 * refusal is 1; otherwise it is 2.
 */
export const EXIT_CODES_HELP = `
Exit codes:
  0  every input succeeded
  1  the command was understood, and at least one input failed or was refused
  2  the command itself was invalid: an unknown flag, a missing argument, contradictory flags`

/** The subcommands Commander does not know about, because `parseArgs` claims them first. */
export const COMMANDS_HELP = `
Other commands:
  forge probe <files...>   what each file is and what Forge can do with it
  forge palette <image>    an image's main colours (--json, --svg, --inside <hex>)
  forge scale <colour>     50–950 from one colour, with it at 500 (--json, --svg)
  forge clip               compress the copied image and put it back (--to, --quality,
                           --max-size, --save [folder], --undo)
  forge transcribe <file | link>
                           a video or audio file, or a YouTube link, into notes
                           (--to all | notes | transcript, --detail brief | standard | detailed,
                           --format md | docx | pdf | txt, --language <id>, -o <path>, --force)
  forge watch <folder> --to <format>
                           convert the folder, then every file added to it, until ctrl-c
                           (--quality, --dpi, -o <folder>, --new-only, --json)
  forge config [list | path | set <setting> <value>]
  forge extensions [add | remove <id>]   optional extras, such as boost and remove-background
  forge update             install a newer Forge, if there is one
  forge uninstall          take Forge out of the right-click menu, then remove it
  forge mcp               run as a local MCP server over stdio, for AI agents`

function parseMaxSize(raw: unknown): number {
  const bytes = parseSize(String(raw))
  if (bytes === undefined) {
    throw invalidArguments(
      `${raw} is not a size.`,
      'Try a number with a unit, for example 500kb, 2mb or 1.5mb.',
    )
  }
  return bytes
}

/**
 * Claimed before Commander for the same reason `config` is: Commander's
 * variadic `[inputs...]` would otherwise read `probe` as a filename. Probe
 * takes files and `--json` (read by `wantsJson`), and nothing else. A
 * conversion flag here is a mistake worth naming, not one to ignore.
 */
function parseProbeArgs(argv: string[]): ProbeIntent {
  const rest = argv.slice(1).filter((a) => a !== '--json')
  const flag = rest.find((a) => a.startsWith('-'))
  if (flag !== undefined) {
    throw invalidArguments(
      `forge probe takes files, not ${flag}.`,
      'Try: forge probe photo.jpg --json',
    )
  }
  if (rest.length === 0) {
    throw invalidArguments(
      'No files given.',
      'Name a file, for example: forge probe scan.pdf --json',
    )
  }
  return { kind: 'probe', inputs: rest }
}

/**
 * Claimed before Commander, like `probe`. Hand-read because `--save` takes an
 * optional folder, and Commander's optional value would swallow whatever
 * follows it.
 */
function parseClipArgs(argv: string[]): ClipIntent {
  const intent: ClipIntent = { kind: 'clip', undo: false, debug: false }
  const rest = argv.slice(1)
  const value = (flag: string, i: number): string => {
    const v = rest[i + 1]
    if (v === undefined || v.startsWith('-')) throw invalidArguments(`${flag} needs a value.`)
    return v
  }
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i] as string
    if (a === '--json') continue
    else if (a === '--debug') intent.debug = true
    else if (a === '--undo') intent.undo = true
    else if (a === '--to' || a === '-t') intent.target = parseTarget(value(a, i++))
    else if (a === '--quality' || a === '-q') intent.quality = parseQuality(value(a, i++))
    else if (a === '--max-size') intent.maxBytes = parseMaxSize(value(a, i++))
    else if (a === '--save') {
      const next = rest[i + 1]
      intent.save = next === undefined || next.startsWith('-') ? true : (rest[++i] as string)
    } else if (a.startsWith('-')) {
      throw invalidArguments(`forge clip does not take ${a}.`, 'Try: forge --help')
    } else {
      throw invalidArguments(
        `forge clip takes no files: it reads the clipboard, not ${a}.`,
        `To compress a file, try: forge ${a} --quality 80`,
      )
    }
  }
  if (intent.undo && Object.keys(intent).some((k) => !['kind', 'undo', 'debug'].includes(k))) {
    throw invalidArguments('--undo takes no other flag.', 'Try: forge clip --undo')
  }
  if (intent.quality !== undefined && intent.maxBytes !== undefined) {
    throw invalidArguments(
      'Use either --quality or --max-size, not both.',
      'They are two ways of asking for the same thing, and Forge will not guess which wins.',
    )
  }
  return intent
}

/** Claimed before Commander, like `watch`, and read by hand the same way. */
function parseTranscribeArgs(argv: string[]): TranscribeIntent {
  const rest = argv.slice(1)
  const inputs: string[] = []
  const intent: TranscribeIntent = {
    kind: 'transcribe',
    input: '',
    notes: true,
    transcript: true,
    detail: DEFAULT_DETAIL,
    force: false,
    debug: false,
  }
  const value = (flag: string, i: number): string => {
    const v = rest[i + 1]
    if (v === undefined || v.startsWith('-')) throw invalidArguments(`${flag} needs a value.`)
    return v
  }
  const example = 'Try: forge transcribe talk.mp4'
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i] as string
    if (a === '--debug') intent.debug = true
    else if (a === '--force' || a === '-f') intent.force = true
    else if (a === '--language' || a === '-l') intent.language = value(a, i++)
    else if (a === '--output' || a === '-o') intent.output = value(a, i++)
    else if (a === '--detail') {
      const detail = value(a, i++).toLowerCase()
      if (!(DETAILS as readonly string[]).includes(detail)) {
        throw invalidArguments(
          `forge transcribe writes notes in brief, standard or detailed, not ${detail}.`,
          'Try: forge transcribe talk.mp4 --detail brief',
        )
      }
      intent.detail = detail as Detail
    } else if (a === '--format') {
      const named = value(a, i++).toLowerCase()
      const format = OUTPUTS.find((o) => o.id === named || o.label.toLowerCase() === named)
      if (format === undefined) {
        throw invalidArguments(
          `forge transcribe writes md, docx, pdf or txt, not ${named}.`,
          'Try: forge transcribe talk.mp4 --format pdf',
        )
      }
      intent.format = format.id
    } else if (a === '--to' || a === '-t') {
      const to = value(a, i++).toLowerCase()
      if (to !== 'all' && to !== 'notes' && to !== 'transcript') {
        throw invalidArguments(
          `forge transcribe makes all, notes or a transcript, not ${to}.`,
          'Try: forge transcribe talk.mp4 --to transcript',
        )
      }
      intent.notes = to !== 'transcript'
      intent.transcript = to !== 'notes'
    } else if (a.startsWith('-')) {
      throw invalidArguments(`forge transcribe does not take ${a}.`, example)
    } else inputs.push(a)
  }
  const [input, ...more] = inputs
  if (input === undefined)
    throw invalidArguments('forge transcribe needs a file or a link.', example)
  if (more.length > 0)
    throw invalidArguments('forge transcribe takes one file or link at a time.', example)
  return { ...intent, input }
}

/** Claimed before Commander, like `clip`, and read by hand the same way. */
function parseWatchArgs(argv: string[]): WatchIntent {
  const rest = argv.slice(1)
  const folders: string[] = []
  let target: FormatId | undefined
  const intent: Omit<WatchIntent, 'folder' | 'target'> = {
    kind: 'watch',
    newOnly: false,
    debug: false,
  }
  const extra: Partial<WatchIntent> = {}
  const value = (flag: string, i: number): string => {
    const v = rest[i + 1]
    if (v === undefined || v.startsWith('-')) throw invalidArguments(`${flag} needs a value.`)
    return v
  }
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i] as string
    if (a === '--json') continue
    else if (a === '--debug') intent.debug = true
    else if (a === '--new-only') intent.newOnly = true
    else if (a === '--to' || a === '-t') target = parseTarget(value(a, i++))
    else if (a === '--quality' || a === '-q') extra.quality = parseQuality(value(a, i++))
    else if (a === '--output' || a === '-o') extra.output = value(a, i++)
    else if (a === '--dpi') {
      const raw = value(a, i++)
      const dpi = Number(raw)
      if (!Number.isInteger(dpi) || dpi < 36 || dpi > 600) throw invalidDpi(raw)
      extra.dpi = dpi
    } else if (a.startsWith('-')) {
      throw invalidArguments(
        `forge watch does not take ${a}.`,
        'Try: forge watch ./images --to webp',
      )
    } else folders.push(a)
  }
  const [folder, ...more] = folders
  if (folder === undefined) {
    throw invalidArguments('forge watch needs a folder.', 'Try: forge watch ./images --to webp')
  }
  if (more.length > 0) {
    throw invalidArguments(
      'forge watch watches one folder at a time.',
      `Try: forge watch ${folder} --to webp`,
    )
  }
  if (target === undefined) {
    throw invalidArguments(
      'forge watch needs a format to convert to.',
      `Try: forge watch ${folder} --to webp`,
    )
  }
  return {
    kind: 'watch',
    folder,
    target,
    ...(extra.quality === undefined ? {} : { quality: extra.quality }),
    ...(extra.dpi === undefined ? {} : { dpi: extra.dpi }),
    ...(extra.output === undefined ? {} : { output: extra.output }),
    newOnly: intent.newOnly,
    debug: intent.debug,
  }
}

/** Claimed before Commander, like `probe` and `config`. Takes an action and an id, and `--json`. */
function parseExtensionsArgs(argv: string[]): ExtensionsIntent {
  const rest = argv.slice(1).filter((a) => a !== '--json')
  const flag = rest.find((a) => a.startsWith('-'))
  if (flag !== undefined) {
    throw invalidArguments(
      `forge extensions does not take ${flag}.`,
      'Try: forge extensions, forge extensions add <id>, or forge extensions remove <id>.',
    )
  }
  const [action, id, ...extra] = rest
  if (action === undefined) return { kind: 'extensions', action: 'list' }
  if (action !== 'add' && action !== 'remove') {
    throw invalidArguments(
      `Unknown extensions action ${action}.`,
      'Try: forge extensions, forge extensions add <id>, or forge extensions remove <id>.',
    )
  }
  if (id === undefined || extra.length > 0) {
    throw invalidArguments(
      `forge extensions ${action} takes exactly one extension.`,
      `Try: forge extensions ${action} boost`,
    )
  }
  return { kind: 'extensions', action, id }
}

function colourArg(raw: string | undefined): Rgb {
  if (raw === undefined) {
    throw invalidArguments(
      'No colour given.',
      "Try: forge scale 6579FD — or quote it, '#6579FD', because an unquoted # starts a comment in the shell.",
    )
  }
  // As the app's colour box reads it (colour spec §12.4): a transparency is read and left out.
  const rgb = parseColour(raw)?.rgb
  if (!rgb) {
    throw invalidArguments(
      `${raw} is not a colour.`,
      "Try a hex code (6579FD), rgb(), hsl(), oklch() or a colour name, quoted: 'rgb(101 121 253)'.",
    )
  }
  return rgb
}

/**
 * Claimed before Commander, like `probe`: Commander would read the word as a
 * filename. `--json` is read by `wantsJson`; `--svg` and `--inside <hex>` are
 * the only flags these take.
 */
const COLOUR_USAGE: Record<'palette' | 'scale', string> = {
  palette: `Usage: forge palette <image> [--json] [--svg] [--inside <hex>]

An image's main colours, most of the image first.
  --json            one JSON document: palette.colours[] with hex, rgb, oklch, share
  --svg             a card of swatches; pipe to pbcopy and paste into Figma
  --inside <hex>    the shades of the palette colour nearest <hex>
`,
  scale: `Usage: forge scale <colour> [--json] [--svg]

50–950 built in OKLCH, with <colour> at 500. Pass the hex without #, or quote it.
  --json            one JSON document: scale.steps[] with hex, oklch, white, black
  --svg             a card of swatches; pipe to pbcopy and paste into Figma
`,
}

function parseColourArgs(argv: string[]): PaletteIntent | ScaleIntent {
  const [cmd, ...rest] = argv
  if (rest.includes('--help') || rest.includes('-h')) {
    // As Commander does for `forge --help`: print, then end as help (exit 0).
    process.stdout.write(COLOUR_USAGE[cmd === 'scale' ? 'scale' : 'palette'])
    throw new CommanderError(0, 'commander.helpDisplayed', '(outputHelp)')
  }
  const args = rest.filter((a) => a !== '--json' && a !== '--svg')
  const svg = rest.includes('--svg')
  const at = args.indexOf('--inside')
  const insideRaw = at === -1 ? undefined : args[at + 1]
  if (at !== -1) args.splice(at, 2)
  const flag = args.find((a) => a.startsWith('-'))
  if (flag !== undefined) {
    throw invalidArguments(`forge ${cmd} does not take ${flag}.`, `Try: forge ${cmd} --help`)
  }
  if (cmd === 'scale') {
    if (at !== -1) {
      throw invalidArguments(
        '--inside is for forge palette.',
        'Try: forge palette photo.jpg --inside F26E69',
      )
    }
    if (args.length > 1)
      throw invalidArguments('forge scale takes one colour.', 'Try: forge scale 6579FD')
    return { kind: 'scale', colour: colourArg(args[0]), svg }
  }
  if (args.length !== 1) {
    throw invalidArguments(
      args.length === 0 ? 'No image given.' : 'forge palette takes one image.',
      'Try: forge palette photo.jpg',
    )
  }
  return {
    kind: 'palette',
    input: args[0] as string,
    svg,
    ...(at === -1 ? {} : { inside: colourArg(insideRaw) }),
  }
}

/**
 * Whether the caller asked for JSON. It is read from argv rather than from the
 * parsed intent because it has to be known even when parsing fails: an argument
 * error is reported in the same JSON shape as everything else (spec §3.2).
 * Reading stops at `--`, after which everything is a filename.
 */
export function wantsJson(argv: string[]): boolean {
  const end = argv.indexOf('--')
  return (end === -1 ? argv : argv.slice(0, end)).includes('--json')
}

/**
 * `--boost` takes an optional 2, 3 or 4. Commander's optional value would also
 * swallow a filename that follows (`forge --boost photo.jpg`), so it is read
 * here and removed before Commander sees the argv. Reading stops at `--`.
 */
function takeBoost(argv: string[]): { rest: string[]; scale?: BoostScale } {
  const end = argv.indexOf('--')
  const head = end === -1 ? argv : argv.slice(0, end)
  const tail = end === -1 ? [] : argv.slice(end)
  const rest: string[] = []
  let scale: BoostScale | undefined
  for (let i = 0; i < head.length; i++) {
    const a = head[i] as string
    const inline = a.startsWith('--boost=') ? a.slice('--boost='.length) : undefined
    if (a !== '--boost' && inline === undefined) {
      rest.push(a)
      continue
    }
    let raw = inline
    if (raw === undefined && /^\d+$/.test(head[i + 1] ?? '')) raw = head[++i]
    if (raw !== undefined && raw !== '2' && raw !== '3' && raw !== '4') {
      throw invalidArguments(
        `--boost takes 2, 3 or 4, not ${raw}.`,
        'Try --boost, --boost 2, --boost 3 or --boost 4.',
      )
    }
    scale = raw === '4' ? 4 : raw === '3' ? 3 : 2
  }
  return { rest: [...rest, ...tail], ...(scale === undefined ? {} : { scale }) }
}

export function parseArgs(rawArgv: string[]): Intent {
  const argv = rawArgv
  if (
    argv[0] === 'clip' ||
    argv[0] === 'watch' ||
    argv[0] === 'transcribe' ||
    argv[0] === 'config' ||
    argv[0] === 'probe' ||
    argv[0] === 'extensions' ||
    argv[0] === 'palette' ||
    argv[0] === 'scale' ||
    argv[0] === 'update' ||
    argv[0] === 'uninstall'
  ) {
    return parseSubcommand(argv)
  }
  const boosted = takeBoost(argv)
  return parseConversionArgs(boosted.rest, boosted.scale)
}

function parseSubcommand(argv: string[]): Intent {
  if (argv[0] === 'update') {
    const rest = argv.slice(1).filter((a) => a !== '--json')
    if (rest.length > 0) {
      throw invalidArguments(
        `forge update takes nothing else, got: ${rest.join(' ')}.`,
        'Try: forge update',
      )
    }
    return { kind: 'update' }
  }
  if (argv[0] === 'uninstall') {
    const rest = argv.slice(1)
    if (rest.length > 0) {
      throw invalidArguments(
        `forge uninstall takes nothing else, got: ${rest.join(' ')}.`,
        'Try: forge uninstall',
      )
    }
    return { kind: 'uninstall' }
  }
  if (argv[0] === 'clip') return parseClipArgs(argv)
  if (argv[0] === 'watch') return parseWatchArgs(argv)
  if (argv[0] === 'transcribe') return parseTranscribeArgs(argv)
  if (argv[0] === 'config') return parseConfigArgs(argv.filter((a) => a !== '--json'))
  if (argv[0] === 'probe') return parseProbeArgs(argv)
  if (argv[0] === 'palette' || argv[0] === 'scale') return parseColourArgs(argv)
  return parseExtensionsArgs(argv)
}

function parseConversionArgs(argv: string[], boost: BoostScale | undefined): Intent {
  const program = new Command()
    .name('forge')
    .description('Convert — transform your files from the terminal')
    .argument('[inputs...]', 'files, folders or globs')
    .option('-t, --to <format>', 'target format')
    .option('-o, --output <path>', 'output file or directory')
    .option('-q, --quality <n>', 'quality for lossy formats, 1-100')
    .option('--background <colour>', 'fill colour when flattening transparency', '#ffffff')
    .option('--keep-metadata', 'preserve EXIF and GPS data', false)
    .option('--recursive', 'descend into subfolders', false)
    .option('--force', 'allow overwriting existing files', false)
    .option('--max-size <size>', 'compress until the file fits, e.g. 500kb')
    .option('--concurrency <n>', 'how many files to convert at once')
    .option('--debug', 'show underlying errors', false)
    .option('--formats', 'list supported formats', false)
    .option('--merge', 'combine several PDFs into one')
    .option('--split <mode>', 'every-page | every=N | at=N,N')
    .option('--extract <pages>', 'keep only these pages, e.g. 3-7,12')
    .option('--delete <pages>', 'drop these pages')
    .option('--rotate <degrees>', '90, 180 or 270')
    .option('--separate', 'with --extract, write one file per page')
    .option('--sharpen', 'sharpen at the same size; needs the boost extension')
    .option(
      '--boost [2|3|4]',
      'sharpen and enlarge 2x (default), 3x or 4x; needs the boost extension',
    )
    .option('--trim', 'cut transparent or solid-colour edges; keeps the format')
    .option('--crop <W:H>', 'cut to a shape, e.g. 1:1, 4:5, 16:9; keeps the subject')
    .option('--resize <percent>', 'resize to a percent of the size, 1-200, e.g. 50%')
    .option('--width <px>', 'resize to this width; the height follows')
    .option('--height <px>', 'resize to this height; the width follows')
    .option('--remove-bg', 'cut out the subject; needs the remove-background extension')
    .option('--cut <start-end>', 'video or audio: keep from start to end, e.g. 0:03.2-0:41')
    .option('--mute', 'video: take the sound out')
    .option('--speed <x>', 'video or audio: play faster or slower, 0.25-4')
    .option('--fps <n>', 'video: frames per second')
    .option('--bitrate <kbps>', 'audio: bitrate, e.g. 128k')
    .option('--loudness <LUFS>', 'audio: even out loudness to this level, e.g. -16')
    .option('--preset <name>', 'run a preset saved from Done, e.g. --preset blog')
    .option('--pages <ranges>', 'with --to, which pages to render, e.g. 3-7,12')
    .option('--dpi <n>', 'rasterisation resolution, 36-600', '150')
    .option('--password-stdin', "read an encrypted PDF's password from stdin")
    .option('--json', 'print one JSON document on stdout instead of text')
    .helpOption('-h, --help', 'show this help')
    .version(VERSION, '-V, --version', 'show the version')
    .addHelpText('after', `${COMMANDS_HELP}\n${EXIT_CODES_HELP}`)
    .configureOutput({ outputError: () => {} })
    .exitOverride()
    .allowExcessArguments(false)

  try {
    program.parse(argv, { from: 'user' })
  } catch (e) {
    /**
     * Commander's own usage errors become Forge's, so they read like every
     * other refusal and can be reported as JSON. Commander no longer prints
     * them itself (`outputError` above). Help and version are not errors: they
     * are rethrown for src/index.ts to exit 0 on.
     */
    if (
      e instanceof CommanderError &&
      e.code !== 'commander.helpDisplayed' &&
      e.code !== 'commander.version'
    ) {
      // Commander appends a suggestion on a second line, in parentheses:
      // "unknown option '--tox'\n(Did you mean --to?)". That is a hint, not
      // part of what went wrong.
      const [first = '', ...rest] = e.message.replace(/^error: /, '').split('\n')
      const suggestion = rest
        .join(' ')
        .trim()
        .replace(/^\((.*)\)\.?$/, '$1')
      throw invalidArguments(
        `${first.charAt(0).toUpperCase()}${first.slice(1).replace(/\.$/, '')}.`,
        suggestion || 'Run forge --help to see what Forge accepts.',
      )
    }
    throw e
  }

  const opts = program.opts()
  const inputs = program.args

  if (opts.formats) return { kind: 'formats' }
  const media = parseMediaFlags(opts)
  if (media !== undefined && opts.trim) {
    throw invalidArguments(
      '--trim cuts the empty edges of an image.',
      'To keep part of a video or audio file, use --cut, for example --cut 0:03-0:41.',
    )
  }

  if (opts.preset !== undefined) {
    // Everything that says what to do: the preset already does.
    const doing = [
      ['to', '--to'],
      ['quality', '--quality'],
      ['maxSize', '--max-size'],
      ['merge', '--merge'],
      ['split', '--split'],
      ['extract', '--extract'],
      ['delete', '--delete'],
      ['rotate', '--rotate'],
      ['sharpen', '--sharpen'],
      ['trim', '--trim'],
      ['crop', '--crop'],
      ['resize', '--resize'],
      ['width', '--width'],
      ['height', '--height'],
      ['removeBg', '--remove-bg'],
      ['pages', '--pages'],
    ]
      .filter(([key]) => opts[key as string] !== undefined && opts[key as string] !== false)
      .map(([, flag]) => flag as string)
    if (boost !== undefined) doing.push('--boost')
    if (doing.length > 0) {
      throw invalidArguments(
        `--preset already says what to do — leave out ${doing.join(' and ')}.`,
        'Run the preset alone, or change it from Done with → continue editing.',
      )
    }
    return {
      kind: 'preset',
      inputs,
      name: String(opts.preset),
      ...(opts.output === undefined ? {} : { output: String(opts.output) }),
      force: opts.force === true,
      recursive: opts.recursive === true,
      debug: opts.debug === true,
    }
  }

  // Checked ahead of every other branch below: --pages only means something
  // once a target is known, and none of the later branches (page ops, the
  // shell fallback, compression) have anywhere to put it.
  if (opts.pages !== undefined && opts.to === undefined) {
    throw invalidArguments('--pages needs --to: it chooses which pages to render.')
  }

  /**
   * A page-operation flag is checked ahead of the shell fallback below, not
   * just ahead of --to: `forge --merge` with zero inputs must report "no
   * files given", not silently open the interactive shell the way a bare
   * `forge` does.
   */
  const chosen = (['merge', 'split', 'extract', 'delete', 'rotate'] as const).filter(
    (name) => opts[name] !== undefined,
  )
  if (chosen.length > 1) {
    throw invalidArguments(
      `Use one operation at a time — got ${chosen.map((c) => `--${c}`).join(' and ')}.`,
    )
  }

  const asked = [
    ...(opts.sharpen ? ['--sharpen'] : []),
    ...(boost !== undefined ? ['--boost'] : []),
    ...(opts.removeBg ? ['--remove-bg'] : []),
  ]
  const resizeFlags = [
    ...(opts.resize !== undefined ? ['--resize'] : []),
    ...(opts.width !== undefined ? ['--width'] : []),
    ...(opts.height !== undefined ? ['--height'] : []),
  ]
  const mediaEdit =
    media !== undefined && !opts.to && opts.quality === undefined && opts.maxSize === undefined
  if (opts.trim || opts.crop !== undefined || resizeFlags.length > 0 || mediaEdit) {
    if (resizeFlags.length > 1) {
      throw invalidArguments(
        `Use one of --resize, --width and --height — got ${resizeFlags.join(' and ')}.`,
      )
    }
    const flag =
      opts.crop !== undefined ? '--crop' : (resizeFlags[0] ?? (opts.trim ? '--trim' : '--cut'))
    const clash = [
      // Two cuts whose order would surprise.
      ...(opts.crop !== undefined && opts.trim ? ['--trim'] : []),
      ...asked,
      ...(opts.maxSize !== undefined ? ['--max-size'] : []),
      ...(opts.pages !== undefined ? ['--pages'] : []),
      ...chosen.map((c) => `--${c}`),
    ][0]
    if (clash !== undefined) {
      throw invalidArguments(
        `${flag} cannot be combined with ${clash}.`,
        clash !== '--max-size'
          ? 'Run them one after the other.'
          : flag === '--crop'
            ? 'Crop first, then compress the result: forge photo-cropped-1x1.jpg --max-size 500kb'
            : 'Resize first, then compress the result: forge photo-1200x900.jpg --max-size 500kb',
      )
    }
    const crop: CropSpec | undefined =
      opts.crop !== undefined ? { aspect: parseAspect(String(opts.crop)) } : undefined
    const resize: ResizeSpec | undefined =
      opts.resize !== undefined
        ? { percent: parsePercent(opts.resize) }
        : opts.width !== undefined
          ? { width: wholePixels('--width', opts.width) }
          : opts.height !== undefined
            ? { height: wholePixels('--height', opts.height) }
            : undefined
    if (inputs.length === 0) {
      throw invalidArguments(
        'No files given.',
        'Name an image, for example: forge photo.jpg --resize 50%',
      )
    }
    const options: ConvertOptions = {
      background: String(opts.background),
      keepMetadata: Boolean(opts.keepMetadata),
    }
    if (opts.quality !== undefined) options.quality = parseQuality(String(opts.quality))
    const intent: EditIntent = {
      kind: 'edit',
      inputs,
      trim: Boolean(opts.trim),
      options,
      force: Boolean(opts.force),
      recursive: Boolean(opts.recursive),
      debug: Boolean(opts.debug),
    }
    if (crop !== undefined) intent.crop = crop
    if (resize !== undefined) intent.resize = resize
    if (media !== undefined) intent.media = media
    if (opts.to) intent.target = parseTarget(String(opts.to))
    if (opts.output !== undefined) intent.output = String(opts.output)
    if (opts.concurrency !== undefined) {
      intent.concurrency = parseConcurrency(String(opts.concurrency))
    }
    return intent
  }

  const scale: 1 | BoostScale | undefined = opts.sharpen ? 1 : boost
  const extensionOp =
    scale !== undefined ? ('boost' as const) : opts.removeBg ? ('remove-background' as const) : null
  if (extensionOp !== null) {
    if (asked.length > 1) {
      throw invalidArguments(`Use one operation at a time — got ${asked.join(' and ')}.`)
    }
    const flag = asked[0] as string
    if (chosen.length > 0) {
      throw invalidArguments(`${flag} cannot be combined with --${chosen[0]}.`)
    }
    if (opts.maxSize !== undefined || opts.pages !== undefined) {
      throw invalidArguments(
        `${flag} cannot be combined with ${opts.maxSize !== undefined ? '--max-size' : '--pages'}.`,
      )
    }
    if (inputs.length === 0) {
      throw invalidArguments(
        'No files given.',
        `Name an image, for example: forge photo.jpg ${flag}`,
      )
    }
    const target = opts.to ? parseTarget(String(opts.to)) : ('png' as const)
    if (extensionOp === 'remove-background') {
      const refusal = removeBackgroundTargetRefusal(target)
      if (refusal) throw refusal
    }
    const options: ConvertOptions = {
      background: String(opts.background),
      keepMetadata: Boolean(opts.keepMetadata),
    }
    if (opts.quality !== undefined) options.quality = parseQuality(String(opts.quality))
    const intent: ExtensionOpIntent = {
      kind: 'extension-op',
      op: extensionOp,
      inputs,
      target,
      options,
      force: Boolean(opts.force),
      recursive: Boolean(opts.recursive),
      debug: Boolean(opts.debug),
    }
    if (scale !== undefined) intent.scale = scale
    if (opts.output !== undefined) intent.output = String(opts.output)
    if (opts.concurrency !== undefined) {
      intent.concurrency = parseConcurrency(String(opts.concurrency))
    }
    return intent
  }

  if (chosen.length === 1) {
    const action = chosen[0] as (typeof chosen)[number]
    if (inputs.length === 0) {
      throw invalidArguments(
        'No files given.',
        `Name a PDF, for example: forge doc.pdf --${action}`,
      )
    }
    if (opts.separate && action !== 'extract') {
      throw invalidArguments(`--separate only applies to --extract, not --${action}.`)
    }
    /**
     * `PageOpIntent` has no `output` field — `intent.output` is set on the
     * convert path below, after this `return` — so `-o` was accepted and then
     * silently dropped. Refused outright rather than honoured: five
     * operations with five different arities (merge is N:1, split is 1:N)
     * each need their own rule for what a single `--output` means, which is
     * a later phase's work. Ignoring a flag someone typed is the defect;
     * saying so plainly is the fix. Same shape as the `--separate` refusal
     * just above.
     */
    if (opts.output !== undefined) {
      throw invalidArguments(
        `--output does not apply to --${action}.`,
        'Page operations name their own outputs, beside the source. Rename the result afterwards.',
      )
    }

    const pageOp: PageOpIntent = {
      kind: 'pageop',
      action,
      inputs,
      force: Boolean(opts.force),
      debug: Boolean(opts.debug),
    }

    if (action === 'rotate') {
      const deg = Number(opts.rotate)
      if (!Number.isInteger(deg) || deg % 90 !== 0 || deg === 0 || deg >= 360) {
        throw invalidArguments(`--rotate takes a multiple of 90 below 360, not "${opts.rotate}".`)
      }
      pageOp.rotate = deg
    }

    if (action === 'extract' || action === 'delete') {
      pageOp.pages = String(opts[action])
      if (action === 'extract' && opts.separate) pageOp.separate = true
    }

    if (action === 'split') {
      const raw = String(opts.split)
      const every = raw.match(/^every=(\d+)$/)
      const at = raw.match(/^at=([\d,\s]+)$/)
      if (raw === 'every-page') pageOp.split = { mode: 'every-page' }
      else if (every?.[1] !== undefined) {
        // `every=0` matches the regex above and "0" is a truthy string, so
        // without this it parsed as a real mode and reached `everyNCuts`,
        // whose loop never advances with a step of 0. Validated here for the
        // same reason `--rotate` is two branches above, and with the same
        // rule the shell's own field already applies (`flows/pdf.tsx`).
        const n = Number(every[1])
        if (!Number.isInteger(n) || n < 1) {
          throw invalidArguments(
            `--split every=N takes a whole number of pages, at least 1, not "${every[1]}".`,
          )
        }
        pageOp.split = { mode: 'every-n', n }
      } else if (at?.[1]) {
        pageOp.split = { mode: 'points', after: at[1].split(',').map((s) => Number(s.trim())) }
      } else {
        throw invalidArguments(`--split takes every-page, every=N or at=N,N — not "${raw}".`)
      }
    }

    return pageOp
  }

  if (inputs.length === 0 && !opts.to && opts.quality === undefined && opts.maxSize === undefined) {
    return { kind: 'shell' }
  }

  // Both paths: they answer the same question two ways, with or without --to.
  if (opts.quality !== undefined && opts.maxSize !== undefined) {
    throw invalidArguments(
      'Use either --quality or --max-size, not both.',
      'They are two ways of asking for the same thing, and Forge will not guess which wins.',
    )
  }

  /**
   * Quality or a size ceiling, with no target format, means compression: keep
   * the format, make the file smaller.
   */
  if (!opts.to && (opts.quality !== undefined || opts.maxSize !== undefined)) {
    if (inputs.length === 0) {
      throw invalidArguments(
        'No files given.',
        'Name a file, for example: forge photo.jpg --max-size 500kb',
      )
    }

    const compressOptions: ConvertOptions = {
      background: String(opts.background),
      keepMetadata: Boolean(opts.keepMetadata),
    }

    if (media !== undefined) compressOptions.media = media
    const compress: CompressIntent = {
      kind: 'compress',
      inputs,
      options: compressOptions,
      force: Boolean(opts.force),
      recursive: Boolean(opts.recursive),
      debug: Boolean(opts.debug),
    }
    if (opts.quality !== undefined) compress.quality = parseQuality(String(opts.quality))
    if (opts.maxSize !== undefined) compress.maxBytes = parseMaxSize(opts.maxSize)
    // Carried, not dropped: this branch used to have no field for it, so
    // `-o` was parsed and silently ignored while the output-exists refusal
    // told the user to "choose a different --output".
    if (opts.output !== undefined) compress.output = String(opts.output)
    /**
     * Only a `--dpi` the user actually typed is carried through.
     *
     * Commander gives the option a default of '150' for the conversion path,
     * so `opts.dpi` is always set and cannot distinguish an explicit 150 from
     * the fallback. `getOptionValueSource` can — and it reads the parse this
     * call performed, unlike `process.argv`, which is the host process's and
     * is wrong under test and anywhere `parseArgs` is handed a synthetic argv.
     *
     * The distinction matters because absent means "use the compression
     * default", which is 150 today but is the engine's business, not this
     * file's.
     */
    if (program.getOptionValueSource('dpi') === 'cli') {
      const dpi = Number(opts.dpi)
      if (!Number.isInteger(dpi) || dpi < 36 || dpi > 600) throw invalidDpi(opts.dpi)
      compress.dpi = dpi
    }
    if (opts.concurrency !== undefined) {
      compress.concurrency = parseConcurrency(String(opts.concurrency))
    }
    return compress
  }

  if (!opts.to) {
    throw invalidArguments(
      'No target format given.',
      'Add --to <format>, for example: forge photo.jpg --to webp',
    )
  }

  if (inputs.length === 0) {
    throw invalidArguments(
      'No files given.',
      'Name a file, a folder or a glob, for example: forge photo.jpg --to webp',
    )
  }

  const options: ConvertOptions = {
    background: String(opts.background),
    keepMetadata: Boolean(opts.keepMetadata),
  }
  if (opts.quality !== undefined) options.quality = parseQuality(String(opts.quality))
  if (media !== undefined) options.media = media

  // --dpi always has a value (Commander's default is '150'), so this is
  // unconditional — unlike --quality and --pages, which are only ever set
  // when the user actually typed them.
  const dpi = Number(opts.dpi)
  if (!Number.isInteger(dpi) || dpi < 36 || dpi > 600) throw invalidDpi(opts.dpi)

  const intent: Intent = {
    kind: 'convert',
    inputs,
    target: parseTarget(String(opts.to)),
    options,
    force: Boolean(opts.force),
    recursive: Boolean(opts.recursive),
    debug: Boolean(opts.debug),
    dpi,
    passwordStdin: Boolean(opts.passwordStdin),
  }
  if (opts.output !== undefined) intent.output = String(opts.output)
  // Carried through as the raw range text, not parsed here: parsing needs
  // the source's page count, which is only known once resolveInputs/probe
  // has actually read the file (src/cli/execute.ts does that per source).
  if (opts.pages !== undefined) intent.pages = String(opts.pages)
  if (opts.maxSize !== undefined) intent.maxBytes = parseMaxSize(opts.maxSize)
  if (opts.concurrency !== undefined)
    intent.concurrency = parseConcurrency(String(opts.concurrency))
  return intent
}
