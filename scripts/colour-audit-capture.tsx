/**
 * Captures colour mode as built (dev), screen by screen along a first-time
 * user's journey, at 80 × 26 dark, for the colour UX audit
 * (mockups/colour-audit-2026-10.html).
 *
 *   FORCE_COLOR=3 FORGE_NO_FIND=1 npx tsx scripts/colour-audit-capture.tsx → /tmp/colour-audit/frames.json
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { render } from 'ink-testing-library'
import React from 'react'
import { DEFAULT_PREFERENCES } from '../src/config/preferences.js'
import { App } from '../src/shell/App.js'
import { makeTempDir } from '../tests/helpers/fixtures.js'
import { ansiRow } from '../tests/shell/home-cells.js'

const W = 80
const H = 26
const ESC = String.fromCharCode(27)
const ENTER = '\r'
const TAB = '\t'
const RIGHT = `${ESC}[C`
const DOWN = `${ESC}[B`
const SHIFT_RIGHT = `${ESC}[1;2C`
const SGR = new RegExp(`${ESC}\\[[0-9;]*m`, 'g')
const plain = (f: string | undefined) => (f ?? '').replace(SGR, '')
const settle = (ms = 300) => new Promise((r) => setTimeout(r, ms))
async function until(what: string, cond: () => boolean, ms = 15_000) {
  const end = Date.now() + ms
  while (!cond()) {
    if (Date.now() > end) {
      console.log(plain(app.lastFrame()))
      throw new Error(`until gave up: ${what}`)
    }
    await settle(25)
  }
}
const image = '/tmp/colour-audit/sonoma.jpg'

const frames: Array<{ id: string; keys: string; rows: ReturnType<typeof ansiRow>[] }> = []
const out = await makeTempDir()
const app = render(
  <App
    initialWidth={W}
    initialHeight={H}
    prefs={{ ...DEFAULT_PREFERENCES, theme: 'dark', defaultOutput: out }}
  />,
)
const frame = () => plain(app.lastFrame())
const snap = async (id: string, keys: string, wait = 400) => {
  await settle(wait)
  const f = app.lastFrame() ?? ''
  frames.push({ id, keys, rows: f.split('\n').map((l) => ansiRow(l, W)) })
  console.log(`--- ${id}  [${keys}]\n${plain(f)}`)
}
const press = async (s: string, ms = 250) => {
  app.stdin.write(s)
  await settle(ms)
}

await until('home', () => frame().includes('1 convert'))
await settle(600)
await press('6')
await until('colour home', () => frame().includes('extract colours'))
await snap('home', '6')

// Extract
await press('a')
await snap('extract-empty', 'a')
await press(image, 300)
await press(ENTER, 1500)
await until('palette', () => frame().includes('copy all'))
await snap('extract', 'drop an image', 900)
await press(DOWN)
await press(RIGHT, 600)
await snap('extract-deeper', '↓ →')
await press(ESC, 400)
await press(ENTER)
await snap('extract-copied', '↵')
await press('s', 400)
await snap('extract-to-scale', 's')
await press(ESC)
await press(ESC)
await press(ESC, 500)

// Scale
await until('colour home again', () => frame().includes('extract colours'))
await press('s')
await snap('scale-empty', 's')
await press('6579FD')
await snap('scale-typing', '6579FD')
await press(ENTER, 500)
await snap('scale', '↵')
await press(TAB)
await snap('scale-neutral', 'tab')
await press(TAB)
await snap('scale-alpha', 'tab')
await press(TAB)
await press('s')
await snap('scale-steps', 's')
await press(ESC)
await press('t')
await snap('scale-tweak', 't')
await press(ESC)
await press(RIGHT)
await press(RIGHT)
await press('r')
await snap('scale-centre', '→→ r', 200)
await press(ESC)
await snap('scale-centre-back', 'esc')
await press(SHIFT_RIGHT)
await snap('mix-typing', '⇧→')
await press('#F5A524')
await snap('mix-typed', '#F5A524')
await press(ENTER, 500)
await snap('mix', '↵')
await press('s')
await snap('mix-steps', 's')
await press(ESC)
await press('#')
await press('banana')
await press(ENTER)
await snap('wrong', '# banana ↵')
await press(ESC)
await press(ESC)
await press(ESC)
await press(ESC, 500)

// Palette
await until('colour home 3', () => frame().includes('extract colours'))
await press('d')
await snap('palette-empty', 'd')
await press('#D2042D')
await press(ENTER, 500)
await snap('palette', '#D2042D ↵')
await press('m')
await snap('palette-mode', 'm')
await press(DOWN)
await press(DOWN)
await press(ENTER)
await snap('palette-mono', '↓↓ ↵')
await press('m')
await press(`${ESC}[A`)
await press(`${ESC}[A`)
await press(ENTER)
await press('t')
await press(RIGHT)
await press(RIGHT)
await snap('palette-tweak', 't →→')
await press(ESC)
await press('s')
await snap('palette-steps', 's')
await press(ESC)

mkdirSync('/tmp/colour-audit', { recursive: true })
writeFileSync('/tmp/colour-audit/frames.json', JSON.stringify(frames))
app.unmount()
process.exit(0)
