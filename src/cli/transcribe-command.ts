import { existsSync } from 'node:fs'
import { stat } from 'node:fs/promises'
import { basename, dirname, extname, join, resolve } from 'node:path'
import { writeAtomic } from '../core/atomic.js'
import {
  fileNotFound,
  invalidArguments,
  isForgeError,
  linkUnavailable,
  noText,
  outputExists,
  readUnavailable,
  renderError,
  transcribeUnavailable,
  unexpectedError,
  untranscribable,
} from '../core/errors.js'
import { sniffKind } from '../core/folder.js'
import { looksLikeDirectory } from '../core/output-path.js'
import { readLink } from '../core/transcribe/links.js'
import {
  clock,
  fileStem,
  type Transcription,
  transcriptMarkdown,
} from '../core/transcribe/markdown.js'
import { OUTPUTS, type Output, outputExt } from '../core/transcribe/output.js'
import { type PageSource, pageSource } from '../core/transcribe/page-source.js'
import { hasText, pagePlain, pageText } from '../core/transcribe/page-text.js'
import {
  notesNeed,
  type ReadEvent,
  readRefusal,
  renderPages,
  renderTranscript,
  runRead,
  runTranscribe,
  type TranscribeEvent,
  transcribeNeeds,
  transcribeStatus,
} from '../engines/transcribe.js'
import { type FetchedSound, fetchSound } from '../engines/youtube.js'
import { displayName } from '../utils/display-path.js'
import type { TranscribeIntent } from './args.js'

export interface TranscribeIo {
  /** The result line. */
  out: (line: string) => void
  /** Warnings and refusals. */
  err: (line: string) => void
  signal?: AbortSignal
  /** Progress as it happens, for the entry point to draw on a terminal. */
  onProgress?: (e: TranscribeEvent | ReadEvent) => void
}

/** `--format`, else `-o`'s extension when it is one transcribe writes, else Markdown. */
function formatFor(intent: TranscribeIntent): Output {
  if (intent.format) return intent.format
  const o = intent.output
  if (o === undefined || looksLikeDirectory(o)) return 'md'
  const ext = extname(o).toLowerCase()
  return OUTPUTS.find((f) => f.ext === ext)?.id ?? 'md'
}

/** Where the file goes: beside the source (or here, for a link), into an `-o` folder, or the `-o` file itself. */
function outputFor(
  stem: string,
  beside: string,
  output: string | undefined,
  format: Output,
): string {
  const name = `${stem}${outputExt(format)}`
  if (output === undefined) return join(beside, name)
  return looksLikeDirectory(output) ? join(resolve(output), name) : resolve(output)
}

const count = (text: string) => text.split(/\s+/).filter(Boolean).length
const words = (t: Transcription) => t.segments.reduce((n, s) => n + count(s.text), 0)

/**
 * A file that is not video or sound, probed as a picture or PDF by Forge's
 * own probe (by content); undefined when the probe takes it for media after
 * all. Loaded only here: the sound path never pays for the engines.
 */
async function probePage(path: string): Promise<PageSource | undefined> {
  const { probe } = await import('../engines/registry.js')
  const info = await probe(path).catch(() => {
    throw untranscribable(path)
  })
  return pageSource(info)
}

/** The text of a picture or PDF (spec 2026-10-23-extract-text-design §3.5), one file. */
async function readPage(
  page: PageSource,
  intent: TranscribeIntent,
  io: TranscribeIo,
  format: Output,
): Promise<0> {
  if (intent.to !== undefined) {
    throw invalidArguments(
      '--to is for video and sound: a picture or PDF gives its text as it is.',
      `Try: forge transcribe ${basename(page.path)}`,
    )
  }
  const status = await transcribeStatus()
  if (!status?.read) throw await readRefusal()
  const output = outputFor(
    basename(page.path, extname(page.path)),
    dirname(page.path),
    intent.output,
    format,
  )
  if (existsSync(output) && !intent.force) throw outputExists(output)
  const pages = await runRead(page.path, {
    language: intent.language,
    signal: io.signal,
    onEvent: io.onProgress,
  })
  const doc = pageText(pages)
  if (!hasText(doc)) throw noText(page.path)
  await writeAtomic(
    output,
    await renderPages(doc, format, basename(page.path), {
      signal: io.signal,
      lang: intent.language,
    }),
  )
  const what =
    page.what === 'pdf'
      ? `${page.pages} ${page.pages === 1 ? 'page' : 'pages'}`
      : extname(page.path).slice(1).toUpperCase() || 'picture'
  io.out(
    `✓ ${displayName(output)}   ${what} → ${count(pagePlain(doc)).toLocaleString('en-US')} words`,
  )
  return 0
}

