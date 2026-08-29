import { describe, expect, it } from 'vitest'
import { parseArgs } from '../../src/cli/args.js'
import { isForgeError } from '../../src/core/errors.js'

function detailOf(argv: string[]): string {
  try {
    parseArgs(argv)
  } catch (error) {
    return isForgeError(error) ? error.detail : String(error)
  }
  return 'no error'
}

describe('--remove-background arguments', () => {
  it('creates a background-removal intent with a capability-derived default target later', () => {
    expect(parseArgs(['photo.jpg', '--remove-background'])).toMatchObject({
      kind: 'remove-background',
      inputs: ['photo.jpg'],
      force: false,
      recursive: false,
    })
  })

  it('accepts an alpha-capable output format and ordinary write controls', () => {
    expect(
      parseArgs([
        'photo.jpg',
        '--remove-background',
        '--to',
        'webp',
        '--quality',
        '75',
        '--output',
        './out/',
        '--force',
        '--recursive',
        '--concurrency',
        '2',
      ]),
    ).toMatchObject({
      kind: 'remove-background',
      target: 'webp',
      quality: 75,
      output: './out/',
      force: true,
      recursive: true,
      concurrency: 2,
    })
  })

  it('requires an input', () => {
    expect(detailOf(['--remove-background'])).toContain('No files given')
  })

  it('rejects options that have no background-removal meaning', () => {
    expect(detailOf(['photo.jpg', '--remove-background', '--max-size', '20kb'])).toContain(
      '--max-size',
    )
    expect(detailOf(['photo.jpg', '--remove-background', '--pages', '1'])).toContain('--pages')
    expect(detailOf(['photo.jpg', '--remove-background', '--dpi', '300'])).toContain('--dpi')
    expect(detailOf(['photo.jpg', '--remove-background', '--separate'])).toContain('--separate')
    expect(detailOf(['photo.jpg', '--remove-background', '--background', '#ffffff'])).toContain(
      '--background',
    )
  })

  it('does not let a page operation silently win', () => {
    expect(detailOf(['photo.jpg', '--remove-background', '--rotate', '90'])).toContain(
      'one operation',
    )
  })

  it('requires an explicit lossy target when quality is supplied', () => {
    expect(detailOf(['photo.jpg', '--remove-background', '--quality', '75'])).toContain('--to')
  })

  it('rejects quality for a lossless target instead of silently ignoring it', () => {
    expect(
      detailOf(['photo.jpg', '--remove-background', '--to', 'png', '--quality', '75']),
    ).toContain('--quality does not apply')
  })
})
