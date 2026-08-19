import { describe, expect, it } from 'vitest'
import {
  canConvert,
  readableFormats,
  targetIdsFor,
  writableFormats,
} from '../../src/core/capabilities.js'
import type { SourceInfo } from '../../src/core/types.js'

function source(format: SourceInfo['format']): SourceInfo {
  return {
    path: `/tmp/x.${format}`,
    format,
    width: 8,
    height: 8,
    bytes: 10,
    hasAlpha: false,
    frames: 1,
  }
}

describe('capability graph', () => {
  it('offers every writable format for a jpeg source', () => {
    expect(targetIdsFor(source('jpeg')).sort()).toEqual([
      'avif',
      'gif',
      'jpeg',
      'png',
      'tiff',
      'webp',
    ])
  })

  it('never offers heic as a target, because sharp cannot encode it', () => {
    for (const id of ['jpeg', 'png', 'heic', 'avif'] as const) {
      expect(targetIdsFor(source(id))).not.toContain('heic')
    }
  })

  it('reads heic even though it cannot write it', () => {
    expect(readableFormats()).toContain('heic')
    expect(writableFormats()).not.toContain('heic')
    expect(targetIdsFor(source('heic'))).toContain('png')
  })

  it('allows same-format conversion, which is what recompression will use', () => {
    expect(canConvert(source('jpeg'), 'jpeg')).toBe(true)
  })

  it('rejects a target no engine can write', () => {
    expect(canConvert(source('png'), 'heic')).toBe(false)
  })
})
