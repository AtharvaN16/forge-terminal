import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { cropAction, planEdit } from '../../src/core/actions/resize.js'
import {
  aspectLabel,
  CROP_SHAPES,
  centreOf,
  cropSuffix,
  keptShare,
  largestBox,
  movableAxes,
  movedBox,
  parseAspect,
  sampleDots,
  shapesFor,
  zoomedBox,
} from '../../src/core/crop.js'
import { isForgeError } from '../../src/core/errors.js'
import type { ImageInfo } from '../../src/core/types.js'

const LANDSCAPE = { width: 4032, height: 3024 }
const PORTRAIT = { width: 3024, height: 4032 }
const SQUARE = { width: 1000, height: 1000 }
const [square, fourFive, wide, tall] = CROP_SHAPES.map((s) => ({ w: s.w, h: s.h })) as [
  { w: number; h: number },
  { w: number; h: number },
  { w: number; h: number },
  { w: number; h: number },
]

const img = (over: Partial<ImageInfo> = {}): ImageInfo => ({
  kind: 'image',
  path: '/p/photo.jpg',
  format: 'jpeg',
  bytes: 1,
  width: 4032,
  height: 3024,
  hasAlpha: false,
  frames: 1,
  ...over,
})

describe('CROP_SHAPES', () => {
  it('are the pill’s four, in order', () => {
    expect(CROP_SHAPES.map((s) => s.label)).toEqual(['1:1', '4:5', '16:9', '9:16'])
    expect(CROP_SHAPES.map(aspectLabel)).toEqual(['1:1', '4:5', '16:9', '9:16'])
  })
})

describe('largestBox', () => {
  it('spans the height of a landscape photo for a narrower shape, centred', () => {
    expect(largestBox(LANDSCAPE, square)).toEqual({ left: 504, top: 0, width: 3024, height: 3024 })
    expect(largestBox(LANDSCAPE, fourFive)).toEqual({
      left: 806,
      top: 0,
      width: 2419,
      height: 3024,
    })
    expect(largestBox(LANDSCAPE, tall)).toEqual({ left: 1165, top: 0, width: 1701, height: 3024 })
  })

  it('spans the width for a wider shape', () => {
    expect(largestBox(LANDSCAPE, wide)).toEqual({ left: 0, top: 378, width: 4032, height: 2268 })
    expect(largestBox(PORTRAIT, square)).toEqual({ left: 0, top: 504, width: 3024, height: 3024 })
    expect(largestBox(PORTRAIT, fourFive)).toEqual({
      left: 0,
      top: 126,
      width: 3024,
      height: 3780,
    })
    expect(largestBox(PORTRAIT, tall)).toEqual({ left: 378, top: 0, width: 2268, height: 4032 })
  })

  it('handles a square photo and keeps every side at least 1 px', () => {
    expect(largestBox(SQUARE, square)).toEqual({ left: 0, top: 0, width: 1000, height: 1000 })
    expect(largestBox(SQUARE, wide)).toEqual({ left: 0, top: 218, width: 1000, height: 563 })
    expect(largestBox(SQUARE, tall)).toEqual({ left: 218, top: 0, width: 563, height: 1000 })
    expect(largestBox({ width: 100, height: 1 }, { w: 1, h: 100 })).toEqual({
      left: 49,
      top: 0,
      width: 1,
      height: 1,
    })
  })
})

describe('shapesFor', () => {
  it('drops a shape the photo already has', () => {
    expect(shapesFor({ width: 1600, height: 900 }).map((s) => s.label)).toEqual([
      '1:1',
      '4:5',
      '9:16',
    ])
    expect(shapesFor(SQUARE).map((s) => s.label)).toEqual(['4:5', '16:9', '9:16'])
    expect(shapesFor(LANDSCAPE)).toHaveLength(4)
  })
})

