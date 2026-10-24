#!/usr/bin/env node
/**
 * Builds the whisper payload directory: whisper.cpp's `whisper-cli`, which
 * transcribe's whisper helper (helpers/transcribe/forge-transcribe-whisper.mjs)
 * runs where Apple's recogniser is not there.
 *
 *   node extensions/whisper/build.mjs --platform win32|linux --arch x64|arm64 --out <dir>
 *                                     [--zig <command>]
 *
 * <dir> receives:
 *   win32  whisper-cli.exe and the DLLs it loads, from upstream's own CPU build
 *          of the pinned release (whisper-bin-x64.zip, whisper-bin-win-cpu-arm64.zip),
 *          unmodified. x64 keeps every ggml-cpu-*.dll: ggml picks the one for the
 *          CPU it runs on at run time.
 *   linux  whisper-cli, built here from the pinned source with zig, static
 *          (musl), CPU only. Built with zig rather than the host's compiler so
 *          any machine (CI's x64 Ubuntu, an arm64 box) makes the same bytes for
 *          both chips.
 *   NOTICES.txt  whisper.cpp's MIT licence, and what the files are.
 *
 * Downloads are cached in extensions/whisper/.cache/ and verified by sha256
 * every time. manifest.json is not written here — scripts/package-extension.mjs
 * does that.
 */

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { availableParallelism } from 'node:os'
import { delimiter, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { inflateRawSync } from 'node:zlib'

const here = dirname(fileURLToPath(import.meta.url))
const cacheDir = join(here, '.cache')

/** whisper.cpp v1.9.5. Its binaries are on the build release of the same commit (b5454). */
export const WHISPER = {
  version: '1.9.5',
  source: {
    name: 'whisper.cpp-1.9.5.tar.gz',
    url: 'https://github.com/ggml-org/whisper.cpp/archive/refs/tags/v1.9.5.tar.gz',
    sha256: 'ff1a9053feb509ff9d7729703355541ae9690073a6b1c40eb692c962e0dc1720',
  },
  win32: {
    x64: {
      name: 'whisper-bin-x64.zip',
      url: 'https://github.com/ggml-org/whisper.cpp/releases/download/b5454/whisper-bin-x64.zip',
      sha256: '6ba69e3482d7826214f90a6a9c84ca07782aec1e1d0c6a7c30c994fd5d816ccb',
      // What whisper-cli.exe imports (whisper, ggml, ggml-base), and the CPU
      // backends ggml loads from beside it. Not the other tools, SDL2 or llama.
      files: [
        'whisper-cli.exe',
        'whisper.dll',
        'ggml.dll',
        'ggml-base.dll',
        'ggml-cpu-alderlake.dll',
        'ggml-cpu-cannonlake.dll',
        'ggml-cpu-cascadelake.dll',
        'ggml-cpu-haswell.dll',
        'ggml-cpu-icelake.dll',
        'ggml-cpu-sandybridge.dll',
        'ggml-cpu-skylakex.dll',
        'ggml-cpu-sse42.dll',
        'ggml-cpu-x64.dll',
      ],
    },
    arm64: {
      name: 'whisper-bin-win-cpu-arm64.zip',
      url: 'https://github.com/ggml-org/whisper.cpp/releases/download/b5454/whisper-bin-win-cpu-arm64.zip',
      sha256: '28c37e7b598c3d9bbfef94f3bd67f2ee6f12b7c86f3da5edcf5e4308d615ff6d',
      files: [
        'whisper-cli.exe',
        'whisper.dll',
        'ggml.dll',
        'ggml-base.dll',
        'ggml-cpu.dll',
        'libomp140.aarch64.dll',
      ],
    },
  },
}

/** zig's names for the chips; musl so the binary needs no particular glibc. */
const ZIG_TARGET = { x64: 'x86_64-linux-musl', arm64: 'aarch64-linux-musl' }
const CMAKE_PROCESSOR = { x64: 'x86_64', arm64: 'aarch64' }
/**
 * The instructions ggml may use. A cross build turns ggml's x86 defaults all
 * off (SSE2 only, several times slower), so x64 names ggml's own portable
 * baseline: AVX2, FMA, F16C (Intel Haswell and AMD Excavator, 2013 on). An
 * older x64 machine is told to use its distribution's whisper-cli instead.
 * arm64's baseline (NEON) is always there.
 */
const CPU_FLAGS = {
  x64: ['SSE42', 'AVX', 'AVX2', 'BMI2', 'FMA', 'F16C'].map((f) => `-DGGML_${f}=ON`),
  arm64: [],
}

function parseArgs(argv) {
  const out = { zig: process.env.ZIG || 'zig' }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--platform' || a === '--arch' || a === '--out' || a === '--zig')
      out[a.slice(2)] = argv[++i]
    else throw new Error(`unknown argument: ${a}`)
  }
  if (out.platform !== 'win32' && out.platform !== 'linux')
    throw new Error('--platform must be win32 or linux')
  if (out.arch !== 'x64' && out.arch !== 'arm64') throw new Error('--arch must be x64 or arm64')
  if (!out.out) throw new Error('--out <dir> is required')
  return out
}

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex')

