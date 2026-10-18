import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { render } from 'ink-testing-library'
import { afterEach, describe, expect, it } from 'vitest'
import { DEFAULT_PREFERENCES } from '../../src/config/preferences.js'
import { App } from '../../src/shell/App.js'
import { fakeTranscribeHelper } from '../helpers/fake-transcribe.js'
import { fakeYtDlp } from '../helpers/fake-ytdlp.js'
import { makePng, makeTempDir } from '../helpers/fixtures.js'

/**
 * Transcribe in the app (spec 2026-10-17-transcribe-design §4.4,
 * mockups/transcribe-2026-10-round2.html), against a stand-in for the Swift
 * helper and for yt-dlp.
 */
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
/** The first bytes of an MP4: what `sniffKind` reads it by. */
const MP4 = Buffer.from([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0, 0, 2, 0])

const RESULT = {
  ok: true,
  locale: 'en_US',
  seconds: 75,
  segments: [
    { start: 0, end: 3, text: 'Hello and welcome.' },
    { start: 70, end: 72, text: 'Now, milk.' },
  ],
  notes: {
    summary: 'About tea.',
    parts: [
      { start: 0, heading: 'Welcome', points: ['Tea.'], refused: false },
      { start: 70, heading: 'Milk', points: ['Milk.'], refused: false },
    ],
  },
}

const savedHelper = process.env.FORGE_TRANSCRIBE_HELPER
const savedXdg = process.env.XDG_CONFIG_HOME
afterEach(() => {
  if (savedHelper === undefined) delete process.env.FORGE_TRANSCRIBE_HELPER
  else process.env.FORGE_TRANSCRIBE_HELPER = savedHelper
  if (savedXdg === undefined) delete process.env.XDG_CONFIG_HOME
  else process.env.XDG_CONFIG_HOME = savedXdg
})

async function setUp(notes: 'available' | 'off' = 'available') {
  const fake = await fakeTranscribeHelper({
    status: { lines: [{ ok: true, speech: true, locale: 'en_US', notes }] },
    probe: { lines: [{ ok: true, seconds: 3717, sound: true }] },
    run: {
      lines: [
        { event: 'heard', seconds: 70, of: 75 },
        { event: 'notes', part: 1, of: 2 },
        notes === 'available' ? RESULT : { ...RESULT, notes: undefined },
      ],
    },
  })
  process.env.FORGE_TRANSCRIBE_HELPER = fake.path
  const dir = await makeTempDir()
  const input = join(dir, 'talk.mp4')
  await writeFile(input, MP4)
  const out = await makeTempDir()
  const app = render(
    <App
      initialWidth={80}
      initialHeight={24}
      prefs={{ ...DEFAULT_PREFERENCES, theme: 'dark', defaultOutput: out }}
    />,
  )
  await until(() => plain(app.lastFrame()).includes('1 convert'))
  return { app, dir, input, out, fake }
}
const frame = (app: ReturnType<typeof render>) => plain(app.lastFrame())

describe('transcribe on home', () => {
  it('6 makes transcribe the mode, asking for a video or sound file, or a link', async () => {
    const { app } = await setUp()
    app.stdin.write('6')
    await until(() => frame(app).includes('Drop a video or sound file'))
    expect(frame(app)).toContain('or paste a YouTube link')
    expect(frame(app)).toContain('or type a path or link')
  }, 30_000)

  it('/transcribe opens it too', async () => {
    const { app } = await setUp()
    app.stdin.write('/transcribe')
    await settle()
    app.stdin.write(ENTER)
    await until(() => frame(app).includes('Drop a video or sound file'))
  }, 30_000)

  it('a dropped video waits as its card: its length and size', async () => {
    const { app, input } = await setUp()
    app.stdin.write('6')
    await until(() => frame(app).includes('Drop a video or sound file'))
    // A whole path at once is a drop: read, no ↵ needed.
    app.stdin.write(input)
    await until(() => frame(app).includes('1:01:57'))
    expect(frame(app)).toContain('talk.mp4')
    expect(frame(app).split('\n').at(-1)).toMatch(/↵ +transcribe/)
  }, 30_000)

  it('a picture is refused under the field, by its content', async () => {
    const { app } = await setUp()
    const png = await makePng(await makeTempDir(), 'still.mp4')
    app.stdin.write('6')
    await until(() => frame(app).includes('Drop a video or sound file'))
    app.stdin.write(png)
    await settle()
    app.stdin.write(ENTER)
    await until(() => frame(app).includes('Cannot transcribe this file'))
  }, 30_000)

  it('a pasted link shows the video’s title and channel once yt-dlp has looked it up', async () => {
    const { app } = await setUp()
    await fakeYtDlp({
      facts: { title: 'Me at the zoo', uploader: 'jawed', duration: 19, is_live: false },
    })
    app.stdin.write('6')
    await until(() => frame(app).includes('Drop a video or sound file'))
    app.stdin.write('https://youtu.be/jNQXAC9IVRw')
    await settle()
    app.stdin.write(ENTER)
    await until(() => frame(app).includes('Me at the zoo'))
    expect(frame(app)).toContain('jawed · 0:19')
    expect(frame(app)).toContain('YouTube')
  }, 30_000)

  it('a playlist is refused under the field', async () => {
    const { app } = await setUp()
    app.stdin.write('6')
    await until(() => frame(app).includes('Drop a video or sound file'))
    app.stdin.write('https://www.youtube.com/playlist?list=PL590L5WQmH8fJ54F369BLDSqIwcs-TCfs')
    await settle()
    app.stdin.write(ENTER)
    await until(() => frame(app).includes('This is a playlist.'))
  }, 30_000)
})

