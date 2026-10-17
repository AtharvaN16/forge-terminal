import { existsSync } from 'node:fs'
import { stat } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { probeMedia } from '../../src/engines/ffmpeg.js'
import { ffmpegHere, makeClip } from '../helpers/media.js'
import { runForge } from '../helpers/run-forge.js'

const beside = (clip: string, name: string) => join(clip, '..', name)

describe.skipIf(!ffmpegHere)('the CLI, for video and sound', () => {
  it('converts a MOV to MP4', async () => {
    const clip = await makeClip({ seconds: 1 })
    const run = await runForge([clip, '--to', 'mp4'], { timeoutMs: 60_000 })
    expect(run.exitCode).toBe(0)
    expect(existsSync(beside(clip, 'clip.mp4'))).toBe(true)
  })

  it('fits a size', async () => {
    const clip = await makeClip({ seconds: 3, width: 640, height: 480 })
    const run = await runForge([clip, '--max-size', '150kb'], { timeoutMs: 60_000 })
    expect(run.exitCode).toBe(0)
    expect((await stat(beside(clip, 'clip-small.mov'))).size).toBeLessThanOrEqual(150_000)
  })

  it('refuses a size under the floor, naming the floor', async () => {
    const clip = await makeClip({ seconds: 3 })
    const run = await runForge([clip, '--max-size', '1kb'], { timeoutMs: 60_000 })
    expect(run.exitCode).not.toBe(0)
    expect(`${run.stdout}${run.stderr}`).toMatch(/KB|MB/)
    expect(existsSync(beside(clip, 'clip-small.mov'))).toBe(false)
  })

  it('cuts in place of converting, named -trimmed', async () => {
    const clip = await makeClip({ seconds: 4 })
    const run = await runForge([clip, '--cut', '0:01-0:03'], { timeoutMs: 60_000 })
    expect(run.exitCode).toBe(0)
    const facts = await probeMedia(beside(clip, 'clip-trimmed.mov'))
    expect(facts.duration).toBeLessThan(3.5)
  })

  it('mutes', async () => {
    const clip = await makeClip({ seconds: 1 })
    const run = await runForge([clip, '--mute'], { timeoutMs: 60_000 })
    expect(run.exitCode).toBe(0)
    expect((await probeMedia(beside(clip, 'clip-muted.mov'))).audio).toBeUndefined()
  })

  it('encodes sound at a bitrate', async () => {
    const wav = await makeClip({ soundOnly: true, seconds: 2 })
    const run = await runForge([wav, '--to', 'mp3', '--bitrate', '96k'], { timeoutMs: 60_000 })
    expect(run.exitCode).toBe(0)
    expect((await probeMedia(beside(wav, 'clip.mp3'))).audio?.codec).toBe('mp3')
  })
})
