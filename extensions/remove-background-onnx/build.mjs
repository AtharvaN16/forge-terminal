#!/usr/bin/env node
/**
 * Builds the Windows and Linux remove-background payload directory. macOS
 * has its own helper on Apple Vision (extensions/remove-background/).
 *
 *   node extensions/remove-background-onnx/build.mjs --platform win32|linux --arch arm64|x64
 *        --out <dir> [--onnx <file>] [--runner-only]
 *
 * <dir> receives:
 *   runner.mjs                runner.ts bundled (with boost's png.ts and lanczos.ts);
 *                             onnxruntime-node-rmbg's JS and its onnxruntime-common inlined
 *   onnxruntime_binding.node  from onnxruntime-node-rmbg's bin/napi-v6/<platform>/<arch>/, loaded from beside runner.mjs
 *   onnxruntime.dll           win32. Not DirectML.dll: onnxruntime.dll only delay-loads it
 *                             (with d3d12/dxgi) for the DirectML provider, which this
 *                             CPU-only runner never asks for. Checked in 1.25.1's import tables.
 *   libonnxruntime.so.1       linux: the binding's RUNPATH is $ORIGIN, so it is found beside it
 *   birefnet-lite-768-int8.onnx  BiRefNet-lite at 768 px, compressed to int8 (54 MB), pinned by
 *                             sha256 (model.json); how it is made is in model/README.md
 *   NOTICES.txt               BiRefNet (MIT), Swin Transformer (MIT), ONNX Runtime (MIT) and its
 *                             third-party notices, and a note on the training data
 *
 * ONNX Runtime is onnxruntime-node-rmbg, an npm alias of onnxruntime-node
 * 1.25.1 (package.json): the model uses ONNX's DeformConv, which the CPU
 * provider only has from 1.25.1. Boost and read-text stay on 1.23.2
 * (extensions/boost/build.mjs ORT_VERSION), so their bytes do not move.
 *
 * The same bundling as boost, and the same cache: extensions/boost/.cache/,
 * every download verified by sha256 every time. --onnx uses a local copy of
 * the model (still verified). --runner-only writes just runner.mjs and the
 * native files (no network), for tests. manifest.json is not written here —
 * scripts/package-extension.mjs does that.
 */

import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { pinned } from '../boost/build.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const model = JSON.parse(readFileSync(join(here, 'model.json'), 'utf8'))
const require = createRequire(import.meta.url)

/** The npm alias for onnxruntime-node 1.25.1 (package.json), and what it is checked against. */
const ORT_PACKAGE = 'onnxruntime-node-rmbg'
export const ORT_VERSION = '1.25.1'
const ORT_NOTICES = {
  url: `https://raw.githubusercontent.com/microsoft/onnxruntime/v${ORT_VERSION}/ThirdPartyNotices.txt`,
  sha256: '0e07b95f3a8d6230037707c5c4a2b554d12c4cb67369669ac255635528ffcee2',
}

/**
 * boost's bindingBesideRunner, for the alias: onnxruntime-node loads its
 * binding from ../bin/napi-v6/<platform>/<arch>/; point it beside runner.mjs
 * instead. (boost's matches the folder name onnxruntime-node, not this one.)
 */
