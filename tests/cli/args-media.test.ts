import { describe, expect, it } from 'vitest'
import { parseArgs } from '../../src/cli/args.js'
import { isForgeError } from '../../src/core/errors.js'

function codeOf(argv: string[]): string {
  try {
    parseArgs(argv)
  } catch (e) {
    return isForgeError(e) ? e.code : `unexpected:${String(e)}`
  }
  return 'no-error'
}

describe('video and sound flags', () => {
  it('carries a cut and mute into a conversion', () => {
    expect(parseArgs(['rec.mov', '--to', 'mp4', '--cut', '0:03.2-0:41', '--mute'])).toMatchObject({
      kind: 'convert',
      target: 'mp4',
      options: { media: { cut: { start: 3.2, end: 41 }, mute: true } },
    })
  })

  it('carries the CLI-only settings', () => {
    expect(parseArgs(['rec.mov', '--to', 'mp4', '--speed', '2', '--fps', '30'])).toMatchObject({
      options: { media: { speed: 2, fps: 30 } },
    })
    expect(
      parseArgs(['ep.wav', '--to', 'mp3', '--bitrate', '96k', '--loudness', '-14']),
    ).toMatchObject({ options: { media: { bitrate: 96, loudness: -14 } } })
  })

  it('carries them into a compression too', () => {
    expect(parseArgs(['rec.mov', '--max-size', '10mb', '--cut', '0:03-'])).toMatchObject({
      kind: 'compress',
      maxBytes: 10_000_000,
      options: { media: { cut: { start: 3 } } },
    })
  })

  it('edits in place of a conversion when nothing else is asked: same format, named for it', () => {
    expect(parseArgs(['rec.mov', '--cut', '0:03-0:41'])).toMatchObject({
      kind: 'edit',
      trim: false,
      media: { cut: { start: 3, end: 41 } },
    })
    expect(parseArgs(['rec.mov', '--mute'])).toMatchObject({ kind: 'edit', media: { mute: true } })
  })

  it('cleans up audio at the podcast level unless a level is asked', () => {
    expect(parseArgs(['rec.mov', '--clean-audio'])).toMatchObject({
      kind: 'edit',
      media: { cleanup: true, loudness: -16 },
    })
    expect(parseArgs(['rec.mov', '--clean-audio', '--loudness', '-14'])).toMatchObject({
      media: { cleanup: true, loudness: -14 },
    })
  })

  it.each([
    [['rec.mov', '--to', 'mp4', '--cut', '0:41-0:03']],
    [['rec.mov', '--to', 'mp4', '--cut', 'soon']],
    [['rec.mov', '--to', 'mp4', '--speed', '9']],
    [['rec.mov', '--to', 'mp4', '--fps', '0']],
    [['ep.wav', '--to', 'mp3', '--bitrate', '5']],
    [['ep.wav', '--to', 'mp3', '--loudness', '3']],
  ])('refuses %j', (argv) => {
    expect(codeOf(argv)).toBe('invalid-arguments')
  })

  it('does not take --trim (image edges) for a cut', () => {
    expect(codeOf(['rec.mov', '--trim', '--cut', '0:01-0:02'])).toBe('invalid-arguments')
  })
})
