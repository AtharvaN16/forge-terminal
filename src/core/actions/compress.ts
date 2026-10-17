import { dirname } from 'node:path'
import { lastSegment } from '../../utils/last-segment.js'
import { invalidArguments } from '../errors.js'
import { FORMATS, primaryExtension } from '../formats.js'
import type { DocumentInfo, ImageInfo, MediaInfo, SourceInfo } from '../types.js'
import { destinationOption } from './destination.js'
import type { Action, OptionSpec } from './index.js'
import { compressedFormat, mediaOptionsOf } from './media.js'

/** A video, as against a sound file (a sound file's quality is its bitrate). */
const hasPictureOut = (source: MediaInfo) => FORMATS[source.format].media === 'video'

const soleImage = (sources: SourceInfo[]): ImageInfo | undefined =>
  sources.length === 1 && sources[0]?.kind === 'image' ? sources[0] : undefined

const soleDocument = (sources: SourceInfo[]): DocumentInfo | undefined =>
  sources.length === 1 && sources[0]?.kind === 'document' ? sources[0] : undefined

/**
 * The suffix that keeps a compressed file from landing on its source.
 *
 * Compression keeps the extension, so without this the default output *is*
 * the input whenever "Same location" is chosen, and `buildPlan` would refuse
 * every run under the never-write-over-the-input rule. The name step comes
 * after, so this is a default the user can overwrite rather than a rule.
 */
const SUFFIX = '-small'

/**
 * The three points a PNG or GIF slider stops at. A palette's size moves in
 * steps, not smoothly — measured flat or even backwards between neighbouring
 * qualities — so a 1–100 range would mostly offer differences that are not
 * there. 100 still saves 58–76% on a screenshot; 30 is where it may start to
 * look different. `--quality` still takes any number.
 */
const POINTS = { min: 30, max: 100, step: 35 } as const

/** The point at or above `quality`: a PNG never opens lossier than the user's usual quality. */
const pointFor = (quality: number): number => {
  const steps = Math.ceil((quality - POINTS.min) / POINTS.step)
  return Math.min(POINTS.max, POINTS.min + Math.max(0, steps) * POINTS.step)
}

export const compressAction: Action = {
  id: 'compress',
  label: 'Compress',
  verb: 'Compressing',
  hint: 'make it smaller',

  /**
   * Formats with a quality dial, and the two this gives one: a PNG or GIF can
   * be cut to fewer colours (`quantisable`). `/convert` keeps both lossless;
   * only here may they lose something.
   */
  appliesTo: (sources) => {
    // Every video and sound file can be made smaller (video spec §3.3).
    if (sources.length === 1 && sources[0]?.kind === 'media') return true
    const image = soleImage(sources)
    if (image !== undefined) {
      const spec = FORMATS[image.format]
      return spec.lossy || spec.quantisable === true
    }

    /**
     * A PDF qualifies when it holds at least one image this can re-encode.
     *
     * The container itself is lossless, which is why this used to refuse
     * every PDF — but a scan is JPEG data in a PDF wrapper, and that is the
     * same trade compression offers anywhere else.
     *
     * Counted at probe time (`engines/pdf.ts`), so the flow is only offered
     * when it can actually deliver: a text-only PDF and a PDF whose images
     * are all Flate-encoded both have nothing to give, and opening the
     * quality slider for either would promise a saving that cannot happen.
     *
     * `?? 0` matters: `images` is optional on `DocumentInfo`, and a source
     * built without it has to read as "nothing known to compress" rather
     * than throw.
     */
    const document = soleDocument(sources)
    return (document?.images?.compressible ?? 0) > 0
  },

  options(sources, values, prefs) {
    const source = sources[0]
    if (!source) return []
    const specs: OptionSpec[] = [
      {
        kind: 'select',
        id: 'mode',
        label: `Compress ${lastSegment(source.path) ?? 'this file'}`,
        choices: [
          // A video cannot be shown at each level, so it is not promised.
          source.kind === 'media'
            ? { value: 'quality', label: 'By quality' }
            : { value: 'quality', label: 'By quality', hint: 'pick a level, see the result' },
          { value: 'size', label: 'To a target size', hint: 'smallest quality that fits' },
        ],
        default: 'quality',
      },
    ]

    if (values.mode === 'quality' && source.kind === 'media' && !hasPictureOut(source)) {
      // Sound: the bitrate, in kbps. 32 is speech at its smallest.
      specs.push({
        kind: 'slider',
        id: 'bitrate',
        label: 'Quality',
        min: 32,
        max: 320,
        step: 32,
        default: 96,
      })
    } else if (values.mode === 'quality') {
      const points = source.kind === 'image' && FORMATS[source.format].quantisable === true
      specs.push(
        points
          ? {
              kind: 'slider',
              id: 'quality',
              label: 'Quality',
              ...POINTS,
              default: pointFor(prefs.quality),
              points: true,
            }
          : {
              kind: 'slider',
              id: 'quality',
              label: 'Quality',
              min: 1,
              max: 100,
              step: 5,
              default: prefs.quality,
            },
      )
    } else if (values.mode === 'size') {
      specs.push({
        kind: 'text',
        id: 'size',
        label: 'Target size',
        placeholder: 'e.g. 500kb or 2mb',
      })
    } else {
      // Nothing further is knowable until the mode is answered — the steps
      // after it differ entirely.
      return specs
    }

    specs.push(destinationOption(source, prefs))
    return specs
  },

  plan(sources, values) {
    const mode = values.mode
    if (mode !== 'quality' && mode !== 'size') {
      throw invalidArguments(
        `compressAction.plan() needs a mode of "quality" or "size", got ${JSON.stringify(mode)}.`,
        'This is a caller bug, not a user-facing condition: walk options() before calling plan().',
      )
    }

    const source = sources[0]
    if (!source) return []

    const stem = (lastSegment(source.path) ?? 'file').replace(/\.[^.]+$/, '')
    const destination =
      typeof values.destination === 'string' ? values.destination : dirname(source.path)
    // Video and sound keep their format, except where it has no smaller setting.
    const target = source.kind === 'media' ? compressedFormat(source.format) : source.format
    const output = `${destination}/${stem}${SUFFIX}${primaryExtension(target)}`
    const media = source.kind === 'media' ? mediaOptionsOf(values) : undefined

    return [
      {
        op: 'convert',
        sources: [source],
        // The whole point of the action: the format does not change.
        target,
        outputs: [output],
        options: {
          background: '#ffffff',
          keepMetadata: false,
          // In size mode the quality is the search's answer, not the user's,
          // so none is carried here — the caller fills it in once found.
          ...(mode === 'quality' && typeof values.quality === 'number'
            ? { quality: values.quality }
            : {}),
          // Smaller or nothing, for every format; dithering only when asked.
          compress: { dither: values.dither === true },
          ...(media ? { media } : {}),
        },
      },
    ]
  },
}
