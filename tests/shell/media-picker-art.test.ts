import { describe, expect, it } from 'vitest'
import { width } from '../../src/shell/home-art.js'
import {
  mediaBoxes,
  mediaHint,
  mediaPickerRows,
  placeOf,
} from '../../src/shell/media-picker-art.js'
import { DARK, modePalette } from '../../src/shell/theme.js'

const p = modePalette(DARK, 'convert')
const targets = ['mp4', 'hevc', 'webm', 'gif', 'mp3', 'm4a', 'wav'] as const
const text = (row: { text: string }[]) => row.map((r) => r.text).join('')

describe('the video picker', () => {
  it('groups the targets into video and sound only, by what each holds', () => {
    expect(mediaBoxes([...targets])).toEqual([
      { name: 'video', ids: ['mp4', 'hevc', 'webm', 'gif'] },
      { name: 'sound only', ids: ['mp3', 'm4a', 'wav'] },
    ])
  })

  it('leaves out an empty box (a silent video has no sound formats)', () => {
    expect(mediaBoxes(['mp4', 'gif']).map((b) => b.name)).toEqual(['video'])
  })

  it('draws the boxes side by side, the chosen one’s box in the mode’s colour', () => {
    const rows = mediaPickerRows({
      palette: p,
      boxes: mediaBoxes([...targets]),
      chosen: 'mp3',
      width: 76,
    })
    expect(rows).toHaveLength(6)
    expect(rows.every((r) => width(r) === 76)).toBe(true)
    expect(text(rows[0] ?? [])).toContain('video')
    expect(text(rows[0] ?? [])).toContain('sound only')
    const edge = rows[0]?.find((r) => r.text.includes('sound only'))
    expect(edge?.fg).toBe(p.accent)
    expect(text(rows[1] ?? [])).toContain('▌ MP3')
  })

  it('knows where a format sits', () => {
    expect(placeOf(mediaBoxes([...targets]), 'm4a')).toEqual({ box: 1, row: 1 })
  })

  it('says GIF has no sound', () => {
    expect(mediaHint('gif')).toBe('256 colours · no sound')
    expect(mediaHint('mp4')).toBe('H.264 · AAC')
  })
})
