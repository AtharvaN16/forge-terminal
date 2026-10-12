import { readFile, stat } from 'node:fs/promises'
import type { Sharp } from 'sharp'
import { decodeHeic, looksLikeHeic } from '../engines/heic.js'
import { loadSharp } from '../engines/libs.js'

/**
 * Enhance's Done (X5) shows the picture, not the bytes. At 80 × 24 a whole
 * photo is about 80 × 40 pixels and a sharpen vanishes in it, so where the
 * terminal cannot draw real images Done draws a close-up at true pixel scale,
 * cut where the result differs most from what you had. This module finds that
 * place and hands back the pixels; drawing them is the shell's job. Data only
 * (invariant 1).
 *
 * Scale, as decided in the mockup (mockups/extensions-2026-10.html, "2 ·
 * Done", sources /tmp/forge-ext-mock2/images3.cjs):
 *
 *   - Sharpen (scale 1): one half-block is one pixel, before and after.
 *   - Boost 2×: the original's pixels drawn as 2 × 2 blocks, next to the new
 *     pixels one half-block each.
 *   - Boost 4×: drawn at half, so a whole word fits: the original's pixels as
 *     2 × 2 blocks, the boost shrunk by half. At 1:1 the 4 × 4 blocks held
 *     only part of a letter.
 *   - A cutout (the after has transparency the before did not): the subject
 *     whole, the photo and the cutout fitted to the same box, the cutout on
 *     a checkerboard.
 */

/** Pixels, RGBA, row-major. `height` is even: two pixels per half-block row. */
export interface PixelGrid {
  width: number
  height: number
  rgba: Uint8Array
}

/** A region of the before image, in its own (upright) pixels. */
export interface CloseupBox {
  x: number
  y: number
  w: number
  h: number
}

export interface Closeup {
  before: PixelGrid
  after: PixelGrid
  box: CloseupBox
  /** `patch`: a close-up at pixel scale. `subject`: a cutout, whole. */
  kind: 'patch' | 'subject'
  /** How many half-blocks a side one pixel of the before image covers (patch only). */
  blocksPerPixel: number
  /** The after image's size, for the line above the pictures. */
  output: { width: number; height: number }
}

export interface CloseupOptions {
  /** Columns the grid may use: its width in pixels. */
  cols: number
  /** Rows the grid may use: its height is twice this, in pixels. */
  rows: number
  scale: 1 | 2 | 4
}

/** The checkerboard behind transparency, as the mockup draws it (done5.js `CHK2`). */
export const CHECKER: readonly [number, number] = [0x4a, 0x33]

/**
 * The most pixels the difference search reads. Past this, both images are
 * shrunk for the search alone (the close-up is still cut at full scale), so
 * a 48-megapixel 4× result costs what a 4-megapixel one does.
 */
const SEARCH_LIMIT = 4_000_000

interface Opened {
  /** Something sharp opens: the path, or the decoded HEIC's bytes. */
  input: string | Buffer
  /** Whether EXIF orientation still has to be applied (sips already did for HEIC). */
  rotate: boolean
  width: number
  height: number
}

async function openImage(path: string): Promise<Opened> {
  const sharp = await loadSharp()
  let input: string | Buffer = path
  let rotate = true
  if (await looksLikeHeic(path)) {
    const decoded = await decodeHeic(path)
    try {
      input = await readFile(decoded.path)
    } finally {
      await decoded.cleanup()
    }
    rotate = false
  }
  const meta = await sharp(input).metadata()
  // EXIF orientations 5–8 turn the picture a quarter: its upright size is swapped.
  const turned = rotate && (meta.orientation ?? 1) >= 5
  const w = meta.width ?? 0
  const h = meta.height ?? 0
  return { input, rotate, width: turned ? h : w, height: turned ? w : h }
}

/** An upright pipeline for the image (invariant 4: rotate first). */
async function pipeline(img: Opened): Promise<Sharp> {
  const sharp = await loadSharp()
  const p = sharp(img.input, { animated: false })
  return img.rotate ? p.rotate() : p
}

