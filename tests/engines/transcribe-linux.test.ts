import { spawnSync } from 'node:child_process'
import { chmod, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { runTranscribe, transcribeNeeds } from '../../src/engines/transcribe.js'
import { systemYtDlp } from '../../src/engines/youtube.js'
import { makeTempDir } from '../helpers/fixtures.js'

/**
 * The Linux helper (helpers/transcribe/forge-transcribe-linux.mjs), run as
 * Forge runs it, over stand-ins for ffmpeg and whisper-cli that answer as
 * the real ones do. Each stand-in writes its argv beside itself.
 */
const HELPER = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../helpers/transcribe/forge-transcribe-linux.mjs',
)

interface Fakes {
  dir: string
  env: NodeJS.ProcessEnv
}

/** A 16 kHz mono 16-bit wav header followed by `seconds` of silence. */
const WAV = (seconds: number) => `(() => {
  const data = Math.round(${seconds} * 32000)
  const b = Buffer.alloc(44 + data)
  b.write('RIFF', 0); b.writeUInt32LE(36 + data, 4); b.write('WAVE', 8)
  b.write('fmt ', 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22)
  b.writeUInt32LE(16000, 24); b.writeUInt32LE(32000, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34)
  b.write('data', 36); b.writeUInt32LE(data, 40)
  return b
})()`

async function fakes(opts: { audio?: boolean; language?: string } = {}): Promise<Fakes> {
  const dir = await makeTempDir()
  const audio = opts.audio ?? true
  const ffmpeg = `#!${process.execPath}
const fs = require('node:fs')
const argv = process.argv.slice(2)
fs.appendFileSync(${JSON.stringify(join(dir, 'ffmpeg.argv'))}, JSON.stringify(argv) + '\\n')
process.stderr.write("Input #0, mov,mp4,m4a, from 'x':\\n  Duration: 00:00:11.00, start: 0.000000\\n")
process.stderr.write(${JSON.stringify(audio ? '  Stream #0:0[0x1](und): Audio: aac (LC), 44100 Hz, mono\n' : '  Stream #0:0[0x1](und): Video: h264, 640x480\n')})
if (argv.includes('-f')) { fs.writeFileSync(argv[argv.length - 1], ${WAV(11)}); process.exit(0) }
process.stderr.write('At least one output file must be specified\\n')
process.exit(1)
`
  const whisper = `#!${process.execPath}
const fs = require('node:fs')
const argv = process.argv.slice(2)
fs.writeFileSync(${JSON.stringify(join(dir, 'whisper.argv'))}, JSON.stringify(argv))
const base = argv[argv.indexOf('-of') + 1]
process.stdout.write('[00:00:00.000 --> 00:00:04.000]   Ask not\\n')
process.stdout.write('[00:00:04.000 --> 00:00:05.000]   [BLANK_AUDIO]\\n')
process.stdout.write('[00:00:05.000 --> 00:00:10.500]   what your country can do.\\n')
fs.writeFileSync(base + '.json', JSON.stringify({
  result: { language: ${JSON.stringify(opts.language ?? 'en')} },
  transcription: [
    { offsets: { from: 0, to: 4000 }, text: ' Ask not' },
    { offsets: { from: 4000, to: 5000 }, text: ' [BLANK_AUDIO]' },
    { offsets: { from: 5000, to: 10500 }, text: ' what your country can do.' },
  ],
}))
`
  await writeFile(join(dir, 'ffmpeg'), ffmpeg)
  await writeFile(join(dir, 'whisper-cli'), whisper)
  await writeFile(join(dir, 'model.bin'), 'not a real model')
  await writeFile(join(dir, 'talk.m4a'), 'sound')
  await chmod(join(dir, 'ffmpeg'), 0o755)
  await chmod(join(dir, 'whisper-cli'), 0o755)
  return {
    dir,
    env: {
      PATH: process.env.PATH,
      LANG: 'de_DE.UTF-8',
      FORGE_FFMPEG: join(dir, 'ffmpeg'),
      FORGE_WHISPER_CLI: join(dir, 'whisper-cli'),
      FORGE_WHISPER_MODEL: join(dir, 'model.bin'),
    },
  }
}

const helper = (f: Fakes, ...args: string[]) => {
  const r = spawnSync(process.execPath, [HELPER, ...args], { env: f.env, encoding: 'utf8' })
  const lines = r.stdout
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as Record<string, unknown>)
  return { code: r.status, lines, result: lines[lines.length - 1] }
}

