import { describe, expect, it } from 'vitest'
import { isPresetName, parsePreset } from '../../src/core/preset.js'

describe('isPresetName', () => {
  it('takes letters, digits and dashes, so /blog and --preset blog work', () => {
    expect(isPresetName('blog')).toBe(true)
    expect(isPresetName('Blog-2')).toBe(true)
  })

  it('refuses a space, a slash, or nothing', () => {
    expect(isPresetName('my blog')).toBe(false)
    expect(isPresetName('a/b')).toBe(false)
    expect(isPresetName('')).toBe(false)
  })

  it('refuses a leading dash, which would read as a flag', () => {
    expect(isPresetName('-blog')).toBe(false)
  })
})

describe('parsePreset', () => {
  const blog = {
    name: 'blog',
    steps: { to: 'webp', quality: 80, resize: { width: 1920 }, sharpen: true },
    saveTo: '~/Desktop',
  }

  it('keeps a well-formed preset as it is', () => {
    expect(parsePreset(blog)).toEqual(blog)
  })

  it('keeps every kind of step', () => {
    const all = {
      name: 'all',
      steps: {
        to: 'jpeg',
        quality: 70,
        maxBytes: 500_000,
        resize: { percent: 50 },
        trim: true,
        crop: { w: 16, h: 9 },
        boost: 2,
        removeBackground: true,
        behind: 'white',
        compress: { dither: true },
      },
      saveTo: 'same',
    }
    expect(parsePreset(all)).toEqual(all)
  })

  it('refuses a bad name', () => {
    expect(parsePreset({ ...blog, name: 'my blog' })).toBeUndefined()
  })

  it('refuses a format Forge does not know', () => {
    expect(parsePreset({ ...blog, steps: { to: 'bmpx' } })).toBeUndefined()
  })

  it('refuses a quality outside 1–100 and a boost other than 2, 3 or 4', () => {
    expect(parsePreset({ ...blog, steps: { quality: 0 } })).toBeUndefined()
    expect(parsePreset({ ...blog, steps: { boost: 5 } })).toBeUndefined()
  })

  it('refuses a resize that is not one positive side or a percentage', () => {
    expect(parsePreset({ ...blog, steps: { resize: { width: -1 } } })).toBeUndefined()
    expect(parsePreset({ ...blog, steps: { resize: { width: 10, height: 10 } } })).toBeUndefined()
  })

  it('refuses a crop shape that is not two whole numbers', () => {
    expect(parsePreset({ ...blog, steps: { crop: { w: 1.5, h: 1 } } })).toBeUndefined()
  })

  it('takes a folder, the source’s own folder, or asking each time as where it saves', () => {
    expect(parsePreset({ ...blog, saveTo: 'ask' })?.saveTo).toBe('ask')
    expect(parsePreset({ ...blog, saveTo: '' })).toBeUndefined()
  })
})
