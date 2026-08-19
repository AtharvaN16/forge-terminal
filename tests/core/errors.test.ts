import { describe, expect, it } from 'vitest'
import {
  conversionFailed,
  corruptSource,
  ForgeError,
  fileNotFound,
  isForgeError,
  outputExists,
  permissionDenied,
  renderError,
  unsupportedTarget,
} from '../../src/core/errors.js'
import type { SourceInfo } from '../../src/core/types.js'

const source: SourceInfo = {
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
