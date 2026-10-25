import { encoderMissing } from '../core/errors.js'
import { FORMATS } from '../core/formats.js'
import type { ConvertOptions, FormatId, MediaFacts } from '../core/types.js'
import { planSize } from './media-size.js'

/**
 * What ffmpeg is asked to do for one video or sound job (video spec §3).
 * Pure: the job in, the ffmpeg command lines out, so every decision — copy
 * or encode, which encoder, which filters, one pass or two — is tested
 * without ffmpeg.
 */

export interface EncodeInput {
  input: string
  /** The temp file beside the output; the engine renames it into place. */
  output: string
  target: FormatId
  facts: MediaFacts
  options: ConvertOptions
  platform: NodeJS.Platform
  /**
   * This computer's OS, for a refusal's advice. Absent: `platform`, which is
   * 'linux' on a Mac when the job is planned again without Apple's encoders.
   */
  os?: NodeJS.Platform
  /** Where a two-pass encode keeps its first pass's notes. */
  passlog: string
  /**
   * The encoders and filters this ffmpeg was built with. Absent: assume
   * everything (Homebrew's has it all); a lean build is planned around, and
   * a format none of its encoders can write is refused (`encoderMissing`),
   * thrown before ffmpeg runs.
   */
  has?: ReadonlySet<string>
}

export interface EncodeStep {
  args: string[]
  /** One of two passes, for Working's label. */
  pass?: { at: 1 | 2; of: 2 }
  /**
   * This step only measures: its stderr carries loudnorm's JSON, which fills
   * `LOUDNORM_MEASURED` in the next step, or astats' quietest stretch, which
   * fills `NOISE_FLOOR` (`noiseFloorOf`).
   */
  measures?: 'loudness' | 'noise'
}

export interface EncodePlan {
  steps: EncodeStep[]
  /** Seconds the output will have: the cut, at the speed. Working's true total. */
  duration: number
  /** Whether each stream is copied as it is rather than encoded. */
  copies: { video: boolean; audio: boolean }
  /** The picture a size target settled on, for Done to say. */
  fitted?: { width: number; height: number; fps: number }
}

/** Replaced by the engine with the noise floor `noiseFloorOf` read from the noise pass. */
export const NOISE_FLOOR = '%NOISE_FLOOR%'

/**
 * Clean up audio (design 2026-10-23 §2.2): the low rumble off, then a gentle
 * FFT denoise, 12 dB at most. Conservative on purpose — a mild result beats a
 * watery one. Runs before the loudness is evened. afftdn needs to be told
 * where the noise sits (its own tracking did nothing in measurement), so the
 * file's quietest stretch is measured first.
 */
const CLEANUP_FILTERS = ['highpass=f=80', `afftdn=nr=12:nf=${NOISE_FLOOR}`] as const

/** What measures the quietest stretch: the rumble filter first, as the clean-up has it. */
const NOISE_MEASURE = 'highpass=f=80,astats=measure_perchannel=none:measure_overall=RMS_trough'

/**
 * afftdn's `nf` from the noise pass's report: 8 dB above the quietest stretch
 * (measured on speech with pauses: noise is cut by all `nr` allows from there,
 * and the speech moves by 0.2 dB or less), held within -70…-30. With no quiet
 * stretch to read (digital silence, no report) afftdn's own -50.
 */
export function noiseFloorOf(report: string): number {
  const found = /RMS trough dB:\s*(-?[\d.]+|-?inf)/i.exec(report)?.[1]
  const trough = found === undefined ? Number.NaN : Number(found)
  if (!Number.isFinite(trough)) return -50
  return Math.min(-30, Math.max(-70, Math.round(trough + 8)))
}

/** Replaced by the engine with what the loudness pass measured. */
export const LOUDNORM_MEASURED = '%LOUDNORM_MEASURED%'

