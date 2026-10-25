#!/usr/bin/env node
// A stand-in for forge-ncnn (extensions/boost/ncnn/forge-ncnn.cpp) that speaks
// its protocol without a model: each tile comes back enlarged 4× by nearest
// neighbour, as three float planes. The tests run Boost's real runner.mjs
// against it, so the plumbing (tiles, seams, pipes, device choice) is checked
// with no ML and no native build.
//
//   FAKE_DEVICES  JSON list for --devices (default: none)
//   FAKE_MS       milliseconds a tile takes on the processor (default 0)
//   FAKE_GPU_MS   ... on a device (default FAKE_MS)
//   FAKE_BROKEN   "1": a device answers with zeros (a driver that computed nothing)
//   FAKE_DIE      "1": exits at once, before saying it is ready
//   FAKE_LOG      a file: one line is appended per started worker ("cpu" or "gpu <n>")
//   FAKE_DEVICES_LOG  a file: one line ("devices") is appended per --devices call
import { appendFileSync } from 'node:fs'

const argv = process.argv.slice(2)
const flag = (name) => {
  const i = argv.indexOf(name)
  return i < 0 ? undefined : argv[i + 1]
}

if (argv.includes('--devices')) {
  if (process.env.FAKE_DEVICES_LOG) appendFileSync(process.env.FAKE_DEVICES_LOG, 'devices\n')
  process.stdout.write(
    `${JSON.stringify({ devices: JSON.parse(process.env.FAKE_DEVICES ?? '[]') })}\n`,
  )
  process.exit(0)
}
if (process.env.FAKE_DIE === '1') {
  process.stderr.write('fake forge-ncnn: told to die\n')
  process.exit(2)
}

const gpu = flag('--gpu')
const devices = JSON.parse(process.env.FAKE_DEVICES ?? '[]')
const device =
  gpu === undefined ? 'cpu' : (devices.find((d) => String(d.index) === gpu)?.name ?? 'gpu')
if (process.env.FAKE_LOG)
  appendFileSync(process.env.FAKE_LOG, `${gpu === undefined ? 'cpu' : `gpu ${gpu}`}\n`)
const ms = Number(
  gpu === undefined
    ? (process.env.FAKE_MS ?? 0)
    : (process.env.FAKE_GPU_MS ?? process.env.FAKE_MS ?? 0),
)
const broken = gpu !== undefined && process.env.FAKE_BROKEN === '1'

const TILE = 256
const OUT = 1024
process.stdout.write(`${JSON.stringify({ ready: true, device, threads: 1 })}\n`)

let pending = Buffer.alloc(0)
let busy = false

async function serve() {
  if (busy) return
  busy = true
  while (pending.length >= TILE * TILE * 3) {
    const tile = pending.subarray(0, TILE * TILE * 3)
    pending = pending.subarray(TILE * TILE * 3)
    if (ms) await new Promise((r) => setTimeout(r, ms))
    const out = new Float32Array(3 * OUT * OUT)
    if (!broken)
      for (let c = 0; c < 3; c++)
        for (let y = 0; y < OUT; y++)
          for (let x = 0; x < OUT; x++)
            out[c * OUT * OUT + y * OUT + x] =
              (tile[((y >> 2) * TILE + (x >> 2)) * 3 + c] ?? 0) / 255
    process.stdout.write(Buffer.from(out.buffer))
  }
  busy = false
}

process.stdin.on('data', (chunk) => {
  pending = Buffer.concat([pending, chunk])
  void serve()
})
process.stdin.on('end', () => process.exit(0))
