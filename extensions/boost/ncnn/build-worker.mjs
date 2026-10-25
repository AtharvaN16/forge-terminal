#!/usr/bin/env node
/**
 * Builds forge-ncnn (forge-ncnn.cpp and the pinned ncnn it links) for Linux,
 * with zig, from any host:
 *
 *   node extensions/boost/ncnn/build-worker.mjs --arch x64|arm64 --out <file> [--zig <command>]
 *
 * Built with zig rather than the host's compiler so any machine (CI's Mac, an
 * arm64 box) makes the same bytes for both chips; the zig is pinned by hash
 * (extensions/whisper/zig-requirements.txt, the same one whisper uses).
 *
 * - glibc, dynamic, down to 2.17 (RHEL 7, Debian 8): Vulkan's loader is opened
 *   with dlopen at run time, which a static musl program cannot do. libc++ is
 *   zig's and goes inside the file, so nothing but glibc is needed.
 * - ncnn's own Vulkan loader (NCNN_SIMPLEVK) and its in-house glslang: no
 *   Vulkan SDK to build, no libvulkan to link; with no driver on the machine
 *   the program lists no devices and runs on the processor.
 * - ncnn's own thread pool (NCNN_SIMPLEOMP): zig has no libgomp.
 * - Only the layers the model uses (see KEEP); the program is 4 MB, not 16.
 * - ncnn picks its fastest code for the chip at run time (AVX2, AVX-512, ARM
 *   fp16 and dot-product), so nothing here is tuned to the build machine.
 *
 * The source is ncnn's "full source" release, which carries glslang. It is
 * downloaded once to extensions/boost/.cache/ and verified by sha256.
 */

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { availableParallelism, tmpdir } from 'node:os'
import { delimiter, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const cacheDir = join(here, '..', '.cache')

/** ncnn 20261020 (https://github.com/Tencent/ncnn), BSD-3-Clause. */
export const NCNN = {
  version: '20261020',
  name: 'ncnn-20261020-full-source.zip',
  url: 'https://github.com/Tencent/ncnn/releases/download/20261020/ncnn-20261020-full-source.zip',
  sha256: '699d9acc67489eee0993a551ca1ebc247bbf0f4e33babe1dec810e6a9a52b988',
}

/** zig's names for the chips; glibc 2.17 is the oldest the Linux builds of Boost run on. */
const ZIG_TARGET = { x64: 'x86_64-linux-gnu.2.17', arm64: 'aarch64-linux-gnu.2.17' }
const CMAKE_PROCESSOR = { x64: 'x86_64', arm64: 'aarch64' }

/**
 * The layers kept: what realesr-general-x4v3 is made of, and what those layers
 * make for themselves (padding, packing and cast around a convolution, the
 * inner product and gemm it can fall back on). Everything else is left out.
 */
export const KEEP = [
  'Input',
  'Split',
  'Convolution',
  'PReLU',
  'PixelShuffle',
  'Interp',
  'BinaryOp',
  'Padding',
  'Packing',
  'Cast',
  'Gemm',
  'InnerProduct',
]

/**
 * zig reads -march=<name> as a CPU name, so ncnn's -march=armv8.2-a+fp16 (and
 * its fp16, dot-product, bf16, i8mm and SVE relatives) is refused and ncnn turns
 * those variants off, which leaves an arm64 build without half-precision
 * arithmetic. This shell prefix passes the same thing the way zig takes it:
 * -mcpu=generic+v8_2a+fullfp16… (zig names the features as LLVM does).
 */
const ARM_MARCH = `n=$#
while [ $n -gt 0 ]; do
  a=$1; shift
  case $a in
    -march=armv8*)
      a=$(printf '%s' "$a" | sed -e 's/^-march=armv8-a/-mcpu=generic/' -e 's/^-march=armv8\\.\\([0-9]\\)-a/-mcpu=generic+v8_\\1a/' -e 's/+fp16fml/+@F@/g' -e 's/+fp16/+fullfp16/g' -e 's/+@F@/+fp16fml/g');;
  esac
  set -- "$@" "$a"; n=$((n-1))
done
`

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex')
const onPath = (name) =>
  (process.env.PATH ?? '').split(delimiter).some((dir) => dir && existsSync(join(dir, name)))

async function pinned() {
  mkdirSync(cacheDir, { recursive: true })
  const path = join(cacheDir, NCNN.name)
  if (!existsSync(path)) {
    const res = await fetch(NCNN.url)
    if (!res.ok) throw new Error(`download failed: ${NCNN.url} → HTTP ${res.status}`)
    const buf = Buffer.from(await res.arrayBuffer())
    if (sha256(buf) !== NCNN.sha256) throw new Error(`sha256 mismatch for ${NCNN.url}`)
    writeFileSync(`${path}.part`, buf)
    renameSync(`${path}.part`, path)
  }
  if (sha256(readFileSync(path)) !== NCNN.sha256)
    throw new Error(`sha256 mismatch for cached ${path}`)
  return path
}

/** The source tree, unpacked once into the cache and reached through a path without spaces. */
async function sourceTree() {
  const archive = await pinned()
  const dir = join(cacheDir, `ncnn-${NCNN.version}`)
  if (!existsSync(join(dir, 'CMakeLists.txt'))) {
    rmSync(dir, { recursive: true, force: true })
    mkdirSync(dir, { recursive: true })
    execFileSync('unzip', ['-q', archive, '-d', dir], { stdio: 'inherit' })
  }
  // The zip holds one folder, ncnn-<version>/ (or the files directly).
  const root = existsSync(join(dir, 'CMakeLists.txt')) ? dir : join(dir, `ncnn-${NCNN.version}`)
  if (!existsSync(join(root, 'CMakeLists.txt'))) throw new Error(`no ncnn source in ${archive}`)
  // Compiler flags are split on spaces, so a checkout under a folder with one
  // (…/Convert Terminal/…) is reached through a link without.
  if (!root.includes(' ')) return root
  const link = join(tmpdir(), `forge-ncnn-${NCNN.version}`)
  rmSync(link, { force: true })
  symlinkSync(root, link)
  return link
}

/** `-DWITH_LAYER_x=OFF` for every layer the source has but KEEP does not name. */
export function layerSwitches(ncnnCmakeLists) {
  const keep = new Set(KEEP.map((n) => n.toLowerCase()))
  const names = [...ncnnCmakeLists.matchAll(/^ncnn_add_layer\((\w+)/gm)].map((m) =>
    (m[1] ?? '').toLowerCase(),
  )
  if (names.length < 100) throw new Error('ncnn source changed shape: layer list not found')
  for (const k of keep)
    if (!names.includes(k)) throw new Error(`ncnn has no layer ${k}; update KEEP`)
  return [...new Set(names)].filter((n) => !keep.has(n)).map((n) => `-DWITH_LAYER_${n}=OFF`)
}

export async function buildWorker(arch, outFile, zig) {
  const src = await sourceTree()
  // Built in the temporary folder, not the cache: ncnn's generated x86 sources carry the build
  // folder's path into the binary, and flags are split on spaces (a checkout may have one in its name).
  const work = join(tmpdir(), `forge-ncnn-build-${arch}`)
  rmSync(work, { recursive: true, force: true })
  mkdirSync(work, { recursive: true })
  // CMake wants one program per tool; each wrapper is zig with the target fixed.
  const wrap = (name, tool) => {
    const path = join(work, name)
    writeFileSync(
      path,
      `#!/bin/sh\n${arch === 'arm64' && /^c/.test(tool) ? ARM_MARCH : ''}exec ${zig} ${tool} "$@"\n`,
    )
    chmodSync(path, 0o755)
    return path
  }
  const target = ZIG_TARGET[arch]
  const cc = wrap('cc', `cc -target ${target}`)
  const cxx = wrap('c++', `c++ -target ${target}`)
  const ar = wrap('ar', 'ar')
  const ranlib = wrap('ranlib', 'ranlib')
  // Paths compiled in are made relative, so where the tree was unpacked and built does not change the bytes.
  const maps = [src, work, realpathSync(work)].map(
    (p) => `-ffile-prefix-map=${p}=${p === src ? 'ncnn' : 'build'}`,
  )
  const prefix = [...new Set(maps)].join(' ')
  const build = join(work, 'build')
  const env = { ...process.env, GIT_CEILING_DIRECTORIES: cacheDir }
  execFileSync(
    'cmake',
    [
      ...['-S', here, '-B', build],
      ...(onPath('ninja') ? ['-G', 'Ninja'] : []),
      '-DCMAKE_BUILD_TYPE=Release',
      '-DCMAKE_SYSTEM_NAME=Linux',
      `-DCMAKE_SYSTEM_PROCESSOR=${CMAKE_PROCESSOR[arch]}`,
      `-DCMAKE_C_COMPILER=${cc}`,
      `-DCMAKE_CXX_COMPILER=${cxx}`,
      `-DCMAKE_AR=${ar}`,
      `-DCMAKE_RANLIB=${ranlib}`,
      `-DCMAKE_C_FLAGS=${prefix}`,
      `-DCMAKE_CXX_FLAGS=${prefix}`,
      '-DCMAKE_EXE_LINKER_FLAGS=-s',
      `-DNCNN_SRC=${src}`,
      '-DNCNN_VULKAN=ON',
      '-DNCNN_SIMPLEVK=ON',
      '-DNCNN_OPENMP=ON',
      '-DNCNN_SIMPLEOMP=ON',
      '-DNCNN_BF16=OFF',
      '-DNCNN_SHARED_LIB=OFF',
      '-DNCNN_INSTALL_SDK=OFF',
      '-DNCNN_BUILD_TOOLS=OFF',
      '-DNCNN_BUILD_EXAMPLES=OFF',
      '-DNCNN_BUILD_BENCHMARK=OFF',
      '-DNCNN_BUILD_TESTS=OFF',
      '-DNCNN_PYTHON=OFF',
      '-DNCNN_C_API=OFF',
      '-DNCNN_PLATFORM_API=OFF',
      '-DNCNN_PIXEL_ROTATE=OFF',
      '-DNCNN_PIXEL_AFFINE=OFF',
      '-DNCNN_PIXEL_DRAWING=OFF',
      ...layerSwitches(readFileSync(join(src, 'src', 'CMakeLists.txt'), 'utf8')),
    ],
    { stdio: ['ignore', 'ignore', 'inherit'], env },
  )
  execFileSync(
    'cmake',
    ['--build', build, '--target', 'forge-ncnn', '-j', String(Math.max(1, availableParallelism()))],
    { stdio: ['ignore', 'ignore', 'inherit'], env },
  )
  mkdirSync(dirname(resolve(outFile)), { recursive: true })
  copyFileSync(join(build, 'forge-ncnn'), outFile)
  chmodSync(outFile, 0o755)
  const [cmd, ...rest] = zig.split(' ')
  const version = execFileSync(cmd, [...rest, 'version'], { encoding: 'utf8' }).trim()
  return `ncnn ${NCNN.version}, built with zig ${version} for ${target}`
}

/** ncnn's licence (with the third-party ones it lists) and glslang's, from the pinned source, for NOTICES.txt. */
export async function ncnnLicences() {
  const src = await sourceTree()
  return {
    ncnn: readFileSync(join(src, 'LICENSE.txt'), 'utf8'),
    glslang: readFileSync(join(src, 'glslang', 'LICENSE.txt'), 'utf8'),
  }
}

function parseArgs(argv) {
  const out = { zig: process.env.ZIG || 'zig' }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--arch' || a === '--out' || a === '--zig') out[a.slice(2)] = argv[++i]
    else throw new Error(`unknown argument: ${a}`)
  }
  if (out.arch !== 'x64' && out.arch !== 'arm64') throw new Error('--arch must be x64 or arm64')
  if (!out.out) throw new Error('--out <file> is required')
  return out
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = parseArgs(process.argv.slice(2))
  buildWorker(args.arch, resolve(args.out), args.zig)
    .then((what) => console.log(what))
    .catch((err) => {
      console.error(err instanceof Error ? err.message : err)
      process.exit(1)
    })
}
