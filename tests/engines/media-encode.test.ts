import { describe, expect, it } from 'vitest'
import type { ConvertOptions, FormatId, MediaFacts } from '../../src/core/types.js'
import { NOISE_FLOOR, noiseFloorOf, planEncode } from '../../src/engines/media-encode.js'

const screen: MediaFacts = {
  duration: 130,
  video: { codec: 'h264', width: 2940, height: 1912, fps: 60, rotation: 0, hdr: false },
  audio: { codec: 'aac', channels: 2, sampleRate: 48000 },
}
const podcast: MediaFacts = {
  duration: 3492,
  audio: { codec: 'pcm_s16le', channels: 2, sampleRate: 48000 },
}
const base: ConvertOptions = { background: '#ffffff', keepMetadata: false }

function plan(
  target: FormatId,
  options: Partial<ConvertOptions> = {},
  facts: MediaFacts = screen,
  platform: NodeJS.Platform = 'darwin',
  has?: ReadonlySet<string>,
) {
  return planEncode({
    ...(has ? { has } : {}),
    input: '/in/rec.mov',
    output: '/out/.tmp-rec.mp4',
    target,
    facts,
    options: { ...base, ...options },
    platform,
    passlog: '/tmp/passlog',
  })
}
const single = (p: ReturnType<typeof plan>) => {
  const [step] = p.steps
  if (!step || p.steps.length !== 1) throw new Error(`${p.steps.length} steps`)
  return step.args
}
const flag = (args: string[], flag: string) => args[args.indexOf(flag) + 1]

describe('copying instead of encoding', () => {
  it('copies an H.264 MOV into an MP4: seconds, nothing lost', () => {
    const p = plan('mp4')
    expect(p.copies).toEqual({ video: true, audio: true })
    const args = single(p)
    expect(flag(args, '-c:v')).toBe('copy')
    expect(flag(args, '-c:a')).toBe('copy')
    expect(args).toContain('+faststart')
  })

  it('copies when cutting, seeking before the input', () => {
    const args = single(plan('mov', { media: { cut: { start: 3.2, end: 41 } } }))
    expect(flag(args, '-c:v')).toBe('copy')
    expect(args.indexOf('-ss')).toBeLessThan(args.indexOf('-i'))
    expect(flag(args, '-ss')).toBe('3.2')
    expect(flag(args, '-t')).toBe('37.8')
    // -t on the input: measured before a speed change, not after it.
    expect(args.indexOf('-t')).toBeLessThan(args.indexOf('-i'))
  })

  it('mutes by copying the picture and dropping the sound', () => {
    const args = single(plan('mov', { media: { mute: true } }))
    expect(flag(args, '-c:v')).toBe('copy')
    expect(args).toContain('-an')
  })

  it('takes the sound out without touching it when AAC goes to M4A', () => {
    const args = single(plan('m4a'))
    expect(args).toContain('-vn')
    expect(flag(args, '-c:a')).toBe('copy')
  })
})

