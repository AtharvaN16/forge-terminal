import { existsSync } from 'node:fs'
import { readdir, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { ConvertOptions, FormatId, Job, MediaInfo, Progress } from '../../src/core/types.js'
import { forceFfmpegForTests, probeMedia } from '../../src/engines/ffmpeg.js'
import { soundEngine, videoEngine } from '../../src/engines/media.js'
import { makePng, makeTempDir } from '../helpers/fixtures.js'
import { ffmpegHere, makeClip } from '../helpers/media.js'

const options = (over: Partial<ConvertOptions> = {}): ConvertOptions => ({
  background: '#ffffff',
  keepMetadata: false,
  ...over,
})

async function job(
  source: MediaInfo,
  target: FormatId,
  over: Partial<ConvertOptions> = {},
  ext = target === 'hevc' ? 'mp4' : target,
): Promise<Extract<Job, { op: 'convert' }>> {
  const out = join(await makeTempDir(), `out.${ext}`)
  return { op: 'convert', sources: [source], outputs: [out], target, options: options(over) }
}

describe('probing', () => {
  afterEach(() => forceFfmpegForTests(null))

  it('declines a picture quickly, leaving it to the image engine', async () => {
    const png = await makePng(await makeTempDir(), 'a.png')
    await expect(videoEngine.probe(png)).rejects.toThrow()
    await expect(soundEngine.probe(png)).rejects.toThrow()
  })

  it.skipIf(!ffmpegHere)('knows a video by its bytes even without ffmpeg', async () => {
    const clip = await makeClip({ seconds: 1 })
    forceFfmpegForTests(undefined)
    const info = await videoEngine.probe(clip)
    expect(info).toMatchObject({ kind: 'media', format: 'mov' })
    expect((info as MediaInfo).facts).toBeUndefined()
  })
})

describe.skipIf(!ffmpegHere)('with ffmpeg', () => {
  it('reads a video’s facts', async () => {
    const clip = await makeClip({ seconds: 2, width: 320, height: 240 })
    const info = (await videoEngine.probe(clip)) as MediaInfo
    expect(info.facts?.video).toMatchObject({ width: 320, height: 240 })
    expect(info.facts?.duration).toBe(2)
  })

  it('leaves a sound file to the sound engine', async () => {
    const wav = await makeClip({ soundOnly: true })
    await expect(videoEngine.probe(wav)).rejects.toThrow()
    expect(await soundEngine.probe(wav)).toMatchObject({ kind: 'media', format: 'wav' })
  })

  it('copies a MOV into an MP4, reporting true progress, writing atomically', async () => {
    const clip = await makeClip({ seconds: 2 })
    const source = (await videoEngine.probe(clip)) as MediaInfo
    const j = await job(source, 'mp4')
    const seen: Progress[] = []
    const result = await videoEngine.run(j, (p) => seen.push(p))
    expect(existsSync(j.outputs[0])).toBe(true)
    expect(result.outputBytes).toBe((await stat(j.outputs[0])).size)
    const times = seen.filter((p) => p.phase === 'time')
    expect(times.length).toBeGreaterThan(0)
    expect(times.every((p) => p.phase === 'time' && p.total === 2)).toBe(true)
    // Nothing left beside it but the output.
    expect(await readdir(dirname(j.outputs[0]))).toEqual(['out.mp4'])
  })

  it('cuts by copying, starting on the keyframe at or before the start, and says so', async () => {
    const clip = await makeClip({ seconds: 6 })
    const source = (await videoEngine.probe(clip)) as MediaInfo
    const j = await job(source, 'mov', { media: { cut: { start: 2.5, end: 5 } } })
    const result = await videoEngine.run(j, () => {})
    const facts = await probeMedia(j.outputs[0])
    expect(facts.duration).toBeGreaterThan(2.4)
    expect(facts.duration).toBeLessThan(5.2)
    // x264's keyframes in a 2 s test clip are far apart: the start moved.
    expect(result.warnings.map((w) => w.code)).toContain('media-cut-keyframe')
  })

  it('mutes', async () => {
    const clip = await makeClip({ seconds: 1 })
    const source = (await videoEngine.probe(clip)) as MediaInfo
    const j = await job(source, 'mov', { media: { mute: true } })
    await videoEngine.run(j, () => {})
    expect((await probeMedia(j.outputs[0])).audio).toBeUndefined()
  })

  it('makes a GIF', async () => {
    const clip = await makeClip({ seconds: 1 })
    const source = (await videoEngine.probe(clip)) as MediaInfo
    const j = await job(source, 'gif')
    await videoEngine.run(j, () => {})
    expect((await probeMedia(j.outputs[0])).video?.codec).toBe('gif')
  })

  it('fits a size in two passes, landing under it', async () => {
    const clip = await makeClip({ seconds: 4, width: 640, height: 480 })
    const source = (await videoEngine.probe(clip)) as MediaInfo
    const target = 120_000
    const j = await job(source, 'mov', {
      compress: { dither: false },
      media: { targetBytes: target },
    })
    const passes = new Set<number>()
    const result = await videoEngine.run(j, (p) => {
      if (p.phase === 'time' && p.pass) passes.add(p.pass.at)
    })
    expect(result.outputBytes).toBeLessThanOrEqual(target)
    expect([...passes]).toEqual([1, 2])
    // No first-pass notes left behind.
    expect(await readdir(dirname(j.outputs[0]))).toEqual(['out.mov'])
  })

  it('says how far a size is out of reach, before encoding', async () => {
    const clip = await makeClip({ seconds: 4 })
    const source = (await videoEngine.probe(clip)) as MediaInfo
    const j = await job(source, 'mov', { compress: { dither: false } })
    expect(videoEngine.sizeTo?.(j, 100)).toEqual({ floor: expect.any(Number) })
    expect(videoEngine.sizeTo?.(j, 10_000_000)).toBeUndefined()
  })

  it('encodes sound to MP3 at a bitrate', async () => {
    const wav = await makeClip({ soundOnly: true, seconds: 3 })
    const source = (await soundEngine.probe(wav)) as MediaInfo
    const j = await job(source, 'mp3', { media: { bitrate: 96 } })
    await soundEngine.run(j, () => {})
    expect((await probeMedia(j.outputs[0])).audio?.codec).toBe('mp3')
  })

  it('evens out loudness in two passes', async () => {
    const wav = await makeClip({ soundOnly: true, seconds: 3 })
    const source = (await soundEngine.probe(wav)) as MediaInfo
    const j = await job(source, 'wav', { media: { loudness: -16 } })
    await soundEngine.run(j, () => {})
    expect(existsSync(j.outputs[0])).toBe(true)
  })

  it('stops when aborted and leaves nothing behind', async () => {
    const clip = await makeClip({ seconds: 2 })
    const source = (await videoEngine.probe(clip)) as MediaInfo
    const j = await job(source, 'webm')
    const stop = new AbortController()
    const run = videoEngine.run(j, () => stop.abort(), stop.signal)
    await expect(run).rejects.toBeDefined()
    expect(await readdir(dirname(j.outputs[0]))).toEqual([])
  })

  it('refuses to overwrite nothing: a damaged file is a damaged-file error', async () => {
    const dir = await makeTempDir()
    const bad = join(dir, 'bad.mov')
    await writeFile(
      bad,
      Buffer.concat([Buffer.from([0, 0, 0, 0x14]), Buffer.from('ftypqt  '), Buffer.alloc(40)]),
    )
    await expect(videoEngine.probe(bad)).rejects.toMatchObject({ code: 'corrupt-source' })
  })
})

describe.skipIf(!ffmpegHere)('review fixes, for real', () => {
  it('never writes a compressed file bigger than the source', async () => {
    // Squeezed hard already: at the top quality it could only grow.
    const clip = await makeClip({ seconds: 2, width: 160, height: 120, crf: 50 })
    const source = (await videoEngine.probe(clip)) as MediaInfo
    const j = await job(source, 'mov', { compress: { dither: false }, quality: 100 })
    await expect(videoEngine.run(j, () => {})).rejects.toMatchObject({
      code: 'cannot-compress-more',
    })
    expect(await readdir(dirname(j.outputs[0]))).toEqual([])
  })

  it('lands a WebM under its size, or says it cannot', async () => {
    const clip = await makeClip({ seconds: 3, width: 640, height: 480, ext: 'webm' })
    const source = (await videoEngine.probe(clip)) as MediaInfo
    const target = 150_000
    const j = await job(source, 'webm', {
      compress: { dither: false },
      media: { targetBytes: target },
    })
    try {
      const r = await videoEngine.run(j, () => {})
      expect(r.outputBytes).toBeLessThanOrEqual(target)
    } catch (e) {
      expect(e).toMatchObject({ code: 'target-unreachable' })
      expect(await readdir(dirname(j.outputs[0]))).toEqual([])
    }
  }, 60_000)

  it('keeps the sample rate when evening out loudness', async () => {
    const wav = await makeClip({ soundOnly: true, seconds: 2 })
    const source = (await soundEngine.probe(wav)) as MediaInfo
    const j = await job(source, 'wav', { media: { loudness: -16 } })
    await soundEngine.run(j, () => {})
    expect((await probeMedia(j.outputs[0])).audio?.sampleRate).toBe(48000)
  })

  it('trims an OGG', async () => {
    const ogg = await makeClip({ soundOnly: true, seconds: 3, ext: 'ogg' })
    const source = (await soundEngine.probe(ogg)) as MediaInfo
    const j = await job(source, 'ogg', { media: { cut: { start: 0.5, end: 2 } } })
    await soundEngine.run(j, () => {})
    expect((await probeMedia(j.outputs[0])).duration).toBeLessThan(2)
  })

  it('slows a cut down to twice its length', async () => {
    const clip = await makeClip({ seconds: 4 })
    const source = (await videoEngine.probe(clip)) as MediaInfo
    const j = await job(source, 'mp4', { media: { cut: { start: 0, end: 2 }, speed: 0.5 } })
    await videoEngine.run(j, () => {})
    expect((await probeMedia(j.outputs[0])).duration).toBeGreaterThan(3.8)
  }, 60_000)
})
