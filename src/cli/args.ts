import { Command } from 'commander'
import { invalidArguments } from '../core/errors.js'
import { formatById } from '../core/formats.js'
import type { ConvertOptions, FormatId } from '../core/types.js'
import { parseSize } from '../core/units.js'
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
  debug: boolean
}

export type Intent =
  | ConvertIntent
  | CompressIntent
  | PageOpIntent
  | { kind: 'formats' }
  | { kind: 'shell' }
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

function parseQuality(raw: string): number {
  const n = Number(raw)
  if (!Number.isInteger(n) || n < 1 || n > 100) {
    throw invalidArguments(`Quality must be a whole number between 1 and 100, not ${raw}.`)
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

export function parseArgs(argv: string[]): Intent {
  if (argv[0] === 'config') return parseConfigArgs(argv)

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
    .helpOption('-h, --help', 'show this help')
    .version('0.1.0', '-V, --version', 'show the version')
    .exitOverride()
    .allowExcessArguments(false)

  program.parse(argv, { from: 'user' })

  const opts = program.opts()
  const inputs = program.args

  if (opts.formats) return { kind: 'formats' }

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

  if (chosen.length === 1) {
    const action = chosen[0] as (typeof chosen)[number]
    if (inputs.length === 0) {
      throw invalidArguments(
        'No files given.',
        `Name a PDF, for example: forge doc.pdf --${action}`,
      )
    }

    const pageOp: PageOpIntent = {
      kind: 'pageop',
      action,
      inputs,
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
      else if (every?.[1]) pageOp.split = { mode: 'every-n', n: Number(every[1]) }
      else if (at?.[1]) {
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

  /**
   * Quality or a size ceiling, with no target format, means compression: keep
   * the format, make the file smaller.
   */
  if (!opts.to && (opts.quality !== undefined || opts.maxSize !== undefined)) {
    if (opts.quality !== undefined && opts.maxSize !== undefined) {
      throw invalidArguments(
        'Use either --quality or --max-size, not both.',
        'They are two ways of asking for the same thing, and Forge will not guess which wins.',
      )
    }
    if (inputs.length === 0) {
      throw invalidArguments(
        'No files given.',
        'Name a file, for example: forge photo.jpg --max-size 500kb',
      )
    }

    const maxBytes = opts.maxSize === undefined ? undefined : parseSize(String(opts.maxSize))
    if (opts.maxSize !== undefined && maxBytes === undefined) {
      throw invalidArguments(
        `${opts.maxSize} is not a size.`,
        'Try a number with a unit, for example 500kb, 2mb or 1.5mb.',
      )
    }

    const compressOptions: ConvertOptions = {
      background: String(opts.background),
      keepMetadata: Boolean(opts.keepMetadata),
    }

    const compress: CompressIntent = {
      kind: 'compress',
      inputs,
      options: compressOptions,
      force: Boolean(opts.force),
      recursive: Boolean(opts.recursive),
      debug: Boolean(opts.debug),
    }
    if (opts.quality !== undefined) compress.quality = parseQuality(String(opts.quality))
    if (maxBytes !== undefined) compress.maxBytes = maxBytes
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

  const intent: Intent = {
    kind: 'convert',
    inputs,
    target: parseTarget(String(opts.to)),
    options,
    force: Boolean(opts.force),
    recursive: Boolean(opts.recursive),
    debug: Boolean(opts.debug),
  }
  if (opts.output !== undefined) intent.output = String(opts.output)
  if (opts.concurrency !== undefined)
    intent.concurrency = parseConcurrency(String(opts.concurrency))
  return intent
}
