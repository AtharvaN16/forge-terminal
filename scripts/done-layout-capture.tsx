/**
 * Captures the real Done screen, as built with its row of buttons (dev
 * f28ebd4), at 80 × 24, 26 (the user's window), 30 and 34, dark, after a PNG really converted to
 * JPEG, for the Done layout picker (scripts/done-layout-mockup.ts).
 *
 *   FORCE_COLOR=3 FORGE_NO_FIND=1 npx tsx scripts/done-layout-capture.tsx → scripts/done-layout-frames.json
 */
import { writeFileSync } from 'node:fs'
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
  frame
    .split('\n')
    .map((l) => ansiRow(l, 80).map((c) => ({ ch: c.ch, fg: c.fg, bg: c.bg, b: c.b })))

const dir = await makeTempDir()
const input = join(dir, 'Screenshot 2026-10-19 at 9.43.23 PM.png')
// A soft gradient flecked with dark specks: heavy as a PNG, about a sixth
// of that as a JPEG, as a busy screenshot is.
const W = 900
const H = 600
const raw = Buffer.alloc(W * H * 3)
let seed = 7
const rnd = () => {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff
  return seed / 0x7fffffff
}
for (let y = 0; y < H; y++)
  for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 3
    const speck = rnd() < 0.05
    const grain = (rnd() - 0.5) * 8
    raw[i] = speck ? 20 : (x / W) * 200 + 30 + grain
    raw[i + 1] = speck ? 20 : (y / H) * 160 + 50 + grain
    raw[i + 2] = speck ? 20 : 180 - (x / W) * 90 + grain
  }
await sharp(raw, { raw: { width: W, height: H, channels: 3 } })
  .png()
  .toFile(input)
const frames: Record<string, Cell[][]> = {}
for (const rows of [24, 26, 30, 34]) {
  const out = await makeTempDir()
  const app = render(
    <App
      initialWidth={80}
      initialHeight={rows}
      prefs={{ ...DEFAULT_PREFERENCES, theme: 'dark', defaultOutput: out }}
    />,
  )
  const frame = () => plain(app.lastFrame())
  await until('home', () => frame().includes('1 convert'))
  await settle(800)
  app.stdin.write(input)
  await settle(800)
  for (let i = 0; i < 6 && !frame().includes('↵ Home'); i++) {
    app.stdin.write(ENTER)
    await settle(1500)
  }
  await until('Done', () => frame().includes('↵ Home'))
  await settle(1200)
  frames[`done${rows}`] = cells(app.lastFrame() ?? '')
  console.log(`--- done${rows}\n${frame()}`)
  app.unmount()
}
writeFileSync(new URL('./done-layout-frames.json', import.meta.url), JSON.stringify(frames))
process.exit(0)
