import { describe, expect, it } from 'vitest'
import { parseArgs } from '../../src/cli/args.js'
import { isForgeError } from '../../src/core/errors.js'

const codeOf = (fn: () => unknown): string | undefined => {
  try {
    fn()
  } catch (e) {
    return isForgeError(e) ? e.code : 'unknown'
  }
  return undefined
}

describe('compress via flags', () => {
  it('--quality without --to compresses', () => {
    const intent = parseArgs(['photo.jpg', '--quality', '60'])
    expect(intent.kind).toBe('compress')
    if (intent.kind !== 'compress') throw new Error('expected compress')
    expect(intent.quality).toBe(60)
    expect(intent.inputs).toEqual(['photo.jpg'])
  })

  it('--max-size compresses to fit', () => {
    const intent = parseArgs(['photo.jpg', '--max-size', '500kb'])
    if (intent.kind !== 'compress') throw new Error('expected compress')
    expect(intent.maxBytes).toBe(512_000)
  })

  it('--quality with --to is still a conversion, not a compression', () => {
    // The reserved slot is quality *without* a target; with one it has always
    // meant "encode the conversion at this quality".
    const intent = parseArgs(['photo.jpg', '--to', 'webp', '--quality', '60'])
    expect(intent.kind).toBe('convert')
  })

  it('rejects --quality and --max-size together', () => {
    // They answer the same question two ways; accepting both would leave the
    // precedence undefined.
    expect(codeOf(() => parseArgs(['a.jpg', '--quality', '60', '--max-size', '1mb']))).toBe(
      'invalid-arguments',
    )
  })

  it('rejects a size it cannot parse', () => {
    expect(codeOf(() => parseArgs(['a.jpg', '--max-size', 'banana']))).toBe('invalid-arguments')
  })

  it('rejects compression with no files', () => {
    expect(codeOf(() => parseArgs(['--quality', '60']))).toBe('invalid-arguments')
  })

  it('carries the shared flags through', () => {
    const intent = parseArgs(['a.jpg', '--max-size', '1mb', '--force', '--recursive'])
    if (intent.kind !== 'compress') throw new Error('expected compress')
    expect(intent.force).toBe(true)
    expect(intent.recursive).toBe(true)
  })

  it('leaves a bare conversion alone', () => {
    expect(parseArgs(['a.jpg', '--to', 'png']).kind).toBe('convert')
  })
})
