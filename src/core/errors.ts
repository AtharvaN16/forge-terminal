import { basename } from 'node:path'
import { FORMATS } from './formats.js'
import type { FormatId, SourceInfo } from './types.js'

export type ErrorCode =
  | 'file-not-found'
  | 'not-a-file'
  | 'permission-denied'
  | 'unsupported-source'
  | 'unsupported-target'
  | 'corrupt-source'
  | 'output-exists'
  | 'output-collision'
  | 'output-is-input'
  | 'empty-directory'
  | 'invalid-arguments'
  | 'conversion-failed'
  | 'output-invalid'

interface ForgeErrorInit {
  code: ErrorCode
  title: string
  detail: string
  hint?: string
  cause?: unknown
}

export class ForgeError extends Error {
  readonly code: ErrorCode
  readonly title: string
  readonly detail: string
  readonly hint?: string

  constructor(init: ForgeErrorInit) {
    super(
      `${init.title}: ${init.detail}`,
      init.cause === undefined ? undefined : { cause: init.cause },
    )
    this.name = 'ForgeError'
    this.code = init.code
    this.title = init.title
    this.detail = init.detail
    this.hint = init.hint
  }
}

export function isForgeError(e: unknown): e is ForgeError {
  return e instanceof ForgeError
}

export function fileNotFound(path: string): ForgeError {
  return new ForgeError({
    code: 'file-not-found',
    title: 'File not found',
    detail: `${basename(path)} could not be found.`,
    hint: 'Check the filename and try again.',
  })
}

export function notAFile(path: string): ForgeError {
  return new ForgeError({
    code: 'not-a-file',
    title: 'Not a file',
    detail: `${basename(path)} is not a file.`,
    hint: 'Point Forge at an image, or at a directory of images.',
  })
}

export function permissionDenied(path: string): ForgeError {
  return new ForgeError({
    code: 'permission-denied',
    title: 'Permission denied',
    detail: `${basename(path)} could not be read.`,
    hint: 'Check the file permissions and try again.',
  })
}

export function unsupportedSource(path: string, detected: string): ForgeError {
  return new ForgeError({
    code: 'unsupported-source',
    title: 'Unsupported file type',
    detail: `${basename(path)} is ${detected}, which Forge cannot read.`,
    hint: 'Forge 0.1 handles images only.',
  })
}

export function unsupportedTarget(
  source: SourceInfo,
  requested: string,
  available: FormatId[],
): ForgeError {
  return new ForgeError({
    code: 'unsupported-target',
    title: `Can't convert ${basename(source.path)} to ${requested}`,
    detail: `${basename(source.path)} is a ${FORMATS[source.format].label} image.`,
    hint: `Available: ${available.join(', ')}`,
  })
}

export function corruptSource(path: string, cause: unknown): ForgeError {
  return new ForgeError({
    code: 'corrupt-source',
    title: 'Damaged image',
    detail: `${basename(path)} could not be read as an image.`,
    hint: 'The file may be incomplete or corrupted.',
    cause,
  })
}

export function outputExists(path: string): ForgeError {
  return new ForgeError({
    code: 'output-exists',
    title: 'File already exists',
    detail: `${basename(path)} is already there.`,
    hint: 'Pass --force to replace it, or choose a different --output.',
  })
}

/**
 * Two distinct sources resolved to the same output path. Unlike outputExists,
 * nothing was "already there" before this run started — the collision is
 * between two of the user's own inputs, so --force (which means "overwrite
 * what's on disk") must never suppress it.
 */
export function outputCollision(paths: [string, string], output: string): ForgeError {
  return new ForgeError({
    code: 'output-collision',
    title: 'Two files want the same output',
    detail: `${basename(paths[0])} and ${basename(paths[1])} would both become ${basename(output)}.`,
    hint: 'Convert them separately, or use --output to send them to different folders.',
  })
}

export function outputIsInput(path: string): ForgeError {
  return new ForgeError({
    code: 'output-is-input',
    title: 'Output would replace the original',
    detail: `${basename(path)} is both the input and the output.`,
    hint: 'Choose a different --output, or pass --force to overwrite in place.',
  })
}

export function outputInvalid(path: string, cause: unknown): ForgeError {
  return new ForgeError({
    code: 'output-invalid',
    title: 'Cannot write there',
    detail: `${path} could not be written to.`,
    hint: 'Check that the path is valid and that you have permission to write to it.',
    cause,
  })
}

export function emptyDirectory(path: string): ForgeError {
  return new ForgeError({
    code: 'empty-directory',
    title: 'No images found',
    detail: `${basename(path)} contains no images Forge can convert.`,
    hint: 'Try --recursive to look inside subfolders.',
  })
}

export function invalidArguments(detail: string, hint?: string): ForgeError {
  return new ForgeError({ code: 'invalid-arguments', title: 'Invalid arguments', detail, hint })
}

export function conversionFailed(path: string, cause: unknown): ForgeError {
  return new ForgeError({
    code: 'conversion-failed',
    title: 'Conversion failed',
    detail: `${basename(path)} could not be converted.`,
    hint: 'Run again with --debug for the underlying error.',
    cause,
  })
}

/**
 * Returns display lines rather than printing, so the core stays free of stdout.
 * The symbol is paired with a word so the meaning survives a monochrome terminal.
 */
export function renderError(e: ForgeError, opts: { debug?: boolean } = {}): string[] {
  const lines = [`✕ ${e.title}`, '', `  ${e.detail}`]
  if (e.hint) lines.push('', `  ${e.hint}`)
  if (opts.debug && e.cause instanceof Error) {
    lines.push('', `  ${e.cause.stack ?? e.cause.message}`)
  }
  return lines
}
