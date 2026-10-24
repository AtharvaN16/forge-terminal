/**
 * Captures the real presets journey at 80 × 24, dark, for the presets UX
 * round (scripts/presets-ux-mockup.ts): home, the / menu, Convert to, Done,
 * Continue editing (open, Compress's window, working, done), Done after the
 * edit, Save as preset and the saved line — the screens the friend test went
 * through (2026-10-22).
 *
 *   FORCE_COLOR=3 FORGE_NO_FIND=1 npx tsx scripts/presets-ux-capture.tsx → scripts/presets-ux-frames.json
 */
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { render } from 'ink-testing-library'
import React from 'react'
import sharp from 'sharp'

// A home of its own: the screens say Desktop as a friend's would, while the
// files, the config and the preset saved go to a temp folder, never the real ones.
const home = mkdtempSync(join(tmpdir(), 'forge-ux-home-'))
mkdirSync(join(home, 'Desktop'))
process.env.HOME = home
process.env.XDG_CONFIG_HOME = join(home, '.config')
process.env.FORGE_NO_UPDATE_CHECK = '1'
const { DEFAULT_PREFERENCES } = await import('../src/config/preferences.js')
const { App } = await import('../src/shell/App.js')
const { ansiRow } = await import('../tests/shell/home-cells.js')

const ESC = String.fromCharCode(27)
const ENTER = String.fromCharCode(13)
const RIGHT = `${ESC}[C`
const SGR = new RegExp(`${ESC}\\[[0-9;]*m`, 'g')
const plain = (f: string | undefined) => (f ?? '').replace(SGR, '')
const settle = (ms = 200) => new Promise((r) => setTimeout(r, ms))
async function until(what: string, cond: () => boolean, ms = 30_000) {
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

const dir = join(home, 'Pictures')
mkdirSync(dir)
const input = join(dir, 'IMG_2041.png')
// A photo-sized picture: soft colour with grain, heavy as a PNG, so a rerun
// takes long enough for the window's spinner to show.
const W = 3000
const H = 2000
const raw = Buffer.alloc(W * H * 3)
let seed = 7
const rnd = () => {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff
  return seed / 0x7fffffff
}
for (let y = 0; y < H; y++)
  for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 3
    const grain = (rnd() - 0.5) * 30
    raw[i] = (x / W) * 200 + 30 + grain
    raw[i + 1] = (y / H) * 160 + 50 + grain
    raw[i + 2] = 180 - (x / W) * 90 + grain
  }
await sharp(raw, { raw: { width: W, height: H, channels: 3 } })
  .png()
  .toFile(input)
const app = render(
  <App
    initialWidth={80}
    initialHeight={24}
    prefs={{ ...DEFAULT_PREFERENCES, theme: 'dark', defaultOutput: '~/Desktop' }}
  />,
)
const frame = () => plain(app.lastFrame())
const frames: Record<string, Cell[][]> = {}
const log: string[] = []
const snap = (k: string) => {
  frames[k] = cells(app.lastFrame() ?? '')
  log.push(`--- ${k}\n${frame()}`)
}
const type = async (s: string) => {
  for (const ch of s) {
    app.stdin.write(ch)
    await settle(40)
  }
}
try {
  await until('home', () => frame().includes('1 convert'))
  await settle(1500)
  snap('home')
  app.stdin.write('/')
  await settle(600)
  snap('menu')
  app.stdin.write(ESC)
  await settle(600)
  app.stdin.write(input)
  await settle(800)
  app.stdin.write(ENTER)
  await until('Convert to', () => frame().includes('Convert to'))
  await settle(1500)
  snap('picker')
  app.stdin.write(ENTER) // JPEG
  await until('Quality', () => frame().includes('Quality'))
  await settle(1500)
  app.stdin.write(ENTER)
  await until('Save as', () => frame().includes('Save as'))
  await settle(800)
  app.stdin.write(ENTER)
  await until('Done', () => frame().includes('continue editing'))
  await settle(800)
  snap('done')
  app.stdin.write(RIGHT)
  await until('editor', () => frame().includes('Continue editing'))
  await settle(1500)
  snap('editor')
  app.stdin.write(' ') // Compress, which opens its window
  await settle(400)
  snap('compressSub')
  await type('300')
  snap('compressTyped')
  app.stdin.write(ENTER)
  await until('spinner', () => frame().includes('Compressing'), 10_000)
  await settle(500)
  snap('working')
  await until(
    'rerun',
    () => /✓ IMG_2041\.jpg {3}now/.test(frame()) && !frame().includes('Compressing'),
  )
  await settle(300)
  snap('edited')
  app.stdin.write(ENTER)
  await until('back on Done', () => !frame().includes('Continue editing'))
  await settle(800)
  snap('doneEdited')
  app.stdin.write('p')
  await until('save window', () => frame().includes('Save as preset'))
  await settle(600)
  snap('save')
  await type('webblog')
  snap('saveTyped')
  app.stdin.write(ENTER)
  await until('saved', () => frame().includes('saved as webblog'))
  await settle(600)
  snap('saved')
} finally {
  writeFileSync(new URL('./presets-ux-frames.json', import.meta.url), JSON.stringify(frames))
  console.log(log.join('\n'))
  process.exit(0)
}
