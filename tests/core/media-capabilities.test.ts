import { describe, expect, it } from 'vitest'
import { canConvert, targetIdsFor } from '../../src/core/capabilities.js'
import { FORMATS } from '../../src/core/formats.js'
import type { MediaInfo, SourceInfo } from '../../src/core/types.js'

const recording = (over: Partial<MediaInfo> = {}): MediaInfo => ({
  kind: 'media',
  path: '/tmp/rec.mov',
  format: 'mov',
  bytes: 184_000_000,
  facts: {
    duration: 130,
    video: { codec: 'h264', width: 2940, height: 1912, fps: 60, rotation: 0, hdr: false },
    audio: { codec: 'aac', channels: 2, sampleRate: 48000 },
  },
  ...over,
})
const podcast: MediaInfo = {
  kind: 'media',
  path: '/tmp/ep.wav',
  format: 'wav',
  bytes: 671_000_000,
  facts: { duration: 3492, audio: { codec: 'pcm_s16le', channels: 2, sampleRate: 48000 } },
}

describe('what a video can become', () => {
  it('offers the video formats, then audio only, and its own (for compress)', () => {
    expect(targetIdsFor(recording())).toEqual([
      'mp4',
      'mov',
      'hevc',
      'webm',
      'gif',
      'mp3',
      'm4a',
      'wav',
    ])
  })

  it('never offers a format that is only written to keep a file its own', () => {
    expect(targetIdsFor(recording({ format: 'mp4', path: '/tmp/rec.mp4' }))).not.toContain('mov')
  })

  it('offers no sound formats for a silent video', () => {
    const silent = recording()
    if (silent.facts) delete silent.facts.audio
    expect(targetIdsFor(silent)).toEqual(['mp4', 'mov', 'hevc', 'webm', 'gif'])
  })

  it('does not offer HEVC for a video that is already HEVC', () => {
    const phone = recording()
    if (phone.facts?.video) phone.facts.video.codec = 'hevc'
    expect(targetIdsFor(phone)).not.toContain('hevc')
  })

  it('still offers formats before ffmpeg has read the file', () => {
    expect(targetIdsFor(recording({ facts: undefined }))).toContain('mp4')
  })

  it('lets an animated GIF become a video', () => {
    const gif: SourceInfo = {
      kind: 'image',
      path: '/tmp/a.gif',
      format: 'gif',
      bytes: 9_000_000,
      width: 400,
      height: 300,
      hasAlpha: false,
      frames: 40,
    }
    expect(targetIdsFor(gif)).toContain('mp4')
    expect(targetIdsFor(gif)).not.toContain('mp3')
  })
})

describe('what a sound file can become', () => {
  it('offers the sound formats only', () => {
    expect(targetIdsFor(podcast)).toEqual(['mp3', 'm4a', 'opus', 'flac', 'aiff', 'wav'])
  })

  it('can be recompressed to its own format', () => {
    expect(canConvert(podcast, 'wav')).toBe(true)
  })
})

describe('media formats', () => {
  it('groups them for the picker by what they hold', () => {
    expect(FORMATS.mp4.media).toBe('video')
    expect(FORMATS.gif.media).toBe('video')
    expect(FORMATS.mp3.media).toBe('sound')
    expect(FORMATS.png.media).toBeUndefined()
  })

  it('writes HEVC into an .mp4', () => {
    expect(FORMATS.hevc.extensions[0]).toBe('.mp4')
  })
})
