import { readFile, stat } from 'node:fs/promises'
import type { Sharp } from 'sharp'
import { openable } from '../engines/decoded.js'
import { looksLikeHeic } from '../engines/heic.js'
import { loadSharp } from '../engines/libs.js'
import { sniffRaw } from '../engines/raw.js'

/**
 * Edit's Done (X5) shows the picture, not the bytes. At 80 × 24 a whole
 * photo is about 80 × 40 pixels and a sharpen vanishes in it, so where the
 * terminal cannot draw real images Done draws a close-up at true pixel scale,
 * cut where the result differs most from what you had. This module finds that
 * place and hands back the pixels; drawing them is the shell's job. Data only
 * (invariant 1).
 *
 * The shell draws the grids in half blocks (shell/halfblocks.ts): each
 * cell 1 × 2 dots. A cell is about twice as tall as it is wide, so a dot is not
 * square; a pixel here is one dot tall and `DOT_WIDE` dots wide, which is.
 *
 * Scale, as decided in the mockup (mockups/extensions-2026-10.html, "2 ·
 * Done", sources /tmp/forge-ext-mock2/images3.cjs), kept zoomed in when the
 * dots went to finer cells and back to half blocks (2026-10-12):
 *
 *   - Sharpen (scale 1): one pixel of each file is one pixel here.
 *   - Boost 2×: the original's pixels drawn as 2 × 2 blocks, next to the new
 *     pixels one each.
 *   - Boost 4×: drawn at half, so a whole word fits: the original's pixels as
 *     2 × 2 blocks, the boost shrunk by half. At 1:1 the 4 × 4 blocks held
 *     only part of a letter.
 *   - A cutout (the after has transparency the before did not): the subject
 *     whole with room around it, the photo and the cutout fitted to the same
 *     box, the cutout on a checkerboard.
 *   - Trim edges and Resize (`whole`): both pictures whole. A patch at pixel
 *     scale would show nothing — the pixels are the same ones, fewer or more.
 */

/**
 * Pixels, RGBA, row-major. A close-up's are dots: `width` a multiple of
 * `DOTS_ACROSS`, `height` of `DOTS_DOWN`, one half-block cell each.
 */
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
  /** `patch`: a close-up at pixel scale. `subject`: a cutout, whole. `whole`: both pictures, whole. */
  kind: 'patch' | 'subject' | 'whole'
  /** How many pixels here a side one pixel of the before image covers (patch only). */
  blocksPerPixel: number
  /** The after image's size, for the line above the pictures. */
  output: { width: number; height: number }
}

export interface CloseupOptions {
  /** Columns the grid may use: its width is `DOTS_ACROSS` dots a column. */
  cols: number
  /** Rows the grid may use: its height is `DOTS_DOWN` dots a row. */
  rows: number
  scale: 1 | 2 | 3 | 4
  /** Show both pictures whole (Trim edges, Resize), not where they differ. */
  whole?: boolean
}

/** Dots in a cell: a half block's 1 across, 2 down. */
export const DOTS_ACROSS = 1
export const DOTS_DOWN = 2
/**
 * Dots across one square pixel, a dot tall: a cell is about 1 : 2, so a dot
 * is `1 / DOTS_ACROSS` wide to `2 / DOTS_DOWN` tall.
 */
const DOT_WIDE = (2 * DOTS_ACROSS) / DOTS_DOWN

/** The checkerboard behind transparency, as the mockup draws it (done5.js `CHK2`). */
export const CHECKER: readonly [number, number] = [0x4a, 0x33]

/**
 * The most pixels the difference search reads. Past this, both images are
 * shrunk for the search alone (the close-up is still cut at full scale), so
 * a 48-megapixel 4× result costs what a 4-megapixel one does.
 */
const SEARCH_LIMIT = 4_000_000

interface Opened {
  /** Something sharp opens: the path, or the decoded HEIC's or RAW's bytes. */
  input: string | Buffer
  width: number
  height: number
}

async function openImage(path: string): Promise<Opened> {
  const sharp = await loadSharp()
  let input: string | Buffer = path
  const format = (await looksLikeHeic(path)) ? 'heic' : (await sniffRaw(path)) ? 'raw' : undefined
  if (format) {
    // The decode keeps its orientation as EXIF, so it is turned like any photo.
    const opened = await openable(path, format)
    try {
      input = await readFile(opened.path)
    } finally {
      await opened.cleanup()
    }
  }
  const meta = await sharp(input).metadata()
  // EXIF orientations 5–8 turn the picture a quarter: its upright size is swapped.
  const turned = (meta.orientation ?? 1) >= 5
  const w = meta.width ?? 0
  const h = meta.height ?? 0
  return { input, width: turned ? h : w, height: turned ? w : h }
}

