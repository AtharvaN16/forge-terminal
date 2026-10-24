import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  chooseHelper,
  helperPaths,
  notesNeed,
  transcribeNeeds,
} from '../../src/engines/transcribe.js'

const APPLE = '/forge/dist/helpers/forge-transcribe'
const WHISPER = '/forge/dist/helpers/forge-transcribe-whisper.mjs'

/** An Apple probe that answers `speaks` and counts how often it was asked. */
const probe = (speaks: boolean | Error) => {
  const calls: string[] = []
  const appleSpeaks = async (path: string) => {
    calls.push(path)
    if (speaks instanceof Error) throw speaks
    return speaks
  }
  return { calls, appleSpeaks }
}

describe('chooseHelper', () => {
  it("a Mac with Apple's recogniser: Apple's helper, kept first", async () => {
    const p = probe(true)
    const got = await chooseHelper({ platform: 'darwin', apple: APPLE, whisper: WHISPER, ...p })
    expect(got).toEqual({ path: APPLE, kind: 'apple' })
    expect(p.calls).toEqual([APPLE])
  })

  it('a Mac where it cannot hear (before macOS 26): whisper', async () => {
    const got = await chooseHelper({
      platform: 'darwin',
      apple: APPLE,
      whisper: WHISPER,
      ...probe(false),
    })
    expect(got).toEqual({ path: WHISPER, kind: 'whisper' })
  })

  it('an Intel Mac, which cannot start it at all: whisper', async () => {
    const got = await chooseHelper({
      platform: 'darwin',
      apple: APPLE,
      whisper: WHISPER,
      ...probe(new Error('spawn Unknown system error -86')),
    })
    expect(got).toEqual({ path: WHISPER, kind: 'whisper' })
  })

  it("a Mac build without Apple's helper: whisper", async () => {
    const p = probe(true)
    const got = await chooseHelper({ platform: 'darwin', apple: undefined, whisper: WHISPER, ...p })
    expect(got).toEqual({ path: WHISPER, kind: 'whisper' })
    expect(p.calls).toEqual([])
  })

  it("Windows and Linux: whisper, without asking Apple's", async () => {
    for (const platform of ['win32', 'linux'] as const) {
      const p = probe(true)
      const got = await chooseHelper({ platform, apple: APPLE, whisper: WHISPER, ...p })
      expect(got).toEqual({ path: WHISPER, kind: 'whisper' })
      expect(p.calls).toEqual([])
    }
  })

  it('no helper on any other OS, or when whisper is missing where it is the only one', async () => {
    expect(
      await chooseHelper({ platform: 'freebsd', apple: APPLE, whisper: WHISPER, ...probe(true) }),
    ).toBeUndefined()
    expect(
      await chooseHelper({
        platform: 'win32',
        apple: undefined,
        whisper: undefined,
        ...probe(true),
      }),
    ).toBeUndefined()
  })
})

describe('helperPaths', () => {
  it('looks beside the bundle, beside a chunk, and in the repo from source', () => {
    const here = join('/forge', 'dist')
    const paths = helperPaths(here)
    expect(paths.whisper).toEqual([
      join('/forge', 'dist', 'helpers', 'forge-transcribe-whisper.mjs'),
      join('/forge', 'helpers', 'forge-transcribe-whisper.mjs'),
      join('/', 'helpers', 'transcribe', 'forge-transcribe-whisper.mjs'),
    ])
    expect(paths.apple[0]).toBe(join('/forge', 'dist', 'helpers', 'forge-transcribe'))
    // From source (src/engines), the repo's own copies.
    const src = helperPaths(join('/forge', 'src', 'engines'))
    expect(src.whisper[2]).toBe(
      join('/forge', 'helpers', 'transcribe', 'forge-transcribe-whisper.mjs'),
    )
    expect(src.apple[2]).toBe(join('/forge', 'dist', 'helpers', 'forge-transcribe'))
  })
})

describe('transcribeNeeds', () => {
  it('Windows: the whisper extension, and how to add it', () => {
    expect(transcribeNeeds('win32')).toBe(
      'Transcribe on Windows needs the whisper extension (forge extensions add whisper, or /extensions).',
    )
    expect(transcribeNeeds('win32', ['whisper', 'ffmpeg'])).toBe(
      'Transcribe on Windows needs the whisper extension (forge extensions add whisper, or /extensions) and ffmpeg (winget install ffmpeg).',
    )
    expect(transcribeNeeds('win32', ['ffmpeg'])).toBe(
      'Transcribe on Windows needs ffmpeg (winget install ffmpeg).',
    )
  })

  it('a Mac: Homebrew, in one command', () => {
    expect(transcribeNeeds('darwin')).toBe(
      'Transcribe on this Mac needs whisper.cpp: brew install whisper-cpp.',
    )
    expect(transcribeNeeds('darwin', ['whisper', 'ffmpeg'])).toBe(
      'Transcribe on this Mac needs whisper.cpp and ffmpeg: brew install whisper-cpp ffmpeg.',
    )
    expect(transcribeNeeds('darwin', ['ffmpeg'])).toBe(
      'Transcribe on this Mac needs ffmpeg: brew install ffmpeg.',
    )
  })

  it('Linux: the extension or whisper-cli on PATH', () => {
    expect(transcribeNeeds('linux')).toBe(
      'Transcribe on Linux needs whisper.cpp (forge extensions add whisper, or whisper-cli on your PATH).',
    )
    expect(transcribeNeeds('linux', ['ffmpeg'])).toBe(
      'Transcribe on Linux needs ffmpeg on your PATH.',
    )
  })

  it('nothing named still means whisper; any other OS has none', () => {
    expect(transcribeNeeds('linux', [])).toBe(transcribeNeeds('linux', ['whisper']))
    expect(transcribeNeeds('freebsd')).toBe('Transcribe needs macOS, Windows or Linux.')
  })
})

describe('notesNeed', () => {
  it('Windows and Linux: Apple Intelligence, which this computer does not have', () => {
    for (const platform of ['win32', 'linux'] as const)
      expect(notesNeed(platform)).toBe(
        'Summary and notes need Apple Intelligence, which this computer does not have.',
      )
  })

  it('a Mac: off, or (Intel, older macOS) not there at all', () => {
    expect(notesNeed('darwin')).toBe('Summary and notes need Apple Intelligence, and it is off.')
    expect(notesNeed('darwin', 'off')).toBe(
      'Summary and notes need Apple Intelligence, and it is off.',
    )
    expect(notesNeed('darwin', 'unsupported')).toBe(
      'Summary and notes need Apple Intelligence, which this Mac does not have.',
    )
  })
})
