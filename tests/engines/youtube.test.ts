import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { isForgeError } from '../../src/core/errors.js'
import { fetchSound, type YouTubeEvent } from '../../src/engines/youtube.js'
import { fakeYtDlp } from '../helpers/fake-ytdlp.js'
import { makeTempDir } from '../helpers/fixtures.js'

const URL = 'https://www.youtube.com/watch?v=jNQXAC9IVRw'
const saved = process.env.XDG_CONFIG_HOME
afterEach(() => {
  if (saved === undefined) delete process.env.XDG_CONFIG_HOME
  else process.env.XDG_CONFIG_HOME = saved
})

const callsOf = async (path: string) =>
  (await readFile(path, 'utf8'))
    .trim()
    .split('\n')
    .map((l) => JSON.parse(l) as string[])

const codeOf = async (p: Promise<unknown>) => {
  const e = await p.catch((x: unknown) => x)
  return isForgeError(e) ? `${e.code}: ${e.detail}` : String(e)
}

describe('fetchSound', () => {
  it('tells the facts first, then the bytes, then hands over the sound file', async () => {
    await fakeYtDlp({
      bytes: [
        [1024, 4096],
        [4096, 4096],
      ],
    })
    const events: YouTubeEvent[] = []
    const got = await fetchSound(URL, { onEvent: (e) => events.push(e) })
    expect(events).toEqual([
      { kind: 'facts', facts: { title: 'Me at the zoo', uploader: 'jawed', seconds: 19 } },
      { kind: 'bytes', done: 1024, total: 4096 },
      { kind: 'bytes', done: 4096, total: 4096 },
    ])
    expect(got.facts).toEqual({ title: 'Me at the zoo', uploader: 'jawed', seconds: 19 })
    expect(await readFile(got.path, 'utf8')).toBe('sound')
    await got.dispose()
    expect(existsSync(dirname(got.path))).toBe(false)
  })

  it('runs yt-dlp once, on Forge’s own node, for the sound alone', async () => {
    const { calls } = await fakeYtDlp({})
    await (await fetchSound(URL)).dispose()
    const [argv, ...more] = await callsOf(calls)
    expect(more).toEqual([])
    expect(argv).toContain(`node:${process.execPath}`)
    expect(argv).toContain('--no-playlist')
    expect(argv?.[argv.indexOf('-f') + 1]).toBe('bestaudio[ext=m4a]/bestaudio')
    expect(argv?.at(-1)).toBe(URL)
  })

  it.each([
    [
      "Private video. Sign in if you've been granted access to this video",
      'This video is private.',
    ],
    ['This video is unavailable', 'This video is unavailable.'],
    [
      'Sign in to confirm your age. This video may be inappropriate for some users.',
      'This video is age-restricted.',
    ],
    [
      'Join this channel to get access to members-only content like this video',
      'This video is for channel members only.',
    ],
    ['This live event will begin in 3 hours.', 'This video has not started yet.'],
  ])('refuses "%s" in plain words, without updating', async (error, words) => {
    const { calls } = await fakeYtDlp({ error })
    expect(await codeOf(fetchSound(URL))).toBe(`link-unavailable: ${words}`)
    expect(await callsOf(calls)).toHaveLength(1)
  })

  it('refuses a live stream', async () => {
    await fakeYtDlp({
      facts: { title: 'Live', uploader: 'x', duration: 0, is_live: true },
      hang: true,
    })
    expect(await codeOf(fetchSound(URL))).toBe(
      'link-unavailable: Live streams cannot be transcribed.',
    )
  })

  it('updates yt-dlp once and tries again when YouTube has changed under it', async () => {
    const { calls } = await fakeYtDlp({
      error: 'Unable to extract nsig function code',
      fixedByUpdate: true,
    })
    const got = await fetchSound(URL)
    await got.dispose()
    const runs = await callsOf(calls)
    expect(runs.map((a) => a.includes('--update'))).toEqual([false, true, false])
  })

  it('gives up after one update', async () => {
    const { calls } = await fakeYtDlp({ error: 'Unable to extract nsig function code' })
    expect(await codeOf(fetchSound(URL))).toMatch(
      /^link-unavailable: yt-dlp could not fetch this video/,
    )
    expect(await callsOf(calls)).toHaveLength(3)
  })

  it('stops, and leaves nothing behind, when asked to', async () => {
    await fakeYtDlp({ hang: true })
    const stop = new AbortController()
    let dir = ''
    const running = fetchSound(URL, {
      signal: stop.signal,
      onEvent: (e) => {
        if (e.kind === 'facts') stop.abort(new Error('stopped'))
      },
      onDir: (d) => {
        dir = d
      },
    })
    await expect(running).rejects.toThrow('stopped')
    expect(dir).not.toBe('')
    expect(existsSync(dir)).toBe(false)
  })

  it('says yt-dlp is not installed', async () => {
    process.env.XDG_CONFIG_HOME = await makeTempDir()
    // Linux has no extension; it uses the user's own yt-dlp, here pointed at nothing.
    const before = process.env.FORGE_YT_DLP
    process.env.FORGE_YT_DLP = join(process.env.XDG_CONFIG_HOME, 'missing')
    try {
      expect(await codeOf(fetchSound(URL))).toMatch(
        process.platform === 'linux'
          ? /^link-unavailable: YouTube links on Linux need yt-dlp/
          : /^extension-missing: /,
      )
    } finally {
      if (before === undefined) delete process.env.FORGE_YT_DLP
      else process.env.FORGE_YT_DLP = before
    }
  })

  it.skipIf(process.platform !== 'linux')(
    "uses the user's yt-dlp on Linux, and never updates it",
    async () => {
      const yt = await fakeYtDlp({ error: 'Some new YouTube change', fixedByUpdate: true })
      // The same script, as the user's own: no extension installed.
      process.env.XDG_CONFIG_HOME = await makeTempDir()
      const before = process.env.FORGE_YT_DLP
      process.env.FORGE_YT_DLP = join(
        yt.home,
        'forge',
        'extensions',
        'yt-dlp',
        '2026.08.19',
        'yt-dlp',
      )
      try {
        expect(await codeOf(fetchSound(URL))).toMatch(/^link-unavailable: yt-dlp could not fetch/)
        const calls = (await readFile(yt.calls, 'utf8')).trim().split('\n')
        expect(calls).toHaveLength(1)
        expect(calls[0]).not.toContain('--update')
      } finally {
        if (before === undefined) delete process.env.FORGE_YT_DLP
        else process.env.FORGE_YT_DLP = before
      }
    },
  )
})
