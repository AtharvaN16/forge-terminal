import sharp from 'sharp'
import type { MenuPaint } from './items.js'

/**
 * Forge's logo (decided, C5·m in mockups/finder-2026-10.html): the F from the
 * home screen's FORGE, white on the canvas grey, and four slashes packed into
 * the bottom-right corner at the F's own angle. Forge's own mark has them
 * teal to violet; each menu item's icon has them in its mode's colour.
 *
 * The colours are the dark palette's (`DARK` in shell/theme.ts, held equal by
 * a test). Not imported: theme.ts brings chalk, which fixes its colour level
 * the moment it loads, and the menu is set up before the shell applies the
 * user's colour preference.
 */
export const PAINTS: Record<Exclude<MenuPaint, 'forge'>, string> = {
  convert: '#55c7d9',
  compress: '#79c98b',
  edit: '#b39ae8',
  pdf: '#ff6b4a',
}
const TEAL = '#55c7d9'
const VIOLET = '#a68ce0'

/** Every slash leans as the F does, top-right corner to bottom-left: 4 across for 5 down. */
const SLANT = 4 / 5

/** The home band's F: 4 × 5 pixels of `px`, its top-left at `x`, `y`. */
const pixelF = (x: number, y: number, px: number, fill: string) =>
  `<path fill="${fill}" d="M${x} ${y}h${4 * px}v${px}h${-3 * px}v${px}h${2 * px}v${px}h${-2 * px}v${2 * px}h${-px}z"/>`

/**
 * The logo at `size` px, drawn on a 64 × 64 grid. At 20 px and under it has
 * three thicker slashes rather than four, so they stay slashes.
 *
 * The slashes are whole lines cut only by the tile, never by an edge of their
 * own: an edge parallel to them would shave the first one to a sliver. The
 * last sits as far into the corner as still leaves a usable length of it.
 */
export function logoSvg(paint: MenuPaint, size: number): string {
  const small = size <= 20
  const count = small ? 3 : 4
  const gap = small ? 6 : 4.6
  const last = small ? 51 : 51.5
  const feet = Array.from({ length: count }, (_, i) => last - (count - 1 - i) * gap)
  const lines = feet.map((x) => `<line x1="${x}" y1="66" x2="${x + 66 * SLANT}" y2="0"/>`).join('')
  const stroke = paint === 'forge' ? 'url(#w)' : PAINTS[paint]
  return `<svg width="${size}" height="${size}" viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="w" gradientUnits="userSpaceOnUse" x1="34" y1="0" x2="62" y2="0"><stop offset="0" stop-color="${TEAL}"/><stop offset="1" stop-color="${VIOLET}"/></linearGradient><clipPath id="c"><rect width="64" height="64" rx="14"/></clipPath><clipPath id="i"><rect x="1.5" y="1.5" width="61" height="61" rx="12.5"/></clipPath></defs><g clip-path="url(#c)"><rect width="64" height="64" fill="#1e1e1e"/><g clip-path="url(#i)" stroke="${stroke}" stroke-width="${small ? 3.6 : 2.4}">${lines}</g>${pixelF(16, 12, 8, '#e7e7e7')}</g><rect x=".75" y=".75" width="62.5" height="62.5" rx="13.5" fill="none" stroke="#3a3a3a" stroke-width="1.5"/></svg>`
}

/** The logo as a PNG of `size` × `size`. */
export function renderIcon(paint: MenuPaint, size: number): Promise<Buffer> {
  return sharp(Buffer.from(logoSvg(paint, size)))
    .png()
    .toBuffer()
}

/**
 * PNGs packed into an .ico, which Windows reads for an Explorer menu icon.
 * PNG-in-ICO has been readable since Vista: a 6-byte header, a 16-byte
 * directory entry per image, then each PNG as it is. A side of 256 is
 * written as 0, because the entry has one byte for it.
 */
export function icoFrom(images: { size: number; png: Buffer }[]): Buffer {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(images.length, 4)
  let offset = 6 + 16 * images.length
  const entries = images.map(({ size, png }) => {
    const e = Buffer.alloc(16)
    e[0] = size >= 256 ? 0 : size
    e[1] = size >= 256 ? 0 : size
    e.writeUInt16LE(1, 4) // colour planes
    e.writeUInt16LE(32, 6) // bits per pixel
    e.writeUInt32LE(png.length, 8)
    e.writeUInt32LE(offset, 12)
    offset += png.length
    return e
  })
  return Buffer.concat([header, ...entries, ...images.map((i) => i.png)])
}