describe('encoding', () => {
  it('uses Apple’s hardware encoder for H.264 on a Mac when something changes', () => {
    const args = single(plan('mp4', { media: { speed: 2 } }))
    expect(flag(args, '-c:v')).toBe('h264_videotoolbox')
    expect(args.join(' ')).toContain('setpts=PTS/2')
    expect(args.join(' ')).toContain('atempo=2')
  })

  it('uses x264 on Windows', () => {
    const args = single(plan('mp4', { media: { speed: 2 } }, screen, 'win32'))
    expect(flag(args, '-c:v')).toBe('libx264')
  })

  it('writes HEVC with the tag QuickTime needs', () => {
    const args = single(plan('hevc'))
    expect(flag(args, '-c:v')).toBe('hevc_videotoolbox')
    expect(flag(args, '-tag:v')).toBe('hvc1')
  })

  it('writes WebM as VP9 and Opus', () => {
    const args = single(plan('webm'))
    expect(flag(args, '-c:v')).toBe('libvpx-vp9')
    expect(flag(args, '-c:a')).toBe('libopus')
  })

  it('keeps a variable frame rate rather than averaging it', () => {
    expect(single(plan('mp4', { media: { speed: 2 } }))).toContain('passthrough')
  })

  it('tone-maps HDR for H.264, and keeps it for HEVC', () => {
    const hdr = {
      ...screen,
      video: { ...(screen.video as NonNullable<MediaFacts['video']>), hdr: true },
    }
    expect(single(plan('mp4', {}, hdr)).join(' ')).toContain('tonemap')
    expect(single(plan('hevc', {}, hdr)).join(' ')).not.toContain('tonemap')
  })

  it('makes a GIF with its own palette, 800 px wide at 15 fps, no sound', () => {
    const args = single(plan('gif', { media: { cut: { start: 12, end: 19.5 } } }))
    const graph = args.join(' ')
    expect(graph).toContain('palettegen')
    expect(graph).toContain('fps=15')
    expect(graph).toContain('scale=800:-2')
    expect(args).toContain('-an')
  })

  it('crops before it resizes, and keeps both sides even', () => {
    const args = single(
      plan('mp4', {
        crop: { aspect: { w: 1, h: 1 }, box: { left: 514, top: 0, width: 1911, height: 1911 } },
        resize: { width: 1080 },
      }),
    )
    const vf = flag(args, '-vf') ?? ''
    expect(vf.indexOf('crop=')).toBeLessThan(vf.indexOf('scale='))
    expect(vf).toContain('crop=1910:1910:514:0')
    expect(vf).toContain('min(1080\\,iw)')
  })
})

describe('rotate', () => {
  const vfOf = (rotate: 90 | 180 | 270, extra: Partial<ConvertOptions> = {}) => {
    const p = plan('mp4', { rotate, ...extra })
    return { p, vf: flag(single(p), '-vf') ?? '' }
  }

  it('turns right with transpose=1 and left with transpose=2', () => {
    expect(vfOf(90).vf).toBe('transpose=1')
    expect(vfOf(270).vf).toBe('transpose=2')
  })

  it('turns a half turn with both flips', () => {
    expect(vfOf(180).vf).toBe('hflip,vflip')
  })

  it('encodes, since the picture changes: nothing is copied', () => {
    const { p } = vfOf(90)
    expect(p.copies.video).toBe(false)
    expect(p.copies.audio).toBe(true)
  })

  it('turns after the crop and the resize, which are of the upright picture', () => {
    const { vf } = vfOf(90, { resize: { width: 1080 } })
    expect(vf.indexOf('scale=')).toBeLessThan(vf.indexOf('transpose='))
  })
})

describe('compress', () => {
  it('fits a size in two passes of x264 at the planned picture', () => {
    const p = plan('mov', { compress: { dither: false }, media: { targetBytes: 10_000_000 } })
    expect(p.steps).toHaveLength(2)
    const [one, two] = p.steps.map((s) => s.args)
    expect(flag(one ?? [], '-pass')).toBe('1')
    expect(flag(two ?? [], '-pass')).toBe('2')
    expect(flag(two ?? [], '-c:v')).toBe('libx264')
    expect(flag(two ?? [], '-vf')).toContain('scale=1280:832')
    expect(flag(two ?? [], '-r')).toBe('24')
    expect(p.fitted).toEqual({ width: 1280, height: 832, fps: 24 })
  })

  it('compresses by quality with x264’s constant quality', () => {
    const args = single(plan('mov', { compress: { dither: false }, quality: 60 }))
    expect(flag(args, '-c:v')).toBe('libx264')
    expect(flag(args, '-crf')).toBe('26')
  })
})

