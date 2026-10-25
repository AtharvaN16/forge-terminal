/**
 * Captures /extensions at 100 × 24, dark, with tools of their real sizes on
 * disk, for the space explorations (scripts/extensions-space-mockup.ts):
 * Boost 14.9 MB, Remove background 32 KB, yt-dlp 37.1 MB (Forge's copies,
 * stand-ins of the right size in a temp HOME), and this Mac's own ffmpeg.
 * The cursor on each row, then yt-dlp the user's own (Forge's copy removed).
 *
 *   FORCE_COLOR=3 FORGE_NO_FIND=1 npx tsx scripts/extensions-space-capture.tsx
 */
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { render } from 'ink-testing-library'

const W = 100
const home = mkdtempSync(join(tmpdir(), 'forge-space-home-'))
mkdirSync(join(home, 'Desktop'))
process.env.HOME = home
process.env.XDG_CONFIG_HOME = join(home, '.config')
process.env.FORGE_NO_UPDATE_CHECK = '1'
const { DEFAULT_PREFERENCES } = await import('../src/config/preferences.js')
const { App } = await import('../src/shell/App.js')
const { ansiRow } = await import('../tests/shell/home-cells.js')

/** Forge's copy of `id` as installed: one file of `bytes`, its manifest, `current`. */
function forgeCopy(id: string, version: string, entry: string, bytes: number) {
  const base = join(home, '.config', 'forge', 'extensions', id)
  const dir = join(base, version)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(base, 'current'), version)
  writeFileSync(
    join(dir, 'manifest.json'),
    JSON.stringify({ id, version, entry, kind: 'exec', files: { [entry]: 'x' } }),
  )
  writeFileSync(join(dir, entry), Buffer.alloc(bytes))
  chmodSync(join(dir, entry), 0o755)
}
forgeCopy('boost', '1.0.0', 'boost', 14_866_325)
forgeCopy('remove-background', '1.0.0', 'cutout', 32_489)
forgeCopy('yt-dlp', '2026.08.19', 'yt-dlp', 37_146_048)

const ESC = String.fromCharCode(27)
const DOWN = `${ESC}[B`
const UP = `${ESC}[A`
const SGR = new RegExp(`${ESC}\\[[0-9;]*m`, 'g')
const settle = (ms = 300) => new Promise((r) => setTimeout(r, ms))
type Cell = { ch: string; fg: string | null; bg: string | null; b: boolean }
const cells = (f: string): Cell[][] =>
  f.split('\n').map((l) => ansiRow(l, W).map((c) => ({ ch: c.ch, fg: c.fg, bg: c.bg, b: c.b })))

const app = render(
  <App
    initialWidth={W}
    initialHeight={24}
    prefs={{ ...DEFAULT_PREFERENCES, theme: 'dark', defaultOutput: '~/Desktop' }}
  />,
)
const frame = () => (app.lastFrame() ?? '').replace(SGR, '')
const frames: Record<string, Cell[][]> = {}
const snap = (k: string) => {
  frames[k] = cells(app.lastFrame() ?? '')
  console.log(`--- ${k}\n${frame()}`)
}
const type = async (s: string) => {
  for (const ch of s) {
    app.stdin.write(ch)
    await settle(15)
  }
}
async function open() {
  app.stdin.write('/')
  await settle(500)
  await type('extensions')
  app.stdin.write('\r')
  await settle(2500)
}
async function cursorTo(name: string) {
  for (let i = 0; i < 6; i++) {
    app.stdin.write(UP)
    await settle(80)
  }
  for (let i = 0; i < 6 && !new RegExp(`▌ ${name}`).test(frame()); i++) {
    app.stdin.write(DOWN)
    await settle(200)
  }
  await settle(1200)
}
try {
  await settle(1500)
  await open()
  for (const [k, name] of [
    ['boost', 'Boost resolution'],
    ['cutout', 'Remove background'],
    ['yt', 'YouTube links'],
    ['video', 'Video and audio'],
  ] as const) {
    await cursorTo(name)
    snap(k)
  }
  // yt-dlp becomes the user's own: Forge's copy goes.
  const mine = join(home, 'bin', 'yt-dlp')
  mkdirSync(join(home, 'bin'))
  writeFileSync(
    mine,
    `#!${process.execPath}\nif (process.argv.includes('--version')) console.log('2026.10.03')\n`,
  )
  chmodSync(mine, 0o755)
  writeFileSync(
    join(home, '.config', 'forge', 'extensions', 'own.json'),
    JSON.stringify({ 'yt-dlp': mine }),
  )
  app.stdin.write(ESC)
  await settle(800)
  app.stdin.write('\r')
  await settle(2500)
  await cursorTo('YouTube links')
  snap('ytOwn')
} catch (e) {
  console.log(String(e))
} finally {
  writeFileSync(new URL('./extensions-space-frames.json', import.meta.url), JSON.stringify(frames))
  process.exit(0)
}
