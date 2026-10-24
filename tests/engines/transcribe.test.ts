import { existsSync, readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import AdmZip from 'adm-zip'
import { afterEach, describe, expect, it } from 'vitest'
import { isForgeError } from '../../src/core/errors.js'
import { markdownHtml, markdownText } from '../../src/core/transcribe/output.js'
import { pageHtml, pageMarkdown, pagePlain, pageText } from '../../src/core/transcribe/page-text.js'
import {
  probeSound,
  type ReadEvent,
  renderPages,
  renderTranscript,
  runRead,
  runTranscribe,
  transcribeStatus,
} from '../../src/engines/transcribe.js'
import { fakeTranscribeHelper } from '../helpers/fake-transcribe.js'
import { makeTempDir } from '../helpers/fixtures.js'

const saved = process.env.FORGE_TRANSCRIBE_HELPER
afterEach(() => {
  if (saved === undefined) delete process.env.FORGE_TRANSCRIBE_HELPER
  else process.env.FORGE_TRANSCRIBE_HELPER = saved
})
const use = (path: string) => {
  process.env.FORGE_TRANSCRIBE_HELPER = path
}

describe('transcribeStatus', () => {
  it('reports what the helper says the Mac can do', async () => {
    use(
      (
        await fakeTranscribeHelper({
          status: { lines: [{ ok: true, speech: true, locale: 'en_US', notes: 'off' }] },
        })
      ).path,
    )
    expect(await transcribeStatus()).toEqual({
      speech: true,
      hears: 'apple',
      locale: 'en_US',
      notes: 'off',
      read: false,
      render: true,
    })
  })

  it('says whether it reads text: only when the helper says so (spec 2026-10-23 §5.1)', async () => {
    use(
      (
        await fakeTranscribeHelper({
          status: {
            lines: [{ ok: true, speech: true, locale: 'en_US', notes: 'off', read: true }],
          },
        })
      ).path,
    )
    expect((await transcribeStatus())?.read).toBe(true)
  })

  it('is undefined when the helper cannot even say (an untested Intel slice that will not start)', async () => {
    use(
      (
        await fakeTranscribeHelper({
          status: { lines: [{ ok: false, code: 'crash', message: 'dyld' }], exit: 1 },
        })
      ).path,
    )
    expect(await transcribeStatus()).toBeUndefined()
  })

  it('is undefined when there is no helper', async () => {
    use(join(await makeTempDir(), 'missing'))
    expect(await transcribeStatus()).toBeUndefined()
  })
})

describe('probeSound', () => {
  it('returns the length of the sound', async () => {
    use(
      (
        await fakeTranscribeHelper({
          probe: { lines: [{ ok: true, seconds: 3716.8, sound: true }] },
        })
      ).path,
    )
    expect(await probeSound('/tmp/talk.mp4')).toEqual({ seconds: 3716.8 })
  })

  it('refuses a file with no sound', async () => {
    use(
      (
        await fakeTranscribeHelper({
          probe: { lines: [{ ok: false, code: 'no-sound', message: 'It has no sound.' }], exit: 1 },
        })
      ).path,
    )
    const error = await probeSound('/tmp/silent.mp4').catch((e: unknown) => e)
    expect(isForgeError(error) && error.code).toBe('no-sound')
  })

  it('refuses a file the helper cannot read', async () => {
    use(
      (
        await fakeTranscribeHelper({
          probe: {
            lines: [{ ok: false, code: 'unreadable', message: 'This file cannot be read.' }],
            exit: 1,
          },
        })
      ).path,
    )
    const error = await probeSound('/tmp/talk.mkv').catch((e: unknown) => e)
    expect(isForgeError(error) && error.code).toBe('unsupported-source')
  })
})

describe('runTranscribe', () => {
  const result = {
    ok: true,
    locale: 'en_US',
    seconds: 19,
    segments: [{ start: 1, end: 3.5, text: 'Here we are.' }],
    notes: {
      summary: 'A zoo.',
      parts: [{ start: 1, heading: 'Elephants', points: ['Trunks.'], refused: false }],
    },
  }

  it('passes progress on as it comes, then returns the transcript and notes', async () => {
    const fake = await fakeTranscribeHelper({
      run: {
        lines: [
          { event: 'model', fraction: 0.5 },
          { event: 'heard', seconds: 3.5, of: 19 },
          { event: 'notes', part: 1, of: 1 },
          result,
        ],
      },
    })
    use(fake.path)
    const events: unknown[] = []
    const out = await runTranscribe('/tmp/zoo.m4a', {
      notes: true,
      locale: 'en-US',
      onEvent: (e) => events.push(e),
    })
    expect(events).toEqual([
      { kind: 'model', fraction: 0.5 },
      { kind: 'heard', seconds: 3.5, of: 19 },
      { kind: 'notes', part: 1, of: 1 },
    ])
    expect(out).toEqual({
      locale: 'en_US',
      seconds: 19,
      segments: result.segments,
      notes: result.notes,
    })
    expect(JSON.parse(await readFile(join(fake.dir, 'argv.json'), 'utf8'))).toEqual([
      'run',
      '/tmp/zoo.m4a',
      '--locale',
      'en-US',
      '--notes',
    ])
  })

  it('asks for no notes and no language unless given', async () => {
    const fake = await fakeTranscribeHelper({ run: { lines: [{ ...result, notes: undefined }] } })
    use(fake.path)
    const out = await runTranscribe('/tmp/zoo.m4a', { notes: false })
    expect(out.notes).toBeUndefined()
    expect(JSON.parse(await readFile(join(fake.dir, 'argv.json'), 'utf8'))).toEqual([
      'run',
      '/tmp/zoo.m4a',
    ])
  })

  it('stops the helper when asked to', async () => {
    use(
      (
        await fakeTranscribeHelper({
          run: { lines: [{ event: 'heard', seconds: 1, of: 19 }], hang: true },
        })
      ).path,
    )
    const stop = new AbortController()
    const running = runTranscribe('/tmp/zoo.m4a', {
      notes: false,
      signal: stop.signal,
      onEvent: () => stop.abort(new Error('stopped')),
    })
    await expect(running).rejects.toThrow('stopped')
  })

  it('refuses a language the recogniser does not know', async () => {
    use(
      (
        await fakeTranscribeHelper({
          run: {
            lines: [{ ok: false, code: 'locale', message: 'Not supported: xx-YY.' }],
            exit: 1,
          },
        })
      ).path,
    )
    const error = await runTranscribe('/tmp/zoo.m4a', { notes: false, locale: 'xx-YY' }).catch(
      (e: unknown) => e,
    )
    expect(isForgeError(error) && error.code).toBe('language-unsupported')
  })

  it('names this machine’s own language when none was asked for', async () => {
    use(
      (
        await fakeTranscribeHelper({
          run: { lines: [{ ok: false, code: 'locale', message: 'Not supported.' }], exit: 1 },
        })
      ).path,
    )
    const error = await runTranscribe('/tmp/zoo.m4a', { notes: false }).catch((e: unknown) => e)
    const machine =
      process.platform === 'win32' ? 'PC' : process.platform === 'darwin' ? 'Mac' : 'computer'
    expect(isForgeError(error) && error.detail).toContain(`this ${machine}'s language`)
  })
})

describe('renderTranscript', () => {
  const MD = '# Tea talk\n\nAbout tea.\n\n## Notes\n\n- Tea first.\n'

  it('gives the Markdown itself for .md, and its words for text, without the helper', async () => {
    use(join(await makeTempDir(), 'missing'))
    expect((await renderTranscript(MD, 'md')).toString('utf8')).toBe(MD)
    expect((await renderTranscript(MD, 'txt')).toString('utf8')).toBe(markdownText(MD))
  })

  it('has the helper set the HTML as Word, and returns what it wrote', async () => {
    const fake = await fakeTranscribeHelper({
      status: { lines: [{ ok: true, speech: true, locale: 'en_US', notes: 'off' }] },
      render: { lines: [{ ok: true }], echo: { from: 1, to: 2, prefix: 'docx:' } },
    })
    use(fake.path)
    const bytes = await renderTranscript(MD, 'docx')
    expect(bytes.toString('utf8')).toBe(`docx:${markdownHtml(MD)}`)
    const argv = JSON.parse(await readFile(join(fake.dir, 'argv.json'), 'utf8')) as string[]
    expect(argv[0]).toBe('render')
    expect(argv.slice(3)).toEqual(['--as', 'docx'])
    // Its scratch files are gone once the bytes are read.
    expect(existsSync(argv[1] ?? '')).toBe(false)
    expect(existsSync(argv[2] ?? '')).toBe(false)
  })

  it('asks for a PDF the same way', async () => {
    const fake = await fakeTranscribeHelper({
      render: { lines: [{ ok: true }], echo: { from: 1, to: 2, prefix: 'pdf:' } },
    })
    use(fake.path)
    expect((await renderTranscript(MD, 'pdf')).toString('utf8').startsWith('pdf:')).toBe(true)
    const argv = JSON.parse(await readFile(join(fake.dir, 'argv.json'), 'utf8')) as string[]
    expect(argv.slice(3)).toEqual(['--as', 'pdf'])
  })

  it('fails as a ForgeError when the helper cannot write it', async () => {
    use(
      (
        await fakeTranscribeHelper({
          render: { lines: [{ ok: false, code: 'render', message: 'no' }], exit: 1 },
        })
      ).path,
    )
    const e = await renderTranscript(MD, 'pdf').catch((x: unknown) => x)
    expect(isForgeError(e)).toBe(true)
  })

  it("writes Word itself where Apple's helper is not, from the same Markdown", async () => {
    use(join(await makeTempDir(), 'missing'))
    const bytes = await renderTranscript(MD, 'docx')
    const xml = new AdmZip(bytes).readAsText('word/document.xml')
    expect(xml).toContain('Heading1')
  })

  it("says PDF is not available where Apple's helper is not", async () => {
    use(join(await makeTempDir(), 'missing'))
    const e = await renderTranscript(MD, 'pdf').catch((x: unknown) => x)
    expect(isForgeError(e) && e.code).toBe('render-unavailable')
  })
})

/** What `read` printed for the spike page (tests/fixtures/README.md, `read/`). */
const DOC = JSON.parse(
  readFileSync(join(__dirname, '..', 'fixtures', 'read', 'doc.json'), 'utf8'),
) as { ok: true; pages: object[] }

/** Apple's reader saying it reads, as macOS 26's does. */
const READS = { lines: [{ ok: true, speech: true, locale: 'en_US', notes: 'off', read: true }] }

describe('runRead', () => {
  it('passes the pages on as they are read, then returns what Vision saw', async () => {
    const fake = await fakeTranscribeHelper({
      status: { lines: [{ ok: true, speech: true, locale: 'en_US', notes: 'off', read: true }] },
      read: {
        lines: [
          { event: 'page', page: 1, of: 2 },
          { event: 'page', page: 2, of: 2 },
          { ok: true, pages: [...DOC.pages, { blocks: [] }] },
        ],
      },
    })
    use(fake.path)
    const events: ReadEvent[] = []
    const pages = await runRead('/tmp/scan.pdf', { onEvent: (e) => events.push(e) })
    expect(events).toEqual([
      { kind: 'page', page: 1, of: 2 },
      { kind: 'page', page: 2, of: 2 },
    ])
    expect(pages).toHaveLength(2)
    expect(pageMarkdown(pageText(pages))).toContain('# Quarterly Field Report')
    const argv = JSON.parse(await readFile(join(fake.dir, 'argv.json'), 'utf8')) as string[]
    expect(argv).toEqual(['read', '/tmp/scan.pdf'])
  })

  it('pins the language when one is given', async () => {
    const fake = await fakeTranscribeHelper({ status: READS, read: { lines: [DOC] } })
    use(fake.path)
    await runRead('/tmp/shot.png', { language: 'ja' })
    const argv = JSON.parse(await readFile(join(fake.dir, 'argv.json'), 'utf8')) as string[]
    expect(argv).toEqual(['read', '/tmp/shot.png', '--language', 'ja'])
  })

  it('refuses a file the helper cannot open', async () => {
    use(
      (
        await fakeTranscribeHelper({
          status: READS,
          read: {
            lines: [{ ok: false, code: 'unreadable', message: 'This file cannot be read.' }],
            exit: 1,
          },
        })
      ).path,
    )
    const error = await runRead('/tmp/odd.png').catch((e: unknown) => e)
    expect(isForgeError(error) && error.code).toBe('unsupported-source')
  })

  it('says reading text is unavailable when there is no helper', async () => {
    use(join(await makeTempDir(), 'missing'))
    const error = await runRead('/tmp/shot.png').catch((e: unknown) => e)
    expect(isForgeError(error) && error.code).toBe('read-unavailable')
  })
})

describe('renderPages', () => {
  const doc = pageText(DOC.pages as Parameters<typeof pageText>[0])

  it('gives the Markdown for .md and the bare words for text, without the helper', async () => {
    use(join(await makeTempDir(), 'missing'))
    expect((await renderPages(doc, 'md', 'shot.png')).toString('utf8')).toBe(pageMarkdown(doc))
    expect((await renderPages(doc, 'txt', 'shot.png')).toString('utf8')).toBe(pagePlain(doc))
  })

  it('writes Word itself, with real headings and a real table (AppKit drops tables)', async () => {
    use(join(await makeTempDir(), 'missing'))
    const bytes = await renderPages(doc, 'docx', 'shot.png')
    const xml = new AdmZip(bytes).readAsText('word/document.xml')
    expect(xml).toContain('<w:pStyle w:val="Heading1"/>')
    expect(xml).toContain('<w:pStyle w:val="Heading2"/>')
    expect(xml).toContain('<w:tbl>')
    expect(xml).toContain('Quarterly Field Report')
    expect(xml).toContain('1,240')
  })

  it('has the helper set its HTML as a PDF', async () => {
    const fake = await fakeTranscribeHelper({
      render: { lines: [{ ok: true }], echo: { from: 1, to: 2, prefix: 'pdf:' } },
    })
    use(fake.path)
    const bytes = await renderPages(doc, 'pdf', 'shot.png')
    expect(bytes.toString('utf8')).toBe(`pdf:${pageHtml(doc, 'shot.png')}`)
  })
})
