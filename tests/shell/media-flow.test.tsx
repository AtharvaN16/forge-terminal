import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { render } from 'ink-testing-library'
import { describe, expect, it } from 'vitest'
import { DEFAULT_PREFERENCES } from '../../src/config/preferences.js'
import { findFfmpeg, forceFfmpegForTests, probeMedia } from '../../src/engines/ffmpeg.js'
import { CATALOG } from '../../src/extensions/catalog.js'
import type { ExtensionStatus } from '../../src/extensions/manager.js'
import { App } from '../../src/shell/App.js'
import type { EditTools } from '../../src/shell/edit.js'
import { makeTempDir } from '../helpers/fixtures.js'
import { ffmpegHere, makeClip } from '../helpers/media.js'

const ESC = String.fromCharCode(27)
const RIGHT = `${ESC}[C`
const DOWN = `${ESC}[B`
const ENTER = String.fromCharCode(13)
const settle = (ms = 300) => new Promise((r) => setTimeout(r, ms))
const until = async (cond: () => boolean) => {
  for (let i = 0; i < 1200 && !cond(); i++) await new Promise((r) => setTimeout(r, 25))
}
const typed = (path: string) => (process.platform === 'win32' ? path.replaceAll('\\', '/') : path)

async function start(mode: string, tools?: EditTools) {
  const dir = await makeTempDir()
  const app = render(
    <App
      initialWidth={80}
      initialHeight={24}
      prefs={{ ...DEFAULT_PREFERENCES, theme: 'dark', defaultOutput: dir }}
      {...(tools ? { tools } : {})}
    />,
  )
  const frame = () => app.lastFrame() ?? ''
  await settle(600)
  app.stdin.write(mode)
  await settle()
  return { app, frame, dir }
}

describe.skipIf(!ffmpegHere)('video and sound in the shell', () => {
  it('converts a video: the boxes, Save as, a true bar, Done', async () => {
    const clip = await makeClip({ seconds: 2 })
    const { app, frame, dir } = await start('1')
    app.stdin.write(typed(clip))
    await until(() => frame().includes('clip.mov'))
    expect(frame()).toContain('0:02 · 320×240 · 30 fps')
    app.stdin.write(ENTER)
    await until(() => frame().includes('sound only'))
    expect(frame()).toContain('video')
    expect(frame()).toContain('▌ MP4')
    expect(frame()).toContain('H.264 · AAC')
    await settle()
    app.stdin.write(ENTER)
    await until(() => frame().includes('Save as'))
    await settle(400)
    app.stdin.write(ENTER)
    await until(() => frame().includes('convert another'))
    expect(existsSync(join(dir, 'clip.mp4'))).toBe(true)
    app.unmount()
  }, 60_000)

  it('makes a GIF: which part first', async () => {
    const clip = await makeClip({ seconds: 3 })
    const { app, frame } = await start('1')
    app.stdin.write(typed(clip))
    await until(() => frame().includes('clip.mov'))
    app.stdin.write(ENTER)
    await until(() => frame().includes('sound only'))
    await settle()
    for (let i = 0; i < 3; i++) {
      app.stdin.write(DOWN)
      await settle(80)
    }
    await until(() => frame().includes('256 colours · no sound'))
    app.stdin.write(ENTER)
    await until(() => frame().includes('keeps 0:03.0 of 0:03'))
    expect(frame()).toContain('step')
    app.unmount()
  }, 60_000)

  it('trims in edit, then c takes the result on to compress', async () => {
    const clip = await makeClip({ seconds: 4, keyframes: 1 })
    const { app, frame, dir } = await start('4')
    app.stdin.write(typed(clip))
    await until(() => frame().includes('clip.mov'))
    app.stdin.write(ENTER)
    await until(() => frame().includes('Edit MOV'))
    expect(frame()).toContain('Trim')
    expect(frame()).toContain('Mute')
    expect(frame()).toContain('Cuts off the start and the end.')
    await settle()
    app.stdin.write(ENTER)
    await until(() => frame().includes('keeps 0:04.0 of 0:04'))
    // The start moves a second, twice.
    app.stdin.write(RIGHT)
    await settle(80)
    app.stdin.write(RIGHT)
    await until(() => frame().includes('keeps 0:02.0'))
    app.stdin.write(ENTER)
    await until(() => frame().includes('Save as'))
    expect(frame()).toContain('clip-trimmed')
    await settle(400)
    app.stdin.write(ENTER)
    await until(() => frame().includes('compress it'))
    const out = join(dir, 'clip-trimmed.mov')
    expect(existsSync(out)).toBe(true)
    expect((await probeMedia(out)).duration).toBeLessThan(3.2)
    await settle(300)
    app.stdin.write('c')
    await until(() => frame().includes('Method'))
    expect(frame()).toContain('clip-trimmed.mov')
    app.unmount()
  }, 60_000)

  it('refuses a size under what the video can get, as compress says it', async () => {
    const clip = await makeClip({ seconds: 4 })
    const { app, frame } = await start('2')
    app.stdin.write(typed(clip))
    await until(() => frame().includes('clip.mov'))
    app.stdin.write(ENTER)
    await until(() => frame().includes('Method'))
    await settle()
    app.stdin.write(DOWN)
    await settle(100)
    app.stdin.write(ENTER)
    await until(() => frame().includes('Target size'))
    // A 4 s clip can get under 1 MB, so KB is offered; B never.
    expect(frame()).toContain('KB')
    expect(frame()).not.toMatch(/ {2}B {2}/)
    app.stdin.write('1kb')
    await until(() => frame().includes('cannot compress more'))
    app.unmount()
  }, 60_000)
})

