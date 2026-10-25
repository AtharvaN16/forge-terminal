import { execFile } from 'node:child_process'
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'

/** remove-background-onnx build.mjs --runner-only: what lands beside runner.mjs (no network, no model). */
const run = promisify(execFile)
const build = join(process.cwd(), 'extensions', 'remove-background-onnx', 'build.mjs')

async function files(...flags: string[]): Promise<string[]> {
  const out = mkdtempSync(join(tmpdir(), 'forge-cutout-build-'))
  await run(process.execPath, [build, ...flags, '--out', out, '--runner-only'])
  return readdirSync(out).sort()
}

describe('remove-background-onnx build.mjs --runner-only', () => {
  it('win32: the binding and onnxruntime.dll only — DirectML is never asked for', async () => {
    for (const arch of ['x64', 'arm64'])
      expect(await files('--platform', 'win32', '--arch', arch)).toEqual([
        'onnxruntime.dll',
        'onnxruntime_binding.node',
        'runner.mjs',
      ])
  }, 60_000)

  it('linux: the binding and libonnxruntime.so.1', async () => {
    for (const arch of ['x64', 'arm64'])
      expect(await files('--platform', 'linux', '--arch', arch)).toEqual([
        'libonnxruntime.so.1',
        'onnxruntime_binding.node',
        'runner.mjs',
      ])
  }, 60_000)

  it("bundles its own ONNX Runtime, the 1.25.1 alias, and loads its binding from beside runner.mjs; boost's 1.23.2 is not in it", async () => {
    const out = mkdtempSync(join(tmpdir(), 'forge-cutout-build-'))
    await run(process.execPath, [
      build,
      '--platform',
      'linux',
      '--arch',
      'x64',
      '--out',
      out,
      '--runner-only',
    ])
    const bundle = readFileSync(join(out, 'runner.mjs'), 'utf8')
    expect(bundle).toContain('node_modules/onnxruntime-node-rmbg/')
    expect(bundle).toContain('require("./onnxruntime_binding.node")')
    expect(bundle).not.toContain('napi-v6')
    expect(bundle).toContain('1.25.1')
    expect(bundle).not.toContain('1.23.2')
  }, 60_000)

  it('refuses macOS, which has the Apple Vision helper instead', async () => {
    await expect(files('--platform', 'darwin', '--arch', 'arm64')).rejects.toThrow(
      /--platform must be win32 or linux/,
    )
  }, 60_000)
})
