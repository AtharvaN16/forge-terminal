import { execFile } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { beforeAll, describe, expect, it } from 'vitest'
import { type DngOptions, dngBytes } from '../helpers/raw.js'

/**
 * The raw payload's child-process contract, run against the real esbuild
 * bundle on synthetic DNGs (tests/helpers/raw.ts). The decoder is WASM, so
 * this runs on every platform, Mac included.
 */
const run = promisify(execFile)

let payload: string
let work: string

beforeAll(async () => {
  work = mkdtempSync(join(tmpdir(), 'forge-raw-runner-'))
  payload = join(work, 'payload')
  await run(process.execPath, [
    join(process.cwd(), 'extensions', 'raw', 'build.mjs'),
    '--out',
    payload,
  ])
}, 60_000)

async function raw(args: string[]): Promise<{ exitCode: number; json: Record<string, unknown> }> {
  try {
    const { stdout } = await run(process.execPath, [join(payload, 'runner.mjs'), ...args])
    return { exitCode: 0, json: JSON.parse(stdout) }
  } catch (err) {
    const e = err as { code: number; stdout: string }
    return { exitCode: e.code, json: JSON.parse(e.stdout) }
  }
}

let n = 0
function dng(options?: DngOptions): string {
  const path = join(work, `shot-${n++}.dng`)
  writeFileSync(path, dngBytes(options))
  return path
}

/** Decodes to raw RGB; returns the size and a pixel reader. */
async function decode(input: string) {
  const out = join(work, `decoded-${n++}.rgb`)
  const r = await raw(['--in', input, '--out', out])
  expect(r.exitCode).toBe(0)
  const width = r.json.width as number
  const height = r.json.height as number
  const rgb = readFileSync(out)
  expect(rgb.length).toBe(width * height * 3)
  const at = (x: number, y: number) => [
    ...rgb.subarray((y * width + x) * 3, (y * width + x) * 3 + 3),
  ]
  return { width, height, at }
}

describe('raw runner', () => {
  it('ships LibRaw as its own files beside the runner, not bundled into it (LGPL)', () => {
    expect(existsSync(join(payload, 'libraw.mjs'))).toBe(true)
    expect(existsSync(join(payload, 'libraw.wasm'))).toBe(true)
    // The WASM alone is over 1 MB; a runner that small cannot contain it.
    expect(statSync(join(payload, 'runner.mjs')).size).toBeLessThan(100_000)
    const notices = readFileSync(join(payload, 'NOTICES.txt'), 'utf8')
    expect(notices).toMatch(/libraw\.mjs and libraw\.wasm are libraw-wasm 1\.6\.0/)
    expect(notices).toContain('https://github.com/ybouane/LibRaw-Wasm')
    expect(notices).toContain('ISC License')
    expect(notices).toContain('GNU LESSER GENERAL PUBLIC LICENSE')
    expect(notices).toContain('COMMON DEVELOPMENT AND DISTRIBUTION LICENSE (CDDL) Version 1.0')
  })

  it('--info reads the size from the header: no alpha, ever', async () => {
    const r = await raw(['--info', '--in', dng()])
    expect(r.exitCode).toBe(0)
    expect(r.json).toMatchObject({ ok: true, width: 320, height: 240, hasAlpha: false })
  })

  it('decodes the photo itself to raw RGB, not the preview a TIFF reader sees', async () => {
    const { width, height, at } = await decode(dng())
    expect([width, height]).toEqual([320, 240])
    // The gradient, not the all-green 16×12 preview: red rises to the right, green downwards.
    const [r1 = 0, g1 = 0] = at(310, 10)
    const [r2 = 0, g2 = 0] = at(10, 230)
    expect(r1).toBeGreaterThan(g1 + 100)
    expect(g2).toBeGreaterThan(r2 + 100)
  })

  it('turns a portrait photo upright by the RAW’s own orientation', async () => {
    const path = dng({ orientation: 6 })
    expect((await raw(['--info', '--in', path])).json).toMatchObject({ width: 240, height: 320 })
    const { width, height, at } = await decode(path)
    expect([width, height]).toEqual([240, 320])
    // Turned a quarter clockwise: the stored left edge (no red) is now the
    // top, and the stored top (no green) is now the right-hand side.
    const [rTop = 0] = at(120, 5)
    const [rBottom = 0] = at(120, 314)
    const [, gRight = 0] = at(234, 160)
    const [, gLeft = 0] = at(5, 160)
    expect(rBottom).toBeGreaterThan(rTop + 100)
    expect(gLeft).toBeGreaterThan(gRight + 100)
  })

  it('takes the maker’s crop, before turning the photo', async () => {
    const crop = { left: 40, top: 20, width: 240, height: 200 }
    const flat = dng({ crop })
    expect((await raw(['--info', '--in', flat])).json).toMatchObject({ width: 240, height: 200 })
    expect(await decode(flat)).toMatchObject({ width: 240, height: 200 })

    const turned = dng({ crop, orientation: 6 })
    expect((await raw(['--info', '--in', turned])).json).toMatchObject({ width: 200, height: 240 })
    expect(await decode(turned)).toMatchObject({ width: 200, height: 240 })
  })

  it('the checked-in fixture CI decodes is upright and cropped: 44×60', async () => {
    const fixture = join(process.cwd(), 'tests', 'fixtures', 'raw', 'small.dng')
    expect((await raw(['--info', '--in', fixture])).json).toMatchObject({ width: 44, height: 60 })
    expect(await decode(fixture)).toMatchObject({ width: 44, height: 60 })
  })

  it('reads a RAW by its bytes, whatever it is called', async () => {
    const path = join(work, 'not-a-raw.txt')
    writeFileSync(path, dngBytes())
    expect((await raw(['--info', '--in', path])).json).toMatchObject({ width: 320, height: 240 })
  })

  it('answers a file that is not RAW with one failure JSON line', async () => {
    const input = join(work, 'garbage.nef')
    writeFileSync(input, 'definitely not a camera RAW file')
    for (const args of [
      ['--info', '--in', input],
      ['--in', input, '--out', join(work, 'garbage.rgb')],
    ]) {
      const r = await raw(args)
      expect(r.exitCode).toBe(1)
      expect(r.json).toEqual({
        ok: false,
        code: 'runtime-error',
        message: 'not a camera RAW file LibRaw can read',
      })
    }
  })

  it('answers bad arguments with the usage line', async () => {
    const r = await raw(['--in', dng()])
    expect(r.exitCode).toBe(1)
    expect(r.json).toMatchObject({ ok: false, message: expect.stringMatching(/^usage:/) })
  })
})
