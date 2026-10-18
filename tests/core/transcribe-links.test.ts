import { describe, expect, it } from 'vitest'
import { readLink } from '../../src/core/transcribe/links.js'

const ID = 'jNQXAC9IVRw'
const CANONICAL = `https://www.youtube.com/watch?v=${ID}`

describe('readLink', () => {
  it('reads a watch link as that video', () => {
    expect(readLink(`https://www.youtube.com/watch?v=${ID}`)).toEqual({
      kind: 'video',
      id: ID,
      url: CANONICAL,
    })
  })

  it.each([
    [`https://youtu.be/${ID}?si=AbCdEf`],
    [`https://www.youtube.com/shorts/${ID}`],
    [`https://www.youtube.com/live/${ID}?feature=share`],
    [`https://m.youtube.com/watch?v=${ID}`],
    [`https://music.youtube.com/watch?v=${ID}&feature=share`],
    [`youtube.com/watch?v=${ID}`],
    [`  https://www.youtube.com/watch?t=42&v=${ID}  `],
  ])('reads %s as the same video', (text) => {
    expect(readLink(text)).toEqual({ kind: 'video', id: ID, url: CANONICAL })
  })

  it('reads a video opened from a playlist as the video alone', () => {
    expect(
      readLink(`https://www.youtube.com/watch?v=${ID}&list=PL590L5WQmH8fJ54F369BLDSqIwcs-TCfs`),
    ).toEqual({
      kind: 'video',
      id: ID,
      url: CANONICAL,
    })
  })

  it('tells a playlist apart from a video', () => {
    expect(
      readLink('https://www.youtube.com/playlist?list=PL590L5WQmH8fJ54F369BLDSqIwcs-TCfs'),
    ).toEqual({
      kind: 'playlist',
    })
  })

  it.each([
    ['/Users/me/talk.mp4'],
    ['https://vimeo.com/76979871'],
    ['https://www.youtube.com/@RSAorg'],
    ['https://www.youtube.com/watch?v=short'],
    ['https://notyoutube.com/watch?v=jNQXAC9IVRw'],
    [''],
  ])('does not read %s as a YouTube link', (text) => {
    expect(readLink(text)).toBeUndefined()
  })
})
