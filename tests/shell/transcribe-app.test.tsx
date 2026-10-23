import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { render } from 'ink-testing-library'
import { afterEach, describe, expect, it } from 'vitest'
import { DEFAULT_PREFERENCES, type Preferences } from '../../src/config/preferences.js'
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
const TAB = '\t'
const DOWN = `${ESC}[B`
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

async function setUp(
  notes: 'available' | 'off' = 'available',
  opts: {
    run?: object[]
    hang?: boolean
    prefs?: Partial<Preferences>
    width?: number
  } = {},
) {
  const fake = await fakeTranscribeHelper({
    status: { lines: [{ ok: true, speech: true, locale: 'en_US', notes }] },
    probe: { lines: [{ ok: true, seconds: 3717, sound: true }] },
    run: {
      lines: opts.run ?? [
        { event: 'heard', seconds: 70, of: 75 },
        { event: 'notes', part: 1, of: 2 },
        notes === 'available' ? RESULT : { ...RESULT, notes: undefined },
      ],
      ...(opts.hang ? { hang: true } : {}),
    },
    // Word and PDF: the stand-in writes the HTML it was given, marked.
    render: { lines: [{ ok: true }], echo: { from: 1, to: 2, prefix: 'rendered:' } },
  })
  process.env.FORGE_TRANSCRIBE_HELPER = fake.path
  const dir = await makeTempDir()
  const input = join(dir, 'talk.mp4')
  await writeFile(input, MP4)
  const out = await makeTempDir()
  const app = render(
    <App
      initialWidth={opts.width ?? 80}
      initialHeight={24}
      prefs={{ ...DEFAULT_PREFERENCES, theme: 'dark', defaultOutput: out, ...opts.prefs }}
    />,
  )
  await until(() => plain(app.lastFrame()).includes('1 convert'))
  return { app, dir, input, out, fake }
}
const frame = (app: ReturnType<typeof render>) => plain(app.lastFrame())

describe('transcribe on home', () => {
  it('5 makes transcribe the mode, asking for a video or sound file, or a link', async () => {
    const { app } = await setUp()
    app.stdin.write('5')
    await until(() => frame(app).includes('Drop a video or audio file'))
    expect(frame(app)).toContain('or paste a YouTube link')
    expect(frame(app)).toContain('OR search or enter a file path…')
    expect(frame(app)).not.toContain('(English only)')
    // on the key row, at its left edge, not above it beside "/ menu"
    const lines = frame(app).split('\n')
    expect(lines.at(-1)).toMatch(/^\s{1,6}Currently only English is supported\s+1–6 ←→ mode/)
    expect(lines.filter((l) => l.includes('English'))).toHaveLength(1)
  }, 30_000)

  it('/transcribe opens it too', async () => {
    const { app } = await setUp()
    app.stdin.write('/transcribe')
    await settle()
    app.stdin.write(ENTER)
    await until(() => frame(app).includes('Drop a video or audio file'))
  }, 30_000)

  it('a dropped video waits as its card: its length and size', async () => {
    const { app, input } = await setUp()
    app.stdin.write('5')
    await until(() => frame(app).includes('Drop a video or audio file'))
    // A whole path at once is a drop: read, no ↵ needed.
    app.stdin.write(input)
    await until(() => frame(app).includes('1:01:57'))
    expect(frame(app)).toContain('talk.mp4')
    expect(frame(app).split('\n').at(-1)).toMatch(/↵ +transcribe/)
  }, 30_000)

  it('a picture is refused under the field, by its content', async () => {
    const { app } = await setUp()
    const png = await makePng(await makeTempDir(), 'still.mp4')
    app.stdin.write('5')
    await until(() => frame(app).includes('Drop a video or audio file'))
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
    app.stdin.write('5')
    await until(() => frame(app).includes('Drop a video or audio file'))
    app.stdin.write('https://youtu.be/jNQXAC9IVRw')
    await settle()
    app.stdin.write(ENTER)
    await until(() => frame(app).includes('Me at the zoo'))
    expect(frame(app)).toContain('jawed · 0:19')
    expect(frame(app)).toContain('YouTube')
  }, 30_000)

  it('a playlist is refused under the field', async () => {
    const { app } = await setUp()
    app.stdin.write('5')
    await until(() => frame(app).includes('Drop a video or audio file'))
    app.stdin.write('https://www.youtube.com/playlist?list=PL590L5WQmH8fJ54F369BLDSqIwcs-TCfs')
    await settle()
    app.stdin.write(ENTER)
    await until(() => frame(app).includes('This is a playlist.'))
  }, 30_000)
})

