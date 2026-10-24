import { render } from 'ink-testing-library'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_PREFERENCES } from '../../src/config/preferences.js'
import { App } from '../../src/shell/App.js'
import { fakeTranscribeHelper } from '../helpers/fake-transcribe.js'
import { fakeYtDlp } from '../helpers/fake-ytdlp.js'
import { makeTempDir } from '../helpers/fixtures.js'

/**
 * A YouTube link with no yt-dlp anywhere (mockups/own-tools-2026-10-round5.html,
 * F2): the need is said in the field, beside ↵ install; the download shows
 * there; once it is in, Forge goes straight on to Transcribe to. The
 * download itself is a stand-in that puts the fake yt-dlp in place.
 */
let release: () => void = () => {}
vi.mock('../../src/extensions/manager.js', async (original) => ({
  ...(await original<typeof import('../../src/extensions/manager.js')>()),
  installExtension: vi.fn(
    async (_id: string, opts: { onProgress?: (done: number, total: number) => void }) => {
      opts.onProgress?.(12.6e6, 37146048)
      await new Promise<void>((r) => {
        release = r
      })
      const home = process.env.XDG_CONFIG_HOME
      await fakeYtDlp({
        facts: { title: 'Me at the zoo', uploader: 'jawed', duration: 19, is_live: false },
      })
      // fakeYtDlp points the config at its own folder; the app's stays where it was.
      const { cp } = await import('node:fs/promises')
      const { join } = await import('node:path')
      const made = process.env.XDG_CONFIG_HOME as string
      if (home) {
        await cp(join(made, 'forge'), join(home, 'forge'), { recursive: true })
        process.env.XDG_CONFIG_HOME = home
      }
    },
  ),
}))

const ESC = String.fromCharCode(27)
const ENTER = String.fromCharCode(13)
const SGR = new RegExp(`${ESC}\\[[0-9;]*m`, 'g')
const plain = (f: string | undefined) => (f ?? '').replace(SGR, '')
const settle = (ms = 200) => new Promise((r) => setTimeout(r, ms))
const until = async (cond: () => boolean, ms = 20_000) => {
  const end = Date.now() + ms
  while (!cond()) {
    if (Date.now() > end) throw new Error('until gave up')
    await settle(25)
  }
}

const saved = { helper: process.env.FORGE_TRANSCRIBE_HELPER, xdg: process.env.XDG_CONFIG_HOME }
afterEach(() => {
  for (const [k, v] of [
    ['FORGE_TRANSCRIBE_HELPER', saved.helper],
    ['XDG_CONFIG_HOME', saved.xdg],
  ] as const) {
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
})

describe('a YouTube link with no yt-dlp', () => {
  it('says the need in the field, installs on ↵, then goes straight on to Transcribe to', async () => {
    process.env.XDG_CONFIG_HOME = await makeTempDir()
    const fake = await fakeTranscribeHelper({
      status: { lines: [{ ok: true, speech: true, locale: 'en_US', notes: 'available' }] },
      probe: { lines: [{ ok: true, seconds: 19, sound: true }] },
      run: { lines: [], hang: true },
      render: { lines: [{ ok: true }] },
    })
    process.env.FORGE_TRANSCRIBE_HELPER = fake.path
    const app = render(
      <App
        initialWidth={100}
        initialHeight={24}
        prefs={{ ...DEFAULT_PREFERENCES, theme: 'dark', defaultOutput: await makeTempDir() }}
      />,
    )
    const frame = () => plain(app.lastFrame())
    await until(() => frame().includes('1 convert'))
    app.stdin.write('5')
    await until(() => frame().includes('or a YouTube link'))
    app.stdin.write('https://youtu.be/jNQXAC9IVRw')
    await settle()
    app.stdin.write(ENTER)
    await until(() => frame().includes('YouTube links need yt-dlp · 37.1 MB download'))
    expect(frame()).toContain('↵ install')
    expect(frame()).not.toContain('or paste another link')
    // The card keeps only the link.
    expect(frame()).not.toMatch(/│ YouTube links need/)

    app.stdin.write(ENTER)
    await until(() => frame().includes('Installing yt-dlp'))
    await until(() => frame().includes('12.6 of 37.1 MB'))
    release()
    await until(() => frame().includes('Transcribe to'))
    expect(frame()).toContain('Me at the zoo')
  }, 30_000)
})
