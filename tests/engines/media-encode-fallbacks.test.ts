import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'
import { encoderMissing, type ForgeError, isForgeError } from '../../src/core/errors.js'
import type { ConvertOptions, FormatId, MediaFacts, MediaInfo } from '../../src/core/types.js'
import { findFfmpeg, forceFfmpegForTests, probeMedia } from '../../src/engines/ffmpeg.js'
import { encodeRefusal, soundEngine, videoEngine } from '../../src/engines/media.js'
import { kbpsForCrf, planEncode } from '../../src/engines/media-encode.js'
import { makeTempDir } from '../helpers/fixtures.js'
import { ffmpegHere, makeClip } from '../helpers/media.js'

/**
 * Encoders by what the ffmpeg found was built with. Fedora's ffmpeg-free has
 * no x264 or x265 (OpenH264, VPX, AOM/SVT-AV1, Opus, LAME, Vorbis and the
 * VA-API hardware encoders instead); a minimal build has ffmpeg's own alone.
 */

const screen: MediaFacts = {
  duration: 130,
  video: { codec: 'h264', width: 2940, height: 1912, fps: 60, rotation: 0, hdr: false },
  audio: { codec: 'aac', channels: 2, sampleRate: 48000 },
}
const podcast: MediaFacts = {
  duration: 3492,
  audio: { codec: 'pcm_s16le', channels: 2, sampleRate: 44100 },
}
const base: ConvertOptions = { background: '#ffffff', keepMetadata: false }

/** ffmpeg's own encoders and the filters Forge uses: in every build. */
const OWN = [
  'aac',
  'flac',
  'pcm_s16le',
  'pcm_s16be',
  'gif',
  'vorbis',
  'mpeg4',
  'palettegen',
  'paletteuse',
  'loudnorm',
  'atempo',
  'scale',
  'crop',
]
const FEDORA = new Set([
  ...OWN,
  'opus',
  'libopenh264',
  'libvpx',
  'libvpx-vp9',
  'libaom-av1',
  'libsvtav1',
  'libopus',
  'libmp3lame',
  'libvorbis',
  'h264_vaapi',
  'hevc_vaapi',
  'vp9_vaapi',
  'av1_vaapi',
  'zscale',
])
/** Every encoder and filter Forge can ask for. */
const FULL = new Set([
  ...FEDORA,
  'libx264',
  'libx265',
  'aac_at',
  'h264_videotoolbox',
  'hevc_videotoolbox',
  'h264_mf',
])
const BARE = new Set(OWN)

