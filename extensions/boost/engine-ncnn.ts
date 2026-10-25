/**
 * The tile engine on ncnn, for Linux (x64 and arm64): forge-ncnn, a small
 * native program beside runner.mjs, runs the model one tile at a time and this
 * file talks to it over pipes (forge-ncnn.cpp says how).
 *
 * It runs on a Vulkan graphics card when there is a real one and on the
 * processor when there is not. A "device" that is the processor in disguise
 * (llvmpipe, SwiftShader) is turned away by its name (providers.ts). A real one
 * is still checked against the processor, because a small integrated chip can
 * be slower than the cores beside it: the first two tiles run on the card, the
 * same tile is then timed twice on the processor, and the run goes on with
 * whichever was quicker.
 */

import { execFile, spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { TILE_OUT, type TileEngine } from './engine.js'
import { type Device, pickDevice } from './providers.js'

const execFileAsync = promisify(execFile)

const WORKER = 'forge-ncnn'
const PARAM = 'realesr-general-x4v3.param'
const BIN = 'realesr-general-x4v3.bin'
const FLOATS_OUT = 3 * TILE_OUT * TILE_OUT
/** Images of fewer tiles than this are not worth checking the card against the processor for. */
const CHECK_FROM_TILES = 8
/** The processor must beat the card by this much (a tenth) to take over. */
const CPU_MUST_BEAT = 0.9

const here = (name: string): string => fileURLToPath(new URL(`./${name}`, import.meta.url))

/** The Vulkan devices ncnn sees; none if there is no loader or driver, or the program will not run. */
export async function listDevices(): Promise<Device[]> {
  try {
    const { stdout } = await execFileAsync(here(WORKER), ['--devices'], { timeout: 20_000 })
    const parsed = JSON.parse(stdout.trim().split('\n').at(-1) ?? '{}') as { devices?: Device[] }
    return parsed.devices ?? []
  } catch (err) {
    process.stderr.write(`could not list graphics devices: ${String(err)}\n`)
    return []
  }
}

interface Worker {
  /** The device the model runs on: "cpu", or the card's name. */
  device: string
  run(tile: Uint8Array): Promise<Float32Array>
  close(): Promise<void>
}

/** Starts forge-ncnn on the CPU (`gpu` undefined) or on a Vulkan device, and waits for it to say it is ready. */
function startWorker(gpu?: number): Promise<Worker> {
  const args = ['--param', here(PARAM), '--bin', here(BIN)]
  if (gpu !== undefined) args.push('--gpu', String(gpu))
  if (process.env.FORGE_BOOST_THREADS) args.push('--threads', process.env.FORGE_BOOST_THREADS)
  // The worker's own messages (ncnn is chatty about the graphics card) are kept for an error, not shown.
  const child = spawn(here(WORKER), args, { stdio: ['pipe', 'pipe', 'pipe'] })
  let said = ''
  child.stderr.on('data', (d: Buffer) => {
    said = (said + d.toString('utf8')).slice(-600)
  })

  const waiting: Array<{ resolve: (f: Float32Array) => void; reject: (e: Error) => void }> = []
  let device = 'cpu'
  let exited: Error | undefined
  let head = ''
  let ready: ((w: Worker) => void) | undefined
  let failed: ((e: Error) => void) | undefined
  let frame = new Float32Array(FLOATS_OUT)
  let filled = 0

  const stop = (err: Error): void => {
    exited ??= err
    failed?.(err)
    for (const w of waiting.splice(0)) w.reject(err)
  }
  child.on('error', (err) => stop(new Error(`cannot start ${WORKER}: ${err.message}`)))
  child.on('exit', (code, signal) => {
    const last = said.trim().split('\n').at(-1)
    stop(new Error(`${WORKER} stopped (${signal ?? `exit ${code}`})${last ? `: ${last}` : ''}`))
  })
  child.stdin.on('error', () => {}) // a worker that died is reported by its exit

  const worker: Worker = {
    get device() {
      return device
    },
    run(tile) {
      if (exited) return Promise.reject(exited)
      return new Promise<Float32Array>((resolve, reject) => {
        waiting.push({ resolve, reject })
        child.stdin.write(tile)
      })
    },
    close() {
      return new Promise<void>((resolve) => {
        if (child.exitCode !== null || child.signalCode !== null) return resolve()
        const timer = setTimeout(() => child.kill('SIGKILL'), 3000)
        child.once('exit', () => {
          clearTimeout(timer)
          resolve()
        })
        child.stdin.end()
      })
    },
  }

  child.stdout.on('data', (chunk: Buffer) => {
    let at = 0
    if (ready) {
      // Still on the first line, which is JSON.
      const nl = chunk.indexOf(10)
      head += chunk.toString('utf8', 0, nl < 0 ? chunk.length : nl)
      if (nl < 0) return
      at = nl + 1
      try {
        device = (JSON.parse(head) as { device?: string }).device ?? 'cpu'
      } catch {
        return stop(new Error(`${WORKER} said something unexpected: ${head.slice(0, 80)}`))
      }
      const done = ready
      ready = undefined
      done(worker)
    }
    while (at < chunk.length) {
      const bytes = new Uint8Array(frame.buffer)
      const take = Math.min(chunk.length - at, bytes.length - filled)
      bytes.set(chunk.subarray(at, at + take), filled)
      filled += take
      at += take
      if (filled === bytes.length) {
        const done = frame
        frame = new Float32Array(FLOATS_OUT)
        filled = 0
        waiting.shift()?.resolve(done)
      }
    }
  })

  return new Promise<Worker>((resolve, reject) => {
    ready = resolve
    failed = reject
  })
}

/** Whether a tile from a card is nonsense: not a number, or nothing but one value (a driver that did not compute). */
export function looksBroken(out: Float32Array): boolean {
  const first = out[0]
  let flat = true
  for (let i = 0; i < out.length; i += 997) {
    const v = out[i] as number
    if (Number.isNaN(v)) return true
    if (v !== first) flat = false
  }
  return flat
}

/**
 * Runs on the card for its first two tiles, then checks the processor on the
 * same tile and goes on with the quicker one. While it is deciding it answers
 * one tile at a time.
 */
class Checked implements TileEngine {
  private current: Worker
  private count = 0
  private decided = false
  private overheadMs = 0

  constructor(
    private readonly card: Worker,
    private readonly total: number,
  ) {
    this.current = card
  }

  get pipelined(): boolean {
    return this.decided
  }

  takeOverheadMs(): number {
    const ms = this.overheadMs
    this.overheadMs = 0
    return ms
  }

  async run(tile: Uint8Array): Promise<Float32Array> {
    if (this.decided) return this.current.run(tile)
    const t0 = performance.now()
    const out = await this.card.run(tile)
    const ms = performance.now() - t0
    if (this.count++ === 0) {
      if (looksBroken(out)) {
        process.stderr.write(`${this.card.device} gave no usable tile, using the processor\n`)
        await this.card.close()
        this.current = await startWorker()
        this.decided = true
        return this.current.run(tile)
      }
      if (this.total < CHECK_FROM_TILES) this.decided = true
      return out
    }
    const checking = performance.now()
    await this.choose(tile, ms)
    this.overheadMs += performance.now() - checking
    return out
  }

  /** Times `tile` twice on the processor (the first run packs the weights) against the card's steady tile. */
  private async choose(tile: Uint8Array, cardMs: number): Promise<void> {
    this.decided = true
    let cpu: Worker
    try {
      cpu = await startWorker()
    } catch (err) {
      process.stderr.write(`could not start the processor check: ${String(err)}\n`)
      return
    }
    await cpu.run(tile)
    const t0 = performance.now()
    await cpu.run(tile)
    const cpuMs = performance.now() - t0
    const useCpu = cpuMs < cardMs * CPU_MUST_BEAT
    process.stderr.write(
      `${this.card.device}: ${Math.round(cardMs)} ms a tile, processor: ${Math.round(cpuMs)} ms; using ${useCpu ? 'the processor' : this.card.device}\n`,
    )
    if (useCpu) {
      await this.card.close()
      this.current = cpu
    } else await cpu.close()
  }

  async close(): Promise<void> {
    await this.current.close()
  }
}

/** Plain: one worker, answering in order, one tile ahead. */
class Plain implements TileEngine {
  readonly pipelined = true
  constructor(private readonly worker: Worker) {}
  run(tile: Uint8Array): Promise<Float32Array> {
    return this.worker.run(tile)
  }
  close(): Promise<void> {
    return this.worker.close()
  }
}

/** Opens the engine for an image of `total` tiles. */
export async function openEngine(total: number): Promise<TileEngine> {
  // FORGE_BOOST_DEVICE=cpu: never the graphics card (for finding out whether it is the trouble).
  const gpu = process.env.FORGE_BOOST_DEVICE === 'cpu' ? undefined : pickDevice(await listDevices())
  if (gpu) {
    try {
      return new Checked(await startWorker(gpu.index), total)
    } catch (err) {
      process.stderr.write(`${gpu.name} unavailable, using the processor: ${String(err)}\n`)
    }
  }
  return new Plain(await startWorker())
}
