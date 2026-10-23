import { describe, expect, it } from 'vitest'
import {
  chainLabels,
  OPS,
  reasonsFor,
  stepLabel,
  withStep,
} from '../../src/shell/continue-editing.js'

/**
 * Continue editing, decided (mockups/presets-ux-2026-10-round10.html): Done
 * is the hub, each step is one more thing done to the file, and the chain on
 * Done's strip says every step. Pure, so each change to the steps is tested
 * without Ink.
 */
describe('the operations Continue editing lists', () => {
  it('lists every operation, in plain words, in the decided order', () => {
    expect(OPS.map((o) => o.label)).toEqual([
      'Compress',
      'Resize',
      'Crop to shape',
      'Trim edges',
      'Convert to another format',
      'Sharpen',
      'Boost resolution',
      'Remove background',
    ])
  })
})

describe('withStep: one more thing done to the steps', () => {
  const base = { to: 'jpeg' as const, quality: 80 }

  it('resizes, keeping what was there', () => {
    expect(withStep(base, { op: 'resize', spec: { width: 1920 } })).toEqual({
      to: 'jpeg',
      quality: 80,
      resize: { width: 1920 },
    })
  })

  it('compresses by quality: the quality is the new one, and it compresses as /compress does', () => {
    expect(withStep({ ...base, maxBytes: 300_000 }, { op: 'compress', quality: 60 })).toEqual({
      to: 'jpeg',
      quality: 60,
      compress: { dither: false },
    })
  })

  it('compresses to a size: the quality stays as the most the search may use', () => {
    expect(withStep(base, { op: 'compress', bytes: 300_000 })).toEqual({
      to: 'jpeg',
      quality: 80,
      maxBytes: 300_000,
    })
  })

  it('converts to another format: a lossy one with its quality, a lossless one with none', () => {
    expect(withStep(base, { op: 'format', to: 'webp', quality: 75 })).toEqual({
      to: 'webp',
      quality: 75,
    })
    expect(withStep(base, { op: 'format', to: 'png' })).toEqual({ to: 'png' })
  })

  it('crops, trims, sharpens, boosts and removes the background', () => {
    expect(withStep(base, { op: 'crop', aspect: { w: 1, h: 1 } }).crop).toEqual({ w: 1, h: 1 })
    expect(withStep(base, { op: 'trim' }).trim).toBe(true)
    expect(withStep(base, { op: 'sharpen' }).sharpen).toBe(true)
    expect(withStep(base, { op: 'boost', scale: 2 }).boost).toBe(2)
    expect(withStep(base, { op: 'cutout' }).removeBackground).toBe(true)
  })
})

describe('stepLabel: what Undo calls the step', () => {
  it('says the step the way the chain does', () => {
    expect(stepLabel({ op: 'resize', spec: { width: 1920 } })).toBe('1920 wide')
    expect(stepLabel({ op: 'resize', spec: { percent: 50 } })).toBe('50%')
    expect(stepLabel({ op: 'compress', quality: 60 })).toBe('quality 60')
    expect(stepLabel({ op: 'compress', bytes: 300_000 })).toBe('under 300 KB')
    expect(stepLabel({ op: 'crop', aspect: { w: 16, h: 9 } })).toBe('16:9')
    expect(stepLabel({ op: 'format', to: 'webp', quality: 75 })).toBe('WebP 75')
    expect(stepLabel({ op: 'trim' })).toBe('Trim')
    expect(stepLabel({ op: 'boost', scale: 3 })).toBe('Boost 3×')
    expect(stepLabel({ op: 'cutout' })).toBe('Remove background')
  })
})

describe('chainLabels: the chain on Done’s strip, after the source', () => {
  it('says a convert as its format and quality', () => {
    expect(chainLabels('png', { to: 'jpeg', quality: 80 })).toEqual(['JPEG 80'])
  })

  it('says a compress that kept the format as its quality, not the format again', () => {
    expect(chainLabels('png', { to: 'png', quality: 70, compress: { dither: false } })).toEqual([
      'quality 70',
    ])
  })

  it('says every step in Forge’s order', () => {
    expect(
      chainLabels('png', {
        to: 'jpeg',
        quality: 80,
        resize: { width: 1920 },
        maxBytes: 300_000,
        crop: { w: 1, h: 1 },
      }),
    ).toEqual(['JPEG 80', '1920 wide', '1:1', 'under 300 KB'])
  })
})

describe('reasonsFor: why an operation cannot apply', () => {
  it('knows an animation, a photo with no empty edges, a shape it already is', () => {
    const still = { width: 3024, height: 2016, frames: 1 }
    expect(reasonsFor({ ...still, frames: 12 }, undefined)).toEqual({
      trim: 'animated',
      crop: 'animated',
    })
    expect(reasonsFor(still, { trimmed: 'nothing' })).toEqual({ trim: 'no empty edges' })
    expect(reasonsFor(still, { trimmed: { width: 2980, height: 1990 } })).toEqual({})
    expect(reasonsFor({ width: 1, height: 1, frames: 1 }, undefined)).toMatchObject({
      crop: 'no shape to cut',
    })
  })
})
