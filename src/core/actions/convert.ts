import { rasterises, targetsFor } from '../capabilities.js'
import { invalidArguments } from '../errors.js'
import { FORMATS, formatById } from '../formats.js'
import {
  rasterOutputPaths,
  resolveOutputPath,
  sameFile,
  suffixedImagePath,
} from '../output-path.js'
import { normalisePages, parseRanges } from '../pages.js'
import type { ConvertOptions, DocumentInfo, FormatId, FormatSpec, SourceInfo } from '../types.js'
import { destinationOption } from './destination.js'
import type { Action, OptionSpec } from './index.js'
import { mediaOptionsOf } from './media.js'

/**
 * Which pages to rasterise, and the resolution to do it at. Only offered
 * once a document source has a target that actually rasterises it — jpeg or
 * png via pdfium, checked by the caller with `rasterises(target)`. A pdf/
 * docx/doc target is a document-to-document conversion with no pages or
 * dpi concept, and is never routed here.
 *
 * `choose` hands off to the shell's page picker (`PageGrid`, phase 3) rather
 * than a typed field: the grid is the one existing UI for this, and building
 * a second picker for the same job is exactly what note 4 warns against.
 */
function pagesSelect(doc: DocumentInfo): OptionSpec {
  return {
    kind: 'select',
    id: 'pages',
    label: 'Pages',
    default: 'all',
    choices: [
      { value: 'all', label: 'All pages', hint: `${doc.pages} pages` },
      { value: 'first', label: 'First page only' },
      { value: 'choose', label: 'Choose pages', hint: 'pick which ones' },
    ],
  }
}

/**
 * The shell offers three presets because a picker needs a short list; the
 * CLI's own `--dpi` has no such constraint and accepts any integer in
 * `invalidDpi`'s 36-600 range (spec §10). 150 is the default either way.
 */
function dpiSelect(): OptionSpec {
  return {
    kind: 'select',
    id: 'dpi',
    label: 'Resolution',
    default: '150',
    choices: [
      { value: '72', label: '72 dpi', hint: 'screen' },
      { value: '150', label: '150 dpi', badge: 'default' },
      { value: '300', label: '300 dpi', hint: 'print' },
    ],
  }
}

/**
 * `values.pages` arrives as one of: `'all'` (or unset), `'first'`, a typed
 * range string (`parseRanges`'s grammar), or an explicit array — the shape
 * `PageGrid`'s `onSubmit` hands back after "Choose pages". Every branch is
 * normalised through the one ordering authority, `core/pages.ts`'s
 * `normalisePages` — the same function `core/actions/extract.ts`'s
 * `selectedPages` uses, so naming and rendering can never derive from two
 * different orderings (phase 3's worst defect).
 */
function resolvePages(doc: DocumentInfo, raw: unknown): number[] {
  if (Array.isArray(raw)) return normalisePages(raw as number[])
  if (raw === 'first') return [0]
  if (typeof raw === 'string' && raw !== 'all' && raw !== '') {
    return normalisePages(parseRanges(raw, doc.pages))
  }
  return Array.from({ length: doc.pages }, (_, i) => i)
}

/**
 * Which way a target is likely to move the file's size, or undefined when
 * there is no honest claim to make.
 *
 * Derived from the two formats' `lossy` flags rather than any table of
 * pairs, so it holds for every format the engines gain later without a rule
 * of its own: lossless keeps every pixel, which costs bytes a lossy source
 * had already given up, and the reverse trade goes the other way. Lossy to
 * lossy (and lossless to lossless) is left unclaimed — that comparison
 * depends on the quality each side is encoded at, which is not known until
 * something is actually encoded, and inventing a direction here would be
 * exactly the kind of guess spec §12 keeps out of progress reporting.
 */
function sizeExpectation(
  source: SourceInfo,
  target: FormatId,
): { hint: string; tone: 'ok' | 'warn' } | undefined {
  const from = FORMATS[source.format].lossy
  const to = FORMATS[target].lossy
  if (from && !to) return { hint: 'likely bigger', tone: 'warn' }
  if (!from && to) return { hint: 'likely smaller', tone: 'ok' }
  return undefined
}

function targetSelect(source: SourceInfo): OptionSpec {
  // Converting a file to its own format changes nothing the user can see,
  // so it is never offered here (the CLI's separate `--to jpeg` recompress
  // flow is unaffected — that goes through core/plan.ts, not this file).
  const targets = targetsFor(source).filter((t) => t.id !== source.format)
  const first = targets[0]
  return {
    kind: 'select',
    id: 'target',
    // Names the source format explicitly, so it reads as "pick something
    // else" rather than leaving the user to wonder why their own format
    // is missing from the list.
    label: `Convert ${FORMATS[source.format].label} to`,
    choices: targets.map((t) => {
      // The size expectation replaces the format's own descriptive hint
      // rather than joining it: one short phrase per row is what the width
      // budget in `Select` was built around, and "smaller, modern · likely
      // bigger" reads as a contradiction even though both halves are true.
      const expectation = sizeExpectation(source, t.id)
      return {
        value: t.id,
        label: t.label,
        hint: expectation?.hint ?? t.hint,
        ...(expectation === undefined ? {} : { tone: expectation.tone }),
      }
    }),
    default: first ? first.id : '',
  }
}

