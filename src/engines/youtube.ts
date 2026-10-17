/**
 * YouTube links for transcribe (spec 2026-10-17-transcribe-design §3, §4.3),
 * through the yt-dlp extension. One run per link: it prints the video's facts
 * before it downloads, then its byte progress, then where the sound landed —
 * so the card can show the title while the sound is still coming.
 */
import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { extensionMissing, linkUnavailable } from '../core/errors.js'
import { installed } from '../extensions/paths.js'

export interface VideoFacts {
  title: string
  uploader: string
  seconds: number
}

export type YouTubeEvent =
  | { kind: 'facts'; facts: VideoFacts }
  | { kind: 'bytes'; done: number; total: number }

export interface FetchedSound {
  path: string
  facts: VideoFacts
  /** Deletes the sound and its folder: once the transcript is written, or if the user leaves. */
  dispose: () => Promise<void>
}

/** yt-dlp's own words for a video Forge cannot have, in Forge's. Checked against 2026.08.19. */
const KNOWN: [RegExp, string][] = [
  [/private video/i, 'This video is private.'],
  [/confirm your age/i, 'This video is age-restricted.'],
  [/members-only|join this channel/i, 'This video is for channel members only.'],
  [/live event will begin|premieres in/i, 'This video has not started yet.'],
  [/unavailable|has been removed|does not exist/i, 'This video is unavailable.'],
]

class RunFailed extends Error {}

export async function fetchSound(
  url: string,
  opts: {
    signal?: AbortSignal
    onEvent?: (e: YouTubeEvent) => void
    /** The temp folder the sound goes in, as soon as it exists (tests check it is gone). */
    onDir?: (dir: string) => void
  } = {},
): Promise<FetchedSound> {
  const yt = await installed('yt-dlp')
  if (yt === undefined) throw extensionMissing('yt-dlp')
  const dir = await mkdtemp(join(tmpdir(), 'forge-yt-'))
  opts.onDir?.(dir)
  const dispose = () => rm(dir, { recursive: true, force: true })
  try {
    let got: { path: string; facts: VideoFacts }
    try {
      got = await once(yt.entry, url, dir, opts)
    } catch (e) {
      if (!(e instanceof RunFailed)) throw e
      // Not one of the known refusals: most likely YouTube changed and this
      // yt-dlp is behind. It updates itself (checking its own signatures);
      // then one more try.
      await update(yt.entry, opts.signal)
      try {
        got = await once(yt.entry, url, dir, opts)
      } catch (again) {
        if (!(again instanceof RunFailed)) throw again
        throw linkUnavailable(`yt-dlp could not fetch this video: ${again.message}`, again)
      }
    }
    return { ...got, dispose }
  } catch (e) {
    await dispose()
    throw e
  }
}

function once(
  ytDlp: string,
  url: string,
  dir: string,
  opts: { signal?: AbortSignal; onEvent?: (e: YouTubeEvent) => void },
): Promise<{ path: string; facts: VideoFacts }> {
  const { signal } = opts
  if (signal?.aborted) return Promise.reject(signal.reason ?? new Error('aborted'))
  const args = [
    '--js-runtimes',
    `node:${process.execPath}`,
    '--no-playlist',
    '--no-warnings',
    '--newline',
    '--progress',
    '-f',
    'bestaudio[ext=m4a]/bestaudio',
    '--print',
    'before_dl:forge-facts %(.{title,uploader,duration,is_live})j',
    '--progress-template',
    'download:forge-bytes %(progress.downloaded_bytes)s %(progress.total_bytes,progress.total_bytes_estimate)s',
    '--print',
    'after_move:forge-file %(filepath)s',
    '--no-simulate',
    '-o',
    join(dir, 'sound.%(ext)s'),
    url,
  ]
  return new Promise((resolve, reject) => {
    const child = spawn(ytDlp, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let facts: VideoFacts | undefined
    let file: string | undefined
    let stderr = ''
    let settled = false
    const done = (f: () => void) => {
      if (settled) return
      settled = true
      signal?.removeEventListener('abort', onAbort)
      f()
    }
    const onAbort = () => {
      child.kill('SIGKILL')
      done(() => reject(signal?.reason ?? new Error('aborted')))
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    createInterface({ input: child.stdout }).on('line', (line) => {
      if (line.startsWith('forge-facts ')) {
        const f = JSON.parse(line.slice(12)) as Record<string, unknown>
        if (f.is_live === true) {
          child.kill('SIGKILL')
          done(() => reject(linkUnavailable('Live streams cannot be transcribed.')))
          return
        }
        facts = {
          title: String(f.title ?? ''),
          uploader: String(f.uploader ?? ''),
          seconds: Number(f.duration ?? 0),
        }
        opts.onEvent?.({ kind: 'facts', facts })
      } else if (line.startsWith('forge-bytes ')) {
        const [d, t] = line.slice(12).split(' ').map(Number)
        if (Number.isFinite(d) && Number.isFinite(t) && (t ?? 0) > 0) {
          opts.onEvent?.({ kind: 'bytes', done: d as number, total: t as number })
        }
      } else if (line.startsWith('forge-file ')) file = line.slice(11)
    })
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })
    child.on('error', (e) => done(() => reject(new RunFailed(e.message))))
    child.on('close', (code) =>
      done(() => {
        if (code === 0 && facts !== undefined && file !== undefined)
          return resolve({ path: file, facts })
        const error = stderr.match(/ERROR: (?:\[[^\]]*\] )?(?:[\w-]+: )?(.*)/)?.[1]?.trim() ?? ''
        const known = KNOWN.find(([re]) => re.test(error))
        reject(known ? linkUnavailable(known[1]) : new RunFailed(error || `yt-dlp exited ${code}`))
      }),
    )
  })
}

function update(ytDlp: string, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(ytDlp, ['--update'], { stdio: 'ignore' })
    const onAbort = () => child.kill('SIGKILL')
    signal?.addEventListener('abort', onAbort, { once: true })
    child.on('error', () => resolve())
    child.on('close', () => {
      signal?.removeEventListener('abort', onAbort)
      if (signal?.aborted) reject(signal.reason ?? new Error('aborted'))
      else resolve()
    })
  })
}
