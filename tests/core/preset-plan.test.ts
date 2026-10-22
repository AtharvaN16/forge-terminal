import { describe, expect, it } from 'vitest'
import { passesFor } from '../../src/core/preset.js'

describe('passesFor', () => {
  it('is one encode for a plain convert', () => {
    expect(passesFor({ to: 'webp', quality: 80 }, 'png')).toEqual([
      { kind: 'encode', target: 'webp', quality: 80 },
    ])
  })

  it('keeps the source’s format when nothing says Convert to', () => {
    expect(passesFor({ resize: { width: 1920 } }, 'png')).toEqual([
      { kind: 'encode', target: 'png', resize: { width: 1920 } },
    ])
  })

  it('folds a single cut into the encode, as the engine already can', () => {
    expect(passesFor({ to: 'webp', trim: true, resize: { width: 1920 } }, 'png')).toEqual([
      { kind: 'encode', target: 'webp', trim: true, resize: { width: 1920 } },
    ])
  })

  it('trims first and crops in the encode when both are on', () => {
    expect(passesFor({ trim: true, crop: { w: 16, h: 9 } }, 'png')).toEqual([
      { kind: 'cut', trim: true },
      { kind: 'encode', target: 'png', crop: { w: 16, h: 9 } },
    ])
  })

  it('sharpens before the encode, which resizes', () => {
    expect(passesFor({ sharpen: true, resize: { width: 1920 }, to: 'webp' }, 'png')).toEqual([
      { kind: 'boost', scale: 1 },
      { kind: 'encode', target: 'webp', resize: { width: 1920 } },
    ])
  })

  it('cuts before an enhance, so the model works on less', () => {
    expect(passesFor({ trim: true, sharpen: true }, 'png')).toEqual([
      { kind: 'cut', trim: true },
      { kind: 'boost', scale: 1 },
      { kind: 'encode', target: 'png' },
    ])
  })

  it('boosts instead of sharpening when both are on: Boost redraws detail too', () => {
    expect(passesFor({ sharpen: true, boost: 2 }, 'png')).toEqual([
      { kind: 'boost', scale: 2 },
      { kind: 'encode', target: 'png' },
    ])
  })

  it('removes the background before boosting', () => {
    expect(passesFor({ removeBackground: true, boost: 2, to: 'webp' }, 'png')).toEqual([
      { kind: 'cutout' },
      { kind: 'boost', scale: 2 },
      { kind: 'encode', target: 'webp' },
    ])
  })

  it('puts the chosen colour behind a cut-out for a format with no transparency', () => {
    expect(passesFor({ removeBackground: true, to: 'jpeg', behind: 'black' }, 'png')).toEqual([
      { kind: 'cutout' },
      { kind: 'encode', target: 'jpeg', background: '#000000' },
    ])
    expect(passesFor({ removeBackground: true, to: 'jpeg' }, 'png')[1]).toEqual({
      kind: 'encode',
      target: 'jpeg',
      background: '#ffffff',
    })
  })

  it('carries a target size to the encode, which compresses: the search picks the quality', () => {
    expect(passesFor({ to: 'webp', maxBytes: 500_000 }, 'png')).toEqual([
      { kind: 'encode', target: 'webp', maxBytes: 500_000, compress: { dither: false } },
    ])
  })

  it('keeps the quality beside a target size, as the most the search may use', () => {
    expect(passesFor({ to: 'jpeg', quality: 80, maxBytes: 500_000 }, 'png')).toEqual([
      {
        kind: 'encode',
        target: 'jpeg',
        quality: 80,
        maxBytes: 500_000,
        compress: { dither: false },
      },
    ])
  })

  it('cuts and resizes before a target size: the size search only encodes', () => {
    expect(passesFor({ to: 'webp', maxBytes: 500_000, resize: { width: 1920 } }, 'png')).toEqual([
      { kind: 'cut', resize: { width: 1920 } },
      { kind: 'encode', target: 'webp', maxBytes: 500_000, compress: { dither: false } },
    ])
    expect(
      passesFor({ to: 'webp', maxBytes: 500_000, trim: true, resize: { width: 1920 } }, 'png'),
    ).toEqual([
      { kind: 'cut', trim: true, resize: { width: 1920 } },
      { kind: 'encode', target: 'webp', maxBytes: 500_000, compress: { dither: false } },
    ])
  })

  it('is nothing at all when no row is selected', () => {
    expect(passesFor({}, 'png')).toEqual([])
  })
})
