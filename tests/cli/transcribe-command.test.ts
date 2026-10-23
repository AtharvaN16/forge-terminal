import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { TranscribeIntent } from '../../src/cli/args.js'
import { runTranscribeCommand } from '../../src/cli/transcribe-command.js'
import { transcriptMarkdown } from '../../src/core/transcribe/markdown.js'
import { fakeTranscribeHelper } from '../helpers/fake-transcribe.js'
import { fakeYtDlp } from '../helpers/fake-ytdlp.js'
import { makePng, makeTempDir } from '../helpers/fixtures.js'
import { pinPlatform } from '../helpers/platform.js'

// These are the Mac's words; Linux has its own block at the end.
pinPlatform('darwin')

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
    expect(out).toEqual(['✓ talk.md   1:15 → 5 words · 2 parts'])
    expect(await argv(fake.dir)).toEqual(['run', input, '--notes'])
  })

  it('writes the transcript alone, and says so, when Apple Intelligence is off', async () => {
    const { fake, dir, input } = await setUp('off')
    const { code, out, err } = await run(intent(input))
    expect(code).toBe(0)
    expect(err).toEqual(['⚠ Apple Intelligence is off, so this is the transcript only.'])
    expect(out).toEqual(['✓ talk.md   1:15 → 5 words'])
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

  it('refuses a file that is not video or sound, by its content', async () => {
    await setUp()
    const png = await makePng(await makeTempDir(), 'still.mp4')
    const { code, err } = await run(intent(png))
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

describe('forge transcribe <link>', () => {
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

describe('forge transcribe on Linux', () => {
  pinPlatform('linux')

  it('writes the transcript without a warning: Linux never has notes', async () => {
    const fake = await fakeTranscribeHelper({
      status: { lines: [{ ok: true, speech: true, locale: 'en', notes: 'unsupported' }] },
      run: { lines: [RESULT] },
    })
    process.env.FORGE_TRANSCRIBE_HELPER = fake.path
    const dir = await makeTempDir()
    const input = join(dir, 'talk.mp4')
    await writeFile(input, MP4)
    const { code, out, err } = await run(intent(input))
    expect(code).toBe(0)
    expect(err).toEqual([])
    expect(out).toEqual(['✓ talk.md   1:15 → 5 words'])
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
    expect(err.join('\n')).toContain('which Linux does not have')
  })

  it('names whisper.cpp and ffmpeg when there is no speech', async () => {
    const fake = await fakeTranscribeHelper({
      status: { lines: [{ ok: true, speech: false, locale: 'en', notes: 'unsupported' }] },
    })
    process.env.FORGE_TRANSCRIBE_HELPER = fake.path
    const dir = await makeTempDir()
    const input = join(dir, 'talk.mp4')
    await writeFile(input, MP4)
    const { code, err } = await run(intent(input))
    expect(code).toBe(1)
    expect(err.join('\n')).toContain('whisper.cpp')
  })
})
