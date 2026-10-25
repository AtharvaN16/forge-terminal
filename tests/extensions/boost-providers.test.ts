import { describe, expect, it } from 'vitest'
import { judge, providerPlan, TOO_SLOW_MS, tileCount } from '../../extensions/boost/providers.js'

/**
 * Which execution providers the Boost runner asks ONNX Runtime for, and when
 * it gives up on a run that would take minutes. Both are pure: the runner only
 * acts on what they say.
 */
describe('providerPlan', () => {
  it('keeps Windows on DirectML then the CPU, with no time limit (as before)', () => {
    for (const arch of ['x64', 'arm64'])
      expect(providerPlan('win32', arch)).toEqual({ providers: ['dml', 'cpu'], guarded: false })
  })

  it('keeps Apple silicon on CoreML then the CPU, with no time limit (as before)', () => {
    expect(providerPlan('darwin', 'arm64')).toEqual({
      providers: ['coreml', 'cpu'],
      guarded: false,
    })
  })

  it('asks Linux x64 for WebGPU, then the CPU, under the time limit', () => {
    expect(providerPlan('linux', 'x64')).toEqual({ providers: ['webgpu', 'cpu'], guarded: true })
  })

  it('asks an Intel Mac for WebGPU, then CoreML, then the CPU, under the time limit', () => {
    expect(providerPlan('darwin', 'x64')).toEqual({
      providers: ['webgpu', 'coreml', 'cpu'],
      guarded: true,
    })
  })

  it('leaves Linux arm64 as it was: no WebGPU build exists for it', () => {
    expect(providerPlan('linux', 'arm64')).toEqual({ providers: ['coreml', 'cpu'], guarded: false })
  })
})

describe('tileCount', () => {
  it('counts the tiles of the step the runner walks the image in', () => {
    expect(tileCount(224, 224, 224)).toBe(1)
    expect(tileCount(225, 224, 224)).toBe(2)
    expect(tileCount(4000, 3000, 224)).toBe(18 * 14)
    expect(tileCount(1, 1, 224)).toBe(1)
  })
})

describe('judge (the too-slow guard)', () => {
  const total = 252 // a 12 MP photo, 18 x 14 tiles
  it('has the limit at three minutes', () => {
    expect(TOO_SLOW_MS).toBe(180_000)
  })

  it('waits after the first tile of a long job: it holds the shader compile, so it proves little', () => {
    expect(judge([4000], total)).toEqual({ slow: false })
    // Even a first tile that would project past the limit.
    expect(judge([30_000], total)).toEqual({ slow: false })
  })

  it('judges on the second tile, once the first has paid the one-off start-up', () => {
    // 4 s start-up, then 0.2 s a tile: 4 + 0.2 x 251 = 54 s.
    expect(judge([4000, 200], total)).toEqual({ slow: false })
  })

  it('stops a software adapter: 1.5 s a tile over 252 tiles is over six minutes', () => {
    const v = judge([2500, 1500], total)
    expect(v.slow).toBe(true)
    expect(v).toMatchObject({ projectedMs: 2500 + 1500 * 251 })
  })

  it('does not stop a job projected to just fit', () => {
    // 100 tiles at 1.79 s = 179 s plus the first tile's extra: under the limit.
    expect(judge([1790, 1790], 100)).toEqual({ slow: false })
  })

  it('stops a job projected just over the limit', () => {
    expect(judge([1810, 1810], 100).slow).toBe(true)
  })

  it('stops at the first tile if that one tile alone is past the limit', () => {
    expect(judge([TOO_SLOW_MS + 1], 4)).toMatchObject({ slow: true })
  })

  it('never stops a single tile image that finished inside the limit', () => {
    expect(judge([170_000], 1)).toEqual({ slow: false })
  })

  it('has nothing to say after the second tile: the run goes on', () => {
    expect(judge([1000, 1000, 9000], total)).toEqual({ slow: false })
  })

  it('has nothing to say before any tile', () => {
    expect(judge([], total)).toEqual({ slow: false })
  })
})