async function rgba(p: Sharp): Promise<PixelGrid> {
  const { data, info } = await p.ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  return {
    width: info.width,
    height: info.height,
    rgba: new Uint8Array(data.buffer, data.byteOffset, data.length),
  }
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

/** Lays each translucent pixel over a checkerboard of `square`-pixel squares. */
export function onChecker(grid: PixelGrid, square = 2): PixelGrid {
  const out = new Uint8Array(grid.rgba)
  for (let y = 0; y < grid.height; y++) {
    for (let x = 0; x < grid.width; x++) {
      const i = (y * grid.width + x) * 4
      const a = (out[i + 3] ?? 255) / 255
      if (a === 1) continue
      const back = CHECKER[(Math.floor(x / square) + Math.floor(y / square)) & 1] ?? 0
      for (let c = 0; c < 3; c++) out[i + c] = Math.round(back + ((out[i + c] ?? 0) - back) * a)
      out[i + 3] = 255
    }
  }
  return { ...grid, rgba: out }
}

/** Both images at the search's resolution, and the transparency facts. */
interface Search {
  w: number
  h: number
  /** Search pixels per before pixel. */
  s: number
  diff: Float64Array
  /** After's alpha at search resolution. */
  alpha: Uint8Array
  cutout: boolean
}

async function search(before: Opened, after: Opened, k: number): Promise<Search> {
  const s = Math.min(k, Math.sqrt(SEARCH_LIMIT / Math.max(1, before.width * before.height)))
  const w = Math.max(1, Math.round(before.width * s))
  const h = Math.max(1, Math.round(before.height * s))
  // The before as blocks (each pixel s × s) when the search is finer than
  // it; plainly shrunk when coarser.
  const kernel = s > 1 ? 'nearest' : 'lanczos3'
  const b = await rgba((await pipeline(before)).resize(w, h, { fit: 'fill', kernel }))
  const a = await rgba((await pipeline(after)).resize(w, h, { fit: 'fill', kernel: 'lanczos3' }))
  const diff = new Float64Array(w * h)
  const alpha = new Uint8Array(w * h)
  let beforeOpaque = true
  let clear = 0
  for (let i = 0; i < w * h; i++) {
    const j = i * 4
    const lum = (g: Uint8Array) =>
      0.2126 * (g[j] ?? 0) + 0.7152 * (g[j + 1] ?? 0) + 0.0722 * (g[j + 2] ?? 0)
    diff[i] = Math.abs(lum(b.rgba) - lum(a.rgba))
    const al = a.rgba[j + 3] ?? 255
    alpha[i] = al
    if (al < 128) clear++
    if ((b.rgba[j + 3] ?? 255) < 250) beforeOpaque = false
  }
  return { w, h, s, diff, alpha, cutout: beforeOpaque && clear > w * h * 0.005 }
}

/**
 * The window `ww` × `wh` (search pixels) with the most change, nudged up or
 * down so its top and bottom edges fall where little changed: between lines
 * of text, so a line is kept whole rather than cut in half (the mockup's
 * generator searched only where a line was whole).
 */
export function hottest(
  diff: Float64Array,
  w: number,
  h: number,
  ww: number,
  wh: number,
): { x: number; y: number } {
  ww = Math.min(ww, w)
  wh = Math.min(wh, h)
  const W1 = w + 1
  const S = new Float64Array(W1 * (h + 1))
  for (let y = 0; y < h; y++) {
    let row = 0
    for (let x = 0; x < w; x++) {
      row += diff[y * w + x] ?? 0
      S[(y + 1) * W1 + x + 1] = (S[y * W1 + x + 1] ?? 0) + row
    }
  }
  const area = (x: number, y: number, cw: number, ch: number) =>
    (S[(y + ch) * W1 + x + cw] ?? 0) -
    (S[y * W1 + x + cw] ?? 0) -
    (S[(y + ch) * W1 + x] ?? 0) +
    (S[y * W1 + x] ?? 0)
  const step = Math.max(1, Math.round(Math.min(ww, wh) / 16))
  let best = { x: 0, y: 0, sum: -1 }
  for (let y = 0; y + wh <= h; y += step) {
    for (let x = 0; x + ww <= w; x += step) {
      const sum = area(x, y, ww, wh)
      if (sum > best.sum) best = { x, y, sum }
    }
  }
  if (best.sum <= 0) return { x: Math.floor((w - ww) / 2), y: Math.floor((h - wh) / 2) }
  // Keep lines whole: among nearby heights that still hold most of the
  // change, the one whose edge rows changed least.
  const edgeRow = (y: number) => area(best.x, y, ww, 1)
  let pick = { y: best.y, edge: edgeRow(best.y) + edgeRow(best.y + wh - 1), sum: best.sum }
  const reach = Math.floor(wh / 2)
  for (let y = Math.max(0, best.y - reach); y <= Math.min(h - wh, best.y + reach); y++) {
    const sum = area(best.x, y, ww, wh)
    if (sum < best.sum * 0.75) continue
    const edge = edgeRow(y) + edgeRow(y + wh - 1)
    if (edge < pick.edge || (edge === pick.edge && sum > pick.sum)) pick = { y, edge, sum }
  }
  return { x: best.x, y: pick.y }
}

/** The subject's box (alpha ≥ 128), in search pixels. */
function subjectBox(sr: Search): CloseupBox {
  let x0 = sr.w
  let y0 = sr.h
  let x1 = -1
  let y1 = -1
  for (let y = 0; y < sr.h; y++) {
    for (let x = 0; x < sr.w; x++) {
      if ((sr.alpha[y * sr.w + x] ?? 0) < 128) continue
      x0 = Math.min(x0, x)
      y0 = Math.min(y0, y)
      x1 = Math.max(x1, x)
      y1 = Math.max(y1, y)
    }
  }
  if (x1 < 0) return { x: 0, y: 0, w: sr.w, h: sr.h }
  return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 }
}