function plan(
  target: FormatId,
  options: Partial<ConvertOptions> = {},
  facts: MediaFacts = screen,
  platform: NodeJS.Platform = 'linux',
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
const flag = (args: string[], name: string) => args[args.indexOf(name) + 1]
/** What planning throws, which must be the refusal. */
function refusal(run: () => unknown): ForgeError {
  try {
    run()
  } catch (e) {
    if (isForgeError(e)) return e
    throw e
  }
  throw new Error('planned without refusing')
}

const SPEED = { media: { speed: 2 } }
const COMPRESS = { compress: { dither: false }, quality: 60 }
const SIZED = { compress: { dither: false }, media: { targetBytes: 10_000_000 } }

describe('a full build plans as it always has', () => {
  const videos: FormatId[] = ['mp4', 'mov', 'hevc', 'webm', 'mkv', 'avi', 'gif', 'mp3', 'm4a']
  const sounds: FormatId[] = ['mp3', 'm4a', 'opus', 'flac', 'aiff', 'wav']
  const asks: Partial<ConvertOptions>[] = [
    {},
    SPEED,
    COMPRESS,
    SIZED,
    { media: { loudness: -16 } },
    { resize: { width: 1080 } },
  ]
  for (const platform of ['darwin', 'linux', 'win32'] as const) {
    it(`on ${platform}: every target and ask, the same arguments as with nothing known`, () => {
      for (const ask of asks) {
        for (const t of videos)
          expect(plan(t, ask, screen, platform, FULL)).toEqual(plan(t, ask, screen, platform))
        for (const t of sounds)
          expect(plan(t, ask, podcast, platform, FULL)).toEqual(plan(t, ask, podcast, platform))
      }
    })
  }
})

describe('Fedora’s ffmpeg-free: no x264, no x265', () => {
  it('writes H.264 with OpenH264, at a bitrate standing in for x264’s CRF 21', () => {
    const args = single(plan('mp4', SPEED, screen, 'linux', FEDORA))
    expect(flag(args, '-c:v')).toBe('libopenh264')
    // 2× speed keeps every frame: 120 a second.
    expect(flag(args, '-b:v')).toBe(`${kbpsForCrf(21, 2940 * 1912 * 120)}k`)
    expect(args).not.toContain('-crf')
    expect(args).not.toContain('-preset')
    expect(flag(args, '-pix_fmt')).toBe('yuv420p')
    // The sound is untouched by it.
    expect(flag(args, '-c:a')).toBe('aac')
  })

  it('moves the bitrate with the quality asked for, and with the picture’s size', () => {
    const kbps = (args: string[]) => Number.parseInt(flag(args, '-b:v') ?? '0', 10)
    const at = (quality: number, extra: Partial<ConvertOptions> = {}) =>
      kbps(single(plan('mov', { ...COMPRESS, quality, ...extra }, screen, 'linux', FEDORA)))
    expect(at(60)).toBe(kbpsForCrf(26, 2940 * 1912 * 60))
    expect(at(10)).toBeLessThan(at(60))
    expect(at(60)).toBeLessThan(at(95))
    expect(at(60, { resize: { width: 1470 } })).toBeLessThan(at(60) / 3)
  })

  it('fits a size in one pass of OpenH264, which keeps no notes for a second', () => {
    const p = plan('mp4', SIZED, screen, 'linux', FEDORA)
    const args = single(p)
    expect(flag(args, '-c:v')).toBe('libopenh264')
    expect(args).not.toContain('-pass')
    expect(flag(args, '-b:v')).toMatch(/^\d+k$/)
    expect(p.fitted).toBeDefined()
  })

  it('writes MKV and AVI with OpenH264 too', () => {
    for (const t of ['mkv', 'avi'] as const)
      expect(flag(single(plan(t, SPEED, screen, 'linux', FEDORA)), '-c:v')).toBe('libopenh264')
  })

  it('still copies what needs no encoder', () => {
    expect(plan('mp4', {}, screen, 'linux', FEDORA).copies).toEqual({ video: true, audio: true })
  })

  it('writes WebM, MP3 and Opus as before', () => {
    const webm = single(plan('webm', {}, screen, 'linux', FEDORA))
    expect(flag(webm, '-c:v')).toBe('libvpx-vp9')
    expect(flag(webm, '-c:a')).toBe('libopus')
    expect(flag(single(plan('mp3', {}, podcast, 'linux', FEDORA)), '-c:a')).toBe('libmp3lame')
    expect(flag(single(plan('opus', {}, podcast, 'linux', FEDORA)), '-c:a')).toBe('libopus')
  })

  it('refuses HEVC before ffmpeg runs, naming libx265 and the fix', () => {
    const e = refusal(() => plan('hevc', {}, screen, 'linux', FEDORA))
    expect(e.code).toBe('encoder-missing')
    expect(e.title).toBe("Your ffmpeg can't write HEVC")
    expect(e.detail).toBe('HEVC needs an HEVC encoder: libx265. Your ffmpeg was built without it.')
    expect(e.short).toBe('Your ffmpeg has no HEVC encoder')
    expect(e.hint).toBe(
      "Install a full build of ffmpeg, then run Forge again. On Fedora, RPM Fusion's ffmpeg replaces ffmpeg-free.",
    )
  })

  it('never picks a VA-API encoder, which needs a device set up', () => {
    const vaapiOnly = new Set([...BARE, 'h264_vaapi', 'hevc_vaapi', 'vp9_vaapi'])
    for (const t of ['mp4', 'hevc', 'webm'] as const)
      expect(refusal(() => plan(t, SPEED, screen, 'linux', vaapiOnly)).code).toBe('encoder-missing')
  })
})

describe('the rest of each chain', () => {
  it('on a Mac without x264, compresses and fits with Apple’s encoder, in one pass', () => {
    const mac = new Set([...BARE, 'h264_videotoolbox', 'libopenh264'])
    const q = single(plan('mp4', COMPRESS, screen, 'darwin', mac))
    expect(flag(q, '-c:v')).toBe('h264_videotoolbox')
    expect(flag(q, '-q:v')).toBe('56')
    const sized = single(plan('mp4', SIZED, screen, 'darwin', mac))
    expect(flag(sized, '-c:v')).toBe('h264_videotoolbox')
    expect(flag(sized, '-b:v')).toMatch(/^\d+k$/)
    // Planned again in software when Apple's refuses: OpenH264.
    expect(flag(single(plan('mp4', COMPRESS, screen, 'linux', mac)), '-c:v')).toBe('libopenh264')
  })

  it('on Windows, falls back to Media Foundation’s H.264, at a bitrate', () => {
    const win = new Set([...BARE, 'h264_mf', 'hevc_mf'])
    const args = single(plan('mp4', SPEED, screen, 'win32', win))
    expect(flag(args, '-c:v')).toBe('h264_mf')
    expect(flag(args, '-b:v')).toMatch(/^\d+k$/)
    // Never off Windows, and never its HEVC (Windows' paid extension, or a GPU).
    expect(refusal(() => plan('mp4', SPEED, screen, 'linux', win)).code).toBe('encoder-missing')
    expect(refusal(() => plan('hevc', SPEED, screen, 'win32', win)).code).toBe('encoder-missing')
  })

  it('writes AVI with ffmpeg’s own MPEG-4 when there is no H.264 encoder at all', () => {
    expect(single(plan('avi', SPEED, screen, 'linux', BARE)).join(' ')).toContain(
      '-c:v mpeg4 -q:v 3',
    )
    const low = single(plan('avi', { ...COMPRESS, quality: 10 }, screen, 'linux', BARE))
    const high = single(plan('avi', { ...COMPRESS, quality: 90 }, screen, 'linux', BARE))
    expect(Number(flag(low, '-q:v'))).toBeGreaterThan(Number(flag(high, '-q:v')))
  })

  it('writes WebM’s sound as Vorbis without libopus, then with ffmpeg’s own Opus', () => {
    const noOpus = new Set([...BARE, 'libvpx-vp9', 'libvorbis', 'opus'])
    expect(flag(single(plan('webm', {}, screen, 'linux', noOpus)), '-c:a')).toBe('libvorbis')
    noOpus.delete('libvorbis')
    const own = single(plan('webm', {}, screen, 'linux', noOpus))
    expect(flag(own, '-c:a')).toBe('opus')
    expect(flag(own, '-strict')).toBe('-2')
  })

  it('writes Opus with ffmpeg’s own encoder, at 48 kHz when evening out loudness', () => {
    const own = new Set([...BARE, 'opus'])
    const p = plan('opus', { media: { loudness: -16 } }, podcast, 'linux', own)
    const args = p.steps[1]?.args ?? []
    expect(flag(args, '-c:a')).toBe('opus')
    expect(flag(args, '-strict')).toBe('-2')
    expect(flag(args, '-ar')).toBe('48000')
  })

  it('evens out loudness for libopus at a rate it takes: 44.1 kHz becomes 48', () => {
    const opus = plan('opus', { media: { loudness: -16 } }, podcast, 'linux', FULL)
    expect(flag(opus.steps[1]?.args ?? [], '-ar')).toBe('48000')
    const at16: MediaFacts = {
      ...podcast,
      audio: { codec: 'pcm_s16le', channels: 1, sampleRate: 16000 },
    }
    const kept = plan('opus', { media: { loudness: -16 } }, at16, 'linux', FULL)
    expect(flag(kept.steps[1]?.args ?? [], '-ar')).toBe('16000')
    // A format that takes any rate keeps the file's own.
    const mp3 = plan('mp3', { media: { loudness: -16 } }, podcast, 'linux', FULL)
    expect(flag(mp3.steps[1]?.args ?? [], '-ar')).toBe('44100')
  })
})

describe('a build with ffmpeg’s own encoders alone', () => {
  it('writes what needs nothing more: GIF, M4A, WAV, FLAC', () => {
    expect(flag(single(plan('gif', SPEED, screen, 'linux', BARE)), '-c:v')).toBe('gif')
    for (const t of ['m4a', 'wav', 'flac'] as const)
      expect(() => plan(t, { media: { speed: 2 } }, podcast, 'linux', BARE)).not.toThrow()
  })

  it('refuses each of the rest, naming every encoder it looked for', () => {
    const detail = (t: FormatId, facts = screen, platform: NodeJS.Platform = 'linux') =>
      refusal(() => plan(t, SPEED, facts, platform, BARE)).detail
    expect(detail('mp4')).toBe(
      'MP4 needs an H.264 encoder: libx264 or libopenh264. Your ffmpeg was built without any of them.',
    )
    expect(detail('mov', screen, 'darwin')).toBe(
      'MOV needs an H.264 encoder: libx264, h264_videotoolbox or libopenh264. Your ffmpeg was built without any of them.',
    )
    expect(detail('mkv', screen, 'win32')).toBe(
      'MKV needs an H.264 encoder: libx264, libopenh264 or h264_mf. Your ffmpeg was built without any of them.',
    )
    expect(detail('hevc', screen, 'darwin')).toBe(
      'HEVC needs an HEVC encoder: libx265 or hevc_videotoolbox. Your ffmpeg was built without any of them.',
    )
    expect(detail('webm')).toBe(
      'WebM needs a VP9 encoder: libvpx-vp9. Your ffmpeg was built without it.',
    )
    expect(detail('mp3', podcast)).toBe(
      'MP3 needs an MP3 encoder: libmp3lame. Your ffmpeg was built without it.',
    )
    expect(detail('opus', podcast)).toBe(
      'Opus needs an Opus encoder: libopus or opus. Your ffmpeg was built without any of them.',
    )
    const vp9 = new Set([...BARE, 'libvpx-vp9'])
    expect(refusal(() => plan('webm', SPEED, screen, 'linux', vp9)).detail).toBe(
      'WebM needs an Opus or Vorbis encoder for its sound: libopus, libvorbis or opus. Your ffmpeg was built without any of them.',
    )
  })

  it('advises in this computer’s words, not the platform planned for', () => {
    // A Mac planning again in software once Apple's encoder refused.
    const e = refusal(() =>
      planEncode({
        input: '/in/a.mov',
        output: '/out/a.mp4',
        target: 'mp4',
        facts: screen,
        options: { ...base, ...SPEED },
        platform: 'linux',
        os: 'darwin',
        passlog: '/tmp/p',
        has: BARE,
      }),
    )
    expect(e.hint).toBe(
      'Install a full build of ffmpeg (brew install ffmpeg), then run Forge again.',
    )
  })
})

describe('the refusal’s words', () => {
  const h264 = { codec: 'H.264', encoders: ['libx264', 'libopenh264'] }
  it('says how to get a full build on each computer', () => {
    expect(encoderMissing('mp4', h264, 'darwin').hint).toBe(
      'Install a full build of ffmpeg (brew install ffmpeg), then run Forge again.',
    )
    expect(encoderMissing('mp4', h264, 'win32').hint).toBe(
      "Install a full build of ffmpeg, such as gyan.dev's (winget install ffmpeg), then run Forge again.",
    )
    expect(encoderMissing('mp4', h264, 'linux').hint).toBe(
      "Install a full build of ffmpeg, then run Forge again. On Fedora, RPM Fusion's ffmpeg replaces ffmpeg-free.",
    )
  })
})

describe('asked when a format is picked', () => {
  afterEach(() => forceFfmpegForTests(null))
  const source: MediaInfo = {
    kind: 'media',
    path: '/in/rec.mov',
    format: 'mov',
    bytes: 1_000_000,
    facts: screen,
  }

  it('refuses what the plain conversion cannot write, and nothing a copy can', () => {
    forceFfmpegForTests({ ffmpeg: '/nowhere/ffmpeg', ffprobe: '/nowhere/ffprobe', has: FEDORA })
    expect(encodeRefusal(source, 'hevc')?.code).toBe('encoder-missing')
    expect(encodeRefusal(source, 'mp4')).toBeUndefined()
    expect(encodeRefusal(source, 'webm')).toBeUndefined()
  })

  it('says nothing when it knows nothing', () => {
    forceFfmpegForTests({ ffmpeg: '/nowhere/ffmpeg', ffprobe: '/nowhere/ffprobe' })
    expect(encodeRefusal(source, 'hevc')).toBeUndefined()
    expect(encodeRefusal({ ...source, facts: undefined } as MediaInfo, 'hevc')).toBeUndefined()
  })

  it('refuses a run before ffmpeg runs, making nothing', async () => {
    forceFfmpegForTests({ ffmpeg: '/nowhere/ffmpeg', ffprobe: '/nowhere/ffprobe', has: FEDORA })
    const out = join(await makeTempDir(), 'not-made', 'out.mp4')
    const job = {
      op: 'convert' as const,
      sources: [source] as [MediaInfo],
      outputs: [out] as [string],
      target: 'hevc' as const,
      options: base,
    }
    await expect(videoEngine.run(job, () => {})).rejects.toMatchObject({ code: 'encoder-missing' })
    expect(existsSync(join(out, '..'))).toBe(false)
  })
})

const run = promisify(execFile)

describe.skipIf(!ffmpegHere)('with this ffmpeg, told it has less', () => {
  afterEach(() => forceFfmpegForTests(null))

  /** The real ffmpeg, with only `names` (and ffmpeg's own) said to be there. */
  async function lean(...names: string[]) {
    forceFfmpegForTests(null)
    const real = await findFfmpeg()
    if (!real) throw new Error('no ffmpeg')
    forceFfmpegForTests({ ...real, has: new Set([...OWN, ...names]) })
  }
  const convert = async (source: MediaInfo, target: FormatId, over: Partial<ConvertOptions>) => {
    const out = join(await makeTempDir(), `out.${target}`)
    const job = {
      op: 'convert' as const,
      sources: [source] as [MediaInfo],
      outputs: [out] as [string],
      target,
      options: { ...base, ...over },
    }
    const engine = source.facts?.video ? videoEngine : soundEngine
    await engine.run(job, () => {})
    return probeMedia(out)
  }

  it('writes an AVI with ffmpeg’s own MPEG-4', async () => {
    const clip = await makeClip({ seconds: 1 })
    const source = (await videoEngine.probe(clip)) as MediaInfo
    await lean()
    const facts = await convert(source, 'avi', { media: { speed: 2 } })
    expect(facts.video?.codec).toBe('mpeg4')
  })

  it('writes Opus with ffmpeg’s own encoder from 44.1 kHz, loudness evened', async () => {
    const wav = join(await makeTempDir(), 'tone.wav')
    await run('ffmpeg', [
      ...['-hide_banner', '-loglevel', 'error', '-f', 'lavfi'],
      ...['-i', 'sine=frequency=440:sample_rate=44100', '-t', '2', '-y', wav],
    ])
    const source = (await soundEngine.probe(wav)) as MediaInfo
    await lean('opus')
    const facts = await convert(source, 'opus', { media: { loudness: -16 } })
    expect(facts.audio).toMatchObject({ codec: 'opus', sampleRate: 48000 })
  })

  it('writes Opus with libopus from 44.1 kHz, loudness evened (it refuses 44.1)', async () => {
    const wav = join(await makeTempDir(), 'tone.wav')
    await run('ffmpeg', [
      ...['-hide_banner', '-loglevel', 'error', '-f', 'lavfi'],
      ...['-i', 'sine=frequency=440:sample_rate=44100', '-t', '2', '-y', wav],
    ])
    const source = (await soundEngine.probe(wav)) as MediaInfo
    await lean('libopus')
    expect((await convert(source, 'opus', { media: { loudness: -16 } })).audio?.codec).toBe('opus')
  })
})
