import { describe, expect, it } from 'vitest'
import {
  type Device,
  judge,
  NCNN_TOO_SLOW_MS,
  pickDevice,
  providerPlan,
  TOO_SLOW_MS,
  tileCount,
} from '../../extensions/boost/providers.js'

/**
 * What runs the Boost model on each platform (ONNX Runtime and its providers,
 * or ncnn), which graphics device ncnn may use, and when the runner gives up on
 * a run that would take minutes. All pure: the runner only acts on what they say.
 */
describe('providerPlan', () => {
  it('keeps Windows on DirectML then the CPU, with no time limit (as before)', () => {
    for (const arch of ['x64', 'arm64'])
      expect(providerPlan('win32', arch)).toEqual({
        engine: 'ort',
        providers: ['dml', 'cpu'],
        guarded: false,
        limitMs: TOO_SLOW_MS,
      })
  })

  it('keeps Apple silicon on CoreML then the CPU, with no time limit (as before)', () => {
    expect(providerPlan('darwin', 'arm64')).toEqual({
      engine: 'ort',
      providers: ['coreml', 'cpu'],
      guarded: false,
      limitMs: TOO_SLOW_MS,
    })
  })

  it('keeps an Intel Mac on WebGPU, then CoreML, then the CPU, under the three-minute limit', () => {
    expect(providerPlan('darwin', 'x64')).toEqual({
      engine: 'ort',
      providers: ['webgpu', 'coreml', 'cpu'],
      guarded: true,
      limitMs: 180_000,
    })
  })

  it('runs Linux, both chips, on ncnn under the fifteen-minute limit', () => {
    for (const arch of ['x64', 'arm64'])
      expect(providerPlan('linux', arch)).toEqual({
        engine: 'ncnn',
        providers: [],
        guarded: true,
        limitMs: 900_000,
      })
  })
})

describe('pickDevice', () => {
  const dev = (index: number, name: string, kind: string): Device => ({ index, name, kind })

  it('takes a discrete card over an integrated chip', () => {
    const picked = pickDevice([
      dev(0, 'Intel(R) UHD Graphics 630', 'integrated'),
      dev(1, 'NVIDIA GeForce RTX 3060', 'discrete'),
    ])
    expect(picked?.index).toBe(1)
  })

  it('takes an integrated chip when it is all there is, and a virtual one after that', () => {
    expect(pickDevice([dev(0, 'AMD Radeon Graphics (RADV RENOIR)', 'integrated')])?.index).toBe(0)
    expect(
      pickDevice([dev(0, 'Virtio-GPU Venus', 'virtual'), dev(1, 'Intel UHD', 'integrated')])?.index,
    ).toBe(1)
    expect(pickDevice([dev(0, 'Virtio-GPU Venus', 'virtual')])?.index).toBe(0)
  })

  it('turns away software adapters by name, whatever they report themselves as', () => {
    for (const name of [
      'llvmpipe (LLVM 15.0.7, 256 bits)',
      'lavapipe',
      'SwiftShader Device (Subzero)',
      'Google SwiftShader',
      'softpipe',
      'Microsoft Basic Render Driver',
      'Microsoft WARP',
      'Some Software Rasterizer',
    ]) {
      expect(pickDevice([dev(0, name, 'discrete')]), name).toBeUndefined()
      expect(pickDevice([dev(0, name, 'cpu')]), name).toBeUndefined()
    }
  })

  it('turns away a device that says it is a CPU or does not say what it is', () => {
    expect(pickDevice([dev(0, 'Mystery', 'cpu')])).toBeUndefined()
    expect(pickDevice([dev(0, 'Mystery', 'other')])).toBeUndefined()
  })

  it('skips the software one and uses the real card beside it', () => {
    const picked = pickDevice([
      dev(0, 'llvmpipe (LLVM 17.0.6, 256 bits)', 'cpu'),
      dev(1, 'AMD Radeon RX 6600 (RADV NAVI23)', 'discrete'),
    ])
    expect(picked?.index).toBe(1)
  })

  it('has nothing to pick from an empty list', () => {
    expect(pickDevice([])).toBeUndefined()
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
  it('has the limit at three minutes for an Intel Mac, and at fifteen on Linux', () => {
    expect(TOO_SLOW_MS).toBe(180_000)
    expect(NCNN_TOO_SLOW_MS).toBe(900_000)
  })

  it('lets a 12 MP photo through on a Raspberry Pi 5 (about 0.5 s a tile) but not on a board ten times slower', () => {
    expect(judge([600, 500], total, NCNN_TOO_SLOW_MS)).toEqual({ slow: false })
    expect(judge([6000, 5000], total, NCNN_TOO_SLOW_MS)).toEqual({
      slow: true,
      projectedMs: 6000 + 5000 * 251,
    })
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
