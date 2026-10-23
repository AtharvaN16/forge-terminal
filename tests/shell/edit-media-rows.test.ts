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
  it('offers the sound tools, then Resize and Crop to shape', () => {
    const rows = mediaEditRows(recording)
    expect(rows.map((r) => r.label)).toEqual([
      'Trim',
      'Mute',
      'Extract audio',
      'Clean up audio',
      'Resize',
      'Crop to shape',
    ])
    expect(rows.find((r) => r.gapAfter)?.id).toBe('cleanup')
  })

  it('leaves out every sound tool for a video with no sound', () => {
    const silent: MediaInfo = {
      ...recording,
      facts: { ...recording.facts, audio: undefined } as never,
    }
    const ids = mediaEditRows(silent).map((r) => r.id)
    expect(ids).toEqual(['cut', 'resize', 'crop'])
  })

  it('makes Extract audio a sound file in the codec’s own container', () => {
    const extract = mediaEditRows(recording).find((r) => r.id === 'extract')
    expect(extract?.target).toBe('m4a')
    expect(extract?.detail).toEqual({ dim: 'becomes ', bold: 'M4A' })
    expect(extract && actionForRow(extract)).toBe(mediaEditAction)
    expect(extract && rowValues(extract)).toMatchObject({ tool: 'extract' })
  })

  it('gives Crop its shapes with the size each cuts', () => {
    const crop = mediaEditRows(recording).find((r) => r.id === 'crop')
    expect(crop && pillOf(crop)?.steps.map((s) => s.label)).toContain('1:1')
  })

  it('keeps the format and runs through the media edit action', () => {
    for (const row of mediaEditRows(recording).filter((r) => r.id !== 'extract')) {
      expect(row.target).toBe('mov')
      expect(actionForRow(row)).toBe(mediaEditAction)
    }
    expect(rowValues(mediaEditRows(recording)[1] as never)).toMatchObject({ tool: 'mute' })
  })
})

describe('edit rows for sound', () => {
  it('offers Trim, Clean up audio and Even out loudness', () => {
    expect(mediaEditRows(podcast).map((r) => r.label)).toEqual([
      'Trim',
      'Clean up audio',
      'Even out loudness',
    ])
  })
})
