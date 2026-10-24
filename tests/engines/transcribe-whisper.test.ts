import { spawnSync } from 'node:child_process'
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { forceFfmpegForTests } from '../../src/engines/ffmpeg.js'
import {
  runTranscribe,
  type TranscribeMissing,
  transcribeNeeds,
} from '../../src/engines/transcribe.js'
import { makeTempDir } from '../helpers/fixtures.js'

/**
 * The whisper helper (helpers/transcribe/forge-transcribe-whisper.mjs), run as
 * Forge runs it, over stand-ins for ffmpeg and whisper-cli that answer as
 * the real ones do. Each stand-in writes its argv beside itself.
 */
const HELPER = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../helpers/transcribe/forge-transcribe-whisper.mjs',
)

/** The helper's exports, for the parts that depend on the OS (imported, not run). */
interface HelperModule {
  needs: (platform: NodeJS.Platform, missing?: TranscribeMissing[]) => string
  findTool: (
    override: string,
    names: string[],
    env: NodeJS.ProcessEnv,
    platform: NodeJS.Platform,
  ) => string | undefined
  cacheDir: (env: NodeJS.ProcessEnv, platform: NodeJS.Platform, home: string) => string
  systemLocale: (env: NodeJS.ProcessEnv, fallback?: string) => string
  startFailure: (
    code: number,
    signal: string | null,
    platform: NodeJS.Platform,
    arch: string,
  ) => string | undefined
}
const mod = async () => (await import(pathToFileURL(HELPER).href)) as HelperModule

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

const WHISPER = (dir: string, language: string, hang: boolean) => `#!${process.execPath}
const fs = require('node:fs')
const argv = process.argv.slice(2)
fs.writeFileSync(${JSON.stringify(join(dir, 'whisper.argv'))}, JSON.stringify(argv))
fs.writeFileSync(${JSON.stringify(join(dir, 'whisper.pid'))}, String(process.pid))
const base = argv[argv.indexOf('-of') + 1]
process.stdout.write('[00:00:00.000 --> 00:00:04.000]   Ask not\\n')
if (${hang}) setInterval(() => {}, 1000)
else {
process.stdout.write('[00:00:04.000 --> 00:00:05.000]   [BLANK_AUDIO]\\n')
process.stdout.write('[00:00:05.000 --> 00:00:10.500]   what your country can do.\\n')
fs.writeFileSync(base + '.json', JSON.stringify({
  result: { language: ${JSON.stringify(language)} },
  transcription: [
    { offsets: { from: 0, to: 4000 }, text: ' Ask not' },
    { offsets: { from: 4000, to: 5000 }, text: ' [BLANK_AUDIO]' },
    { offsets: { from: 5000, to: 10500 }, text: ' what your country can do.' },
  ],
}))
}
`

