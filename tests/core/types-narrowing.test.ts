import { describe, expect, it } from 'vitest'
import type { DocumentInfo, ImageInfo, SourceInfo } from '../../src/core/types.js'

describe('SourceInfo', () => {
  it('narrows to image fields on kind "image"', () => {
    const source: SourceInfo = {
      kind: 'image',
      path: '/tmp/a.jpg',
      format: 'jpeg',
      bytes: 1024,
      width: 800,
      height: 600,
      hasAlpha: false,
      frames: 1,
    }
    expect(source.kind === 'image' ? source.width : 0).toBe(800)
  })

  it('narrows to document fields on kind "document"', () => {
    const source: SourceInfo = {
      kind: 'document',
      path: '/tmp/a.pdf',
      format: 'pdf',
      bytes: 4096,
      pages: 24,
      encrypted: false,
    }
    expect(source.kind === 'document' ? source.pages : 0).toBe(24)
  })

  it('keeps the two shapes distinct', () => {
    const image: ImageInfo = {
      kind: 'image',
      path: '/tmp/a.jpg',
      format: 'jpeg',
      bytes: 1,
      width: 1,
      height: 1,
      hasAlpha: false,
      frames: 1,
    }
    const doc: DocumentInfo = {
      kind: 'document',
      path: '/tmp/a.pdf',
      format: 'pdf',
      bytes: 1,
      pages: 1,
      encrypted: false,
    }
    expect(image.kind).not.toBe(doc.kind)
  })
})
