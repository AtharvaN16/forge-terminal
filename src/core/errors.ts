import { basename } from 'node:path'
import { FORMATS } from './formats.js'
import type { FormatId, SourceInfo } from './types.js'
import { formatBytes } from './units.js'

export type ErrorCode =
  | 'file-not-found'
  | 'not-a-file'
  | 'permission-denied'
  | 'unsupported-source'
  | 'heic-decoder-unavailable'
  | 'unsupported-compress'
  | 'target-unreachable'
  | 'unsupported-target'
  | 'corrupt-source'
  | 'encrypted-source'
  | 'output-exists'
  | 'output-collision'
  | 'output-is-input'
  | 'empty-directory'
  | 'invalid-arguments'
  | 'conversion-failed'
  | 'output-invalid'
  | 'not-a-directory'
  | 'symlink-loop'
  | 'path-too-long'
  | 'unreadable-path'
  | 'invalid-page-range'
  | 'unexpected'

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

/** `stat` reports ENOTDIR when some earlier segment of the path — not necessarily the last one — is a file, not a directory. A mistyped or concatenated path is the common cause. */
export function notADirectory(path: string): ForgeError {
  return new ForgeError({
    code: 'not-a-directory',
    title: 'Invalid path',
    detail: `${basename(path)} could not be found: part of its path is not a directory.`,
    hint: 'Check the path and try again.',
  })
}

export function symlinkLoop(path: string): ForgeError {
  return new ForgeError({
    code: 'symlink-loop',
    title: 'Too many symbolic links',
    detail: `${basename(path)} could not be resolved: its path contains a symbolic-link loop.`,
    hint: 'Check for a circular symlink somewhere in the path.',
  })
}

export function pathTooLong(path: string): ForgeError {
  return new ForgeError({
    code: 'path-too-long',
    title: 'Path too long',
    detail: `${basename(path)}'s path is too long for the filesystem to resolve.`,
    hint: 'Use a shorter path and try again.',
  })
}

/**
 * The fallback for any `stat` failure that isn't one of the specific cases
 * above — Forge 0.1 aims to name every errno it has a good message for, but
 * the filesystem can still fail in ways it hasn't anticipated, and that must
 * become a readable error rather than an unhandled throw. `cause` is kept so
 * `--debug` can still show what actually happened.
 */
