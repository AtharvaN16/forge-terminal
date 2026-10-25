import { existsSync, readFileSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import AdmZip from 'adm-zip'
import { afterEach, describe, expect, it } from 'vitest'
import type { TranscribeIntent } from '../../src/cli/args.js'
import { runTranscribeCommand } from '../../src/cli/transcribe-command.js'
import { transcriptMarkdown } from '../../src/core/transcribe/markdown.js'
import { markdownText } from '../../src/core/transcribe/output.js'
import { pageMarkdown, pagePlain, pageText } from '../../src/core/transcribe/page-text.js'
import { extractPdfText } from '../../src/engines/pdfium.js'
import { fakeTranscribeHelper } from '../helpers/fake-transcribe.js'
import { fakeYtDlp } from '../helpers/fake-ytdlp.js'
import { makePdf, makePng, makeTempDir } from '../helpers/fixtures.js'
import { pinPlatform } from '../helpers/platform.js'

// These are the Mac's words; Linux, Windows and a Mac without Apple's recogniser have
// their own blocks at the end.
pinPlatform('darwin')

/**
 * The ✓ lines with the file's name alone. Pinned to another OS on a Windows
 * host, a temp folder's backslashed path is not a path to that OS's
 * basename, so the line would carry the whole of it.
 */
const shown = (out: string[]) => out.map((l) => l.replace(/^✓ \S*[\\/]/, '✓ '))

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
}
const NOTES = {
  summary: 'About tea.',
  parts: [
    { start: 0, heading: 'Welcome', points: ['Tea.'], refused: false },
    { start: 70, heading: 'Milk', points: ['Milk.'], refused: false },
  ],
}

const saved = process.env.FORGE_TRANSCRIBE_HELPER
afterEach(() => {
  if (saved === undefined) delete process.env.FORGE_TRANSCRIBE_HELPER
  else process.env.FORGE_TRANSCRIBE_HELPER = saved
})

async function setUp(notes: 'available' | 'off' = 'available') {
  const fake = await fakeTranscribeHelper({
    status: { lines: [{ ok: true, speech: true, locale: 'en_US', notes }] },
    probe: { lines: [{ ok: true, seconds: 75, sound: true }] },
    run: {
      lines: [
        { event: 'heard', seconds: 70, of: 75 },
        { ...RESULT, ...(notes === 'available' ? { notes: NOTES } : {}) },
      ],
    },
  })
  process.env.FORGE_TRANSCRIBE_HELPER = fake.path
  const dir = await makeTempDir()
  const input = join(dir, 'talk.mp4')
  await writeFile(input, MP4)
  return { fake, dir, input }
}

const intent = (input: string, more: Partial<TranscribeIntent> = {}): TranscribeIntent => ({
  kind: 'transcribe',
  input,
  notes: true,
  transcript: true,
  detail: 'standard',
  force: false,
  debug: false,
  ...more,
})

async function run(i: TranscribeIntent) {
  const out: string[] = []
  const err: string[] = []
  const code = await runTranscribeCommand(i, { out: (l) => out.push(l), err: (l) => err.push(l) })
  return { code, out, err }
}

const argv = async (dir: string) =>
  JSON.parse(await readFile(join(dir, 'argv.json'), 'utf8')) as string[]

