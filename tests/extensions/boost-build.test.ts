import { execFile } from 'node:child_process'
import { mkdtempSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'

/** build.mjs --runner-only: which native files land beside runner.mjs per platform (no network, no model). */
const run = promisify(execFile)
const build = join(process.cwd(), 'extensions', 'boost', 'build.mjs')

async function files(...flags: string[]): Promise<string[]> {
  const out = mkdtempSync(join(tmpdir(), 'forge-boost-build-'))
  await run(process.execPath, [build, ...flags, '--out', out, '--runner-only'])
  return readdirSync(out).sort()
}

describe('boost build.mjs --runner-only', () => {
  it('defaults to darwin: the dylib and binding, no Windows files', async () => {
    expect(await files('--arch', 'arm64')).toEqual([
      'libonnxruntime.1.23.2.dylib',
      'onnxruntime_binding.node',
      'runner.mjs',
    ])
  }, 60_000)

  it('--platform win32 copies the binding, ONNX Runtime and DirectML, not the DXC shader compiler', async () => {
    expect(await files('--platform', 'win32', '--arch', 'x64')).toEqual([
      'DirectML.dll',
      'onnxruntime.dll',
      'onnxruntime_binding.node',
      'runner.mjs',
    ])
  }, 60_000)

  it('--platform linux copies the binding and the one ONNX Runtime library it links', async () => {
    for (const arch of ['x64', 'arm64'])
      expect(await files('--platform', 'linux', '--arch', arch)).toEqual([
        'libonnxruntime.so.1',
        'onnxruntime_binding.node',
        'runner.mjs',
      ])
  }, 60_000)

  it('rejects a platform it does not build for', async () => {
    await expect(files('--platform', 'freebsd', '--arch', 'x64')).rejects.toThrow(
      /--platform must be darwin, win32 or linux/,
    )
  }, 60_000)
})
