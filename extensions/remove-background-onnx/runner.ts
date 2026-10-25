/**
 * Remove background on Windows and Linux — the extension's child-process entry.
 *
 *   node runner.mjs <in.png> <out.png>
 *
 * The same arguments and replies as the macOS helper (forge-cutout, Apple
 * Vision), so Forge runs either the same way. BiRefNet-lite (54 MB, int8, made
 * for 768 × 768) finds the subject on a 768 × 768 copy of the image through
 * ONNX Runtime's CPU provider, about a second or two on a laptop and about
 * 2 GB at its peak. Its scores go through a sigmoid and are brought back to
 * the image's size (bilinear) as its alpha, multiplied into any alpha the
 * image already had. The RGB is the input's, untouched.
 *
 * ONNX Runtime here is onnxruntime-node-rmbg, an npm alias of
 * onnxruntime-node 1.25.1: the model's deformable convolutions are ONNX's
 * own `DeformConv`, which the CPU provider only has from 1.25.1 (Forge's
 * other extensions stay on 1.23.2).
 *
 * Contract (shared with Forge's src/extensions/run.ts): exactly one JSON line
 * on stdout — `{"ok":true,"width","height","ms"}` with exit 0, or
 * `{"ok":false,"code","message"}` with a non-zero exit: `no-subject` (2) when
 * the model finds nothing (mask.ts `judge`), `runtime-error` (1) otherwise.
 * stderr is free-form. The input is a PNG Forge already rotated and decoded,
 * so EXIF is not this file's concern. The only file it writes is <out.png>,
 * and not at all when there is no subject.
 */

import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { Tensor } from 'onnxruntime-node-rmbg'
import { decodePng, PngError, PngWriter } from '../boost/png.js'
import { judge, MaskScaler, modelInput, SIZE, sigmoid } from './mask.js'

const MODEL_FILE = 'birefnet-lite-768-int8.onnx'
const BAND = 64
const USAGE = 'usage: runner.mjs <in.png> <out.png>'

type Code = 'no-subject' | 'runtime-error'

class RunnerError extends Error {
  constructor(
    readonly code: Code,
    message: string,
  ) {
    super(message)
  }
}

function reply(line: Record<string, unknown>, exitCode: number): void {
  process.stdout.write(`${JSON.stringify(line)}\n`)
  process.exitCode = exitCode
}

async function cutout(input: string, output: string): Promise<{ width: number; height: number }> {
  const t0 = performance.now()
  const img = decodePng(input)
  const { width: W, height: H, rgba } = img

  const modelPath = fileURLToPath(new URL(`./${MODEL_FILE}`, import.meta.url))
  if (!existsSync(modelPath))
    throw new RunnerError('runtime-error', `model file missing: ${modelPath}`)
  const tDecoded = performance.now()
  const ort = await import('onnxruntime-node-rmbg')
  const session = await ort.InferenceSession.create(modelPath, {
    executionProviders: ['cpu'],
    graphOptimizationLevel: 'all',
    logSeverityLevel: 3,
  })
  const inName = session.inputNames[0] ?? 'input_image'
  const outName = session.outputNames[0] ?? 'output_image'
  const result = await session.run({
    [inName]: new ort.Tensor('float32', modelInput(rgba, W, H), [1, 3, SIZE, SIZE]),
  })
  const mask = sigmoid((result[outName] as Tensor).data as Float32Array)
  await session.release()
  const tModel = performance.now()

  const verdict = judge(mask)
  process.stderr.write(
    `mask peak ${verdict.peak.toFixed(3)}, coverage ${(verdict.coverage * 100).toFixed(1)}%\n`,
  )
  if (!verdict.found) throw new RunnerError('no-subject', 'no foreground subject found')

  const scaler = new MaskScaler(mask, W, H)
  const row = new Float32Array(W)
  const writer = new PngWriter(output, W, H, true)
  for (let y0 = 0; y0 < H; y0 += BAND) {
    const rows = Math.min(BAND, H - y0)
    const band = new Uint8Array(W * rows * 4)
    for (let r = 0; r < rows; r++) {
      scaler.row(y0 + r, row)
      const src = (y0 + r) * W * 4
      const dst = r * W * 4
      for (let x = 0; x < W; x++) {
        const i = x * 4
        band[dst + i] = rgba[src + i] ?? 0
        band[dst + i + 1] = rgba[src + i + 1] ?? 0
        band[dst + i + 2] = rgba[src + i + 2] ?? 0
        const a = Math.round((row[x] ?? 0) * (rgba[src + i + 3] ?? 255))
        band[dst + i + 3] = a < 0 ? 0 : a > 255 ? 255 : a
      }
    }
    await writer.writeRows(band)
  }
  await writer.close()
  const ms = (a: number, b: number) => Math.round(b - a)
  process.stderr.write(
    `decode ${ms(t0, tDecoded)} ms, model ${ms(tDecoded, tModel)} ms, write ${ms(tModel, performance.now())} ms\n`,
  )
  return { width: W, height: H }
}

async function main(): Promise<void> {
  const t0 = performance.now()
  try {
    const args = process.argv.slice(2)
    if (args.length !== 2 || !args[0] || !args[1]) throw new RunnerError('runtime-error', USAGE)
    const { width, height } = await cutout(args[0], args[1])
    reply({ ok: true, width, height, ms: Math.round(performance.now() - t0) }, 0)
  } catch (err) {
    if (err instanceof RunnerError)
      return reply(
        { ok: false, code: err.code, message: err.message },
        err.code === 'no-subject' ? 2 : 1,
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
