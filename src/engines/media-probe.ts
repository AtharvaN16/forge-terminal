import type { MediaFacts } from '../core/types.js'

/**
 * What ffprobe says about a video or sound file, read into the few facts
 * Forge uses. Pure: `ffprobe -print_format json -show_format -show_streams`
 * output in, facts out.
 */

interface Stream {
  codec_type?: string
  codec_name?: string
  width?: number
  height?: number
  avg_frame_rate?: string
  r_frame_rate?: string
  color_transfer?: string
  channels?: number
  sample_rate?: string
  duration?: string
  tags?: { rotate?: string }
  side_data_list?: Array<{ rotation?: number }>
  disposition?: { attached_pic?: number }
}

interface Probe {
  streams?: Stream[]
  format?: { duration?: string }
}

/** `30000/1001` → 29.97, to two places. */
function rate(text: string | undefined): number {
  const [n, d] = (text ?? '').split('/').map(Number)
  if (!n || !d) return 0
  return Math.round((n / d) * 100) / 100
}

/** Clockwise degrees to upright, from the display matrix (anticlockwise) or the old rotate tag. */
function rotationOf(s: Stream): number {
  const matrix = s.side_data_list?.find((d) => typeof d.rotation === 'number')?.rotation
  const deg = matrix !== undefined ? -matrix : Number(s.tags?.rotate ?? 0)
  return (((Math.round(deg / 90) * 90) % 360) + 360) % 360
}

export function readProbe(json: unknown): MediaFacts {
  const p = json as Probe
  const streams = p.streams ?? []
  const v = streams.find((s) => s.codec_type === 'video' && s.disposition?.attached_pic !== 1)
  const a = streams.find((s) => s.codec_type === 'audio')
  const duration =
    Number(p.format?.duration) || Math.max(0, ...streams.map((s) => Number(s.duration) || 0))
  const facts: MediaFacts = { duration }
  if (v) {
    const rotation = rotationOf(v)
    const sideways = rotation === 90 || rotation === 270
    const w = v.width ?? 0
    const h = v.height ?? 0
    facts.video = {
      codec: v.codec_name ?? '',
      width: sideways ? h : w,
      height: sideways ? w : h,
      fps: rate(v.avg_frame_rate) || rate(v.r_frame_rate),
      rotation,
      hdr: v.color_transfer === 'arib-std-b67' || v.color_transfer === 'smpte2084',
    }
  }
  if (a) {
    facts.audio = {
      codec: a.codec_name ?? '',
      channels: a.channels ?? 0,
      sampleRate: Number(a.sample_rate) || 0,
    }
  }
  return facts
}