/** An upright pipeline for the image (invariant 4: rotate first). */
async function pipeline(img: Opened): Promise<Sharp> {
  const sharp = await loadSharp()
  return sharp(img.input, { animated: false }).rotate()
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

/** Lays each translucent pixel over a checkerboard of `square` × `squareDown`-pixel squares. */
export function onChecker(grid: PixelGrid, square = 2, squareDown = square): PixelGrid {
  const out = new Uint8Array(grid.rgba)
  for (let y = 0; y < grid.height; y++) {
    for (let x = 0; x < grid.width; x++) {
      const i = (y * grid.width + x) * 4
      const a = (out[i + 3] ?? 255) / 255
      if (a === 1) continue
      const back = CHECKER[(Math.floor(x / square) + Math.floor(y / squareDown)) & 1] ?? 0
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
  // Cleared: opaque before, clear after. A picture clear in places already
  // (an app icon's rounded corners) is still a cutout when more went.
  let cleared = 0
  for (let i = 0; i < w * h; i++) {
    const j = i * 4
    const lum = (g: Uint8Array) =>
      0.2126 * (g[j] ?? 0) + 0.7152 * (g[j + 1] ?? 0) + 0.0722 * (g[j + 2] ?? 0)
    diff[i] = Math.abs(lum(b.rgba) - lum(a.rgba))
    const al = a.rgba[j + 3] ?? 255
    alpha[i] = al
    if (al < 128 && (b.rgba[j + 3] ?? 255) >= 250) cleared++
  }
  return { w, h, s, diff, alpha, cutout: cleared > w * h * 0.005 }
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

/**
 * How wide the box is at least, as a multiple of the subject's width. The
 * mockup framed a person standing in a wide photo — full height, the box's
 * shape gave background either side. A wide subject (a card, a car) framed at
 * its own height fills the box edge to edge, and before and after are the
 * same picture: what was removed is all outside it.
 */
const SUBJECT_ROOM = 1.3

/** A box of aspect `aw:ah` around the subject, its full height, room either side, inside the image. */
function frameSubject(
  sub: CloseupBox,
  s: number,
  W: number,
  H: number,
  aw: number,
  ah: number,
): CloseupBox {
  const sx = { x: sub.x / s, y: sub.y / s, w: sub.w / s, h: sub.h / s }
  let h = Math.min(H, Math.max(sx.h * 1.04, (sx.w * SUBJECT_ROOM * ah) / aw))
  let w = (h * aw) / ah
  if (w > W) {
    w = W
    h = Math.min(H, (w * ah) / aw)
  }
  const x = clamp(sx.x + sx.w / 2 - w / 2, 0, W - w)
  // Centred: for a tall subject (h = 1.04 · its height) that is 2 % above it.
  const y = clamp(sx.y + sx.h / 2 - h / 2, 0, H - h)
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

async function choose(before: string, after: string, scale: 1 | 2 | 3 | 4): Promise<Chosen> {
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

/** Lets go of the cached pair (its decoded HEIC or RAW and search buffers) once Done is left. */
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

/** A checker square on the dots: two cells across, one down, so each cell is one colour. */
const CELL_CHECKER = [2 * DOTS_ACROSS, DOTS_DOWN] as const

/** `n` rounded down to a whole number of `per`, at least one. */
const whole = (n: number, per: number) => Math.max(per, Math.floor(n / per) * per)

/**
 * The close-up for the fallback drawn in characters: the most-changed patch
 * at true pixel scale (or the whole subject of a cutout), as two grids of
 * the same size, at most `cols` × `rows` cells of dots. Translucent pixels
 * are laid on the checkerboard.
 */
export async function findCloseup(
  before: string,
  after: string,
  opts: CloseupOptions,
): Promise<Closeup> {
  const c = await choose(before, after, opts.scale)
  const { k, sr } = c
  const output = { width: c.after.width, height: c.after.height }
  const gw = Math.max(1, opts.cols) * DOTS_ACROSS
  const gh = Math.max(1, opts.rows) * DOTS_DOWN

  if (opts.whole) {
    // The before's shape on screen (square pixels, `DOT_WIDE` dots across),
    // the after fitted inside the same box: a trim shows smaller, on the checks.
    const ratio = (c.before.width / c.before.height) * DOT_WIDE
    const w = whole(Math.min(gw, Math.round(gh * ratio)), DOTS_ACROSS)
    const h = whole(Math.min(gh, Math.round(w / ratio)), DOTS_DOWN)
    const transparent = { r: 0, g: 0, b: 0, alpha: 0 }
    const b = await rgba((await pipeline(c.before)).resize(w, h, { fit: 'fill' }))
    const a = await rgba(
      (await pipeline(c.after)).resize(w, h, { fit: 'contain', background: transparent }),
    )
    return {
      before: onChecker(b),
      after: onChecker(a),
      box: { x: 0, y: 0, w: c.before.width, h: c.before.height },
      kind: 'whole',
      blocksPerPixel: 0,
      output,
    }
  }

  if (sr.cutout) {
    // The box's shape on screen: a cell is about twice as tall as it is wide.
    const box = frameSubject(
      subjectBox(sr),
      sr.s,
      c.before.width,
      c.before.height,
      opts.cols,
      opts.rows * 2,
    )
    const fit = { width: gw, height: gh, fit: 'fill' as const }
    const b = await rgba((await pipeline(c.before)).extract(region(box)).resize(fit))
    const a = await rgba(
      (await pipeline(c.after)).extract(region(inAfter(box, c.before, c.after))).resize(fit),
    )
    return {
      before: onChecker(b, ...CELL_CHECKER),
      after: onChecker(a, ...CELL_CHECKER),
      box,
      kind: 'subject',
      blocksPerPixel: 0,
      output,
    }
  }

  // A pixel here is one dot tall and `DOT_WIDE` wide: square on screen. The
  // patch, in before pixels, is the grid in those pixels over the display
  // factor; drawn on whole cells of dots.
  const box = patchBox(c, Math.floor(gw / DOT_WIDE / k), Math.floor(gh / k))
  const dw = whole(Math.round(box.w * k * DOT_WIDE), DOTS_ACROSS)
  const dh = whole(box.h * k, DOTS_DOWN)
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
    before: onChecker(b, ...CELL_CHECKER),
    after: onChecker(a, ...CELL_CHECKER),
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
  kind: 'patch' | 'subject' | 'whole'
  output: { width: number; height: number }
}

/** `grid` as PNG bytes: what a terminal that draws pictures is sent. */
export async function encodePng(grid: PixelGrid): Promise<Buffer> {
  const sharp = await loadSharp()
  return sharp(Buffer.from(grid.rgba), {
    raw: { width: grid.width, height: grid.height, channels: 4 },
  })
    .png()
    .toBuffer()
}

/** The longest side a real picture is sent at; the terminal scales it into its cells. */
const PICTURE_MAX = 720

/**
 * A terminal cell's width over its height (about 1 : 2 in every macOS
 * terminal's default font). A box `cols` × `rows` cells is
 * `cols · CELL_ASPECT : rows` in shape.
 */
export const CELL_ASPECT = 0.5

/**
 * `grid` centred on a canvas the shape of a `cols` × `rows` box, the rest
 * transparent — the terminal's own background shows there, or the
 * checkerboard once `onChecker` lays it under. Kitty fills the box it is
 * given (`c=`, `r=`) whatever the picture's shape, so a picture sent at
 * another shape would be stretched.
 */
export function padToBox(grid: PixelGrid, cols: number, rows: number): PixelGrid {
  const want = (cols * CELL_ASPECT) / rows
  const wide = grid.width / grid.height > want
  const w = wide ? grid.width : Math.max(grid.width, Math.round(grid.height * want))
  const h = wide ? Math.max(grid.height, Math.round(grid.width / want)) : grid.height
  if (w === grid.width && h === grid.height) return grid
  const out = new Uint8Array(w * h * 4)
  const ox = Math.floor((w - grid.width) / 2)
  const oy = Math.floor((h - grid.height) / 2)
  for (let y = 0; y < grid.height; y++) {
    const from = y * grid.width * 4
    out.set(grid.rgba.subarray(from, from + grid.width * 4), ((y + oy) * w + ox) * 4)
  }
  return { width: w, height: h, rgba: out }
}

/**
 * The real pictures for X5: for a sharpen or a boost, the most-changed patch
 * (about two pixels of the original per cell, cols × 2 by rows × 4, so a
 * line of text reads) from both files at their own resolution; for a
 * cutout, both whole, the cutout on a checkerboard; for a trim or a resize
 * (`whole`), both whole.
 */
export async function closeupPictures(
  before: string,
  after: string,
  opts: CloseupOptions,
): Promise<CloseupPictures> {
  const c = await choose(before, after, opts.scale)
  const output = { width: c.after.width, height: c.after.height }
  const cap = { width: PICTURE_MAX, height: PICTURE_MAX, fit: 'inside' as const }
  const boxed = (g: PixelGrid) => padToBox(g, opts.cols, opts.rows)
  const png = encodePng
  if (c.sr.cutout || opts.whole) {
    const b = await png(boxed(await rgba((await pipeline(c.before)).resize(cap))))
    const a = await png(onChecker(boxed(await rgba((await pipeline(c.after)).resize(cap))), 12))
    return { before: b, after: a, kind: opts.whole ? 'whole' : 'subject', output }
  }
  const box = patchBox(c, opts.cols * 2, opts.rows * 4)
  const b = await png(boxed(await rgba((await pipeline(c.before)).extract(region(box)))))
  const a = await png(
    boxed(
      await rgba(
        (await pipeline(c.after))
          .extract(region(inAfter(box, c.before, c.after)))
          .resize({ ...cap, withoutEnlargement: true }),
      ),
    ),
  )
  return { before: b, after: a, kind: 'patch', output }
}
