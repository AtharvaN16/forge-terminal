/**
 * Transcribe's engines (spec 2026-10-17-transcribe-design §4.1), chosen job
 * by job rather than machine by machine, so that each job runs wherever an
 * engine for it does:
 *
 * - hearing: Apple's recogniser where it works (macOS 26, through
 *   `forge-transcribe`, a Swift program built into dist/helpers), else
 *   whisper.cpp through `forge-transcribe-whisper.mjs`, which speaks the
 *   same lines (Windows, Linux, an Intel Mac, a Mac before macOS 26);
 * - notes: Apple's on-device model, during Apple's hearing, nowhere else;
 * - reading pictures and PDFs: Apple's Vision, through the Swift helper;
 * - Word and PDF: AppKit through the Swift helper on a Mac that runs it;
 *   elsewhere both are written here (`pagesDocx`, `pagesPdf`).
 *
 * This file only picks the engine for a job, runs it, and turns its JSON
 * lines into data and `ForgeError`s.
 */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'
import {
  conversionFailed,
  type ForgeError,
  languageUnsupported,
  noSound,
  readUnavailable,
  transcribeUnavailable,
  untranscribable,
} from '../core/errors.js'
import { DEFAULT_DETAIL, type Detail } from '../core/transcribe/detail.js'
import type { Transcription } from '../core/transcribe/markdown.js'
import {
  markdownHtml,
  markdownPages,
  markdownText,
  type Output,
} from '../core/transcribe/output.js'
import {
  type PageText,
  pageHtml,
  pageMarkdown,
  pagePlain,
  type ReadPage,
} from '../core/transcribe/page-text.js'
import { machineName } from '../extensions/catalog.js'
import { installed } from '../extensions/paths.js'
import { findFfmpeg } from './ffmpeg.js'
import { loadDocx } from './libs.js'
import { pagesPdf } from './pages-pdf.js'

/** What the whisper helper can lack: whisper.cpp's whisper-cli, or ffmpeg. */
export type TranscribeMissing = 'whisper' | 'ffmpeg'

export interface TranscribeStatus {
  /** Whether anything here can hear: Apple's recogniser or whisper.cpp. */
  speech: boolean
  /** Which engine hears, when one can. */
  hears?: 'apple' | 'whisper'
  /** The system's language as the recogniser names it, or null when it has none for it. */
  locale: string | null
  notes: 'available' | 'off' | 'unsupported'
  /** Whether it reads the text of pictures and PDFs (spec 2026-10-23-extract-text-design §5.1). */
  read: boolean
  /** Without speech, what the whisper helper is missing: what to install. */
  missing?: TranscribeMissing[]
}

export type TranscribeEvent =
  | { kind: 'model'; fraction: number }
  | { kind: 'heard'; seconds: number; of: number }
  | { kind: 'notes'; part: number; of: number }

/** A PDF's page about to be read: the count is known before the first. */
export type ReadEvent = { kind: 'page'; page: number; of: number }

/** A helper and which one it is: Apple's (a binary) or whisper's (a script for Forge's Node). */
export interface Helper {
  path: string
  kind: 'apple' | 'whisper'
}

const APPLE_NAME = 'forge-transcribe'
const WHISPER_NAME = 'forge-transcribe-whisper.mjs'
const PLATFORMS: readonly NodeJS.Platform[] = ['darwin', 'win32', 'linux']

/**
 * Why transcribe is not offered here: what to install, in this OS's words.
 * The whisper helper says the same when run without them (its `needs`).
 */