describe('forge transcribe <file>', () => {
  it('writes the notes and transcript beside the file', async () => {
    const { fake, dir, input } = await setUp()
    const { code, out } = await run(intent(input))
    expect(code).toBe(0)
    expect(await readFile(join(dir, 'talk.md'), 'utf8')).toBe(
      transcriptMarkdown(
        { seconds: 75, segments: RESULT.segments, notes: NOTES },
        { title: 'talk', from: 'talk.mp4' },
      ),
    )
    expect(shown(out)).toEqual(['✓ talk.md   1:15 → 5 words · 2 parts'])
    expect(await argv(fake.dir)).toEqual(['run', input, '--notes'])
  })

  it('says how it ended, for the notice a long run posts', async () => {
    const { dir, input } = await setUp()
    const ended: unknown[] = []
    const io = { out: () => {}, err: () => {}, finished: (f: unknown) => ended.push(f) }
    await runTranscribeCommand(intent(input), io)
    await runTranscribeCommand(intent(join(dir, 'ghost.mp4')), io)
    expect(ended).toEqual([
      { made: [{ from: [input], to: [join(dir, 'talk.md')] }], failed: [] },
      {
        made: [],
        failed: [{ path: join(dir, 'ghost.mp4'), message: expect.any(String) }],
      },
    ])
  })

  it('writes the transcript alone, and says so, when Apple Intelligence is off', async () => {
    const { fake, dir, input } = await setUp('off')
    const { code, out, err } = await run(intent(input))
    expect(code).toBe(0)
    expect(err).toEqual(['⚠ Apple Intelligence is off, so this is the transcript only.'])
    expect(shown(out)).toEqual(['✓ talk.md   1:15 → 5 words'])
    expect(await argv(fake.dir)).toEqual(['run', input])
    expect(await readFile(join(dir, 'talk.md'), 'utf8')).not.toContain('## Notes')
  })

  it('writes the notes without the transcript with --to notes', async () => {
    const { dir, input } = await setUp()
    const { code } = await run(intent(input, { transcript: false }))
    expect(code).toBe(0)
    const md = await readFile(join(dir, 'talk.md'), 'utf8')
    expect(md).toContain('## Notes')
    expect(md).not.toContain('## Transcript')
  })

  it('refuses --to notes, writing nothing, when Apple Intelligence is off', async () => {
    const { dir, input } = await setUp('off')
    const { code, err } = await run(intent(input, { transcript: false }))
    expect(code).toBe(1)
    expect(err.join('\n')).toContain('Apple Intelligence')
    expect(existsSync(join(dir, 'talk.md'))).toBe(false)
  })

  it('passes --detail on to the helper, and says nothing for standard', async () => {
    const { fake, input } = await setUp()
    await run(intent(input, { detail: 'brief' }))
    expect(await argv(fake.dir)).toEqual(['run', input, '--notes', '--detail', 'brief'])
  })

  it('asks for no notes with --to transcript', async () => {
    const { fake, input } = await setUp()
    await run(intent(input, { notes: false }))
    expect(await argv(fake.dir)).toEqual(['run', input])
  })

  it('passes the language on', async () => {
    const { fake, input } = await setUp()
    await run(intent(input, { language: 'hi' }))
    expect(await argv(fake.dir)).toEqual(['run', input, '--locale', 'hi', '--notes'])
  })

  it('writes where -o says', async () => {
    const { input } = await setUp()
    const target = join(await makeTempDir(), 'notes.md')
    expect((await run(intent(input, { output: target }))).code).toBe(0)
    expect(existsSync(target)).toBe(true)
  })

  it('says one part as "1 part"', async () => {
    const { input } = await setUp()
    process.env.FORGE_TRANSCRIBE_HELPER = (
      await fakeTranscribeHelper({
        status: { lines: [{ ok: true, speech: true, locale: 'en_US', notes: 'available' }] },
        run: { lines: [{ ...RESULT, notes: { ...NOTES, parts: NOTES.parts.slice(0, 1) } }] },
      })
    ).path
    const { out } = await run(intent(input))
    expect(shown(out)).toEqual(['✓ talk.md   1:15 → 5 words · 1 part'])
  })

  it('writes text with --format txt: the same words, no marks', async () => {
    const { dir, input } = await setUp()
    const { code, out } = await run(intent(input, { format: 'txt' }))
    expect(code).toBe(0)
    expect(await readFile(join(dir, 'talk.txt'), 'utf8')).toBe(
      markdownText(
        transcriptMarkdown(
          { seconds: 75, segments: RESULT.segments, notes: NOTES },
          { title: 'talk', from: 'talk.mp4' },
        ),
      ),
    )
    expect(existsSync(join(dir, 'talk.md'))).toBe(false)
    expect(shown(out)[0]).toMatch(/^✓ talk\.txt /)
  })

  it('has the helper set Word with --format docx', async () => {
    const { dir, input } = await setUp()
    process.env.FORGE_TRANSCRIBE_HELPER = (
      await fakeTranscribeHelper({
        status: { lines: [{ ok: true, speech: true, locale: 'en_US', notes: 'available' }] },
        run: { lines: [{ ...RESULT, notes: NOTES }] },
        render: { lines: [{ ok: true }], echo: { from: 1, to: 2, prefix: 'docx:' } },
      })
    ).path
    expect((await run(intent(input, { format: 'docx' }))).code).toBe(0)
    expect(
      (await readFile(join(dir, 'talk.docx'), 'utf8')).startsWith('docx:<!doctype html>'),
    ).toBe(true)
  })

  it('takes the format from -o when there is no --format', async () => {
    const { input } = await setUp()
    const target = join(await makeTempDir(), 'notes.txt')
    expect((await run(intent(input, { output: target }))).code).toBe(0)
    expect(await readFile(target, 'utf8')).toMatch(/^talk\n/)
  })

  it('refuses to replace a file that is already there, unless --force', async () => {
    const { dir, input } = await setUp()
    await writeFile(join(dir, 'talk.md'), 'mine')
    const refused = await run(intent(input))
    expect(refused.code).toBe(1)
    expect(refused.err[0]).toBe('✕ File already exists')
    expect(await readFile(join(dir, 'talk.md'), 'utf8')).toBe('mine')
    expect((await run(intent(input, { force: true }))).code).toBe(0)
    expect(await readFile(join(dir, 'talk.md'), 'utf8')).toContain('# talk')
  })

  it('refuses a file that is not video, sound, a picture or a PDF, by its content', async () => {
    await setUp()
    const odd = join(await makeTempDir(), 'still.mp4')
    await writeFile(odd, Buffer.from([0x50, 0x4b, 3, 4, 0, 0, 0, 0, 0xff, 0xfe]))
    const { code, err } = await run(intent(odd))
    expect(code).toBe(1)
    expect(err[0]).toBe('✕ Cannot transcribe this file')
  })

  it('says transcribe is not available when there is no helper', async () => {
    const { input } = await setUp()
    process.env.FORGE_TRANSCRIBE_HELPER = join(await makeTempDir(), 'missing')
    const { code, err } = await run(intent(input))
    expect(code).toBe(1)
    expect(err[0]).toBe('✕ Transcribe is not available')
  })
})

