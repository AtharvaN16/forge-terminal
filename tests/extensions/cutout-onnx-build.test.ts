import { execFile } from 'node:child_process'
import { mkdtempSync, readdirSync } from 'node:fs'
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

  it('refuses macOS, which has the Apple Vision helper instead', async () => {
    await expect(files('--platform', 'darwin', '--arch', 'arm64')).rejects.toThrow(
      /--platform must be win32 or linux/,
    )
  }, 60_000)
})