/**
 * `forge transcribe <file|link>` (spec 2026-10-17-transcribe-design §4.5): the
 * transcript, and notes when Apple Intelligence is on, written as one file —
 * Markdown, or Word, PDF or text with `--format`.
 * Never prints itself; `io` is how the entry point gets each line.
 */
export async function runTranscribeCommand(
  intent: TranscribeIntent,
  io: TranscribeIo,
): Promise<0 | 1> {
  try {
    const link = readLink(intent.input)
    if (link?.kind === 'playlist') {
      throw linkUnavailable('This is a playlist.', undefined, {
        hint: "Pass one video's link.",
        shellHint: "Paste one video's link.",
      })
    }
    let source: string
    let origin: { title: string; from: string }
    let output: string
    let fetched: FetchedSound | undefined
    const format = formatFor(intent)
    if (link === undefined) {
      source = resolve(intent.input)
      const info = await stat(source).catch(() => undefined)
      if (!info?.isFile()) throw fileNotFound(source)
      // By content, never by extension: a PNG named .mp4 is still a picture.
      const kind = await sniffKind(source)
      if (kind !== 'video' && kind !== 'audio') {
        const page = await probePage(source)
        if (page) return await readPage(page, intent, io, format)
      }
    }
    const status = await transcribeStatus(intent.language ? { locale: intent.language } : {})
    if (status === undefined || !status.speech) {
      throw transcribeUnavailable(transcribeNeeds(process.platform, status?.missing))
    }
    const notes = intent.notes && status.notes === 'available'
    if (intent.notes && !notes) {
      // Notes alone were the whole ask: a transcript would not be what they wanted.
      if (!intent.transcript) throw transcribeUnavailable(notesNeed(process.platform, status.notes))
      // Without Apple Intelligence at all (whisper) there are never notes, so `--to all`
      // (the default) is a transcript there, not a warning. Only "it is off" is news.
      if (status.notes === 'off')
        io.err('⚠ Apple Intelligence is off, so this is the transcript only.')
    }

    if (link === undefined) {
      source = resolve(intent.input)
      origin = { title: basename(source, extname(source)), from: basename(source) }
      output = outputFor(origin.title, dirname(source), intent.output, format)
      // Before the minute of listening, not after it.
      if (existsSync(output) && !intent.force) throw outputExists(output)
    } else {
      // The name comes with the facts, before the download is done: a taken
      // name stops it there.
      const stop = new AbortController()
      io.signal?.addEventListener('abort', () => stop.abort(io.signal?.reason), { once: true })
      let named: string | undefined
      fetched = await fetchSound(link.url, {
        signal: stop.signal,
        onEvent: (e) => {
          if (e.kind !== 'facts') return
          named = outputFor(fileStem(e.facts.title), process.cwd(), intent.output, format)
          if (existsSync(named) && !intent.force) stop.abort(outputExists(named))
        },
      })
      source = fetched.path
      origin = { title: fetched.facts.title, from: link.url }
      output =
        named ?? outputFor(fileStem(fetched.facts.title), process.cwd(), intent.output, format)
    }

    let result: Awaited<ReturnType<typeof runTranscribe>>
    try {
      result = await runTranscribe(source, {
        notes,
        detail: intent.detail,
        locale: intent.language,
        signal: io.signal,
        onEvent: io.onProgress,
      })
    } finally {
      await fetched?.dispose()
    }
    const md = transcriptMarkdown(result, origin, { transcript: intent.transcript })
    await writeAtomic(
      output,
      await renderTranscript(md, format, { signal: io.signal, lang: result.locale }),
    )
    const n = result.notes?.parts.length
    const parts = n === undefined ? '' : ` · ${n} ${n === 1 ? 'part' : 'parts'}`
    io.out(
      `✓ ${displayName(output)}   ${clock(result.seconds)} → ${words(result).toLocaleString('en-US')} words${parts}`,
    )
    return 0
  } catch (e) {
    const error = isForgeError(e) ? e : unexpectedError(e)
    for (const line of renderError(error, { debug: intent.debug })) io.err(line)
    return 1
  }
}
