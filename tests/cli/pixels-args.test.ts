import { describe, expect, it } from 'vitest'
import type { ConvertIntent } from '../../src/cli/args.js'
import { parseArgs } from '../../src/cli/args.js'
import { isForgeError } from '../../src/core/errors.js'

const argv = (...a: string[]) => ['doc.pdf', ...a]

/**
 * `parseArgs` returns the full `Intent` union, so a bare `.dpi` off its
 * result does not type-check (only `ConvertIntent` has it) — every other
 * test in this suite reaches for `toMatchObject` instead, which does not
 * care. This narrows once so the assertions below can stay direct property
 * reads, the more precise check for a value that must equal a specific
 * number rather than merely contain matching keys.
 */
function convert(a: string[]): ConvertIntent {
  const intent = parseArgs(a)
  if (intent.kind !== 'convert') throw new Error(`expected a convert intent, got ${intent.kind}`)
  return intent
}

/**
 * Same spirit as this file's own `codeOf` neighbour in `args.test.ts`, but
 * keeps the whole error rather than just `.code`: the bound-naming assertion
 * below needs `.hint`, which is where every other constructor in
 * `core/errors.ts` puts actionable guidance (`fileNotFound`'s "Check the
 * filename and try again.", and six more) — `.message` is `title: detail`
 * only and was never meant to carry it.
 */
function dpiError(a: string[]) {
  try {
    parseArgs(a)
  } catch (e) {
    if (isForgeError(e)) return e
    throw e
  }
  throw new Error('expected parseArgs to throw')
}

describe('rasterisation flags', () => {
  it('defaults dpi to 150', () => {
    expect(convert(argv('--to', 'jpeg')).dpi).toBe(150)
  })

  it('accepts a resolution in range', () => {
    expect(convert(argv('--to', 'jpeg', '--dpi', '300')).dpi).toBe(300)
    expect(convert(argv('--to', 'jpeg', '--dpi', '36')).dpi).toBe(36)
    expect(convert(argv('--to', 'jpeg', '--dpi', '600')).dpi).toBe(600)
  })

  it('rejects a resolution outside it, naming the bounds', () => {
    for (const bad of ['35', '601', 'lots']) {
      const err = dpiError(argv('--to', 'jpeg', '--dpi', bad))
      expect(err.code).toBe('invalid-dpi')
      expect(err.hint).toContain('36 and 600')
    }
  })

  it('carries a page range through unparsed, for the page count to validate', () => {
    expect(convert(argv('--to', 'jpeg', '--pages', '3-7,12')).pages).toBe('3-7,12')
  })

  it('rejects --pages without a conversion', () => {
    expect(() => parseArgs(argv('--pages', '1-2'))).toThrow(/--to/)
  })
})

describe('encrypted sources', () => {
  it('parses --password-stdin', () => {
    expect(convert(argv('--to', 'jpeg', '--password-stdin')).passwordStdin).toBe(true)
  })

  it('has no --password flag at all', () => {
    // A password in argv lands in shell history and ps output. Spec §8.
    expect(() => parseArgs(argv('--to', 'jpeg', '--password', 'hunter2'))).toThrow()
  })

  it('has no --unlock flag — the feature was cut, so the flag must not linger', () => {
    // A flag that parses but does nothing is worse than no flag. Ruling R7.
    expect(() => parseArgs(argv('--unlock'))).toThrow()
  })
})
