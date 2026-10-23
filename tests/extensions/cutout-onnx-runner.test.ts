import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  copyFileSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import sharp from 'sharp'
import { beforeAll, describe, expect, it } from 'vitest'
import { isForgeError } from '../../src/core/errors.js'
import { runExtension } from '../../src/extensions/run.js'

/**
 * The Windows and Linux cutout payload's child-process contract — the same
 * one as the macOS helper's (cutout.test.ts) — run against the real esbuild
 * bundle. The model is 4.6 MB and comes from
 * `node extensions/remove-background-onnx/build.mjs` (cached in
 * extensions/boost/.cache/), so the tests that run it are skipped where that
 * file is absent, e.g. CI, and on macOS, which has no build of this runner.
 */
const run = promisify(execFile)
const extDir = join(process.cwd(), 'extensions', 'remove-background-onnx')
const model = JSON.parse(readFileSync(join(extDir, 'model.json'), 'utf8')) as {
  file: string
  sha256: string
}
const cachedModel = join(process.cwd(), 'extensions', 'boost', '.cache', model.file)
const haveModel =
  existsSync(cachedModel) &&
  createHash('sha256').update(readFileSync(cachedModel)).digest('hex') === model.sha256
// Its binaries load on Windows and Linux; on a Mac the contract tests that stop
// before ONNX Runtime still run, against the Linux build.
const here = process.platform === 'win32' || process.platform === 'linux'
const platform = process.platform === 'win32' ? 'win32' : 'linux'

let payload: string
let work: string

beforeAll(async () => {
  work = mkdtempSync(join(tmpdir(), 'forge-cutout-onnx-'))
  payload = join(work, 'payload')
  await run(process.execPath, [
    join(extDir, 'build.mjs'),
    '--platform',
    platform,
    '--arch',
    process.arch === 'arm64' ? 'arm64' : 'x64',
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

async function cutout(...args: string[]): Promise<Reply> {
  try {
    const { stdout } = await run(process.execPath, [join(payload, 'runner.mjs'), ...args])
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

/** A figure on a flat light background: the macOS helper's test picture. */
async function figure(path: string, alpha = false): Promise<void> {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400">
    <rect width="400" height="400" fill="#e8e8e8"/>
    <ellipse cx="200" cy="215" rx="95" ry="130" fill="#c0392b"/>
    <circle cx="200" cy="105" r="55" fill="#e0a070"/></svg>`
  if (!alpha) return void (await sharp(Buffer.from(svg)).png().toFile(path))
  // A transparent band down the middle: alpha the image already had must survive.
  const { data, info } = await sharp(Buffer.from(svg))
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  for (let y = 0; y < info.height; y++)
    for (let x = 180; x < 220; x++) data[(y * info.width + x) * 4 + 3] = 0
  await sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } })
    .png()
    .toFile(path)
}

describe('remove-background runner (ONNX)', () => {
  it('answers garbage input with one runtime-error JSON line', async () => {
    const input = join(work, 'garbage.png')
    writeFileSync(input, 'definitely not a PNG')
    const r = await cutout(input, join(work, 'garbage-out.png'))
    expect(r.exitCode).toBe(1)
    expect(r.lines).toBe(1)
    expect(r.json).toMatchObject({ ok: false, code: 'runtime-error' })
    expect(r.json.message).toContain('not a readable PNG')
  })

  it("takes the macOS helper's arguments, <in> <out>, and nothing else", async () => {
    const r = await cutout('--in', 'a.png', '--out', 'b.png')
    expect(r.exitCode).toBe(1)
    expect(r.json).toMatchObject({ ok: false, code: 'runtime-error' })
    expect(r.json.message).toContain('<in.png> <out.png>')
  })

  it.skipIf(!haveModel || !here)(
    'cuts a clear subject out of a flat background: same size, clear corners, opaque middle, RGB kept',
    async () => {
      const input = join(work, 'subject.png')
      const out = join(work, 'subject-cutout.png')
      await figure(input)
      const r = await cutout(input, out)
      expect(r.exitCode).toBe(0)
      expect(r.lines).toBe(1)
      expect(r.json).toMatchObject({ ok: true, width: 400, height: 400 })
      const { data, info } = await sharp(out).raw().toBuffer({ resolveWithObject: true })
      expect([info.width, info.height, info.channels]).toEqual([400, 400, 4])
      const at = (x: number, y: number, c: number) => data[(y * 400 + x) * 4 + c] ?? -1
      for (const [x, y] of [
        [2, 2],
        [397, 2],
        [2, 397],
        [397, 397],
      ] as const)
        expect(at(x, y, 3)).toBeLessThan(10)
      expect(at(200, 230, 3)).toBeGreaterThan(245)
      // The body's red, as drawn: the runner only adds alpha.
      expect([at(200, 230, 0), at(200, 230, 1), at(200, 230, 2)]).toEqual([0xc0, 0x39, 0x2b])
    },
    120_000,
  )

  it.skipIf(!haveModel || !here)(
    'keeps the transparency the image already had',
    async () => {
      const input = join(work, 'subject-alpha.png')
      const out = join(work, 'subject-alpha-cutout.png')
      await figure(input, true)
      const r = await cutout(input, out)
      expect(r.json).toMatchObject({ ok: true })
      const { data } = await sharp(out).raw().toBuffer({ resolveWithObject: true })
      // Inside the figure's body: clear in the band that already was, opaque beside it.
      expect(data[(230 * 400 + 200) * 4 + 3]).toBe(0)
      expect(data[(230 * 400 + 150) * 4 + 3]).toBeGreaterThan(245)
    },
    120_000,
  )

  it.skipIf(!haveModel || !here)(
    'reports no-subject for a flat grey image, writes nothing, and Forge maps it to no-subject',
    async () => {
      const input = join(work, 'flat.png')
      const out = join(work, 'flat-out.png')
      await sharp({ create: { width: 200, height: 200, channels: 3, background: '#808080' } })
        .png()
        .toFile(input)
      const r = await cutout(input, out)
      expect(r.exitCode).toBe(2)
      expect(r.lines).toBe(1)
      expect(r.json).toMatchObject({ ok: false, code: 'no-subject' })
      expect(existsSync(out)).toBe(false)

      // As Forge runs it (src/extensions/run.ts): a node-kind entry.
      const ext = { entry: join(payload, 'runner.mjs'), kind: 'node' as const }
      const err = await runExtension(ext, [input, out]).catch((e: unknown) => e)
      expect(isForgeError(err) && err.code).toBe('no-subject')
      const ok = await runExtension(ext, [join(work, 'subject.png'), join(work, 'again.png')])
      expect(ok).toMatchObject({ width: 400, height: 400 })
    },
    120_000,
  )

  it.skipIf(!haveModel || !here)(
    'writes nothing but its output',
    async () => {
      const before = readdirSync(payload).sort()
      await cutout(join(work, 'subject.png'), join(work, 'once-more.png'))
      expect(readdirSync(payload).sort()).toEqual(before)
    },
    120_000,
  )
})
