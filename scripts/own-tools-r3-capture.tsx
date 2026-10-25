/**
 * Round three's one extra screen, at 100 × 24, dark: a YouTube link that
 * just works (scripts/own-tools-mockup-r3.ts). Built from round one's capture.
 *
 * Captures the screens a user's own yt-dlp would change, at 80 × 24, dark,
 * for the own-tools round (scripts/own-tools-mockup.ts): transcribe's home,
 * a YouTube link with no yt-dlp, /extensions with and without Forge's copy,
 * a link being looked up, and a link yt-dlp could not fetch.
 *
 * Forge's yt-dlp is a stand-in shell script written into a temp HOME, so
 * nothing downloads and nothing touches the real config.
 *
 *   FORCE_COLOR=3 FORGE_NO_FIND=1 npx tsx scripts/own-tools-capture.tsx → scripts/own-tools-r3-frames.json
 */
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { render } from 'ink-testing-library'

const home = mkdtempSync(join(tmpdir(), 'forge-own-home-'))
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
const DOWN = `${ESC}[B`
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
  f.split('\n').map((l) => ansiRow(l, 100).map((c) => ({ ch: c.ch, fg: c.fg, bg: c.bg, b: c.b })))

/** Forge's yt-dlp, as installed: `script` is what it does when run. */
function fakeYtDlp(script: string) {
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
    `#!/bin/sh\ncase "$*" in *--update*) exit 0;; esac\n${script}\n`,
  )
  chmodSync(join(dir, 'yt-dlp'), 0o755)
}
const FACTS =
  'echo \'forge-facts {"title":"How Apple Silicon Works","uploader":"Branch Education","duration":1394,"is_live":false}\'\n' +
  'echo "forge-bytes 4200000 21800000"\nsleep 60'
const _FAILS =
  'echo "ERROR: [youtube] dQw4w9WgXcQ: Sign in to confirm you are not a bot" >&2\nexit 1'
const LINK = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'

const app = render(
  <App
    initialWidth={100}
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
async function toTranscribe() {
  for (let i = 0; i < 8 && !frame().includes('or paste a YouTube link'); i++) {
    app.stdin.write(RIGHT)
    await settle(300)
  }
  await until('transcribe', () => frame().includes('or paste a YouTube link'))
  await settle(800)
}
async function _openExtensions() {
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
  for (let i = 0; i < 6 && !/▌ YouTube links/.test(frame()); i++) {
    app.stdin.write(DOWN)
    await settle(200)
  }
  await settle(400)
}
try {
  await until('home', () => frame().includes('1 convert'))
  await settle(1500)
  fakeYtDlp(FACTS)
  await toTranscribe()
  await type(LINK)
  await settle(300)
  app.stdin.write(ENTER)
  await until('facts', () => frame().includes('How Apple Silicon Works'))
  await settle(500)
  snap('linkReady')
} catch (e) {
  console.log(String(e))
} finally {
  writeFileSync(new URL('./own-tools-r3-frames.json', import.meta.url), JSON.stringify(frames))
  console.log(log.join('\n'))
  process.exit(0)
}