/** A box of aspect `aw:ah` around the subject, its full height, inside the image. */
function frameSubject(
  sub: CloseupBox,
  s: number,
  W: number,
  H: number,
  aw: number,
  ah: number,
): CloseupBox {
  const sx = { x: sub.x / s, y: sub.y / s, w: sub.w / s, h: sub.h / s }
  let h = Math.min(H, sx.h * 1.04)
  let w = (h * aw) / ah
  if (w > W) {
    w = W
    h = Math.min(H, (w * ah) / aw)
  }
  const x = clamp(sx.x + sx.w / 2 - w / 2, 0, W - w)
  const y = clamp(sx.y - sx.h * 0.02, 0, H - h)
  return {
    x: Math.round(x),
    y: Math.round(y),
    w: Math.max(1, Math.round(w)),
    h: Math.max(1, Math.round(h)),
  }
}

/** `box` (before pixels) in the after image's pixels. */
function inAfter(box: CloseupBox, before: Opened, after: Opened): CloseupBox {
  const rx = after.width / before.width
  const ry = after.height / before.height
  const x = clamp(Math.round(box.x * rx), 0, after.width - 1)
  const y = clamp(Math.round(box.y * ry), 0, after.height - 1)
  return {
    x,
    y,
    w: clamp(Math.round(box.w * rx), 1, after.width - x),
    h: clamp(Math.round(box.h * ry), 1, after.height - y),
  }
}

const region = (b: CloseupBox) => ({ left: b.x, top: b.y, width: b.w, height: b.h })

interface Chosen {
  before: Opened
  after: Opened
  sr: Search
  /** Display pixels per before pixel: 1 for scale 1, 2 for a boost. */
  k: number
}

/**
 * The last pair opened and searched. Decoding both files and the difference
 * search are the expensive part; a resize only re-cuts the box, so it reuses
 * them. Keyed on each file's path, size and mtime, so a file written again
 * under the same name is searched again.
 */
let last: { key: string; chosen: Promise<Chosen> } | undefined

async function choose(before: string, after: string, scale: 1 | 2 | 4): Promise<Chosen> {
  const k = scale === 1 ? 1 : 2
  const [sb, sa] = await Promise.all([stat(before), stat(after)])
  const key = [before, sb.size, sb.mtimeMs, after, sa.size, sa.mtimeMs, k].join('\0')
  if (last?.key !== key) {
    const chosen = (async (): Promise<Chosen> => {
      const [b, a] = [await openImage(before), await openImage(after)]
      return { before: b, after: a, sr: await search(b, a, k), k }
    })()
    last = { key, chosen }
    // A failure is not kept: the next call tries again.
    chosen.catch(() => {
      if (last?.chosen === chosen) last = undefined
    })
  }
  return last.chosen
}

/** Lets go of the cached pair (its decoded HEIC and search buffers) once Done is left. */
export function forgetCloseup(): void {
  last = undefined
}

