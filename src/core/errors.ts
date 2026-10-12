import { dirname } from 'node:path'
import { displayName } from '../utils/display-path.js'
import { FORMATS } from './formats.js'
import type { Size } from './size.js'
import type { FormatId, Job, SourceInfo } from './types.js'
import { formatBytes } from './units.js'

export type ErrorCode =
  | 'file-not-found'
  | 'not-a-file'
  | 'permission-denied'
  | 'unsupported-source'
  | 'heic-decoder-unavailable'
  | 'unsupported-compress'
  | 'unsupported-pdf'
  | 'unsupported-operation'
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
  | 'empty-selection'
  | 'invalid-dpi'
  | 'extension-missing'
  | 'extension-corrupt'
  | 'extension-unsupported'
  | 'extension-outdated'
  | 'extension-download-failed'
  | 'extension-in-use'
  | 'no-subject'
  | 'boost-too-large'
  | 'resize-too-large'
  | 'nothing-to-trim'
  | 'animated-trim'
  | 'unexpected'

/** Lives beside `Warning` in types.ts; re-exported so both stable vocabularies import from here (spec §3.2). */
export type { WarningCode } from './types.js'

interface ForgeErrorInit {
  code: ErrorCode
  title: string
  detail: string
  short?: string
  hint?: string
  shellHint?: string
  cause?: unknown
}

export class ForgeError extends Error {
  readonly code: ErrorCode
  readonly title: string
  readonly detail: string
  /**
   * The detail in one line, for the shell's one-line refusal row. Absent
   * means the shell shows `detail`.
   */
  readonly short?: string
  /** The way forward, phrased for the CLI — flags, not slash commands. */
  readonly hint?: string
  /**
   * The same advice phrased for the interactive shell, where it differs.
   *
   * A slash command (`/convert`, `/pdf`) is only something you can type
   * inside the shell; printed by the CLI it is advice nobody can follow. The
   * reverse holds for flags like `--debug`. Absent means `hint` reads the
   * same on both surfaces. Data only — choosing which to show is the
   * renderer's job (`renderError` for the CLI, `shell/blocks.tsx`).
   */
  readonly shellHint?: string

  constructor(init: ForgeErrorInit) {
    super(
      `${init.title}: ${init.detail}`,
      init.cause === undefined ? undefined : { cause: init.cause },
    )
    this.name = 'ForgeError'
    this.code = init.code
    this.title = init.title
    this.detail = init.detail
    this.short = init.short
    this.hint = init.hint
    this.shellHint = init.shellHint
  }
}

export function isForgeError(e: unknown): e is ForgeError {
  return e instanceof ForgeError
}

export function fileNotFound(path: string): ForgeError {
  return new ForgeError({
    code: 'file-not-found',
    title: 'File not found',
    detail: `${displayName(path)} could not be found.`,
    short: `${displayName(path)} could not be found.`,
    hint: 'Check the filename and try again.',
  })
}

export function notAFile(path: string): ForgeError {
  return new ForgeError({
    code: 'not-a-file',
    title: 'Not a file',
    detail: `${displayName(path)} is not a file.`,
    short: `${displayName(path)} is not a file.`,
    hint: 'Point Forge at an image, or at a directory of images.',
  })
}

export function permissionDenied(path: string): ForgeError {
  return new ForgeError({
    code: 'permission-denied',
    title: 'Permission denied',
    detail: `${displayName(path)} could not be read.`,
    short: `${displayName(path)} could not be read.`,
    hint: 'Check the file permissions and try again.',
  })
}

/** `stat` reports ENOTDIR when some earlier segment of the path — not necessarily the last one — is a file, not a directory. A mistyped or concatenated path is the common cause. */
export function notADirectory(path: string): ForgeError {
  return new ForgeError({
    code: 'not-a-directory',
    title: 'Invalid path',
    detail: `${displayName(path)} could not be found: part of its path is not a directory.`,
    short: `part of ${displayName(path)}'s path is not a folder.`,
    hint: 'Check the path and try again.',
  })
}