const MUXER: Partial<Record<FormatId, string>> = {
  mp4: 'mp4',
  hevc: 'mp4',
  mov: 'mov',
  webm: 'webm',
  mkv: 'matroska',
  avi: 'avi',
  gif: 'gif',
  mp3: 'mp3',
  m4a: 'ipod',
  opus: 'opus',
  flac: 'flac',
  wav: 'wav',
  aiff: 'aiff',
  ogg: 'ogg',
}

/** The video codecs a container takes as they are. */
const VIDEO_FITS: Partial<Record<FormatId, readonly string[]>> = {
  mp4: ['h264', 'hevc', 'mpeg4', 'av1'],
  mov: ['h264', 'hevc', 'mpeg4', 'prores', 'av1'],
  mkv: ['h264', 'hevc', 'mpeg4', 'vp8', 'vp9', 'av1'],
  hevc: ['hevc'],
  webm: ['vp8', 'vp9', 'av1'],
  avi: ['mpeg4', 'h264', 'mjpeg', 'msmpeg4v3'],
}

/** The sound codecs a container takes as they are. */
const AUDIO_FITS: Partial<Record<FormatId, readonly string[]>> = {
  mp4: ['aac', 'alac', 'mp3'],
  hevc: ['aac', 'alac', 'mp3'],
  mov: ['aac', 'alac', 'mp3', 'pcm_s16le', 'pcm_s16be', 'pcm_s24le'],
  m4a: ['aac', 'alac'],
  mkv: ['aac', 'mp3', 'opus', 'vorbis', 'flac', 'ac3', 'eac3'],
  webm: ['opus', 'vorbis'],
  opus: ['opus'],
  mp3: ['mp3'],
  flac: ['flac'],
  wav: ['pcm_s16le'],
  aiff: ['pcm_s16be'],
  ogg: ['vorbis', 'opus', 'flac'],
  avi: ['mp3', 'ac3', 'aac', 'pcm_s16le'],
}

/**
 * An encoder this ffmpeg lacks, and every one that would have done: the
 * refusal's words (`encoderMissing`), said before ffmpeg runs.
 */
export interface Missing {
  codec: string
  encoders: string[]
  sound?: boolean
}

interface AudioPick {
  encoder: string
  kbps?: number
  args?: string[]
  /** The sample rates it takes, the one to use first; absent: any. */
  rates?: readonly number[]
}

/** What libopus takes; ffmpeg's own Opus encoder takes 48 kHz alone. */
const OPUS_RATES = [48000, 24000, 16000, 12000, 8000] as const

/**
 * The sound encoder for a container, and its bitrate when lossy. `args` are
 * what that encoder needs besides: ffmpeg's own Vorbis encoder is marked
 * experimental and writes stereo only.
 *
 * Each is the first of a chain this ffmpeg has (`can`), libraries first.
 * ffmpeg's own encoders (AAC, FLAC, PCM, Vorbis) are part of it and assumed;
 * its own Opus is experimental (CELT only, at best libopus's equal), so it is
 * used only when this ffmpeg lists it and nothing better is there.
 */
