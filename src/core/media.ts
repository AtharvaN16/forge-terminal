import { mediaFloor } from '../engines/media-size.js'
import { FORMATS } from './formats.js'
import { clockOf } from './timecode.js'
import type { FormatId, MediaInfo, SourceInfo } from './types.js'
import { formatBytes } from './units.js'

/** Whether a source is a video or sound file. */
export const isMedia = (source: SourceInfo): source is MediaInfo => source.kind === 'media'

/** Whether it has a picture: by what ffprobe found, or by its format before then. */
export function hasPicture(source: MediaInfo): boolean {
  if (source.facts) return source.facts.video !== undefined
  return FORMATS[source.format].media === 'video'
}

/** Whether it has sound. Unknown before ffprobe has read it, so assumed. */
export function hasSound(source: MediaInfo): boolean {
  return source.facts ? source.facts.audio !== undefined : true
}

const channels = (n: number) => (n === 1 ? 'mono' : n === 2 ? 'stereo' : `${n} channels`)
const kHz = (hz: number) => `${Math.round(hz / 100) / 10} kHz`

/**
 * The card's facts line: `2:10 · 2940×1912 · 60 fps · 184 MB` for a video,
 * `58:12 · stereo · 48 kHz · 671 MB` for sound, `video · 184 MB` before
 * ffmpeg has read the file.
 */
export function mediaFacts(source: MediaInfo): string {
  const bytes = formatBytes(source.bytes)
  const f = source.facts
  if (!f) return `${hasPicture(source) ? 'video' : 'sound'} · ${bytes}`
  const parts = [clockOf(f.duration)]
  if (f.video) {
    parts.push(`${f.video.width}×${f.video.height}`, `${f.video.fps} fps`)
    if (f.video.hdr) parts.push('HDR')
  } else if (f.audio) {
    parts.push(channels(f.audio.channels), kHz(f.audio.sampleRate))
  }
  parts.push(bytes)
  return parts.join(' · ')
}

/** The smallest compress can make this file, or undefined before ffmpeg has read it. */
export function compressFloor(source: MediaInfo): number | undefined {
  return source.facts ? mediaFloor(source.facts) : undefined
}

/**
 * The units a target size is offered in for this file (video spec §3.3):
 * those between the smallest it can get and its size now. B never; KB only
 * when it can get under 1 MB; GB only for a file over 1 GB.
 */
export function sizeUnitsFor(source: MediaInfo): Array<'kb' | 'mb' | 'gb'> {
  const floor = compressFloor(source) ?? 0
  return [
    ...(floor < 1e6 ? (['kb'] as const) : []),
    ...(source.bytes >= 1e6 || floor >= 1e6 ? (['mb'] as const) : []),
    ...(source.bytes > 1e9 ? (['gb'] as const) : []),
  ]
}

/** The kbps a lossy sound format is written at when no bitrate is asked: Opus needs less. */
export const defaultKbps = (target: FormatId): number => (target === 'opus' ? 96 : 128)

/**
 * A sound file's size as `target`, before anything is encoded, where it is
 * arithmetic: bitrate × length for a lossy format, the samples themselves for
 * WAV and AIFF. Undefined for FLAC (it depends on the sound) and for video.
 */
export function soundBytes(source: MediaInfo, target: FormatId): number | undefined {
  const f = source.facts
  if (!f?.audio || FORMATS[target].media !== 'sound') return undefined
  if (FORMATS[target].lossy) return Math.round((defaultKbps(target) * 1000 * f.duration) / 8)
  if (target === 'wav' || target === 'aiff') {
    return Math.round(f.audio.sampleRate * f.audio.channels * 2 * f.duration)
  }
  return undefined
}
