import { execFile } from 'node:child_process'
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'

/** build.mjs --runner-only: which native files land beside runner.mjs per platform (no network, no model). */
const run = promisify(execFile)
const build = join(process.cwd(), 'extensions', 'boost', 'build.mjs')

async function built(...flags: string[]): Promise<string> {
  const out = mkdtempSync(join(tmpdir(), 'forge-boost-build-'))
  await run(process.execPath, [build, ...flags, '--out', out, '--runner-only'])
  return out
}

async function files(...flags: string[]): Promise<string[]> {
  return readdirSync(await built(...flags)).sort()
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

  it('--platform linux carries no ONNX Runtime: ncnn runs the model, so only the runner is bundled', async () => {
    for (const arch of ['x64', 'arm64'])
      expect(await files('--platform', 'linux', '--arch', arch)).toEqual(['runner.mjs'])
  }, 60_000)

  it('bundles one engine per platform: ncnn on Linux, ONNX Runtime elsewhere', async () => {
    const linux = readFileSync(
      join(await built('--platform', 'linux', '--arch', 'x64'), 'runner.mjs'),
      'utf8',
    )
    expect(linux).toContain('forge-ncnn')
    expect(linux).not.toContain('onnxruntime_binding')
    const mac = readFileSync(join(await built('--arch', 'arm64'), 'runner.mjs'), 'utf8')
    expect(mac).toContain('onnxruntime_binding')
    expect(mac).not.toContain('--devices')
  }, 60_000)

  it('rejects a platform it does not build for', async () => {
    await expect(files('--platform', 'freebsd', '--arch', 'x64')).rejects.toThrow(
      /--platform must be darwin, win32 or linux/,
    )
  }, 60_000)
})