describe('transcribe, from ↵ to Done', () => {
  const DOWN = `${ESC}[B`

  async function staged(notes: 'available' | 'off' = 'available') {
    const s = await setUp(notes)
    s.app.stdin.write('6')
    await until(() => frame(s.app).includes('Drop a video or sound file'))
    s.app.stdin.write(s.input)
    await until(() => frame(s.app).includes('1:01:57'))
    await settle()
    return s
  }

  it('asks Notes or Only transcript, then Save as, then writes the .md and shows Done', async () => {
    const { app, out } = await staged()
    app.stdin.write(ENTER)
    await until(() => frame(app).includes('Only transcript'))
    await settle()
    expect(frame(app)).toContain('Transcribe to')
    expect(frame(app)).toContain('summary, notes and transcript · .md')
    app.stdin.write(ENTER)
    await until(() => frame(app).includes('Save as'))
    await settle()
    app.stdin.write(ENTER)
    await until(() => frame(app).includes('✓ talk.md'))
    await settle()
    const done = frame(app)
    expect(done).toContain('done')
    expect(done).toMatch(/0:00\s+Welcome/)
    expect(done).toMatch(/1:10\s+Milk/)
    expect(done.split('\n').at(-1)).toMatch(/↵ +new +o +open +s +finder +c +copy/)
    const md = await readFile(join(out, 'talk.md'), 'utf8')
    expect(md).toContain('## Notes')
    expect(md).toContain('### Milk · 1:10')
  }, 40_000)

  it('skips Transcribe to when Apple Intelligence is off: there is nothing to choose', async () => {
    const { app, fake } = await staged('off')
    app.stdin.write(ENTER)
    await until(() => frame(app).includes('Save as'))
    await settle()
    expect(frame(app)).not.toContain('Transcribe to')
    app.stdin.write(ENTER)
    await until(() => frame(app).includes('✓ talk.md'))
    await settle()
    expect(JSON.parse(await readFile(join(fake.dir, 'argv.json'), 'utf8'))).toEqual([
      'run',
      expect.any(String),
    ])
  }, 40_000)

  it('writes the transcript alone when Only transcript is chosen', async () => {
    const { app, fake } = await staged()
    app.stdin.write(ENTER)
    await until(() => frame(app).includes('Only transcript'))
    await settle()
    app.stdin.write(DOWN)
    await settle()
    app.stdin.write(ENTER)
    await until(() => frame(app).includes('Save as'))
    await settle()
    app.stdin.write(ENTER)
    await until(() => frame(app).includes('✓ talk.md'))
    await settle()
    const argv = JSON.parse(await readFile(join(fake.dir, 'argv.json'), 'utf8')) as string[]
    expect(argv).not.toContain('--notes')
  }, 40_000)

  it('esc on Transcribe to goes home, the file still there', async () => {
    const { app } = await staged()
    app.stdin.write(ENTER)
    await until(() => frame(app).includes('Only transcript'))
    await settle()
    app.stdin.write(ESC)
    await until(
      () =>
        frame(app).includes('Drop a video or sound file') || frame(app).includes('↵  transcribe'),
    )
    expect(frame(app)).toContain('talk.mp4')
  }, 40_000)

  it('↵ on Done starts again, with nothing staged', async () => {
    const { app } = await staged()
    app.stdin.write(ENTER)
    await until(() => frame(app).includes('Only transcript'))
    await settle()
    app.stdin.write(ENTER)
    await until(() => frame(app).includes('Save as'))
    await settle()
    app.stdin.write(ENTER)
    await until(() => frame(app).includes('✓ talk.md'))
    await settle()
    app.stdin.write(ENTER)
    await until(() => frame(app).includes('Drop a video or sound file'))
    expect(frame(app)).not.toContain('talk.mp4')
  }, 40_000)
})
