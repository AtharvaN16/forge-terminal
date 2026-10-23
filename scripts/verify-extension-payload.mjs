#!/usr/bin/env node
/**
 * Runs a built payload's runner on the OS it was built for, as CI's verify
 * jobs do (.github/workflows/extensions.yml) and as anyone can by hand:
 *
 *   node scripts/verify-extension-payload.mjs boost|remove-background <payloadDir>
 *
 * boost: a 32 × 32 gradient boosted 2× must come back 64 × 64.
 * remove-background: a figure on a flat background must come back the same
 * size with clear corners and an opaque middle; a flat grey frame must be
 * refused as `no-subject` with no file written.
 *
 * Node built-ins only (the verify jobs run no `npm ci`), so the PNGs are
 * written and read here with zlib alone. Exits non-zero on the first failure.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { deflateSync, inflateSync } from 'node:zlib'

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
function crc(buf) {
  let c = 0xffffffff
  for (const x of buf) c = CRC_TABLE[(c ^ x) & 255] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data])
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const sum = Buffer.alloc(4)
  sum.writeUInt32BE(crc(body))
  return Buffer.concat([len, body, sum])
}

/** An 8-bit RGB PNG of `w` × `h` whose pixel colour is `px(x, y)` → [r, g, b]. */
export function writeRgbPng(path, w, h, px) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8
  ihdr[9] = 2
  const raw = Buffer.alloc((w * 3 + 1) * h)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) raw.set(px(x, y), y * (w * 3 + 1) + 1 + x * 3)
  writeFileSync(
    path,
    Buffer.concat([
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      chunk('IHDR', ihdr),
      chunk('IDAT', deflateSync(raw)),
      chunk('IEND', Buffer.alloc(0)),
    ]),
  )
}

/** Reads an 8-bit RGB or RGBA, non-interlaced PNG (what the runners write). */
export function readPng(path) {
  const buf = readFileSync(path)
  let p = 8
  let w = 0
  let h = 0
  let type = 0
  const idat = []
  while (p < buf.length) {
    const len = buf.readUInt32BE(p)
    const t = buf.toString('latin1', p + 4, p + 8)
    const data = buf.subarray(p + 8, p + 8 + len)
    if (t === 'IHDR') {
      w = data.readUInt32BE(0)
      h = data.readUInt32BE(4)
      if (data[8] !== 8 || data[12] !== 0) throw new Error('not an 8-bit non-interlaced PNG')
      type = data[9]
    } else if (t === 'IDAT') idat.push(data)
    p += 12 + len
  }
  const ch = type === 6 ? 4 : type === 2 ? 3 : 0
  if (!ch) throw new Error(`PNG colour type ${type} is not RGB or RGBA`)
  const raw = inflateSync(Buffer.concat(idat))
  const stride = w * ch
  const px = Buffer.alloc(stride * h)
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)]
    for (let i = 0; i < stride; i++) {
      const x = raw[y * (stride + 1) + 1 + i]
      const a = i >= ch ? px[y * stride + i - ch] : 0
      const b = y > 0 ? px[(y - 1) * stride + i] : 0
      const c = i >= ch && y > 0 ? px[(y - 1) * stride + i - ch] : 0
      const pa = Math.abs(b - c)
      const pb = Math.abs(a - c)
      const pc = Math.abs(a + b - 2 * c)
      const paeth = pa <= pb && pa <= pc ? a : pb <= pc ? b : c
      const pred = [0, a, b, (a + b) >> 1, paeth][f]
      if (pred === undefined) throw new Error(`bad PNG filter ${f}`)
      px[y * stride + i] = (x + pred) & 0xff
    }
  }
  return { width: w, height: h, channels: ch, px }
}

/** Runs the payload's runner; the one JSON line it prints, and its exit status. */
function runner(payload, args) {
  let stdout
  let status = 0
  try {
    stdout = execFileSync(process.execPath, [join(payload, 'runner.mjs'), ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'inherit'],
    })
  } catch (err) {
    stdout = String(err.stdout ?? '')
    status = err.status ?? 1
  }
  const lines = stdout.trim().split('\n').filter(Boolean)
  if (lines.length !== 1) throw new Error(`expected one JSON line, got: ${stdout}`)
  return { status, reply: JSON.parse(lines[0]) }
}

function check(ok, message) {
  if (!ok) throw new Error(message)
  console.log(`ok: ${message}`)
}

/** A figure (a body and a head) on a flat light background, as the macOS helper's test draws. */
export function figure(w, h) {
  return (x, y) => {
    const body = ((x - w / 2) / (w * 0.24)) ** 2 + ((y - h * 0.58) / (h * 0.3)) ** 2 < 1
    const head = (x - w / 2) ** 2 + (y - h * 0.25) ** 2 < (w * 0.14) ** 2
    return body ? [192, 57, 43] : head ? [224, 160, 112] : [232, 232, 232]
  }
}

function verifyBoost(payload, work) {
  const input = join(work, 'in.png')
  const out = join(work, 'out.png')
  writeRgbPng(input, 32, 32, (x, y) => [x * 8, y * 8, 128])
  const { status, reply } = runner(payload, ['--in', input, '--out', out, '--scale', '2'])
  check(status === 0 && reply.ok === true, `boost replied ok: ${JSON.stringify(reply)}`)
  const png = readPng(out)
  check(png.width === 64 && png.height === 64, `boost made 64x64 (got ${png.width}x${png.height})`)
}

function verifyCutout(payload, work) {
  const input = join(work, 'figure.png')
  const out = join(work, 'figure-cutout.png')
  const W = 240
  const H = 240
  writeRgbPng(input, W, H, figure(W, H))
  const r = runner(payload, [input, out])
  check(r.status === 0 && r.reply.ok === true, `cutout replied ok: ${JSON.stringify(r.reply)}`)
  check(r.reply.width === W && r.reply.height === H, `cutout reports ${W}x${H}`)
  const png = readPng(out)
  check(png.channels === 4 && png.width === W, 'cutout is RGBA at the same size')
  const alpha = (x, y) => png.px[(y * W + x) * 4 + 3]
  check(
    [alpha(2, 2), alpha(W - 3, 2), alpha(2, H - 3), alpha(W - 3, H - 3)].every((a) => a < 10),
    'cutout corners are clear',
  )
  check(alpha(W / 2, Math.round(H * 0.6)) > 245, 'cutout middle is opaque')

  const flat = join(work, 'flat.png')
  const flatOut = join(work, 'flat-cutout.png')
  writeRgbPng(flat, 160, 160, () => [128, 128, 128])
  const f = runner(payload, [flat, flatOut])
  check(
    f.status !== 0 && f.reply.ok === false && f.reply.code === 'no-subject',
    `flat grey is no-subject: ${JSON.stringify(f.reply)}`,
  )
  check(!existsSync(flatOut), 'no file written for no-subject')
}

function main() {
  const [id, payload] = process.argv.slice(2)
  if (!payload || (id !== 'boost' && id !== 'remove-background')) {
    console.error('usage: verify-extension-payload.mjs boost|remove-background <payloadDir>')
    process.exit(2)
  }
  const work = mkdtempSync(join(tmpdir(), 'forge-verify-'))
  try {
    if (id === 'boost') verifyBoost(payload, work)
    else verifyCutout(payload, work)
  } catch (err) {
    console.error(`FAILED: ${err instanceof Error ? err.message : err}`)
    process.exit(1)
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main()
