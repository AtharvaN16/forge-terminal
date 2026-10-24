/**
 * Captures the real transcribe screens at 80 × 24, dark, for the round three
 * mockup (scripts/transcribe-r3-mockup.ts): Transcribe to, Save as, and
 * Working while it transcribes and while it writes notes. The Swift helper
 * is the tests' stand-in; it stops answering at the moment captured.
 *
 *   FORCE_COLOR=3 FORGE_NO_FIND=1 npx tsx scripts/transcribe-r3-capture.tsx → /tmp/forge-transcribe-r3/frames.json
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { render } from 'ink-testing-library'
import React from 'react'
import { DEFAULT_PREFERENCES } from '../src/config/preferences.js'
import { App } from '../src/shell/App.js'
import { fakeTranscribeHelper } from '../tests/helpers/fake-transcribe.js'
import { makeTempDir } from '../tests/helpers/fixtures.js'
import { ansiRow } from '../tests/shell/home-cells.js'

const ESC = String.fromCharCode(27)
const ENTER = String.fromCharCode(13)
const SGR = new RegExp(`${ESC}\\[[0-9;]*m`, 'g')
const plain = (f: string | undefined) => (f ?? '').replace(SGR, '')
const settle = (ms = 200) => new Promise((r) => setTimeout(r, ms))
async function until(cond: () => boolean, ms = 20_000) {
  const end = Date.now() + ms
  while (!cond()) {
    if (Date.now() > end) throw new Error('until gave up')
    await settle(25)
  }
}
const MP4 = Buffer.from([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0, 0, 2, 0])

type Cell = { ch: string; fg: string | null; bg: string | null; b: boolean }
const cells = (frame: string): Cell[][] => {
  const lines = frame.split('\n')
  const w = Math.max(...lines.map((l) => [...plain(l)].length), 80)
  return lines.map((l) => ansiRow(l, w).map((c) => ({ ch: c.ch, fg: c.fg, bg: c.bg, b: c.b })))
}

async function session(run: object[], hang = true) {
  const fake = await fakeTranscribeHelper({
    status: { lines: [{ ok: true, speech: true, locale: 'en_US', notes: 'available' }] },
    probe: { lines: [{ ok: true, seconds: 3717, sound: true }] },
    run: { lines: run, hang },
  })
  process.env.FORGE_TRANSCRIBE_HELPER = fake.path
  const dir = await makeTempDir()
  const input = join(dir, 'influence-talk.mp4')
  await writeFile(input, MP4)
  const out = await makeTempDir()
  const app = render(
    <App
      initialWidth={80}
      initialHeight={24}
      prefs={{ ...DEFAULT_PREFERENCES, theme: 'dark', defaultOutput: out }}
    />,
  )
  const frame = () => plain(app.lastFrame())
  await until(() => frame().includes('1 convert'))
  app.stdin.write('5')
  await until(() => frame().includes('Drop a video or audio file'))
  app.stdin.write(input)
  await until(() => frame().includes('1:01:57'))
  app.stdin.write(ENTER)
  await until(() => frame().includes('Transcribe to'))
  await settle()
  return { app, frame }
}

const frames: Record<string, Cell[][]> = {}

{
  const { app, frame } = await session([{ event: 'heard', seconds: 1390, of: 3717 }])
  frames.choose = cells(app.lastFrame() ?? '')
  app.stdin.write(ENTER)
  await until(() => frame().includes('Save as'))
  await settle()
  frames.saveAs = cells(app.lastFrame() ?? '')
  app.stdin.write(ENTER)
  await until(() => frame().includes('Transcribing'))
  await settle(3400)
  frames.heard = cells(app.lastFrame() ?? '')
  app.unmount()
}
{
  const { app, frame } = await session([
    { event: 'heard', seconds: 3717, of: 3717 },
    { event: 'notes', part: 3, of: 5 },
  ])
  app.stdin.write(ENTER)
  await until(() => frame().includes('Save as'))
  app.stdin.write(ENTER)
  await until(() => frame().includes('Writing notes'))
  await settle(3400)
  frames.notes = cells(app.lastFrame() ?? '')
  app.unmount()
}

{
  const part = (start: number, heading: string) => ({
    start,
    heading,
    points: ['…'],
    refused: false,
  })
  const { app, frame } = await session(
    [
      {
        ok: true,
        locale: 'en_US',
        seconds: 3717,
        segments: [{ start: 0, end: 3, text: 'Hello.' }],
        notes: {
          summary: '…',
          parts: [
            part(0, 'Why we say yes'),
            part(842, 'Reciprocity and the free sample'),
            part(1690, 'Scarcity and the lost chance'),
            part(2511, 'Authority and the uniform'),
            part(3240, 'Questions from the room'),
          ],
        },
      },
    ],
    false,
  )
  app.stdin.write(ENTER)
  await until(() => frame().includes('Save as'))
  app.stdin.write(ENTER)
  await until(() => frame().includes('✓ influence-talk.md'))
  await settle()
  frames.done = cells(app.lastFrame() ?? '')
  app.unmount()
}

mkdirSync('/tmp/forge-transcribe-r3', { recursive: true })
writeFileSync('/tmp/forge-transcribe-r3/frames.json', JSON.stringify(frames))
for (const [k, g] of Object.entries(frames))
  console.log(`--- ${k}\n${g.map((r) => r.map((c) => c.ch).join('')).join('\n')}`)
process.exit(0)
