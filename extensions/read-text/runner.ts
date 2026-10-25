/**
 * Read text — the extension's child-process entry, for Windows, Linux and
 * Macs without Apple's reader (spec 2026-10-23-extract-text-design §6).
 *
 *   node runner.mjs --in <png> [--in <png> ...]
 *   node runner.mjs --check
 *
 * Each --in is one page, a PNG Forge already rotated and decoded (a picture,
 * or a PDF's page drawn by pdfium). PP-OCR's detector finds the lines of text,
 * a recogniser reads each, on ONNX Runtime's CPU provider. There is one
 * recogniser for Latin, Chinese and Japanese, and one each for Korean,
 * Cyrillic, Arabic, Devanagari and Thai (the scripts Apple's reader reads):
 * which one reads a page is decided from their own confidence (readCrops), so
 * nothing asks what language it is in, and a page in one script loads two.
 *
 * Contract: the Swift helper's `read`, so Forge cannot tell which reader ran.
 * One `{"event":"page","page","of"}` line as each page starts, then exactly
 * one `{"ok":true,"pages":[…]}` with exit 0, or `{"ok":false,"code","message"}`
 * with exit 1. Each page is `{ blocks: [...] }`, as Vision's document reader
 * gives them: paragraphs, lists and tables, boxes normalised to the page
 * (layout.ts). Forge orders them and picks the headings, as for Vision.
 */

import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { InferenceSession, Tensor } from 'onnxruntime-node'
import { decodePng, PngError } from '../boost/png.js'
import { type Block, blocksOf } from './layout.js'

const DET_MODEL = 'det.onnx'
const REC_MODEL = 'rec.onnx'
const DICT = 'dict.txt'
const MANIFEST = 'recognisers.json'

/** The detector's input is scaled so its longer side is at most this, in steps of 32. */
const DET_MAX_SIDE = 1536
const DET_THRESH = 0.3
const BOX_THRESH = 0.5
const UNCLIP = 1.6
const REC_HEIGHT = 48
const REC_MAX_WIDTH = 2400
const MIN_SCORE = 0.5

export interface Line {
  text: string
  score: number
  /** Its slant, radians: the page's tilt, for a line long enough to say. */
  angle: number
  /** The text itself, tight, in the page's pixels: x, y, width, height. */
  box: [number, number, number, number]
}

export interface ReadPage {
  blocks: Block[]
}

/** RGBA, row-major. */
export interface Rgba {
  width: number
  height: number
  data: Uint8Array
}

function reply(line: Record<string, unknown>, exitCode?: number): void {
  process.stdout.write(`${JSON.stringify(line)}\n`)
  if (exitCode !== undefined) process.exitCode = exitCode
}

/** Bilinear sample of channel `c` at (x, y). */
function sample(img: Rgba, x: number, y: number, c: number): number {
  const x0 = Math.max(0, Math.min(img.width - 1, Math.floor(x)))
  const y0 = Math.max(0, Math.min(img.height - 1, Math.floor(y)))
  const x1 = Math.min(img.width - 1, x0 + 1)
  const y1 = Math.min(img.height - 1, y0 + 1)
  const fx = Math.max(0, Math.min(1, x - x0))
  const fy = Math.max(0, Math.min(1, y - y0))
  // Over white, as a viewer shows a transparent picture: dark text on nothing is still text.
  const at = (xx: number, yy: number) => {
    const i = (yy * img.width + xx) * 4
    const a = (img.data[i + 3] as number) / 255
    return (img.data[i + c] as number) * a + 255 * (1 - a)
  }
  const top = at(x0, y0) * (1 - fx) + at(x1, y0) * fx
  const bottom = at(x0, y1) * (1 - fx) + at(x1, y1) * fx
  return top * (1 - fy) + bottom * fy
}

/** Paddle's models were trained on BGR; channel order in the tensor is B, G, R. */
const BGR = [2, 1, 0] as const

/** The detector's input: scaled, padded to multiples of 32, ImageNet-normalised. */
export function detInput(img: Rgba): { data: Float32Array; w: number; h: number; scale: number } {
  const scale = Math.min(1, DET_MAX_SIDE / Math.max(img.width, img.height))
  const w = Math.max(32, Math.round((img.width * scale) / 32) * 32)
  const h = Math.max(32, Math.round((img.height * scale) / 32) * 32)
  const mean = [0.485, 0.456, 0.406]
  const std = [0.229, 0.224, 0.225]
  const data = new Float32Array(3 * w * h)
  const sx = img.width / w
  const sy = img.height / h
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      for (let c = 0; c < 3; c++) {
        const v = sample(img, (x + 0.5) * sx - 0.5, (y + 0.5) * sy - 0.5, BGR[c] as number) / 255
        data[c * w * h + y * w + x] = (v - (mean[c] as number)) / (std[c] as number)
      }
  return { data, w, h, scale }
}

