import { describe, expect, it } from 'vitest'
import {
  canConvert,
  formatMatrix,
  readableFormats,
  targetIdsFor,
  writableFormats,
} from '../../src/core/capabilities.js'
import type { SourceInfo } from '../../src/core/types.js'

function source(format: SourceInfo['format']): SourceInfo {
  return {
    kind: 'image',
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
    // Includes 'pdf': the pdf engine reads jpeg (among other image formats)
    // and writes pdf, so invariant 2's engine-driven graph offers it here
    // with no format list edited by hand.
    expect(targetIdsFor(source('jpeg')).sort()).toEqual([
      'avif',
      'gif',
      'jpeg',
      'pdf',
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

  it('reads camera RAW on a Mac only, and never writes it', () => {
    expect(readableFormats().includes('raw')).toBe(process.platform === 'darwin')
    expect(writableFormats()).not.toContain('raw')
    expect(canConvert(source('jpeg'), 'raw')).toBe(false)
  })

  it('allows same-format conversion, which is what recompression will use', () => {
    expect(canConvert(source('jpeg'), 'jpeg')).toBe(true)
  })

  it('rejects a target no engine can write', () => {
    expect(canConvert(source('png'), 'heic')).toBe(false)
  })
})

describe('formatMatrix', () => {
  it('lists every format any engine reads or writes, flagged from the engines themselves', () => {
    const readable = readableFormats()
    const writable = writableFormats()
    const matrix = formatMatrix()
    expect(new Set(matrix.map((f) => f.id))).toEqual(new Set([...readable, ...writable]))
    for (const f of matrix) {
      expect(f.read).toBe(readable.includes(f.id))
      expect(f.write).toBe(writable.includes(f.id))
    }
    expect(matrix.find((f) => f.id === 'heic')).toMatchObject({ read: true, write: false })
  })
})