// A fake yt-dlp is a #! script, which Windows cannot start; the link flow is the same everywhere.
describe.skipIf(process.platform === 'win32')('forge transcribe <link>', () => {
  const LINK = 'https://youtu.be/jNQXAC9IVRw?si=abc'
  const savedXdg = process.env.XDG_CONFIG_HOME
  afterEach(() => {
    if (savedXdg === undefined) delete process.env.XDG_CONFIG_HOME
    else process.env.XDG_CONFIG_HOME = savedXdg
  })

  it('fetches the sound and names the file after the video', async () => {
    await setUp()
    await fakeYtDlp({
      facts: { title: 'Me at the zoo: part 1/2', uploader: 'jawed', duration: 19, is_live: false },
    })
    const out = await makeTempDir()
    const r = await run(intent(LINK, { output: `${out}/` }))
    expect(r.err).toEqual([])
    expect(r.code).toBe(0)
    const md = await readFile(join(out, 'Me at the zoo- part 1-2.md'), 'utf8')
    expect(md.split('\n').slice(0, 3)).toEqual([
      '# Me at the zoo: part 1/2',
      '',
      '<https://www.youtube.com/watch?v=jNQXAC9IVRw>',
    ])
  })

  it('refuses a playlist', async () => {
    await setUp()
    const r = await run(
      intent('https://www.youtube.com/playlist?list=PL590L5WQmH8fJ54F369BLDSqIwcs-TCfs'),
    )
    expect(r.code).toBe(1)
    expect(r.err.slice(0, 3)).toEqual([
      '✕ Cannot transcribe this link',
      '',
      '  This is a playlist.',
    ])
  })

  it('says yt-dlp is needed when it is not installed', async () => {
    await setUp()
    process.env.XDG_CONFIG_HOME = await makeTempDir()
    // Nor one of the user's own: this machine's PATH may well have one.
    const before = process.env.FORGE_YT_DLP
    process.env.FORGE_YT_DLP = join(process.env.XDG_CONFIG_HOME, 'missing')
    try {
      const r = await run(intent(LINK))
      expect(r.code).toBe(1)
      expect(r.err[0]).toBe('✕ Extension not installed')
    } finally {
      if (before === undefined) delete process.env.FORGE_YT_DLP
      else process.env.FORGE_YT_DLP = before
    }
  })

  it('stops before transcribing when the name is taken', async () => {
    const { fake } = await setUp()
    await fakeYtDlp({})
    const out = await makeTempDir()
    await writeFile(join(out, 'Me at the zoo.md'), 'mine')
    const r = await run(intent(LINK, { output: `${out}/` }))
    expect(r.code).toBe(1)
    expect(r.err[0]).toBe('✕ File already exists')
    expect(existsSync(join(fake.dir, 'argv.json')) && (await argv(fake.dir))[0]).not.toBe('run')
  })
})