export function transcribeNeeds(
  platform: NodeJS.Platform = process.platform,
  missing: readonly TranscribeMissing[] = ['whisper'],
): string {
  // Nothing named still means whisper: it is what every one of these OSes is told to get.
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

/**
 * Why notes are not written here: Apple Intelligence is off, or this machine
 * has none (Windows, Linux, a Mac without Apple's recogniser). Notes are the
 * one part that stays Apple's.
 */
export function notesNeed(
  platform: NodeJS.Platform = process.platform,
  notes: TranscribeStatus['notes'] = platform === 'darwin' ? 'off' : 'unsupported',
): string {
  if (notes === 'off') return 'Summary and notes need Apple Intelligence, and it is off.'
  return `Summary and notes need Apple Intelligence, which this ${machineName(platform)} does not have.`
}

/**
 * Where each helper may be, from the folder this module runs in: beside the
 * bundle in dist/helpers (published; the bundle is dist/index.js or a chunk in
 * dist/chunks), or the repo's own when run from source (src/engines).
 */
export function helperPaths(here: string): { apple: string[]; whisper: string[] } {
  return {
    apple: [
      join(here, 'helpers', APPLE_NAME),
      join(here, '..', 'helpers', APPLE_NAME),
      join(here, '..', '..', 'dist', 'helpers', APPLE_NAME),
    ],
    whisper: [
      join(here, 'helpers', WHISPER_NAME),
      join(here, '..', 'helpers', WHISPER_NAME),
      join(here, '..', '..', 'helpers', 'transcribe', WHISPER_NAME),
    ],
  }
}

/**
 * The two helpers that are here. FORGE_TRANSCRIBE_HELPER (tests) pins one:
 * a .mjs is whisper's, anything else Apple's. Apple's is looked for on a Mac
 * only; whisper's on every OS Forge runs on.
 */
export function helpers(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): { apple?: string; whisper?: string } {
  const pinned = env.FORGE_TRANSCRIBE_HELPER
  if (pinned !== undefined) {
    if (!existsSync(pinned)) return {}
    return pinned.endsWith('.mjs') ? { whisper: pinned } : { apple: pinned }
  }
  if (!PLATFORMS.includes(platform)) return {}
  const paths = helperPaths(dirname(fileURLToPath(import.meta.url)))
  const apple = platform === 'darwin' ? paths.apple.find((p) => existsSync(p)) : undefined
  const whisper = paths.whisper.find((p) => existsSync(p))
  return { ...(apple ? { apple } : {}), ...(whisper ? { whisper } : {}) }
}

/**
 * Which helper hears. Apple's when it is there and says it can (so Apple's
 * recogniser stays first wherever it works), else whisper's. An Intel Mac or
 * an older macOS fails Apple's `status`, and falls to whisper's.
 */
export async function chooseHearing(opts: {
  apple?: string | undefined
  whisper?: string | undefined
  appleHears: (path: string) => Promise<boolean>
}): Promise<Helper | undefined> {
  // With nothing to fall back to, Apple's is asked nothing: it says itself why it cannot.
  if (opts.apple !== undefined && opts.whisper === undefined)
    return { path: opts.apple, kind: 'apple' }
  if (opts.apple !== undefined) {
    const hears = await opts.appleHears(opts.apple).catch(() => false)
    if (hears) return { path: opts.apple, kind: 'apple' }
  }
  return opts.whisper === undefined ? undefined : { path: opts.whisper, kind: 'whisper' }
}

/** Apple's helper's `status`, or undefined when it is not here or cannot answer. */
async function appleStatus(locale?: string): Promise<Line | undefined> {
  const { apple } = helpers()
  if (apple === undefined) return undefined
  const args = ['status', ...(locale ? ['--locale', locale] : [])]
  // A helper that cannot even answer (the universal build's Intel slice is
  // untested, spec 2026-10-23 §5.5) is no helper for any job.
  return exec({ path: apple, kind: 'apple' }, args, '').catch(() => undefined)
}

let hearing: Promise<Helper | undefined> | undefined

/** The helper that hears here. Chosen once per process: the answer depends on the machine. */
function hearingHelper(): Promise<Helper | undefined> {
  if (process.env.FORGE_TRANSCRIBE_HELPER !== undefined) hearing = undefined
  hearing ??= chooseHearing({
    ...helpers(),
    appleHears: async () => (await appleStatus())?.speech === true,
  })
  return hearing
}

/**
 * Apple's helper, for the jobs only it does (reading, Word and PDF);
 * `missing` when it is not here. Those jobs are offered only where its
 * `status` says so, so it is not asked again.
 */
function appleHelper(missing: () => ForgeError): Helper {
  const { apple } = helpers()
  if (apple === undefined) throw missing()
  return { path: apple, kind: 'apple' }
}

/**
 * What whisper's helper is handed: the ffmpeg the rest of Forge uses (PATH,
 * Homebrew, the video extension) and the whisper extension's whisper-cli,
 * unless the user named their own. And a stdin to close to stop it: on
 * Windows a kill could not reach its ffmpeg and whisper-cli.
 */
async function whisperEnv(): Promise<NodeJS.ProcessEnv> {
  const env: NodeJS.ProcessEnv = { ...process.env, FORGE_HELPER_STOP_ON_EOF: '1' }
  if (!env.FORGE_FFMPEG) {
    const tools = await findFfmpeg().catch(() => undefined)
    if (tools) env.FORGE_FFMPEG = tools.ffmpeg
  }
  if (!env.FORGE_WHISPER_CLI) {
    const ext = await installed('whisper')
    if (ext) env.FORGE_WHISPER_CLI = ext.entry
  }
  if (!env.FORGE_WHISPER_MODEL) {
    const ext = await installed('whisper')
    // The model ships inside the extension, beside whisper-cli.
    const model = ext && join(dirname(ext.entry), 'model.bin')
    if (model && existsSync(model)) env.FORGE_WHISPER_MODEL = model
  }
  return env
}

type Line = Record<string, unknown>

/** Grace for whisper's helper to stop its tools after its stdin closes, before it is killed. */
const STOP_GRACE_MS = 5000

/** Run a helper; every JSON line but the result goes to `onLine`; resolves with the result. */
async function exec(
  helper: Helper,
  args: string[],
  path: string,
  opts: {
    signal?: AbortSignal | undefined
    onLine?: (line: Line) => void
  } = {},
): Promise<Line> {
  const { signal } = opts
  if (signal?.aborted) throw signal.reason ?? new Error('aborted')
  const whisper = helper.kind === 'whisper'
  const env = whisper ? await whisperEnv() : process.env
  if (signal?.aborted) throw signal.reason ?? new Error('aborted')
  return new Promise((resolve, reject) => {
    // A script (whisper's helper) runs on the Node Forge runs on; a program (Apple's) runs itself.
    const script = /\.[cm]?js$/.test(helper.path)
    const [cmd, argv] = script ? [process.execPath, [helper.path, ...args]] : [helper.path, args]
    const child = spawn(cmd, argv, {
      stdio: [whisper ? 'pipe' : 'ignore', 'pipe', 'ignore'],
      env,
      windowsHide: true,
    })
    // Closed early when the helper is gone; nothing to say about that.
    child.stdin?.on('error', () => {})
    let result: Line | undefined
    let settled = false
    const done = (f: () => void) => {
      if (settled) return
      settled = true
      signal?.removeEventListener('abort', onAbort)
      f()
    }
    const onAbort = () => {
      if (whisper && child.stdin) {
        // Its stdin closing is whisper's helper's cue to stop its tools and go.
        child.stdin.end()
        setTimeout(() => child.kill('SIGKILL'), STOP_GRACE_MS).unref()
      } else child.kill('SIGKILL')
      done(() => reject(signal?.reason ?? new Error('aborted')))
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    // Always a pipe (stdio above); its type cannot say so when stdin is chosen at run time.
    createInterface({ input: child.stdout as NodeJS.ReadableStream }).on('line', (text) => {
      let line: Line
      try {
        line = JSON.parse(text) as Line
      } catch {
        return
      }
      if ('ok' in line) result = line
      else opts.onLine?.(line)
    })
    child.on('error', (e) => done(() => reject(conversionFailed(path, e))))
    child.on('close', () =>
      done(() => {
        if (result === undefined)
          return reject(conversionFailed(path, new Error(`${APPLE_NAME} gave no result`)))
        if (result.ok === true) return resolve(result)
        reject(
          failure(String(result.code ?? ''), String(result.message ?? ''), path, args, helper.kind),
        )
      }),
    )
  })
}

/** A helper's refusal, worded for the recogniser that refused: an Intel Mac's is whisper. */
function failure(
  code: string,
  message: string,
  path: string,
  args: string[],
  engine: Helper['kind'],
): Error {
  if (code === 'no-sound') return noSound(path)
  if (code === 'unreadable') return untranscribable(path, process.platform, engine)
  if (code === 'locale') {
    const i = args.indexOf('--locale')
    return languageUnsupported(
      i >= 0 ? (args[i + 1] ?? 'this language') : `this ${machineName()}'s language`,
      process.platform,
      engine,
    )
  }
  // unsupported: a tool is missing; runtime: whisper-cli is there but cannot start.
  if (code === 'unsupported' || code === 'runtime') return transcribeUnavailable(message)
  return conversionFailed(path, new Error(`${code}: ${message}`))
}

const MISSING: readonly TranscribeMissing[] = ['whisper', 'ffmpeg']

/**
 * What this machine can do, job by job, or undefined when no helper is here
 * at all. Notes come only with Apple's hearing; reading only with Apple's
 * helper. Word and PDF are written everywhere, so they are not asked of it.
 */
export async function transcribeStatus(
  opts: { locale?: string } = {},
): Promise<TranscribeStatus | undefined> {
  const here = helpers()
  if (here.apple === undefined && here.whisper === undefined) return undefined
  const apple = await appleStatus(opts.locale)
  const base = { read: apple?.read === true }
  if (apple?.speech === true)
    return {
      speech: true,
      hears: 'apple',
      locale: typeof apple.locale === 'string' ? apple.locale : null,
      notes: apple.notes === 'available' || apple.notes === 'off' ? apple.notes : 'unsupported',
      ...base,
    }
  if (here.whisper === undefined) {
    if (apple === undefined) return undefined
    return { speech: false, locale: null, notes: 'unsupported', ...base }
  }
  const args = ['status', ...(opts.locale ? ['--locale', opts.locale] : [])]
  const w = await exec({ path: here.whisper, kind: 'whisper' }, args, '')
  const missing = Array.isArray(w.missing)
    ? MISSING.filter((m) => (w.missing as unknown[]).includes(m))
    : []
  return {
    speech: w.speech === true,
    ...(w.speech === true ? { hears: 'whisper' as const } : {}),
    locale: typeof w.locale === 'string' ? w.locale : null,
    notes: 'unsupported',
    ...base,
    ...(missing.length > 0 ? { missing } : {}),
  }
}

/**
 * Whether the whisper extension has anything to do here: everywhere but a
 * Mac whose own recogniser hears. Such a Mac does not list it.
 */
export async function whisperUseful(
  platform: NodeJS.Platform = process.platform,
): Promise<boolean> {
  if (platform !== 'darwin') return true
  return (await transcribeStatus().catch(() => undefined))?.hears !== 'apple'
}

/** The helper that hears, or why there is none. */
async function hearer(): Promise<Helper> {
  const helper = await hearingHelper()
  if (helper === undefined) throw transcribeUnavailable(transcribeNeeds())
  return helper
}

/** The sound's length; refuses a file with no sound or one the recogniser cannot read. */
export async function probeSound(path: string): Promise<{ seconds: number }> {
  const r = await exec(await hearer(), ['probe', path], path)
  return { seconds: Number(r.seconds) }
}

export async function runTranscribe(
  path: string,
  opts: {
    notes: boolean
    /** How much the notes say; the helper's own default (standard) when left out. */
    detail?: Detail | undefined
    locale?: string | undefined
    signal?: AbortSignal | undefined
    onEvent?: (e: TranscribeEvent) => void
  },
): Promise<Transcription & { locale: string }> {
  const args = [
    'run',
    path,
    ...(opts.locale ? ['--locale', opts.locale] : []),
    ...(opts.notes ? ['--notes'] : []),
    ...(opts.notes && opts.detail && opts.detail !== DEFAULT_DETAIL
      ? ['--detail', opts.detail]
      : []),
  ]
  const r = await exec(await hearer(), args, path, {
    signal: opts.signal,
    onLine: (line) => {
      const e = eventOf(line)
      if (e) opts.onEvent?.(e)
    },
  })
  return {
    locale: String(r.locale),
    seconds: Number(r.seconds),
    segments: r.segments as Transcription['segments'],
    ...(r.notes ? { notes: r.notes as NonNullable<Transcription['notes']> } : {}),
  }
}

function eventOf(line: Line): TranscribeEvent | undefined {
  if (line.event === 'model') return { kind: 'model', fraction: Number(line.fraction) }
  if (line.event === 'heard')
    return { kind: 'heard', seconds: Number(line.seconds), of: Number(line.of) }
  if (line.event === 'notes') return { kind: 'notes', part: Number(line.part), of: Number(line.of) }
  return undefined
}

/**
 * The text of a picture or PDF, as Vision saw it, one entry per page (spec
 * 2026-10-23-extract-text-design §5.1). Forge has already probed the file.
 */
export async function runRead(
  path: string,
  opts: {
    language?: string | undefined
    signal?: AbortSignal | undefined
    onEvent?: (e: ReadEvent) => void
  } = {},
): Promise<ReadPage[]> {
  const args = ['read', path, ...(opts.language ? ['--language', opts.language] : [])]
  const r = await exec(appleHelper(readUnavailable), args, path, {
    signal: opts.signal,
    onLine: (line) => {
      if (line.event === 'page')
        opts.onEvent?.({ kind: 'page', page: Number(line.page), of: Number(line.of) })
    },
  })
  return (r.pages ?? []) as ReadPage[]
}

/** Apple's helper when it is here and answers: it sets HTML as Word or PDF. Elsewhere Forge writes both. */
async function appleRenderer(): Promise<Helper | undefined> {
  const { apple } = helpers()
  if (apple === undefined || (await appleStatus()) === undefined) return undefined
  return { path: apple, kind: 'apple' }
}

/** HTML set as Word or PDF by Apple's helper; the caller writes the bytes. */
async function renderHtml(
  apple: Helper,
  html: string,
  format: 'docx' | 'pdf',
  opts: { signal?: AbortSignal | undefined },
): Promise<Buffer> {
  const dir = await mkdtemp(join(tmpdir(), 'forge-render-'))
  try {
    const page = join(dir, 'transcript.html')
    const out = join(dir, `transcript.${format}`)
    await writeFile(page, html, 'utf8')
    await exec(apple, ['render', page, out, '--as', format], out, { signal: opts.signal })
    return await readFile(out)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

/**
 * A picture's or PDF's text as Word, written here rather than by the helper:
 * AppKit's Word writer drops tables. Headings are Word's own heading styles,
 * so they show in its navigation; each page of a PDF starts a new page.
 */
/** The width of an A4 page's text with Word's own 1-inch margins, in twentieths of a point. */
const TEXT_WIDTH = 9026

async function pagesDocx(doc: PageText): Promise<Buffer> {
  const docx = await loadDocx()
  const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, HeadingLevel } = docx
  const NUMBERS = 'forge-numbers'
  let lists = 0
  const pieces = (page: PageText[number]) =>
    page.flatMap((p) => {
      if (p.kind === 'heading')
        return [
          new Paragraph({
            text: p.text,
            heading: p.level === 1 ? HeadingLevel.HEADING_1 : HeadingLevel.HEADING_2,
          }),
        ]
      if (p.kind === 'paragraph') return [new Paragraph({ text: p.text, spacing: { after: 160 } })]
      if (p.kind === 'list') {
        const instance = ++lists
        return p.items.map((text) =>
          p.ordered
            ? new Paragraph({ text, numbering: { reference: NUMBERS, level: 0, instance } })
            : new Paragraph({ text, bullet: { level: 0 } }),
        )
      }
      // Word reads the percentage; Pages and Quick Look only the cells' own widths.
      const columns = p.rows[0]?.length ?? 1
      return [
        new Table({
          width: { size: 100, type: docx.WidthType.PERCENTAGE },
          columnWidths: Array<number>(columns).fill(Math.floor(TEXT_WIDTH / columns)),
          margins: { top: 40, bottom: 40, left: 100, right: 100 },
          rows: p.rows.map(
            (row, i) =>
              new TableRow({
                tableHeader: i === 0,
                children: row.map(
                  (cell) =>
                    new TableCell({
                      width: { size: Math.floor(TEXT_WIDTH / columns), type: docx.WidthType.DXA },
                      children: [
                        new Paragraph({ children: [new TextRun({ text: cell, bold: i === 0 })] }),
                      ],
                    }),
                ),
              }),
          ),
        }),
        new Paragraph({ text: '' }),
      ]
    })
  const pages = doc.filter((page) => page.length > 0)
  const children = pages.flatMap((page, i) => [
    ...(i > 0 ? [new Paragraph({ children: [new docx.PageBreak()] })] : []),
    ...pieces(page),
  ])
  const file = new Document({
    numbering: {
      config: [
        {
          reference: NUMBERS,
          levels: [
            {
              level: 0,
              format: docx.LevelFormat.DECIMAL,
              text: '%1.',
              alignment: docx.AlignmentType.START,
            },
          ],
        },
      ],
    },
    sections: [{ children }],
  })
  return Packer.toBuffer(file)
}

/**
 * A picture's or PDF's text in the chosen format: the Markdown, the bare
 * words, Word (written here), or a PDF named after the file it was read from:
 * Apple's helper sets its HTML where it runs, Forge writes it elsewhere.
 */
export async function renderPages(
  doc: PageText,
  format: Output,
  name: string,
  opts: { signal?: AbortSignal | undefined } = {},
): Promise<Buffer> {
  if (format === 'md') return Buffer.from(pageMarkdown(doc), 'utf8')
  if (format === 'txt') return Buffer.from(pagePlain(doc), 'utf8')
  if (format === 'docx') return pagesDocx(doc)
  const apple = await appleRenderer()
  if (apple) return renderHtml(apple, pageHtml(doc, name), 'pdf', opts)
  return pagesPdf(doc, { title: name })
}

/** The transcript's own title: its first level-1 heading. */
function titleOf(doc: PageText): string {
  for (const piece of doc.flat())
    if (piece.kind === 'heading' && piece.level === 1) return piece.text
  return 'Transcript'
}

/**
 * The transcript's bytes in the chosen format (mockups/transcribe-2026-10-round4.html,
 * T1): the Markdown itself, its words as text, or its HTML set as Word or PDF
 * through Apple's helper where that runs. Elsewhere Word and PDF are written
 * here from the same Markdown (`markdownPages`). The caller writes the bytes
 * atomically.
 */
export async function renderTranscript(
  md: string,
  format: Output,
  opts: { signal?: AbortSignal | undefined } = {},
): Promise<Buffer> {
  if (format === 'md') return Buffer.from(md, 'utf8')
  if (format === 'txt') return Buffer.from(markdownText(md), 'utf8')
  const apple = await appleRenderer()
  if (apple) return renderHtml(apple, markdownHtml(md), format, opts)
  const doc = markdownPages(md)
  return format === 'docx' ? pagesDocx(doc) : pagesPdf(doc, { title: titleOf(doc) })
}
