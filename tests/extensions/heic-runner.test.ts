import { execFile } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { beforeAll, describe, expect, it } from 'vitest'

/**
 * The heic payload's child-process contract, run against the real esbuild
 * bundle. The decoder is WASM, so this runs on every platform, Mac included.
 */
const run = promisify(execFile)
const fixture = join(process.cwd(), 'tests', 'fixtures', 'heic', 'small.heic')

let payload: string
let work: string

beforeAll(async () => {
  work = mkdtempSync(join(tmpdir(), 'forge-heic-runner-'))
  payload = join(work, 'payload')
  await run(process.execPath, [
    join(process.cwd(), 'extensions', 'heic', 'build.mjs'),
    '--out',
    payload,
  ])
}, 60_000)

async function heic(args: string[]): Promise<{ exitCode: number; json: Record<string, unknown> }> {
  try {
    const { stdout } = await run(process.execPath, [join(payload, 'runner.mjs'), ...args])
    return { exitCode: 0, json: JSON.parse(stdout) }
  } catch (err) {
    const e = err as { code: number; stdout: string }
    return { exitCode: e.code, json: JSON.parse(e.stdout) }
  }
}

describe('heic runner', () => {
  it('ships libheif as its own files beside the runner, not bundled into it (LGPL)', () => {
    expect(existsSync(join(payload, 'libheif.cjs'))).toBe(true)
    expect(existsSync(join(payload, 'libheif.wasm'))).toBe(true)
    // The WASM alone is over 1 MB; a runner that small cannot contain it.
    expect(statSync(join(payload, 'runner.mjs')).size).toBeLessThan(100_000)
    expect(readFileSync(join(payload, 'NOTICES.txt'), 'utf8')).toMatch(
      /libheif\.cjs and libheif\.wasm are libheif-js/,
    )
  })

  it('--info reads the size and alpha flag', async () => {
    const r = await heic(['--info', '--in', fixture])
    expect(r.exitCode).toBe(0)
    expect(r.json).toMatchObject({ ok: true, width: 64, height: 48, hasAlpha: false })
  })

  it('decodes to raw RGBA, width × height × 4 bytes, with real pixels', async () => {
    const out = join(work, 'small.rgba')
    const r = await heic(['--in', fixture, '--out', out])
    expect(r.exitCode).toBe(0)
    expect(r.json).toMatchObject({ ok: true, width: 64, height: 48 })

    const rgba = readFileSync(out)
    expect(rgba.length).toBe(64 * 48 * 4)
    // The fixture's red channel ramps left to right (README): dark at the
    // left edge, bright at the right, so the bytes are the picture, not zeros.
    expect(rgba[0]).toBeLessThan(40)
    expect(rgba[63 * 4]).toBeGreaterThan(215)
  })

  it('answers a file that is not HEIC with one failure JSON line', async () => {
    const input = join(work, 'garbage.heic')
    writeFileSync(input, 'definitely not a HEIC')
    const r = await heic(['--info', '--in', input])
    expect(r.exitCode).not.toBe(0)
    expect(r.json).toMatchObject({ ok: false, code: 'runtime-error' })
  })
})
