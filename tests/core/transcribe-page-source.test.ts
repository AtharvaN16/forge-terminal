import { describe, expect, it } from 'vitest'
import { isForgeError } from '../../src/core/errors.js'
import { pageSource } from '../../src/core/transcribe/page-source.js'
import type { DocumentInfo, ImageInfo, MediaInfo } from '../../src/core/types.js'

/**
 * Which probed files transcribe reads the text of (spec
 * 2026-10-23-extract-text-design §3, §5.4): a picture or a PDF, by what
 * Forge's own probe found in its bytes.
 */
const image: ImageInfo = {
  kind: 'image',
  path: '/tmp/shot.png',
  format: 'png',
  bytes: 412_000,
  width: 1440,
  height: 900,
  hasAlpha: false,
  frames: 1,
}
const pdf = {
  kind: 'document',
  path: '/tmp/scan.pdf',
  format: 'pdf',
  bytes: 3_100_000,
  pages: 12,
  encrypted: false,
} as DocumentInfo

describe('pageSource', () => {
  it('takes a picture with its size', () => {
    expect(pageSource(image)).toEqual({
      what: 'image',
      path: '/tmp/shot.png',
      format: 'png',
      bytes: 412_000,
      width: 1440,
      height: 900,
    })
  })

  it('takes a PDF with its page count', () => {
    expect(pageSource(pdf)).toEqual({
      what: 'pdf',
      path: '/tmp/scan.pdf',
      bytes: 3_100_000,
      pages: 12,
    })
  })

  it('refuses a password-protected PDF as everything else in Forge does', () => {
    const e = (() => {
      try {
        return pageSource({ ...pdf, encrypted: true })
      } catch (x) {
        return x
      }
    })()
    expect(isForgeError(e) && e.code).toBe('encrypted-source')
  })

  it('refuses a Word document', () => {
    const e = (() => {
      try {
        return pageSource({ ...pdf, format: 'docx', path: '/tmp/a.docx' })
      } catch (x) {
        return x
      }
    })()
    expect(isForgeError(e) && e.code).toBe('unsupported-source')
  })

  it('leaves video and sound to the speech recogniser', () => {
    const media: MediaInfo = { kind: 'media', path: '/tmp/talk.mp4', format: 'mp4', bytes: 1 }
    expect(pageSource(media)).toBeUndefined()
  })
})
