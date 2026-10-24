import { describe, expect, it } from 'vitest'
import { turnAction } from '../../src/core/actions/resize.js'
import type { ImageInfo } from '../../src/core/types.js'
import { CATALOG } from '../../src/extensions/catalog.js'
import {
  actionForRow,
  detailAt,
  editRow,
  editRows,
  pillOf,
  rowValues,
  toolState,
} from '../../src/shell/edit.js'
import { pinPlatform } from '../helpers/platform.js'

// The Mac's rows (Remove background among them); see pinPlatform.
pinPlatform('darwin')

const image = (width: number, height: number, format: ImageInfo['format'] = 'png'): ImageInfo =>
  ({
    kind: 'image',
    path: `/tmp/photo.${format}`,
    format,
    width,
    height,
    bytes: 1000,
    hasAlpha: false,
  }) as ImageInfo

describe('edit rows (boost-row-2026-10.html: B3, S1)', () => {
  it('has one Boost resolution row among the AI tools, then Trim edges and Resize', () => {
    expect(editRows(image(1200, 900)).map((r) => [r.id, r.label])).toEqual([
      ['sharpen', 'Sharpen'],
      ['boost', 'Boost resolution'],
      ['cutout', 'Remove background'],
      ['trim', 'Trim edges'],
      ['resize', 'Resize'],
      ['rotate', 'Rotate'],
      ['crop', 'Crop to shape'],
    ])
  })

  it('gives the Boost row every scale that fits, each with the size it makes', () => {
    const boost = editRow(image(1200, 900), 'boost')
    expect(boost?.scales?.map((s) => [s.scale, s.detail.bold])).toEqual([
      [2, '2400 × 1800'],
      [4, '4800 × 3600'],
    ])
  })

  it('offers 3× when the installed boost makes it', () => {
    const [, boost] = editRows(image(1200, 900), undefined, [2, 3, 4])
    expect(boost?.scales?.map((s) => [s.scale, s.detail.bold])).toEqual([
      [2, '2400 × 1800'],
      [3, '3600 × 2700'],
      [4, '4800 × 3600'],
    ])
  })

  it('says which boost version is installed, so the picker knows its scales', () => {
    const entry = CATALOG.find((e) => e.id === 'boost')
    if (!entry) throw new Error('no boost entry')
    expect(
      toolState({ entry, installed: '1.1.0', updateAvailable: false, supported: true }),
    ).toEqual({ kind: 'ready', version: '1.1.0' })
  })

  it('leaves out a scale past the limits, and dims the row only when none fits', () => {
    // 4100 px wide: 2× fits, 4× would be 16,400 px a side.
    const wide = editRow(image(4100, 50), 'boost')
    expect(wide?.scales?.map((s) => s.scale)).toEqual([2])
    expect(wide?.tooLarge).toBeUndefined()

    // 9000 px wide: even 2× is 18,000 px a side.
    const huge = editRow(image(9000, 50), 'boost')
    expect(huge?.scales).toEqual([])
    expect(huge?.tooLarge).toBe('18,000 px, over 16,384')
  })

  it('says what each tool does for the pane, as an on-device model, never “AI”', () => {
    const rows = editRows(image(1200, 900))
    expect(rows.map((r) => r.pane.short)).toEqual([
      'Keeps the size.',
      'Makes it bigger.',
      'Keeps the subject.',
      'Cuts off plain borders.',
      'Any size, no new detail.',
      'Turns it a quarter or a half.',
      'Changes the shape.',
    ])
    expect(rows[0]?.pane.long).toContain('on-device model')
    expect(rows[1]?.pane.long).toContain('on-device model')
    for (const r of rows) expect(`${r.pane.short} ${r.pane.long}`).not.toMatch(/\bAI\b/)
  })

  it('reads the detail for a scale: “becomes” and the size, JPEG noted for a HEIC', () => {
    const heic = editRow(image(1000, 500, 'heic'), 'boost')
    if (!heic) throw new Error('no boost row')
    expect(detailAt(heic, 4)).toEqual({ dim: 'becomes ', bold: '4000 × 2000', after: ' · as JPEG' })
    const raw = editRow(image(1000, 500, 'raw'), 'boost')
    if (!raw) throw new Error('no boost row')
    expect(detailAt(raw, 2)).toEqual({ dim: 'becomes ', bold: '2000 × 1000', after: ' · as JPEG' })
    const sharpen = editRow(image(1000, 500), 'sharpen')
    if (!sharpen) throw new Error('no sharpen row')
    expect(detailAt(sharpen)).toEqual({ dim: 'same size · ', bold: '1000 × 500', after: '' })
  })

  it('answers with the scale chosen on the row', () => {
    const boost = editRow(image(1200, 900), 'boost')
    if (!boost) throw new Error('no boost row')
    expect(rowValues(boost, 4)).toEqual({ tool: 'boost', target: 'png', scale: '4' })
    const sharpen = editRow(image(1200, 900), 'sharpen')
    if (!sharpen) throw new Error('no sharpen row')
    expect(rowValues(sharpen)).toEqual({ tool: 'sharpen', target: 'png', scale: '1' })
  })
})