describe('sound', () => {
  it('encodes a WAV to MP3 at the chosen bitrate', () => {
    const args = single(plan('mp3', { media: { bitrate: 128 } }, podcast))
    expect(flag(args, '-c:a')).toBe('libmp3lame')
    expect(flag(args, '-b:a')).toBe('128k')
  })

  it('evens out loudness in two passes', () => {
    const p = plan('wav', { media: { loudness: -16 } }, podcast)
    expect(p.steps).toHaveLength(2)
    expect(p.steps[0]?.args.join(' ')).toContain('loudnorm=I=-16')
    expect(p.steps[0]?.args.join(' ')).toContain('print_format=json')
  })

  it('cleans up in three steps: the noise is measured, then the level, then it is written', () => {
    const p = plan('wav', { media: { cleanup: true, loudness: -16 } }, podcast)
    expect(p.steps.map((s) => s.measures)).toEqual(['noise', 'loudness', undefined])
    // Only the last two are the passes Working counts.
    expect(p.steps.map((s) => s.pass?.at)).toEqual([undefined, 1, 2])
    const chain = (args: string[]) => flag(args, '-af') ?? ''
    for (const step of p.steps.slice(1)) {
      const af = chain(step.args)
      expect(af.indexOf('highpass')).toBeGreaterThanOrEqual(0)
      expect(af.indexOf('highpass')).toBeLessThan(af.indexOf('afftdn'))
      expect(af.indexOf('afftdn')).toBeLessThan(af.indexOf('loudnorm'))
      expect(af).toContain(`nf=${NOISE_FLOOR}`)
    }
  })

  it('measures the noise on the part that is kept', () => {
    const p = plan('wav', { media: { cleanup: true, cut: { start: 5, end: 20 } } }, podcast)
    expect(p.steps).toHaveLength(2)
    expect(p.steps[0]?.args).toContain('-ss')
    expect(flag(p.steps[0]?.args ?? [], '-t')).toBe('15')
  })

  it('cleans up a video’s sound and copies its picture', () => {
    const p = plan('mov', { media: { cleanup: true, loudness: -16 } })
    expect(p.copies).toEqual({ video: true, audio: false })
    expect(flag(p.steps[2]?.args ?? [], '-c:v')).toBe('copy')
    expect(flag(p.steps[2]?.args ?? [], '-c:a')).not.toBe('copy')
  })

  it('fits a size by arithmetic: one pass at the bitrate that lands', () => {
    const p = plan(
      'm4a',
      { compress: { dither: false }, media: { targetBytes: 50_000_000 } },
      podcast,
    )
    const args = single(p)
    const kbps = Number.parseInt(flag(args, '-b:a') ?? '0', 10)
    expect((kbps * 1000 * podcast.duration) / 8).toBeLessThanOrEqual(50_000_000)
    expect(kbps).toBeGreaterThan(100)
  })
})

describe('the output’s length', () => {
  it('is the cut, at the speed', () => {
    expect(plan('mp4', { media: { cut: { start: 3.2, end: 41 }, speed: 2 } }).duration).toBeCloseTo(
      18.9,
    )
  })
  it('is the whole file by default', () => {
    expect(plan('mp4').duration).toBe(130)
  })
})

describe('review fixes', () => {
  it('fits WebM to a size at a bitrate, in two passes', () => {
    const p = plan('webm', { compress: { dither: false }, media: { targetBytes: 10_000_000 } })
    expect(p.steps).toHaveLength(2)
    const two = p.steps[1]?.args ?? []
    expect(flag(two, '-c:v')).toBe('libvpx-vp9')
    expect(flag(two, '-b:v')).toMatch(/^\d+k$/)
  })

  it('writes a GIF into WebM as yuva420p, never the gbrap ffmpeg 9 picks', () => {
    const gif: MediaFacts = {
      duration: 1,
      video: { codec: 'gif', width: 32, height: 16, fps: 10, rotation: 0, hdr: false },
    }
    expect(flag(single(plan('webm', {}, gif)), '-pix_fmt')).toBe('yuva420p')
    expect(single(plan('webm'))).not.toContain('-pix_fmt')
  })

  it('compresses WebM by quality: the quality moves the constant quality', () => {
    const low = single(plan('webm', { compress: { dither: false }, quality: 10 }))
    const high = single(plan('webm', { compress: { dither: false }, quality: 90 }))
    expect(flag(low, '-crf')).not.toBe(flag(high, '-crf'))
  })

  it('keeps the sample rate when evening out loudness (loudnorm would make it 192 kHz)', () => {
    const p = plan('wav', { media: { loudness: -16 } }, podcast)
    expect(flag(p.steps[1]?.args ?? [], '-ar')).toBe('48000')
  })

  it('writes Vorbis back into an OGG', () => {
    const ogg: MediaFacts = {
      duration: 10,
      audio: { codec: 'vorbis', channels: 2, sampleRate: 44100 },
    }
    expect(flag(single(plan('ogg', { media: { cut: { start: 1, end: 5 } } }, ogg)), '-c:a')).toBe(
      'copy',
    )
    expect(flag(plan('ogg', { media: { loudness: -16 } }, ogg).steps[1]?.args ?? [], '-c:a')).toBe(
      'libvorbis',
    )
  })

  it('never makes a video bigger when resizing (a width over its own is its own)', () => {
    const args = single(plan('mp4', { resize: { width: 4000 } }))
    expect(flag(args, '-vf')).toContain('min(4000\\,iw)')
  })
})

