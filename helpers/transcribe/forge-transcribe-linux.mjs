#!/usr/bin/env node
// forge-transcribe on Linux: the same protocol as forge-transcribe.swift
// (spec 2026-10-17-transcribe-design §4.1), backed by whisper.cpp and ffmpeg
// instead of Apple's recogniser. Every line on stdout is one JSON object:
// progress events while it works, then one result.
//
//   forge-transcribe-linux.mjs status [--locale <id>]
//   forge-transcribe-linux.mjs probe <file>
//   forge-transcribe-linux.mjs run <file> [--locale <id>] [--notes [--detail ...]]
//
// Needs on PATH: ffmpeg, and whisper.cpp's `whisper-cli` (or `whisper-cpp`).
// The speech model (ggml-base, multilingual) is downloaded once into
// $XDG_CACHE_HOME/forge/whisper, pinned by its sha256.
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
import { delimiter, join } from 'node:path'

// MARK: - Output

function emit(object) {
  process.stdout.write(`${JSON.stringify(object)}\n`)
}

function fail(code, message) {
  emit({ ok: false, code, message })
  cleanup()
  process.exit(1)
}

export const NEEDS = 'Transcribe on Linux needs ffmpeg and whisper.cpp (whisper-cli) on your PATH.'

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

function executable(path) {
  try {
    accessSync(path, constants.X_OK)
    return statSync(path).isFile()
  } catch {
    return false
  }
}

/** The first of `names` on PATH, or the override when it is set (and runnable). */
export function findTool(override, names, env = process.env) {
  const pinned = env[override]
  if (pinned) return executable(pinned) ? pinned : undefined
  for (const dir of (env.PATH ?? '').split(delimiter)) {
    if (!dir) continue
    for (const name of names) {
      const path = join(dir, name)
      if (executable(path)) return path
    }
  }
  return undefined
}

const whisperCli = () => findTool('FORGE_WHISPER_CLI', ['whisper-cli', 'whisper-cpp'])
const ffmpeg = () => findTool('FORGE_FFMPEG', ['ffmpeg'])

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

/** The system's language from the POSIX locale variables, e.g. en_US.UTF-8 -> en_US. */
export function systemLocale(env = process.env) {
  const raw = env.LC_ALL || env.LC_MESSAGES || env.LANG || ''
  const id = raw.split('.')[0].split('@')[0]
  return id === '' || id === 'C' || id === 'POSIX' ? 'en' : id
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
  for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true })
}

/** Run a tool to the end; resolves with its exit code and output. */
function run(cmd, argv, { onStdoutLine } = {}) {
  return new Promise((resolve) => {
    const child = spawn(cmd, argv, { stdio: ['ignore', 'pipe', 'pipe'] })
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
      resolve({ code: -1, stdout, stderr: stderr + e.message })
    })
    child.on('close', (code) => {
      children.delete(child)
      resolve({ code: code ?? -1, stdout, stderr })
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

/** ggml-base (multilingual), as whisper.cpp publishes it. */
export const MODEL = {
  name: 'ggml-base.bin',
  url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin',
  sha256: '60ed5bc3dd14eea856493d334349b405782ddcaf0028d4b5df4088345fba2efe',
}

function cacheDir(env = process.env) {
  return join(env.XDG_CACHE_HOME || join(homedir(), '.cache'), 'forge', 'whisper')
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

/** Forge kills this helper with SIGKILL on cancel; take ffmpeg and whisper-cli down with it. */
function watchParent() {
  const parent = process.ppid
  const timer = setInterval(() => {
    if (process.ppid !== parent) {
      for (const child of children) child.kill('SIGKILL')
      cleanup()
      process.exit(1)
    }
  }, 500)
  timer.unref()
}

async function main(argv) {
  const args = parseArgs(argv)
  switch (args.command) {
    case 'status': {
      const locale = resolveLocale(args.locale ?? systemLocale())
      emit({
        ok: true,
        speech: whisperCli() !== undefined && ffmpeg() !== undefined,
        locale: locale?.id ?? null,
        notes: 'unsupported',
      })
      return
    }
    case 'probe': {
      if (!args.file) fail('usage', 'probe needs a file')
      if (!ffmpeg()) fail('unsupported', NEEDS)
      const facts = await inspect(args.file)
      if (!facts.readable) fail('unreadable', 'ffmpeg cannot read this file.')
      if (!facts.sound) fail('no-sound', 'This file has no sound.')
      const seconds = facts.seconds ?? (await decode(args.file)).seconds
      emit({ ok: true, seconds, sound: true })
      return
    }
    case 'run': {
      if (!args.file) fail('usage', 'run needs a file')
      if (!whisperCli() || !ffmpeg()) fail('unsupported', NEEDS)
      // No --locale: whisper hears which language it is, as the Mac's own language would be used there.
      const locale = args.locale === undefined ? undefined : resolveLocale(args.locale)
      if (args.locale !== undefined && locale === undefined)
        fail('locale', `whisper.cpp does not support ${args.locale}.`)
      watchParent()
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
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith('forge-transcribe-linux.mjs')
) {
  main(process.argv.slice(2))
    .then(() => cleanup())
    .catch((e) => fail('speech', `Transcription failed: ${e?.message ?? e}`))
}
