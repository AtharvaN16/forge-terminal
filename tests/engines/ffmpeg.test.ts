import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  ffmpegCandidates,
  findFfmpeg,
  forceFfmpegForTests,
  frameAt,
  probeMedia,
  readNames,
  readProgress,
  runFfmpeg,
  soundLevels,
} from '../../src/engines/ffmpeg.js'
import { makeTempDir } from '../helpers/fixtures.js'
import { ffmpegHere, makeClip } from '../helpers/media.js'

describe('ffmpegCandidates', () => {
  it('looks in Homebrew’s places on a Mac, after PATH', () => {
    const c = ffmpegCandidates('darwin', { PATH: '/usr/bin:/bin' })
    expect(c.slice(0, 2)).toEqual(['/usr/bin', '/bin'])
    expect(c).toContain('/opt/homebrew/bin')
    expect(c).toContain('/usr/local/bin')
  })

  it('reads PATH with semicolons on Windows', () => {
    const c = ffmpegCandidates('win32', { Path: 'C:\\ff\\bin;C:\\Windows' })
    expect(c.slice(0, 2)).toEqual(['C:\\ff\\bin', 'C:\\Windows'])
  })
})

describe('readProgress', () => {
  it('takes the seconds encoded from ffmpeg’s -progress lines', () => {
    expect(readProgress('frame=90\nout_time_us=2933333\nprogress=continue\n')).toBeCloseTo(2.933, 2)
  })
  it('ignores the N/A ffmpeg prints before the first frame', () => {
    expect(readProgress('out_time_us=N/A\n')).toBeUndefined()
  })
  it('takes the last report in a chunk', () => {
    expect(readProgress('out_time_us=1000000\nout_time_us=2000000\n')).toBe(2)
  })
})

describe('without ffmpeg', () => {
  afterEach(() => forceFfmpegForTests(null))

  it('reports none', async () => {
    forceFfmpegForTests(undefined)
    expect(await findFfmpeg()).toBeUndefined()
  })
})

describe.skipIf(!ffmpegHere)('with ffmpeg', () => {
  it('finds it', async () => {
    const found = await findFfmpeg()
    expect(found && existsSync(found.ffmpeg)).toBe(true)
    expect(found && existsSync(found.ffprobe)).toBe(true)
  })

  it('reads a clip’s facts', async () => {
    const clip = await makeClip({ seconds: 2, width: 320, height: 240 })
    expect(await probeMedia(clip)).toEqual({
      duration: 2,
      video: { codec: 'h264', width: 320, height: 240, fps: 30, rotation: 0, hdr: false },
      audio: { codec: 'aac', channels: 1, sampleRate: 48000 },
    })
  })

  it('reports the seconds encoded as it goes', async () => {
    const clip = await makeClip({ seconds: 2 })
    const out = join(await makeTempDir(), 'out.mp4')
    const seen: number[] = []
    await runFfmpeg(['-i', clip, '-c:v', 'libx264', '-preset', 'ultrafast', '-y', out], {
      onTime: (s) => seen.push(s),
    })
    expect(existsSync(out)).toBe(true)
    expect(seen.length).toBeGreaterThan(0)
    expect(Math.max(...seen)).toBeGreaterThan(1.5)
  })

  it('stops when aborted, and says so', async () => {
    const clip = await makeClip({ seconds: 2 })
    const out = join(await makeTempDir(), 'out.mp4')
    const stop = new AbortController()
    stop.abort()
    await expect(runFfmpeg(['-i', clip, '-y', out], { signal: stop.signal })).rejects.toMatchObject(
      { name: 'AbortError' },
    )
  })

  it('turns a failure into an error carrying ffmpeg’s last words', async () => {
    const out = join(await makeTempDir(), 'out.mp4')
    await expect(runFfmpeg(['-i', '/no/such/file.mov', '-y', out], {})).rejects.toThrow(
      /No such file/,
    )
  })
})

describe.skipIf(!ffmpegHere)('levels and frames', () => {
  it('reads the sound’s loudness, one level per column', async () => {
    const clip = await makeClip({ seconds: 2 })
    const levels = await soundLevels(clip, 2, 40)
    expect(levels).toHaveLength(40)
    expect(Math.max(...(levels ?? []))).toBeCloseTo(1)
    expect(Math.min(...(levels ?? []))).toBeGreaterThan(0.5)
  })

  it('says null for a video with no sound', async () => {
    const clip = await makeClip({ seconds: 1, audio: false })
    expect(await soundLevels(clip, 1, 40)).toBeNull()
  })

  it('writes one frame as a PNG', async () => {
    const clip = await makeClip({ seconds: 2, width: 320, height: 240 })
    const out = join(await makeTempDir(), 'frame.png')
    await frameAt(clip, 1, out)
    expect(existsSync(out)).toBe(true)
  })
})

describe('readNames', () => {
  it('reads the encoders and filters this ffmpeg was built with', () => {
    const text = [
      'Encoders:',
      ' V..... = Video',
      ' ------',
      ' V....D libx264              libx264 H.264',
      ' A....D aac                  AAC',
      ' ... zscale            V->V       Apply resizing',
    ].join('\n')
    const names = readNames(text)
    expect(names.has('libx264')).toBe(true)
    expect(names.has('aac')).toBe(true)
    expect(names.has('zscale')).toBe(true)
    expect(names.has('=')).toBe(false)
  })
})
