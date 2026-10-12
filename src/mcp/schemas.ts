import { isAbsolute } from 'node:path'
import * as z from 'zod'
import type { PageOpIntent } from '../cli/args.js'
import { DEFAULT_PREFERENCES } from '../config/preferences.js'
import { type OptionSpec, PAGE_ACTIONS, rotateAction, splitAction } from '../core/actions/index.js'
import { writableFormats } from '../core/capabilities.js'
import { RESIZE_MAX } from '../core/resize.js'
import type { DocumentInfo, FormatId } from '../core/types.js'

/**
 * Input and output schemas for the seven tools, each written once (spec §3.5).
 * Wherever an option already exists as an `OptionSpec` in `core/actions/`,
 * the allowed values are read from it. That way the shell, the CLI and MCP
 * cannot offer different choices.
 */

function selectValues(specs: OptionSpec[], id: string): string[] {
  const spec = specs.find((s) => s.id === id)
  if (spec?.kind !== 'select') throw new Error(`no select option "${id}"`)
  return spec.choices.map((c) => c.value)
}

/**
 * A stand-in PDF. It exists only so `splitAction.options()` will describe its
 * modes. It is never planned or run.
 */
const ANY_PDF: DocumentInfo = {
  kind: 'document',
  path: '/forge.pdf',
  format: 'pdf',
  bytes: 0,
  pages: 2,
  encrypted: false,
}

/** Every format some engine writes (invariant 2). */
export const TARGETS = writableFormats() as [FormatId, ...FormatId[]]

/** The page operations: every action that is about pages. */
export const PAGE_OPS = PAGE_ACTIONS.map((a) => a.id) as [
  PageOpIntent['action'],
  ...PageOpIntent['action'][],
]

export const ROTATE_DEGREES = selectValues(
  rotateAction.options([ANY_PDF], {}, DEFAULT_PREFERENCES),
  'degrees',
).map(Number)

export const SPLIT_MODES = selectValues(
  splitAction.options([ANY_PDF], {}, DEFAULT_PREFERENCES),
  'mode',
)

/**
 * The split modes this schema can express. Each mode carries its own fields,
 * so the union is written out, and `tests/mcp/schemas.test.ts` holds it equal
 * to `SPLIT_MODES`.
 */
export const SPLIT_SPEC_MODES = ['every-page', 'every-n', 'points'] as const

const absolutePath = z
  .string()
  .refine(isAbsolute, 'must be an absolute path')
  .describe('An absolute path.')

const paths = z.array(absolutePath).min(1)

export const SplitSpec = z
  .discriminatedUnion('mode', [
    z.object({ mode: z.literal('every-page') }),
    z.object({ mode: z.literal('every-n'), n: z.number().int().min(1) }),
    z.object({
      mode: z.literal('points'),
      after: z.array(z.number().int().min(1)).min(1).describe('Cut after these pages (1-based).'),
    }),
  ])
  .describe('How to split: every page, every N pages, or after the given pages.')

export const ProbeInput = z.object({
  paths: paths.describe('Absolute paths of files (or folders) to inspect.'),
})

export const FormatsInput = z.object({})

export const ConvertInput = z.object({
  paths: paths.describe('Absolute paths of files, folders or globs to convert.'),
  to: z
    .enum(TARGETS)
    .optional()
    .describe(
      'Target format id. Use "jpeg" for JPG. Required, except with trim or resize, which keep each image\'s own format when it is omitted.',
    ),
  output: absolutePath
    .optional()
    .describe('A folder (or, for one input, a file) to write to. Default: beside each source.'),
  quality: z.number().int().min(1).max(100).optional().describe('For lossy targets, 1-100.'),
  dpi: z
    .number()
    .int()
    .min(36)
    .max(600)
    .optional()
    .describe('PDF → image resolution. Default 150.'),
  pages: z.string().optional().describe('PDF → image page selection, e.g. "3-7,12". Default all.'),
  background: z
    .string()
    .optional()
    .describe('Fill colour when transparency must be flattened. Default #ffffff.'),
  keepMetadata: z.boolean().optional().describe('Keep EXIF and GPS data. Default false.'),
  password: z.string().optional().describe('Password for an encrypted PDF. Never echoed back.'),
  overwrite: z
    .boolean()
    .optional()
    .describe('Replace existing outputs. Default false — only when the user asked.'),
  recursive: z.boolean().optional().describe('Descend into subfolders of a folder input.'),
  trim: z
    .boolean()
    .optional()
    .describe(
      'Images only: cut transparent or solid-colour edges, writing name-trimmed. Keeps the format unless `to` is given. Refused for animated images and when nothing would be trimmed (unless also resizing).',
    ),
  resize: z
    .union([
      z.strictObject({ percent: z.number().min(1).max(RESIZE_MAX) }),
      z.strictObject({ width: z.number().int().min(1) }),
      z.strictObject({ height: z.number().int().min(1) }),
    ])
    .optional()
    .describe(
      'Images only: resize to { percent } of the size (1-200), or an exact { width } or { height } with the other side following. Writes name-<W>x<H>; with trim, name-trimmed-<50pct|1200w|900h>. Keeps the format unless `to` is given. No side over 16384 px, no more than 100 MP.',
    ),
  sharpen: z
    .boolean()
    .optional()
    .describe(
      'Images only: sharpen at the same size with the optional boost extension, writing name-sharp. `to` is then the output format. Fails with extension-missing when it is not installed; the fix is `forge extensions add boost`.',
    ),
  boost: z
    .union([z.literal(2), z.literal(3), z.literal(4)])
    .optional()
    .describe(
      'Images only: enlarge 2, 3 or 4 times with the optional boost extension, writing name-2x / name-3x / name-4x. `to` is then the output format (png keeps transparency). Fails with extension-missing when it is not installed; the fix is `forge extensions add boost`. 3 needs boost 1.1.0 or later: an older install fails with extension-outdated, fixed by the same command; while no released boost makes 3 it fails with invalid-arguments naming the factors that work.',
    ),
  removeBackground: z
    .boolean()
    .optional()
    .describe(
      'Images only: cut out the subject with the optional remove-background extension, writing name-cutout. `to` must carry transparency (png, webp, avif, tiff). Fails with extension-missing when it is not installed; the fix is `forge extensions add remove-background`.',
    ),
})