describe('what this ffmpeg has', () => {
  const lean = new Set([
    'libx264',
    'aac',
    'libmp3lame',
    'libopus',
    'libvpx-vp9',
    'h264_videotoolbox',
    'hevc_videotoolbox',
  ])
  it('skips tone-mapping without zscale', () => {
    const hdr = {
      ...screen,
      video: { ...(screen.video as NonNullable<MediaFacts['video']>), hdr: true },
    }
    expect(single(plan('mp4', {}, hdr, 'darwin', lean)).join(' ')).not.toContain('zscale')
  })

  it('uses ffmpeg’s own AAC without Apple’s', () => {
    expect(flag(single(plan('mp4', { media: { speed: 2 } }, screen, 'darwin', lean)), '-c:a')).toBe(
      'aac',
    )
  })

  it('writes an OGG with ffmpeg’s own Vorbis without libvorbis (Homebrew’s ffmpeg)', () => {
    const ogg: MediaFacts = {
      duration: 10,
      audio: { codec: 'vorbis', channels: 1, sampleRate: 44100 },
    }
    const args = single(plan('ogg', { media: { speed: 2 } }, ogg, 'darwin', lean))
    expect(flag(args, '-c:a')).toBe('vorbis')
    // Experimental, and stereo only: a mono file is written as two channels.
    expect(flag(args, '-strict')).toBe('-2')
    expect(flag(args, '-ac')).toBe('2')
  })

  it('fits HEVC with Apple’s encoder when there is no x265', () => {
    const p = plan('hevc', { media: { targetBytes: 10_000_000 } }, screen, 'darwin', lean)
    const args = p.steps.at(-1)?.args ?? []
    expect(flag(args, '-c:v')).toBe('hevc_videotoolbox')
    expect(flag(args, '-b:v')).toMatch(/k$/)
  })
})

describe('extracting the sound of a video', () => {
  it.each([
    ['aac', 'm4a'],
    ['mp3', 'mp3'],
    ['opus', 'opus'],
  ] as const)('copies %s out as it is into %s', (codec, target) => {
    const facts: MediaFacts = { ...screen, audio: { codec, channels: 2, sampleRate: 48000 } }
    const p = plan(target, {}, facts)
    expect(p.copies.audio).toBe(true)
    expect(flag(single(p), '-c:a')).toBe('copy')
    expect(single(p)).toContain('-vn')
  })
})

describe('where the noise floor is set', () => {
  const report = (trough: string) => `[Parsed_astats_1 @ 0x1] RMS trough dB: ${trough}\n`
  it('sits 8 dB above the quietest stretch', () => {
    expect(noiseFloorOf(report('-57.377666'))).toBe(-49)
    expect(noiseFloorOf(report('-37.269087'))).toBe(-30)
  })
  it('never goes below -70 or above -30 (afftdn works within them)', () => {
    expect(noiseFloorOf(report('-90'))).toBe(-70)
    expect(noiseFloorOf(report('-12'))).toBe(-30)
  })
  it('falls back to afftdn’s own -50 when there is no quiet stretch to read', () => {
    expect(noiseFloorOf(report('-inf'))).toBe(-50)
    expect(noiseFloorOf('nothing here')).toBe(-50)
  })
})
