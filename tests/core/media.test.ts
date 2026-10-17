import { describe, expect, it } from 'vitest'
import { hasPicture, hasSound, mediaFacts } from '../../src/core/media.js'
import type { MediaInfo } from '../../src/core/types.js'

const recording: MediaInfo = {
  kind: 'media',
  path: '/tmp/rec.mov',
  format: 'mov',
  bytes: 184_000_000,
  facts: {
    duration: 130,
    video: { codec: 'h264', width: 2940, height: 1912, fps: 60, rotation: 0, hdr: false },
    audio: { codec: 'aac', channels: 2, sampleRate: 48000 },
  },
}
const podcast: MediaInfo = {
  kind: 'media',
  path: '/tmp/ep.wav',
  format: 'wav',
  bytes: 671_000_000,
  facts: { duration: 3492, audio: { codec: 'pcm_s16le', channels: 2, sampleRate: 48000 } },
}

describe('mediaFacts', () => {
  it('says what matters for a video', () => {
    expect(mediaFacts(recording)).toBe('2:10 · 2940×1912 · 60 fps · 184 MB')
  })

  it('says what matters for a sound file', () => {
    expect(mediaFacts(podcast)).toBe('58:12 · stereo · 48 kHz · 671 MB')
  })

  it('says mono and odd sample rates plainly', () => {
    const memo: MediaInfo = {
      ...podcast,
      facts: { duration: 61, audio: { codec: 'aac', channels: 1, sampleRate: 44100 } },
    }
    expect(mediaFacts(memo)).toBe('1:01 · mono · 44.1 kHz · 671 MB')
  })

  it('says only the kind and the bytes before ffmpeg has read it', () => {
    expect(mediaFacts({ ...recording, facts: undefined })).toBe('video · 184 MB')
    expect(mediaFacts({ ...podcast, facts: undefined })).toBe('sound · 671 MB')
  })

  it('rounds a broadcast frame rate for reading', () => {
    const tv: MediaInfo = {
      ...recording,
      facts: {
        duration: 130,
        video: { codec: 'h264', width: 1920, height: 1080, fps: 29.97, rotation: 0, hdr: true },
      },
    }
    expect(mediaFacts(tv)).toBe('2:10 · 1920×1080 · 29.97 fps · HDR · 184 MB')
  })
})

describe('hasPicture and hasSound', () => {
  it('tell a video from a sound file', () => {
    expect(hasPicture(recording)).toBe(true)
    expect(hasPicture(podcast)).toBe(false)
    expect(hasSound(recording)).toBe(true)
  })

  it('go by the format before ffmpeg has read the file', () => {
    expect(hasPicture({ ...recording, facts: undefined })).toBe(true)
    expect(hasSound({ ...podcast, facts: undefined })).toBe(true)
  })
})