/**
 * plan() cannot trust `values.target` the way options() can afford to — a
 * caller (in practice, the shell) is expected to reach plan() only after
 * walking options(), but nothing enforces that. An unchecked `as FormatId`
 * here would let a missing, empty, or bogus target slip through and crash
 * deep inside resolveOutputPath instead of failing at the boundary with a
 * message that says what went wrong.
 */
/** A sound target's bitrate, in kbps: 64–320, 128 to start (Opus 96: it needs less). */
function bitrateSlider(target: FormatId): OptionSpec {
  return {
    kind: 'slider',
    id: 'bitrate',
    label: 'Quality',
    min: 64,
    max: 320,
    step: 32,
    default: target === 'opus' ? 96 : 128,
  }
}

const isResize = (v: unknown): v is NonNullable<ConvertOptions['resize']> =>
  typeof v === 'object' && v !== null && ('percent' in v || 'width' in v || 'height' in v)

function requireTarget(values: Record<string, unknown>): FormatSpec {
  const raw = values.target
  const spec = typeof raw === 'string' ? formatById(raw) : undefined
  if (!spec) {
    throw invalidArguments(
      `convertAction.plan() requires a valid target format, got ${JSON.stringify(raw)}.`,
      'This is a caller bug, not a user-facing condition: call options() and pass one of the target select choices before calling plan().',
    )
  }
  return spec
}

export const convertAction: Action = {
  id: 'convert',
  label: 'Convert',
  verb: 'Converting',
  hint: 'to another format',

  appliesTo: (sources) => sources.length >= 1,

  options(sources, values, prefs) {
    const source = sources[0]
    if (!source) return []
    const specs: OptionSpec[] = [targetSelect(source)]

    const target = values.target
    if (typeof target !== 'string') return specs

    // A document source only needs the pages/resolution pickers when the
    // chosen target actually rasterises it (jpeg/png, via pdfium) — a
    // target of pdf/docx/doc is a document-to-document conversion with no
    // pages or dpi concept at all.
    if (source.kind === 'document' && rasterises(target as FormatId)) {
      specs.push(pagesSelect(source), dpiSelect())
    }

    const spec = FORMATS[target as FormatId]
    if (source.kind === 'media') {
      // Video: Forge picks the settings. Sound: the bitrate, the number people
      // know for sound, in kbps (video spec §3.2).
      if (spec?.media === 'sound' && spec.lossy) specs.push(bitrateSlider(target as FormatId))
    } else if (spec?.lossy && spec.media === undefined) {
      // A picture becoming a video (an animated GIF to MP4): Forge picks, as for any video.
      specs.push({
        kind: 'slider',
        id: 'quality',
        label: 'Quality',
        min: 1,
        max: 100,
        step: 5,
        default: prefs.quality,
      })
    }

    specs.push(destinationOption(source, prefs))
    return specs
  },

  plan(sources, values) {
    const source = sources[0]
    if (!source) return []
    const spec = requireTarget(values)
    const target = spec.id

    const options: ConvertOptions = {
      // The caller's fill colour when one is given. The shell has no
      // background control and passes nothing, so it keeps the white default;
      // the CLI's `--background` reaches here through `values`. Hardcoding
      // white made that flag work for an image conversion and silently do
      // nothing for a document — the same flag behaving two ways depending on
      // what was dropped on it.
      background: typeof values.background === 'string' ? values.background : '#ffffff',
      // Same reasoning as `background` above: the shell has no metadata
      // control and passes nothing, so it keeps the `false` default, while
      // the CLI's `--keep-metadata` reaches here through `values`. Every
      // `ConvertOptions` field a caller can set has to be readable from
      // `values` or the flag that sets it works for one source kind and
      // silently does nothing for the other.
      keepMetadata: values.keepMetadata === true,
    }
    if (spec.lossy && typeof values.quality === 'number') options.quality = values.quality
    if (source.kind === 'media') {
      const media = mediaOptionsOf(values)
      if (media) options.media = media
      if (isResize(values.resize)) options.resize = values.resize
    }

    const destination = typeof values.destination === 'string' ? values.destination : undefined

    // A document source rasterises to one image per selected page rather
    // than one output for the whole source — `resolveOutputPath` below
    // assumes exactly the latter, so this branches before it rather than
    // trying to bend that function to a shape it was never built for. Only
    // true when the target actually rasterises (jpeg/png); pdf/docx/doc
    // fall through to the single-output path below like any other format.
    if (source.kind === 'document' && rasterises(target)) {
      const dpi = Number(values.dpi)
      options.dpi = Number.isFinite(dpi) && dpi > 0 ? dpi : 150
      const pages = resolvePages(source, values.pages)
      options.pages = pages
      const sourceRoot = typeof values.sourceRoot === 'string' ? values.sourceRoot : undefined
      const outputs = rasterOutputPaths(source.path, pages, target, destination, sourceRoot)
      return [{ op: 'convert', sources: [source], outputs, target, options }]
    }

    let output = resolveOutputPath({
      sourcePath: source.path,
      target,
      ...(destination === undefined ? {} : { output: `${destination}/` }),
    })
    // HEVC is written into an .mp4: an MP4 source would be its own output.
    if (sameFile(output, source.path)) {
      output = suffixedImagePath({
        sourcePath: source.path,
        target,
        suffix: target,
        ...(destination === undefined ? {} : { output: `${destination}/` }),
      })
    }

    return [{ op: 'convert', sources: [source], outputs: [output], target, options }]
  },
}