/** What `read` printed for the spike page (tests/fixtures/README.md, `read/`). */
const DOC = JSON.parse(
  readFileSync(join(__dirname, '..', 'fixtures', 'read', 'doc.json'), 'utf8'),
) as { ok: true; pages: Parameters<typeof pageText>[0] }

describe('forge transcribe <picture|pdf> (spec 2026-10-23-extract-text-design §3.5)', () => {
  async function setUpRead(read: object[] = [DOC], status: object = { read: true }) {
    const fake = await fakeTranscribeHelper({
      status: {
        lines: [{ ok: true, speech: true, locale: 'en_US', notes: 'available', ...status }],
      },
      read: { lines: read },
      render: { lines: [{ ok: true }], echo: { from: 1, to: 2, prefix: 'docx:' } },
    })
    process.env.FORGE_TRANSCRIBE_HELPER = fake.path
    return { fake, dir: await makeTempDir() }
  }

  it('writes the text of a picture beside it, as Markdown', async () => {
    const { fake, dir } = await setUpRead()
    const png = await makePng(dir, 'shot.png')
    const { code, out } = await run(intent(png))
    expect(code).toBe(0)
    expect(await readFile(join(dir, 'shot.md'), 'utf8')).toBe(pageMarkdown(pageText(DOC.pages)))
    expect(shown(out)).toEqual(['✓ shot.md   PNG → 89 words'])
    expect(await argv(fake.dir)).toEqual(['read', png])
  })

  it('reads by content: a picture named .mp4 is still a picture', async () => {
    const { dir } = await setUpRead()
    const png = await makePng(dir, 'clip.mp4')
    expect((await run(intent(png))).code).toBe(0)
    expect(existsSync(join(dir, 'clip.md'))).toBe(true)
  })

  it('writes the bare words with --format txt', async () => {
    const { dir } = await setUpRead()
    const png = await makePng(dir, 'shot.png')
    expect((await run(intent(png, { format: 'txt' }))).code).toBe(0)
    expect(await readFile(join(dir, 'shot.txt'), 'utf8')).toBe(pagePlain(pageText(DOC.pages)))
  })

  it('writes Word, its table a real one, with --format docx', async () => {
    const { dir } = await setUpRead()
    const png = await makePng(dir, 'shot.png')
    expect((await run(intent(png, { format: 'docx' }))).code).toBe(0)
    const xml = new AdmZip(await readFile(join(dir, 'shot.docx'))).readAsText('word/document.xml')
    expect(xml).toContain('<w:tbl>')
  })

  it('reads a PDF page by page and says how many pages', async () => {
    const { dir } = await setUpRead([
      { event: 'page', page: 1, of: 2 },
      { event: 'page', page: 2, of: 2 },
      { ok: true, pages: [...DOC.pages, ...DOC.pages] },
    ])
    const pdf = await makePdf(dir, 'scan.pdf', 2)
    const { code, out } = await run(intent(pdf))
    expect(code).toBe(0)
    expect(shown(out)).toEqual(['✓ scan.md   2 pages → 178 words'])
    expect(await readFile(join(dir, 'scan.md'), 'utf8')).toContain('\n---\n')
  })

  it('passes the language on', async () => {
    const { fake, dir } = await setUpRead()
    const png = await makePng(dir, 'shot.png')
    await run(intent(png, { language: 'ja' }))
    expect(await argv(fake.dir)).toEqual(['read', png, '--language', 'ja'])
  })

  it('writes nothing, and says so, when there is no text', async () => {
    const { dir } = await setUpRead([{ ok: true, pages: [{ blocks: [] }] }])
    const png = await makePng(dir, 'blank.png')
    const { code, err } = await run(intent(png))
    expect(code).toBe(1)
    expect(err[0]).toBe('✕ No text found')
    expect(existsSync(join(dir, 'blank.md'))).toBe(false)
  })

  it('refuses --to, which is about talk', async () => {
    const { dir } = await setUpRead()
    const png = await makePng(dir, 'shot.png')
    const { code, err } = await run(intent(png, { to: 'notes' }))
    expect(code).toBe(1)
    expect(err.join('\n')).toContain('--to is for video and sound')
  })

  it('says reading text needs macOS 26 when the helper cannot read', async () => {
    const { dir } = await setUpRead([DOC], { read: false })
    const png = await makePng(dir, 'shot.png')
    const { code, err } = await run(intent(png))
    expect(code).toBe(1)
    expect(err[0]).toBe('✕ Reading text is not available')
  })

  it('refuses a password-protected PDF', async () => {
    const { dir } = await setUpRead()
    const locked = join(dir, 'locked.pdf')
    await writeFile(locked, readFileSync(join(__dirname, '..', 'fixtures', 'locked-hunter2.pdf')))
    const { code, err } = await run(intent(locked))
    expect(code).toBe(1)
    expect(err[0]).toBe('✕ This PDF is password-protected')
  })

  it('refuses to replace a file that is already there, unless --force', async () => {
    const { dir } = await setUpRead()
    const png = await makePng(dir, 'shot.png')
    await writeFile(join(dir, 'shot.md'), 'mine')
    expect((await run(intent(png))).code).toBe(1)
    expect(await readFile(join(dir, 'shot.md'), 'utf8')).toBe('mine')
    expect((await run(intent(png, { force: true }))).code).toBe(0)
  })
})

