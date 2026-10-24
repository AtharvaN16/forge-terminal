import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { planEdit, turnAction } from '../../src/core/actions/resize.js'
import { resizedSize, sizeOverLimit } from '../../src/core/resize.js'
import type { ImageInfo } from '../../src/core/types.js'

const img = (over: Partial<ImageInfo> = {}): ImageInfo => ({
  kind: 'image',
  path: '/p/photo.jpg',
  format: 'jpeg',
  bytes: 1,
  width: 4032,
  height: 3024,
  hasAlpha: false,
  frames: 1,
  ...over,
})

describe('resizedSize', () => {
  it('scales by percent, keeps the shape from either side, and never goes under 1 px', () => {
    expect(resizedSize({ width: 4032, height: 3024 }, { percent: 50 })).toEqual({
      width: 2016,
      height: 1512,
    })
    expect(resizedSize({ width: 4032, height: 3024 }, { width: 1200 })).toEqual({
      width: 1200,
      height: 900,
    })
    expect(resizedSize({ width: 4032, height: 3024 }, { height: 1080 })).toEqual({
      width: 1440,
      height: 1080,
    })
    expect(resizedSize({ width: 4000, height: 10 }, { percent: 5 })).toEqual({
      width: 200,
      height: 1,
    })
  })
})

describe('sizeOverLimit', () => {
  it('refuses past 16,384 px a side or 100 MP', () => {
    expect(sizeOverLimit({ width: 16_384, height: 6000 })).toBeUndefined()
    expect(sizeOverLimit({ width: 16_385, height: 10 })).toEqual({ side: 16_385 })
    expect(sizeOverLimit({ width: 12_000, height: 9000 })).toEqual({ megapixels: 108 })
  })
})

describe('planEdit', () => {
  it('keeps the format, names by the result size, and carries the options', () => {
    const [job] = planEdit([img()], {
      trim: false,
      resize: { percent: 50 },
      background: '#fff',
      keepMetadata: false,
    })
    expect(job).toMatchObject({
      op: 'convert',
      target: 'jpeg',
      outputs: [resolve('/p/photo-2016x1512.jpg')],
      options: { resize: { percent: 50 } },
    })
    const [trim] = planEdit([img({ format: 'heic', path: '/p/IMG.heic' })], {
      trim: true,
      background: '#fff',
      keepMetadata: false,
    })
    expect(trim).toMatchObject({
      target: 'jpeg',
      outputs: [resolve('/p/IMG-trimmed.jpg')],
      options: { trim: true },
    })
    // A camera RAW cannot be written either: its edits are JPEGs too.
    const [raw] = planEdit([img({ format: 'raw', path: '/p/DSC_0042.NEF' })], {
      trim: true,
      background: '#fff',
      keepMetadata: false,
    })
    expect(raw).toMatchObject({ target: 'jpeg', outputs: [resolve('/p/DSC_0042-trimmed.jpg')] })
    const [both] = planEdit([img()], {
      trim: true,
      resize: { width: 1200 },
      background: '#fff',
      keepMetadata: false,
    })
    expect(both?.outputs).toEqual([resolve('/p/photo-trimmed-1200w.jpg')])
  })
})

describe('rotate', () => {
  it('carries the turn, keeps the format and says which way in the name', () => {
    const [right] = turnAction.plan([img()], { turn: 90 })
    expect(right).toMatchObject({
      op: 'convert',
      target: 'jpeg',
      outputs: [resolve('/p/photo-rotated-right.jpg')],
      options: { rotate: 90 },
    })
    expect(turnAction.plan([img()], { turn: 270 })[0]?.outputs[0]).toBe(
      resolve('/p/photo-rotated-left.jpg'),
    )
    expect(turnAction.plan([img()], { turn: 180 })[0]?.outputs[0]).toBe(
      resolve('/p/photo-rotated-180.jpg'),
    )
  })

  it('plans nothing without a turn, and does not apply to an animation', () => {
    expect(turnAction.plan([img()], {})).toEqual([])
    expect(turnAction.appliesTo([img({ frames: 3, format: 'gif' })])).toBe(false)
  })
})
