/**
 * Fitting a video into a byte target, worked out before anything is encoded
 * (video spec §3.3). Pure arithmetic: the shell asks it for the floor while a
 * size is typed, the engine asks it for the settings of the real encode.
 *
 * The budget is target × 8 ÷ duration. The sound takes its share first; the
 * picture then steps down a ladder — the long side at the source's own size,
 * 1920, 1280, 854, and at each size the frame rate at the source's, 30, 24 —
 * until every pixel of every frame gets at least `BITS_PER_PIXEL`. The bottom
 * rung (854, 15 fps, mono sound) at that rate is the floor: under it nothing
 * is offered and nothing is encoded.
 */

/** The fewest bits a pixel of a frame may get and still read. Screen recordings; to tune by measurement. */
const BITS_PER_PIXEL = 0.02
/** The container's own bytes, kept out of the budget. */
const OVERHEAD = 0.98
const LONG_SIDES = [1920, 1280, 854] as const
const FRAME_RATES = [30, 24] as const
const BOTTOM_FPS = 15
const AUDIO_KBPS = 64
/** Speech at its smallest: a sound file's floor, and a video's sound at the bottom rung. */
const SOUND_FLOOR_KBPS = 32
const BOTTOM_AUDIO_KBPS = 32

export interface SizeSource {
  /** Seconds. */
  duration: number
  /** Upright pixels. */
  width: number
  height: number
  fps: number
  hasAudio: boolean
}

export type SizePlan =
  | { width: number; height: number; fps: number; videoKbps: number; audioKbps: number }
  /** Under the smallest this video can get: the bytes of that smallest. */
  | { floor: number }

const even = (n: number) => Math.max(2, Math.round(n / 2) * 2)

/** The upright size with its long side at `long`, the shape kept, both sides even. */
function sized(src: SizeSource, long: number): { width: number; height: number } {
  const landscape = src.width >= src.height
  const from = landscape ? src.width : src.height
  if (long >= from) return { width: even(src.width - 1), height: even(src.height - 1) }
  const k = long / from
  return landscape
    ? { width: even(long), height: even(src.height * k) }
    : { width: even(src.width * k), height: even(long) }
}

interface Rung {
  width: number
  height: number
  fps: number
  audioKbps: number
}

/** Every rung, largest first. The last is the bottom: 854 (or less), 15 fps, mono sound. */
function rungs(src: SizeSource): Rung[] {
  const longest = Math.max(src.width, src.height)
  const sides = [longest, ...LONG_SIDES.filter((s) => s < longest)]
  const audio = src.hasAudio ? AUDIO_KBPS : 0
  const out: Rung[] = []
  for (const side of sides) {
    const { width, height } = sized(src, side)
    const rates = [...new Set([src.fps, ...FRAME_RATES].filter((f) => f <= src.fps))]
    for (const fps of rates) out.push({ width, height, fps, audioKbps: audio })
  }
  const last = sized(src, sides[sides.length - 1] ?? longest)
  out.push({
    ...last,
    fps: Math.min(BOTTOM_FPS, src.fps),
    audioKbps: src.hasAudio ? BOTTOM_AUDIO_KBPS : 0,
  })
  return out
}

/** The kbps of picture a rung needs. */
const needs = (r: Rung) => (r.width * r.height * r.fps * BITS_PER_PIXEL) / 1000

/** The smallest this video can get, in bytes. */
export function floorBytes(src: SizeSource): number {
  const all = rungs(src)
  const bottom = all[all.length - 1]
  if (!bottom) return 0
  return Math.ceil((((needs(bottom) + bottom.audioKbps) * 1000) / 8 / OVERHEAD) * src.duration)
}

/** The settings that fit `targetBytes`, or the floor when nothing does. */
export function planSize(src: SizeSource & { targetBytes: number }): SizePlan {
  const budget = ((src.targetBytes * 8) / src.duration / 1000) * OVERHEAD
  for (const r of rungs(src)) {
    const video = budget - r.audioKbps
    if (video >= needs(r)) return { ...r, videoKbps: Math.floor(video) }
  }
  return { floor: floorBytes(src) }
}

/** The smallest a video or sound file can be compressed to, from its facts (video spec §3.3). */
export function mediaFloor(
  facts: {
    duration: number
    video?: { width: number; height: number; fps: number } | undefined
    audio?: unknown
  },
  opts: { soundOnly?: boolean; mute?: boolean } = {},
): number {
  const audio = facts.audio !== undefined && opts.mute !== true
  if (facts.video && !opts.soundOnly) {
    return floorBytes({
      duration: facts.duration,
      width: facts.video.width,
      height: facts.video.height,
      fps: facts.video.fps,
      hasAudio: audio,
    })
  }
  return Math.ceil(((SOUND_FLOOR_KBPS * 1000) / 8 / OVERHEAD) * facts.duration)
}
