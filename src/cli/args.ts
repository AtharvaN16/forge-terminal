import { Command } from 'commander'
import { invalidArguments } from '../core/errors.js'
import { formatById } from '../core/formats.js'
import type { ConvertOptions, FormatId } from '../core/types.js'

export type Intent =
  | {
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
  | { kind: 'formats' }
  | { kind: 'shell' }

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
    .option('--concurrency <n>', 'how many files to convert at once')
    .option('--debug', 'show underlying errors', false)
    .option('--formats', 'list supported formats', false)
    .helpOption('-h, --help', 'show this help')
    .version('0.1.0', '-V, --version', 'show the version')
    .exitOverride()
    .allowExcessArguments(false)

  program.parse(argv, { from: 'user' })

  const opts = program.opts()
  const inputs = program.args

  if (opts.formats) return { kind: 'formats' }
  if (inputs.length === 0 && !opts.to && opts.quality === undefined) return { kind: 'shell' }

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