export const CompressInput = z
  .object({
    paths: paths.describe('Absolute paths of files to compress.'),
    quality: z.number().int().min(1).max(100).optional().describe('Compress to this quality.'),
    maxSize: z.string().optional().describe('Compress until it fits, e.g. "500kb" or "2mb".'),
    dpi: z.number().int().min(36).max(600).optional().describe('For a PDF: image resolution.'),
    output: absolutePath.optional().describe('A folder or file to write to.'),
    overwrite: z.boolean().optional().describe('Replace existing outputs. Default false.'),
  })
  .refine((a) => (a.quality === undefined) !== (a.maxSize === undefined), {
    message: 'Give exactly one of quality or maxSize.',
  })

export const PdfInput = z.object({
  op: z.enum(PAGE_OPS).describe('The page operation.'),
  paths: paths.describe(
    'Absolute PDF paths. merge takes two or more, in order; the others take one.',
  ),
  pages: z.string().optional().describe('extract / delete: which pages, e.g. "3-7,12".'),
  separate: z.boolean().optional().describe('extract: one file per page.'),
  degrees: z.literal(ROTATE_DEGREES).optional().describe('rotate: degrees clockwise.'),
  split: SplitSpec.optional(),
  overwrite: z.boolean().optional().describe('Replace existing outputs. Default false.'),
})

export type ProbeArgs = z.infer<typeof ProbeInput>
export type ConvertArgs = z.infer<typeof ConvertInput>
export type CompressArgs = z.infer<typeof CompressInput>
export type PdfArgs = z.infer<typeof PdfInput>

// Outputs: the §3.2 / §3.3 documents. Strict, so that a field added in
// report-data.ts without being added here fails tests/mcp/schemas.test.ts
// rather than a client.
const FailureOut = z.strictObject({
  path: z.string().optional(),
  code: z.string(),
  title: z.string(),
  detail: z.string(),
  hint: z.string().optional(),
})

const ResultOut = z.strictObject({
  op: z.string(),
  source: z.string(),
  sources: z.array(z.string()),
  outputs: z.array(z.string()),
  inputBytes: z.number(),
  outputBytes: z.number(),
  warnings: z.array(z.strictObject({ code: z.string(), message: z.string() })),
})

export const RunOutput = z.strictObject({
  forge: z.string(),
  ok: z.boolean(),
  results: z.array(ResultOut),
  failures: z.array(FailureOut),
})

export const ProbeOutput = z.strictObject({
  forge: z.string(),
  ok: z.boolean(),
  probes: z.array(
    z.strictObject({
      path: z.string(),
      kind: z.enum(['image', 'document']),
      format: z.string(),
      bytes: z.number(),
      width: z.number().optional(),
      height: z.number().optional(),
      pages: z.number().optional(),
      encrypted: z.boolean().optional(),
      targets: z.array(z.string()),
      actions: z.array(z.string()),
    }),
  ),
  failures: z.array(FailureOut),
})

export const FormatsOutput = z.strictObject({
  forge: z.string(),
  ok: z.boolean(),
  formats: z.array(
    z.strictObject({
      id: z.string(),
      label: z.string(),
      extensions: z.array(z.string()),
      read: z.boolean(),
      write: z.boolean(),
      lossy: z.boolean(),
    }),
  ),
  failures: z.array(FailureOut),
})

/** Colour (colour spec §7.2). Read-only, like `forge_probe`. */
const Hex = z.string().describe('A hex colour: #RRGGBB, #RGB, or without the #')

export const PaletteInput = z.object({
  path: absolutePath.describe('An image file (absolute path): a photo, a screenshot or artwork'),
  inside: Hex.optional().describe('Show the shades of the palette colour nearest this one'),
})
export const ScaleInput = z.object({ colour: Hex })
export type PaletteArgs = z.infer<typeof PaletteInput>
export type ScaleArgs = z.infer<typeof ScaleInput>

export const PaletteOutput = z.strictObject({
  forge: z.string(),
  ok: z.boolean(),
  palette: z.strictObject({
    source: z.string(),
    inside: z.string().optional(),
    colours: z.array(
      z.strictObject({ hex: z.string(), rgb: z.string(), oklch: z.string(), share: z.number() }),
    ),
  }),
  failures: z.array(FailureOut),
})

export const ScaleOutput = z.strictObject({
  forge: z.string(),
  ok: z.boolean(),
  scale: z.strictObject({
    reference: z.string(),
    steps: z.array(
      z.strictObject({
        step: z.number(),
        hex: z.string(),
        oklch: z.string(),
        white: z.number(),
        black: z.number(),
      }),
    ),
  }),
  failures: z.array(FailureOut),
})
