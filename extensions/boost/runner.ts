/**
 * Boost resolution — the extension's child-process entry.
 *
 *   node runner.mjs --in <png> --out <png> --scale 1|2|3|4 [--cache <dir>]
 *
 * Runs realesr-general-x4v3 (4×) over the image in 256 px tiles with 16 px of
 * overlap. What runs the model is an engine (engine.ts): ONNX Runtime on
 * Windows and the Macs (DirectML, CoreML, WebGPU on Intel Macs, the CPU last:
 * engine-ort.ts, providers.ts), ncnn on Linux (engine-ncnn.ts), on a graphics
 * card if there is a real one. Where the CPU is all a missing graphics card
 * leaves (Intel Macs, Linux), a run projected to take longer than the plan's
 * limit stops with `boost-too-slow`. 2× and 3× are the 4× tile brought down by Lanczos,
 * tile by tile; 1× (Sharpen) is the 4× tile brought down by a quarter the same way,
 * so the image keeps its size and memory stays bound by the tile. Alpha never
 * goes through the model: it is resized with Lanczos (kept as is at 1×) and
 * re-joined. The output is written one band of tiles at a time, so memory
 * does not grow with the image beyond the decoded input.
 *
 * Two switches for diagnosis, read from the environment: FORGE_BOOST_DEVICE=cpu
 * keeps the ncnn engine off the graphics card, and FORGE_BOOST_ENGINE=ncnn runs
 * it on a platform other than Linux (a Mac, to test it).
 *
 * Contract (shared with Forge's src/extensions/run.ts): exactly one JSON line
 * on stdout — `{"ok":true,"width","height","ms"}` with exit 0, or
 * `{"ok":false,"code","message"}` with exit 1 (`boost-too-slow` adds `seconds`,
 * the projected total). stderr is free-form. The input
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
import { MODEL_SCALE, TILE, TILE_OUT, type TileEngine } from './engine.js'
import { Resampler } from './lanczos.js'
import { decodePng, PngError, PngWriter, readPngHeader } from './png.js'
import { judge, providerPlan, tileCount } from './providers.js'

const MODEL_FILE = 'realesr-general-x4v3.onnx'
const OVERLAP = 16
/** How many tiles a pipelined engine works on in front of the one being brought to size. */
const AHEAD = 3
const STEP = TILE - 2 * OVERLAP
const MAX_SIDE = 16_384
const MAX_PIXELS = 100_000_000

type Code = 'boost-too-large' | 'boost-too-slow' | 'runtime-error'

