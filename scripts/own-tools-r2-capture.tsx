/**
 * Captures, at 100 × 24 (wide enough for /extensions' split layout), dark,
 * the screens where Forge needs a tool, for own-tools round two
 * (scripts/own-tools-mockup-r2.ts): /extensions on Boost and on YouTube
 * links, with and without Forge's copy; a YouTube link with no yt-dlp; a
 * video with no ffmpeg; an image in edit, with Boost not downloaded.
 *
 * yt-dlp is a stand-in written into a temp HOME; ffmpeg is hidden with
 * forceFfmpegForTests. Nothing downloads, nothing touches the real config.
 *
 *   FORCE_COLOR=3 FORGE_NO_FIND=1 npx tsx scripts/own-tools-r2-capture.tsx /tmp/clip.mp4
 */
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { render } from 'ink-testing-library'
import React from 'react'
import sharp from 'sharp'

const W = 100
const home = mkdtempSync(join(tmpdir(), 'forge-own2-home-'))
mkdirSync(join(home, 'Desktop'))
mkdirSync(join(home, 'Movies'))
process.env.HOME = home
process.env.XDG_CONFIG_HOME = join(home, '.config')
process.env.FORGE_NO_UPDATE_CHECK = '1'
const { DEFAULT_PREFERENCES } = await import('../src/config/preferences.js')
const { App } = await import('../src/shell/App.js')
const { forceFfmpegForTests } = await import('../src/engines/ffmpeg.js')
const { ansiRow } = await import('../tests/shell/home-cells.js')

const clip = join(home, 'Movies', 'trip.mp4')
copyFileSync(process.argv[2] as string, clip)
const photo = join(home, 'Desktop', 'IMG_2041.png')
await sharp({ create: { width: 800, height: 600, channels: 3, background: '#7a9cc6' } })
  .png()
  .toFile(photo)

const ESC = String.fromCharCode(27)
const ENTER = String.fromCharCode(13)
const RIGHT = `${ESC}[C`
const DOWN = `${ESC}[B`
const UP = `${ESC}[A`
const SGR = new RegExp(`${ESC}\\[[0-9;]*m`, 'g')
const plain = (f: string | undefined) => (f ?? '').replace(SGR, '')
const settle = (ms = 200) => new Promise((r) => setTimeout(r, ms))
async function until(what: string, cond: () => boolean, ms = 20_000) {
  const end = Date.now() + ms
  while (!cond()) {
    if (Date.now() > end) throw new Error(`until gave up: ${what}\n${frame()}`)
    await settle(25)
  }
}
type Cell = { ch: string; fg: string | null; bg: string | null; b: boolean }
const cells = (f: string): Cell[][] =>
  f.split('\n').map((l) => ansiRow(l, W).map((c) => ({ ch: c.ch, fg: c.fg, bg: c.bg, b: c.b })))

function fakeYtDlp() {
  const base = join(home, '.config', 'forge', 'extensions', 'yt-dlp')
  const dir = join(base, '2026.08.19')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(base, 'current'), '2026.08.19')
  writeFileSync(
    join(dir, 'manifest.json'),
    JSON.stringify({
      id: 'yt-dlp',
      version: '2026.08.19',
      entry: 'yt-dlp',
      kind: 'exec',
      files: { 'yt-dlp': 'x' },
    }),
  )
  writeFileSync(join(dir, 'yt-dlp'), '#!/bin/sh\nexit 1\n')
  chmodSync(join(dir, 'yt-dlp'), 0o755)
}
const LINK = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'

const app = render(
  <App
    initialWidth={W}
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
    await settle(15)
  }
}
async function toTab(label: string) {
  for (let i = 0; i < 8 && !new RegExp(`\\d ${label}`).test(frame()); i++) await settle(100)
  for (let i = 0; i < 8; i++) {
    app.stdin.write(RIGHT)
    await settle(300)
    if (frame().includes(label === 'transcribe' ? 'or paste a YouTube link' : `${label}`)) break
  }
  await settle(800)
}
async function openExtensions() {
  await settle(800)
  if (!frame().includes('▌ /extensions')) {
    app.stdin.write('/')
    await settle(600)
    await type('extensions')
    await settle(300)
  }
  app.stdin.write(ENTER)
  await until('extensions', () => frame().includes('YouTube links'))
  await settle(600)
}
async function cursorTo(name: string) {
  for (let i = 0; i < 6; i++) {
    app.stdin.write(UP)
    await settle(100)
  }
  for (let i = 0; i < 6 && !new RegExp(`▌ ${name}`).test(frame()); i++) {
    app.stdin.write(DOWN)
    await settle(200)
  }
  await settle(400)
}
try {
  await until('home', () => frame().includes('1 convert'))
  await settle(1500)
  snap('home')

  await openExtensions()
  await cursorTo('Boost resolution')
  snap('extBoost')
  await cursorTo('YouTube links')
  snap('extYtAbsent')
  app.stdin.write(ESC)
  await settle(600)
  fakeYtDlp()
  await openExtensions()
  await cursorTo('YouTube links')
  snap('extYtInstalled')
  app.stdin.write(ESC)
  await settle(600)
  app.stdin.write(ESC)
  await settle(800)
  // Forge's copy goes again, for the link below.
  const { rmSync } = await import('node:fs')
  rmSync(join(home, '.config', 'forge', 'extensions', 'yt-dlp'), { recursive: true, force: true })

  // A video, with no ffmpeg anywhere.
  forceFfmpegForTests(undefined)
  await type(clip)
  await settle(300)
  app.stdin.write(ENTER)
  await settle(2500)
  snap('videoNoFfmpeg')
  app.stdin.write(ESC)
  await settle(800)
  app.stdin.write(ESC)
  await settle(800)

  // An image in edit: Boost offers its download.
  for (let i = 0; i < 3; i++) {
    app.stdin.write(RIGHT)
    await settle(400)
  }
  await settle(800)
  snap('editHome')
  await type(photo)
  await settle(300)
  app.stdin.write(ENTER)
  await settle(2500)
  snap('editPicker')
  for (let i = 0; i < 6 && !/▌.*Boost/.test(frame()); i++) {
    app.stdin.write(DOWN)
    await settle(250)
  }
  snap('editBoost')
  app.stdin.write(ESC)
  await settle(800)
  app.stdin.write(ESC)
  await settle(800)

  await toTab('transcribe')
  snap('transcribeHome')
  await type(LINK)
  await settle(300)
  app.stdin.write(ENTER)
  await until('needs yt-dlp', () => frame().includes('↵ installs'))
  await settle(500)
  snap('needsYtDlp')
} catch (e) {
  console.log(String(e))
} finally {
  writeFileSync(new URL('./own-tools-r2-frames.json', import.meta.url), JSON.stringify(frames))
  console.log(log.join('\n'))
  process.exit(0)
}
