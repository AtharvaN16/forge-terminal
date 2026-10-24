#!/usr/bin/env node
/**
 * Builds the boost payload directory.
 *
 *   node extensions/boost/build.mjs --arch arm64|x64 --out <dir> [--platform darwin|win32|linux]
 *                                   [--pth <file> | --onnx <file>] [--runner-only]
 *
 * <dir> receives:
 *   runner.mjs                  runner.ts bundled; onnxruntime-node's JS and onnxruntime-common inlined
 *   onnxruntime_binding.node    from onnxruntime-node's bin/napi-v6/<platform>/<arch>/, loaded from beside runner.mjs
 *   libonnxruntime.*.dylib      darwin: the binding links it via @loader_path
 *   onnxruntime.dll, DirectML.dll  win32: the binding loads them from the same directory
 *   libonnxruntime.so.1         linux: the binding's RUNPATH is $ORIGIN, so it is found beside it.
 *                               x64 holds the WebGPU provider and Dawn (Vulkan backend) in this one
 *                               file; it needs only libc, libstdc++ and libgcc at load, and takes
 *                               libvulkan from the system when it runs. Linux arm64's has no WebGPU.
 *   realesr-general-x4v3.onnx   upstream .pth (pinned by sha256) converted by convert.py, output pinned too
 *   NOTICES.txt                 Real-ESRGAN (BSD-3), ONNX Runtime (MIT), DirectML's terms (win32 only)
 *                               and ONNX Runtime's third-party notices
 *
 * Downloads are cached in extensions/boost/.cache/ and verified by sha256 every
 * time. --pth uses a local copy of the upstream checkpoint (still verified).
 * --onnx uses an already-converted model instead of converting a .pth, checked against
 * the same pinned output sha256; the Windows build takes the macOS build's output this
 * way, so one conversion backs every archive and CI needs no Python on Windows or Linux.
 * --runner-only writes just runner.mjs and the native files (no network), for tests.
 * manifest.json is not written here — scripts/package-extension.mjs does that.
 */

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'esbuild'

const here = dirname(fileURLToPath(import.meta.url))
const cacheDir = join(here, '.cache')
const model = JSON.parse(readFileSync(join(here, 'model.json'), 'utf8'))
const require = createRequire(import.meta.url)

export const ORT_VERSION = '1.23.2'
/**
 * win32 ships exactly these, not the whole directory. It also holds dxcompiler.dll and
 * dxil.dll, which are only ONNX Runtime's optional shader-compiler path for its WebGPU
 * provider ("Use DXC instead of FXC for compiling HLSL when both dxcompiler.dll and
 * dxil.dll is available", in onnxruntime.dll); DirectML itself imports only d3d12/dxgi.
 * Boost uses DirectML or the CPU, so those two would be 20-24 MB of dead weight per arch.
 */
const WIN32_NATIVE = ['onnxruntime_binding.node', 'onnxruntime.dll', 'DirectML.dll']
/** The DirectML.dll inside onnxruntime-node 1.23.2's win32 binaries (its version resource). */
const DIRECTML_VERSION = '1.15.4'
export const ORT_NOTICES = {
  url: `https://raw.githubusercontent.com/microsoft/onnxruntime/v${ORT_VERSION}/ThirdPartyNotices.txt`,
  sha256: 'e9e90971a8e75a9a8ac0c6412e29c1202d079998389915aa485f46c816c3b4cc',
}

function parseArgs(argv) {
  const out = { runnerOnly: false, platform: 'darwin' }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--runner-only') out.runnerOnly = true
    else if (
      a === '--arch' ||
      a === '--out' ||
      a === '--pth' ||
      a === '--onnx' ||
      a === '--platform'
    )
      out[a.slice(2)] = argv[++i]
    else throw new Error(`unknown argument: ${a}`)
  }
  if (out.arch !== 'arm64' && out.arch !== 'x64') throw new Error('--arch must be arm64 or x64')
  if (!['darwin', 'win32', 'linux'].includes(out.platform))
    throw new Error('--platform must be darwin, win32 or linux')
  if (out.pth && out.onnx) throw new Error('--pth and --onnx are mutually exclusive')
  if (!out.out) throw new Error('--out <dir> is required')
  return out
}

export const sha256 = (buf) => createHash('sha256').update(buf).digest('hex')

/** Returns the cached file at `name`, downloading it first if needed. Always verified. */
export async function pinned(name, url, expected) {
  mkdirSync(cacheDir, { recursive: true })
  const path = join(cacheDir, name)
  if (!existsSync(path)) {
    const res = await fetch(url)
    if (!res.ok) throw new Error(`download failed: ${url} → HTTP ${res.status}`)
    const buf = Buffer.from(await res.arrayBuffer())
    if (sha256(buf) !== expected) throw new Error(`sha256 mismatch for ${url}`)
    writeFileSync(`${path}.part`, buf)
    renameSync(`${path}.part`, path)
  }
  if (sha256(readFileSync(path)) !== expected) throw new Error(`sha256 mismatch for cached ${path}`)
  return path
}

