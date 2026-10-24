import { describe, expect, it } from 'vitest'
import { DEFAULT_PREFERENCES } from '../../src/config/preferences.js'
import { compressAction, convertAction } from '../../src/core/actions/index.js'
import { mediaEditAction, planMediaEdit } from '../../src/core/actions/media.js'
import type { Job, MediaInfo } from '../../src/core/types.js'

const recording: MediaInfo = {
  kind: 'media',
  path: '/rec/Screen Recording.mov',
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
  path: '/pod/episode.wav',
  format: 'wav',
  bytes: 671_000_000,
  facts: { duration: 3492, audio: { codec: 'pcm_s16le', channels: 2, sampleRate: 48000 } },
}
const convert = (j: Job[]) => {
  const [job] = j
  if (job?.op !== 'convert') throw new Error('not a convert job')
  return job
}

describe('convert, for video and sound', () => {
  it('asks no quality for a video target: Forge picks', () => {
    const ids = convertAction
      .options([recording], { target: 'mp4' }, DEFAULT_PREFERENCES)
      .map((o) => o.id)
    expect(ids).not.toContain('quality')
    expect(ids).not.toContain('bitrate')
  })

  it('asks the bitrate, in kbps, for a lossy sound target', () => {
    const bitrate = convertAction
      .options([podcast], { target: 'mp3' }, DEFAULT_PREFERENCES)
      .find((o) => o.id === 'bitrate')
    expect(bitrate).toMatchObject({ kind: 'slider', min: 64, max: 320, default: 128 })
  })

  it('carries the bitrate to the job', () => {
    const job = convert(convertAction.plan([podcast], { target: 'mp3', bitrate: 96 }))
    expect(job.options.media).toEqual({ bitrate: 96 })
    expect(job.outputs[0]).toBe('/pod/episode.mp3')
  })

  it('writes HEVC beside an MP4 without landing on it', () => {
    const mp4: MediaInfo = { ...recording, path: '/rec/clip.mp4', format: 'mp4' }
    const job = convert(convertAction.plan([mp4], { target: 'hevc' }))
    expect(job.outputs[0]).not.toBe('/rec/clip.mp4')
    expect(job.outputs[0]?.endsWith('.mp4')).toBe(true)
  })

  it('carries the CLI-only settings', () => {
    const job = convert(
      convertAction.plan([recording], {
        target: 'mp4',
        cut: { start: 3, end: 41 },
        mute: true,
        speed: 2,
        fps: 30,
      }),
    )
    expect(job.options.media).toEqual({ cut: { start: 3, end: 41 }, mute: true, speed: 2, fps: 30 })
  })
})

describe('compress, for video and sound', () => {
  it('applies to a video and to a sound file', () => {
    expect(compressAction.appliesTo([recording])).toBe(true)
    expect(compressAction.appliesTo([podcast])).toBe(true)
  })

  it('keeps a video’s format, with -small', () => {
    const job = convert(compressAction.plan([recording], { mode: 'size' }))
    expect(job.target).toBe('mov')
    expect(job.outputs[0]).toBe('/rec/Screen Recording-small.mov')
    expect(job.options.compress).toBeDefined()
  })

  it('makes a WAV an M4A: WAV has no smaller setting', () => {
    const job = convert(compressAction.plan([podcast], { mode: 'size' }))
    expect(job.target).toBe('m4a')
    expect(job.outputs[0]).toBe('/pod/episode-small.m4a')
  })

  it('compresses sound by bitrate', () => {
    const slider = compressAction
      .options([podcast], { mode: 'quality' }, DEFAULT_PREFERENCES)
      .find((o) => o.kind === 'slider')
    expect(slider).toMatchObject({ id: 'bitrate', min: 32, max: 320 })
    const job = convert(compressAction.plan([podcast], { mode: 'quality', bitrate: 96 }))
    expect(job.options.media).toEqual({ bitrate: 96 })
  })
})

