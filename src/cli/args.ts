import { Command } from 'commander'
import { invalidArguments, invalidDpi } from '../core/errors.js'
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
  /** Rasterisation resolution, 36-600. Only meaningful when a source is a PDF. */
  dpi?: number
  /** Raw range text from --pages, e.g. "3-7,12" — unparsed, since the page count needed to validate it is only known once a source is probed. */
  pages?: string
  /** Read an encrypted source's password from stdin instead of prompting. */
  passwordStdin?: boolean
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
    .option('--pages <ranges>', 'with --to, which pages to render, e.g. 3-7,12')
    .option('--dpi <n>', 'rasterisation resolution, 36-600', '150')
    .option('--password-stdin', "read an encrypted PDF's password from stdin")
    .helpOption('-h, --help', 'show this help')
    .version('0.1.0', '-V, --version', 'show the version')
    .exitOverride()
    .allowExcessArguments(false)

  program.parse(argv, { from: 'user' })

  const opts = program.opts()
  const inputs = program.args

  if (opts.formats) return { kind: 'formats' }

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
  if (opts.concurrency !== undefined)
    intent.concurrency = parseConcurrency(String(opts.concurrency))
  return intent
}