/** A line of text as found: its centre, its length and height along its own slant, and the slant. */
export interface Region {
  cx: number
  cy: number
  w: number
  h: number
  /** Radians, clockwise from the horizontal; within ±45°. */
  angle: number
}

/**
 * The lines of text in a probability map: connected components of the
 * thresholded map (4-neighbour), each kept when its mean probability is high
 * enough. Each is measured along its own slant (the principal axis of its
 * pixels), so a line on a tilted photo is one long thin rectangle, then grown
 * as DB's unclip grows a polygon: by area × ratio / perimeter. In the map's pixels.
 */
export function regions(prob: Float32Array, w: number, h: number): Region[] {
  const seen = new Uint8Array(w * h)
  const out: Region[] = []
  const stack: number[] = []
  const pixels: number[] = []
  for (let start = 0; start < w * h; start++) {
    if (seen[start] || (prob[start] as number) < DET_THRESH) continue
    let sum = 0
    pixels.length = 0
    stack.push(start)
    seen[start] = 1
    while (stack.length > 0) {
      const i = stack.pop() as number
      pixels.push(i)
      const x = i % w
      const y = (i - x) / w
      sum += prob[i] as number
      const next = [
        x > 0 ? i - 1 : -1,
        x < w - 1 ? i + 1 : -1,
        y > 0 ? i - w : -1,
        y < h - 1 ? i + w : -1,
      ]
      for (const j of next)
        if (j >= 0 && !seen[j] && (prob[j] as number) >= DET_THRESH) {
          seen[j] = 1
          stack.push(j)
        }
    }
    const n = pixels.length
    if (n < 6 || sum / n < BOX_THRESH) continue
    let mx = 0
    let my = 0
    for (const i of pixels) {
      mx += i % w
      my += Math.floor(i / w)
    }
    mx /= n
    my /= n
    let cxx = 0
    let cyy = 0
    let cxy = 0
    for (const i of pixels) {
      const dx = (i % w) - mx
      const dy = Math.floor(i / w) - my
      cxx += dx * dx
      cyy += dy * dy
      cxy += dx * dy
    }
    let angle = 0.5 * Math.atan2(2 * cxy, cxx - cyy)
    if (angle > Math.PI / 4) angle -= Math.PI / 2
    if (angle < -Math.PI / 4) angle += Math.PI / 2
    const cos = Math.cos(angle)
    const sin = Math.sin(angle)
    let u0 = Infinity
    let u1 = -Infinity
    let v0 = Infinity
    let v1 = -Infinity
    for (const i of pixels) {
      const dx = (i % w) - mx
      const dy = Math.floor(i / w) - my
      const u = dx * cos + dy * sin
      const v = -dx * sin + dy * cos
      if (u < u0) u0 = u
      if (u > u1) u1 = u
      if (v < v0) v0 = v
      if (v > v1) v1 = v
    }
    const bw = u1 - u0 + 1
    const bh = v1 - v0 + 1
    if (bw < 3 || bh < 3) continue
    const d = (bw * bh * UNCLIP) / (2 * (bw + bh))
    const cu = (u0 + u1) / 2
    const cv = (v0 + v1) / 2
    out.push({
      cx: mx + cu * cos - cv * sin,
      cy: my + cu * sin + cv * cos,
      w: bw + 2 * d,
      h: bh + 2 * d,
      angle,
    })
  }
  return out
}

/** One line's crop for the recogniser, cut along its slant: 48 px high, its length kept in proportion, −1…1. */
export function recCrop(img: Rgba, r: Region): { data: Float32Array; w: number } {
  const w = Math.max(8, Math.min(REC_MAX_WIDTH, Math.ceil((REC_HEIGHT * r.w) / r.h)))
  const data = new Float32Array(3 * REC_HEIGHT * w)
  const cos = Math.cos(r.angle)
  const sin = Math.sin(r.angle)
  const su = r.w / w
  const sv = r.h / REC_HEIGHT
  for (let y = 0; y < REC_HEIGHT; y++)
    for (let x = 0; x < w; x++) {
      const u = (x + 0.5) * su - r.w / 2
      const v = (y + 0.5) * sv - r.h / 2
      const px = r.cx + u * cos - v * sin - 0.5
      const py = r.cy + u * sin + v * cos - 0.5
      for (let c = 0; c < 3; c++)
        data[c * REC_HEIGHT * w + y * w + x] =
          (sample(img, px, py, BGR[c] as number) / 255 - 0.5) / 0.5
    }
  return { data, w }
}

