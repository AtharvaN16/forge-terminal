/** THROWAWAY: captures frames for scripts/video-mockup.ts. Delete after. */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { render } from 'ink-testing-library'
import sharp from 'sharp'
import { it, vi } from 'vitest'
import { DEFAULT_PREFERENCES } from '../../src/config/preferences.js'
import { App } from '../../src/shell/App.js'
import { makeTempDir } from '../helpers/fixtures.js'
import { ansiRow } from './home-cells.js'

vi.hoisted(() => {
  process.env.FORCE_COLOR = '3'
  process.env.NO_COLOR = ''
})
const ENTER = String.fromCharCode(13)
const DOWN = '\u001b[B'
const settle = (ms = 400) => new Promise((r) => setTimeout(r, ms))
const cells = (f: string) => f.split('\n').map((l) => ansiRow(l, 80))

it('captures dark', async () => {
  const root = await makeTempDir()
  const shot = join(root, 'Screen Recording.jpg')
  const w = 1440
  const h = 900
  const raw = Buffer.alloc(w * h * 3)
  for (let i = 0; i < raw.length; i++) raw[i] = (i * 7919) % 251
  await sharp(raw, { raw: { width: w, height: h, channels: 3 } })
    .jpeg({ quality: 95 })
    .toFile(shot)
  const prefs = { ...DEFAULT_PREFERENCES, theme: 'dark' as const, defaultOutput: root }
  const out: Record<string, unknown> = {}

  // Convert: home staged → Convert to → Quality → Save as → Done
  let app = render(<App initialWidth={80} initialHeight={24} prefs={prefs} />)
  await settle(1500)
  app.stdin.write('1')
  await settle()
  out.home = cells(app.lastFrame() ?? '')
  app.stdin.write(shot)
  await settle(900)
  out.staged = cells(app.lastFrame() ?? '')
  app.stdin.write(ENTER)
  await settle(800)
  out.target = cells(app.lastFrame() ?? '')
  app.stdin.write(ENTER)
  await settle(1000)
  out.quality = cells(app.lastFrame() ?? '')
  app.stdin.write(ENTER)
  await settle(800)
  out.saveas = cells(app.lastFrame() ?? '')
  app.stdin.write(ENTER)
  await settle(2500)
  out.done = cells(app.lastFrame() ?? '')
  app.unmount()

  // Compress: how → size field
  app = render(<App initialWidth={80} initialHeight={24} prefs={prefs} />)
  await settle(1500)
  app.stdin.write('2')
  await settle()
  app.stdin.write(shot)
  await settle(900)
  out.stagedCompress = cells(app.lastFrame() ?? '')
  app.stdin.write(ENTER)
  await settle(800)
  out.how = cells(app.lastFrame() ?? '')
  app.stdin.write(DOWN)
  await settle(200)
  app.stdin.write(ENTER)
  await settle(800)
  out.size = cells(app.lastFrame() ?? '')
  app.stdin.write('10mb')
  await settle(500)
  out.sizeTyped = cells(app.lastFrame() ?? '')
  app.unmount()

  // Edit: the split picker
  app = render(<App initialWidth={80} initialHeight={24} prefs={prefs} />)
  await settle(1500)
  app.stdin.write('4')
  await settle()
  app.stdin.write(shot)
  await settle(900)
  out.stagedEdit = cells(app.lastFrame() ?? '')
  app.stdin.write(ENTER)
  await settle(1000)
  out.edit = cells(app.lastFrame() ?? '')
  app.unmount()

  mkdirSync('/tmp/forge-video', { recursive: true })
  writeFileSync('/tmp/forge-video/frames-dark.json', JSON.stringify(out))
  writeFileSync(
    '/tmp/forge-video/frames-dark.txt',
    Object.entries(out)
      .map(
        ([k, v]) =>
          `=== ${k}\n${(v as { ch: string }[][]).map((r) => r.map((c) => c.ch).join('')).join('\n')}`,
      )
      .join('\n'),
  )
}, 60_000)
