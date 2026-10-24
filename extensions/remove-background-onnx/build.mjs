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
 *                             onnxruntime-node's JS and onnxruntime-common inlined
 *   onnxruntime_binding.node  from onnxruntime-node's bin/napi-v6/<platform>/<arch>/, loaded from beside runner.mjs
 *   onnxruntime.dll           win32. Not DirectML.dll: onnxruntime.dll only delay-loads it
 *                             (with d3d12/dxgi) for the DirectML provider, which this
 *                             CPU-only runner never asks for. A 320 px model needs no GPU.
 *   libonnxruntime.so.1       linux: the binding's RUNPATH is $ORIGIN, so it is found beside it
 *   u2netp.onnx               rembg's export of U²-Net-p, pinned by sha256 (model.json)
 *   NOTICES.txt               U²-Net (Apache-2.0), rembg (MIT), ONNX Runtime (MIT) and its
 *                             third-party notices
 *
 * The same onnxruntime-node and the same bundling as boost (its build.mjs
 * exports the helpers), and the same cache: extensions/boost/.cache/, every
 * download verified by sha256 every time. --onnx uses a local copy of the
 * model (still verified). --runner-only writes just runner.mjs and the native
 * files (no network), for tests. manifest.json is not written here —
 * scripts/package-extension.mjs does that.
 */

import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { bindingBesideRunner, ORT_NOTICES, ORT_VERSION, pinned } from '../boost/build.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const model = JSON.parse(readFileSync(join(here, 'model.json'), 'utf8'))
const require = createRequire(import.meta.url)

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
  for (const f of NATIVE[args.platform]) copyFileSync(join(nativeDir, f), join(out, f))

  if (args.runnerOnly) return void console.log(out)
  copyFileSync(await modelFile(args.onnx), join(out, model.file))

  const text = async (name, { url, sha256: want }) =>
    readFileSync(await pinned(name, url, want), 'utf8')
  const [u2net, rembg, ortThirdParty] = await Promise.all([
    text('u2net-LICENSE', model.licences.u2net),
    text('rembg-LICENSE.txt', model.licences.rembg),
    text(`ort-${ORT_VERSION}-ThirdPartyNotices.txt`, ORT_NOTICES),
  ])
  writeFileSync(join(out, 'NOTICES.txt'), notices(u2net, rembg, ortThirdParty))
  console.log(out)
}

const RULE = '----------------------------------------------------------------------------'

function notices(u2net, rembg, ortThirdParty) {
  return `Forge "Remove background" extension (Windows and Linux) — third-party notices

The model file u2netp.onnx is U²-Net-p, the small U²-Net, by Xuebin Qin,
Zichen Zhang, Chenyang Huang, Masood Dehghan, Osmar R. Zaiane and Martin
Jagersand (https://github.com/xuebinqin/U-2-Net), released under the Apache
License 2.0 below. It is redistributed unmodified as exported to ONNX by the
rembg project (https://github.com/danielgatis/rembg, release v0.0.0), whose
MIT licence follows it. Forge's runner code is original.

${RULE}
U²-Net (model weights)
${RULE}

${u2net}
${RULE}
rembg (ONNX export)
${RULE}

${rembg}
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