class RunnerError extends Error {
  constructor(
    readonly code: Code,
    message: string,
    /** For `boost-too-slow`: the projected total, in seconds. */
    readonly seconds?: number,
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

/** What has to be beside runner.mjs for the engine this platform uses. */
const PAYLOAD_FILES: Record<'ort' | 'ncnn', readonly string[]> = {
  ort: [MODEL_FILE],
  ncnn: ['forge-ncnn', 'realesr-general-x4v3.param', 'realesr-general-x4v3.bin'],
}

async function boost(args: Args): Promise<{ width: number; height: number }> {
  const head = readPngHeader(args.input)
  checkSize(head.width, head.height, args.scale)

  const img = decodePng(args.input)
  const { width: W, height: H, rgba } = img
  const S = args.scale
  const OW = W * S
  const OH = H * S

  // FORGE_BOOST_ENGINE=ncnn runs the Linux engine on another OS (for testing the ncnn path on a Mac).
  const plan = providerPlan(
    process.env.FORGE_BOOST_ENGINE === 'ncnn' ? 'linux' : process.platform,
    process.arch,
  )
  for (const file of PAYLOAD_FILES[plan.engine]) {
    const path = fileURLToPath(new URL(`./${file}`, import.meta.url))
    if (!existsSync(path)) throw new RunnerError('runtime-error', `model file missing: ${path}`)
  }
  const total = tileCount(W, H, STEP)
  // The engine's module is imported by name here so that each platform's runner.mjs carries one only (build.mjs).
  const engine: TileEngine =
    plan.engine === 'ncnn'
      ? await (await import('./engine-ncnn.js')).openEngine(total)
      : await (await import('./engine-ort.js')).openEngine(
          fileURLToPath(new URL(`./${MODEL_FILE}`, import.meta.url)),
          plan.providers,
        )

  const down = S === MODEL_SCALE ? undefined : new Resampler(TILE_OUT, TILE_OUT, TILE * S, TILE * S)
  const alpha = img.hasAlpha ? alphaPlane(rgba, W, H) : undefined
  const alphaUp = alpha && S !== 1 ? new Resampler(W, H, OW, OH) : undefined
  const ch = img.hasAlpha ? 4 : 3
  const writer = new PngWriter(args.output, OW, OH, img.hasAlpha)
  // Only where the processor is what a missing graphics card leaves: how long each tile took.
  const tileMs: number[] = []

  const tiles: Array<[number, number]> = []
  for (let cy = 0; cy < H; cy += STEP) for (let cx = 0; cx < W; cx += STEP) tiles.push([cx, cy])

  /** The edge-clamped 256 px tile whose core (minus the overlap) starts at (cx, cy). */
  const cut = (cx: number, cy: number): Uint8Array => {
    const tile = new Uint8Array(TILE * TILE * 3)
    let di = 0
    for (let y = 0; y < TILE; y++) {
      const sy = Math.min(H - 1, Math.max(0, cy - OVERLAP + y))
      for (let x = 0; x < TILE; x++) {
        const sx = Math.min(W - 1, Math.max(0, cx - OVERLAP + x))
        const si = (sy * W + sx) * 4
        tile[di++] = rgba[si] ?? 0
        tile[di++] = rgba[si + 1] ?? 0
        tile[di++] = rgba[si + 2] ?? 0
      }
    }
    return tile
  }
  // Tiles sent to the engine and not yet taken back, in order. A pipelined engine
  // is kept AHEAD tiles in front of the one being brought to size.
  const inflight: Array<Promise<Float32Array>> = []
  let sent = 0
  const send = (): void => {
    const room = engine.pipelined ? AHEAD : 1
    while (sent < tiles.length && inflight.length < room) {
      const [cx, cy] = tiles[sent++] as [number, number]
      inflight.push(engine.run(cut(cx, cy)))
    }
  }
  let writing: Promise<void> = Promise.resolve()
  try {
    let band = new Uint8Array(0)
    let lastDone = performance.now()
    progress(0, total)
    for (let i = 0; i < tiles.length; i++) {
      const [cx, cy] = tiles[i] as [number, number]
      const bh = Math.min(STEP, H - cy)
      const bw = Math.min(STEP, W - cx)
      if (cx === 0) band = new Uint8Array(OW * bh * S * ch)
      send()
      const out = await (inflight.shift() as Promise<Float32Array>)

      // Bring the whole tile to the target scale, then keep its core: the
      // overlap gives Lanczos real neighbours at the seams.
      const TS = TILE * S
      const planes: Float32Array[] = []
      for (let c = 0; c < 3; c++) {
        const plane = out.subarray(c * TILE_OUT * TILE_OUT, (c + 1) * TILE_OUT * TILE_OUT)
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
      if (plan.guarded && tileMs.length < 2) {
        // The whole of this tile's turn, less what the engine spent checking itself.
        const now = performance.now()
        tileMs.push(now - lastDone - (engine.takeOverheadMs?.() ?? 0))
        const verdict = judge(tileMs, total, plan.limitMs)
        if (verdict.slow) {
          const seconds = Math.round(verdict.projectedMs / 1000)
          throw new RunnerError(
            'boost-too-slow',
            `Boost would take about ${minutes(seconds)} on this computer.`,
            seconds,
          )
        }
      }
      lastDone = performance.now()
      progress(i + 1, total)

      if (cx + STEP >= W) {
        if (alpha) {
          const a = alphaUp
            ? alphaUp.rows(alpha, cy * S, (cy + bh) * S)
            : alpha.subarray(cy * W, (cy + bh) * W)
          for (let k = 0; k < OW * bh * S; k++) {
            const v = Math.round(a[k] ?? 0)
            band[k * 4 + 3] = v < 0 ? 0 : v > 255 ? 255 : v
          }
        }
        // Filtering and compressing the band goes on while the next tiles are made; one at a time.
        await writing
        writing = writer.writeRows(band)
      }
    }
    await writing
    await writer.close()
  } finally {
    for (const p of inflight) p.catch(() => {})
    writing.catch(() => {})
    await engine.close()
  }
  return { width: OW, height: OH }
}

/** "3 minutes", for a log line or an error message. */
function minutes(seconds: number): string {
  const m = Math.max(1, Math.round(seconds / 60))
  return m === 1 ? '1 minute' : `${m} minutes`
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
      return reply(
        {
          ok: false,
          code: err.code,
          message: err.message,
          ...(err.seconds === undefined ? {} : { seconds: err.seconds }),
        },
        1,
      )
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
