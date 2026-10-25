/**
 * Round three's captures (scripts/presets-ux-mockup-r3.ts): idle home, then
 * edit mode and compress mode run on the JPEG a convert just made — the
 * screens a "carry on from Done" flow would reuse. Built on round two's
 * capture (same temp HOME, same files).
 *
 * Captures the screens presets round two (scripts/presets-ux-mockup-r2.ts)
 * builds on, at 80 × 24 (and one short window, 80 × 16), dark: home with a
 * photo staged and with a folder staged, Convert to for a photo and for a
 * video (its boxes), compress's method picker, edit's picker, and the
 * working screen mid-convert. Each in a fresh app, in a temp HOME, so the
 * real Desktop and config are never touched.
 *
 *   FORCE_COLOR=3 FORGE_NO_FIND=1 npx tsx scripts/presets-ux-capture-r3.tsx → scripts/presets-ux-frames-r3.json
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { render } from 'ink-testing-library'
import React from 'react'
import sharp from 'sharp'

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
const SGR = new RegExp(`${ESC}\\[[0-9;]*m`, 'g')
const plain = (f: string | undefined) => (f ?? '').replace(SGR, '')
const settle = (ms = 200) => new Promise((r) => setTimeout(r, ms))
type Cell = { ch: string; fg: string | null; bg: string | null; b: boolean }
const cells = (frame: string): Cell[][] =>
  frame.split('\n').map((l) => ansiRow(l, 80).map((c) => ({ ch: c.ch, fg: c.fg, bg: c.bg, b: c.b })))

// The files: a photo (heavy, so the working screen shows), a folder of
// photos and two screenshots, and a short video.
const pics = join(home, 'Pictures')
mkdirSync(pics)
async function photo(path: string, w: number, h: number, seed0: number) {
  const raw = Buffer.alloc(w * h * 3)
  let seed = seed0
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 3
      const grain = (rnd() - 0.5) * 30
      raw[i] = (x / w) * 200 + 30 + grain
      raw[i + 1] = (y / h) * 160 + 50 + grain
      raw[i + 2] = 180 - (x / w) * 90 + grain
    }
  await sharp(raw, { raw: { width: w, height: h, channels: 3 } }).png().toFile(path)
}
const input = join(pics, 'IMG_2041.png')
await photo(input, 3000, 2000, 7)
const folder = join(pics, 'Holiday')
mkdirSync(folder)
for (let i = 0; i < 12; i++) await photo(join(folder, `IMG_${2050 + i}.png`), 400, 300, i + 1)
await photo(join(folder, 'notes.png'), 300, 200, 99)
const video = join(pics, 'clip.mov')
execFileSync('ffmpeg', ['-v', 'quiet', '-f', 'lavfi', '-i', 'testsrc=duration=2:size=640x360:rate=30', '-f', 'lavfi', '-i', 'sine=duration=2', '-shortest', '-pix_fmt', 'yuv420p', video])

const frames: Record<string, Cell[][]> = {}
const log: string[] = []

async function session(height: number, go: (s: {
  frame: () => string
  write: (s: string) => void
  snap: (k: string) => void
  until: (what: string, cond: () => boolean, ms?: number) => Promise<void>
}) => Promise<void>) {
  const app = render(
    <App
      initialWidth={80}
      initialHeight={height}
      prefs={{ ...DEFAULT_PREFERENCES, theme: 'dark', defaultOutput: '~/Desktop' }}
    />,
  )
  const frame = () => plain(app.lastFrame())
  const until = async (what: string, cond: () => boolean, ms = 30_000) => {
    const end = Date.now() + ms
    while (!cond()) {
      if (Date.now() > end) throw new Error(`until gave up: ${what}\n${frame()}`)
      await settle(25)
    }
  }
  try {
    await until('home', () => frame().includes('1 convert'))
    await settle(1200)
    await go({
      frame,
      write: (s) => app.stdin.write(s),
      snap: (k) => {
        frames[k] = cells(app.lastFrame() ?? '')
        log.push(`--- ${k}\n${frame()}`)
      },
      until,
    })
  } catch (e) {
    log.push(`!!! ${String(e)}`)
  } finally {
    app.unmount()
  }
}


const DOWN = `${ESC}[B`
const jpg = join(home, 'Desktop', 'IMG_2041.jpg')
try {
  // Idle home, then a convert to JPEG to make the file the next modes work on.
  await session(24, async ({ write, snap, until, frame }) => {
    snap('home')
    write(input)
    await settle(1200)
    write(ENTER)
    await until('Convert to', () => frame().includes('Convert to'))
    await settle(1200)
    write(ENTER)
    await until('Quality', () => frame().includes('Quality'))
    await settle(1000)
    write(ENTER)
    await until('Save as', () => frame().includes('Save as'))
    await settle(500)
    write(ENTER)
    await until('Done', () => frame().includes('continue editing') || frame().includes('Continue editing') || / Done /.test(frame()), 30_000)
    await settle(800)
    snap('done')
  })
  // Edit: the JPEG staged, edit's picker, Resize's own screen, then on.
  await session(24, async ({ write, snap, until, frame }) => {
    write('/edit')
    await settle()
    write(ENTER)
    await settle(400)
    write(jpg)
    await settle(1200)
    snap('editStaged')
    write(ENTER)
    await until('edit picker', () => frame().includes('Crop to shape'))
    await settle(1200)
    snap('editPicker')
    for (let i = 0; i < 8 && !/▌ Resize/.test(frame()); i++) {
      write(DOWN)
      await settle(200)
    }
    snap('editPickerResize')
    write(ENTER)
    await settle(1200)
    snap('resize')
    for (const ch of '1920') {
      write(ch)
      await settle(60)
    }
    await settle(400)
    snap('resizeTyped')
    write(ENTER)
    await settle(1200)
    snap('editAfterResize')
    for (let i = 0; i < 3 && !/ Done /.test(frame()) && !/continue editing/.test(frame()); i++) {
      write(ENTER)
      await settle(1500)
      snap(`editStep${i}`)
    }
    snap('editDone')
  })
  // Compress: the JPEG staged in compress, its method, its slider, then on.
  await session(24, async ({ write, snap, until, frame }) => {
    write('/compress')
    await settle()
    write(ENTER)
    await settle(400)
    write(jpg)
    await settle(1200)
    snap('compressStaged')
    write(ENTER)
    await until('By quality', () => frame().includes('By quality'))
    await settle(600)
    snap('compressMethod')
    write(ENTER)
    await settle(1500)
    snap('compressSlider')
    write(ENTER)
    await settle(1200)
    snap('compressSave')
    write(ENTER)
    await settle(300)
    snap('compressWorking')
    await settle(2500)
    snap('compressDone')
  })
} finally {
  writeFileSync(new URL('./presets-ux-frames-r3.json', import.meta.url), JSON.stringify(frames))
  console.log(log.join('\n'))
  process.exit(0)
}
