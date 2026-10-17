import { describe, expect, it } from 'vitest'
import { parseArgs } from '../../src/cli/args.js'
import { isForgeError } from '../../src/core/errors.js'

const fails = (argv: string[]) => {
  try {
    parseArgs(argv)
  } catch (e) {
    return isForgeError(e) ? e.code : String(e)
  }
  return 'parsed'
}

describe('forge transcribe', () => {
  it('reads a file, with notes by default', () => {
    expect(parseArgs(['transcribe', 'talk.mp4'])).toEqual({
      kind: 'transcribe',
      input: 'talk.mp4',
      notes: true,
      force: false,
      debug: false,
    })
  })

  it('reads a link the same way', () => {
    expect(parseArgs(['transcribe', 'https://youtu.be/jNQXAC9IVRw'])).toMatchObject({
      input: 'https://youtu.be/jNQXAC9IVRw',
    })
  })

  it('takes --to transcript for the transcript only, and --to notes', () => {
    expect(parseArgs(['transcribe', 'talk.mp4', '--to', 'transcript'])).toMatchObject({
      notes: false,
    })
    expect(parseArgs(['transcribe', 'talk.mp4', '--to', 'notes'])).toMatchObject({ notes: true })
  })

  it('takes a language, an output and --force', () => {
    expect(
      parseArgs(['transcribe', 'talk.mp4', '--language', 'hi', '-o', 'out/', '--force', '--debug']),
    ).toEqual({
      kind: 'transcribe',
      input: 'talk.mp4',
      notes: true,
      language: 'hi',
      output: 'out/',
      force: true,
      debug: true,
    })
  })

  it.each([
    [['transcribe']],
    [['transcribe', 'a.mp4', 'b.mp4']],
    [['transcribe', 'talk.mp4', '--to', 'srt']],
    [['transcribe', 'talk.mp4', '--language']],
    [['transcribe', 'talk.mp4', '--quality', '80']],
  ])('refuses %j', (argv) => {
    expect(fails(argv)).toBe('invalid-arguments')
  })
})
