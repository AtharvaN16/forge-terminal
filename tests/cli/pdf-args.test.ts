import { describe, expect, it } from 'vitest'
import { parseArgs } from '../../src/cli/args.js'

describe('page operation flags', () => {
  it('parses --merge with several inputs', () => {
    const intent = parseArgs(['a.pdf', 'b.pdf', '--merge'])
    if (intent.kind !== 'pageop') throw new Error('expected pageop')
    expect(intent.action).toBe('merge')
    expect(intent.inputs).toEqual(['a.pdf', 'b.pdf'])
  })

  it('parses --split every-page', () => {
    const intent = parseArgs(['doc.pdf', '--split', 'every-page'])
    if (intent.kind !== 'pageop') throw new Error('expected pageop')
    expect(intent.action).toBe('split')
    expect(intent.split).toEqual({ mode: 'every-page' })
  })

  it('parses --split every=10', () => {
    const intent = parseArgs(['doc.pdf', '--split', 'every=10'])
    if (intent.kind !== 'pageop') throw new Error('expected pageop')
    expect(intent.split).toEqual({ mode: 'every-n', n: 10 })
  })

  it('parses --split at=1,4 as 1-based cut points', () => {
    const intent = parseArgs(['doc.pdf', '--split', 'at=1,4'])
    if (intent.kind !== 'pageop') throw new Error('expected pageop')
    expect(intent.split).toEqual({ mode: 'points', after: [1, 4] })
  })

  it('parses --extract with a range and --separate', () => {
    const intent = parseArgs(['doc.pdf', '--extract', '3-7,12', '--separate'])
    if (intent.kind !== 'pageop') throw new Error('expected pageop')
    expect(intent.action).toBe('extract')
    expect(intent.pages).toBe('3-7,12')
    expect(intent.separate).toBe(true)
  })

  it('parses --delete', () => {
    const intent = parseArgs(['doc.pdf', '--delete', '3-7'])
    if (intent.kind !== 'pageop') throw new Error('expected pageop')
    expect(intent.action).toBe('delete')
    expect(intent.pages).toBe('3-7')
  })

  it('parses --rotate in degrees', () => {
    const intent = parseArgs(['doc.pdf', '--rotate', '180'])
    if (intent.kind !== 'pageop') throw new Error('expected pageop')
    expect(intent.action).toBe('rotate')
    expect(intent.rotate).toBe(180)
  })

  it('rejects a rotation that is not a multiple of 90', () => {
    expect(() => parseArgs(['doc.pdf', '--rotate', '45'])).toThrow(/multiple of 90/)
  })

  it('rejects two page operations at once', () => {
    expect(() => parseArgs(['doc.pdf', '--rotate', '90', '--delete', '2'])).toThrow(/one operation/)
  })

  it('carries --force through to the intent', () => {
    const intent = parseArgs(['doc.pdf', '--rotate', '90', '--force'])
    if (intent.kind !== 'pageop') throw new Error('expected pageop')
    expect(intent.force).toBe(true)
  })

  it('defaults force to false', () => {
    const intent = parseArgs(['doc.pdf', '--rotate', '90'])
    if (intent.kind !== 'pageop') throw new Error('expected pageop')
    expect(intent.force).toBe(false)
  })

  it('rejects --separate on an operation other than --extract', () => {
    expect(() => parseArgs(['doc.pdf', '--delete', '3', '--separate'])).toThrow(/--separate/)
  })

  /**
   * `every=0` matches the digits regex and the captured "0" is a truthy
   * string, so it used to parse as a real mode and reach `everyNCuts`, whose
   * loop never advances with a step of 0 — it burned CPU until the cuts array
   * hit its maximum length and then died with a raw `RangeError` stack. The
   * shell has validated this exact field since it was written
   * (`flows/pdf.tsx`'s `submitSplitN`); this is the CLI catching up.
   */
  it('rejects --split every=0 rather than looping forever on it', () => {
    expect(() => parseArgs(['doc.pdf', '--split', 'every=0'])).toThrow(/at least 1/)
  })

  /**
   * `PageOpIntent` carries no `output` field and `intent.output` is only set
   * on the convert path, so `-o` used to be accepted and then silently
   * dropped: `--merge -o combined.pdf` wrote `<folder>-merged.pdf` without
   * ever mentioning the flag. Refused outright instead, the same way
   * `--separate` is refused on the four operations it does not apply to —
   * implementing `-o` across five operations with different arities is a
   * later phase, but silently ignoring a flag someone typed is a defect now.
   */
  it('refuses --output on a page operation rather than ignoring it', () => {
    expect(() => parseArgs(['a.pdf', 'b.pdf', '--merge', '-o', 'combined.pdf'])).toThrow(/--output/)
    expect(() => parseArgs(['doc.pdf', '--rotate', '90', '--output', 'out.pdf'])).toThrow(
      /--output/,
    )
  })

  it('still accepts the smallest valid group size', () => {
    const intent = parseArgs(['doc.pdf', '--split', 'every=1'])
    if (intent.kind !== 'pageop') throw new Error('expected pageop')
    expect(intent.split).toEqual({ mode: 'every-n', n: 1 })
  })
})
