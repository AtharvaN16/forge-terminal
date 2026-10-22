/**
 * Captures the real screens the batch mockup starts from, at 80 × 24, dark:
 * several images staged on home, one image through compress to Done, and a
 * folder in convert through watch.
 *
 *   FORCE_COLOR=3 FORGE_NO_FIND=1 npx tsx scripts/batch-capture.tsx → /tmp/forge-batch/frames.json
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { render } from 'ink-testing-library'
import type React from 'react'
import sharp from 'sharp'
import { DEFAULT_PREFERENCES } from '../src/config/preferences.js'
import { resolveInputs } from '../src/core/resolve.js'
import { App } from '../src/shell/App.js'
import { NameTaken } from '../src/shell/components/NameTaken.js'
import { StagedFiles } from '../src/shell/components/StagedFiles.js'
import { Working } from '../src/shell/components/Working.js'
import { setMotionForTests } from '../src/shell/motion.js'
import { ThemeProvider } from '../src/shell/ThemeContext.js'
import { DARK, modePalette } from '../src/shell/theme.js'
import { makePdf, makeTempDir } from '../tests/helpers/fixtures.js'
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

/** A busy screenshot-like PNG: heavy as a PNG, light as a JPEG. */
async function photo(path: string, W: number, H: number, s: number) {
  const raw = Buffer.alloc(W * H * 3)
  let seed = s
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
    .toFile(path)
}

const dir = await makeTempDir()
const folder = join(dir, 'Trip to Lisbon')
await mkdir(folder)
const names = ['IMG_2041.png', 'IMG_2042.png', 'IMG_2043.png', 'IMG_2044.png', 'IMG_2045.png']
const paths: string[] = []
for (const [i, n] of names.entries()) {
  const p = join(folder, n)
  await photo(p, 900 + i * 40, 600 + i * 20, 7 + i)
  paths.push(p)
}
const out = await makeTempDir()

const frames: Record<string, Cell[][]> = {}
const log: string[] = []

async function session(name: string, steps: (s: Session) => Promise<void>) {
  const app = render(
    <App
      initialWidth={80}
      initialHeight={24}
      prefs={{ ...DEFAULT_PREFERENCES, theme: 'dark', defaultOutput: out }}
    />,
  )
  const frame = () => plain(app.lastFrame())
  const snap = (k: string) => {
    frames[`${name}.${k}`] = cells(app.lastFrame() ?? '')
    log.push(`--- ${name}.${k}\n${frame()}`)
  }
  await until('home', () => frame().includes('1 convert'))
  await settle(600)
  try {
    await steps({ app, frame, snap })
  } catch (e) {
    log.push(`!!! ${name}: ${(e as Error).message}\n${frame()}`)
  }
  app.unmount()
}
interface Session {
  app: ReturnType<typeof render>
  frame: () => string
  snap: (k: string) => void
}

const esc = (p: string) => p.replace(/ /g, '\\ ')

await session('several', async ({ app, snap }) => {
  app.stdin.write('2')
  await settle(400)
  app.stdin.write(paths.map(esc).join(' '))
  await settle(1200)
  snap('home')
  app.stdin.write(ENTER)
  await settle(600)
  snap('enter')
})

await session('compress', async ({ app, frame, snap }) => {
  app.stdin.write('2')
  await settle(400)
  app.stdin.write(esc(paths[0] ?? ''))
  await settle(1200)
  snap('home')
  for (let i = 1; i <= 7 && !frame().includes('saved'); i++) {
    app.stdin.write(ENTER)
    await settle(1500)
    snap(`step${i}`)
  }
})

await session('watch', async ({ app, frame, snap }) => {
  app.stdin.write(esc(folder))
  await settle(1500)
  snap('home')
  for (let i = 1; i <= 6 && !frame().includes('Watching'); i++) {
    app.stdin.write(ENTER)
    await settle(2000)
    snap(`step${i}`)
  }
})

const DOWN = `${ESC}[B`

await session('size', async ({ app, snap }) => {
  app.stdin.write('2')
  await settle(400)
  app.stdin.write(esc(paths[0] ?? ''))
  await settle(1200)
  app.stdin.write(ENTER)
  await settle(800)
  app.stdin.write(DOWN)
  await settle(300)
  app.stdin.write(ENTER)
  await settle(800)
  snap('size')
})

await session('edit', async ({ app, snap }) => {
  app.stdin.write('4')
  await settle(400)
  app.stdin.write(esc(paths[0] ?? ''))
  await settle(1200)
  app.stdin.write(ENTER)
  await settle(1500)
  snap('picker')
})

const pdfs = [
  await makePdf(folder, 'invoice-march.pdf', 2),
  await makePdf(folder, 'invoice-april.pdf', 3),
  await makePdf(folder, 'invoice-may.pdf', 2),
]
await session('pdf', async ({ app, snap }) => {
  app.stdin.write('3')
  await settle(400)
  app.stdin.write(pdfs.map(esc).join(' '))
  await settle(1500)
  snap('home')
  app.stdin.write(ENTER)
  await settle(1000)
  snap('hub')
})

/* ---- pieces, rendered alone */
const piece = async (
  k: string,
  node: React.ReactElement,
  mode: 'compress' | 'convert' = 'compress',
) => {
  const r = render(<ThemeProvider palette={modePalette(DARK, mode)}>{node}</ThemeProvider>)
  await settle(300)
  frames[`piece.${k}`] = cells(r.lastFrame() ?? '')
  log.push(`--- piece.${k}\n${plain(r.lastFrame())}`)
  r.unmount()
}
setMotionForTests(false)
const { sources } = await resolveInputs(paths, { recursive: false })
await piece('staged', <StagedFiles stage={{ sources, failures: [] }} width={80} />)
await piece(
  'working',
  <Working
    mode="compress"
    label="Encoding PNG · IMG_2044.png"
    startedAt={Date.now() - 4200}
    pages={{ done: 3, total: 5 }}
    unit="images"
    savedAsItGoes
    stoppable
    width={80}
  />,
)
await piece(
  'taken',
  <NameTaken
    mode="compress"
    width={80}
    name="3 files"
    keepBoth="IMG_2041-small (1).png …"
    onSubmit={() => {}}
    onCancel={() => {}}
  />,
)

mkdirSync('/tmp/forge-batch', { recursive: true })
writeFileSync('/tmp/forge-batch/frames.json', JSON.stringify(frames))
console.log(log.join('\n'))
process.exit(0)