const bindingBesideRunner = {
  name: 'ort-rmbg-binding-beside-runner',
  setup(b) {
    b.onResolve({ filter: /onnxruntime_binding\.node$/ }, (args) => ({
      path: args.path,
      external: true,
    }))
    b.onLoad({ filter: /onnxruntime-node-rmbg[\\/]dist[\\/]binding\.js$/ }, (args) => {
      const src = readFileSync(args.path, 'utf8')
      const replaced = src.replace(
        /require\(`\.\.\/bin\/napi-v6\/[^`]*onnxruntime_binding\.node`\)/,
        "require('./onnxruntime_binding.node')",
      )
      if (replaced === src)
        throw new Error(`${ORT_PACKAGE} binding.js changed shape; update build.mjs`)
      return { contents: replaced, loader: 'js' }
    })
  },
}

/** What the CPU provider needs, per platform; nothing else from the directory ships. */
const NATIVE = {
  win32: ['onnxruntime_binding.node', 'onnxruntime.dll'],
  linux: ['onnxruntime_binding.node', 'libonnxruntime.so.1'],
}

function parseArgs(argv) {
  const out = { runnerOnly: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--runner-only') out.runnerOnly = true
    else if (a === '--arch' || a === '--out' || a === '--onnx' || a === '--platform')
      out[a.slice(2)] = argv[++i]
    else throw new Error(`unknown argument: ${a}`)
  }
  if (out.arch !== 'arm64' && out.arch !== 'x64') throw new Error('--arch must be arm64 or x64')
  if (!(out.platform in NATIVE))
    throw new Error('--platform must be win32 or linux (macOS uses extensions/remove-background)')
  if (!out.out) throw new Error('--out <dir> is required')
  return out
}

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex')

async function modelFile(localOnnx) {
  if (localOnnx) {
    if (sha256(readFileSync(localOnnx)) !== model.sha256)
      throw new Error(`--onnx ${localOnnx} does not match model.json sha256`)
    return localOnnx
  }
  return pinned(model.file, model.url, model.sha256)
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const out = resolve(args.out)
  mkdirSync(out, { recursive: true })

  const ortPkg = require(`${ORT_PACKAGE}/package.json`)
  if (ortPkg.version !== ORT_VERSION)
    throw new Error(`${ORT_PACKAGE} ${ortPkg.version} installed; build expects ${ORT_VERSION}`)

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
    dirname(require.resolve(`${ORT_PACKAGE}/package.json`)),
    'bin',
    'napi-v6',
    args.platform,
    args.arch,
  )
  if (!existsSync(nativeDir))
    throw new Error(`${ORT_PACKAGE} ${ORT_VERSION} has no ${args.platform}/${args.arch} binaries`)
  for (const f of NATIVE[args.platform]) copyFileSync(join(nativeDir, f), join(out, f))

  if (args.runnerOnly) return void console.log(out)
  copyFileSync(await modelFile(args.onnx), join(out, model.file))

  const text = async (name, { url, sha256: want }) =>
    readFileSync(await pinned(name, url, want), 'utf8')
  const [birefnet, swin, ortThirdParty] = await Promise.all([
    text('birefnet-LICENSE', model.licences.birefnet),
    text('swin-transformer-LICENSE', model.licences.swin),
    text(`ort-${ORT_VERSION}-ThirdPartyNotices.txt`, ORT_NOTICES),
  ])
  writeFileSync(join(out, 'NOTICES.txt'), notices(birefnet, swin, ortThirdParty))
  console.log(out)
}

const RULE = '----------------------------------------------------------------------------'

function notices(birefnet, swin, ortThirdParty) {
  return `Forge "Remove background" extension (Windows and Linux) — third-party notices

The model file birefnet-lite-768-int8.onnx is BiRefNet-lite, the general-use
model with a Swin Transformer (tiny) backbone
(BiRefNet-general-bb_swin_v1_tiny-epoch_232), by Peng Zheng and colleagues
(https://github.com/ZhengPeng7/BiRefNet), released under the MIT licence
below. Forge changed its format only: the weights were exported to ONNX at
768 x 768 pixels and compressed (int8, and half precision for the deformable
convolutions); the exact steps are in model/README.md. The backbone is
Microsoft's Swin Transformer, MIT, below.

Training data: the authors trained the general-use model on public research
datasets: DIS5K, DUTS, HRSOD, UHRSD, HRS10K, P3M-10k and a humans dataset
(schirrmacher/humans). Those datasets have their own terms, which Forge has
not reviewed; the MIT licence below is the model authors' own.

Forge's runner code is original.

${RULE}
BiRefNet (model weights and code)
${RULE}

${birefnet}
${RULE}
Swin Transformer (the model's backbone)
${RULE}

${swin}
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

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