/** Returns the cached file for `pin`, downloading it first if needed. Always verified. */
async function pinned(pin) {
  mkdirSync(cacheDir, { recursive: true })
  const path = join(cacheDir, pin.name)
  if (!existsSync(path)) {
    const res = await fetch(pin.url)
    if (!res.ok) throw new Error(`download failed: ${pin.url} → HTTP ${res.status}`)
    const buf = Buffer.from(await res.arrayBuffer())
    if (sha256(buf) !== pin.sha256) throw new Error(`sha256 mismatch for ${pin.url}`)
    writeFileSync(`${path}.part`, buf)
    renameSync(`${path}.part`, path)
  }
  if (sha256(readFileSync(path)) !== pin.sha256)
    throw new Error(`sha256 mismatch for cached ${path}`)
  return path
}

/**
 * The files of a zip by their base name: stored or deflated entries, read from
 * the central directory. Enough for upstream's release zips; Node built-ins only.
 */
export function unzip(buf) {
  let end = buf.length - 22
  while (end >= 0 && buf.readUInt32LE(end) !== 0x06054b50) end--
  if (end < 0) throw new Error('not a zip file')
  const count = buf.readUInt16LE(end + 10)
  let at = buf.readUInt32LE(end + 16)
  const files = new Map()
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(at) !== 0x02014b50) throw new Error('bad zip central directory')
    const method = buf.readUInt16LE(at + 10)
    const size = buf.readUInt32LE(at + 20)
    const nameLen = buf.readUInt16LE(at + 28)
    const extraLen = buf.readUInt16LE(at + 30)
    const commentLen = buf.readUInt16LE(at + 32)
    const local = buf.readUInt32LE(at + 42)
    const name = buf.toString('utf8', at + 46, at + 46 + nameLen)
    at += 46 + nameLen + extraLen + commentLen
    if (name.endsWith('/')) continue
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28)
    const raw = buf.subarray(start, start + size)
    if (method !== 0 && method !== 8) throw new Error(`unsupported zip method ${method}: ${name}`)
    files.set(name.slice(name.lastIndexOf('/') + 1), method === 0 ? raw : inflateRawSync(raw))
  }
  return files
}

/** The source tree, extracted once into the cache. */
async function sourceTree() {
  const archive = await pinned(WHISPER.source)
  const dir = join(cacheDir, `whisper.cpp-${WHISPER.version}`)
  if (!existsSync(join(dir, 'CMakeLists.txt'))) {
    rmSync(dir, { recursive: true, force: true })
    execFileSync('tar', ['-xzf', archive, '-C', cacheDir], { stdio: 'inherit' })
  }
  return dir
}

async function win32(arch, out) {
  const pin = WHISPER.win32[arch]
  const files = unzip(readFileSync(await pinned(pin)))
  for (const name of pin.files) {
    const buf = files.get(name)
    if (!buf) throw new Error(`${pin.name} has no ${name}`)
    writeFileSync(join(out, name), buf)
  }
  return pin.name
}

const onPath = (name) =>
  (process.env.PATH ?? '').split(delimiter).some((dir) => dir && existsSync(join(dir, name)))

