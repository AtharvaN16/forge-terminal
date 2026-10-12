/**
 * HEIC — the extension's child-process entry (Windows only; macOS uses sips).
 *
 *   node runner.mjs --info --in <file.heic>
 *   node runner.mjs --in <file.heic> --out <file.rgba>
 *
 * Decodes with libheif-js's WASM build (libheif + libde265, LGPL-3.0), which
 * ships beside this file as libheif.cjs + libheif.wasm (LGPL: replaceable,
 * never bundled). It runs as a child rather than in Forge's
 * process so the WASM heap, which only grows, is released when it exits.
 *
 * Contract (shared with Forge's src/extensions/run.ts, as boost's runner):
 * exactly one JSON line on stdout — `{"ok":true,"width","height","ms"}` (plus
 * `"hasAlpha"` for --info) with exit 0, or `{"ok":false,"code","message"}`
 * with exit 1. stderr is free-form. --out receives raw interleaved RGBA,
 * width × height × 4 bytes, rows top to bottom with no padding.
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

/** The slice of libheif-js's JavaScript API used here; the package ships no types for it. */
interface HeifImage {
  get_width(): number
  get_height(): number
  is_primary(): boolean
  has_alpha_channel(): boolean
  display(
    target: { data: Uint8ClampedArray; width: number; height: number },
    done: (result: { data: Uint8ClampedArray } | null) => void,
  ): void
}
interface LibHeif {
  HeifDecoder: new () => { decode(data: Uint8Array): HeifImage[] }
}

// Loaded from beside runner.mjs at run time; createRequire keeps esbuild from
// bundling it. The glue would find the .wasm itself through __dirname, but
// passing the bytes makes instantiation synchronous, as libheif-js's wasm.js does.
const libheif: LibHeif = createRequire(import.meta.url)('./libheif.cjs')({
  wasmBinary: readFileSync(fileURLToPath(new URL('./libheif.wasm', import.meta.url))),
})

// libheif-js reports its failures with console.log, which would land on
// stdout beside the result line. They are diagnostics, so they go to stderr;
// the failure itself is reported below as JSON.
console.log = (...parts: unknown[]) => {
  process.stderr.write(`${parts.map(String).join(' ')}\n`)
}

class RunnerError extends Error {}

function reply(line: Record<string, unknown>, exitCode: number): void {
  process.stdout.write(`${JSON.stringify(line)}\n`)
  process.exitCode = exitCode
}

const USAGE = 'usage: runner.mjs --info --in <file.heic> | --in <file.heic> --out <file.rgba>'

interface Args {
  info: boolean
  input: string
  output?: string
}

function parseArgs(argv: string[]): Args {
  const v: Record<string, string> = {}
  let info = false
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i]
    if (k === '--info') {
      info = true
      continue
    }
    const val = argv[i + 1]
    if (!k?.startsWith('--') || val === undefined) throw new RunnerError(USAGE)
    v[k.slice(2)] = val
    i++
  }
  if (!v.in || (!info && !v.out)) throw new RunnerError(USAGE)
  return { info, input: v.in, output: v.out }
}

/** The primary image: a HEIC can hold several (bursts, depth maps); the primary is the photo. */
function primaryImage(path: string): HeifImage {
  const images = new libheif.HeifDecoder().decode(readFileSync(path))
  const image = images.find((i) => i.is_primary()) ?? images[0]
  if (image === undefined) throw new RunnerError('not a readable HEIC file')
  return image
}

/**
 * Decodes to RGBA. libheif applies the container's `irot`/`imir` transforms
 * during decode (its default decoding options), so these pixels are already
 * upright and Forge's `.rotate()` on the PNG made from them is a no-op.
 */
function decodeRgba(
  image: HeifImage,
): Promise<{ width: number; height: number; data: Uint8Array }> {
  const width = image.get_width()
  const height = image.get_height()
  return new Promise((resolve, reject) => {
    image.display({ data: new Uint8ClampedArray(width * height * 4), width, height }, (out) => {
      if (!out) return reject(new RunnerError('the HEIC image could not be decoded'))
      resolve({ width, height, data: new Uint8Array(out.data.buffer) })
    })
  })
}

async function main(): Promise<void> {
  const t0 = performance.now()
  try {
    const args = parseArgs(process.argv.slice(2))
    const image = primaryImage(args.input)
    if (args.info) {
      // Read from the image handle, without decoding pixels. If the alpha
      // flag were unavailable, `true` would be the safe answer: flattening an
      // opaque image is a no-op, while skipping it on a transparent one is not.
      const width = image.get_width()
      const height = image.get_height()
      const hasAlpha = image.has_alpha_channel()
      const ms = Math.round(performance.now() - t0)
      return reply({ ok: true, width, height, hasAlpha, ms }, 0)
    }
    const { width, height, data } = await decodeRgba(image)
    writeFileSync(args.output as string, data)
    reply({ ok: true, width, height, ms: Math.round(performance.now() - t0) }, 0)
  } catch (err) {
    if (err instanceof RunnerError)
      return reply({ ok: false, code: 'runtime-error', message: err.message }, 1)
    process.stderr.write(`${(err as Error)?.stack ?? err}\n`)
    reply({ ok: false, code: 'runtime-error', message: String((err as Error)?.message ?? err) }, 1)
  }
}

await main()
