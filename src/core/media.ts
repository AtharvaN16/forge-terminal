import { FORMATS } from './formats.js'
import { clockOf } from './timecode.js'
import type { MediaInfo, SourceInfo } from './types.js'
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
