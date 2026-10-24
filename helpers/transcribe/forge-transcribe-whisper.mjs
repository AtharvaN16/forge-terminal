#!/usr/bin/env node
// forge-transcribe over whisper.cpp: the same protocol as forge-transcribe.swift
// (spec 2026-10-17-transcribe-design §4.1), backed by whisper.cpp and ffmpeg
// instead of Apple's recogniser. Forge runs it on Windows, on Linux, and on a
// Mac where Apple's recogniser is not there (Intel, or before macOS 26). Every
// line on stdout is one JSON object: progress events while it works, then one
// result.
//
//   forge-transcribe-whisper.mjs status [--locale <id>]
//   forge-transcribe-whisper.mjs probe <file>
//   forge-transcribe-whisper.mjs run <file> [--locale <id>] [--notes [--detail ...]]
//
// Needs ffmpeg and whisper.cpp's `whisper-cli` (or `whisper-cpp`). Forge passes
// the ones it found as FORGE_FFMPEG and FORGE_WHISPER_CLI (the whisper
// extension's); without them they are looked for on PATH, and on a Mac in
// Homebrew's two prefixes as well. The speech model (ggml-base q5_1, multilingual)
// is downloaded once into the OS's cache folder, pinned by its sha256.
// Overrides: FORGE_WHISPER_CLI, FORGE_FFMPEG, FORGE_WHISPER_MODEL (a .bin path).
// Notes need Apple's on-device model, so they are reported as unsupported.
// No dependencies beyond Node; original Forge code, MIT.
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  accessSync,
  constants,
  createWriteStream,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
} from 'node:fs'
import { availableParallelism, homedir, tmpdir } from 'node:os'
import { join, posix, win32 } from 'node:path'
import { pathToFileURL } from 'node:url'

// MARK: - Output

function emit(object) {
  process.stdout.write(`${JSON.stringify(object)}\n`)
}

function fail(code, message) {
  emit({ ok: false, code, message })
  cleanup()
  process.exit(1)
}

/**
 * What to install, in this OS's words. Forge says the same (transcribeNeeds
 * in src/engines/transcribe.ts); a test holds the two to one wording.
 */
export function needs(platform = process.platform, missing = ['whisper']) {
  const whisper = missing.includes('whisper') || !missing.includes('ffmpeg')
  const ffmpeg = missing.includes('ffmpeg')
  const parts = [
    whisper && 'the whisper extension (forge extensions add whisper, or /extensions)',
    ffmpeg &&
      (platform === 'darwin'
        ? 'ffmpeg (brew install ffmpeg)'
        : platform === 'win32'
          ? 'ffmpeg (winget install ffmpeg)'
          : 'ffmpeg on your PATH'),
  ].filter(Boolean)
  if (platform === 'darwin') return `Transcribe on this Mac needs ${parts.join(' and ')}.`
  if (platform === 'win32') return `Transcribe on Windows needs ${parts.join(' and ')}.`
  if (platform === 'linux') return `Transcribe on Linux needs ${parts.join(' and ')}.`
  return 'Transcribe needs macOS, Windows or Linux.'
}

// MARK: - Arguments

export function parseArgs(argv) {
  const rest = [...argv]
  const args = { command: rest.shift() ?? '', file: undefined, locale: undefined, notes: false }
  while (rest.length > 0) {
    const a = rest.shift()
    if (a === '--locale') args.locale = rest.shift()
    else if (a === '--notes') args.notes = true
    else if (a === '--detail') rest.shift()
    else if (args.file === undefined) args.file = a
  }
  return args
}

// MARK: - Tools

/** An environment variable; on Windows names are case-blind (`Path`, `PATH`). */
function envValue(env, name, platform) {
  if (platform !== 'win32') return env[name]
  const key = Object.keys(env).find((k) => k.toUpperCase() === name)
  return key === undefined ? undefined : env[key]
}

/** Windows has no exec bit (access X_OK only says the file is there), so a file is enough there. */
function runnable(path, platform) {
  try {
    if (platform !== 'win32') accessSync(path, constants.X_OK)
    return statSync(path).isFile()
  } catch {
    return false
  }
}

