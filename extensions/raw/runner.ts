/**
 * Camera RAW — the extension's child-process entry (Windows and Linux; macOS uses sips).
 *
 *   node runner.mjs --info --in <photo>
 *   node runner.mjs --in <photo> --out <file.rgb>
 *
 * Decodes with libraw-wasm's WASM build of LibRaw (LGPL-2.1 or CDDL-1.0),
 * which ships beside this file as libraw.mjs + libraw.wasm (LGPL: replaceable,
 * never bundled). LibRaw knows a file by its bytes, whatever it is called. It
 * runs as a child rather than in Forge's process so the WASM heap, which only
 * grows, is released when it exits.
 *
 * Contract (shared with Forge's src/extensions/run.ts, as heic's runner):
 * exactly one JSON line on stdout — `{"ok":true,"width","height","ms"}` (plus
 * `"hasAlpha":false` for --info) with exit 0, or `{"ok":false,"code","message"}`
 * with exit 1. stderr is free-form. --out receives raw interleaved RGB, 8 bits,
 * width × height × 3 bytes, rows top to bottom with no padding — three
 * channels, not heic's four: a RAW photo has no alpha.
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { type CropBox, makerCrop, type RawSizes, uprightSize } from './crop.js'

/** The slice of libraw-wasm's embind class used here; its own types describe the worker wrapper. */
interface LibRaw {
  open(data: Uint8Array, settings: Record<string, unknown>): void
  metadata(full: boolean): RawSizes
  imageData(): { width: number; height: number; colors: number; bits: number; data: Uint8Array }
}
type Factory = (options: Record<string, unknown>) => Promise<{ LibRaw: new () => LibRaw }>

// Loaded from beside runner.mjs at run time: an import of a computed URL is
// one esbuild leaves alone. The glue is built for browsers and would fetch()
// its .wasm; passing the bytes skips that, and works the same in Node.
const factory: Factory = (await import(new URL('./libraw.mjs', import.meta.url).href)).default
const stderr = (s: string) => {
  process.stderr.write(`${s}\n`)
}
// LibRaw's own messages go to stderr, never beside the result line on stdout.
const libraw = await factory({
  wasmBinary: readFileSync(new URL('./libraw.wasm', import.meta.url)),
  print: stderr,
  printErr: stderr,
})

class RunnerError extends Error {}

function reply(line: Record<string, unknown>, exitCode: number): void {
  process.stdout.write(`${JSON.stringify(line)}\n`)
  process.exitCode = exitCode
}

const USAGE = 'usage: runner.mjs --info --in <photo> | --in <photo> --out <file.rgb>'

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

/**
 * Opens the file. LibRaw throws a C++ exception on a file it cannot read,
 * which reaches JavaScript with no message, so the message is this one.
 */
function open(raw: LibRaw, bytes: Uint8Array, settings: Record<string, unknown>): void {
  try {
    raw.open(bytes, settings)
  } catch {
    throw new RunnerError('not a camera RAW file LibRaw can read')
  }
}

/**
 * The photo as Forge's other decoders give it: the maker's crop, the
 * camera's own white balance, sRGB, 8 bits. LibRaw turns the pixels by the
 * file's own orientation (`flip`, from the RAW's header) as it decodes, so
 * they come out upright and carry no orientation of their own — Forge's
 * `.rotate()` on the PNG made from them is a no-op, as it must be.
 */
function decode(raw: LibRaw, bytes: Uint8Array, box: CropBox | undefined) {
  open(raw, bytes, {
    useCameraWb: true,
    outputColor: 1,
    outputBps: 8,
    userFlip: -1,
    cropbox: box ?? null,
  })
  let image: ReturnType<LibRaw['imageData']>
  try {
    image = raw.imageData()
  } catch {
    throw new RunnerError('the RAW photo could not be decoded')
  }
  const { width, height, colors, bits } = image
  if (bits !== 8 || (colors !== 3 && colors !== 1) || width <= 0 || height <= 0)
    throw new RunnerError(
      `unexpected decode: ${width}×${height}, ${colors} channels of ${bits} bits`,
    )
  const pixels = width * height
  if (image.data.length < pixels * colors) throw new RunnerError('the RAW photo decoded short')
  if (colors === 3) return { width, height, data: image.data.subarray(0, pixels * 3) }
  // A monochrome sensor (a Leica Monochrom): one channel, spread to three.
  const rgb = new Uint8Array(pixels * 3)
  for (let i = 0; i < pixels; i++) rgb.fill(image.data[i] as number, i * 3, i * 3 + 3)
  return { width, height, data: rgb }
}

function main(): void {
  const t0 = performance.now()
  try {
    const args = parseArgs(process.argv.slice(2))
    const bytes = new Uint8Array(readFileSync(args.input))
    const raw = new libraw.LibRaw()
    // A header read: the sizes, the orientation and the maker's crop, no pixels.
    open(raw, bytes, {})
    const sizes = raw.metadata(true)
    const box = makerCrop(sizes)
    if (args.info) {
      const { width, height } = uprightSize(sizes, box)
      const ms = Math.round(performance.now() - t0)
      reply({ ok: true, width, height, hasAlpha: false, ms }, 0)
      return
    }
    const { width, height, data } = decode(raw, bytes, box)
    writeFileSync(args.output as string, data)
    reply({ ok: true, width, height, ms: Math.round(performance.now() - t0) }, 0)
  } catch (err) {
    if (err instanceof RunnerError) {
      reply({ ok: false, code: 'runtime-error', message: err.message }, 1)
      return
    }
    process.stderr.write(`${(err as Error)?.stack ?? err}\n`)
    reply({ ok: false, code: 'runtime-error', message: String((err as Error)?.message ?? err) }, 1)
  }
}

main()
