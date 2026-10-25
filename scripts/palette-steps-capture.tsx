/**
 * Captures the Palette tab as built (dev), at rest and with the steps open,
 * at 80 × 26 dark, for mockups/palette-steps-frame-2026-10.html.
 *
 *   FORCE_COLOR=3 FORGE_NO_FIND=1 npx tsx scripts/palette-steps-capture.tsx → /tmp/palette-steps/frames-26.json, kept as scripts/palette-steps-frames.json
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { render } from 'ink-testing-library'
import React from 'react'
import { DEFAULT_PREFERENCES } from '../src/config/preferences.js'
import { App } from '../src/shell/App.js'
import { makeTempDir } from '../tests/helpers/fixtures.js'
import { ansiRow } from '../tests/shell/home-cells.js'

const W = 80
const H = Number(process.env.ROWS ?? 26)
const ESC = String.fromCharCode(27)
const SGR = new RegExp(`${ESC}\\[[0-9;]*m`, 'g')
const plain = (f: string | undefined) => (f ?? '').replace(SGR, '')
const settle = (ms = 300) => new Promise((r) => setTimeout(r, ms))
const out = await makeTempDir()
const app = render(
  <App initialWidth={W} initialHeight={H} prefs={{ ...DEFAULT_PREFERENCES, theme: 'dark', defaultOutput: out }} />,
)
async function until(cond: () => boolean) {
  const end = Date.now() + 15_000
  while (!cond() && Date.now() < end) await settle(25)
}
const frames: Record<string, ReturnType<typeof ansiRow>[]> = {}
const snap = async (id: string) => {
  await settle(400)
  const f = app.lastFrame() ?? ''
  frames[id] = f.split('\n').map((l) => ansiRow(l, W))
  console.log(`--- ${id}\n${plain(f)}`)
}
await until(() => plain(app.lastFrame()).includes('1 convert'))
app.stdin.write('6')
await until(() => plain(app.lastFrame()).includes('build a palette'))
await settle()
app.stdin.write('d')
await until(() => plain(app.lastFrame()).includes('type a hex'))
app.stdin.write('#65BB75')
await until(() => plain(app.lastFrame()).includes('Full set'))
await settle()
app.stdin.write(`${ESC}[B`)
await settle(150)
app.stdin.write(`${ESC}[C`)
await snap('rest')
app.stdin.write('s')
await snap('steps')
app.stdin.write('\t')
await snap('steps-from')
mkdirSync('/tmp/palette-steps', { recursive: true })
writeFileSync(`/tmp/palette-steps/frames-${H}.json`, JSON.stringify(frames))
app.unmount()
process.exit(0)
