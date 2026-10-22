/**
 * Captures the real home and Done screens at 80 × 24, dark, for the
 * "way home from Done" mockup (scripts/done-next-mockup.ts): home in convert
 * with nothing staged, and Done after a PNG really converted to JPEG.
 *
 *   FORCE_COLOR=3 FORGE_NO_FIND=1 npx tsx scripts/done-next-capture.tsx → /tmp/forge-done-next/frames.json
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { render } from 'ink-testing-library'
import React from 'react'
import sharp from 'sharp'
import { DEFAULT_PREFERENCES } from '../src/config/preferences.js'
import { App } from '../src/shell/App.js'
import { makeTempDir } from '../tests/helpers/fixtures.js'
import { ansiRow } from '../tests/shell/home-cells.js'

const ESC = String.fromCharCode(27)
const ENTER = String.fromCharCode(13)
const SGR = new RegExp(`${ESC}\\[[0-9;]*m`, 'g')
const plain = (f: string | undefined) => (f ?? '').replace(SGR, '')
const settle = (ms = 200) => new Promise((r) => setTimeout(r, ms))
async function until(what: string, cond: () => boolean, ms = 20_000) {
  const end = Date.now() + ms
  while (!cond()) {
    if (Date.now() > end) throw new Error(`until gave up: ${what}`)
    await settle(25)
  }
}
type Cell = { ch: string; fg: string | null; bg: string | null; b: boolean }
const cells = (frame: string): Cell[][] =>
  frame.split('\n').map((l) => ansiRow(l, 80).map((c) => ({ ch: c.ch, fg: c.fg, bg: c.bg, b: c.b })))

const dir = await makeTempDir()
const input = join(dir, 'Screenshot 2026-10-19 at 9.43.23 PM.png')
// A soft gradient flecked with dark specks: heavy as a PNG, about a sixth
// of that as a JPEG, as a busy screenshot is.
const W = 900
const H = 600
const raw = Buffer.alloc(W * H * 3)
let seed = 7
const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff
for (let y = 0; y < H; y++)
  for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 3
    const speck = rnd() < 0.05
    const grain = (rnd() - 0.5) * 8
    raw[i] = speck ? 20 : (x / W) * 200 + 30 + grain
    raw[i + 1] = speck ? 20 : (y / H) * 160 + 50 + grain
    raw[i + 2] = speck ? 20 : 180 - (x / W) * 90 + grain
  }
await sharp(raw, { raw: { width: W, height: H, channels: 3 } }).png().toFile(input)
const out = await makeTempDir()
const app = render(
  <App
    initialWidth={80}
    initialHeight={24}
    prefs={{ ...DEFAULT_PREFERENCES, theme: 'dark', defaultOutput: out }}
  />,
)
const frame = () => plain(app.lastFrame())
const frames: Record<string, Cell[][]> = {}
const log: string[] = []
const snap = (k: string) => {
  frames[k] = cells(app.lastFrame() ?? '')
  log.push(`--- ${k}\n${frame()}`)
}
try {
  await until('home', () => frame().includes('1 convert'))
  await settle(1500)
  snap('home')
  app.stdin.write(input)
  await settle(800)
  snap('staged')
  app.stdin.write(ENTER)
  await settle(800)
  snap('step1')
  for (let i = 2; i <= 6 && !frame().includes(' Done '); i++) {
    app.stdin.write(ENTER)
    await settle(1500)
    snap(`step${i}`)
  }
} finally {
  mkdirSync('/tmp/forge-done-next', { recursive: true })
  writeFileSync('/tmp/forge-done-next/frames.json', JSON.stringify(frames))
  console.log(log.join('\n'))
  process.exit(0)
}