export function symlinkLoop(path: string): ForgeError {
  return new ForgeError({
    code: 'symlink-loop',
    title: 'Too many symbolic links',
    detail: `${displayName(path)} could not be resolved: its path contains a symbolic-link loop.`,
    short: `${displayName(path)}'s path loops back on itself.`,
    hint: 'Check for a circular symlink somewhere in the path.',
  })
}

export function pathTooLong(path: string): ForgeError {
  return new ForgeError({
    code: 'path-too-long',
    title: 'Path too long',
    detail: `${displayName(path)}'s path is too long for the filesystem to resolve.`,
    short: `${displayName(path)}'s path is too long.`,
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
    detail: `${displayName(path)} could not be checked.`,
    short: `${displayName(path)} could not be checked.`,
    hint: 'Check the path and try again.',
    cause,
  })
}

export function unsupportedSource(path: string, detected: string): ForgeError {
  return new ForgeError({
    code: 'unsupported-source',
    title: 'Unsupported file type',
    detail: `${displayName(path)} is ${detected}, which Forge cannot read.`,
    short: `${displayName(path)} is ${detected}, which Forge cannot read.`,
    hint: 'Forge 0.1 handles images only.',
  })
}

/** A palette needs pixels. `detected` is what probing found, such as "a PDF". */
export function notAnImage(path: string, detected: string): ForgeError {
  return new ForgeError({
    code: 'unsupported-source',
    title: 'Not an image',
    detail: `${displayName(path)} is ${detected}, not an image.`,
    hint: 'A palette is taken from a photo, a screenshot or artwork.',
  })
}

/** Every pixel is transparent, so there is no colour to take. */
export function nothingVisible(path: string): ForgeError {
  return new ForgeError({
    code: 'unsupported-source',
    title: 'Nothing to take colours from',
    detail: `${displayName(path)} has no visible pixels.`,
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
    detail: `${displayName(path)} is a HEIC photo, which Forge decodes with the macOS sips tool.`,
    short: 'HEIC needs sips, which could not be run.',
    hint: 'sips could not be run. It ships with macOS at /usr/bin/sips.',
  })
}

/**
 * A lossless format has no quality to trade away, so `/compress` on one would
 * promise something the encoder cannot do. Naming that is better than a
 * silent no-op, and the hint points at the thing that *would* work.
 */
export function unsupportedCompress(source: SourceInfo, target?: FormatId): ForgeError {
  const name = displayName(source.path)

  /**
   * A conversion asked to fit a size. The size applies to the target, so the
   * refusal must name the target: telling `photo.jpg --to png --max-size`
   * that photo.jpg is lossless would be false. Same code as the compression
   * refusals below, because it is the same refusal with a different subject.
   */
  if (target !== undefined && target !== source.format) {
    const label = FORMATS[target].label
    if (!FORMATS[target].lossy) {
      return new ForgeError({
        code: 'unsupported-compress',
        title: 'Cannot fit that to a size',
        detail: `${label} is lossless — there is no quality to trade away, so ${name} cannot be made to fit as ${label}.`,
        hint: 'Drop --max-size, or choose a lossy target. forge --formats lists them.',
        shellHint: 'Choose a lossy target to aim for a size.',
      })
    }
    return new ForgeError({
      code: 'unsupported-compress',
      title: 'Cannot fit that to a size',
      detail: `Forge cannot search ${name} → ${label} toward a size yet.`,
      hint: 'Convert it first, then compress the result with --max-size.',
      shellHint: 'Convert it first, then /compress the result to a size.',
    })
  }

  /**
   * A PDF gets its own wording because the lossless line below is FALSE for
   * one. A PDF is a container: its pages are usually JPEGs, and re-encoding
   * them measured 79% smaller on a photo brochure. Telling someone there is
   * "no quality to trade away" sent them hunting for a workaround that does
   * not exist; a PDF with images does compress; this refusal only reaches one with nothing re-encodable in it.
   */
  if (source.kind === 'document' && source.format === 'pdf') {
    const skipped = source.images?.skipped ?? 0
    return new ForgeError({
      code: 'unsupported-compress',
      title: 'Nothing to compress',
      detail:
        skipped > 0
          ? `${name}'s images are a kind Forge cannot re-encode, so there is nothing to make smaller.`
          : `${name} has no images — it is text and layout, which compression cannot shrink.`,
      hint: 'Try a page operation such as --extract to keep fewer pages, or --to <format> to turn its pages into images.',
      shellHint: 'Try /pdf to keep fewer pages, or /convert to turn its pages into images.',
    })
  }

  // A docx/doc has no images for this action to re-encode — same conclusion
  // as the lossless-image case below, reached for a different reason, so it
  // needs its own wording rather than falling into "is lossless."
  if (source.kind === 'document') {
    return new ForgeError({
      code: 'unsupported-compress',
      title: 'Nothing to compress',
      detail: `${name} is ${FORMATS[source.format].label}, which has no images Forge can re-encode.`,
      hint: `Use --to pdf to change it to PDF instead: forge ${name} --to pdf`,
      shellHint: 'Use /convert to change it to PDF instead.',
    })
  }

  return new ForgeError({
    code: 'unsupported-compress',
    title: 'Nothing to compress',
    detail: `${name} is ${FORMATS[source.format].label}, which is lossless — there is no quality to trade away.`,
    hint: 'Use --to to change it to a smaller format instead. forge --formats lists them.',
    shellHint: 'Use /convert to change it to a smaller format instead.',
  })
}

