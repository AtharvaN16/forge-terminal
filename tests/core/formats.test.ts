import { describe, expect, it } from 'vitest'
import { ALL_FORMAT_IDS, FORMATS, formatById, primaryExtension } from '../../src/core/formats.js'

describe('format registry', () => {
  it('knows all eight formats', () => {
    expect(ALL_FORMAT_IDS.sort()).toEqual([
      'avif',
      'gif',
      'heic',
      'jpeg',
      'pdf',
      'png',
      'tiff',
      'webp',
    ])
  })

  it('records that jpeg cannot carry alpha and png can', () => {
    expect(FORMATS.jpeg.hasAlpha).toBe(false)
    expect(FORMATS.png.hasAlpha).toBe(true)
  })

  it('records which formats can animate', () => {
    expect(FORMATS.gif.animatable).toBe(true)
    expect(FORMATS.webp.animatable).toBe(true)
    expect(FORMATS.png.animatable).toBe(false)
  })

  it('records which formats are lossy, which drives the quality option', () => {
    expect(FORMATS.jpeg.lossy).toBe(true)
    expect(FORMATS.webp.lossy).toBe(true)
    expect(FORMATS.avif.lossy).toBe(true)
    expect(FORMATS.png.lossy).toBe(false)
    expect(FORMATS.tiff.lossy).toBe(false)
  })

  it('resolves a format by id and returns undefined for nonsense', () => {
    expect(formatById('webp')?.label).toBe('WebP')
    expect(formatById('mp4')).toBeUndefined()
  })

  it('gives a primary extension for output filenames', () => {
    expect(primaryExtension('jpeg')).toBe('.jpg')
    expect(primaryExtension('webp')).toBe('.webp')
  })
})