describe.skipIf(!ffmpegHere)('without ffmpeg', () => {
  it('says how to get it, and goes on by itself once it is there', async () => {
    const clip = await makeClip({ seconds: 1 })
    const real = await findFfmpeg()
    forceFfmpegForTests(undefined)
    try {
      const { app, frame } = await start('2')
      app.stdin.write(typed(clip))
      await until(() => frame().includes('clip.mov'))
      // Known from its bytes alone: a video, its size, nothing more.
      expect(frame()).toContain('video · ')
      app.stdin.write(ENTER)
      await until(() => frame().includes('needs ffmpeg'))
      expect(frame()).toContain('Video and audio')
      expect(frame()).toContain('look again')
      // Installed in another window: ↵ finds it, and compress goes on.
      forceFfmpegForTests(real ?? null)
      await settle()
      app.stdin.write(ENTER)
      await until(() => frame().includes('Method'))
      expect(frame()).toContain('0:01')
      app.unmount()
    } finally {
      forceFfmpegForTests(null)
    }
  }, 60_000)

  it('offers the download in place, then goes on', async () => {
    const clip = await makeClip({ seconds: 1 })
    const real = await findFfmpeg()
    forceFfmpegForTests(undefined)
    const entry = { ...(CATALOG.find((e) => e.id === 'video') as (typeof CATALOG)[number]) }
    let release: () => void = () => {}
    const gate = new Promise<void>((r) => {
      release = r
    })
    const tools: EditTools = {
      async list() {
        return [
          {
            entry,
            updateAvailable: false,
            supported: true,
            downloadBytes: 31_400_000,
          } as ExtensionStatus,
        ]
      },
      async install(_id, { onProgress }) {
        onProgress(12_600_000, 31_400_000)
        await gate
        forceFfmpegForTests(real ?? null)
        return { version: '1.0.0' }
      },
    }
    try {
      const { app, frame } = await start('1', tools)
      app.stdin.write(typed(clip))
      await until(() => frame().includes('clip.mov'))
      app.stdin.write(ENTER)
      await until(() => frame().includes('31.4 MB download'))
      await settle()
      app.stdin.write(ENTER)
      await until(() => frame().includes('12.6 of 31.4 MB'))
      release()
      await until(() => frame().includes('sound only'))
      app.unmount()
    } finally {
      forceFfmpegForTests(null)
    }
  }, 60_000)
})
