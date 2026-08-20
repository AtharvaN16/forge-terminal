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
})
