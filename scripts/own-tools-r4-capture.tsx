/**
 * Round four's screens, at 100 × 24, dark (scripts/own-tools-mockup-r4.ts):
 * where each mode goes once its tool is there — a link's Transcribe to, the
 * step after Boost resolution, a video's Convert to — and Boost's own
 * download, really installed into a temp HOME (14.9 MB from Forge's
 * releases) so its band and the step after it are the app's.
 *
 *   FORCE_COLOR=3 FORGE_NO_FIND=1 npx tsx scripts/own-tools-r4-capture.tsx /tmp/clip.mp4
 */
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { render } from 'ink-testing-library'
import sharp from 'sharp'

const W = 100
const home = mkdtempSync(join(tmpdir(), 'forge-own4-home-'))
mkdirSync(join(home, 'Desktop'))
mkdirSync(join(home, 'Movies'))
process.env.HOME = home
process.env.XDG_CONFIG_HOME = join(home, '.config')
process.env.FORGE_NO_UPDATE_CHECK = '1'
const { DEFAULT_PREFERENCES } = await import('../src/config/preferences.js')
const { App } = await import('../src/shell/App.js')
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
const SGR = new RegExp(`${ESC}\\[[0-9;]*m`, 'g')
const plain = (f: string | undefined) => (f ?? '').replace(SGR, '')
const settle = (ms = 200) => new Promise((r) => setTimeout(r, ms))
async function until(what: string, cond: () => boolean, ms = 30_000) {
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
  writeFileSync(
    join(dir, 'yt-dlp'),
    '#!/bin/sh\ncase "$*" in *--update*) exit 0;; esac\n' +
      'echo \'forge-facts {"title":"How Apple Silicon Works","uploader":"Branch Education","duration":1394,"is_live":false}\'\n' +
      'echo "forge-bytes 4200000 21800000"\nsleep 60\n',
  )
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
const home1 = async () => {
  for (let i = 0; i < 4 && !frame().includes('1 convert'); i++) {
    app.stdin.write(ESC)
    await settle(700)
  }
}
try {
  await until('home', () => frame().includes('1 convert'))
  await settle(1500)

  // A video, ffmpeg found (this Mac's own): Convert to.
  await type(clip)
  await settle(300)
  app.stdin.write(ENTER)
  await until('video picker', () => frame().includes('Convert to'))
  await settle(1200)
  snap('videoPicker')
  await home1()

  // An image in edit; Boost resolution, really installed, then the step after.
  for (let i = 0; i < 3; i++) {
    app.stdin.write(RIGHT)
    await settle(400)
  }
  await settle(800)
  await type(photo)
  await settle(300)
  app.stdin.write(ENTER)
  await until('edit picker', () => frame().includes('Boost resolution'))
  await settle(1500)
  for (let i = 0; i < 6 && !/▌ Boost resolution/.test(frame()); i++) {
    app.stdin.write(DOWN)
    await settle(250)
  }
  app.stdin.write(ENTER)
  await until('installing', () => / of 14\.9 MB/.test(frame()), 20_000)
  await settle(200)
  snap('boostInstalling')
  await until('installed', () => !/ of 14\.9 MB|checking/.test(frame()), 180_000)
  await settle(1500)
  snap('boostInstalled')
  app.stdin.write(ENTER)
  await settle(2000)
  snap('boostNext')
  await home1()

  // A link, yt-dlp there: ↵ transcribe goes to Transcribe to.
  fakeYtDlp()
  for (let i = 0; i < 6 && !frame().includes('or paste a YouTube link'); i++) {
    app.stdin.write(RIGHT)
    await settle(400)
  }
  await settle(800)
  await type(LINK)
  await settle(300)
  app.stdin.write(ENTER)
  await until('facts', () => frame().includes('How Apple Silicon Works'))
  await settle(500)
  app.stdin.write(ENTER)
  await until('Transcribe to', () => frame().includes('Transcribe to'), 20_000)
  await settle(1200)
  snap('transcribeTo')
} catch (e) {
  console.log(String(e))
} finally {
  writeFileSync(new URL('./own-tools-r4-frames.json', import.meta.url), JSON.stringify(frames))
  console.log(log.join('\n'))
  process.exit(0)
}
