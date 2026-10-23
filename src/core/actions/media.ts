import { cropSuffix, largestBox } from '../crop.js'
import { placeOutput, suffixedImagePath } from '../output-path.js'
import { resizedSize, sizeSuffix } from '../resize.js'
import { isTurn, turnSuffix } from '../turn.js'
import type {
  ConvertOptions,
  CropSpec,
  FormatId,
  Job,
  MediaInfo,
  MediaOptions,
  ResizeSpec,
  SourceInfo,
  Turn,
} from '../types.js'
import { answer } from './destination.js'
import type { Action, OptionSpec } from './index.js'

/**
 * Video and sound in `/edit` (video spec §3.4): Trim, Mute, Resize and Crop
 * to shape for a video; Trim and Even out loudness for sound. Each is a
 * convert job to the file's own format, with options, named by what was done.
 */

export type MediaTool = 'cut' | 'mute' | 'speed' | 'resize' | 'crop' | 'rotate' | 'loudness'

/** The speeds Edit's Speed row steps through: faster first, then slower. */
export const SPEEDS: readonly number[] = [2, 1.5, 1.25, 0.75, 0.5]

/** The range the engine takes (the CLI's `--speed`). */
const SPEED_MIN = 0.25
const SPEED_MAX = 4

/** Podcasts' level, and the one Even out loudness evens to (other levels are `--loudness`). */
export const LOUDNESS_LUFS = -16

/**
 * The format a compressed file is written in: its own, except where its own
 * has no smaller setting. WAV, AIFF and FLAC become M4A; AVI an MP4; Vorbis
 * an Opus.
 */
export function compressedFormat(format: FormatId): FormatId {
  const to: Partial<Record<FormatId, FormatId>> = {
    wav: 'm4a',
    aiff: 'm4a',
    flac: 'm4a',
    avi: 'mp4',
    ogg: 'opus',
  }
  return to[format] ?? format
}

const soleMedia = (sources: SourceInfo[]): MediaInfo | undefined =>
  sources.length === 1 && sources[0]?.kind === 'media' ? sources[0] : undefined

const isTool = (v: unknown): v is MediaTool =>
  v === 'cut' ||
  v === 'mute' ||
  v === 'speed' ||
  v === 'resize' ||
  v === 'crop' ||
  v === 'rotate' ||
  v === 'loudness'

export interface MediaEditRequest {
  media?: MediaOptions
  resize?: ResizeSpec
  /** No box: the largest of the shape, centred. */
  crop?: CropSpec
  rotate?: Turn
  /** Absent: the source's own format. */
  target?: FormatId
  output?: string
  roots?: Map<string, string>
  destination?: unknown
  name?: unknown
}

/** What the name says: the one thing done (`-trimmed`, `-2x`, `-1280x832`), or `-edited`. */
function suffixFor(source: MediaInfo, req: MediaEditRequest): string {
  const m = req.media ?? {}
  const v = source.facts?.video
  const said: string[] = []
  if (m.cut) said.push('trimmed')
  if (m.mute) said.push('muted')
  if (m.loudness !== undefined) said.push('levelled')
  if (m.speed !== undefined) said.push(`${m.speed}x`)
  if (m.fps !== undefined) said.push(`${m.fps}fps`)
  if (m.bitrate !== undefined) said.push(`${m.bitrate}k`)
  if (req.crop) said.push(cropSuffix(req.crop.aspect))
  if (req.resize) said.push(v ? sizeSuffix(resizedSize(v, req.resize)) : 'resized')
  if (req.rotate) said.push(turnSuffix(req.rotate))
  return said.length === 1 ? (said[0] as string) : 'edited'
}

/** One convert job per video or sound file, its own format unless asked (video spec §3.4). */
export function planMediaEdit(
  sources: MediaInfo[],
  req: MediaEditRequest,
): Extract<Job, { op: 'convert' }>[] {
  return sources.map((source) => {
    const target = req.target ?? source.format
    const options: ConvertOptions = { background: '#ffffff', keepMetadata: false }
    if (req.media && Object.keys(req.media).length) options.media = req.media
    if (req.resize) options.resize = req.resize
    if (req.rotate) options.rotate = req.rotate
    const v = source.facts?.video
    if (req.crop && v) {
      options.crop = {
        aspect: req.crop.aspect,
        box: req.crop.box ?? largestBox(v, req.crop.aspect),
      }
    }
    const root = req.roots?.get(source.path)
    const named = suffixedImagePath({
      sourcePath: source.path,
      target,
      suffix: suffixFor(source, req),
      ...(req.output === undefined ? {} : { output: req.output }),
      ...(root === undefined ? {} : { sourceRoot: root }),
    })
    return {
      op: 'convert' as const,
      sources: [source] as [MediaInfo],
      outputs: [placeOutput(named, answer(req.destination), answer(req.name))] as [string],
      target,
      options,
    }
  })
}

/** The CLI's and edit's media settings, read from `values`. */
export function mediaOptionsOf(values: Record<string, unknown>): MediaOptions | undefined {
  const m: MediaOptions = {}
  const cut = values.cut as { start?: unknown; end?: unknown } | undefined
  if (cut && typeof cut.start === 'number') {
    m.cut = { start: cut.start, ...(typeof cut.end === 'number' ? { end: cut.end } : {}) }
  }
  if (values.mute === true) m.mute = true
  if (typeof values.speed === 'number') m.speed = values.speed
  if (typeof values.fps === 'number') m.fps = values.fps
  if (typeof values.bitrate === 'number') m.bitrate = values.bitrate
  if (typeof values.loudness === 'number') m.loudness = values.loudness
  return Object.keys(m).length ? m : undefined
}

export const mediaEditAction: Action = {
  id: 'media-edit',
  label: 'Edit',
  verb: 'Editing',
  hint: 'trim, mute, speed, resize, rotate, crop',
  appliesTo: (sources) => soleMedia(sources) !== undefined,
  unavailable: () => 'one video or audio file',
  // The shell asks its own questions (the Length step, the crop frame).
  options: (): OptionSpec[] => [],
  plan(sources, values): Job[] {
    const source = soleMedia(sources)
    if (!source || !isTool(values.tool)) return []
    const tool = values.tool
    const req: MediaEditRequest = {
      ...(typeof values.output === 'string' ? { output: values.output } : {}),
      destination: values.destination,
      name: values.name,
    }
    if (tool === 'cut') {
      const cut = mediaOptionsOf(values)?.cut
      if (!cut) return []
      req.media = { cut }
    }
    if (tool === 'mute') req.media = { mute: true }
    if (tool === 'speed') {
      const speed = values.speed
      if (typeof speed !== 'number' || speed === 1 || speed < SPEED_MIN || speed > SPEED_MAX) {
        return []
      }
      req.media = { speed }
    }
    if (tool === 'loudness') {
      req.media = {
        loudness: typeof values.loudness === 'number' ? values.loudness : LOUDNESS_LUFS,
      }
    }
    if (tool === 'resize') {
      if (typeof values.resize !== 'object' || values.resize === null) return []
      req.resize = values.resize as ResizeSpec
    }
    if (tool === 'rotate') {
      if (!source.facts?.video || !isTurn(values.turn)) return []
      req.rotate = values.turn
    }
    if (tool === 'crop') {
      const crop = values.crop as CropSpec | undefined
      if (!crop?.aspect || !source.facts?.video) return []
      req.crop = crop
    }
    return planMediaEdit([source], req)
  },
}
