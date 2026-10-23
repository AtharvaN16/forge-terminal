import { describe, expect, it } from 'vitest'
import { transcribeCard, transcribeNeed, transcribeVerb } from '../../src/shell/transcribe-stage.js'

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
