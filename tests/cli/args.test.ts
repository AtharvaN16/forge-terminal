import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseArgs, wantsJson } from '../../src/cli/args.js'
import { type ForgeError, isForgeError } from '../../src/core/errors.js'
import { VERSION } from '../../src/shell/theme.js'

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
    expect(codeOf(['a.jpg', '--to', 'xyz'])).toBe('invalid-arguments')
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

describe('--max-size with --to', () => {
  const codeOf = (fn: () => unknown): string | undefined => {
    try {
      fn()
    } catch (e) {
      return isForgeError(e) ? e.code : 'unknown'
    }
    return undefined
  }

  it('is a conversion that carries the size', () => {
    const intent = parseArgs(['a.jpg', '--to', 'jpeg', '--max-size', '50kb'])
    if (intent.kind !== 'convert') throw new Error('expected convert')
    expect(intent.target).toBe('jpeg')
    expect(intent.maxBytes).toBe(50_000)
  })

  it('refuses --quality alongside it, as compression already does', () => {
    expect(
      codeOf(() => parseArgs(['a.jpg', '--to', 'webp', '--quality', '60', '--max-size', '1mb'])),
    ).toBe('invalid-arguments')
  })

  it('refuses a size it cannot read', () => {
    expect(codeOf(() => parseArgs(['a.jpg', '--to', 'jpeg', '--max-size', 'banana']))).toBe(
      'invalid-arguments',
    )
  })

  it('leaves maxBytes unset when --max-size is absent', () => {
    const intent = parseArgs(['a.jpg', '--to', 'jpeg'])
    if (intent.kind !== 'convert') throw new Error('expected convert')
    expect(intent.maxBytes).toBeUndefined()
  })
})
describe('--json', () => {
  it('is accepted beside a conversion, --formats and config', () => {
    expect(parseArgs(['a.jpg', '--to', 'webp', '--json'])).toMatchObject({ kind: 'convert' })
    expect(parseArgs(['--formats', '--json'])).toEqual({ kind: 'formats' })
    expect(parseArgs(['config', 'path', '--json'])).toEqual({ kind: 'config', action: 'path' })
  })

  it('wantsJson reads argv, and stops at --', () => {
    expect(wantsJson(['a.jpg', '--json'])).toBe(true)
    expect(wantsJson(['a.jpg'])).toBe(false)
    expect(wantsJson(['--', '--json'])).toBe(false)
  })

  it("reports commander's own usage errors as invalid-arguments", () => {
    expect(codeOf(['a.jpg', '--bogus'])).toBe('invalid-arguments')
    expect(codeOf(['a.jpg', '--to'])).toBe('invalid-arguments')
  })
})

describe('usage errors from Commander', () => {
  function errorOf(argv: string[]): ForgeError {
    try {
      parseArgs(argv)
    } catch (e) {
      if (isForgeError(e)) return e
      throw e
    }
    throw new Error('expected an error')
  }

  it('puts the suggestion in the hint, not in the detail', () => {
    const e = errorOf(['a.jpg', '--tox', 'png'])
    expect(e.detail).toBe("Unknown option '--tox'.")
    expect(e.detail).not.toContain('\n')
    expect(e.hint).toBe('Did you mean --to?')
  })

  it('keeps the generic hint when Commander has no suggestion', () => {
    const e = errorOf(['a.jpg', '--zzzzzz'])
    expect(e.detail).toBe("Unknown option '--zzzzzz'.")
    expect(e.hint).toBe('Run forge --help to see what Forge accepts.')
  })
})

describe('the version', () => {
  it('is the one in package.json, wherever it is shown', () => {
    const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'))
    // src/cli/args.ts prints this same constant for --version, and the
    // bundle test checks that output against it.
    expect(VERSION).toBe(pkg.version)
  })
})
