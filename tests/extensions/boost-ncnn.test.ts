import { execFile, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { beforeAll, describe, expect, it } from 'vitest'
import { looksBroken } from '../../extensions/boost/engine-ncnn.js'
// @ts-expect-error build scripts are plain .mjs
import { KEEP, layerSwitches } from '../../extensions/boost/ncnn/build-worker.mjs'
// @ts-expect-error build scripts are plain .mjs
import { onnxToNcnn } from '../../extensions/boost/ncnn/onnx-to-ncnn.mjs'
// @ts-expect-error build scripts are plain .mjs
import { readPng, writeRgbPng } from '../../scripts/verify-extension-payload.mjs'
import { serveJobs } from '../helpers/boost-serve.js'

/**
 * Boost on Linux: the ONNX → ncnn model conversion, the layer list of the
 * native build, and the Node side of the ncnn engine run for real
 * (runner.mjs, as bundled for Linux) against a stand-in worker that speaks
 * forge-ncnn's protocol with no model. The native program itself, and the
 * model through it, are measured by hand (see the branch report).
 */
const run = promisify(execFile)
const root = process.cwd()
const boostDir = join(root, 'extensions', 'boost')
const model = JSON.parse(readFileSync(join(boostDir, 'model.json'), 'utf8')) as {
  file: string
  sha256: string
}
const cachedModel = join(boostDir, '.cache', model.file)
const sha = (b: Buffer | string) => createHash('sha256').update(b).digest('hex')
const haveModel = existsSync(cachedModel) && sha(readFileSync(cachedModel)) === model.sha256

describe('onnxToNcnn', () => {
  it.skipIf(!haveModel)(
    'writes the pinned model as the same 72 ncnn layers, weights unchanged',
    () => {
      const { param, bin } = onnxToNcnn(readFileSync(cachedModel))
      const lines = param.trim().split('\n')
      expect(lines[0]).toBe('7767517')
      expect(lines[1]).toBe('72 73')
      expect(lines).toHaveLength(2 + 72)
      expect(lines.filter((l: string) => l.startsWith('Convolution'))).toHaveLength(34)
      expect(lines.filter((l: string) => l.startsWith('PReLU'))).toHaveLength(33)
      // 34 weight tags, every weight and bias as a 32-bit float, and 33 PReLU slopes.
      expect(bin.length).toBe(4_853_320)
      // The output is pinned: a different file means the converter or the model changed.
      expect(sha(param)).toBe('38603e272fe680a72af9e60ed614831e013f5565fefe02e4b872eb301c9e5755')
      expect(sha(bin)).toBe('a2dbacadd361d59593f8f5c60dae448efdbda714d8b7dab7c7c61cc4d6ecff52')
    },
  )

  it('refuses a file that is not an ONNX model', () => {
    expect(() => onnxToNcnn(Buffer.from('not a model at all'))).toThrow()
  })

  it('refuses an ONNX graph that is not realesr-general-x4v3', () => {
    // A graph of one Relu node: protobuf by hand (ModelProto.graph = 7, GraphProto.node = 1, NodeProto.op_type = 4).
    const ld = (field: number, body: Buffer) =>
      Buffer.concat([Buffer.from([(field << 3) | 2, body.length]), body])
    const node = ld(4, Buffer.from('Relu'))
    const graph = ld(1, node)
    expect(() => onnxToNcnn(ld(7, graph))).toThrow(/not realesr-general-x4v3/)
  })
})

describe('layerSwitches', () => {
  const cmake = (names: string[]) => names.map((n) => `ncnn_add_layer(${n})`).join('\n')
  const many = Array.from({ length: 100 }, (_, i) => `Filler${i}`)

  it('turns off every layer the model does not use, and none it does', () => {
    const off: string[] = layerSwitches(cmake([...KEEP, ...many, 'Softmax']))
    expect(off).toContain('-DWITH_LAYER_softmax=OFF')
    expect(off).toContain('-DWITH_LAYER_filler0=OFF')
    expect(off).toHaveLength(101)
    for (const k of KEEP as string[])
      expect(off).not.toContain(`-DWITH_LAYER_${k.toLowerCase()}=OFF`)
  })

  it('stops if ncnn has no layer it is told to keep, or the list cannot be found', () => {
    expect(() => layerSwitches(cmake([...many, 'Input']))).toThrow(/no layer/)
    expect(() => layerSwitches('project(ncnn)')).toThrow(/layer list/)
  })
})

describe('looksBroken', () => {
  it('is false for a tile that varies', () => {
    expect(looksBroken(Float32Array.from({ length: 5000 }, (_, i) => (i % 17) / 17))).toBe(false)
  })
  it('is true for a tile of one value, or with a NaN in it', () => {
    expect(looksBroken(new Float32Array(5000))).toBe(true)
    const nan = Float32Array.from({ length: 5000 }, (_, i) => i / 5000)
    nan[997] = Number.NaN
    expect(looksBroken(nan)).toBe(true)
  })
})

// The engine, end to end. Not on Windows: the stand-in is a script run through its shebang.
describe.skipIf(process.platform === 'win32')(
  'the ncnn engine (runner.mjs with a stand-in worker)',
  () => {
    let work: string
    let payload: string

    beforeAll(async () => {
      work = mkdtempSync(join(tmpdir(), 'forge-boost-ncnn-'))
      payload = join(work, 'payload')
      // runner.mjs as bundled for Linux (the ncnn engine), whatever this machine is.
      await run(process.execPath, [
        join(boostDir, 'build.mjs'),
        '--platform',
        'linux',
        '--arch',
        'x64',
        '--out',
        payload,
        '--runner-only',
      ])
      copyFileSync(
        join(root, 'tests', 'fixtures', 'boost', 'fake-forge-ncnn.mjs'),
        join(payload, 'forge-ncnn'),
      )
      chmodSync(join(payload, 'forge-ncnn'), 0o755)
      writeFileSync(join(payload, 'realesr-general-x4v3.param'), '')
      writeFileSync(join(payload, 'realesr-general-x4v3.bin'), '')
    }, 60_000)

    interface Reply {
      exitCode: number
      result: Record<string, unknown>
      progress: Array<[number, number]>
      stderr: string
    }

    async function boost(
      input: string,
      out: string,
      scale: number,
      env: Record<string, string> = {},
      extra: string[] = [],
    ): Promise<Reply> {
      const args = [
        join(payload, 'runner.mjs'),
        '--in',
        input,
        '--out',
        out,
        '--scale',
        String(scale),
        ...extra,
      ]
      const opts = {
        env: { ...process.env, FORGE_BOOST_ENGINE: 'ncnn', ...env },
        maxBuffer: 1 << 26,
      }
      let exitCode = 0
      let stdout = ''
      let stderr = ''
      try {
        ;({ stdout, stderr } = await run(process.execPath, args, opts))
      } catch (err) {
        const e = err as { code: number; stdout: string; stderr: string }
        exitCode = e.code
        stdout = e.stdout
        stderr = e.stderr
      }
      const lines = stdout.trim().split('\n')
      return {
        exitCode,
        result: JSON.parse(lines.at(-1) ?? '{}'),
        progress: lines
          .filter((l) => l.startsWith('{"progress"'))
          .map((l) => JSON.parse(l))
          .map((p: { progress: number; of: number }) => [p.progress, p.of]),
        stderr,
      }
    }

    /** A 520 × `h` image (3 tiles across; 3 × 2 for 300, 3 × 3 for 500) whose colour says where each pixel is. */
    function gradient(name: string, h = 300): string {
      const path = join(work, name)
      writeRgbPng(path, 520, h, (x: number, y: number) => [x % 256, y % 256, (x + y) % 256])
      return path
    }

    it('makes a 4× image tile by tile and puts every pixel where it belongs', async () => {
      const input = gradient('in4.png')
      const out = join(work, 'out4.png')
      const r = await boost(input, out, 4)
      expect(r.exitCode).toBe(0)
      expect(r.result).toMatchObject({ ok: true, width: 2080, height: 1200 })
      // One line a tile, from none done to all six.
      expect(r.progress.map((p) => p[0])).toEqual([0, 1, 2, 3, 4, 5, 6])
      expect(new Set(r.progress.map((p) => p[1]))).toEqual(new Set([6]))
      // The stand-in enlarges by nearest neighbour, so each input pixel must fill a 4 × 4 block, seams included.
      const png = readPng(out)
      for (const [x, y] of [
        [0, 0],
        [223, 223],
        [224, 224],
        [225, 100],
        [519, 299],
        [300, 150],
      ] as const) {
        for (const [dx, dy] of [
          [0, 0],
          [3, 3],
          [1, 2],
        ] as const) {
          const i = ((y * 4 + dy) * png.width + x * 4 + dx) * png.channels
          expect([png.px[i], png.px[i + 1], png.px[i + 2]], `${x},${y}+${dx},${dy}`).toEqual([
            x % 256,
            y % 256,
            (x + y) % 256,
          ])
        }
      }
    })

    it('brings 2× and 1× down from the 4× tile, keeping the size the factor says', async () => {
      const input = gradient('in2.png')
      const two = await boost(input, join(work, 'out2.png'), 2)
      expect(two.result).toMatchObject({ ok: true, width: 1040, height: 600 })
      const one = await boost(input, join(work, 'out1.png'), 1)
      expect(one.result).toMatchObject({ ok: true, width: 520, height: 300 })
    })

    it('runs on the processor when there is no graphics device', async () => {
      const log = join(work, 'log-cpu.txt')
      await boost(gradient('a.png'), join(work, 'a-out.png'), 1, { FAKE_LOG: log })
      expect(readFileSync(log, 'utf8').trim().split('\n')).toEqual(['cpu'])
    })

    it('never starts a worker on a software adapter, and says nothing of it as an error', async () => {
      const log = join(work, 'log-soft.txt')
      const r = await boost(gradient('b.png'), join(work, 'b-out.png'), 1, {
        FAKE_LOG: log,
        FAKE_DEVICES: JSON.stringify([
          { index: 0, name: 'llvmpipe (LLVM 17.0.6, 256 bits)', kind: 'cpu' },
        ]),
      })
      expect(r.exitCode).toBe(0)
      expect(readFileSync(log, 'utf8').trim().split('\n')).toEqual(['cpu'])
    })

    it('runs on a real card when there is one, and keeps it when it is quicker than the processor', async () => {
      const log = join(work, 'log-gpu.txt')
      const r = await boost(gradient('c.png', 500), join(work, 'c-out.png'), 1, {
        FAKE_LOG: log,
        FAKE_DEVICES: JSON.stringify([{ index: 0, name: 'Quick Card', kind: 'discrete' }]),
        FAKE_GPU_MS: '1',
        FAKE_MS: '150',
      })
      expect(r.exitCode).toBe(0)
      // A card first; after its second tile the processor is started to compare (nine tiles are worth it); the card stays.
      expect(readFileSync(log, 'utf8').trim().split('\n')).toEqual(['gpu 0', 'cpu'])
      expect(r.stderr).toMatch(/Quick Card: .* ms a tile, processor: .* ms; using Quick Card/)
    })

    it('goes over to the processor when the card is slower than it', async () => {
      const r = await boost(gradient('d.png', 500), join(work, 'd-out.png'), 1, {
        FAKE_DEVICES: JSON.stringify([{ index: 0, name: 'Slow Chip', kind: 'integrated' }]),
        FAKE_GPU_MS: '150',
        FAKE_MS: '1',
      })
      expect(r.exitCode).toBe(0)
      expect(r.stderr).toMatch(/using the processor/)
      expect(r.result).toMatchObject({ ok: true, width: 520, height: 500 })
    })

    it('drops a card that answers with nothing and finishes on the processor', async () => {
      const out = join(work, 'e-out.png')
      const r = await boost(gradient('e.png', 500), out, 4, {
        FAKE_DEVICES: JSON.stringify([{ index: 0, name: 'Broken Driver', kind: 'discrete' }]),
        FAKE_BROKEN: '1',
      })
      expect(r.exitCode).toBe(0)
      expect(r.stderr).toMatch(/gave no usable tile/)
      const png = readPng(out)
      const i = (4 * png.width + 4 * 7) * png.channels
      expect([png.px[i], png.px[i + 1], png.px[i + 2]]).toEqual([7, 1, 8])
    })

    it('does not start the card at all when told to use the processor', async () => {
      const log = join(work, 'log-off.txt')
      await boost(gradient('f.png'), join(work, 'f-out.png'), 1, {
        FAKE_LOG: log,
        FORGE_BOOST_DEVICE: 'cpu',
        FAKE_DEVICES: JSON.stringify([{ index: 0, name: 'Quick Card', kind: 'discrete' }]),
      })
      expect(readFileSync(log, 'utf8').trim().split('\n')).toEqual(['cpu'])
    })

    it('answers a worker that will not start with one runtime-error line', async () => {
      const r = await boost(gradient('g.png'), join(work, 'g-out.png'), 1, { FAKE_DIE: '1' })
      expect(r.exitCode).toBe(1)
      expect(r.result).toMatchObject({ ok: false, code: 'runtime-error' })
    })

    it('lets a job that is slow but inside fifteen minutes run (the guard is not the old three minutes)', async () => {
      // 200 ms a tile over nine tiles: far under the limit, so it runs.
      const r = await boost(gradient('h.png', 500), join(work, 'h-out.png'), 1, { FAKE_MS: '200' })
      expect(r.result).toMatchObject({ ok: true })
    })

    it('reports a missing worker as a runtime error naming the file', async () => {
      const bare = join(work, 'bare')
      await run(process.execPath, [
        join(boostDir, 'build.mjs'),
        '--platform',
        'linux',
        '--arch',
        'x64',
        '--out',
        bare,
        '--runner-only',
      ])
      const r = await run(
        process.execPath,
        [
          join(bare, 'runner.mjs'),
          '--in',
          gradient('i.png'),
          '--out',
          join(work, 'i-out.png'),
          '--scale',
          '2',
        ],
        {
          env: { ...process.env, FORGE_BOOST_ENGINE: 'ncnn' },
        },
      ).catch((e: { stdout: string }) => e)
      const line = JSON.parse(
        String((r as { stdout: string }).stdout)
          .trim()
          .split('\n')
          .at(-1) ?? '{}',
      )
      expect(line).toMatchObject({ ok: false, code: 'runtime-error' })
      expect(line.message).toMatch(/forge-ncnn/)
    })

    const lines = (file: string) => readFileSync(file, 'utf8').trim().split('\n')
    const ncnnEnv = (env: Record<string, string>) => ({
      ...process.env,
      FORGE_BOOST_ENGINE: 'ncnn',
      ...env,
    })

    describe('--serve: one process for many images', () => {
      it('lists the devices and checks the card against the processor once for three images', async () => {
        const log = join(work, 'log-serve.txt')
        const listed = join(work, 'devices-serve.txt')
        const input = gradient('s.png', 500)
        const outs = [4, 2, 1].map((s) => join(work, `s-out-${s}.png`))
        const r = await serveJobs(
          join(payload, 'runner.mjs'),
          [4, 2, 1].map((s, i) => [
            '--in',
            input,
            '--out',
            outs[i] as string,
            '--scale',
            String(s),
          ]),
          ncnnEnv({
            FAKE_LOG: log,
            FAKE_DEVICES_LOG: listed,
            FAKE_DEVICES: JSON.stringify([{ index: 0, name: 'Quick Card', kind: 'discrete' }]),
            FAKE_GPU_MS: '1',
            FAKE_MS: '150',
          }),
        )
        expect(r.exitCode).toBe(0)
        expect(r.results).toMatchObject([
          { ok: true, width: 2080, height: 2000 },
          { ok: true, width: 1040, height: 1000 },
          { ok: true, width: 520, height: 500 },
        ])
        // Each job counts its own nine tiles, from none done to all.
        for (const p of r.progress) expect(p).toEqual([...Array(10).keys()].map((i) => [i, 9]))
        expect(lines(listed)).toEqual(['devices'])
        expect(lines(log)).toEqual(['gpu 0', 'cpu'])
        expect(r.stderr.match(/ms a tile/g)).toHaveLength(1)
        // The card kept on for the second and third images makes the same pixels.
        const png = readPng(outs[0])
        const i = ((150 * 4 + 1) * png.width + 300 * 4 + 2) * png.channels
        expect([png.px[i], png.px[i + 1], png.px[i + 2]]).toEqual([300 % 256, 150, 450 % 256])
      })

      it('answers a job it cannot do and goes on with the next', async () => {
        const garbage = join(work, 'serve-garbage.png')
        writeFileSync(garbage, 'not a PNG')
        const input = gradient('t.png')
        const job = (i: string, scale: string) => [
          '--in',
          i,
          '--out',
          join(work, `t-out-${scale}.png`),
          '--scale',
          scale,
        ]
        const r = await serveJobs(
          join(payload, 'runner.mjs'),
          [job(garbage, '2'), job(input, '2'), job(input, '5'), job(input, '1')],
          ncnnEnv({}),
        )
        expect(r.exitCode).toBe(0)
        expect(r.results).toMatchObject([
          { ok: false, code: 'runtime-error' },
          { ok: true, width: 1040, height: 600 },
          { ok: false, code: 'runtime-error' },
          { ok: true, width: 520, height: 300 },
        ])
        expect(r.results[2]?.message).toContain('--scale 1|2|3|4')
      })

      it('exits when its input closes with nothing asked of it', async () => {
        const r = await serveJobs(join(payload, 'runner.mjs'), [], ncnnEnv({}))
        expect(r).toMatchObject({ exitCode: 0, results: [] })
      })

      it('stops at once, answering nothing, when its input closes mid-image (Forge is gone)', async () => {
        const child = spawn(process.execPath, [join(payload, 'runner.mjs'), '--serve'], {
          env: ncnnEnv({ FAKE_MS: '400' }),
        })
        let out = ''
        const t0 = performance.now()
        const closed = new Promise<number | null>((r) => child.on('close', r))
        child.stdout.setEncoding('utf8').on('data', (d: string) => {
          out += d
          if (out.includes('{"progress":1,')) child.stdin.end()
        })
        const input = gradient('u.png', 500)
        const job = ['--in', input, '--out', join(work, 'u-out.png'), '--scale', '1']
        child.stdin.write(`${JSON.stringify({ args: job })}\n`)
        expect(await closed).toBe(0)
        // Nine tiles at 400 ms would be 3.6 s; it stopped after the first or second.
        expect(performance.now() - t0).toBeLessThan(2500)
        expect(out).not.toContain('"ok"')
      })

      it('does not check the card on an image too small to be worth it, and does on a larger one after', async () => {
        const log = join(work, 'log-small.txt')
        const small = gradient('v-small.png', 200) // 3 × 1 tiles
        const large = gradient('v-large.png', 500) // 3 × 3
        const r = await serveJobs(
          join(payload, 'runner.mjs'),
          [small, large].map((i, n) => [
            '--in',
            i,
            '--out',
            join(work, `v-out-${n}.png`),
            '--scale',
            '1',
          ]),
          ncnnEnv({
            FAKE_LOG: log,
            FAKE_DEVICES: JSON.stringify([{ index: 0, name: 'Quick Card', kind: 'discrete' }]),
            FAKE_GPU_MS: '1',
            FAKE_MS: '150',
          }),
        )
        expect(r.results).toMatchObject([{ ok: true }, { ok: true }])
        expect(lines(log)).toEqual(['gpu 0', 'cpu'])
        expect(r.stderr).toMatch(/Quick Card: .* ms a tile, processor: .* ms; using Quick Card/)
      })
    })

    describe('--cache: the card-or-processor choice is remembered', () => {
      const card = (driver: number) =>
        JSON.stringify([
          {
            index: 0,
            name: 'Quick Card',
            kind: 'discrete',
            vendor: 4318,
            deviceId: 8708,
            driver,
          },
        ])
      const choices = (cache: string) =>
        JSON.parse(readFileSync(join(cache, 'ncnn-devices.json'), 'utf8')) as Record<
          string,
          { use: string }
        >

      async function twice(env: Record<string, string>, second = env) {
        const cache = mkdtempSync(join(work, 'cache-'))
        const log = join(cache, 'log.txt')
        const input = gradient(`w-${cache.slice(-6)}.png`, 500)
        const out = join(cache, 'out.png')
        const first = await boost(input, out, 1, { ...env, FAKE_LOG: log }, ['--cache', cache])
        const firstLog = lines(log)
        writeFileSync(log, '')
        const again = await boost(input, out, 1, { ...second, FAKE_LOG: log }, ['--cache', cache])
        return { cache, first, again, firstLog, againLog: lines(log) }
      }

      it('starts the card alone next time when it was the quicker', async () => {
        const r = await twice({ FAKE_DEVICES: card(1), FAKE_GPU_MS: '1', FAKE_MS: '150' })
        expect(r.firstLog).toEqual(['gpu 0', 'cpu'])
        expect(choices(r.cache)).toMatchObject({
          'Quick Card [10de:2204] driver 1': { use: 'card' },
        })
        expect(r.again.result).toMatchObject({ ok: true, width: 520, height: 500 })
        expect(r.againLog).toEqual(['gpu 0'])
        expect(r.again.stderr).not.toMatch(/ms a tile/)
      })

      it('does not start the card again when the processor was the quicker', async () => {
        const r = await twice({ FAKE_DEVICES: card(1), FAKE_GPU_MS: '150', FAKE_MS: '1' })
        expect(r.firstLog).toEqual(['gpu 0', 'cpu'])
        expect(choices(r.cache)).toMatchObject({
          'Quick Card [10de:2204] driver 1': { use: 'cpu' },
        })
        expect(r.again.result).toMatchObject({ ok: true })
        expect(r.againLog).toEqual(['cpu'])
      })

      it('remembers a card that gave nothing as the processor', async () => {
        const r = await twice({ FAKE_DEVICES: card(1), FAKE_BROKEN: '1' })
        expect(r.firstLog).toEqual(['gpu 0', 'cpu'])
        expect(r.againLog).toEqual(['cpu'])
      })

      it('measures again under a new driver, keeping what it knew of the old', async () => {
        const quick = { FAKE_GPU_MS: '1', FAKE_MS: '150' }
        const r = await twice(
          { ...quick, FAKE_DEVICES: card(1) },
          { ...quick, FAKE_DEVICES: card(2) },
        )
        expect(r.againLog).toEqual(['gpu 0', 'cpu'])
        expect(Object.keys(choices(r.cache)).sort()).toEqual([
          'Quick Card [10de:2204] driver 1',
          'Quick Card [10de:2204] driver 2',
        ])
      })

      it('measures again when what it remembered cannot be read', async () => {
        const r = await twice({ FAKE_DEVICES: card(1), FAKE_GPU_MS: '1', FAKE_MS: '150' })
        writeFileSync(join(r.cache, 'ncnn-devices.json'), '{ torn')
        const log = join(r.cache, 'log.txt')
        writeFileSync(log, '')
        const third = await boost(
          gradient('x.png', 500),
          join(r.cache, 'x.png'),
          1,
          { FAKE_DEVICES: card(1), FAKE_GPU_MS: '1', FAKE_MS: '150', FAKE_LOG: log },
          ['--cache', r.cache],
        )
        expect(third.result).toMatchObject({ ok: true })
        expect(lines(log)).toEqual(['gpu 0', 'cpu'])
        expect(Object.keys(choices(r.cache))).toEqual(['Quick Card [10de:2204] driver 1'])
      })
    })
  },
)
