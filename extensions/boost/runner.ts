/**
 * Boost resolution — the extension's child-process entry.
 *
 *   node runner.mjs --in <png> --out <png> --scale 1|2|3|4 [--cache <dir>]
 *
 * Runs realesr-general-x4v3 (4×) over the image in 256 px tiles with 16 px of
 * overlap, through ONNX Runtime with the CoreML execution provider (CPU if
 * CoreML will not load). 2× and 3× are the 4× tile brought down by Lanczos,
 * tile by tile; 1× (Sharpen) is the 4× tile brought down by a quarter the same way,
 * so the image keeps its size and memory stays bound by the tile. Alpha never
 * goes through the model: it is resized with Lanczos (kept as is at 1×) and
 * re-joined. The output is written one band of tiles at a time, so memory
 * does not grow with the image beyond the decoded input.
 *
 * Contract (shared with Forge's src/extensions/run.ts): exactly one JSON line
 * on stdout — `{"ok":true,"width","height","ms"}` with exit 0, or
 * `{"ok":false,"code","message"}` with exit 1. stderr is free-form. The input
 * is a PNG Forge already rotated and decoded, so EXIF is not this file's concern.
 *
 * --cache is accepted for the contract but unused: onnxruntime-node 1.23 only
 * passes `coreMlFlags` to the CoreML EP, so there is no ModelCacheDirectory to
 * point at it. The EP compiles into the per-user temp directory (it ignores
 * TMPDIR) and deletes that on release — about 1 s per run, measured. The only
 * file this runner writes is --out.
 */

import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { InferenceSession, Tensor } from 'onnxruntime-node'
import { Resampler } from './lanczos.js'
import { decodePng, PngError, PngWriter, readPngHeader } from './png.js'

const MODEL_FILE = 'realesr-general-x4v3.onnx'
const MODEL_SCALE = 4
const TILE = 256
const OVERLAP = 16
const STEP = TILE - 2 * OVERLAP
const MAX_SIDE = 16_384
const MAX_PIXELS = 100_000_000

type Code = 'boost-too-large' | 'runtime-error'

class RunnerError extends Error {
  constructor(
    readonly code: Code,
    message: string,
  ) {
    super(message)
  }
}

/**
 * One line a tile, `{"progress":12,"of":48}`, before the result. The count is
 * the grid the loop below walks, so it is known before the first tile runs.
 */
function progress(done: number, of: number): void {
  process.stdout.write(`${JSON.stringify({ progress: done, of })}\n`)
}

function reply(line: Record<string, unknown>, exitCode: number): void {
  process.stdout.write(`${JSON.stringify(line)}\n`)
  process.exitCode = exitCode
}

interface Args {
  input: string
  output: string
  scale: Scale
  cache?: string
}

/** The factors this runner makes: 1× (Sharpen) and 2×–4×, each from the model's 4× tile. */
type Scale = 1 | 2 | 3 | 4
const SCALES: readonly Scale[] = [1, 2, 3, 4]
const USAGE = 'usage: runner.mjs --in <png> --out <png> --scale 1|2|3|4 [--cache <dir>]'

function parseArgs(argv: string[]): Args {
  const v: Record<string, string> = {}
  for (let i = 0; i < argv.length; i += 2) {
    const k = argv[i]
    const val = argv[i + 1]
    if (!k?.startsWith('--') || val === undefined) throw new RunnerError('runtime-error', USAGE)
    v[k.slice(2)] = val
  }
  const scale = SCALES.find((s) => s === Number(v.scale))
  if (!v.in || !v.out || scale === undefined) throw new RunnerError('runtime-error', USAGE)
  return { input: v.in, output: v.out, scale, cache: v.cache }
}

function fits(w: number, h: number, s: number): boolean {
  return w * s <= MAX_SIDE && h * s <= MAX_SIDE && w * s * h * s <= MAX_PIXELS
}

/** Refuses, before any work, an output past 16384 px a side or 100 MP. */
function checkSize(w: number, h: number, scale: number): void {
  if (fits(w, h, scale)) return
  const mp = Math.round((w * scale * h * scale) / 1e6)
  if (scale === 1)
    throw new RunnerError(
      'boost-too-large',
      `${w}×${h} px (${mp} MP) is past the limit of ${MAX_SIDE} px a side and 100 MP.`,
    )
  const smaller = [3, 2].filter((s) => s < scale && fits(w, h, s))
  const tail = smaller.length
    ? `The largest factor that fits is ${smaller[0]}×.`
    : 'No boost factor fits this image.'
  throw new RunnerError(
    'boost-too-large',
    `${scale}× would make ${w * scale}×${h * scale} px (${mp} MP); the limit is ${MAX_SIDE} px a side and 100 MP. ${tail}`,
  )
}

type Ort = typeof import('onnxruntime-node')

async function openModel(ort: Ort, path: string): Promise<InferenceSession> {
  const base = {
    intraOpNumThreads: 2,
    interOpNumThreads: 1,
    graphOptimizationLevel: 'all' as const,
    logSeverityLevel: 3 as const,
  }
  // DirectML on Windows (any DX12 GPU), CoreML on macOS; CPU is always the way out.
  // On Linux ONNX Runtime drops the CoreML request itself ("not available:
  // backend not found", on stderr) and the session runs on the CPU.
  const win = process.platform === 'win32'
  const preferred = win ? (['dml'] as const) : ([{ name: 'coreml', coreMlFlags: 0 }] as const)
  try {
    return await ort.InferenceSession.create(path, {
      ...base,
      executionProviders: [...preferred, 'cpu'],
    })
  } catch (err) {
    process.stderr.write(`${win ? 'DirectML' : 'CoreML'} unavailable, using CPU: ${String(err)}\n`)
    return await ort.InferenceSession.create(path, { ...base, executionProviders: ['cpu'] })
  }
}