/** CTC's greedy reading: the likeliest class each step, repeats and blanks dropped. */
export function ctcDecode(
  probs: Float32Array,
  steps: number,
  classes: number,
  chars: readonly string[],
): { text: string; score: number } {
  let text = ''
  let last = -1
  let total = 0
  let kept = 0
  for (let t = 0; t < steps; t++) {
    let best = 0
    let p = -Infinity
    for (let k = 0; k < classes; k++) {
      const v = probs[t * classes + k] as number
      if (v > p) {
        p = v
        best = k
      }
    }
    if (best !== 0 && best !== last) {
      text += chars[best] ?? ''
      total += p
      kept++
    }
    last = best
  }
  return { text: text.trim(), score: kept > 0 ? total / kept : 0 }
}

/** One recogniser: a PP-OCR model for a script (or a few), its dictionary, and how its text is read off. */
export interface Recogniser {
  id: string
  /** Index 0 is CTC's blank; the dictionary follows, then a space. */
  chars: string[]
  /** Arabic is read off the way it is drawn, left to right; its text is the reverse of that. */
  reverse: boolean
  /** The model's file, created on first use: a page in one script never loads the others. */
  file: string
  /** Asked about every page, however sure the main recogniser is: it reads this script in lookalikes. */
  probe?: boolean
  session?: InferenceSession
  /** The characters it can write, made on first use. */
  known?: Set<string>
}

export interface Models {
  det: InferenceSession
  /** The first is the main one, tried on every line; the rest are tried when it is unsure. */
  recs: Recogniser[]
  Tensor: typeof Tensor
  create: (file: string) => Promise<InferenceSession>
}

/** The payload's recognisers, in order: `recognisers.json`, or the one rec.onnx an older payload has. */
function manifestOf(dir: string): Array<{
  id: string
  file: string
  dict: string
  reverse?: boolean
  probe?: boolean
}> {
  const path = join(dir, MANIFEST)
  if (!existsSync(path)) return [{ id: 'main', file: REC_MODEL, dict: DICT }]
  return JSON.parse(readFileSync(path, 'utf8')).recognisers
}

export async function loadModels(dir: string): Promise<Models> {
  const ort = await import('onnxruntime-node')
  const opts = {
    executionProviders: ['cpu'],
    graphOptimizationLevel: 'all' as const,
    logSeverityLevel: 3 as const,
  }
  const create = (file: string) => ort.InferenceSession.create(join(dir, file), opts)
  const det = await create(DET_MODEL)
  const recs = manifestOf(dir).map((r): Recogniser => {
    const dict = readFileSync(join(dir, r.dict), 'utf8')
      .split(/\r?\n/)
      .filter((l, i, a) => l !== '' || i < a.length - 1)
    return {
      id: r.id,
      chars: ['', ...dict, ' '],
      reverse: r.reverse === true,
      file: r.file,
      ...(r.probe ? { probe: true } : {}),
    }
  })
  return { det, recs, Tensor: ort.Tensor, create }
}

/**
 * Arabic as the model gives it is in drawn order, so a run of letters, digits
 * or Latin (which read left to right) stays whole while the rest turns over:
 * PaddleOCR's own reversal for its Arabic model.
 */
export function drawnToLogical(text: string): string {
  const parts: string[] = []
  let run = ''
  for (const c of text) {
    if (/[a-zA-Z0-9 :*./%+-]/.test(c)) run += c
    else {
      if (run !== '') parts.push(run)
      parts.push(c)
      run = ''
    }
  }
  if (run !== '') parts.push(run)
  return parts.reverse().join('')
}

/** A line's crop read by one recogniser. */
export async function recognise(
  m: Models,
  rec: Recogniser,
  crop: { data: Float32Array; w: number },
): Promise<{ text: string; score: number }> {
  rec.session ??= await m.create(rec.file)
  const out = await rec.session.run({
    [rec.session.inputNames[0] as string]: new m.Tensor('float32', crop.data, [
      1,
      3,
      REC_HEIGHT,
      crop.w,
    ]),
  })
  const t = out[rec.session.outputNames[0] as string] as Tensor
  const [, steps, classes] = t.dims as number[]
  const read = ctcDecode(t.data as Float32Array, steps as number, classes as number, rec.chars)
  return { text: rec.reverse ? drawnToLogical(read.text) : read.text, score: read.score }
}

