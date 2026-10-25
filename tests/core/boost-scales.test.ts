import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseArgs } from '../../src/cli/args.js'
import { boostAction } from '../../src/core/actions/extension.js'
import { boostScaleRefusal, boostScales, boostServes } from '../../src/core/extension-targets.js'
import type { ImageInfo } from '../../src/core/types.js'
import { maxBoost } from '../../src/engines/extension.js'

const photo = {
  kind: 'image',
  path: '/tmp/photo.png',
  format: 'png',
  width: 100,
  height: 80,
  bytes: 1000,
  hasAlpha: false,
  frames: 1,
} as ImageInfo

describe('boost scales', () => {
  it('offers 3× only from the boost release whose runner makes it', () => {
    expect(boostScales(undefined)).toEqual([2, 4])
    expect(boostScales('1.0.0')).toEqual([2, 4])
    expect(boostScales('1.1.0')).toEqual([2, 3, 4])
    expect(boostScales('1.10.0')).toEqual([2, 3, 4])
    expect(boostScales('2.0.0')).toEqual([2, 3, 4])
  })

  it('runs a batch in one runner only from the boost release whose runner serves', () => {
    // Every version published before it — Apple silicon 1.0.0, Windows 1.1.0, Intel Macs 1.2.0, Linux 1.3.0 — gets one process a file.
    for (const v of [undefined, '1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.3.9'])
      expect(boostServes(v)).toBe(false)
    for (const v of ['1.4.0', '1.10.0', '2.0.0']) expect(boostServes(v)).toBe(true)
  })

  it('says “update it” for a scale only when a released boost makes it', () => {
    // Installed 1.0.0, and 1.1.0 is out: updating fixes it.
    const outdated = boostScaleRefusal(3, '1.0.0', '1.1.0')
    expect(outdated?.code).toBe('extension-outdated')
    expect(outdated?.hint).toBe('Update it with: forge extensions add boost')

    // Installed 1.0.0 and nothing newer released: updating would change nothing.
    const unreleased = boostScaleRefusal(3, '1.0.0', '1.0.0')
    expect(unreleased?.code).toBe('invalid-arguments')
    expect(unreleased?.message).toContain('No released boost makes 3× yet.')
    expect(unreleased?.hint).toBe('Try --boost 2 or --boost 4.')

    expect(boostScaleRefusal(3, '1.1.0', '1.1.0')).toBeUndefined()
    expect(boostScaleRefusal(4, '1.0.0', '1.0.0')).toBeUndefined()
    expect(boostScaleRefusal(1, '1.0.0', '1.0.0')).toBeUndefined()
  })

  it('plans a 3× job, named name-3x', () => {
    const [job] = boostAction.plan([photo], { scale: '3', output: '/tmp/out' })
    expect(job).toMatchObject({
      op: 'boost',
      scale: 3,
      outputs: [resolve('/tmp/out/photo-3x.png')],
    })
  })

  it('reads --boost 3, and refuses a factor it does not have', () => {
    expect(parseArgs(['photo.png', '--boost', '3'])).toMatchObject({ scale: 3 })
    expect(parseArgs(['photo.png', '--boost=3'])).toMatchObject({ scale: 3 })
    expect(() => parseArgs(['photo.png', '--boost', '5'])).toThrow(
      '--boost takes 2, 3 or 4, not 5.',
    )
  })

  it('names the largest factor that fits among those the installed runner makes', () => {
    // 5000 px wide: 4× is 20,000 px a side, 3× is 15,000.
    expect(maxBoost(5000, 50, Number.POSITIVE_INFINITY, [2, 3, 4])).toBe(3)
    expect(maxBoost(5000, 50, Number.POSITIVE_INFINITY, [2, 4])).toBe(2)
    expect(maxBoost(5000, 50, 3, [2, 3, 4])).toBe(2)
  })
})
