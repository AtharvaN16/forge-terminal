import { describe, expect, it } from 'vitest'
import { readProbe } from '../../src/engines/media-probe.js'

const video = (over: Record<string, unknown> = {}) => ({
  codec_type: 'video',
  codec_name: 'h264',
  width: 2940,
  height: 1912,
  avg_frame_rate: '60/1',
  r_frame_rate: '60/1',
  pix_fmt: 'yuv420p',
  disposition: { attached_pic: 0 },
  ...over,
})
const audio = (over: Record<string, unknown> = {}) => ({
  codec_type: 'audio',
  codec_name: 'aac',
  channels: 2,
  sample_rate: '48000',
  ...over,
})
const probe = (streams: unknown[], duration = '130.000') => ({
  streams,
  format: { duration, format_name: 'mov,mp4,m4a,3gp,3g2,mj2' },
})

describe('readProbe', () => {
  it('reads a screen recording', () => {
    expect(readProbe(probe([video(), audio()]))).toEqual({
      duration: 130,
      video: { codec: 'h264', width: 2940, height: 1912, fps: 60, rotation: 0, hdr: false },
      audio: { codec: 'aac', channels: 2, sampleRate: 48000 },
    })
  })

  it('reports a portrait phone video upright, from its rotation', () => {
    const facts = readProbe(
      probe([
        video({
          width: 1920,
          height: 1080,
          side_data_list: [{ side_data_type: 'Display Matrix', rotation: -90 }],
        }),
      ]),
    )
    expect(facts.video).toMatchObject({ width: 1080, height: 1920, rotation: 90 })
  })

  it('rounds a broadcast frame rate', () => {
    expect(readProbe(probe([video({ avg_frame_rate: '30000/1001' })])).video?.fps).toBeCloseTo(
      29.97,
    )
  })

  it('knows HDR by its transfer', () => {
    expect(readProbe(probe([video({ color_transfer: 'arib-std-b67' })])).video?.hdr).toBe(true)
    expect(readProbe(probe([video({ color_transfer: 'smpte2084' })])).video?.hdr).toBe(true)
  })

  it('takes cover art for what it is: a sound file', () => {
    const facts = readProbe(
      probe([
        audio({ codec_name: 'mp3' }),
        video({ codec_name: 'mjpeg', disposition: { attached_pic: 1 } }),
      ]),
    )
    expect(facts.video).toBeUndefined()
    expect(facts.audio?.codec).toBe('mp3')
  })

  it('reads a silent video', () => {
    expect(readProbe(probe([video()])).audio).toBeUndefined()
  })

  it('falls back to the stream duration when the container has none', () => {
    const facts = readProbe({ streams: [audio({ duration: '12.5' })], format: {} })
    expect(facts.duration).toBe(12.5)
  })
})
