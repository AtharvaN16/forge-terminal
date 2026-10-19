import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { icoFrom, logoSvg, renderIcon } from '../../src/menu/icon.js'

/** True when some pixel in the bottom-right quarter is within `tol` of `hex`. */
async function cornerHas(png: Buffer, hex: string, tol = 24) {
  const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true })
  const want = [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16))
  for (let y = Math.floor(info.height / 2); y < info.height; y++)
    for (let x = Math.floor(info.width / 2); x < info.width; x++) {
      const o = (y * info.width + x) * info.channels
      if (want.every((v, c) => Math.abs((data[o + c] as number) - v) <= tol)) return true
    }
  return false
}

describe('logo', () => {
  it('draws the slashes in the item’s mode colour', () => {
    expect(logoSvg('compress', 64)).toContain('#79c98b')
    expect(logoSvg('pdf', 64)).toContain('#ff6b4a')
  })

  it('draws Forge’s own mark with the teal-to-violet gradient', () => {
    const svg = logoSvg('forge', 64)
    expect(svg).toContain('#55c7d9')
    expect(svg).toContain('#a68ce0')
  })

  it('renders a PNG of the asked size with the colour in the corner', async () => {
    const png = await renderIcon('compress', 64)
    const meta = await sharp(png).metadata()
    expect([meta.format, meta.width, meta.height]).toEqual(['png', 64, 64])
    expect(await cornerHas(png, '#79c98b')).toBe(true)
  })
})

describe('PAINTS', () => {
  it('matches the dark palette’s mode colours', async () => {
    const { DARK } = await import('../../src/shell/theme.js')
    const { PAINTS } = await import('../../src/menu/icon.js')
    expect(PAINTS).toEqual({
      convert: DARK.modeConvert,
      compress: DARK.modeCompress,
      edit: DARK.modeEdit,
      pdf: DARK.modePdf,
    })
  })
})

describe('icoFrom', () => {
  it('packs PNGs into an ICO: header, one directory entry each, the PNG bytes after', async () => {
    const a = await renderIcon('forge', 16)
    const b = await renderIcon('forge', 32)
    const ico = icoFrom([
      { size: 16, png: a },
      { size: 32, png: b },
    ])
    expect(ico.readUInt16LE(0)).toBe(0) // reserved
    expect(ico.readUInt16LE(2)).toBe(1) // type: icon
    expect(ico.readUInt16LE(4)).toBe(2) // count
    // first entry: 16 × 16, size and offset of its PNG
    expect([ico[6], ico[7]]).toEqual([16, 16])
    expect(ico.readUInt32LE(6 + 8)).toBe(a.length)
    const offset = ico.readUInt32LE(6 + 12)
    expect(offset).toBe(6 + 16 * 2)
    expect(ico.subarray(offset, offset + a.length).equals(a)).toBe(true)
    // second entry follows the first
    expect(ico.readUInt32LE(6 + 16 + 12)).toBe(offset + a.length)
  })

  it('writes 256 as 0 in the directory, as the format requires', async () => {
    const big = await renderIcon('forge', 256)
    const ico = icoFrom([{ size: 256, png: big }])
    expect([ico[6], ico[7]]).toEqual([0, 0])
  })
})