describe('forge transcribe on Linux', () => {
  pinPlatform('linux')

  it('writes the transcript without a warning: Linux never has notes', async () => {
    const fake = await fakeTranscribeHelper(
      {
        status: { lines: [{ ok: true, speech: true, locale: 'en', notes: 'unsupported' }] },
        run: { lines: [RESULT] },
      },
      { whisper: true },
    )
    process.env.FORGE_TRANSCRIBE_HELPER = fake.path
    const dir = await makeTempDir()
    const input = join(dir, 'talk.mp4')
    await writeFile(input, MP4)
    const { code, out, err } = await run(intent(input))
    expect(code).toBe(0)
    expect(err).toEqual([])
    expect(shown(out)).toEqual(['✓ talk.md   1:15 → 5 words'])
  })

  it('writes a PDF with --format pdf, set by Forge since there is no Apple helper', async () => {
    const fake = await fakeTranscribeHelper(
      {
        status: { lines: [{ ok: true, speech: true, locale: 'en', notes: 'unsupported' }] },
        run: { lines: [RESULT] },
      },
      { whisper: true },
    )
    process.env.FORGE_TRANSCRIBE_HELPER = fake.path
    const dir = await makeTempDir()
    const input = join(dir, 'talk.mp4')
    await writeFile(input, MP4)
    const { code, out, err } = await run(intent(input, { format: 'pdf' }))
    expect(err).toEqual([])
    expect(code).toBe(0)
    expect(shown(out)).toEqual(['✓ talk.pdf   1:15 → 5 words'])
    const bytes = await readFile(join(dir, 'talk.pdf'))
    expect(bytes.subarray(0, 5).toString('latin1')).toBe('%PDF-')
    const [page] = await extractPdfText(bytes)
    expect(page).toContain('Hello and welcome.')
    expect(page).toContain('Now, milk.')
  })

  it('refuses --to notes in Linux words', async () => {
    const fake = await fakeTranscribeHelper({
      status: { lines: [{ ok: true, speech: true, locale: 'en', notes: 'unsupported' }] },
    })
    process.env.FORGE_TRANSCRIBE_HELPER = fake.path
    const dir = await makeTempDir()
    const input = join(dir, 'talk.mp4')
    await writeFile(input, MP4)
    const { code, err } = await run(intent(input, { transcript: false }))
    expect(code).toBe(1)
    expect(err.join('\n')).toContain('which this computer does not have')
  })

  it('names the whisper extension when there is no speech', async () => {
    const fake = await fakeTranscribeHelper(
      { status: { lines: [{ ok: true, speech: false, locale: 'en', notes: 'unsupported' }] } },
      { whisper: true },
    )
    process.env.FORGE_TRANSCRIBE_HELPER = fake.path
    const dir = await makeTempDir()
    const input = join(dir, 'talk.mp4')
    await writeFile(input, MP4)
    const { code, err } = await run(intent(input))
    expect(code).toBe(1)
    expect(err.join('\n')).toContain('forge extensions add whisper')
  })
})