/**
 * `/pdf` mode is armed and expects the next dropped file to be a PDF — its
 * five page operations (merge, split, extract, delete, rotate) have nothing
 * to act on otherwise. Falls back to `/convert`'s target picker, the same
 * "route it somewhere useful instead of a dead end" rule `unsupportedCompress`
 * follows for its own mismatches.
 */
export function unsupportedPdf(source: SourceInfo): ForgeError {
  const name = displayName(source.path)
  return new ForgeError({
    code: 'unsupported-pdf',
    title: '/pdf needs a PDF',
    detail: `${name} is ${FORMATS[source.format].label}, not a PDF.`,
    hint: 'Converting it instead.',
  })
}

/**
 * A page operation that does not fit the files it was given: a JPEG handed to
 * --merge, a single PDF handed to --merge, a one-page PDF handed to --split.
 * `reason` is the action's own `unavailable()` text, the same words the shell's
 * /pdf hub shows beside a dimmed row.
 *
 * This gets its own code rather than `invalid-arguments`. The command was
 * well-formed and would succeed on other files, which makes it exit 1, while
 * `invalid-arguments` always means exit 2 (spec §3.4).
 */
export function unsupportedOperation(action: string, reason: string, hint?: string): ForgeError {
  return new ForgeError({
    code: 'unsupported-operation',
    title: `Cannot ${action} these files`,
    detail: `Not available for these files: ${reason}.`,
    hint: hint ?? 'Page operations work on PDFs: --merge takes two or more, the others take one.',
    shellHint: hint ?? 'Use /pdf with a PDF staged — two or more for merge.',
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
    detail: `${displayName(source.path)} is ${formatBytes(smallest)} even at the lowest quality, which is still over ${formatBytes(targetBytes)}.`,
    hint: 'Try a larger --max-size, or --to a smaller format.',
    shellHint: 'Try a larger target, or /convert to a smaller format.',
  })
}

