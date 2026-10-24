import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import sharp from 'sharp'
import { beforeAll, describe, expect, it } from 'vitest'

/**
 * The boost payload's child-process contract (plan: shared contracts), run
 * against the real esbuild bundle. The model is ~5 MB and comes from
 * `node extensions/boost/build.mjs` (cached in extensions/boost/.cache/), so
 * the test that runs it is skipped where that file is absent, e.g. CI.
 */
const run = promisify(execFile)
const boostDir = join(process.cwd(), 'extensions', 'boost')
const model = JSON.parse(readFileSync(join(boostDir, 'model.json'), 'utf8')) as {
  file: string
  sha256: string
}
const cachedModel = join(boostDir, '.cache', model.file)
const haveModel =
  existsSync(cachedModel) &&
  createHash('sha256').update(readFileSync(cachedModel)).digest('hex') === model.sha256

let payload: string
let work: string

beforeAll(async () => {
  work = mkdtempSync(join(tmpdir(), 'forge-boost-'))
  payload = join(work, 'payload')
  // This machine's own ONNX Runtime binaries, so the model test runs here: macOS, Windows or Linux.
  await run(process.execPath, [
    join(boostDir, 'build.mjs'),
    '--platform',
    process.platform,
    '--arch',
    process.arch,
    '--out',
    payload,
    '--runner-only',
  ])
  if (haveModel) copyFileSync(cachedModel, join(payload, model.file))
}, 60_000)

interface Reply {
  exitCode: number
  json: Record<string, unknown>
  lines: number
}

async function boost(input: string, out: string, scale: number): Promise<Reply> {
  const args = [join(payload, 'runner.mjs'), '--in', input, '--out', out, '--scale', String(scale)]
  try {
    const { stdout } = await run(process.execPath, args)
    return { exitCode: 0, json: JSON.parse(stdout), lines: stdout.trim().split('\n').length }
  } catch (err) {
    const e = err as { code: number; stdout: string }
    return {
      exitCode: e.code,
      json: JSON.parse(e.stdout),
      lines: e.stdout.trim().split('\n').length,
    }
  }
}

describe('boost runner', () => {
  it('answers garbage input with one runtime-error JSON line', async () => {
    const input = join(work, 'garbage.png')
    writeFileSync(input, 'definitely not a PNG')
    const r = await boost(input, join(work, 'garbage-out.png'), 2)
    expect(r.exitCode).not.toBe(0)
    expect(r.lines).toBe(1)
    expect(r.json).toMatchObject({ ok: false, code: 'runtime-error' })
  })

  it('refuses an output past 16384 px a side before running, naming the factor that fits', async () => {
    const input = join(work, 'wide.png')
    await sharp({ create: { width: 4100, height: 50, channels: 3, background: '#808080' } })
      .png()
      .toFile(input)
    const out = join(work, 'wide-out.png')
    const r = await boost(input, out, 4)
    expect(r.exitCode).not.toBe(0)
    expect(r.json).toMatchObject({ ok: false, code: 'boost-too-large' })
    expect(r.json.message).toContain('The largest factor that fits is 3×.')
    expect(existsSync(out)).toBe(false)
  })

  it('refuses 4× where 3× fits, naming 3× as the largest that does', async () => {
    // 5000 px wide: 4× is 20,000 px, 3× is 15,000.
    const input = join(work, 'five-k.png')
    await sharp({ create: { width: 5000, height: 50, channels: 3, background: '#808080' } })
      .png()
      .toFile(input)
    const r = await boost(input, join(work, 'five-k-out.png'), 4)
    expect(r.json).toMatchObject({ ok: false, code: 'boost-too-large' })
    expect(r.json.message).toContain('The largest factor that fits is 3×.')
  })

  it('refuses a scale it does not have, with one usage line', async () => {
    const input = join(work, 'tiny.png')
    await sharp({ create: { width: 8, height: 8, channels: 3, background: '#808080' } })
      .png()
      .toFile(input)
    const r = await boost(input, join(work, 'tiny-out.png'), 5)
    expect(r.exitCode).not.toBe(0)
    expect(r.json).toMatchObject({ ok: false, code: 'runtime-error' })
    expect(r.json.message).toContain('--scale 1|2|3|4')
  })

  it.skipIf(!haveModel)(
    'sharpens a 64 px PNG at its size (1×) and boosts it to 128 px (2×), 192 px (3×) and 256 px (4×), keeping its alpha',
    async () => {
      // Opaque disc on a transparent background.
      const size = 64
      const px = Buffer.alloc(size * size * 4)
      for (let y = 0; y < size; y++)
        for (let x = 0; x < size; x++) {
          const i = (y * size + x) * 4
          const inside = (x - 32) ** 2 + (y - 32) ** 2 < 20 ** 2
          px.set([200, (x * 4) % 256, (y * 4) % 256, inside ? 255 : 0], i)
        }
      const input = join(work, 'disc.png')
      await sharp(px, { raw: { width: size, height: size, channels: 4 } })
        .png()
        .toFile(input)

      for (const scale of [1, 2, 3, 4]) {
        const out = join(work, `disc-${scale}x.png`)
        const r = await boost(input, out, scale)
        expect(r.exitCode).toBe(0)
        expect(r.lines).toBe(1)
        expect(r.json).toMatchObject({ ok: true, width: size * scale, height: size * scale })
        const { data, info } = await sharp(out).raw().toBuffer({ resolveWithObject: true })
        expect([info.width, info.height, info.channels]).toEqual([size * scale, size * scale, 4])
        const alphaAt = (x: number, y: number) => data[(y * info.width + x) * 4 + 3]
        expect(alphaAt(0, 0)).toBe(0)
        expect(alphaAt(info.width - 1, info.height - 1)).toBe(0)
        expect(alphaAt(info.width / 2, info.height / 2)).toBe(255)
      }
    },
    // Four model runs; on Linux, and on a GPU-less Windows, they are on the CPU.
    180_000,
  )
})
