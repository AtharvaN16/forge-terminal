import { describe, expect, it } from 'vitest'
import {
  conversionFailed,
  corruptSource,
  ForgeError,
  fileNotFound,
  isForgeError,
  outputCollision,
  outputExists,
  permissionDenied,
  renderError,
  selfCollision,
  unsupportedCompress,
  unsupportedTarget,
} from '../../src/core/errors.js'
import type { SourceInfo } from '../../src/core/types.js'

const source: SourceInfo = {
  kind: 'image',
  path: '/tmp/photo.jpg',
  format: 'jpeg',
  width: 10,
  height: 10,
  bytes: 100,
  hasAlpha: false,
  frames: 1,
}

describe('ForgeError', () => {
  it('carries a code, a title, a detail and a hint', () => {
    const e = fileNotFound('photo.jpg')
    expect(e).toBeInstanceOf(ForgeError)
    expect(e.code).toBe('file-not-found')
    expect(e.title).toBe('File not found')
    expect(e.detail).toContain('photo.jpg')
    expect(e.hint).toBeTruthy()
  })

  it('is recognisable by a type guard', () => {
    expect(isForgeError(fileNotFound('a.jpg'))).toBe(true)
    expect(isForgeError(new Error('plain'))).toBe(false)
  })

  it('lists the available targets when the requested one is impossible', () => {
    const e = unsupportedTarget(source, 'mp4', ['webp', 'png', 'avif'])
    expect(e.code).toBe('unsupported-target')
    expect(e.detail).toContain('JPEG')
    expect(e.hint).toContain('webp, png, avif')
  })

  it('names the offending file for every file-scoped error', () => {
    expect(permissionDenied('/tmp/x.png').detail).toContain('x.png')
    expect(corruptSource('/tmp/x.png', new Error('boom')).detail).toContain('x.png')
    expect(outputExists('/tmp/out.webp').detail).toContain('out.webp')
  })

  it('suggests --force when the output already exists', () => {
    expect(outputExists('/tmp/out.webp').hint).toContain('--force')
  })

  it('distinguishes one job writing a path twice from two sources colliding', () => {
    const self = selfCollision('/tmp/source.pdf', '/tmp/out.pdf')
    const between = outputCollision(['/tmp/a.jpg', '/tmp/b.png'], '/tmp/out.webp')
    expect(self.code).toBe(between.code)
    expect(self.title).not.toBe(between.title)
    expect(self.detail).toContain('twice')
    expect(self.hint).not.toContain('--force')
  })
})

describe('renderError', () => {
  it('renders a symbol, a title, the detail and the hint', () => {
    const lines = renderError(fileNotFound('photo.jpg')).join('\n')
    expect(lines).toContain('✕ File not found')
    expect(lines).toContain('photo.jpg')
    expect(lines).toContain('Check the filename')
  })

  it('hides the underlying cause by default', () => {
    const e = conversionFailed('/tmp/x.png', new Error('vips exploded'))
    expect(renderError(e).join('\n')).not.toContain('vips exploded')
  })

  it('reveals the underlying cause under debug', () => {
    const e = conversionFailed('/tmp/x.png', new Error('vips exploded'))
    expect(renderError(e, { debug: true }).join('\n')).toContain('vips exploded')
  })
})

describe('refusing to compress', () => {
  const png = {
    kind: 'image' as const,
    path: '/tmp/logo.png',
    format: 'png' as const,
    width: 10,
    height: 10,
    bytes: 100,
    hasAlpha: false,
    frames: 1,
  }
  const pdf = {
    kind: 'document' as const,
    path: '/tmp/brochure.pdf',
    format: 'pdf' as const,
    bytes: 1_400_000,
    pages: 7,
    encrypted: false,
  }

  it('tells a lossless image the truth: there is no quality to trade', () => {
    const e = unsupportedCompress(png)
    expect(e.detail).toContain('lossless')
    expect(e.detail).toContain('logo.png')
  })

  it('does NOT claim a PDF is lossless', () => {
    // A PDF is a container. Its pages are usually JPEGs, which compress
    // fine — measured at 79% smaller. Saying "lossless, no quality to
    // trade away" is true of PNG and false of PDF, and it sent a user
    // looking for a workaround that does not exist.
    const e = unsupportedCompress(pdf)
    expect(e.detail).not.toContain('lossless')
    expect(e.detail).toContain('brochure.pdf')
  })

  it('points a PDF at what does work, not at a smaller format', () => {
    const e = unsupportedCompress(pdf)
    expect(`${e.title} ${e.detail} ${e.hint ?? ''}`).toContain('/pdf')
  })
})
