import { describe, expect, it } from 'vitest'
import { makerCrop, type RawSizes, uprightSize } from '../../extensions/raw/crop.js'

/**
 * The maker's crop, from what LibRaw (libraw-wasm 1.6.0) reported for real
 * camera files, against the size macOS's sips gives the same file.
 */
const NONE = { cleft: 0xffff, ctop: 0xffff, cwidth: 0, cheight: 0 }

function sizes(m: Partial<RawSizes>): RawSizes {
  return { width: 0, height: 0, flip: 0, left_margin: 0, top_margin: 0, pixel_aspect: 1, ...m }
}

describe('the maker’s crop', () => {
  it('a Canon 40D CR2: 1944×1296 visible, cropped to 1936×1288 as on a Mac', () => {
    const m = sizes({
      width: 1944,
      height: 1296,
      raw_inset_crops: [{ cleft: 4, ctop: 3, cwidth: 1936, cheight: 1288 }, NONE],
    })
    expect(makerCrop(m)).toEqual([4, 3, 1936, 1288])
    expect(uprightSize(m, makerCrop(m))).toEqual({ width: 1936, height: 1288 })
  })

  it('counts the crop from the visible area, not the sensor’s edge (a Fuji RAF)', () => {
    const m = sizes({
      width: 6246,
      height: 4170,
      top_margin: 6,
      raw_inset_crops: [{ cleft: 6, ctop: 18, cwidth: 6240, cheight: 4155 }],
    })
    expect(makerCrop(m)).toEqual([6, 12, 6240, 4155])
  })

  it('keeps a crop inside the visible area (a CR3 names one a pixel too wide)', () => {
    const m = sizes({
      width: 3407,
      height: 2271,
      left_margin: 156,
      top_margin: 108,
      raw_inset_crops: [{ cleft: 156, ctop: 108, cwidth: 3408, cheight: 2272 }],
    })
    // The whole visible area: nothing to crop.
    expect(makerCrop(m)).toBeUndefined()
    expect(uprightSize(m, makerCrop(m))).toEqual({ width: 3407, height: 2271 })
  })

  it('centres a crop with no offset (a Sony ARW)', () => {
    const m = sizes({
      width: 2784,
      height: 1872,
      raw_inset_crops: [{ cleft: 0xffff, ctop: 0xffff, cwidth: 2768, cheight: 1848 }],
    })
    expect(makerCrop(m)).toEqual([8, 12, 2768, 1848])
  })

  it('crops nothing when the file names no crop (a Nikon D2H NEF, an iPhone DNG)', () => {
    expect(makerCrop(sizes({ width: 2482, height: 1648, raw_inset_crops: [NONE] }))).toBeUndefined()
    expect(makerCrop(sizes({ width: 4032, height: 3024 }))).toBeUndefined()
  })

  it('works in stored pixels when the photo is turned a quarter, and says the upright size', () => {
    // libraw-wasm reports the upright size: a 320×240 sensor, turned, is 240×320.
    const m = sizes({
      width: 240,
      height: 320,
      flip: 6,
      raw_inset_crops: [{ cleft: 40, ctop: 20, cwidth: 240, cheight: 200 }],
    })
    expect(makerCrop(m)).toEqual([40, 20, 240, 200])
    expect(uprightSize(m, makerCrop(m))).toEqual({ width: 200, height: 240 })
  })

  it('leaves pixels that are not square alone: LibRaw stretches those after cropping', () => {
    const m = sizes({
      width: 2000,
      height: 1000,
      pixel_aspect: 0.5,
      raw_inset_crops: [{ cleft: 4, ctop: 4, cwidth: 1990, cheight: 990 }],
    })
    expect(makerCrop(m)).toBeUndefined()
  })
})