/** The whisper helper's answers (no notes, ever), and a video to give it. */
async function whisperSetUp(status: object) {
  const fake = await fakeTranscribeHelper(
    {
      status: { lines: [{ ok: true, locale: 'en', notes: 'unsupported', ...status }] },
      run: { lines: [RESULT] },
    },
    { whisper: true },
  )
  process.env.FORGE_TRANSCRIBE_HELPER = fake.path
  const dir = await makeTempDir()
  const input = join(dir, 'talk.mp4')
  await writeFile(input, MP4)
  return { dir, input }
}

describe('forge transcribe on Windows', () => {
  pinPlatform('win32')

  it('writes the transcript without a warning: there are no notes to miss', async () => {
    const { input } = await whisperSetUp({ speech: true })
    const { code, out, err } = await run(intent(input))
    expect(code).toBe(0)
    expect(err).toEqual([])
    expect(shown(out)).toEqual(['✓ talk.md   1:15 → 5 words'])
  })

  it('writes a PDF with --format pdf, as on every other OS', async () => {
    const { dir, input } = await whisperSetUp({ speech: true })
    const { code, err } = await run(intent(input, { format: 'pdf' }))
    expect(err).toEqual([])
    expect(code).toBe(0)
    const [page] = await extractPdfText(await readFile(join(dir, 'talk.pdf')))
    expect(page).toContain('Hello and welcome.')
  })

  it('refuses --to notes: Apple Intelligence, which this PC does not have', async () => {
    const { input } = await whisperSetUp({ speech: true })
    const { code, err } = await run(intent(input, { transcript: false }))
    expect(code).toBe(1)
    expect(err.join('\n')).toContain(
      'Summary and notes need Apple Intelligence, which this PC does not have.',
    )
  })

  it('names the whisper extension, and ffmpeg when that is missing too', async () => {
    const { input } = await whisperSetUp({ speech: false, missing: ['whisper', 'ffmpeg'] })
    const { code, err } = await run(intent(input))
    expect(code).toBe(1)
    expect(err.join('\n')).toContain('forge extensions add whisper')
    expect(err.join('\n')).toContain('winget install ffmpeg')
  })
})

describe("forge transcribe on a Mac without Apple's recogniser (Intel, before macOS 26)", () => {
  pinPlatform('darwin')

  it('writes the transcript without the Apple Intelligence warning', async () => {
    const { input } = await whisperSetUp({ speech: true })
    const { code, err } = await run(intent(input))
    expect(code).toBe(0)
    expect(err).toEqual([])
  })

  it('refuses --to notes: Apple Intelligence, which this Mac does not have', async () => {
    const { input } = await whisperSetUp({ speech: true })
    const { code, err } = await run(intent(input, { transcript: false }))
    expect(code).toBe(1)
    expect(err.join('\n')).toContain('which this Mac does not have')
  })

  it('names the whisper extension, as every OS does', async () => {
    const { input } = await whisperSetUp({ speech: false, missing: ['whisper'] })
    const { code, err } = await run(intent(input))
    expect(code).toBe(1)
    expect(err.join('\n')).toContain('forge extensions add whisper')
  })
})