describe('edit, for video and sound', () => {
  it('cuts, keeping the format, named -trimmed', () => {
    const job = convert(
      mediaEditAction.plan([recording], { tool: 'cut', cut: { start: 3.2, end: 41 } }),
    )
    expect(job.target).toBe('mov')
    expect(job.options.media).toEqual({ cut: { start: 3.2, end: 41 } })
    expect(job.outputs[0]).toBe('/rec/Screen Recording-trimmed.mov')
  })

  it('mutes, named -muted', () => {
    const job = convert(mediaEditAction.plan([recording], { tool: 'mute' }))
    expect(job.options.media).toEqual({ mute: true })
    expect(job.outputs[0]).toBe('/rec/Screen Recording-muted.mov')
  })

  it('resizes, named by the new size', () => {
    const job = convert(
      mediaEditAction.plan([recording], { tool: 'resize', resize: { width: 1280 } }),
    )
    expect(job.options.resize).toEqual({ width: 1280 })
    expect(job.outputs[0]).toBe('/rec/Screen Recording-1280x832.mov')
  })

  it('crops to a shape, named by it', () => {
    const job = convert(
      mediaEditAction.plan([recording], { tool: 'crop', crop: { aspect: { w: 1, h: 1 } } }),
    )
    expect(job.options.crop?.box).toEqual({ left: 514, top: 0, width: 1912, height: 1912 })
    expect(job.outputs[0]).toBe('/rec/Screen Recording-cropped-1x1.mov')
  })

  it('extracts the sound, in the container that holds it, named -audio', () => {
    const job = convert(mediaEditAction.plan([recording], { tool: 'extract' }))
    expect(job.target).toBe('m4a')
    expect(job.options.media).toBeUndefined()
    expect(job.outputs[0]).toBe('/rec/Screen Recording-audio.m4a')
  })

  it('refuses to extract from a sound file', () => {
    expect(mediaEditAction.plan([podcast], { tool: 'extract' })).toEqual([])
  })

  it('cleans up a video, keeping its format, named -cleaned', () => {
    const job = convert(mediaEditAction.plan([recording], { tool: 'cleanup' }))
    expect(job.target).toBe('mov')
    expect(job.options.media).toEqual({ cleanup: true, loudness: -16 })
    expect(job.outputs[0]).toBe('/rec/Screen Recording-cleaned.mov')
  })

  it('cleans up a sound file, keeping its format', () => {
    const job = convert(mediaEditAction.plan([podcast], { tool: 'cleanup' }))
    expect(job.target).toBe('wav')
    expect(job.outputs[0]).toBe('/pod/episode-cleaned.wav')
  })

  it('changes speed, named by it, for a video and for sound', () => {
    const fast = convert(mediaEditAction.plan([recording], { tool: 'speed', speed: 2 }))
    expect(fast.options.media).toEqual({ speed: 2 })
    expect(fast.outputs[0]).toBe('/rec/Screen Recording-2x.mov')
    const slow = convert(mediaEditAction.plan([podcast], { tool: 'speed', speed: 0.5 }))
    expect(slow.outputs[0]).toBe('/pod/episode-0.5x.wav')
    // Nothing without a speed, at 1×, or outside what the engine takes.
    for (const speed of [undefined, 1, 5, 0.1]) {
      expect(mediaEditAction.plan([recording], { tool: 'speed', speed })).toEqual([])
    }
  })

  it('rotates, named by the turn', () => {
    const job = convert(mediaEditAction.plan([recording], { tool: 'rotate', turn: 90 }))
    expect(job.options.rotate).toBe(90)
    expect(job.outputs[0]).toBe('/rec/Screen Recording-rotated-right.mov')
    expect(mediaEditAction.plan([recording], { tool: 'rotate' })).toEqual([])
    expect(mediaEditAction.plan([podcast], { tool: 'rotate', turn: 90 })).toEqual([])
  })

  it('evens out loudness to −16', () => {
    const job = convert(mediaEditAction.plan([podcast], { tool: 'loudness' }))
    expect(job.options.media).toEqual({ loudness: -16 })
    expect(job.outputs[0]).toBe('/pod/episode-levelled.wav')
  })

  it('applies to one video or audio file only', () => {
    expect(mediaEditAction.appliesTo([recording])).toBe(true)
    expect(mediaEditAction.appliesTo([recording, podcast])).toBe(false)
  })
})

describe('planMediaEdit, for the CLI', () => {
  it('names a single change by what it did', () => {
    const [job] = planMediaEdit([recording], { media: { speed: 2 } })
    expect(job?.outputs[0]).toBe('/rec/Screen Recording-2x.mov')
  })

  it('names several changes plainly', () => {
    const [job] = planMediaEdit([recording], {
      media: { cut: { start: 1, end: 2 }, mute: true },
    })
    expect(job?.outputs[0]).toBe('/rec/Screen Recording-edited.mov')
  })

  it('writes another format when asked', () => {
    const [job] = planMediaEdit([recording], { media: { mute: true }, target: 'mp4' })
    expect(job?.outputs[0]).toBe('/rec/Screen Recording-muted.mp4')
    expect(job?.target).toBe('mp4')
  })
})

describe('an animated GIF becoming a video', () => {
  it('asks no quality: Forge picks, as for any video', () => {
    const gif = {
      kind: 'image' as const,
      path: '/a/loop.gif',
      format: 'gif' as const,
      bytes: 9_000_000,
      width: 400,
      height: 300,
      hasAlpha: false,
      frames: 40,
    }
    const ids = convertAction
      .options([gif], { target: 'mp4' }, DEFAULT_PREFERENCES)
      .map((o) => o.id)
    expect(ids).not.toContain('quality')
    // A picture target still asks.
    expect(
      convertAction.options([gif], { target: 'webp' }, DEFAULT_PREFERENCES).map((o) => o.id),
    ).toContain('quality')
  })
})
