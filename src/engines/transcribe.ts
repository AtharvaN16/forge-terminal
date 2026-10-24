/**
 * The transcribe helper, `forge-transcribe` (spec 2026-10-17-transcribe-design
 * §4.1): a Swift program built into dist/helpers on macOS. Apple's speech
 * recogniser writes the transcript and Apple's on-device model the notes;
 * this file only finds the helper, runs it, and turns its JSON lines into
 * data and `ForgeError`s. The helper also sets a transcript as Word or PDF
 * (AppKit reads the HTML; nothing to install).
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
import { markdownHtml, markdownText, type Output } from '../core/transcribe/output.js'
import {
  type PageText,
  pageHtml,
  pageMarkdown,
  pagePlain,
  type ReadPage,
} from '../core/transcribe/page-text.js'
import { loadDocx } from './libs.js'

export interface TranscribeStatus {
  speech: boolean
  /** The Mac's language as the recogniser names it, or null when it has none for it. */
  locale: string | null
  notes: 'available' | 'off' | 'unsupported'
  /** Whether it reads the text of pictures and PDFs (spec 2026-10-23-extract-text-design §5.1). */
  read: boolean
}

export type TranscribeEvent =
  | { kind: 'model'; fraction: number }
  | { kind: 'heard'; seconds: number; of: number }
  | { kind: 'notes'; part: number; of: number }

/** A PDF's page about to be read: the count is known before the first. */
export type ReadEvent = { kind: 'page'; page: number; of: number }

const NAME = 'forge-transcribe'

/**
 * Where the helper is: FORGE_TRANSCRIBE_HELPER (tests), beside the bundle in
 * dist/helpers (published), or the repo's dist/helpers when run from source.
 */
export function transcribeHelper(): string | undefined {
  const pinned = process.env.FORGE_TRANSCRIBE_HELPER
  if (pinned !== undefined) return existsSync(pinned) ? pinned : undefined
  if (process.platform !== 'darwin') return undefined
  const here = dirname(fileURLToPath(import.meta.url))
  // The bundle is dist/index.js or a chunk in dist/chunks; from source this is src/engines.
  return [
    join(here, 'helpers', NAME),
    join(here, '..', 'helpers', NAME),
    join(here, '..', '..', 'dist', 'helpers', NAME),
  ].find((p) => existsSync(p))
}

type Line = Record<string, unknown>

/** Run the helper; every JSON line but the result goes to `onLine`; resolves with the result. */
function call(
  args: string[],
  path: string,
  opts: {
    signal?: AbortSignal | undefined
    onLine?: (line: Line) => void
    /** What to say when there is no helper at all. */
    missing?: () => ForgeError
  } = {},
): Promise<Line> {
  const helper = transcribeHelper()
  if (helper === undefined)
    return Promise.reject(
      opts.missing?.() ??
        transcribeUnavailable('Transcribe needs macOS 26 or later on Apple silicon.'),
    )
  const { signal } = opts
  if (signal?.aborted) return Promise.reject(signal.reason ?? new Error('aborted'))
  return new Promise((resolve, reject) => {
    const child = spawn(helper, args, { stdio: ['ignore', 'pipe', 'ignore'] })
    let result: Line | undefined
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
    createInterface({ input: child.stdout }).on('line', (text) => {
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
          return reject(conversionFailed(path, new Error(`${NAME} gave no result`)))
        if (result.ok === true) return resolve(result)
        reject(failure(String(result.code ?? ''), String(result.message ?? ''), path, args))
      }),
    )
  })
}

function failure(code: string, message: string, path: string, args: string[]): Error {
  if (code === 'no-sound') return noSound(path)
  if (code === 'unreadable') return untranscribable(path)
  if (code === 'locale') {
    const i = args.indexOf('--locale')
    return languageUnsupported(i >= 0 ? (args[i + 1] ?? 'this language') : "this Mac's language")
  }
  if (code === 'unsupported') return transcribeUnavailable(message)
  return conversionFailed(path, new Error(`${code}: ${message}`))
}

/** What this Mac can do, or undefined when there is no helper, or one that cannot answer. */
export async function transcribeStatus(
  opts: { locale?: string } = {},
): Promise<TranscribeStatus | undefined> {
  if (transcribeHelper() === undefined) return undefined
  const args = ['status', ...(opts.locale ? ['--locale', opts.locale] : [])]
  // A helper that cannot even answer (the universal build's Intel slice is
  // untested, spec 2026-10-23 §5.5) is no helper: nothing is offered.
  const r = await call(args, '').catch(() => undefined)
  if (r === undefined) return undefined
  return {
    speech: r.speech === true,
    locale: typeof r.locale === 'string' ? r.locale : null,
    notes: r.notes === 'available' || r.notes === 'off' ? r.notes : 'unsupported',
    read: r.read === true,
  }
}

/** The sound's length; refuses a file with no sound or one the recogniser cannot read. */
export async function probeSound(path: string): Promise<{ seconds: number }> {
  const r = await call(['probe', path], path)
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
  const r = await call(args, path, {
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
  const r = await call(args, path, {
    signal: opts.signal,
    missing: readUnavailable,
    onLine: (line) => {
      if (line.event === 'page')
        opts.onEvent?.({ kind: 'page', page: Number(line.page), of: Number(line.of) })
    },
  })
  return (r.pages ?? []) as ReadPage[]
}

/** HTML set as Word or PDF by the helper; the caller writes the bytes. */
async function renderHtml(
  html: string,
  format: 'docx' | 'pdf',
  opts: { signal?: AbortSignal | undefined },
): Promise<Buffer> {
  const dir = await mkdtemp(join(tmpdir(), 'forge-render-'))
  try {
    const page = join(dir, 'transcript.html')
    const out = join(dir, `transcript.${format}`)
    await writeFile(page, html, 'utf8')
    await call(['render', page, out, '--as', format], out, { signal: opts.signal })
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
 * words, Word (written here), or — through the helper — its HTML set as a
 * PDF, named after the file it was read from.
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
  return renderHtml(pageHtml(doc, name), format, opts)
}

/**
 * The transcript's bytes in the chosen format (mockups/transcribe-2026-10-round4.html,
 * T1): the Markdown itself, its words as text, or — through the helper —
 * its HTML set as Word or PDF. The caller writes the bytes atomically.
 */
export async function renderTranscript(
  md: string,
  format: Output,
  opts: { signal?: AbortSignal | undefined } = {},
): Promise<Buffer> {
  if (format === 'md') return Buffer.from(md, 'utf8')
  if (format === 'txt') return Buffer.from(markdownText(md), 'utf8')
  return renderHtml(markdownHtml(md), format, opts)
}