async function fakes(
  opts: { audio?: boolean; language?: string; hang?: boolean } = {},
): Promise<Fakes> {
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
  await writeFile(join(dir, 'ffmpeg'), ffmpeg)
  await writeFile(join(dir, 'whisper-cli'), WHISPER(dir, opts.language ?? 'en', opts.hang ?? false))
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

describe.skipIf(process.platform === 'win32')('forge-transcribe-whisper.mjs', () => {
  it('status: speech when ffmpeg and whisper-cli are there, the locale from LANG, no notes', async () => {
    const f = await fakes()
    expect(helper(f, 'status').result).toEqual({
      ok: true,
      speech: true,
      locale: 'de_DE',
      notes: 'unsupported',
      missing: [],
    })
  })

  it('status: no speech without whisper-cli, says so, and no locale whisper does not know', async () => {
    const f = await fakes()
    f.env.FORGE_WHISPER_CLI = join(f.dir, 'missing')
    expect(helper(f, 'status', '--locale', 'xx-YY').result).toEqual({
      ok: true,
      speech: false,
      locale: null,
      notes: 'unsupported',
      missing: ['whisper'],
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

  it("run: unsupported without the tools, in this OS's words, naming what is missing", async () => {
    const f = await fakes()
    f.env.FORGE_FFMPEG = join(f.dir, 'missing')
    expect(helper(f, 'run', join(f.dir, 'talk.m4a')).result).toEqual({
      ok: false,
      code: 'unsupported',
      message: transcribeNeeds(process.platform, ['ffmpeg']),
    })
  })
})

describe('the whisper helper on each OS', () => {
  it('says what to install in the same words as Forge, on every OS and for every gap', async () => {
    const { needs } = await mod()
    const gaps: TranscribeMissing[][] = [[], ['whisper'], ['ffmpeg'], ['whisper', 'ffmpeg']]
    for (const platform of ['darwin', 'win32', 'linux', 'freebsd'] as NodeJS.Platform[])
      for (const missing of gaps)
        expect(needs(platform, missing)).toBe(transcribeNeeds(platform, missing))
  })

  it('keeps the model in each OS folder for caches', async () => {
    const { cacheDir } = await mod()
    expect(
      cacheDir({ LOCALAPPDATA: 'C:\\Users\\ada\\AppData\\Local' }, 'win32', 'C:\\Users\\ada'),
    ).toBe('C:\\Users\\ada\\AppData\\Local\\forge\\whisper')
    // Windows names are case-blind; with none, the usual place under the home folder.
    expect(cacheDir({ LocalAppData: 'D:\\Local' }, 'win32', 'C:\\Users\\ada')).toBe(
      'D:\\Local\\forge\\whisper',
    )
    expect(cacheDir({}, 'win32', 'C:\\Users\\ada')).toBe(
      'C:\\Users\\ada\\AppData\\Local\\forge\\whisper',
    )
    expect(cacheDir({ XDG_CACHE_HOME: '/x' }, 'darwin', '/Users/ada')).toBe(
      '/Users/ada/Library/Caches/forge/whisper',
    )
    expect(cacheDir({ XDG_CACHE_HOME: '/x' }, 'linux', '/home/ada')).toBe('/x/forge/whisper')
    expect(cacheDir({}, 'linux', '/home/ada')).toBe('/home/ada/.cache/forge/whisper')
  })

  it("takes the system's language from LANG, else from the OS (Windows sets no LANG)", async () => {
    const { systemLocale } = await mod()
    expect(systemLocale({ LANG: 'de_DE.UTF-8' }, 'fr-FR')).toBe('de_DE')
    expect(systemLocale({ LC_ALL: 'C' }, 'fr-FR')).toBe('en')
    expect(systemLocale({}, 'fr-FR')).toBe('fr_FR')
    expect(systemLocale({}, 'und')).toBe('en')
  })

  it('names the Visual C++ runtime when Windows cannot start whisper-cli for a missing DLL', async () => {
    const { startFailure } = await mod()
    expect(startFailure(3221225781, null, 'win32', 'x64')).toMatch(
      /Visual C\+\+ Redistributable.*vc_redist\.x64\.exe/,
    )
    expect(startFailure(-1073741515, null, 'win32', 'arm64')).toMatch(/vc_redist\.arm64\.exe/)
    expect(startFailure(1, null, 'win32', 'x64')).toBeUndefined()
    expect(startFailure(3221225781, null, 'linux', 'x64')).toBeUndefined()
  })

  it('says so when whisper-cli meets a processor without the instructions it was built for', async () => {
    const { startFailure } = await mod()
    expect(startFailure(-1, 'SIGILL', 'linux', 'x64')).toMatch(
      /lacks instructions.*FORGE_WHISPER_CLI/,
    )
    expect(startFailure(-1, 'SIGKILL', 'linux', 'x64')).toBeUndefined()
  })

  describe('findTool', () => {
    it('on Windows: PATHEXT endings, the Path variable in any case, no exec bit needed', async () => {
      const { findTool } = await mod()
      const dir = await makeTempDir()
      // Written without an exec bit: Windows has none.
      await writeFile(join(dir, 'whisper-cli.exe'), 'MZ')
      await writeFile(join(dir, 'whisper-cli.cmd'), '@echo off')
      const env = { Path: `C:\\nowhere;${dir}`, PATHEXT: '.COM;.EXE;.BAT;.CMD' }
      expect(findTool('FORGE_WHISPER_CLI', ['whisper-cli'], env, 'win32')).toBe(
        join(dir, 'whisper-cli.exe'),
      )
      // Only a .cmd: spawn cannot start that without a shell, so it is not found.
      const cmdOnly = await makeTempDir()
      await writeFile(join(cmdOnly, 'whisper-cli.cmd'), '@echo off')
      expect(
        findTool(
          'FORGE_WHISPER_CLI',
          ['whisper-cli'],
          { Path: cmdOnly, PATHEXT: '.CMD;.EXE' },
          'win32',
        ),
      ).toBeUndefined()
      // No PATHEXT at all still finds an .exe.
      expect(findTool('FORGE_WHISPER_CLI', ['whisper-cli'], { PATH: dir }, 'win32')).toBe(
        join(dir, 'whisper-cli.exe'),
      )
    })

    it('takes the override first, and nothing when it points at nothing', async () => {
      const { findTool } = await mod()
      const dir = await makeTempDir()
      await writeFile(join(dir, 'mine.exe'), 'MZ')
      await writeFile(join(dir, 'whisper-cli.exe'), 'MZ')
      const env = { PATH: dir, forge_whisper_cli: join(dir, 'mine.exe') }
      expect(findTool('FORGE_WHISPER_CLI', ['whisper-cli'], env, 'win32')).toBe(
        join(dir, 'mine.exe'),
      )
      expect(
        findTool(
          'FORGE_WHISPER_CLI',
          ['whisper-cli'],
          { PATH: dir, FORGE_WHISPER_CLI: join(dir, 'gone') },
          'linux',
        ),
      ).toBeUndefined()
    })

    it.skipIf(process.platform === 'win32')(
      'on POSIX: wants the exec bit, and whisper-cpp is the older name',
      async () => {
        const { findTool } = await mod()
        const dir = await makeTempDir()
        await writeFile(join(dir, 'whisper-cli'), '#!/bin/sh\n')
        expect(findTool('X', ['whisper-cli'], { PATH: dir }, 'linux')).toBeUndefined()
        await writeFile(join(dir, 'whisper-cpp'), '#!/bin/sh\n')
        await chmod(join(dir, 'whisper-cpp'), 0o755)
        expect(findTool('X', ['whisper-cli', 'whisper-cpp'], { PATH: dir }, 'linux')).toBe(
          join(dir, 'whisper-cpp'),
        )
      },
    )

    it('on a Mac: Homebrew after PATH, which a shell started from Finder may leave off', async () => {
      const { findTool } = await mod()
      // Only that it looks there: whatever this machine has in those folders is not asked for.
      const dir = await makeTempDir()
      expect(findTool('X', ['forge-no-such-tool'], { PATH: dir }, 'darwin')).toBeUndefined()
    })
  })
})

describe.skipIf(process.platform === 'win32')('runTranscribe with the whisper helper', () => {
  const saved = { ...process.env }
  afterEach(() => {
    process.env = { ...saved }
    forceFfmpegForTests(null)
  })

  it('runs the .mjs on the Node Forge runs on', async () => {
    const f = await fakes()
    Object.assign(process.env, f.env, { FORGE_TRANSCRIBE_HELPER: HELPER })
    const got = await runTranscribe(join(f.dir, 'talk.m4a'), { notes: false })
    expect(got.locale).toBe('en')
    expect(got.segments).toHaveLength(2)
  })

  it("hands it Forge's own ffmpeg and the whisper extension's whisper-cli", async () => {
    const f = await fakes()
    const ext = await makeTempDir()
    const dir = join(ext, 'forge', 'extensions', 'whisper', '1.0.0')
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'whisper-cli'), WHISPER(f.dir, 'en', false))
    await chmod(join(dir, 'whisper-cli'), 0o755)
    await writeFile(
      join(dir, 'manifest.json'),
      JSON.stringify({
        id: 'whisper',
        version: '1.0.0',
        files: { 'whisper-cli': '' },
        entry: 'whisper-cli',
        kind: 'exec',
      }),
    )
    await writeFile(join(ext, 'forge', 'extensions', 'whisper', 'current'), '1.0.0\n')
    forceFfmpegForTests({ ffmpeg: join(f.dir, 'ffmpeg'), ffprobe: join(f.dir, 'ffmpeg') })
    Object.assign(process.env, f.env, {
      FORGE_TRANSCRIBE_HELPER: HELPER,
      XDG_CONFIG_HOME: ext,
      // Neither tool on PATH: they can only come from Forge.
      PATH: await makeTempDir(),
    })
    delete process.env.FORGE_FFMPEG
    delete process.env.FORGE_WHISPER_CLI
    const got = await runTranscribe(join(f.dir, 'talk.m4a'), { notes: false })
    expect(got.segments).toHaveLength(2)
    expect(await readFile(join(f.dir, 'ffmpeg.argv'), 'utf8')).toContain('talk.m4a')
    expect(await readFile(join(f.dir, 'whisper.argv'), 'utf8')).toContain('-oj')
  })

  it('stopping a run stops whisper-cli too, not only the helper', async () => {
    const f = await fakes({ hang: true })
    Object.assign(process.env, f.env, { FORGE_TRANSCRIBE_HELPER: HELPER })
    const stop = new AbortController()
    const run = runTranscribe(join(f.dir, 'talk.m4a'), {
      notes: false,
      signal: stop.signal,
      onEvent: (e) => {
        if (e.kind === 'heard') stop.abort(new Error('stopped'))
      },
    })
    await expect(run).rejects.toThrow('stopped')
    const pid = Number(await readFile(join(f.dir, 'whisper.pid'), 'utf8'))
    const alive = () => {
      try {
        process.kill(pid, 0)
        return true
      } catch {
        return false
      }
    }
    const until = Date.now() + 4000
    while (alive() && Date.now() < until) await new Promise((r) => setTimeout(r, 50))
    expect(alive()).toBe(false)
  })
})