async function boost(args: Args): Promise<{ width: number; height: number }> {
  const head = readPngHeader(args.input)
  checkSize(head.width, head.height, args.scale)

  const img = decodePng(args.input)
  const { width: W, height: H, rgba } = img
  const S = args.scale
  const OW = W * S
  const OH = H * S

  const modelPath = fileURLToPath(new URL(`./${MODEL_FILE}`, import.meta.url))
  if (!existsSync(modelPath))
    throw new RunnerError('runtime-error', `model file missing: ${modelPath}`)
  const ort: Ort = await import('onnxruntime-node')
  const session = await openModel(ort, modelPath)
  const inName = session.inputNames[0] ?? 'input'
  const outName = session.outputNames[0] ?? 'output'

  const T4 = TILE * MODEL_SCALE
  const down = S === MODEL_SCALE ? undefined : new Resampler(T4, T4, TILE * S, TILE * S)
  const alpha = img.hasAlpha ? alphaPlane(rgba, W, H) : undefined
  const alphaUp = alpha && S !== 1 ? new Resampler(W, H, OW, OH) : undefined
  const ch = img.hasAlpha ? 4 : 3
  const writer = new PngWriter(args.output, OW, OH, img.hasAlpha)
  const input = new Float32Array(3 * TILE * TILE)
  const n = TILE * TILE

  const tiles = Math.ceil(H / STEP) * Math.ceil(W / STEP)
  let tilesDone = 0
  progress(0, tiles)
  for (let cy = 0; cy < H; cy += STEP) {
    const bh = Math.min(STEP, H - cy)
    const band = new Uint8Array(OW * bh * S * ch)
    for (let cx = 0; cx < W; cx += STEP) {
      const bw = Math.min(STEP, W - cx)
      // Edge-clamped 256 px tile whose core (minus the overlap) is (cx, cy, bw, bh).
      for (let y = 0; y < TILE; y++) {
        const sy = Math.min(H - 1, Math.max(0, cy - OVERLAP + y))
        for (let x = 0; x < TILE; x++) {
          const sx = Math.min(W - 1, Math.max(0, cx - OVERLAP + x))
          const si = (sy * W + sx) * 4
          const di = y * TILE + x
          input[di] = (rgba[si] ?? 0) / 255
          input[n + di] = (rgba[si + 1] ?? 0) / 255
          input[2 * n + di] = (rgba[si + 2] ?? 0) / 255
        }
      }
      const result = await session.run({
        [inName]: new ort.Tensor('float32', input, [1, 3, TILE, TILE]),
      })
      const out = (result[outName] as Tensor).data as Float32Array

      // Bring the whole tile to the target scale, then keep its core: the
      // overlap gives Lanczos real neighbours at the seams.
      const TS = TILE * S
      const planes: Float32Array[] = []
      for (let c = 0; c < 3; c++) {
        const plane = out.subarray(c * T4 * T4, (c + 1) * T4 * T4)
        planes.push(down ? down.rows(plane, OVERLAP * S, (OVERLAP + bh) * S) : plane)
      }
      const rowBase = down ? 0 : OVERLAP * S
      for (let y = 0; y < bh * S; y++) {
        const src = (rowBase + y) * TS + OVERLAP * S
        const dst = (y * OW + cx * S) * ch
        for (let x = 0; x < bw * S; x++) {
          for (let c = 0; c < 3; c++) {
            const v = Math.round(((planes[c] as Float32Array)[src + x] ?? 0) * 255)
            band[dst + x * ch + c] = v < 0 ? 0 : v > 255 ? 255 : v
          }
        }
      }
      progress(++tilesDone, tiles)
    }
    if (alpha) {
      const a = alphaUp
        ? alphaUp.rows(alpha, cy * S, (cy + bh) * S)
        : alpha.subarray(cy * W, (cy + bh) * W)
      for (let i = 0; i < OW * bh * S; i++) {
        const v = Math.round(a[i] ?? 0)
        band[i * 4 + 3] = v < 0 ? 0 : v > 255 ? 255 : v
      }
    }
    await writer.writeRows(band)
  }
  await writer.close()
  await session.release()
  return { width: OW, height: OH }
}

function alphaPlane(rgba: Uint8Array, w: number, h: number): Float32Array {
  const a = new Float32Array(w * h)
  for (let i = 0; i < a.length; i++) a[i] = rgba[i * 4 + 3] ?? 255
  return a
}

async function main(): Promise<void> {
  const t0 = performance.now()
  try {
    const args = parseArgs(process.argv.slice(2))
    const { width, height } = await boost(args)
    reply({ ok: true, width, height, ms: Math.round(performance.now() - t0) }, 0)
  } catch (err) {
    if (err instanceof RunnerError)
      return reply({ ok: false, code: err.code, message: err.message }, 1)
    if (err instanceof PngError)
      return reply(
        {
          ok: false,
          code: 'runtime-error',
          message: `input is not a readable PNG: ${err.message}`,
        },
        1,
      )
    process.stderr.write(`${(err as Error)?.stack ?? err}\n`)
    reply({ ok: false, code: 'runtime-error', message: String((err as Error)?.message ?? err) }, 1)
  }
}

await main()
