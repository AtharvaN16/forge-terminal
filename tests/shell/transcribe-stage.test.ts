import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { isForgeError } from '../../src/core/errors.js'
import {
  readTranscribeFile,
  transcribeCard,
  transcribeNeed,
  transcribeVerb,
} from '../../src/shell/transcribe-stage.js'
import { fakeTranscribeHelper } from '../helpers/fake-transcribe.js'
import { makePdf, makePng, makeTempDir } from '../helpers/fixtures.js'

const URL = 'https://www.youtube.com/watch?v=jNQXAC9IVRw'

describe('the card home shows for transcribe', () => {
  it('a file: its name, its kind, how long and how big', () => {
    expect(
      transcribeCard({
        kind: 'file',
        path: '/talks/pre-suasion-talk.mp4',
        seconds: 3717,
        bytes: 386e6,
      }),
    ).toEqual({
      name: 'pre-suasion-talk.mp4',
      tag: 'MP4',
      size: '386 MB',
      facts: '1:01:57 · 386 MB',
    })
  })

  it('a link being looked up', () => {
    expect(transcribeCard({ kind: 'link', url: URL, phase: 'looking' })).toEqual({
      name: URL,
      tag: 'YouTube',
      size: '',
      facts: 'Looking up the link',
    })
  })

  it('a link being looked up pulses three dots, one to three cells wide, while time passes', () => {
    const facts = (tick: number) =>
      transcribeCard({ kind: 'link', url: URL, phase: 'looking' }, tick).facts
    expect(facts(0)).toBe('Looking up the link ·  ')
    expect(facts(1)).toBe('Looking up the link ·· ')
    expect(facts(2)).toBe('Looking up the link ···')
    expect(facts(3)).toBe('Looking up the link ·· ')
    expect(facts(4)).toBe(facts(0))
  })

  it('a link that needs yt-dlp first: the card keeps only the link; the field says the need and its real size', () => {
    const src = { kind: 'link', url: URL, phase: 'needs-yt-dlp', bytes: 37146048 } as const
    expect(transcribeCard(src)).toMatchObject({ name: URL, facts: '' })
    expect(transcribeNeed(src)).toEqual({ kind: 'needs', size: '37.1 MB' })
  })

  it('yt-dlp installing, in real bytes, said in the field', () => {
    const src = {
      kind: 'link',
      url: URL,
      phase: 'installing',
      done: 12.6e6,
      total: 37146048,
    } as const
    expect(transcribeCard(src).facts).toBe('')
    expect(transcribeNeed(src)).toMatchObject({ kind: 'installing', got: '12.6', of: '37.1 MB' })
  })

  it('a link looked up: the title, the channel and the length', () => {
    expect(
      transcribeCard({
        kind: 'link',
        url: URL,
        phase: 'ready',
        facts: { title: 'Me at the zoo', uploader: 'jawed', seconds: 19 },
      }),
    ).toEqual({ name: 'Me at the zoo', tag: 'YouTube', size: '', facts: 'jawed · 0:19' })
  })
})

describe('what ↵ does on home', () => {
  it('transcribes a file or a looked-up link, installs yt-dlp, and waits otherwise', () => {
    expect(transcribeVerb({ kind: 'file', path: '/a.mp4', seconds: 1, bytes: 1 })).toBe(
      'transcribe',
    )
    expect(
      transcribeVerb({
        kind: 'link',
        url: URL,
        phase: 'ready',
        facts: { title: 't', uploader: 'u', seconds: 1 },
      }),
    ).toBe('transcribe')
    expect(transcribeVerb({ kind: 'link', url: URL, phase: 'needs-yt-dlp', bytes: 1 })).toBe(
      'install',
    )
    expect(transcribeVerb({ kind: 'link', url: URL, phase: 'looking' })).toBeNull()
    expect(
      transcribeVerb({ kind: 'link', url: URL, phase: 'installing', done: 1, total: 2 }),
    ).toBeNull()
  })
})

describe('a picture or PDF on transcribe (spec 2026-10-23-extract-text-design §3)', () => {
  const image = {
    kind: 'page',
    what: 'image',
    path: '/shots/shot.png',
    format: 'png',
    bytes: 412_000,
    width: 1440,
    height: 900,
  } as const
  const pdf = {
    kind: 'page',
    what: 'pdf',
    path: '/scans/scan.pdf',
    bytes: 3.1e6,
    pages: 12,
  } as const

  it('a picture: its name, its kind, its size in pixels and bytes, as convert says them', () => {
    expect(transcribeCard(image)).toEqual({
      name: 'shot.png',
      tag: 'PNG',
      size: '412 KB',
      facts: '1440×900 · 412 KB',
    })
  })

  it('a PDF: its pages and bytes', () => {
    expect(transcribeCard(pdf)).toEqual({
      name: 'scan.pdf',
      tag: 'PDF',
      size: '3.1 MB',
      facts: '12 pages · 3.1 MB',
    })
    expect(transcribeCard({ ...pdf, pages: 1 }).facts).toBe('1 page · 3.1 MB')
  })

  it('↵ transcribes it', () => {
    expect(transcribeVerb(image)).toBe('transcribe')
  })
})

describe('readTranscribeFile', () => {
  const saved = process.env.FORGE_TRANSCRIBE_HELPER
  afterEach(() => {
    if (saved === undefined) delete process.env.FORGE_TRANSCRIBE_HELPER
    else process.env.FORGE_TRANSCRIBE_HELPER = saved
  })
  const helper = async (read: boolean) => {
    const fake = await fakeTranscribeHelper({
      status: { lines: [{ ok: true, speech: true, locale: 'en_US', notes: 'off', read }] },
    })
    process.env.FORGE_TRANSCRIBE_HELPER = fake.path
  }

  it('takes a picture by its content, whatever its name', async () => {
    await helper(true)
    const png = await makePng(await makeTempDir(), 'shot.mov')
    expect(await readTranscribeFile(png)).toMatchObject({
      kind: 'page',
      what: 'image',
      path: png,
      width: 40,
      height: 20,
    })
  })

  it('takes a PDF with its page count', async () => {
    await helper(true)
    const pdf = await makePdf(await makeTempDir(), 'scan.pdf', 2)
    expect(await readTranscribeFile(pdf)).toMatchObject({ kind: 'page', what: 'pdf', pages: 2 })
  })

  it('says reading text needs macOS 26 when the helper cannot read', async () => {
    await helper(false)
    const png = await makePng(await makeTempDir(), 'shot.png')
    const e = await readTranscribeFile(png).catch((x: unknown) => x)
    expect(isForgeError(e) && e.code).toBe('read-unavailable')
  })

  it('still refuses a file that is none of these', async () => {
    await helper(true)
    const odd = join(await makeTempDir(), 'odd.bin')
    await writeFile(odd, Buffer.from([0x50, 0x4b, 3, 4, 0, 0, 0, 0, 0xff, 0xfe]))
    const e = await readTranscribeFile(odd).catch((x: unknown) => x)
    expect(isForgeError(e) && e.code).toBe('unsupported-source')
  })
})
