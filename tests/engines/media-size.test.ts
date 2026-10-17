import { describe, expect, it } from 'vitest'
import { floorBytes, planSize } from '../../src/engines/media-size.js'

const MB = 1000 * 1000

/** The case the design is built around: a 2:10 Retina screen recording. */
const recording = { duration: 130, width: 2940, height: 1912, fps: 60, hasAudio: true }

describe('planSize', () => {
  it('fits 10 MB by stepping the picture and frame rate down until each pixel gets enough', () => {
    const plan = planSize({ ...recording, targetBytes: 10 * MB })
    expect(plan).toMatchObject({ width: 1280, height: 832, fps: 24, audioKbps: 64 })
    if (!('videoKbps' in plan)) throw new Error('refused')
    // Sound and picture together spend the budget, never more.
    expect(((plan.videoKbps + plan.audioKbps) * 1000 * recording.duration) / 8).toBeLessThanOrEqual(
      10 * MB,
    )
  })

  it('keeps the full size and frame rate when the budget allows', () => {
    const plan = planSize({ ...recording, duration: 4, targetBytes: 25 * MB })
    expect(plan).toMatchObject({ width: 2940, height: 1912, fps: 60 })
  })

  it('never raises the frame rate above the source', () => {
    const plan = planSize({ ...recording, fps: 20, duration: 4, targetBytes: 25 * MB })
    expect(plan).toMatchObject({ fps: 20 })
  })

  it('refuses a size under the floor, saying what the floor is', () => {
    const plan = planSize({ ...recording, targetBytes: 1 * MB })
    expect(plan).toEqual({ floor: floorBytes(recording) })
  })

  it('takes the bottom rung, with mono sound, just above the floor', () => {
    const plan = planSize({ ...recording, targetBytes: floorBytes(recording) + 1000 })
    expect(plan).toMatchObject({ width: 854, height: 556, fps: 15, audioKbps: 32 })
  })

  it('spends nothing on sound when there is none', () => {
    const plan = planSize({ ...recording, hasAudio: false, targetBytes: 10 * MB })
    expect(plan).toMatchObject({ audioKbps: 0 })
  })

  it('keeps sizes even, as H.264 needs', () => {
    const plan = planSize({
      duration: 60,
      width: 1001,
      height: 777,
      fps: 30,
      hasAudio: true,
      targetBytes: 3 * MB,
    })
    if (!('width' in plan)) throw new Error('refused')
    expect(plan.width % 2).toBe(0)
    expect(plan.height % 2).toBe(0)
  })

  it('works for a portrait phone video, stepping the long side', () => {
    const plan = planSize({
      duration: 60,
      width: 1080,
      height: 1920,
      fps: 30,
      hasAudio: true,
      targetBytes: 5 * MB,
    })
    if (!('width' in plan)) throw new Error('refused')
    expect(Math.max(plan.width, plan.height)).toBeLessThan(1920)
    expect(plan.height).toBeGreaterThan(plan.width)
  })
})

describe('floorBytes', () => {
  it('is about 2.5 MB for the 2:10 recording', () => {
    expect(floorBytes(recording) / MB).toBeCloseTo(2.5, 0)
  })

  it('grows with length: an hour-long talk cannot reach 10 MB', () => {
    expect(floorBytes({ ...recording, duration: 3600 })).toBeGreaterThan(60 * MB)
  })

  it('is lower for a short clip, under 1 MB', () => {
    expect(floorBytes({ ...recording, duration: 6 })).toBeLessThan(1 * MB)
  })
})