describe('the Rotate row', () => {
  it('is built in, with the three turns and the size each leaves', () => {
    const rotate = editRow(image(1600, 900), 'rotate')
    expect(rotate?.extension).toBeUndefined()
    expect(rotate?.turns?.map((t) => [t.label, t.detail.dim, t.detail.bold])).toEqual([
      ['90° right', 'becomes ', '900 × 1600'],
      ['180°', 'same size · ', '1600 × 900'],
      ['90° left', 'becomes ', '900 × 1600'],
    ])
    expect(rotate?.verb).toBe('Rotating')
    expect(rotate && actionForRow(rotate)).toBe(turnAction)
  })

  it('answers with the turn on the pill', () => {
    const rotate = editRow(image(1200, 900), 'rotate')
    if (!rotate) throw new Error('no rotate row')
    expect(pillOf(rotate)?.noun).toBe('turn')
    expect(rowValues(rotate, 270)).toEqual({ tool: 'rotate', target: 'png', turn: 270 })
    expect(rowValues(rotate)).toEqual({ tool: 'rotate', target: 'png', turn: 90 })
  })

  it('is dimmed for an animation, which cannot be rotated', () => {
    const gif = { ...image(400, 300, 'gif'), frames: 12 } as ImageInfo
    expect(editRow(gif, 'rotate')?.tooLarge).toBe('animated')
    expect(editRow(image(400, 300), 'rotate')?.tooLarge).toBeUndefined()
  })
})

describe('the Crop to shape row (crop-2026-10.html, tab 2)', () => {
  it('is built in, after Resize, and offers every shape the photo does not already have', () => {
    const crop = editRow(image(1600, 900), 'crop')
    expect(crop?.extension).toBeUndefined()
    // 1600 × 900 is already 16:9: that largest box would cut nothing.
    expect(crop?.shapes?.map((s) => [s.shape.label, s.detail.dim, s.detail.bold])).toEqual([
      ['1:1', 'becomes ', '900 × 900'],
      ['4:5', 'becomes ', '720 × 900'],
      ['9:16', 'becomes ', '506 × 900'],
    ])
    expect(crop?.pane).toEqual({
      short: 'Changes the shape.',
      long: 'Cuts it to a new shape around the subject. You see the crop next and can move it.',
    })
    expect(crop?.verb).toBe('Cropping')
    expect(crop && actionForRow(crop).id).toBe('crop')
  })

  it('is dimmed for an animation, which cannot be cropped', () => {
    const gif = { ...image(400, 300, 'gif'), frames: 12 } as ImageInfo
    expect(editRow(gif, 'crop')?.tooLarge).toBe('animated')
    expect(editRow(image(400, 300), 'crop')?.tooLarge).toBeUndefined()
  })

  it('answers with the shape on the pill', () => {
    const crop = editRow(image(1200, 900), 'crop')
    if (!crop) throw new Error('no crop row')
    expect(rowValues(crop, '16:9')).toEqual({ tool: 'crop', target: 'png', shape: '16:9' })
    expect(rowValues(crop)).toEqual({ tool: 'crop', target: 'png', shape: '1:1' })
    expect(detailAt(crop, '4:5')).toEqual({ dim: 'becomes ', bold: '720 × 900', after: '' })
  })

  it('gives Boost and Crop the same pill: Boost steps scales, Crop steps shapes', () => {
    const rows = editRows(image(1200, 900))
    const boost = rows.find((r) => r.id === 'boost')
    const crop = rows.find((r) => r.id === 'crop')
    if (!boost || !crop) throw new Error('rows missing')
    expect(pillOf(boost)).toMatchObject({ noun: 'scale' })
    expect(pillOf(boost)?.steps.map((s) => [s.value, s.label])).toEqual([
      [2, '2×'],
      [4, '4×'],
    ])
    expect(pillOf(crop)).toMatchObject({ noun: 'shape' })
    expect(pillOf(crop)?.steps.map((s) => s.label)).toEqual(['1:1', '4:5', '16:9', '9:16'])
    expect(pillOf(rows[0] as (typeof rows)[0])).toBeUndefined()
  })
})
