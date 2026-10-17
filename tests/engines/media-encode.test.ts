import { describe, expect, it } from 'vitest'
import type { ConvertOptions, FormatId, MediaFacts } from '../../src/core/types.js'
import { planEncode } from '../../src/engines/media-encode.js'

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
) {
  return planEncode({
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
    expect(vf).toContain('scale=1080:-2')
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