describe('zoomedBox', () => {
  it('shrinks around the centre', () => {
    const largest = largestBox(LANDSCAPE, square)
    expect(zoomedBox(LANDSCAPE, square, centreOf(largest), 50)).toEqual({
      left: 1260,
      top: 756,
      width: 1512,
      height: 1512,
    })
  })

  it('clamps inside the photo when the centre is near an edge', () => {
    expect(zoomedBox(LANDSCAPE, square, { x: 0, y: 3024 }, 50)).toEqual({
      left: 0,
      top: 1512,
      width: 1512,
      height: 1512,
    })
    // Back out to 100 % from a corner: the largest box, pushed back inside.
    expect(zoomedBox(LANDSCAPE, square, { x: 4032, y: 0 }, 100)).toEqual({
      left: 1008,
      top: 0,
      width: 3024,
      height: 3024,
    })
  })

  it('keeps the exact shape at every step: one side is the other through the ratio, rounded', () => {
    const sizes = [
      LANDSCAPE,
      PORTRAIT,
      SQUARE,
      { width: 1920, height: 1080 },
      { width: 333, height: 777 },
    ]
    for (const size of sizes) {
      for (const shape of CROP_SHAPES) {
        const largest = largestBox(size, shape)
        for (let pct = 100; pct >= 20; pct -= 10) {
          const { width, height } = zoomedBox(size, shape, centreOf(largest), pct)
          // The nearest whole pair to the ratio: one side, through it, rounds to the other.
          const fits =
            Math.abs((width * shape.h) / shape.w - height) <= 0.5 ||
            Math.abs((height * shape.w) / shape.h - width) <= 0.5
          expect(
            fits,
            `${shape.label} on ${size.width}×${size.height} at ${pct} %: ${width}×${height}`,
          ).toBe(true)
          expect(width).toBeLessThanOrEqual(size.width)
          expect(height).toBeLessThanOrEqual(size.height)
          if (pct === 100) expect([width, height]).toEqual([largest.width, largest.height])
        }
      }
    }
    // The case that drifted: 16:9 of 4032 × 3024 at 20 % was 806 × 454.
    expect(zoomedBox(LANDSCAPE, wide, { x: 2016, y: 1512 }, 20)).toMatchObject({
      width: 806,
      height: 453,
    })
  })
})

describe('movedBox and movableAxes', () => {
  const box = largestBox(LANDSCAPE, square)

  it('moves and stops at the edges', () => {
    expect(movedBox(LANDSCAPE, box, 100, 0)).toMatchObject({ left: 604, top: 0 })
    expect(movedBox(LANDSCAPE, box, 5000, 0)).toMatchObject({ left: 1008, top: 0 })
    expect(movedBox(LANDSCAPE, box, -5000, 50)).toMatchObject({ left: 0, top: 0 })
    expect(movedBox(LANDSCAPE, box, 0, 0)).toEqual(box)
  })

  it('frees one axis at the largest box and both once zoomed', () => {
    expect(movableAxes(LANDSCAPE, box)).toEqual({ x: true, y: false })
    expect(movableAxes(LANDSCAPE, largestBox(LANDSCAPE, wide))).toEqual({ x: false, y: true })
    const zoomed = zoomedBox(LANDSCAPE, square, centreOf(box), 90)
    expect(movableAxes(LANDSCAPE, zoomed)).toEqual({ x: true, y: true })
  })
})

describe('keptShare', () => {
  it('is the box’s area as a rounded share of the photo’s', () => {
    expect(keptShare(LANDSCAPE, largestBox(LANDSCAPE, square))).toBe(75)
    expect(keptShare(SQUARE, { left: 0, top: 0, width: 1000, height: 1000 })).toBe(100)
  })
})

describe('parseAspect and cropSuffix', () => {
  it('reads W:H of two whole numbers from 1 to 100', () => {
    expect(parseAspect('16:9')).toEqual({ w: 16, h: 9 })
    expect(parseAspect('1:1')).toEqual({ w: 1, h: 1 })
    expect(parseAspect('100:3')).toEqual({ w: 100, h: 3 })
  })

  it.each(['0:1', '1:0', 'a:b', '101:1', '1:1:1', '', '1.5:1', '-1:1'])('refuses %j', (text) => {
    let caught: unknown
    try {
      parseAspect(text)
    } catch (e) {
      caught = e
    }
    expect(isForgeError(caught) && caught.code).toBe('invalid-arguments')
    expect(isForgeError(caught) && caught.hint).toBe('Try --crop 1:1 or --crop 16:9.')
  })

  it('names a shape for a file', () => {
    expect(cropSuffix({ w: 16, h: 9 })).toBe('cropped-16x9')
  })
})