/**
 * The endings Windows runs a bare name with, from PATHEXT. Of those only .exe
 * and .com start without a shell (spawn refuses .bat and .cmd), so only they count.
 */
function windowsEndings(env) {
  const listed = (envValue(env, 'PATHEXT', 'win32') ?? '.COM;.EXE')
    .split(';')
    .map((e) => e.trim().toLowerCase())
    .filter((e) => e === '.exe' || e === '.com')
  return listed.length > 0 ? [...new Set(listed)] : ['.exe']
}

/**
 * The first of `names` on PATH (then Homebrew's prefixes on a Mac, which a
 * shell started from Finder may leave off PATH), or the override when it is
 * set (and runnable).
 */
export function findTool(override, names, env = process.env, platform = process.platform) {
  const pinned = envValue(env, override, platform)
  if (pinned) return runnable(pinned, platform) ? pinned : undefined
  const dirs = (envValue(env, 'PATH', platform) ?? '')
    .split(platform === 'win32' ? ';' : ':')
    .filter(Boolean)
  if (platform === 'darwin') dirs.push('/opt/homebrew/bin', '/usr/local/bin')
  const endings = platform === 'win32' ? windowsEndings(env) : ['']
  for (const dir of dirs) {
    for (const name of names) {
      for (const ending of endings) {
        const path = join(dir, name + ending)
        if (runnable(path, platform)) return path
      }
    }
  }
  return undefined
}

// Homebrew's whisper-cpp formula installs whisper-cli; older builds called it whisper-cpp.
const whisperCli = () => findTool('FORGE_WHISPER_CLI', ['whisper-cli', 'whisper-cpp'])
const ffmpeg = () => findTool('FORGE_FFMPEG', ['ffmpeg'])

/** What is not there, by the names `needs` takes. */
function missingTools() {
  return [!whisperCli() && 'whisper', !ffmpeg() && 'ffmpeg'].filter(Boolean)
}

// MARK: - Languages

/** The languages whisper's multilingual models know, by ISO 639-1 code (whisper.cpp's g_lang). */
const LANGS = new Set(
  (
    'en zh de es ru ko fr ja pt tr pl ca nl ar sv it id hi fi vi he uk el ms cs ro da hu ta no ' +
    'th ur hr bg lt la mi ml cy sk te fa lv bn sr az sl kn et mk br eu is hy ne mn bs kk sq sw ' +
    'gl mr pa si km sn yo so af oc ka be tg sd gu am yi lo uz fo ht ps tk nn mt sa lb my bo tl ' +
    'mg as tt haw ln ha ba jw su yue'
  ).split(' '),
)

/**
 * The system's language: the POSIX locale variables (en_US.UTF-8 -> en_US),
 * else what the OS tells Node (Windows and a Mac's GUI set no LANG), else en.
 */
export function systemLocale(
  env = process.env,
  fallback = Intl.DateTimeFormat().resolvedOptions().locale,
) {
  const raw = env.LC_ALL || env.LC_MESSAGES || env.LANG || ''
  const id = raw.split('.')[0].split('@')[0]
  if (id === 'C' || id === 'POSIX') return 'en'
  if (id !== '') return id
  const os = String(fallback ?? '').replace(/-/g, '_')
  return os === '' || os === 'und' ? 'en' : os
}

/** `en-US`/`en_US` -> { id: 'en_US', lang: 'en' }, or undefined when whisper has no model for it. */
export function resolveLocale(wanted) {
  const id = String(wanted).replace(/-/g, '_')
  const lang = id.split('_')[0].toLowerCase()
  return LANGS.has(lang) ? { id, lang } : undefined
}

// MARK: - Sound

const scratch = []
function cleanup() {
  // Retries: on Windows a file stays locked for a moment after its process is killed.
  for (const dir of scratch.splice(0))
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
}

