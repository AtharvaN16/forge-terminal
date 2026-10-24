import { existsSync, readFileSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { render } from 'ink-testing-library'
import { afterEach, describe, expect, it } from 'vitest'
import { DEFAULT_PREFERENCES, type Preferences } from '../../src/config/preferences.js'
import { pageHtml, pageMarkdown, pagePlain, pageText } from '../../src/core/transcribe/page-text.js'
import { App } from '../../src/shell/App.js'
import { fakeTranscribeHelper } from '../helpers/fake-transcribe.js'
import { fakeYtDlp } from '../helpers/fake-ytdlp.js'
import { makePdf, makePng, makeTempDir } from '../helpers/fixtures.js'
import { memoryPasteboard } from '../helpers/pasteboard.js'

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

/** What `read` printed for the spike page (tests/fixtures/README.md, `read/`). */
const DOC = JSON.parse(
  readFileSync(join(__dirname, '..', 'fixtures', 'read', 'doc.json'), 'utf8'),
) as { ok: true; pages: Parameters<typeof pageText>[0] }

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
    /** The helper reads pictures and PDFs (spec 2026-10-23-extract-text-design §5.1). */
    read?: boolean
    /** What `read` answers; the spike page by default. */
    lines?: object[]
  } = {},
) {
  const fake = await fakeTranscribeHelper({
    status: {
      lines: [{ ok: true, speech: true, locale: 'en_US', notes, read: opts.read ?? false }],
    },
    read: { lines: opts.lines ?? [DOC], ...(opts.hang ? { hang: true } : {}) },
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
  it('5 makes transcribe the mode, asking for a file: video, sound, a picture or a PDF, or a link', async () => {
    const { app } = await setUp()
    app.stdin.write('5')
    await until(() => frame(app).includes('or a YouTube link'))
    expect(frame(app)).toContain('Drop a file here')
    expect(frame(app)).toContain('Video · Audio · Images · PDF · or a YouTube link')
    expect(frame(app)).toContain('OR search or enter a file path…')
    // Holding tab names the formats, as on convert's home (spec 2026-10-23 §5.4).
    expect(frame(app).split('\n').at(-1)).toMatch(/tab supported formats · 1–6 ←→ mode/)
  }, 30_000)

  it('says only English is understood on the key row, at its left edge, where there is room', async () => {
    const { app } = await setUp('available', { width: 110 })
    app.stdin.write('5')
    await until(() => frame(app).includes('or a YouTube link'))
    const lines = frame(app).split('\n')
    expect(lines.at(-1)).toMatch(
      /^\s{1,6}Currently only English is supported\s+tab supported formats/,
    )
    expect(lines.filter((l) => l.includes('English'))).toHaveLength(1)
  }, 30_000)

  it('/transcribe opens it too', async () => {
    const { app } = await setUp()
    app.stdin.write('/transcribe')
    await settle()
    app.stdin.write(ENTER)
    await until(() => frame(app).includes('or a YouTube link'))
  }, 30_000)

  it('a dropped video waits as its card: its length and size', async () => {
    const { app, input } = await setUp()
    app.stdin.write('5')
    await until(() => frame(app).includes('or a YouTube link'))
    // A whole path at once is a drop: read, no ↵ needed.
    app.stdin.write(input)
    await until(() => frame(app).includes('1:01:57'))
    expect(frame(app)).toContain('talk.mp4')
    expect(frame(app).split('\n').at(-1)).toMatch(/↵ +transcribe/)
  }, 30_000)

  it('a picture waits as its card, read by its content: its size (spec 2026-10-23 §3.1)', async () => {
    const { app } = await setUp('available', { read: true })
    const png = await makePng(await makeTempDir(), 'still.mp4')
    app.stdin.write('5')
    await until(() => frame(app).includes('or a YouTube link'))
    app.stdin.write(png)
    await until(() => frame(app).includes('40×20'))
    expect(frame(app)).toContain('still.mp4')
    expect(frame(app).split('\n').at(-1)).toMatch(/↵ +transcribe/)
  }, 30_000)

  it('a picture is refused under the field where the helper cannot read', async () => {
    const { app } = await setUp()
    const png = await makePng(await makeTempDir(), 'still.png')
    app.stdin.write('5')
    await until(() => frame(app).includes('or a YouTube link'))
    app.stdin.write(png)
    await until(() => frame(app).includes('Reading text needs macOS 26 or later.'))
  }, 30_000)

  it('a pasted link shows the video’s title and channel once yt-dlp has looked it up', async () => {
    const { app } = await setUp()
    await fakeYtDlp({
      facts: { title: 'Me at the zoo', uploader: 'jawed', duration: 19, is_live: false },
    })
    app.stdin.write('5')
    await until(() => frame(app).includes('or a YouTube link'))
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
    await until(() => frame(app).includes('or a YouTube link'))
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
    await until(() => frame(s.app).includes('or a YouTube link'))
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
      await until(() => frame(app).includes('or a YouTube link'))
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
      () => frame(app).includes('or a YouTube link') || frame(app).includes('↵  transcribe'),
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
    await until(() => frame(app).includes('or a YouTube link'))
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
    await until(() => frame(s.app).includes('or a YouTube link'))
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
    await until(() => frame(s.app).includes('or a YouTube link'))
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

describe('reading a picture or PDF, from ↵ to Done (spec 2026-10-23-extract-text-design §3)', () => {
  async function stagedPage(
    opts: Parameters<typeof setUp>[1] = {},
    make: (dir: string) => Promise<string> = (dir) => makePng(dir, 'shot.png'),
  ) {
    const s = await setUp('available', { read: true, ...opts })
    const file = await make(await makeTempDir())
    s.app.stdin.write('5')
    await until(() => frame(s.app).includes('or a YouTube link'))
    s.app.stdin.write(file)
    await until(() => frame(s.app).includes('↵  transcribe') || /↵ +transcribe/.test(frame(s.app)))
    await settle()
    return { ...s, file }
  }

  it('asks no Transcribe to: Format, then Save as, then writes the .md, and Done shows its first lines', async () => {
    const { app, out } = await stagedPage()
    app.stdin.write(ENTER)
    await until(() => frame(app).includes('Markdown'))
    await settle()
    expect(frame(app)).not.toContain('Transcribe to')
    app.stdin.write(ENTER)
    await until(() => frame(app).includes('Save as'))
    await settle()
    expect(frame(app)).toContain('shot')
    app.stdin.write(ENTER)
    await until(() => frame(app).includes('✓ shot.md'))
    await settle()
    const done = frame(app)
    expect(done).toContain('done')
    expect(done).toContain('Quarterly Field Report')
    expect(done).toContain('The survey ran from 3 March')
    expect(done).toMatch(/o Open +f \S+ +c Copy +↵ Home/)
    const doc = pageText(DOC.pages)
    expect(await readFile(join(out, 'shot.md'), 'utf8')).toBe(pageMarkdown(doc))
  }, 40_000)

  it('cuts a preview line too long for the window with …', async () => {
    const { app } = await stagedPage()
    for (const step of ['Markdown', 'Save as', '✓ shot.md']) {
      app.stdin.write(ENTER)
      await until(() => frame(app).includes(step))
      await settle()
    }
    const line = frame(app)
      .split('\n')
      .find((l) => l.includes('The survey ran from'))
    expect(line?.trimEnd().endsWith('…')).toBe(true)
    expect(line?.length).toBeLessThanOrEqual(80)
    expect(pagePlain(pageText(DOC.pages))).toContain('marking it as absent.')
  }, 40_000)

  it('reads a PDF with a true bar and the page it is on', async () => {
    const { app } = await stagedPage(
      { lines: [{ event: 'page', page: 2, of: 3 }], hang: true },
      (dir) => makePdf(dir, 'scan.pdf', 3),
    )
    expect(frame(app)).toContain('3 pages')
    for (const step of ['Markdown', 'Save as']) {
      app.stdin.write(ENTER)
      await until(() => frame(app).includes(step))
      await settle()
    }
    app.stdin.write(ENTER)
    await until(() => frame(app).includes('page 2 of 3'))
    expect(frame(app)).toContain('Reading text')
  }, 40_000)

  it('goes home and says so, writing nothing, when there is no text', async () => {
    const { app, out } = await stagedPage({ lines: [{ ok: true, pages: [{ blocks: [] }] }] })
    for (const step of ['Markdown', 'Save as']) {
      app.stdin.write(ENTER)
      await until(() => frame(app).includes(step))
      await settle()
    }
    app.stdin.write(ENTER)
    await until(() => frame(app).includes('No text found in shot.png'))
    expect(existsSync(join(out, 'shot.md'))).toBe(false)
  }, 40_000)

  it('esc on Format goes home, the picture still there', async () => {
    const { app } = await stagedPage()
    app.stdin.write(ENTER)
    await until(() => frame(app).includes('Markdown'))
    await settle()
    app.stdin.write(ESC)
    await until(() => frame(app).includes('40×20'))
  }, 40_000)
})

describe('a screenshot on the clipboard (spec 2026-10-23-extract-text-design §3.3)', () => {
  const CTRL_V = '\x16'

  async function pasted() {
    const fake = await fakeTranscribeHelper({
      status: { lines: [{ ok: true, speech: true, locale: 'en_US', notes: 'off', read: true }] },
      read: { lines: [DOC] },
    })
    process.env.FORGE_TRANSCRIBE_HELPER = fake.path
    const clip = memoryPasteboard()
    await clip.copyImage(await makePng(await makeTempDir(), 'shot.png'))
    const out = await makeTempDir()
    const app = render(
      <App
        initialWidth={80}
        initialHeight={24}
        prefs={{ ...DEFAULT_PREFERENCES, theme: 'dark', defaultOutput: out }}
        pasteboard={clip.pb}
        clipRoot={await makeTempDir()}
      />,
    )
    await until(() => frame(app).includes('1 convert'))
    app.stdin.write('5')
    await until(() => frame(app).includes('or a YouTube link'))
    app.stdin.write(CTRL_V)
    await until(() => frame(app).includes('Copied image'))
    await settle()
    return { app, clip, out }
  }

  it('lands as the Copied image card, its kind and size', async () => {
    const { app } = await pasted()
    expect(frame(app)).toContain('40×20')
    expect(frame(app)).toMatch(/PNG/)
  }, 40_000)

  it('↵ reads it and puts the text back on the clipboard, plain and as HTML: no Format, no Save as', async () => {
    const { app, clip, out } = await pasted()
    app.stdin.write(ENTER)
    await until(() => frame(app).includes('the text is on the clipboard'))
    await settle()
    expect(frame(app)).not.toContain('Save as')
    expect(frame(app)).toContain('Quarterly Field Report')
    expect(frame(app)).toMatch(/u Undo +s Save a copy +↵ Home/)
    const doc = pageText(DOC.pages)
    expect(clip.held()).toEqual({
      kind: 'text',
      text: pagePlain(doc),
      html: pageHtml(doc, 'Copied image'),
    })
    expect(existsSync(join(out, 'Copied image.md'))).toBe(false)
  }, 40_000)

  it('u puts the picture back; s saves the text as a file in the default folder', async () => {
    const { app, clip, out } = await pasted()
    app.stdin.write(ENTER)
    await until(() => frame(app).includes('the text is on the clipboard'))
    await settle()
    app.stdin.write('u')
    await until(() => frame(app).includes('the original is back on the clipboard'))
    expect(clip.held()?.kind).toBe('image')
    app.stdin.write('s')
    await until(() => frame(app).includes('saved to'))
    expect(await readFile(join(out, 'Copied image.md'), 'utf8')).toBe(
      pageMarkdown(pageText(DOC.pages)),
    )
  }, 40_000)

  it('saves the text to the default folder instead when something else was copied meanwhile', async () => {
    const s = await pasted()
    // The picture was read when the card landed; something else is copied now.
    s.clip.copyText()
    s.app.stdin.write(ENTER)
    await until(() => frame(s.app).includes('Clipboard changed'))
    expect(frame(s.app)).toContain('✓ Copied image.md')
    expect(existsSync(join(s.out, 'Copied image.md'))).toBe(true)
    expect(s.clip.held()).toEqual({ kind: 'text' })
  }, 40_000)
})