describe('sampleDots', () => {
  it('area-averages a thumbnail into cols × rows*2 dots', () => {
    // 4×4: each 2×2 quadrant holds two values, so its average is known.
    const rgb = new Uint8Array(4 * 4 * 3)
    const set = (x: number, y: number, v: [number, number, number]) => rgb.set(v, (y * 4 + x) * 3)
    for (let y = 0; y < 4; y++)
      for (let x = 0; x < 4; x++) {
        const quadrant = (y < 2 ? 0 : 2) + (x < 2 ? 0 : 1)
        const shade = (x + y) % 2 === 0 ? 0 : 100
        set(x, y, [quadrant * 40 + shade, 10, 200])
      }
    const dots = sampleDots({ width: 4, height: 4, rgb }, 2, 1)
    expect([dots.cols, dots.dotRows]).toEqual([2, 2])
    expect([...dots.rgb]).toEqual([50, 10, 200, 90, 10, 200, 130, 10, 200, 170, 10, 200])
  })
})

describe('planEdit with a crop', () => {
  const base = { trim: false, background: '#fff', keepMetadata: false }

  it('names the shape, and the resized size of the crop when resized too', () => {
    const [alone] = planEdit([img()], { ...base, crop: { aspect: { w: 1, h: 1 } } })
    expect(alone).toMatchObject({
      target: 'jpeg',
      outputs: [resolve('/p/photo-cropped-1x1.jpg')],
      options: { crop: { aspect: { w: 1, h: 1 } } },
    })
    const [sized] = planEdit([img()], {
      ...base,
      crop: { aspect: { w: 4, h: 5 } },
      resize: { width: 1080 },
    })
    expect(sized?.outputs).toEqual([resolve('/p/photo-cropped-4x5-1080x1350.jpg')])
    // A given box is what gets resized, not the largest.
    const [boxed] = planEdit([img()], {
      ...base,
      crop: { aspect: { w: 1, h: 1 }, box: { left: 0, top: 0, width: 1000, height: 1000 } },
      resize: { percent: 50 },
    })
    expect(boxed?.outputs).toEqual([resolve('/p/photo-cropped-1x1-500x500.jpg')])
  })

  it('never plans a crop with a trim', () => {
    expect(() => planEdit([img()], { ...base, trim: true, crop: { aspect: square } })).toThrow()
  })
})

describe('cropAction', () => {
  it('applies to still images only', () => {
    expect(cropAction).toMatchObject({
      id: 'crop',
      label: 'Crop to shape',
      verb: 'Cropping',
      hint: 'change the shape',
    })
    expect(cropAction.appliesTo([img()])).toBe(true)
    expect(cropAction.appliesTo([img({ format: 'gif', frames: 3 })])).toBe(false)
    expect(cropAction.unavailable?.([img({ format: 'gif', frames: 3 })])).toBe('animated')
    const doc = { kind: 'document', path: '/p/a.pdf', format: 'pdf', bytes: 1, pages: 1 } as const
    expect(cropAction.unavailable?.([{ ...doc, encrypted: false }])).toBe('images only')
  })

  it('plans from the shape and box in its values', () => {
    const crop = { aspect: { w: 16, h: 9 }, box: { left: 0, top: 10, width: 1600, height: 900 } }
    const [job] = cropAction.plan([img()], { crop, background: '#000' })
    expect(job).toMatchObject({
      outputs: [resolve('/p/photo-cropped-16x9.jpg')],
      options: { crop, background: '#000' },
    })
    expect(cropAction.plan([img()], { crop: 'nope' })).toEqual([])
  })
})
