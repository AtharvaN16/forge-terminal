import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  chooseHearing,
  helperPaths,
  helpers,
  notesNeed,
  transcribeNeeds,
} from '../../src/engines/transcribe.js'

const APPLE = '/forge/dist/helpers/forge-transcribe'
const WHISPER = '/forge/dist/helpers/forge-transcribe-whisper.mjs'

/** An Apple probe that answers `hears` and counts how often it was asked. */
const probe = (hears: boolean | Error) => {
  const calls: string[] = []
  const appleHears = async (path: string) => {
    calls.push(path)
    if (hears instanceof Error) throw hears
    return hears
  }
  return { calls, appleHears }
}

describe('chooseHearing', () => {
  it("Apple's recogniser where it hears, kept first", async () => {
    const p = probe(true)
    const got = await chooseHearing({ apple: APPLE, whisper: WHISPER, ...p })
    expect(got).toEqual({ path: APPLE, kind: 'apple' })
    expect(p.calls).toEqual([APPLE])
  })

  it('a Mac where it cannot hear (before macOS 26): whisper', async () => {
    const got = await chooseHearing({ apple: APPLE, whisper: WHISPER, ...probe(false) })
    expect(got).toEqual({ path: WHISPER, kind: 'whisper' })
  })

  it('an Intel Mac, which cannot start it at all: whisper', async () => {
    const got = await chooseHearing({
      apple: APPLE,
      whisper: WHISPER,
      ...probe(new Error('spawn Unknown system error -86')),
    })
    expect(got).toEqual({ path: WHISPER, kind: 'whisper' })
  })

  it('no Apple helper (Windows, Linux, a Mac build without it): whisper, without asking', async () => {
    const p = probe(true)
    const got = await chooseHearing({ whisper: WHISPER, ...p })
    expect(got).toEqual({ path: WHISPER, kind: 'whisper' })
    expect(p.calls).toEqual([])
  })

  it('nothing hears without either helper', async () => {
    expect(await chooseHearing({ ...probe(true) })).toBeUndefined()
  })

  it("Apple's alone is used without asking: it says itself why it cannot", async () => {
    const p = probe(false)
    expect(await chooseHearing({ apple: APPLE, ...p })).toEqual({ path: APPLE, kind: 'apple' })
    expect(p.calls).toEqual([])
  })
})

describe('helpers', () => {
  it('looks for no helper on an OS Forge does not run on', () => {
    expect(helpers('freebsd', {})).toEqual({})
  })

  it("a pinned .mjs is whisper's, anything else Apple's, and a missing one is none", () => {
    expect(helpers('linux', { FORGE_TRANSCRIBE_HELPER: __filename })).toEqual({ apple: __filename })
    expect(helpers('darwin', { FORGE_TRANSCRIBE_HELPER: '/nowhere/x.mjs' })).toEqual({})
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

  it('a Mac: the whisper extension too; ffmpeg from Homebrew', () => {
    expect(transcribeNeeds('darwin')).toBe(
      'Transcribe on this Mac needs the whisper extension (forge extensions add whisper, or /extensions).',
    )
    expect(transcribeNeeds('darwin', ['ffmpeg'])).toBe(
      'Transcribe on this Mac needs ffmpeg (brew install ffmpeg).',
    )
  })

  it('Linux: the whisper extension, and ffmpeg on PATH', () => {
    expect(transcribeNeeds('linux')).toBe(
      'Transcribe on Linux needs the whisper extension (forge extensions add whisper, or /extensions).',
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
