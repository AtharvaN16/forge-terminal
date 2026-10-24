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
      transcript: true,
      detail: 'standard',
      force: false,
      debug: false,
    })
  })

  it('reads a link the same way', () => {
    expect(parseArgs(['transcribe', 'https://youtu.be/jNQXAC9IVRw'])).toMatchObject({
      input: 'https://youtu.be/jNQXAC9IVRw',
    })
  })

  it('takes --to transcript for the transcript only, and --to all', () => {
    expect(parseArgs(['transcribe', 'talk.mp4', '--to', 'transcript'])).toMatchObject({
      notes: false,
    })
    expect(parseArgs(['transcribe', 'talk.mp4', '--to', 'all'])).toMatchObject({ notes: true })
  })

  it('remembers that --to was given, which a picture refuses (spec 2026-10-23 §3.5)', () => {
    expect(parseArgs(['transcribe', 'talk.mp4', '--to', 'all'])).toMatchObject({ to: 'all' })
    expect(parseArgs(['transcribe', 'talk.mp4'])).not.toHaveProperty('to')
  })

  it('takes --to notes for the notes without the transcript', () => {
    expect(parseArgs(['transcribe', 'talk.mp4', '--to', 'notes'])).toMatchObject({
      notes: true,
      transcript: false,
    })
  })

  it('takes --detail brief | standard | detailed, and refuses anything else', () => {
    expect(parseArgs(['transcribe', 'talk.mp4', '--detail', 'Detailed'])).toMatchObject({
      detail: 'detailed',
    })
    expect(() => parseArgs(['transcribe', 'talk.mp4', '--detail', 'long'])).toThrow(/not long/)
  })

  it('takes a language, an output and --force', () => {
    expect(
      parseArgs(['transcribe', 'talk.mp4', '--language', 'hi', '-o', 'out/', '--force', '--debug']),
    ).toEqual({
      kind: 'transcribe',
      input: 'talk.mp4',
      notes: true,
      transcript: true,
      detail: 'standard',
      language: 'hi',
      output: 'out/',
      force: true,
      debug: true,
    })
  })

  it('takes --format md | docx | pdf | txt, or the names Markdown, Word and Text', () => {
    expect(parseArgs(['transcribe', 'talk.mp4', '--format', 'pdf'])).toMatchObject({
      format: 'pdf',
    })
    expect(parseArgs(['transcribe', 'talk.mp4', '--format', 'Word'])).toMatchObject({
      format: 'docx',
    })
    expect(parseArgs(['transcribe', 'talk.mp4', '--format', 'text'])).toMatchObject({
      format: 'txt',
    })
    expect(() => parseArgs(['transcribe', 'talk.mp4', '--format', 'rtf'])).toThrow(/not rtf/)
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
