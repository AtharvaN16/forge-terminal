#!/usr/bin/env node
/**
 * Builds the read-text payload directory, for every OS where Apple's reader
 * is not: Windows, Linux, and Macs before macOS 26 or on Intel.
 *
 *   node extensions/read-text/build.mjs --platform darwin|win32|linux --arch arm64|x64
 *        --out <dir> [--runner-only]
 *
 * <dir> receives:
 *   runner.mjs                runner.ts and layout.ts bundled (with boost's png.ts);
 *                             onnxruntime-node's JS and onnxruntime-common inlined
 *   onnxruntime_binding.node  from onnxruntime-node's bin/napi-v6/<platform>/<arch>/
 *   libonnxruntime.*.dylib    darwin; onnxruntime.dll win32; libonnxruntime.so.1 linux.
 *                             The CPU provider only: two small models need no GPU.
 *   det.onnx, rec.onnx, dict.txt
 *                             PP-OCRv4 mobile detection (RapidOCR's ONNX export) and
 *                             PP-OCRv5 mobile Latin recognition (monkt's export),
 *                             pinned by sha256 (model.json)
 *   NOTICES.txt               PaddleOCR and RapidOCR (Apache-2.0), ONNX Runtime (MIT)
 *
 * The same onnxruntime-node and bundling as boost (its build.mjs exports the
 * helpers), and the same cache, every download verified every time.
 * --runner-only writes just runner.mjs and the native files (no network), for
 * tests. manifest.json is written by scripts/package-extension.mjs.
 */
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { bindingBesideRunner, ORT_NOTICES, ORT_VERSION, pinned } from '../boost/build.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const model = JSON.parse(readFileSync(join(here, 'model.json'), 'utf8'))
const require = createRequire(import.meta.url)

/** What the CPU provider needs, per platform; nothing else from the directory ships. */
const NATIVE = {
  win32: () => ['onnxruntime_binding.node', 'onnxruntime.dll'],
  linux: () => ['onnxruntime_binding.node', 'libonnxruntime.so.1'],
  // The binding and the one library it links, libonnxruntime.<version>.dylib.
  darwin: (dir) =>
    readdirSync(dir).filter((f) => f === 'onnxruntime_binding.node' || f.endsWith('.dylib')),
}

function parseArgs(argv) {
  const out = { runnerOnly: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--runner-only') out.runnerOnly = true
    else if (a === '--arch' || a === '--out' || a === '--platform') out[a.slice(2)] = argv[++i]
    else throw new Error(`unknown argument: ${a}`)
  }
  if (out.arch !== 'arm64' && out.arch !== 'x64') throw new Error('--arch must be arm64 or x64')
  if (!(out.platform in NATIVE)) throw new Error('--platform must be darwin, win32 or linux')
  if (!out.out) throw new Error('--out <dir> is required')
  return out
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const out = resolve(args.out)
  mkdirSync(out, { recursive: true })
  const ortPkg = require('onnxruntime-node/package.json')
  if (ortPkg.version !== ORT_VERSION)
    throw new Error(`onnxruntime-node ${ortPkg.version} installed; build expects ${ORT_VERSION}`)

  await build({
    entryPoints: [join(here, 'runner.ts')],
    outfile: join(out, 'runner.mjs'),
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node20',
    legalComments: 'none',
    banner: {
      js: "import { createRequire as __forgeRequire } from 'node:module'; const require = __forgeRequire(import.meta.url);",
    },
    plugins: [bindingBesideRunner],
    logLevel: 'warning',
  })

  const nativeDir = join(
    dirname(require.resolve('onnxruntime-node/package.json')),
    'bin',
    'napi-v6',
    args.platform,
    args.arch,
  )
  if (!existsSync(nativeDir))
    throw new Error(`onnxruntime-node ${ORT_VERSION} has no ${args.platform}/${args.arch} binaries`)
  for (const f of NATIVE[args.platform](nativeDir)) copyFileSync(join(nativeDir, f), join(out, f))
  if (args.runnerOnly) return void console.log(out)

  for (const [name, pin] of Object.entries(model.files))
    copyFileSync(await pinned(`read-text-${name}`, pin.url, pin.sha256), join(out, name))
  const text = async (name, { url, sha256 }) =>
    readFileSync(await pinned(name, url, sha256), 'utf8')
  const [paddle, rapid, ortThirdParty] = await Promise.all([
    text('paddleocr-LICENSE', model.licences.paddleocr),
    text('rapidocr-LICENSE', model.licences.rapidocr),
    text(`ort-${ORT_VERSION}-ThirdPartyNotices.txt`, ORT_NOTICES),
  ])
  writeFileSync(join(out, 'NOTICES.txt'), notices(paddle, rapid, ortThirdParty))
  console.log(out)
}

const RULE = '----------------------------------------------------------------------------'

function notices(paddle, rapid, ortThirdParty) {
  return `Forge "Read text" extension — third-party notices

det.onnx is PP-OCRv4's mobile text detector and rec.onnx with dict.txt is
PP-OCRv5's mobile Latin recogniser, by PaddlePaddle
(https://github.com/PaddlePaddle/PaddleOCR), released under the Apache
License 2.0 below. They are redistributed unmodified as exported to ONNX by
RapidOCR (https://huggingface.co/SWHL/RapidOCR, Apache-2.0, licence below)
and by monkt (https://huggingface.co/monkt/paddleocr-onnx, Apache-2.0).
Forge's runner code is original.

${RULE}
PaddleOCR (model weights)
${RULE}

${paddle}

${RULE}
RapidOCR (ONNX export of the detector)
${RULE}

${rapid}

${RULE}
ONNX Runtime ${ORT_VERSION} (onnxruntime-node, onnxruntime-common, the ONNX Runtime library)
https://github.com/microsoft/onnxruntime
${RULE}

MIT License

Copyright (c) Microsoft Corporation

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

${RULE}
ONNX Runtime third-party notices (ThirdPartyNotices.txt, v${ORT_VERSION})
${RULE}

${ortThirdParty}`
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err)
    process.exit(1)
  })
}