function audioEncoder(
  target: FormatId,
  platform: NodeJS.Platform,
  can: (name: string) => boolean,
): AudioPick | Missing {
  const ownOpus: AudioPick = { encoder: 'opus', kbps: 96, args: ['-strict', '-2'], rates: [48000] }
  switch (target) {
    case 'webm':
      // WebM carries Vorbis as well as Opus.
      if (can('libopus')) return { encoder: 'libopus', kbps: 96, rates: OPUS_RATES }
      if (can('libvorbis')) return { encoder: 'libvorbis', kbps: 128 }
      if (can('opus')) return ownOpus
      return { codec: 'Opus or Vorbis', encoders: ['libopus', 'libvorbis', 'opus'], sound: true }
    case 'opus':
      if (can('libopus')) return { encoder: 'libopus', kbps: 96, rates: OPUS_RATES }
      if (can('opus')) return ownOpus
      return { codec: 'Opus', encoders: ['libopus', 'opus'] }
    case 'mp3':
      // ffmpeg has no MP3 encoder of its own.
      if (can('libmp3lame')) return { encoder: 'libmp3lame', kbps: 128 }
      return { codec: 'MP3', encoders: ['libmp3lame'] }
    case 'flac':
      return { encoder: 'flac' }
    case 'wav':
      return { encoder: 'pcm_s16le' }
    case 'aiff':
      return { encoder: 'pcm_s16be' }
    case 'ogg':
      // Homebrew's ffmpeg is built without libvorbis: there, ffmpeg's own.
      return can('libvorbis')
        ? { encoder: 'libvorbis', kbps: 128 }
        : { encoder: 'vorbis', kbps: 128, args: ['-strict', '-2', '-ac', '2'] }
    default:
      return { encoder: platform === 'darwin' && can('aac_at') ? 'aac_at' : 'aac', kbps: 128 }
  }
}

const even = (n: number) => Math.max(2, Math.floor(n / 2) * 2)
const secs = (n: number) => String(Math.round(n * 1000) / 1000)
/** A start, rounded up: rounded down, it can land before its keyframe and seek one earlier. */
const secsUp = (n: number) => String(Math.ceil(n * 1000) / 1000)

/** Quality 1–100 as x264's constant rate factor: 100 → 18, 1 → 38. */
export const crfOf = (quality: number) => Math.round(38 - ((quality - 1) * 20) / 99)
/** The same for VP9, whose scale runs further: 100 → 20, 1 → 50. */
const vp9CrfOf = (quality: number) => Math.round(50 - ((quality - 1) * 30) / 99)
/** And for x265: 100 → 22, 1 → 40. */
const x265CrfOf = (quality: number) => Math.round(40 - ((quality - 1) * 18) / 99)

/** Apple's encoders' own quality scale, 1–100, from quality 1–100. */
const toolboxQOf = (quality: number) => Math.round(20 + (quality * 60) / 100)
/** And MPEG-4 part 2's quantiser, 31 (worst) to 2: 100 → 2, 1 → 31. */
const mpeg4QOf = (quality: number) => Math.round(31 - ((quality - 1) * 29) / 99)

/**
 * The bitrate standing in for an x264 constant rate factor, for an encoder
 * with no constant quality (OpenH264, Media Foundation): bits for every
 * pixel of every frame, 0.15 at CRF 18, halved every 6 CRF up — x264's own
 * rule of thumb. So CRF 21 (a plain convert) is 0.106, quality 60's CRF 26
 * is 0.059, quality 1's CRF 38 is 0.015. A bitrate follows the picture's
 * size, not what is in it: a still screen gets as many bits as a busy one.
 */
export function kbpsForCrf(crf: number, pixelsPerSecond: number): number {
  const bitsPerPixel = 0.15 * 2 ** ((18 - crf) / 6)
  return Math.max(64, Math.round((pixelsPerSecond * bitsPerPixel) / 1000))
}

/** The pixels a second the encoder is given: the picture after its crop and resize, at its frame rate. */
function pixelsPerSecond(
  v: { width: number; height: number; fps: number },
  options: ConvertOptions,
  fitted: EncodePlan['fitted'],
  fps: number | undefined,
  speed: number,
): number {
  let w = v.width
  let h = v.height
  if (fitted) {
    w = fitted.width
    h = fitted.height
  } else {
    if (options.crop?.box) {
      w = options.crop.box.width
      h = options.crop.box.height
    }
    const r = options.resize
    if (r && 'width' in r) {
      const k = Math.min(r.width, w) / w
      w *= k
      h *= k
    } else if (r && 'height' in r) {
      const k = Math.min(r.height, h) / h
      w *= k
      h *= k
    } else if (r) {
      w *= r.percent / 100
      h *= r.percent / 100
    }
  }
  // Sped up with every frame kept, there are more of them a second.
  return w * h * (fps ?? v.fps * speed)
}