/** Run a tool to the end; resolves with its exit code and output. */
function run(cmd, argv, { onStdoutLine } = {}) {
  return new Promise((resolve) => {
    const child = spawn(cmd, argv, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
    children.add(child)
    let stdout = ''
    let stderr = ''
    let pending = ''
    child.stdout.on('data', (chunk) => {
      const text = chunk.toString()
      stdout += text
      if (!onStdoutLine) return
      pending += text
      const lines = pending.split('\n')
      pending = lines.pop() ?? ''
      for (const line of lines) onStdoutLine(line)
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString()
    })
    child.on('error', (e) => {
      children.delete(child)
      resolve({ code: -1, signal: null, stdout, stderr: stderr + e.message })
    })
    child.on('close', (code, signal) => {
      children.delete(child)
      resolve({ code: code ?? -1, signal, stdout, stderr })
    })
  })
}

const children = new Set()

/** What ffmpeg says the file holds: whether it has sound, and its length when it knows it. */
async function inspect(path) {
  const r = await run(ffmpeg(), ['-hide_banner', '-nostdin', '-i', path])
  const readable = /^\s*Input #0/m.test(r.stderr)
  const sound = /Stream #\d+:\d+.*: Audio:/.test(r.stderr)
  const d = r.stderr.match(/Duration: (\d+):(\d{2}):(\d{2}(?:\.\d+)?)/)
  const seconds = d ? Number(d[1]) * 3600 + Number(d[2]) * 60 + Number(d[3]) : undefined
  return { readable, sound, seconds }
}

/** The length of a 16-bit mono 16 kHz wav, from its data chunk. */
export function wavSeconds(buffer) {
  let at = 12
  while (at + 8 <= buffer.length) {
    const id = buffer.toString('ascii', at, at + 4)
    const size = buffer.readUInt32LE(at + 4)
    if (id === 'data') return Math.min(size, buffer.length - at - 8) / 32000
    at += 8 + size + (size % 2)
  }
  return 0
}

/** Decode to the 16 kHz mono wav whisper wants; refuses files with no sound. */
async function decode(path) {
  const facts = await inspect(path)
  if (!facts.readable) fail('unreadable', 'ffmpeg cannot read this file.')
  if (!facts.sound) fail('no-sound', 'This file has no sound.')
  const dir = mkdtempSync(join(tmpdir(), 'forge-whisper-'))
  scratch.push(dir)
  const wav = join(dir, 'sound.wav')
  const r = await run(ffmpeg(), [
    '-hide_banner',
    '-nostdin',
    '-loglevel',
    'error',
    '-i',
    path,
    '-vn',
    '-ac',
    '1',
    '-ar',
    '16000',
    '-c:a',
    'pcm_s16le',
    '-f',
    'wav',
    wav,
  ])
  if (r.code !== 0) fail('unreadable', 'ffmpeg could not decode the sound.')
  const seconds = wavSeconds(readFileSync(wav))
  if (seconds <= 0) fail('no-sound', 'This file has no sound.')
  return { dir, wav, seconds }
}

// MARK: - Model

/**
 * ggml-base (multilingual), compressed to 5 bits (q5_1) as whisper.cpp
 * publishes it: 60 MB against the full model's 148, under Forge's 100 MB
 * ceiling for a model. The whisper extension carries this same file as
 * model.bin (FORGE_WHISPER_MODEL); it is downloaded here only for a
 * whisper-cli of the user's own.
 */
export const MODEL = {
  name: 'ggml-base-q5_1.bin',
  url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base-q5_1.bin',
  sha256: '422f1ae452ade6f30a004d7e5c6a43195e4433bc370bf23fac9cc591f01a8898',
}

/** Where the model is kept: each OS's own folder for caches. */
export function cacheDir(env = process.env, platform = process.platform, home = homedir()) {
  if (platform === 'win32') {
    const local = envValue(env, 'LOCALAPPDATA', platform) || win32.join(home, 'AppData', 'Local')
    return win32.join(local, 'forge', 'whisper')
  }
  if (platform === 'darwin') return posix.join(home, 'Library', 'Caches', 'forge', 'whisper')
  return posix.join(env.XDG_CACHE_HOME || posix.join(home, '.cache'), 'forge', 'whisper')
}

async function model() {
  const pinned = process.env.FORGE_WHISPER_MODEL
  if (pinned) {
    try {
      if (statSync(pinned).isFile()) return pinned
    } catch {}
    fail('model', `FORGE_WHISPER_MODEL points at nothing: ${pinned}`)
  }
  const dir = cacheDir()
  const path = join(dir, MODEL.name)
  try {
    if (statSync(path).isFile()) return path
  } catch {}
  mkdirSync(dir, { recursive: true })
  const part = `${path}.part`
  try {
    const res = await fetch(MODEL.url)
    if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`)
    const total = Number(res.headers.get('content-length')) || 0
    const hash = createHash('sha256')
    const out = createWriteStream(part)
    let done = 0
    let shown = -1
    for await (const chunk of res.body) {
      hash.update(chunk)
      if (!out.write(chunk)) await new Promise((r) => out.once('drain', r))
      done += chunk.length
      const fraction = total > 0 ? Math.min(done / total, 1) : 0
      if (Math.floor(fraction * 100) !== shown) {
        shown = Math.floor(fraction * 100)
        emit({ event: 'model', fraction })
      }
    }
    await new Promise((resolve, reject) => out.end((e) => (e ? reject(e) : resolve())))
    if (hash.digest('hex') !== MODEL.sha256) throw new Error('checksum mismatch')
    renameSync(part, path)
    return path
  } catch {
    rmSync(part, { force: true })
    fail('model', 'The speech model could not be downloaded.')
  }
}

// MARK: - Speech

/** `[00:01:02.340 --> 00:01:05.000]  text` -> the end, in seconds. */
export function heardUntil(line) {
  const m = line.match(/-->\s*(\d+):(\d{2}):(\d{2}(?:\.\d+)?)\]/)
  return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : undefined
}

/** whisper's markers for no speech, e.g. [BLANK_AUDIO], [Music], (applause). */
const MARKER = /^\s*(\[[^\]]*\]|\([^)]*\))\s*$/

/** whisper-cli's --output-json -> Forge's segments. */
export function segmentsOf(json) {
  const out = []
  for (const s of json.transcription ?? []) {
    const text = String(s.text ?? '').trim()
    if (text === '' || MARKER.test(text)) continue
    out.push({
      start: Number(s.offsets?.from ?? 0) / 1000,
      end: Number(s.offsets?.to ?? 0) / 1000,
      text,
    })
  }
  return out
}

async function transcribe(wav, dir, lang, seconds) {
  const modelPath = await model()
  const base = join(dir, 'transcript')
  const threads = String(Math.max(1, Math.min(availableParallelism(), 8)))
  const r = await run(
    whisperCli(),
    ['-m', modelPath, '-f', wav, '-l', lang, '-t', threads, '-oj', '-of', base],
    {
      onStdoutLine: (line) => {
        const end = heardUntil(line)
        if (end !== undefined)
          emit({ event: 'heard', seconds: Math.min(end, seconds), of: seconds })
      },
    },
  )
  const why = startFailure(r.code, r.signal)
  if (why) fail('runtime', why)
  if (r.code !== 0) fail('speech', `Transcription failed: whisper-cli exited ${r.code}`)
  let json
  try {
    json = JSON.parse(readFileSync(`${base}.json`, 'utf8'))
  } catch {
    fail('speech', 'Transcription failed: whisper-cli wrote no transcript')
  }
  return { segments: segmentsOf(json), language: json.result?.language }
}

// MARK: - Main

/** STATUS_DLL_NOT_FOUND: Windows could not start whisper-cli.exe for a missing DLL. */
const DLL_NOT_FOUND = [0xc0000135, 0xc0000135 - 2 ** 32]

/**
 * Why whisper-cli could not run here, in words, or undefined when it simply
 * failed: on Windows a missing Visual C++ runtime; anywhere, a processor
 * without the instructions it was built for (the extension's x64 Linux build
 * needs AVX2).
 */
export function startFailure(code, signal, platform = process.platform, arch = process.arch) {
  if (signal === 'SIGILL')
    return "whisper-cli stopped: this processor lacks instructions it was built for. Use your system's whisper-cli (set FORGE_WHISPER_CLI)."
  if (platform !== 'win32' || !DLL_NOT_FOUND.includes(code)) return undefined
  return `whisper-cli could not start: it needs the Microsoft Visual C++ Redistributable (https://aka.ms/vs/17/release/vc_redist.${arch === 'arm64' ? 'arm64' : 'x64'}.exe).`
}

/** Take ffmpeg and whisper-cli down, wait briefly for them to go, then the scratch files, then this. */
let stopping = false
async function stop() {
  // Asked once by stdin closing, maybe again by the parent check while it waits.
  if (stopping) return
  stopping = true
  const left = [...children]
  for (const child of left) child.kill()
  await Promise.race([
    Promise.all(
      left.map(
        (c) =>
          new Promise((r) =>
            c.exitCode !== null || c.signalCode !== null ? r() : c.once('close', r),
          ),
      ),
    ),
    new Promise((r) => setTimeout(r, 2000)),
  ])
  cleanup()
  process.exit(1)
}

/**
 * How Forge stops a run. With FORGE_HELPER_STOP_ON_EOF=1 it closes this
 * helper's stdin, which also happens by itself when Forge goes away: a signal
 * could not do this on Windows, where every kill is TerminateProcess and would
 * leave whisper-cli running on. Without it (run by hand), a Forge that dies is
 * noticed by this helper being handed to another parent (POSIX).
 */
function watchForStop() {
  if (process.env.FORGE_HELPER_STOP_ON_EOF === '1') {
    process.stdin.on('end', stop)
    process.stdin.on('error', stop)
    process.stdin.resume()
  }
  const parent = process.ppid
  const timer = setInterval(() => {
    if (process.ppid !== parent) stop()
  }, 500)
  timer.unref()
}

async function main(argv) {
  const args = parseArgs(argv)
  switch (args.command) {
    case 'status': {
      const locale = resolveLocale(args.locale ?? systemLocale())
      const missing = missingTools()
      emit({
        ok: true,
        speech: missing.length === 0,
        locale: locale?.id ?? null,
        notes: 'unsupported',
        missing,
      })
      return
    }
    case 'probe': {
      if (!args.file) fail('usage', 'probe needs a file')
      if (!ffmpeg()) fail('unsupported', needs(process.platform, missingTools()))
      const facts = await inspect(args.file)
      if (!facts.readable) fail('unreadable', 'ffmpeg cannot read this file.')
      if (!facts.sound) fail('no-sound', 'This file has no sound.')
      const seconds = facts.seconds ?? (await decode(args.file)).seconds
      emit({ ok: true, seconds, sound: true })
      return
    }
    case 'run': {
      if (!args.file) fail('usage', 'run needs a file')
      const missing = missingTools()
      if (missing.length > 0) fail('unsupported', needs(process.platform, missing))
      // No --locale: whisper hears which language it is, as the Mac's own language would be used there.
      const locale = args.locale === undefined ? undefined : resolveLocale(args.locale)
      if (args.locale !== undefined && locale === undefined)
        fail('locale', `whisper.cpp does not support ${args.locale}.`)
      watchForStop()
      const { dir, wav, seconds } = await decode(args.file)
      const { segments, language } = await transcribe(wav, dir, locale?.lang ?? 'auto', seconds)
      emit({
        ok: true,
        locale: locale?.id ?? language ?? systemLocale(),
        seconds,
        segments,
      })
      return
    }
    default:
      fail('usage', 'usage: forge-transcribe status|probe|run')
  }
}

// Run only as the helper, not when a test imports it.
if (
  (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) ||
  process.argv[1]?.endsWith('forge-transcribe-whisper.mjs')
) {
  main(process.argv.slice(2))
    .then(() => {
      cleanup()
      // A watched stdin would keep this process alive after its answer.
      process.stdin.destroy()
    })
    .catch((e) => fail('speech', `Transcription failed: ${e?.message ?? e}`))
}