/** A patch box (before pixels) of `bw` × `bh` centred on the most change. */
function patchBox(c: Chosen, bw: number, bh: number): CloseupBox {
  const { sr, before } = c
  bw = Math.max(1, Math.min(bw, before.width))
  bh = Math.max(1, Math.min(bh, before.height))
  const at = hottest(
    sr.diff,
    sr.w,
    sr.h,
    Math.max(1, Math.round(bw * sr.s)),
    Math.max(1, Math.round(bh * sr.s)),
  )
  return {
    x: clamp(Math.round(at.x / sr.s), 0, before.width - bw),
    y: clamp(Math.round(at.y / sr.s), 0, before.height - bh),
    w: bw,
    h: bh,
  }
}

/**
 * The close-up for the half-block fallback: the most-changed patch at true
 * pixel scale (or the whole subject of a cutout), as two grids of the same
 * size, at most `cols` × `2 · rows` pixels. Translucent pixels are laid on
 * the checkerboard.
 */
export async function findCloseup(
  before: string,
  after: string,
  opts: CloseupOptions,
): Promise<Closeup> {
  const c = await choose(before, after, opts.scale)
  const { k, sr } = c
  const output = { width: c.after.width, height: c.after.height }
  const gw = Math.max(1, opts.cols)
  const gh = Math.max(2, opts.rows * 2)

  if (sr.cutout) {
    const box = frameSubject(subjectBox(sr), sr.s, c.before.width, c.before.height, gw, gh)
    const fit = { width: gw, height: gh, fit: 'fill' as const }
    const b = await rgba((await pipeline(c.before)).extract(region(box)).resize(fit))
    const a = await rgba(
      (await pipeline(c.after)).extract(region(inAfter(box, c.before, c.after))).resize(fit),
    )
    return {
      before: onChecker(b),
      after: onChecker(a),
      box,
      kind: 'subject',
      blocksPerPixel: 0,
      output,
    }
  }

  // The patch, in before pixels: the grid divided by the display factor,
  // even-height in display pixels so it fills whole half-block rows.
  const box = patchBox(c, Math.floor(gw / k), Math.floor(gh / k))
  const dw = box.w * k
  const dh = box.h * k - ((box.h * k) % 2)
  const b = await rgba(
    (await pipeline(c.before))
      .extract(region(box))
      .resize(dw, dh, { fit: 'fill', kernel: k > 1 ? 'nearest' : 'lanczos3' }),
  )
  const a = await rgba(
    (await pipeline(c.after))
      .extract(region(inAfter(box, c.before, c.after)))
      .resize(dw, dh, { fit: 'fill', kernel: 'lanczos3' }),
  )
  return {
    before: onChecker(b),
    after: onChecker(a),
    box,
    kind: 'patch',
    blocksPerPixel: k,
    output,
  }
}

/** The real pictures for a terminal that draws images, as PNG. */
export interface CloseupPictures {
  before: Buffer
  after: Buffer
  kind: 'patch' | 'subject'
  output: { width: number; height: number }
}

/** The longest side a real picture is sent at; the terminal scales it into its cells. */
const PICTURE_MAX = 720

/**
 * The real pictures for X5: for a sharpen or a boost, the most-changed patch
 * (about two pixels of the original per cell, cols × 2 by rows × 4, so a
 * line of text reads) from both files at their own resolution; for a
 * cutout, both whole, the cutout on a checkerboard.
 */
export async function closeupPictures(
  before: string,
  after: string,
  opts: CloseupOptions,
): Promise<CloseupPictures> {
  const sharp = await loadSharp()
  const c = await choose(before, after, opts.scale)
  const output = { width: c.after.width, height: c.after.height }
  const cap = { width: PICTURE_MAX, height: PICTURE_MAX, fit: 'inside' as const }
  if (c.sr.cutout) {
    const b = await (await pipeline(c.before)).resize(cap).png().toBuffer()
    const grid = onChecker(await rgba((await pipeline(c.after)).resize(cap)), 12)
    const a = await sharp(Buffer.from(grid.rgba), {
      raw: { width: grid.width, height: grid.height, channels: 4 },
    })
      .png()
      .toBuffer()
    return { before: b, after: a, kind: 'subject', output }
  }
  const box = patchBox(c, opts.cols * 2, opts.rows * 4)
  const b = await (await pipeline(c.before)).extract(region(box)).png().toBuffer()
  const a = await (await pipeline(c.after))
    .extract(region(inAfter(box, c.before, c.after)))
    .resize({ ...cap, withoutEnlargement: true })
    .png()
    .toBuffer()
  return { before: b, after: a, kind: 'patch', output }
}