export function unreadablePath(path: string, cause: unknown): ForgeError {
  return new ForgeError({
    code: 'unreadable-path',
    title: 'Could not read path',
    detail: `${basename(path)} could not be checked.`,
    hint: 'Check the path and try again.',
    cause,
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

/**
 * HEIC is decoded by macOS's own `sips`, because Sharp's prebuilt binary
 * ships libheif without an HEVC decoder for licensing reasons. This is the
 * one condition that can take HEIC away, and it deserves to say so rather
 * than surfacing as a generic conversion failure.
 */
export function heicDecoderUnavailable(path: string): ForgeError {
  return new ForgeError({
    code: 'heic-decoder-unavailable',
    title: 'Cannot read HEIC here',
    detail: `${basename(path)} is a HEIC photo, which Forge decodes with the macOS sips tool.`,
    hint: 'sips could not be run. It ships with macOS at /usr/bin/sips.',
  })
}

/**
 * A lossless format has no quality to trade away, so `/compress` on one would
 * promise something the encoder cannot do. Naming that is better than a
 * silent no-op, and the hint points at the thing that *would* work.
 */
export function unsupportedCompress(source: SourceInfo): ForgeError {
  return new ForgeError({
    code: 'unsupported-compress',
    title: 'Nothing to compress',
    detail: `${basename(source.path)} is ${FORMATS[source.format].label}, which is lossless — there is no quality to trade away.`,
    hint: 'Use /convert to change it to a smaller format instead.',
  })
}

/**
 * The search found nothing small enough. Reporting the smallest achievable
 * size teaches the user what is actually possible; writing a file that
 * quietly misses the number they asked for does not.
 */
export function targetUnreachable(
  source: SourceInfo,
  targetBytes: number,
  smallest: number,
): ForgeError {
  return new ForgeError({
    code: 'target-unreachable',
    title: 'Cannot get that small',
    detail: `${basename(source.path)} is ${formatBytes(smallest)} even at the lowest quality, which is still over ${formatBytes(targetBytes)}.`,
    hint: 'Try a larger target, or /convert to a smaller format.',
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

/**
 * Thrown when a source could not be decoded and nothing identified its
 * format first — `imageEngine.probe`'s generic `sharp(path).metadata()`
 * failure, or (via `engines/registry.ts`'s `probe`) whichever engine's
 * classified error wins when every engine declines. The wording must stay
 * format-neutral for exactly that reason: with more than one engine
 * registered, claiming "as an image" (or any other format) here would
 * assert something the probe never actually determined.
 *
 * Where the format HAS already been identified from content before decoding
 * failed — HEIC via its `ftyp` container brand, for instance — use
 * `corruptFormatSource` instead, which names it: vagueness is only honest
 * when the vagueness is real.
 */
export function corruptSource(path: string, cause: unknown): ForgeError {
  return new ForgeError({
    code: 'corrupt-source',
    title: 'Damaged file',
    detail: `${basename(path)} could not be read. It may be damaged, or not a format Forge recognises.`,
    hint: 'The file may be incomplete or corrupted.',
    cause,
  })
}

/**
 * Thrown when a source's format was already identified from its own content
 * — before decoding it was attempted, not guessed afterwards — but decoding
 * then failed anyway. `corruptSource`'s wording must stay neutral because at
 * that point the format is genuinely unknown; this sibling exists for the
 * opposite case, where the caller already knows what the file is and the
 * message should say so.
 */
export function corruptFormatSource(path: string, format: FormatId, cause: unknown): ForgeError {
  return new ForgeError({
    code: 'corrupt-source',
    title: `Damaged ${FORMATS[format].label}`,
    detail: `${basename(path)} is a ${FORMATS[format].label} file, but its content could not be read.`,
    hint: 'The file may be incomplete or corrupted.',
    cause,
  })
}

/**
 * A password-protected PDF probes successfully (`load` passes
 * `ignoreEncryption: true` so `encrypted: true` can be reported), but no page
 * operation can actually read its content until it is unlocked. This is
 * thrown at the start of each operation rather than left to surface as
 * whatever pdf-lib does partway through — a generic parse failure at the
 * last step would not tell the user what is actually wrong.
 */
export function encryptedSource(path: string): ForgeError {
  return new ForgeError({
    code: 'encrypted-source',
    title: 'This PDF is password-protected',
    detail: `${basename(path)} cannot be changed until it is unlocked.`,
    hint: 'Remove the password first, then try again.',
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

export function invalidPageRange(_input: string, detail: string, pageCount: number): ForgeError {
  return new ForgeError({
    code: 'invalid-page-range',
    title: 'Page range not understood',
    detail,
    hint: `This document has ${pageCount} pages. Use numbers and spans, like "3-7, 12, 20-".`,
  })
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
 * The last resort: something threw that isn't a `ForgeError` and has no
 * specific, well-worded constructor above — an unanticipated failure shape
 * rather than a plain "this file could not be read". A caller that only
 * knows how to render a `ForgeError` (the shell's history blocks, in
 * particular) must never be left with nothing to show for it, so this wraps
 * whatever was thrown into one, carrying its message for whatever that's
 * worth and keeping `cause` for `--debug` — without ever surfacing a raw
 * stack trace to the user (spec §11).
 */
export function unexpectedError(cause: unknown): ForgeError {
  return new ForgeError({
    code: 'unexpected',
    title: 'Something went wrong',
    detail: cause instanceof Error ? cause.message : String(cause),
    hint: 'This was not expected. Try again — if it keeps happening, it may be worth reporting.',
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