async function linux(arch, out, zig) {
  const src = await sourceTree()
  const work = join(cacheDir, `build-linux-${arch}`)
  rmSync(work, { recursive: true, force: true })
  mkdirSync(work, { recursive: true })
  // CMake wants one program per tool; each wrapper is zig with the target fixed.
  const wrap = (name, tool) => {
    const path = join(work, name)
    writeFileSync(path, `#!/bin/sh\nexec ${zig} ${tool} "$@"\n`)
    chmodSync(path, 0o755)
    return path
  }
  const target = ZIG_TARGET[arch]
  const cc = wrap('cc', `cc -target ${target}`)
  const cxx = wrap('c++', `c++ -target ${target}`)
  const ar = wrap('ar', 'ar')
  const ranlib = wrap('ranlib', 'ranlib')
  // Paths compiled in (ggml's asserts name their file) are made relative, so
  // where the tree was unpacked does not change the bytes.
  const prefix = `-ffile-prefix-map=${src}=whisper.cpp`
  const build = join(work, 'build')
  execFileSync(
    'cmake',
    [
      ...['-S', src, '-B', build],
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
      // Static and stripped: one file that runs on any Linux of that chip.
      '-DCMAKE_EXE_LINKER_FLAGS=-static -s',
      '-DBUILD_SHARED_LIBS=OFF',
      // Not tuned to the build machine: x64 gets ggml's portable AVX2 baseline, arm64 plain armv8-a.
      '-DGGML_NATIVE=OFF',
      ...CPU_FLAGS[arch],
      '-DGGML_CCACHE=OFF',
      // zig has no libgomp; ggml's own thread pool does the same job.
      '-DGGML_OPENMP=OFF',
      '-DWHISPER_BUILD_TESTS=OFF',
      '-DWHISPER_BUILD_SERVER=OFF',
      '-DWHISPER_SDL2=OFF',
      '-DWHISPER_CURL=OFF',
    ],
    // The tarball is not a git checkout; stop git finding Forge's own repo above the cache.
    {
      stdio: ['ignore', 'ignore', 'inherit'],
      env: { ...process.env, GIT_CEILING_DIRECTORIES: cacheDir },
    },
  )
  const jobs = String(Math.max(1, availableParallelism()))
  execFileSync('cmake', ['--build', build, '--target', 'whisper-cli', '-j', jobs], {
    stdio: ['ignore', 'ignore', 'inherit'],
    env: { ...process.env, GIT_CEILING_DIRECTORIES: cacheDir },
  })
  copyFileSync(join(build, 'bin', 'whisper-cli'), join(out, 'whisper-cli'))
  chmodSync(join(out, 'whisper-cli'), 0o755)
  const [cmd, ...rest] = zig.split(' ')
  const version = execFileSync(cmd, [...rest, 'version'], { encoding: 'utf8' }).trim()
  return `${WHISPER.source.name}, built with zig ${version} for ${target}`
}

function notices(from, platform, arch, licence) {
  const runtime =
    platform === 'win32'
      ? `
These are upstream's own Windows CPU binaries, unmodified. They need the
Microsoft Visual C++ 2015-2022 Redistributable (MSVCP140.dll, VCRUNTIME140.dll${arch === 'x64' ? ',\nVCRUNTIME140_1.dll, VCOMP140.DLL' : ''}), which most Windows PCs already have.${
          arch === 'arm64'
            ? '\nlibomp140.aarch64.dll is the LLVM OpenMP runtime Microsoft redistributes\nwith Visual Studio, shipped by upstream beside the binaries.'
            : ''
        }
`
      : `
whisper-cli is built from the source above, unmodified, statically linked
against musl libc (MIT) and LLVM's libc++ (Apache-2.0 WITH LLVM-exception),
both as zig ships them.
`
  return `Forge "whisper" extension — third-party notices

whisper.cpp ${WHISPER.version} (https://github.com/ggml-org/whisper.cpp), including ggml.
From: ${from}
${runtime}
----------------------------------------------------------------------------
whisper.cpp and ggml
----------------------------------------------------------------------------

${licence}`
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const out = resolve(args.out)
  rmSync(out, { recursive: true, force: true })
  mkdirSync(out, { recursive: true })
  const from =
    args.platform === 'win32' ? await win32(args.arch, out) : await linux(args.arch, out, args.zig)
  const licence = readFileSync(join(await sourceTree(), 'LICENSE'), 'utf8')
  writeFileSync(join(out, 'NOTICES.txt'), notices(from, args.platform, args.arch, licence))
  console.log(out)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err)
    process.exit(1)
  })
}