describe.skipIf(process.platform === 'win32')('forge-transcribe-linux.mjs', () => {
  it('status: speech when ffmpeg and whisper-cli are there, the locale from LANG, no notes', async () => {
    const f = await fakes()
    expect(helper(f, 'status').result).toEqual({
      ok: true,
      speech: true,
      locale: 'de_DE',
      notes: 'unsupported',
    })
  })

  it('status: no speech without whisper-cli, and no locale whisper does not know', async () => {
    const f = await fakes()
    f.env.FORGE_WHISPER_CLI = join(f.dir, 'missing')
    expect(helper(f, 'status', '--locale', 'xx-YY').result).toEqual({
      ok: true,
      speech: false,
      locale: null,
      notes: 'unsupported',
    })
  })

  it('probe: the length ffmpeg reports', async () => {
    const f = await fakes()
    expect(helper(f, 'probe', join(f.dir, 'talk.m4a')).result).toEqual({
      ok: true,
      seconds: 11,
      sound: true,
    })
  })

  it('run: segments without whisper markers, heard events, the language whisper heard', async () => {
    const f = await fakes({ language: 'en' })
    const r = helper(f, 'run', join(f.dir, 'talk.m4a'))
    expect(r.code).toBe(0)
    expect(r.lines.filter((l) => l.event === 'heard')).toEqual([
      { event: 'heard', seconds: 4, of: 11 },
      { event: 'heard', seconds: 5, of: 11 },
      { event: 'heard', seconds: 10.5, of: 11 },
    ])
    expect(r.result).toEqual({
      ok: true,
      locale: 'en',
      seconds: 11,
      segments: [
        { start: 0, end: 4, text: 'Ask not' },
        { start: 5, end: 10.5, text: 'what your country can do.' },
      ],
    })
    const argv = JSON.parse(await readFile(join(f.dir, 'whisper.argv'), 'utf8')) as string[]
    expect(argv[argv.indexOf('-l') + 1]).toBe('auto')
    expect(argv[argv.indexOf('-m') + 1]).toBe(join(f.dir, 'model.bin'))
  })

  it('run --locale: whisper is told the language, the result keeps the locale', async () => {
    const f = await fakes()
    const r = helper(f, 'run', join(f.dir, 'talk.m4a'), '--locale', 'fr-FR')
    expect(r.result).toMatchObject({ ok: true, locale: 'fr_FR' })
    const argv = JSON.parse(await readFile(join(f.dir, 'whisper.argv'), 'utf8')) as string[]
    expect(argv[argv.indexOf('-l') + 1]).toBe('fr')
  })

  it('run: a language whisper does not know is refused before any work', async () => {
    const f = await fakes()
    const r = helper(f, 'run', join(f.dir, 'talk.m4a'), '--locale', 'xx')
    expect(r.code).toBe(1)
    expect(r.result).toMatchObject({ ok: false, code: 'locale' })
  })

  it('run: a file with no sound is no-sound', async () => {
    const f = await fakes({ audio: false })
    const r = helper(f, 'run', join(f.dir, 'talk.m4a'))
    expect(r.code).toBe(1)
    expect(r.result).toMatchObject({ ok: false, code: 'no-sound' })
  })

  it('run: unsupported without the tools, in Linux words', async () => {
    const f = await fakes()
    f.env.FORGE_FFMPEG = join(f.dir, 'missing')
    expect(helper(f, 'run', join(f.dir, 'talk.m4a')).result).toEqual({
      ok: false,
      code: 'unsupported',
      message: transcribeNeeds('linux'),
    })
  })
})

describe.skipIf(process.platform === 'win32')('runTranscribe with the Linux helper', () => {
  const saved = { ...process.env }
  afterEach(() => {
    process.env = { ...saved }
  })

  it('runs the .mjs on the Node Forge runs on', async () => {
    const f = await fakes()
    Object.assign(process.env, f.env, { FORGE_TRANSCRIBE_HELPER: HELPER })
    const got = await runTranscribe(join(f.dir, 'talk.m4a'), { notes: false })
    expect(got.locale).toBe('en')
    expect(got.segments).toHaveLength(2)
  })
})

describe('systemYtDlp', () => {
  it('finds yt-dlp on PATH, on Linux and macOS alike', async () => {
    const dir = await makeTempDir()
    await writeFile(join(dir, 'yt-dlp'), '#!/bin/sh\n')
    await chmod(join(dir, 'yt-dlp'), 0o755)
    expect(systemYtDlp({ PATH: dir }, 'linux')).toBe(join(dir, 'yt-dlp'))
    expect(systemYtDlp({ PATH: dir }, 'darwin')).toBe(join(dir, 'yt-dlp'))
  })

  it('takes FORGE_YT_DLP over PATH, and nothing when it points at nothing', async () => {
    const dir = await makeTempDir()
    await writeFile(join(dir, 'mine'), '#!/bin/sh\n')
    await chmod(join(dir, 'mine'), 0o755)
    expect(systemYtDlp({ FORGE_YT_DLP: join(dir, 'mine') }, 'linux')).toBe(join(dir, 'mine'))
    expect(systemYtDlp({ FORGE_YT_DLP: join(dir, 'gone') }, 'linux')).toBeUndefined()
  })

  it('transcribeNeeds names what each OS is missing', () => {
    expect(transcribeNeeds('linux')).toMatch(/whisper\.cpp/)
    expect(transcribeNeeds('darwin')).toMatch(/macOS 26/)
  })
})