/** Whether `text` has a character the recogniser has no letter for (digits aside). */
function cannotWrite(rec: Recogniser, text: string): boolean {
  rec.known ??= new Set(rec.chars)
  for (const c of text) if (!rec.known.has(c) && !/\d/.test(c)) return true
  return false
}

type Crop = { data: Float32Array; w: number }
type Reading = { text: string; score: number; id: string }

/** The lines a page's script is judged from: the widest, which carry the most evidence. */
const SAMPLE = 8
/** The main recogniser this sure of its sample leaves the page as it reads it, bar the lookalike script. */
const GATE = 0.96
/** Another recogniser takes the page when its readings are this much surer than the main one's. */
const MARGIN = 0.02
/** A page's recogniser reading a line this poorly gives it up to whichever recogniser is surest. */
const FALLBACK = 0.7
/** A reading this sure is taken as it is. */
const ACCEPT = 0.93
/** At most this many lines of a page are shown to the other recognisers. */
const ALT_LINES = 60

/**
 * Which recogniser reads each line. Nothing says what script a page is in,
 * and nothing is asked of the user: the recognisers say how sure they are.
 * The page's widest lines are read by the main recogniser first. When it is
 * sure (Latin, Chinese and Japanese all read at 0.99), the page is its own.
 * When it is not, every other recogniser reads the same lines, and the one
 * that is surest on average takes the page. Cyrillic is asked either way,
 * since a recogniser for Latin letters reads it in lookalikes, and sure.
 * Then every line goes to the page's recogniser, and one it is not sure of
 * is shown to the others.
 */
export async function readCrops(
  m: Models,
  crops: readonly Crop[],
): Promise<Array<Reading | undefined>> {
  const [main, ...others] = m.recs as [Recogniser, ...Recogniser[]]
  const seen = new Map<string, Reading>()
  const read = async (i: number, rec: Recogniser): Promise<Reading> => {
    const key = `${i}:${rec.id}`
    let r = seen.get(key)
    if (r === undefined) {
      r = { ...(await recognise(m, rec, crops[i] as Crop)), id: rec.id }
      seen.set(key, r)
    }
    return r
  }
  const sample = crops
    .map((c, i) => ({ i, w: c.w }))
    .sort((a, b) => b.w - a.w)
    .slice(0, SAMPLE)
    .map((x) => x.i)
  const mean = async (rec: Recogniser) => {
    let sum = 0
    for (const i of sample) sum += (await read(i, rec)).score
    return sample.length > 0 ? sum / sample.length : 0
  }
  let page = main
  if (others.length > 0 && sample.length > 0) {
    const mainMean = await mean(main)
    const asked = others.filter((r) => mainMean < GATE || r.probe === true)
    let top = mainMean + MARGIN
    for (const rec of asked) {
      const v = await mean(rec)
      if (v > top) {
        top = v
        page = rec
      }
    }
  }
  const out: Array<Reading | undefined> = []
  for (let i = 0; i < crops.length; i++) out.push(await read(i, page))
  // The lines it is least sure of are shown to the others (a page of fine print has hundreds,
  // and all but a few score under 0.93: the least sure are the ones worth the time).
  const unsure = out
    .map((r, i) => ({ i, score: (r as Reading).score }))
    .filter((x) => x.score < ACCEPT)
    .sort((a, b) => a.score - b.score)
    .slice(0, ALT_LINES)
  for (const { i } of m.recs.length > 1 ? unsure : []) {
    const best = out[i] as Reading
    let alt: Reading | undefined
    for (const rec of m.recs) {
      if (rec === page) continue
      const r = await read(i, rec)
      if (alt === undefined || r.score > alt.score) alt = r
    }
    // Another reading takes the line when it is surer and the page's recogniser could not have
    // written it (it has characters this one has no letter for), or when the page's is poor.
    // Reading a Cyrillic line in Latin lookalikes can be sure of itself; it is not a better reading.
    if (
      alt !== undefined &&
      alt.score > best.score + MARGIN &&
      (best.score < FALLBACK || cannotWrite(page, alt.text))
    )
      out[i] = alt
  }
  return out
}