export function unsupportedTarget(
  source: SourceInfo,
  requested: string,
  available: FormatId[],
): ForgeError {
  return new ForgeError({
    code: 'unsupported-target',
    title: `Can't convert ${displayName(source.path)} to ${requested}`,
    detail: `${displayName(source.path)} is a ${FORMATS[source.format].label} ${source.kind === 'image' ? 'image' : 'document'}.`,
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
    detail: `${displayName(path)} could not be read. It may be damaged, or not a format Forge recognises.`,
    short: `${displayName(path)} could not be read.`,
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
    detail: `${displayName(path)} is a ${FORMATS[format].label} file, but its content could not be read.`,
    short: `${displayName(path)} could not be read.`,
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
export function encryptedSource(path: string, opts: { attempted?: boolean } = {}): ForgeError {
  const name = displayName(path)
  return new ForgeError({
    code: 'encrypted-source',
    title: 'This PDF is password-protected',
    detail: `${name} is password-protected.`,
    short: `${name} is password-protected.`,
    hint: opts.attempted
      ? // A password was given and it did not open the file. The old hint
        // suggested --password-stdin, the flag that had just been used, which
        // sent people round in a circle (spec §3.1). It deliberately says
        // nothing about the attempt itself (invariant 8).
        "That password didn't open it. Check it and try again."
      : // Forge cannot decrypt-and-write a PDF — the only libraries that can
        // are AGPL, and Forge is MIT (see the phase-4a spec's ruling on this).
        // The shell also has no password field by design (spec §8), so this
        // points at the one front end that reads an encrypted PDF rather than
        // only refusing.
        `Convert it to images instead:  forge ${name} --to jpeg --password-stdin`,
  })
}

/**
 * Whether the operation that produced this output takes `--output` at all.
 *
 * Only `convert` does: a page operation names its outputs from its sources
 * and `cli/args.ts` refuses `--output` on one outright, so offering the flag
 * as the way out of a refusal would be advising something the same run
 * rejects. Defaulted to `convert` because `core/plan.ts`, the other caller of
 * both refusals below, only ever builds conversions.
 */
const takesOutputFlag = (op: Job['op']): boolean =>
  op === 'convert' || op === 'boost' || op === 'remove-background'

export function outputExists(path: string, op: Job['op'] = 'convert'): ForgeError {
  return new ForgeError({
    code: 'output-exists',
    title: 'File already exists',
    detail: `${displayName(path)} is already there.`,
    hint: takesOutputFlag(op)
      ? 'Pass --force to replace it, or choose a different --output.'
      : 'Pass --force to replace it, or move the existing file out of the way.',
    // The shell has no --force or --output: it asks instead (Replace, and
    // Keep both for a conversion) whenever it meets an existing file.
    shellHint: 'Run it again and Forge will ask before replacing it.',
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
    detail: `${displayName(paths[0])} and ${displayName(paths[1])} would both become ${displayName(output)}.`,
    hint: 'Convert them separately, or use --output to send them to different folders.',
    shellHint: 'Convert them one at a time.',
  })
}

/**
 * One job whose own `outputs` name the same path twice — a separated extract
 * handed a repeated page, say. Distinct from `outputCollision`, which is
 * shaped for two *different* sources landing on one name: reusing it here
 * printed "source.pdf and source.pdf would both become out.pdf", a sentence
 * about a situation that is not the one that happened.
 *
 * Shares the `output-collision` code because it is the same kind of fault
 * and, like its sibling, is never overridable by `--force`: it is the job's
 * own plan asking to write two different things to one path, which can only
 * be a bug in whatever produced the job.
 */
export function selfCollision(source: string, output: string): ForgeError {
  return new ForgeError({
    code: 'output-collision',
    title: 'One output, written twice',
    detail: `${displayName(source)} would write ${displayName(output)} twice, and only the second would survive.`,
    hint: 'Every output has to be its own file. Check the selection for a repeated page.',
  })
}

export function outputIsInput(path: string, op: Job['op'] = 'convert'): ForgeError {
  return new ForgeError({
    code: 'output-is-input',
    title: 'Output would replace the original',
    detail: `${displayName(path)} is both the input and the output.`,
    hint: takesOutputFlag(op)
      ? 'Choose a different --output, or pass --force to overwrite in place.'
      : 'Move or rename that file first, or pass --force to overwrite it in place.',
    // The shell deliberately offers no in-place overwrite: a conversion goes
    // back to its destination step, a page operation back to /pdf.
    shellHint: takesOutputFlag(op)
      ? 'Choose a different folder to save it in.'
      : 'Move or rename that file first.',
  })
}

/**
 * The write-side sibling of `permissionDenied`: the destination folder exists
 * (or would be created inside one) that this user cannot write to.
 *
 * Shares the `permission-denied` code because it is the same fault the user
 * fixes the same way. Names the folder, not the source — the source was read
 * fine, and "photo.png could not be read" would send them to the wrong file.
 */
export function outputPermissionDenied(path: string, cause?: unknown): ForgeError {
  return new ForgeError({
    code: 'permission-denied',
    title: 'Permission denied',
    detail: `${displayName(dirname(path))} is not a folder you can write to.`,
    hint: 'Choose a different --output, or check the folder permissions.',
    shellHint: 'Choose a different folder, or check its permissions.',
    cause,
  })
}

/** The errno codes that mean "you may not write here", not "this path is bad". */
const PERMISSION_CODES = new Set(['EACCES', 'EPERM', 'EROFS'])

/**
 * Names a failed write by its errno, so a refusal by the filesystem reads as
 * one instead of as a generic conversion failure. Anything it has no better
 * name for is returned untouched for the caller to wrap as it already does.
 */
export function classifyWriteError(path: string, cause: unknown): unknown {
  if (isForgeError(cause)) return cause
  const code = (cause as NodeJS.ErrnoException | null)?.code
  if (code !== undefined && PERMISSION_CODES.has(code)) return outputPermissionDenied(path, cause)
  return cause
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
    detail: `${displayName(path)} contains no images Forge can convert.`,
    hint: 'Try --recursive to look inside subfolders.',
    // The shell reads a dropped folder non-recursively and has no --recursive.
    shellHint:
      'Only files directly inside a folder are read — drop the files themselves, or the folder that holds them.',
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

/**
 * Extract and delete both refuse to write an empty document rather than
 * silently producing one — an extract with no pages selected, or a delete
 * that would remove every page. `detail` says which.
 */
export function emptySelection(detail: string): ForgeError {
  return new ForgeError({
    code: 'empty-selection',
    title: 'Nothing to write',
    detail,
    hint: 'Select at least one page to keep.',
  })
}

/**
 * `--dpi` and the shell's resolution picker both funnel here. The bounds
 * are measured, not arbitrary: below 36 the render is illegible, and 600 on
 * a several-hundred-page scan is tens of gigabytes of PNG and minutes of
 * rendering — worth refusing rather than letting someone discover it.
 */
export function invalidDpi(value: unknown): ForgeError {
  return new ForgeError({
    code: 'invalid-dpi',
    title: 'Invalid resolution',
    detail: `${String(value)} is not a resolution Forge can use.`,
    hint: 'Give a number between 36 and 600. The default is 150.',
  })
}

export function extensionMissing(id: string): ForgeError {
  return new ForgeError({
    code: 'extension-missing',
    title: 'Extension not installed',
    detail: `${id} is an optional extension and is not installed.`,
    hint: `Install it with: forge extensions add ${id}`,
    shellHint: 'Open /extensions to install it.',
  })
}

/** The installed version cannot do what was asked; a newer one can (`since`). */
export function extensionOutdated(
  id: string,
  what: string,
  have: string,
  since: string,
): ForgeError {
  return new ForgeError({
    code: 'extension-outdated',
    title: 'Extension out of date',
    detail: `${id} ${have} cannot ${what}; that needs ${since} or later.`,
    hint: `Update it with: forge extensions add ${id}`,
    shellHint: 'Open /extensions to update it.',
  })
}

export function extensionCorrupt(id: string, detail: string): ForgeError {
  return new ForgeError({
    code: 'extension-corrupt',
    title: 'Extension failed verification',
    detail: `${id}: ${detail}`,
    hint: `Nothing was installed. Try again with: forge extensions add ${id}`,
    shellHint: 'Nothing was installed. Try again from /extensions.',
  })
}

export function extensionUnsupported(id: string, reason: string): ForgeError {
  return new ForgeError({
    code: 'extension-unsupported',
    title: 'Extension not available here',
    detail: `${id} cannot be installed on this Mac: ${reason}`,
    hint: 'See what is available with: forge extensions',
    shellHint: 'See what is available in /extensions.',
  })
}

export function extensionDownloadFailed(id: string, detail: string): ForgeError {
  return new ForgeError({
    code: 'extension-download-failed',
    title: 'Download failed',
    detail: `${id}: ${detail}`,
    hint: `Check your connection (and HTTPS_PROXY if you use a proxy), then run: forge extensions add ${id}`,
    shellHint: 'Check your connection, then try again from /extensions.',
  })
}

/** A download that failed for want of disk space: same code, but the hint is not "check your connection". */
export function extensionDiskFull(id: string, detail: string): ForgeError {
  return new ForgeError({
    code: 'extension-download-failed',
    title: 'Not enough disk space',
    detail: `${id}: ${detail}`,
    hint: `Free some disk space, then run: forge extensions add ${id}`,
    shellHint: 'Free some disk space, then try again from /extensions.',
  })
}

/**
 * Another forge is using the extension: removing it would delete the model
 * under a running job, and a second job waited as long as it sensibly can.
 */
export function extensionBusy(
  id: string,
  holder: { pid: number; what?: string } | undefined,
  action: 'run' | 'remove',
): ForgeError {
  const who = holder
    ? holder.what
      ? `${holder.what} (forge, pid ${holder.pid})`
      : `another forge (pid ${holder.pid}) is using it`
    : 'another forge is using it'
  return new ForgeError({
    code: 'extension-in-use',
    title: 'Extension in use',
    detail: `${id} is in use: ${who}.`,
    hint:
      action === 'remove'
        ? `Wait for that job to finish, then run: forge extensions remove ${id}`
        : 'Wait for that job to finish, then try again.',
    shellHint:
      action === 'remove'
        ? 'It can be removed when that job finishes.'
        : 'Try again when that job finishes.',
  })
}

export function noSubject(path: string): ForgeError {
  return new ForgeError({
    code: 'no-subject',
    title: 'No subject found',
    detail: `${displayName(path)} has no clear subject to cut out.`,
    hint: 'Try a photo where the subject stands apart from the background.',
  })
}

export function boostTooLarge(path: string, maxScale: number, scale?: number): ForgeError {
  if (scale === 1)
    return new ForgeError({
      code: 'boost-too-large',
      title: 'Too large to sharpen',
      detail: `${displayName(path)} is too large to sharpen.`,
      hint: 'Sharpen works on images up to 16,384 px a side and 100 megapixels.',
    })
  return new ForgeError({
    code: 'boost-too-large',
    title: 'Too large to boost',
    detail:
      maxScale >= 2
        ? `${displayName(path)} is too large to boost that far; ${maxScale}x is the most it can take.`
        : `${displayName(path)} is already too large to boost.`,
    hint:
      maxScale >= 2 ? `Try --boost ${maxScale}.` : 'Boost works on images up to 100 megapixels.',
    shellHint: maxScale >= 2 ? `Choose ${maxScale}x instead.` : undefined,
  })
}

export function resizeTooLarge(path: string, size: Size): ForgeError {
  return new ForgeError({
    code: 'resize-too-large',
    title: 'Too large to resize to',
    detail: `${displayName(path)} would be ${size.width} × ${size.height}.`,
    hint: 'Resize works up to 16,384 px a side and 100 megapixels.',
  })
}

export function nothingToTrim(path: string): ForgeError {
  return new ForgeError({
    code: 'nothing-to-trim',
    title: 'Nothing to trim',
    detail: `${displayName(path)} has no empty edges.`,
    short: 'no empty edges',
  })
}

export function animatedTrim(path: string): ForgeError {
  return new ForgeError({
    code: 'animated-trim',
    title: "Can't trim an animation",
    detail: `${displayName(path)} is animated; trimming works on still images.`,
  })
}

export function conversionFailed(path: string, cause: unknown): ForgeError {
  return new ForgeError({
    code: 'conversion-failed',
    title: 'Conversion failed',
    detail: `${displayName(path)} could not be converted.`,
    hint: 'Run again with --debug for the underlying error.',
    // The shell has no --debug of its own; the command line does.
    shellHint: 'Run the same conversion with forge --debug from the command line to see why.',
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
