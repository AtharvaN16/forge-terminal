import { describe, expect, it } from 'vitest'
import { mediaEditAction } from '../../src/core/actions/media.js'
import type { MediaInfo } from '../../src/core/types.js'
import { actionForRow, mediaEditRows, pillOf, rowValues } from '../../src/shell/edit.js'

const recording: MediaInfo = {
  kind: 'media',
  path: '/rec/rec.mov',
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
  path: '/pod/ep.wav',
  format: 'wav',
  bytes: 671_000_000,
  facts: { duration: 3492, audio: { codec: 'pcm_s16le', channels: 2, sampleRate: 48000 } },
}

describe('edit rows for a video', () => {
  it('offers Trim, Mute and Speed, then Resize, Rotate and Crop to shape', () => {
    const rows = mediaEditRows(recording)
    expect(rows.map((r) => r.label)).toEqual([
      'Trim',
      'Mute',
      'Speed',
      'Resize',
      'Rotate',
      'Crop to shape',
    ])
    expect(rows.find((r) => r.gapAfter)?.id).toBe('speed')
  })

  it('leaves out Mute for a video with no sound', () => {
    const silent: MediaInfo = {
      ...recording,
      facts: { ...recording.facts, audio: undefined } as never,
    }
    expect(mediaEditRows(silent).map((r) => r.id)).not.toContain('mute')
  })

  it('gives Crop its shapes with the size each cuts', () => {
    const crop = mediaEditRows(recording).find((r) => r.id === 'crop')
    expect(crop && pillOf(crop)?.steps.map((s) => s.label)).toContain('1:1')
  })

  it('gives Speed its steps with the length each leaves', () => {
    const speed = mediaEditRows(recording).find((r) => r.id === 'speed')
    expect(speed && pillOf(speed)?.noun).toBe('speed')
    expect(speed && pillOf(speed)?.steps.map((s) => [s.label, s.detail.bold])).toEqual([
      ['2×', '1:05'],
      ['1.5×', '1:27'],
      ['1.25×', '1:44'],
      ['0.75×', '2:53'],
      ['0.5×', '4:20'],
    ])
    expect(speed && rowValues(speed, 0.5)).toMatchObject({ tool: 'speed', speed: 0.5 })
    expect(speed && rowValues(speed)).toMatchObject({ speed: 2 })
    expect(speed && actionForRow(speed)).toBe(mediaEditAction)
  })

  it('gives Rotate its turns with the size each leaves', () => {
    const rotate = mediaEditRows(recording).find((r) => r.id === 'rotate')
    expect(rotate && pillOf(rotate)?.steps.map((s) => [s.label, s.detail.bold])).toEqual([
      ['90° right', '1912 × 2940'],
      ['180°', '2940 × 1912'],
      ['90° left', '1912 × 2940'],
    ])
    expect(rotate && rowValues(rotate, 270)).toMatchObject({ tool: 'rotate', turn: 270 })
  })

  it('keeps the format and runs through the media edit action', () => {
    for (const row of mediaEditRows(recording)) {
      expect(row.target).toBe('mov')
      expect(actionForRow(row)).toBe(mediaEditAction)
    }
    expect(rowValues(mediaEditRows(recording)[1] as never)).toMatchObject({ tool: 'mute' })
  })
})

describe('edit rows for sound', () => {
  it('offers Trim, Speed and Even out loudness', () => {
    expect(mediaEditRows(podcast).map((r) => r.label)).toEqual([
      'Trim',
      'Speed',
      'Even out loudness',
    ])
  })
})