/** HDR to normal range, for a format that can't carry it. */
const TONEMAP =
  'zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,tonemap=tonemap=hable:desat=0,zscale=t=bt709:m=bt709:r=tv,format=yuv420p'

/** atempo takes 0.5–2 at a time; a bigger change is a chain. */
function atempo(speed: number): string[] {
  const out: string[] = []
  let left = speed
  while (left > 2) {
    out.push('atempo=2')
    left /= 2
  }
  while (left < 0.5) {
    out.push('atempo=0.5')
    left /= 0.5
  }
  out.push(`atempo=${Math.round(left * 1000) / 1000}`)
  return out
}

const GIF_WIDTH = 800
const GIF_FPS = 15
const SOUND_FLOOR_KBPS = 32

export function planEncode(job: EncodeInput): EncodePlan {
  const { facts, options, target, platform } = job
  const m = options.media ?? {}
  const v = facts.video
  const a = facts.audio
  const soundOut = FORMATS[target].media === 'sound'
  const gif = target === 'gif'
  const compress = options.compress !== undefined
  const darwin = platform === 'darwin'
  const can = (name: string) => job.has === undefined || job.has.has(name)
  const missing = (what: Missing) => encoderMissing(target, what, job.os ?? platform)

  const start = m.cut?.start ?? 0
  const end = Math.min(m.cut?.end ?? facts.duration, facts.duration)
  const span = Math.max(0, end - start)
  const speed = m.speed ?? 1
  const duration = span / speed

  const wantVideo = v !== undefined && !soundOut
  const wantAudio = a !== undefined && !m.mute && !gif

  // A size: the picture's settings by arithmetic, before anything is encoded.
  let fitted: EncodePlan['fitted']
  let sizedAudioKbps: number | undefined
  let videoKbps: number | undefined
  let soundKbps: number | undefined
  if (m.targetBytes !== undefined && duration > 0) {
    if (wantVideo && v) {
      const p = planSize({
        duration,
        width: v.width,
        height: v.height,
        fps: v.fps,
        hasAudio: wantAudio,
        targetBytes: m.targetBytes,
      })
      // Under the floor is refused before this is ever called; the floor is the best there is.
      if ('videoKbps' in p) {
        fitted = { width: p.width, height: p.height, fps: p.fps }
        videoKbps = p.videoKbps
        sizedAudioKbps = p.audioKbps
      }
    } else if (wantAudio) {
      const kbps = Math.floor(((m.targetBytes * 8) / duration / 1000) * 0.98)
      soundKbps = Math.max(SOUND_FLOOR_KBPS, Math.min(320, kbps))
    }
  }

  // ---- the picture
  const vf: string[] = []
  if (wantVideo && v) {
    // Tone-mapping needs zscale; a build without it writes HDR's colours as they are.
    if (v.hdr && target !== 'hevc' && can('zscale')) vf.push(TONEMAP)
    if (options.crop?.box) {
      const b = options.crop.box
      vf.push(`crop=${even(b.width)}:${even(b.height)}:${b.left}:${b.top}`)
    }
    if (fitted) vf.push(`scale=${fitted.width}:${fitted.height}`)
    else if (options.resize) {
      const r = options.resize
      // Never bigger than the video is: a side asked over its own is its own.
      if ('width' in r) vf.push(`scale=trunc(min(${even(r.width)}\\,iw)/2)*2:-2`)
      else if ('height' in r) vf.push(`scale=-2:trunc(min(${even(r.height)}\\,ih)/2)*2`)
      else vf.push(`scale=trunc(iw*${r.percent / 100}/2)*2:-2`)
    }
    // After the crop and resize, which are of the upright picture.
    if (options.rotate)
      vf.push(
        options.rotate === 90
          ? 'transpose=1'
          : options.rotate === 270
            ? 'transpose=2'
            : 'hflip,vflip',
      )
    if (speed !== 1) vf.push(`setpts=PTS/${speed}`)
    if (gif) {
      const w = Math.min(GIF_WIDTH, even(v.width))
      vf.push(
        `fps=${Math.min(GIF_FPS, v.fps)},scale=${w}:-2:flags=lanczos,split[s0][s1];[s0]palettegen=stats_mode=diff[p];[s1][p]paletteuse=dither=bayer:bayer_scale=4`,
      )
    }
  }
  const fps = fitted?.fps ?? m.fps
  const copyVideo =
    wantVideo &&
    v !== undefined &&
    vf.length === 0 &&
    fps === undefined &&
    !compress &&
    m.targetBytes === undefined &&
    (VIDEO_FITS[target] ?? []).includes(v.codec)

  const videoArgs: string[] = []
  /** The encoder chosen keeps notes for a second pass (x264, VP9): a size is then two passes. */
  let twoPassable = false
  if (!wantVideo) videoArgs.push('-vn')
  else if (copyVideo) videoArgs.push('-c:v', 'copy')
  else {
    if (vf.length) videoArgs.push('-vf', vf.join(','))
    if (gif) videoArgs.push('-c:v', 'gif', '-loop', '0')
    else if (target === 'webm') {
      // VP9 has no other software encoder in ffmpeg worth the wait.
      if (!can('libvpx-vp9')) throw missing({ codec: 'VP9', encoders: ['libvpx-vp9'] })
      twoPassable = videoKbps !== undefined
      videoArgs.push('-c:v', 'libvpx-vp9', '-row-mt', '1', '-deadline', 'good', '-cpu-used', '4')
      // A GIF's frames are RGB with alpha: left to choose, ffmpeg 9 picks
      // gbrap, which VP9 refuses without -strict. yuva420p keeps the
      // transparency, as ffmpeg 7 chose itself.
      if (v?.codec === 'gif') videoArgs.push('-pix_fmt', 'yuva420p')
      if (videoKbps !== undefined) videoArgs.push('-b:v', `${videoKbps}k`)
      else {
        const crf = compress ? vp9CrfOf(options.quality ?? 60) : 33
        videoArgs.push('-crf', String(crf), '-b:v', '0')
      }
    } else if (target === 'hevc') {
      // libx265, else Apple's on a Mac. No software fallback: Media
      // Foundation's HEVC needs Windows' paid extension or a GPU.
      const x265 = can('libx265')
      const toolbox = darwin && can('hevc_videotoolbox')
      if (!x265 && !toolbox)
        throw missing({
          codec: 'HEVC',
          encoders: ['libx265', ...(darwin ? ['hevc_videotoolbox'] : [])],
        })
      if (videoKbps !== undefined) {
        // HEVC is not run in two passes: one pass at the bitrate, and the
        // engine's check after it holds the size.
        if (x265) videoArgs.push('-c:v', 'libx265', '-preset', 'fast', '-b:v', `${videoKbps}k`)
        else videoArgs.push('-c:v', 'hevc_videotoolbox', '-b:v', `${videoKbps}k`)
      } else if (toolbox && (!compress || !x265)) {
        // Apple's encoder: its own quality scale, 1–100.
        const q = compress ? toolboxQOf(options.quality ?? 60) : 60
        videoArgs.push('-c:v', 'hevc_videotoolbox', '-q:v', String(q))
      } else {
        const crf = compress ? x265CrfOf(options.quality ?? 60) : 26
        videoArgs.push('-c:v', 'libx265', '-crf', String(crf), '-preset', 'fast')
      }
      videoArgs.push('-tag:v', 'hvc1', '-pix_fmt', v?.hdr ? 'p010le' : 'yuv420p')
    } else {
      // H.264 (AVI's last resort MPEG-4 part 2), the first of a chain this
      // ffmpeg has: x264; Apple's on a Mac; OpenH264, which Fedora's
      // ffmpeg-free carries; Windows' own Media Foundation, whose software
      // encoder ships with Windows (ffmpeg asks for hardware only when told).
      const crf = compress ? crfOf(options.quality ?? 60) : 21
      const rate = () =>
        `${videoKbps ?? kbpsForCrf(crf, v ? pixelsPerSecond(v, options, fitted, fps, speed) : 0)}k`
      if (videoKbps === undefined && !compress && darwin && can('h264_videotoolbox'))
        videoArgs.push('-c:v', 'h264_videotoolbox', '-q:v', '65')
      else if (can('libx264')) {
        twoPassable = videoKbps !== undefined
        if (videoKbps !== undefined)
          videoArgs.push('-c:v', 'libx264', '-preset', 'medium', '-b:v', `${videoKbps}k`)
        else if (compress)
          videoArgs.push('-c:v', 'libx264', '-preset', 'medium', '-crf', String(crf))
        else videoArgs.push('-c:v', 'libx264', '-preset', 'veryfast', '-crf', '21')
      } else if (darwin && can('h264_videotoolbox')) {
        if (videoKbps !== undefined) videoArgs.push('-c:v', 'h264_videotoolbox', '-b:v', rate())
        else
          videoArgs.push(
            '-c:v',
            'h264_videotoolbox',
            '-q:v',
            String(toolboxQOf(options.quality ?? 60)),
          )
      } else if (can('libopenh264')) {
        // No constant quality: a bitrate, one pass (it keeps no notes for a second).
        videoArgs.push('-c:v', 'libopenh264', '-b:v', rate())
      } else if (platform === 'win32' && can('h264_mf')) {
        videoArgs.push('-c:v', 'h264_mf', '-b:v', rate())
      } else if (target === 'avi') {
        // ffmpeg's own, AVI's own codec: always there.
        if (videoKbps !== undefined) videoArgs.push('-c:v', 'mpeg4', '-b:v', `${videoKbps}k`)
        else {
          const q = compress ? mpeg4QOf(options.quality ?? 60) : 3
          videoArgs.push('-c:v', 'mpeg4', '-q:v', String(q))
        }
      } else {
        throw missing({
          codec: 'H.264',
          encoders: [
            'libx264',
            ...(darwin ? ['h264_videotoolbox'] : []),
            'libopenh264',
            ...(platform === 'win32' ? ['h264_mf'] : []),
          ],
        })
      }
      videoArgs.push('-pix_fmt', 'yuv420p')
    }
    if (fps !== undefined) videoArgs.push('-r', String(fps))
    // AVI holds one frame rate: passed through, a sped-up clip puts two frames
    // in one slot, which ffmpeg's own MPEG-4 refuses. Held to the rate, the
    // extra frame is dropped.
    else if (target === 'avi') videoArgs.push('-fps_mode', 'cfr')
    else if (!gif) videoArgs.push('-fps_mode', 'passthrough')
  }

  // ---- the sound
  const cleanup: string[] = m.cleanup ? [...CLEANUP_FILTERS] : []
  const af: string[] = [...cleanup, ...(speed !== 1 ? atempo(speed) : [])]
  const loudness = m.loudness
  if (loudness !== undefined) {
    af.push(`loudnorm=I=${loudness}:TP=-1.5:LRA=11:${LOUDNORM_MEASURED}:linear=true`)
  }
  const kbps = m.bitrate ?? sizedAudioKbps ?? soundKbps
  const copyAudio =
    wantAudio &&
    a !== undefined &&
    af.length === 0 &&
    kbps === undefined &&
    !(compress && soundOut) &&
    (AUDIO_FITS[target] ?? []).includes(a.codec)

  const audioArgs: string[] = []
  if (!wantAudio) audioArgs.push('-an')
  else if (copyAudio) audioArgs.push('-c:a', 'copy')
  else {
    if (af.length) audioArgs.push('-af', af.join(','))
    const enc = audioEncoder(target, platform, can)
    if ('codec' in enc) throw missing(enc)
    audioArgs.push('-c:a', enc.encoder)
    const rate = kbps ?? enc.kbps
    if (rate !== undefined && enc.kbps !== undefined) audioArgs.push('-b:a', `${rate}k`)
    if (enc.args) audioArgs.push(...enc.args)
    if (
      !enc.args?.includes('-ac') &&
      sizedAudioKbps !== undefined &&
      sizedAudioKbps <= SOUND_FLOOR_KBPS
    )
      audioArgs.push('-ac', '1')
    // loudnorm works at 192 kHz and would write it: keep the file's own rate,
    // or, when the encoder takes only some, its first (Opus refuses 44.1 kHz:
    // 48).
    if (loudness !== undefined && a) {
      const keep = !enc.rates || enc.rates.includes(a.sampleRate)
      audioArgs.push('-ar', String(keep ? a.sampleRate : enc.rates?.[0]))
    }
  }

  // ---- around them
  const pre: string[] = []
  if (start > 0) pre.push('-ss', secsUp(start))
  // On the input, so it is the source's seconds, before any speed change.
  if (m.cut) pre.push('-t', secs(span))
  const input = [...pre, '-i', job.input]
  const cut: string[] = []
  const maps = [...(wantVideo ? ['-map', '0:v:0'] : []), ...(wantAudio ? ['-map', '0:a:0'] : [])]
  const meta = options.keepMetadata ? [] : ['-map_metadata', '-1']
  const muxer = MUXER[target] ?? target
  const fast = ['mp4', 'hevc', 'mov', 'm4a'].includes(target) ? ['-movflags', '+faststart'] : []
  const out = ['-f', muxer, '-y', job.output]
  const nul = platform === 'win32' ? 'NUL' : '/dev/null'

  const steps: EncodeStep[] = []
  if (m.cleanup) {
    steps.push({
      args: [...input, ...cut, '-vn', '-af', NOISE_MEASURE, '-f', 'null', nul],
      measures: 'noise',
    })
  }
  if (loudness !== undefined) {
    steps.push({
      args: [
        ...input,
        ...cut,
        '-vn',
        '-af',
        `${[...cleanup, ...(speed !== 1 ? atempo(speed) : [])].map((f) => `${f},`).join('')}loudnorm=I=${loudness}:TP=-1.5:LRA=11:print_format=json`,
        '-f',
        'null',
        nul,
      ],
      measures: 'loudness',
      pass: { at: 1, of: 2 },
    })
  }
  const twoPass = twoPassable
  if (twoPass) {
    steps.push({
      args: [
        ...input,
        ...cut,
        ...maps.slice(0, 2),
        ...videoArgs,
        '-pass',
        '1',
        '-passlogfile',
        job.passlog,
        '-an',
        '-f',
        'null',
        nul,
      ],
      pass: { at: 1, of: 2 },
    })
    steps.push({
      args: [
        ...input,
        ...cut,
        ...maps,
        ...videoArgs,
        '-pass',
        '2',
        '-passlogfile',
        job.passlog,
        ...audioArgs,
        ...meta,
        ...fast,
        ...out,
      ],
      pass: { at: 2, of: 2 },
    })
  } else {
    steps.push({
      args: [...input, ...cut, ...maps, ...videoArgs, ...audioArgs, ...meta, ...fast, ...out],
      // After loudness was measured: the second of two passes, with its own bar.
      ...(loudness !== undefined ? { pass: { at: 2 as const, of: 2 as const } } : {}),
    })
  }

  return {
    steps,
    duration,
    copies: { video: copyVideo, audio: copyAudio },
    ...(fitted ? { fitted } : {}),
  }
}
