import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { probeSound, runTranscribe } from '../../src/engines/transcribe.js'
import { fakeTranscribeHelper } from '../helpers/fake-transcribe.js'
import { ffmpegHere, makeClip } from '../helpers/media.js'

/**
 * Apple's recogniser reads MP4, MOV, M4A, MP3, WAV and AIFF; any other video
 * or sound reaches it as a WAV ffmpeg made, so a Mac transcribes every format
 * whisper does elsewhere.
 */
const saved = process.env.FORGE_TRANSCRIBE_HELPER
afterEach(() => {
  if (saved === undefined) delete process.env.FORGE_TRANSCRIBE_HELPER
  else process.env.FORGE_TRANSCRIBE_HELPER = saved
})

const RESULT = {
  ok: true,
  locale: 'en_US',
  seconds: 1,
  segments: [{ start: 0, end: 1, text: 'Hi.' }],
}

async function apple() {
  const fake = await fakeTranscribeHelper({
    status: { lines: [{ ok: true, speech: true, locale: 'en_US', notes: 'off' }] },
    probe: { lines: [{ ok: true, seconds: 1, sound: true }] },
    run: { lines: [RESULT] },
  })
  process.env.FORGE_TRANSCRIBE_HELPER = fake.path
  return fake
}

const argv = async (dir: string) =>
  JSON.parse(await readFile(join(dir, 'argv.json'), 'utf8')) as string[]

describe.skipIf(!ffmpegHere)("formats Apple's recogniser cannot read", () => {
  it('hands it a WAV of an MKV, and removes the WAV after', async () => {
    const fake = await apple()
    const mkv = await makeClip({ ext: 'mkv', seconds: 1 })
    await runTranscribe(mkv, { notes: false })
    const [cmd, heard] = await argv(fake.dir)
    expect(cmd).toBe('run')
    expect(heard).toMatch(/sound\.wav$/)
    expect(existsSync(heard as string)).toBe(false)
  })

  it('measures an MKV with ffprobe, without asking the helper', async () => {
    const fake = await apple()
    const mkv = await makeClip({ ext: 'mkv', seconds: 1 })
    expect((await probeSound(mkv)).seconds).toBeCloseTo(1, 0)
    expect(existsSync(join(fake.dir, 'argv.json'))).toBe(false)
  })

  it('hands it the file itself when it reads it: an MP3', async () => {
    const fake = await apple()
    const mp3 = await makeClip({ soundOnly: true, ext: 'mp3', seconds: 1 })
    await runTranscribe(mp3, { notes: false })
    expect((await argv(fake.dir))[1]).toBe(mp3)
  })
})