/** The ONNX model: converted from the pinned upstream .pth, output checked against model.json. */
async function modelFile(localPth, localOnnx) {
  if (localOnnx) {
    if (sha256(readFileSync(localOnnx)) !== model.sha256)
      throw new Error(`--onnx ${localOnnx} does not match model.json sha256`)
    return localOnnx
  }
  mkdirSync(cacheDir, { recursive: true })
  const onnx = join(cacheDir, model.file)
  if (existsSync(onnx) && sha256(readFileSync(onnx)) === model.sha256) return onnx
  let pth
  if (localPth) {
    if (sha256(readFileSync(localPth)) !== model.source.sha256)
      throw new Error(`--pth ${localPth} does not match model.json source sha256`)
    pth = localPth
  } else {
    pth = await pinned('realesr-general-x4v3.pth', model.source.url, model.source.sha256)
  }
  const [script, ...flags] = model.convert
  execFileSync('python3', ['-I', join(here, script), pth, `${onnx}.part`, ...flags], {
    stdio: ['ignore', 'ignore', 'inherit'],
  })
  if (sha256(readFileSync(`${onnx}.part`)) !== model.sha256)
    throw new Error(
      'converted model does not match model.json sha256 — convert.py or the checkpoint changed',
    )
  renameSync(`${onnx}.part`, onnx)
  return onnx
}

/** onnxruntime-node loads its binding from ../bin/napi-v6/<platform>/<arch>/; point it beside runner.mjs instead. */
export const bindingBesideRunner = {
  name: 'ort-binding-beside-runner',
  setup(b) {
    b.onResolve({ filter: /onnxruntime_binding\.node$/ }, (args) => ({
      path: args.path,
      external: true,
    }))
    b.onLoad({ filter: /onnxruntime-node[\\/]dist[\\/]binding\.js$/ }, (args) => {
      const src = readFileSync(args.path, 'utf8')
      const replaced = src.replace(
        /require\(`\.\.\/bin\/napi-v6\/[^`]*onnxruntime_binding\.node`\)/,
        "require('./onnxruntime_binding.node')",
      )
      if (replaced === src)
        throw new Error('onnxruntime-node binding.js changed shape; update build.mjs')
      return { contents: replaced, loader: 'js' }
    })
  },
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
  // darwin ships the whole directory: the binding and the one ONNX Runtime
  // library it links (libonnxruntime.1.23.2.dylib), which holds CoreML and, on
  // x64, WebGPU (Metal) too. linux names its two: on an x64 Linux host, npm's
  // install of onnxruntime-node also fetches the CUDA and TensorRT providers
  // into the same folder, which Boost never asks for.
  const native =
    args.platform === 'win32'
      ? WIN32_NATIVE
      : args.platform === 'linux'
        ? ['onnxruntime_binding.node', 'libonnxruntime.so.1']
        : readdirSync(nativeDir)
  for (const f of native) copyFileSync(join(nativeDir, f), join(out, f))

  if (args.runnerOnly) return void console.log(out)
  copyFileSync(await modelFile(args.pth, args.onnx), join(out, model.file))

  const ortNotices = readFileSync(
    await pinned(`ort-${ORT_VERSION}-ThirdPartyNotices.txt`, ORT_NOTICES.url, ORT_NOTICES.sha256),
    'utf8',
  )
  writeFileSync(join(out, 'NOTICES.txt'), notices(ortNotices, args.platform))
  console.log(out)
}

/** DirectML's licence lets it ship only inside something else, so the notice says so. */
const DIRECTML_NOTICE = `----------------------------------------------------------------------------
DirectML ${DIRECTML_VERSION} (DirectML.dll, win32 only)
----------------------------------------------------------------------------

DirectML.dll — Microsoft DirectX Machine Learning (DirectML), redistributable.
Copyright (c) Microsoft Corporation. Distributed as part of this extension
under the Microsoft Software License Terms for DirectML:
https://www.nuget.org/packages/Microsoft.AI.DirectML/${DIRECTML_VERSION}/License — it may
not be redistributed on its own.

`

function notices(ortThirdParty, platform) {
  return `Forge "Boost resolution" extension — third-party notices

The model file realesr-general-x4v3.onnx is converted (format only, weights
unchanged) from realesr-general-x4v3.pth of Real-ESRGAN,
https://github.com/xinntao/Real-ESRGAN, released under the licence below.

----------------------------------------------------------------------------
Real-ESRGAN
----------------------------------------------------------------------------

BSD 3-Clause License

Copyright (c) 2021, Xintao Wang
All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this
   list of conditions and the following disclaimer.

2. Redistributions in binary form must reproduce the above copyright notice,
   this list of conditions and the following disclaimer in the documentation
   and/or other materials provided with the distribution.

3. Neither the name of the copyright holder nor the names of its
   contributors may be used to endorse or promote products derived from
   this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.

----------------------------------------------------------------------------
ONNX Runtime ${ORT_VERSION} (onnxruntime-node, onnxruntime-common, libonnxruntime)
https://github.com/microsoft/onnxruntime
----------------------------------------------------------------------------

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

${platform === 'win32' ? DIRECTML_NOTICE : ''}----------------------------------------------------------------------------
ONNX Runtime third-party notices (ThirdPartyNotices.txt, v${ORT_VERSION})
----------------------------------------------------------------------------

${ortThirdParty}`
}

// Run as a script; the cutout build (extensions/remove-background-onnx) imports the helpers above.
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err)
    process.exit(1)
  })
}
