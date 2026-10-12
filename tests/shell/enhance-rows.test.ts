import { describe, expect, it } from 'vitest'
import type { ImageInfo } from '../../src/core/types.js'
import { CATALOG } from '../../src/extensions/catalog.js'
import { detailAt, enhanceRow, enhanceRows, rowValues, toolState } from '../../src/shell/enhance.js'
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

describe('enhance rows (boost-row-2026-10.html: B3, S1)', () => {
  it('has one Boost resolution row among the AI tools, then Trim edges and Resize', () => {
    expect(enhanceRows(image(1200, 900)).map((r) => [r.id, r.label])).toEqual([
      ['sharpen', 'Sharpen'],
      ['boost', 'Boost resolution'],
      ['cutout', 'Remove background'],
      ['trim', 'Trim edges'],
      ['resize', 'Resize'],
    ])
  })

  it('gives the Boost row every scale that fits, each with the size it makes', () => {
    const boost = enhanceRow(image(1200, 900), 'boost')
    expect(boost?.scales?.map((s) => [s.scale, s.detail.bold])).toEqual([
      [2, '2400 × 1800'],
      [4, '4800 × 3600'],
    ])
  })

  it('offers 3× when the installed boost makes it', () => {
    const [, boost] = enhanceRows(image(1200, 900), undefined, [2, 3, 4])
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
    const wide = enhanceRow(image(4100, 50), 'boost')
    expect(wide?.scales?.map((s) => s.scale)).toEqual([2])
    expect(wide?.tooLarge).toBeUndefined()

    // 9000 px wide: even 2× is 18,000 px a side.
    const huge = enhanceRow(image(9000, 50), 'boost')
    expect(huge?.scales).toEqual([])
    expect(huge?.tooLarge).toBe('18,000 px, over 16,384')
  })

  it('says what each tool does for the pane, as an on-device model, never “AI”', () => {
    const rows = enhanceRows(image(1200, 900))
    expect(rows.map((r) => r.pane.short)).toEqual([
      'Keeps the size.',
      'Makes it bigger.',
      'Keeps the subject.',
      'Cuts off plain borders.',
      'Any size, no new detail.',
    ])
    expect(rows[0]?.pane.long).toContain('on-device model')
    expect(rows[1]?.pane.long).toContain('on-device model')
    for (const r of rows) expect(`${r.pane.short} ${r.pane.long}`).not.toMatch(/\bAI\b/)
  })

  it('reads the detail for a scale: “becomes” and the size, JPEG noted for a HEIC', () => {
    const heic = enhanceRow(image(1000, 500, 'heic'), 'boost')
    if (!heic) throw new Error('no boost row')
    expect(detailAt(heic, 4)).toEqual({ dim: 'becomes ', bold: '4000 × 2000', after: ' · as JPEG' })
    const sharpen = enhanceRow(image(1000, 500), 'sharpen')
    if (!sharpen) throw new Error('no sharpen row')
    expect(detailAt(sharpen)).toEqual({ dim: 'same size · ', bold: '1000 × 500', after: '' })
  })

  it('answers with the scale chosen on the row', () => {
    const boost = enhanceRow(image(1200, 900), 'boost')
    if (!boost) throw new Error('no boost row')
    expect(rowValues(boost, 4)).toEqual({ tool: 'boost', target: 'png', scale: '4' })
    const sharpen = enhanceRow(image(1200, 900), 'sharpen')
    if (!sharpen) throw new Error('no sharpen row')
    expect(rowValues(sharpen)).toEqual({ tool: 'sharpen', target: 'png', scale: '1' })
  })
})