describe('transcribe, from ↵ to Done', () => {
  const RIGHT = `${ESC}[C`

  async function staged(
    notes: 'available' | 'off' = 'available',
    opts: Parameters<typeof setUp>[1] = {},
  ) {
    const s = await setUp(notes, opts)
    s.app.stdin.write('5')
    await until(() => frame(s.app).includes('Drop a video or audio file'))
    s.app.stdin.write(s.input)
    await until(() => frame(s.app).includes('1:01:57'))
    await settle()
    return s
  }

  it('drops the English note once the key row has keys', async () => {
    // 100 columns: wide enough that the note would fit beside ↵ transcribe.
    const { app } = await staged('available', { width: 100 })
    const keys = frame(app).split('\n').at(-1) ?? ''
    expect(keys).toContain('transcribe')
    expect(frame(app)).not.toContain('Currently only English is supported')
  }, 30_000)

  it('asks Transcribe to, then Format, then Save as, then writes the .md and shows Done', async () => {
    const { app, out } = await staged()
    app.stdin.write(ENTER)
    await until(() => frame(app).includes('Transcribe to'))
    await settle()
    expect(frame(app)).toContain('Transcribe to')
    // The format is its own step now: the row no longer says ".md".
    expect(frame(app)).toContain('summary, notes and transcript')
    expect(frame(app)).not.toContain('.md')
    app.stdin.write(ENTER)
    await until(() => frame(app).includes('Markdown'))
    await settle()
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
    // Done's way on, as on every Done: the actions and Home, ←→ to choose.
    expect(done).toMatch(/o Open +f \S+ +c Copy +↵ Home/)
    expect(done.split('\n').at(-1)).toMatch(/←→ +choose +↵ +confirm/)
    const md = await readFile(join(out, 'talk.md'), 'utf8')
    expect(md).toContain('## Notes')
    expect(md).toContain('### Milk · 1:10')
  }, 40_000)

  it('leaves Done for home with ↵ on Home, after ←→, and with esc', async () => {
    for (const leave of [[`${ESC}[D`, RIGHT, ENTER], [ESC]]) {
      const { app } = await staged()
      app.stdin.write(ENTER)
      await until(() => frame(app).includes('Transcribe to'))
      await settle()
      app.stdin.write(ENTER)
      await until(() => frame(app).includes('Markdown'))
      await settle()
      app.stdin.write(ENTER)
      await until(() => frame(app).includes('Save as'))
      await settle()
      app.stdin.write(ENTER)
      await until(() => frame(app).includes('↵ Home'))
      await settle()
      for (const k of leave) {
        app.stdin.write(k)
        await settle(150)
      }
      await until(() => frame(app).includes('Drop a video or audio file'))
    }
  }, 60_000)

  it('skips Transcribe to when Apple Intelligence is off: Format comes first', async () => {
    const { app, fake } = await staged('off')
    app.stdin.write(ENTER)
    await until(() => frame(app).includes('Markdown'))
    await settle()
    expect(frame(app)).not.toContain('Transcribe to')
    app.stdin.write(ENTER)
    await until(() => frame(app).includes('Save as'))
    await settle()
    app.stdin.write(ENTER)
    await until(() => frame(app).includes('✓ talk.md'))
    await settle()
    expect(JSON.parse(await readFile(join(fake.dir, 'argv.json'), 'utf8'))).toEqual([
      'run',
      expect.any(String),
    ])
  }, 40_000)

  it('writes the transcript alone when Transcript is chosen', async () => {
    const { app, fake } = await staged()
    app.stdin.write(ENTER)
    await until(() => frame(app).includes('Transcribe to'))
    await settle()
    app.stdin.write(DOWN)
    await settle()
    app.stdin.write(DOWN)
    await settle()
    app.stdin.write(ENTER)
    await until(() => frame(app).includes('Markdown'))
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

  it('writes the notes without the transcript when Notes is chosen', async () => {
    const { app, out, fake } = await staged()
    app.stdin.write(ENTER)
    await until(() => frame(app).includes('Transcribe to'))
    await settle()
    app.stdin.write(DOWN)
    await settle()
    expect(frame(app)).toContain('summary and notes')
    app.stdin.write(ENTER)
    await until(() => frame(app).includes('Markdown'))
    await settle()
    app.stdin.write(ENTER)
    await until(() => frame(app).includes('Save as'))
    await settle()
    app.stdin.write(ENTER)
    await until(() => frame(app).includes('✓ talk.md'))
    await settle()
    const argv = JSON.parse(await readFile(join(fake.dir, 'argv.json'), 'utf8')) as string[]
    expect(argv).toContain('--notes')
    const md = await readFile(join(out, 'talk.md'), 'utf8')
    expect(md).toContain('## Notes')
    expect(md).not.toContain('## Transcript')
  }, 40_000)

  it('steps the detail pill with ←→ on All and Notes, and not on Transcript', async () => {
    const { app, fake } = await staged()
    app.stdin.write(ENTER)
    await until(() => frame(app).includes('Transcribe to'))
    await settle()
    expect(frame(app)).toContain('Standard')
    expect(frame(app)).toContain('←→')
    app.stdin.write(RIGHT)
    await settle()
    expect(frame(app)).toContain('Detailed')
    app.stdin.write(DOWN)
    app.stdin.write(DOWN)
    await settle()
    expect(frame(app)).not.toContain('Detailed')
    expect(frame(app)).not.toContain('←→')
    app.stdin.write(`${ESC}[A`)
    await settle()
    expect(frame(app)).toContain('Detailed')
    app.stdin.write(ENTER)
    await until(() => frame(app).includes('Markdown'))
    await settle()
    app.stdin.write(ENTER)
    await until(() => frame(app).includes('Save as'))
    await settle()
    app.stdin.write(ENTER)
    await until(() => frame(app).includes('✓ talk.md'))
    await settle()
    const argv = JSON.parse(await readFile(join(fake.dir, 'argv.json'), 'utf8')) as string[]
    expect(argv).toEqual(['run', expect.any(String), '--notes', '--detail', 'detailed'])
  }, 40_000)

  it('esc on Transcribe to goes home, the file still there', async () => {
    const { app } = await staged()
    app.stdin.write(ENTER)
    await until(() => frame(app).includes('Transcribe to'))
    await settle()
    app.stdin.write(ESC)
    await until(
      () =>
        frame(app).includes('Drop a video or audio file') || frame(app).includes('↵  transcribe'),
    )
    expect(frame(app)).toContain('talk.mp4')
  }, 40_000)

  it('↵ on Done starts again, with nothing staged', async () => {
    const { app } = await staged()
    app.stdin.write(ENTER)
    await until(() => frame(app).includes('Transcribe to'))
    await settle()
    app.stdin.write(ENTER)
    await until(() => frame(app).includes('Markdown'))
    await settle()
    app.stdin.write(ENTER)
    await until(() => frame(app).includes('Save as'))
    await settle()
    app.stdin.write(ENTER)
    await until(() => frame(app).includes('✓ talk.md'))
    await settle()
    app.stdin.write(ENTER)
    await until(() => frame(app).includes('Drop a video or audio file'))
    expect(frame(app)).not.toContain('talk.mp4')
  }, 40_000)
})

/*
 * Format, its own step after Transcribe to (mockups/transcribe-2026-10-round4.html,
 * tab 3, T1, approved 2026-10-22): a plain list, the extension on the
 * highlighted row, Save as's "default" tag on the default, tab moves it.
 */
describe('the Format step', () => {
  async function atFormat(opts: Parameters<typeof setUp>[1] = {}) {
    const s = await setUp('available', opts)
    s.app.stdin.write('5')
    await until(() => frame(s.app).includes('Drop a video or audio file'))
    s.app.stdin.write(s.input)
    await until(() => frame(s.app).includes('1:01:57'))
    await settle()
    s.app.stdin.write(ENTER)
    await until(() => frame(s.app).includes('Transcribe to'))
    await settle()
    s.app.stdin.write(ENTER)
    await until(() => frame(s.app).includes('Markdown'))
    await settle()
    return s
  }
  const barOf = (f: string) => f.split('\n').find((l) => l.includes('╱╱')) ?? ''

  it('lists Markdown, Word, PDF and Text, opening on Markdown, the default', async () => {
    const { app } = await atFormat()
    const f = frame(app)
    expect(barOf(f)).toMatch(/ All ╱ Format ╱╱$/)
    const rows = f.split('\n')
    const at = rows.findIndex((l) => /^\s+Format\s*$/.test(l))
    const names = rows.slice(at + 1, at + 5).map((l) => l.replace('▌', '').trim().split(/\s+/)[0])
    expect(names).toEqual(['Markdown', 'Word', 'PDF', 'Text'])
    expect(rows[at + 1]).toMatch(/▌ Markdown\s+\.md\s+default\s*$/)
    expect(f.split('\n').at(-1)).toMatch(/↑↓ +choose +tab +make default +↵ +confirm/)
  }, 40_000)

  it('Word: Save as names it .docx, and the helper sets it as Word', async () => {
    const { app, out } = await atFormat()
    app.stdin.write(DOWN)
    await settle()
    expect(frame(app)).toMatch(/▌ Word\s+\.docx/)
    app.stdin.write(ENTER)
    await until(() => frame(app).includes('Save as'))
    await settle()
    expect(barOf(frame(app))).toMatch(/ All ╱ Word ╱ Save as ╱╱$/)
    expect(frame(app)).toContain('.docx')
    app.stdin.write(ENTER)
    await until(() => frame(app).includes('✓ talk.docx'))
    const bytes = await readFile(join(out, 'talk.docx'), 'utf8')
    expect(bytes.startsWith('rendered:<!doctype html>')).toBe(true)
    expect(bytes).toContain('<h3>Milk · 1:10</h3>')
  }, 40_000)

  it('tab makes the highlighted format the default: tagged, saved, and opened on next time', async () => {
    const home = await makeTempDir()
    process.env.XDG_CONFIG_HOME = home
    const { app } = await atFormat()
    app.stdin.write(DOWN)
    app.stdin.write(DOWN)
    await settle()
    app.stdin.write(TAB)
    await settle(300)
    expect(frame(app)).toMatch(/▌ PDF\s+\.pdf\s+default\s*$/m)
    expect(frame(app)).not.toMatch(/Markdown\s+default/)
    const config = JSON.parse(await readFile(join(home, 'forge', 'config.json'), 'utf8'))
    expect(config.transcribeFormat).toBe('pdf')
  }, 40_000)

  it('opens on the default format when one is set', async () => {
    const { app } = await atFormat({ prefs: { transcribeFormat: 'txt' } })
    expect(frame(app)).toMatch(/▌ Text\s+\.txt\s+default\s*$/m)
  }, 40_000)

  it('writes text for Text: the words, no Markdown', async () => {
    const { app, out } = await atFormat()
    for (let i = 0; i < 3; i++) app.stdin.write(DOWN)
    await settle()
    app.stdin.write(ENTER)
    await until(() => frame(app).includes('Save as'))
    await settle()
    app.stdin.write(ENTER)
    await until(() => frame(app).includes('✓ talk.txt'))
    const text = await readFile(join(out, 'talk.txt'), 'utf8')
    expect(text.split('\n')[0]).toBe('talk')
    expect(text).not.toContain('## ')
  }, 40_000)

  it('esc on Format goes back to Transcribe to', async () => {
    const { app } = await atFormat()
    app.stdin.write(ESC)
    await until(() => barOf(frame(app)).includes('Transcribe to'))
    expect(frame(app)).toContain('summary, notes and transcript')
  }, 40_000)
})

/*
 * Working, decided 2026-10-22 (mockups/transcribe-2026-10-round4.html):
 * Transcribing with its bar and Writing notes faint under it; once the notes
 * start, "✓ Transcribing <time>" above Writing notes and a square per part.
 */
describe('transcribe’s Working', () => {
  async function working(run: object[], pick: 'all' | 'transcript' = 'all') {
    const s = await setUp('available', { run, hang: true })
    s.app.stdin.write('5')
    await until(() => frame(s.app).includes('Drop a video or audio file'))
    s.app.stdin.write(s.input)
    await until(() => frame(s.app).includes('1:01:57'))
    await settle()
    s.app.stdin.write(ENTER)
    await until(() => frame(s.app).includes('Transcribe to'))
    await settle()
    if (pick === 'transcript') {
      s.app.stdin.write(DOWN)
      s.app.stdin.write(DOWN)
      await settle()
    }
    s.app.stdin.write(ENTER)
    await until(() => frame(s.app).includes('Markdown'))
    await settle()
    s.app.stdin.write(ENTER)
    await until(() => frame(s.app).includes('Save as'))
    await settle()
    s.app.stdin.write(ENTER)
    return s
  }

  it('while it transcribes: the line and its bar, then Writing notes, faint, still to come', async () => {
    const { app } = await working([{ event: 'heard', seconds: 1390, of: 3717 }])
    await until(() => frame(app).includes('23:10 of 1:01:57'))
    const rows = frame(app).split('\n')
    // Flows sit two cells in from Working's own margin: the mark at 4, words at 6.
    const line = rows.findIndex((l) => /^ {4}. Transcribing\b|^ {6}Transcribing\b/.test(l))
    expect(line).toBeGreaterThan(0)
    expect(rows[line + 2]).toMatch(/^ {6}█+ +23:10 of 1:01:57/)
    expect(rows[line + 4]).toMatch(/^ {6}Writing notes\s*$/)
    expect(frame(app)).not.toContain('✓ Transcribing')
    expect(frame(app)).not.toContain('nothing is saved')
  }, 40_000)

  it('while it writes notes: ✓ Transcribing and its time, Writing notes, a square per part', async () => {
    const { app } = await working([
      { event: 'heard', seconds: 3717, of: 3717 },
      { event: 'notes', part: 2, of: 3 },
    ])
    await until(() => frame(app).includes('of 3 parts'))
    const rows = frame(app).split('\n')
    const done = rows.findIndex((l) => l.includes('✓ Transcribing'))
    expect(rows[done]).toMatch(/^ {4}✓ Transcribing +[0-9.]+s$/)
    expect(rows[done + 2]).toMatch(/Writing notes/)
    expect(rows[done + 4]).toMatch(/^ {6}██ ██ ██ {2}1 of 3 parts$/)
  }, 40_000)

  it('has no Writing notes when only the transcript was asked for', async () => {
    const { app } = await working([{ event: 'heard', seconds: 1390, of: 3717 }], 'transcript')
    await until(() => frame(app).includes('23:10 of 1:01:57'))
    expect(frame(app)).not.toContain('Writing notes')
  }, 40_000)
})
