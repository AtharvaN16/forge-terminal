import { describe, expect, it } from 'vitest'
import { parseArgs } from '../../src/cli/args.js'
import { isForgeError } from '../../src/core/errors.js'

function codeOf(argv: string[]): string {
  try {
    parseArgs(argv)
  } catch (e) {
    return isForgeError(e) ? e.code : `unexpected:${String(e)}`
  }
  return 'no-error'
}

describe('parseArgs', () => {
  it('parses a single file conversion', () => {
    const intent = parseArgs(['photo.jpg', '--to', 'webp'])
    expect(intent).toMatchObject({ kind: 'convert', inputs: ['photo.jpg'], target: 'webp' })
  })

  it('accepts the short flag', () => {
    expect(parseArgs(['a.jpg', '-t', 'png'])).toMatchObject({ target: 'png' })
  })

  it('accepts several inputs', () => {
    expect(parseArgs(['a.jpg', 'b.jpg', '--to', 'webp'])).toMatchObject({
      inputs: ['a.jpg', 'b.jpg'],
    })
  })

  it('normalises jpg to jpeg', () => {
    expect(parseArgs(['a.png', '--to', 'jpg'])).toMatchObject({ target: 'jpeg' })
  })

  it('is case-insensitive about the target', () => {
    expect(parseArgs(['a.png', '--to', 'WebP'])).toMatchObject({ target: 'webp' })
  })

  it('reads the output, quality, background and boolean flags', () => {
    const intent = parseArgs([
      'a.jpg',
      '--to',
      'webp',
      '--output',
      './dist/',
      '--quality',
      '70',
      '--background',
      '#000000',
      '--force',
      '--recursive',
      '--keep-metadata',
      '--debug',
    ])
    expect(intent).toMatchObject({
      output: './dist/',
      force: true,
      recursive: true,
      debug: true,
      options: { quality: 70, background: '#000000', keepMetadata: true },
    })
  })

  it('defaults background to white and keepMetadata to false', () => {
    expect(parseArgs(['a.jpg', '--to', 'webp'])).toMatchObject({
      options: { background: '#ffffff', keepMetadata: false },
    })
  })

  it('returns the formats intent', () => {
    expect(parseArgs(['--formats'])).toEqual({ kind: 'formats' })
  })

  it('returns the shell intent for no arguments', () => {
    expect(parseArgs([])).toEqual({ kind: 'shell' })
  })

  it('rejects inputs with no --to', () => {
    expect(codeOf(['a.jpg'])).toBe('invalid-arguments')
  })

  it('--quality without --to now means compress', () => {
    // 0.1 rejected this to keep the slot free (spec §315). Phase 2 fills it:
    // quality with no target is a request to keep the format and shrink.
    expect(parseArgs(['a.jpg', '--quality', '70']).kind).toBe('compress')
  })

  it('rejects an unknown target format', () => {
    expect(codeOf(['a.jpg', '--to', 'mp4'])).toBe('invalid-arguments')
  })

  it('rejects a quality outside 1-100', () => {
    expect(codeOf(['a.jpg', '--to', 'webp', '--quality', '0'])).toBe('invalid-arguments')
    expect(codeOf(['a.jpg', '--to', 'webp', '--quality', '101'])).toBe('invalid-arguments')
    expect(codeOf(['a.jpg', '--to', 'webp', '--quality', 'high'])).toBe('invalid-arguments')
  })

  it('rejects --to with no inputs', () => {
    expect(codeOf(['--to', 'webp'])).toBe('invalid-arguments')
  })

  it('rejects a non-numeric, zero or negative --concurrency', () => {
    expect(codeOf(['a.jpg', '--to', 'webp', '--concurrency', 'abc'])).toBe('invalid-arguments')
    expect(codeOf(['a.jpg', '--to', 'webp', '--concurrency', '0'])).toBe('invalid-arguments')
    expect(codeOf(['a.jpg', '--to', 'webp', '--concurrency', '-1'])).toBe('invalid-arguments')
  })

  it('accepts a valid --concurrency', () => {
    expect(parseArgs(['a.jpg', '--to', 'webp', '--concurrency', '3'])).toMatchObject({
      concurrency: 3,
    })
  })
})
