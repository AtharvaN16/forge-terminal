/**
 * The maker's crop, from LibRaw's metadata.
 *
 * A sensor records a little more than the photo: a few rows and columns at
 * the edges that the camera, Lightroom and macOS all cut away. LibRaw decodes
 * the whole visible area, so without this a photo comes out a few pixels
 * larger than the same file opened on a Mac (measured: a Canon 40D CR2 is
 * 1944×1296 to LibRaw, 1936×1288 to sips and to the camera's own JPEG).
 * LibRaw reads the maker's crop from the file (`raw_inset_crops`), and its
 * `cropbox` setting applies one before the photo is turned upright.
 */

/** The slice of libraw-wasm's `metadata(true)` used here. */
export interface RawSizes {
  /** The upright size: libraw-wasm swaps these when `flip` turns the photo a quarter. */
  width: number
  height: number
  /** dcraw's flip: bit 4 swaps the axes, 2 mirrors rows, 1 mirrors columns. */
  flip: number
  /** Where the visible area starts within the sensor. */
  left_margin: number
  top_margin: number
  pixel_aspect?: number
  /** In sensor coordinates; 0xffff for an offset means "centred", a zero size means none. */
  raw_inset_crops?: { cleft: number; ctop: number; cwidth: number; cheight: number }[]
}

/** `[left, top, width, height]` in stored pixels within the visible area: what `cropbox` takes. */
export type CropBox = [left: number, top: number, width: number, height: number]

const CENTRED = 0xffff

const quarterTurned = (flip: number) => (flip & 4) !== 0

/**
 * The maker's crop as a `cropbox`, or undefined when the file has none, or
 * when the pixels are not square (LibRaw stretches those after cropping, so
 * the box would be in the wrong units). Clamped to the visible area: a CR3
 * names a crop one pixel wider than LibRaw's visible area.
 */
export function makerCrop(m: RawSizes): CropBox | undefined {
  const c = m.raw_inset_crops?.[0]
  if (!c || c.cwidth <= 0 || c.cheight <= 0) return undefined
  if (m.pixel_aspect !== undefined && m.pixel_aspect !== 1) return undefined
  const turned = quarterTurned(m.flip)
  const storedWidth = turned ? m.height : m.width
  const storedHeight = turned ? m.width : m.height
  const left = Math.max(
    0,
    c.cleft === CENTRED ? Math.floor((storedWidth - c.cwidth) / 2) : c.cleft - m.left_margin,
  )
  const top = Math.max(
    0,
    c.ctop === CENTRED ? Math.floor((storedHeight - c.cheight) / 2) : c.ctop - m.top_margin,
  )
  const width = Math.min(c.cwidth, storedWidth - left)
  const height = Math.min(c.cheight, storedHeight - top)
  if (width <= 0 || height <= 0) return undefined
  if (left === 0 && top === 0 && width === storedWidth && height === storedHeight) return undefined
  return [left, top, width, height]
}

/** The size LibRaw decodes to with `box` applied, upright. */
export function uprightSize(
  m: RawSizes,
  box: CropBox | undefined,
): { width: number; height: number } {
  if (!box) return { width: m.width, height: m.height }
  const [, , width, height] = box
  return quarterTurned(m.flip) ? { width: height, height: width } : { width, height }
}