/** The lines of text on one page, top to bottom, in its pixels. */
export async function readLines(img: Rgba, m: Models): Promise<Line[]> {
  const input = detInput(img)
  const detOut = await m.det.run({
    [m.det.inputNames[0] as string]: new m.Tensor('float32', input.data, [1, 3, input.h, input.w]),
  })
  const prob = detOut[m.det.outputNames[0] as string]?.data as Float32Array
  const fx = img.width / input.w
  const fy = img.height / input.h
  const found: Region[] = []
  for (const f of regions(prob, input.w, input.h)) {
    // Back to the page's pixels. The map is the page scaled nearly evenly, so the slant stands.
    const r: Region = { ...f, cx: f.cx * fx, cy: f.cy * fy, w: f.w * fx, h: f.h * fy }
    if (r.w >= 4 && r.h >= 4) found.push(r)
  }
  const reads = await readCrops(
    m,
    found.map((r) => recCrop(img, r)),
  )
  const lines: Line[] = []
  for (const [i, r] of found.entries()) {
    const read = reads[i]
    if (read === undefined || read.text === '' || read.score < MIN_SCORE) continue
    // Upright, about its centre: the layout reads rows and gaps, which a tilt's corners would blur.
    lines.push({
      text: read.text,
      score: read.score,
      angle: r.angle,
      box: [r.cx - r.w / 2, r.cy - r.h / 2, r.w, r.h],
    })
  }
  return lines.sort((a, b) => a.box[1] - b.box[1] || a.box[0] - b.box[0])
}

/**
 * The page straightened: each line's centre turned back by the page's tilt
 * (the median slant of its long lines) about the page's centre, so a tilted
 * photo's rows and columns line up for the layout as a scan's do.
 */
export function straightened(lines: readonly Line[], width: number, height: number): Line[] {
  const long = lines.filter((l) => l.box[2] > l.box[3] * 3).map((l) => l.angle)
  if (long.length === 0) return [...lines]
  const sorted = [...long].sort((a, b) => a - b)
  const tilt = sorted[Math.floor(sorted.length / 2)] as number
  if (Math.abs(tilt) < 0.002) return [...lines]
  const cos = Math.cos(-tilt)
  const sin = Math.sin(-tilt)
  return lines.map((l) => {
    const dx = l.box[0] + l.box[2] / 2 - width / 2
    const dy = l.box[1] + l.box[3] / 2 - height / 2
    const cx = width / 2 + dx * cos - dy * sin
    const cy = height / 2 + dx * sin + dy * cos
    return { ...l, box: [cx - l.box[2] / 2, cy - l.box[3] / 2, l.box[2], l.box[3]] }
  })
}

/** A page as Forge's `read` contract has it: paragraphs, lists and tables, boxes normalised. */
export function pageOf(lines: readonly Line[], width: number, height: number): ReadPage {
  return { blocks: blocksOf(straightened(lines, width, height), { width, height }) }
}

/**
 * `--check`: every model in the payload loads and answers (for CI, which runs
 * the packed archive on each OS). One `{"ok":true,"recognisers":[…]}` line.
 */
async function check(dir: string): Promise<void> {
  const models = await loadModels(dir)
  const blank = { data: new Float32Array(3 * REC_HEIGHT * 160).fill(1), w: 160 }
  for (const rec of models.recs) await recognise(models, rec, blank)
  reply({ ok: true, recognisers: models.recs.map((r) => r.id) }, 0)
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  if (argv.length === 1 && argv[0] === '--check')
    return check(dirname(fileURLToPath(import.meta.url)))
  const inputs: string[] = []
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--in' && argv[i + 1] !== undefined) inputs.push(argv[++i] as string)
    else return reply({ ok: false, code: 'usage', message: `unknown argument: ${argv[i]}` }, 64)
  }
  if (inputs.length === 0) return reply({ ok: false, code: 'usage', message: 'no --in given' }, 64)
  const here = dirname(fileURLToPath(import.meta.url))
  const models = await loadModels(here)
  const pages: ReadPage[] = []
  for (const [i, path] of inputs.entries()) {
    reply({ event: 'page', page: i + 1, of: inputs.length })
    const png = decodePng(path)
    const img: Rgba = { width: png.width, height: png.height, data: png.rgba }
    pages.push(pageOf(await readLines(img, models), png.width, png.height))
  }
  reply({ ok: true, pages }, 0)
}

/** Run as the entry, not imported (tests): compared as real paths, since /tmp is a link on a Mac. */
function isEntry(): boolean {
  const argv1 = process.argv[1]
  if (!argv1) return false
  try {
    return realpathSync(argv1) === realpathSync(fileURLToPath(import.meta.url))
  } catch {
    return false
  }
}

if (isEntry()) {
  main().catch((e: unknown) => {
    const unreadable = e instanceof PngError
    reply(
      {
        ok: false,
        code: unreadable ? 'unreadable' : 'runtime-error',
        message: String((e as Error)?.message ?? e),
      },
      1,
    )
  })
}
