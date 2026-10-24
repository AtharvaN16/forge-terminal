/**
 * What transcribe holds on home (spec 2026-10-17-transcribe-design §4.4): a
 * video or sound file, or a YouTube link on its way to being one. Home draws
 * it as its ordinary staged card; ↵ takes it on.
 */
import { stat } from 'node:fs/promises'
import { basename, extname } from 'node:path'
import {
  fileNotFound,
  readUnavailable,
  transcribeUnavailable,
  untranscribable,
} from '../core/errors.js'
import { sniffKind } from '../core/folder.js'
import { FORMATS } from '../core/formats.js'
import { clock } from '../core/transcribe/markdown.js'
import { type PageSource, pageSource } from '../core/transcribe/page-source.js'
import { formatBytes } from '../core/units.js'
import {
  probeSound,
  readRefusal,
  transcribeNeeds,
  transcribeStatus,
} from '../engines/transcribe.js'
import type { VideoFacts } from '../engines/youtube.js'
import { bytesOf } from './components/EditPicker.js'
import type { StagedFile, StagedView } from './stage.js'

export type TranscribeSource =
  | { kind: 'file'; path: string; seconds: number; bytes: number }
  /**
   * A picture or PDF, whose text is read (spec 2026-10-23-extract-text-design
   * §3). `clip`: a picture pasted from the clipboard, whose text goes back
   * there — the change count it was read at says whether something else was
   * copied since (§3.3).
   */
  | ({ kind: 'page'; clip?: { changeCount: number } } & PageSource)
  | { kind: 'link'; url: string; phase: 'looking' }
  | { kind: 'link'; url: string; phase: 'needs-yt-dlp'; bytes: number }
  | { kind: 'link'; url: string; phase: 'installing'; done: number; total: number }
  | {
      kind: 'link'
      url: string
      phase: 'ready'
      facts: VideoFacts
      /** The sound's download so far, while it is still coming. */
      fetched?: { done: number; total: number }
    }

/**
 * A typed or dropped path, read for transcribe: by content (`sniffKind`),
 * then the helper's own probe, which knows whether it has sound at all. Not
 * video or sound, Forge's own probe tells a picture or PDF, whose text the
 * helper reads (spec 2026-10-23-extract-text-design §5.4).
 */
export async function readTranscribeFile(path: string): Promise<TranscribeSource> {
  const info = await stat(path).catch(() => undefined)
  if (!info?.isFile()) throw fileNotFound(path)
  const kind = await sniffKind(path)
  if (kind !== 'video' && kind !== 'audio') {
    const { probe } = await import('../engines/registry.js')
    const probed = await probe(path).catch(() => {
      throw untranscribable(path)
    })
    const page = pageSource(probed)
    if (page === undefined) throw untranscribable(path)
    if (!(await transcribeStatus())?.read) throw await readRefusal()
    return { kind: 'page', ...page }
  }
  const status = await transcribeStatus()
  if (!status?.speech) {
    throw transcribeUnavailable(transcribeNeeds(process.platform, status?.missing))
  }
  const { seconds } = await probeSound(path)
  return { kind: 'file', path, seconds, bytes: info.size }
}

/** Three dots that fill and empty: ·, ··, ···, ··. Held to three cells so the line does not shift. */
const pulse = (tick: number) => '·'.repeat([1, 2, 3, 2][tick % 4] as number).padEnd(3)

/**
 * The card's lines. The file's tag is its extension: a label only, the file was read by content.
 * `tick` animates the wait while a link is looked up; without it (motion off) the line is still.
 */
export function transcribeCard(src: TranscribeSource, tick?: number): StagedFile {
  if (src.kind === 'file') {
    const tag = extname(src.path).slice(1).toUpperCase() || 'FILE'
    const size = formatBytes(src.bytes)
    return { name: basename(src.path), tag, size, facts: `${clock(src.seconds)} · ${size}` }
  }
  if (src.kind === 'page') {
    const size = formatBytes(src.bytes)
    if (src.what === 'pdf') {
      const pages = `${src.pages} ${src.pages === 1 ? 'page' : 'pages'}`
      return { name: basename(src.path), tag: 'PDF', size, facts: `${pages} · ${size}` }
    }
    // The format's name, as convert's card says it: a pasted picture's file has no extension.
    const tag = FORMATS[src.format].label
    return { name: basename(src.path), tag, size, facts: `${src.width}×${src.height} · ${size}` }
  }
  const card = (name: string, facts: string): StagedFile => ({
    name,
    tag: 'YouTube',
    size: '',
    facts,
  })
  if (src.phase === 'looking') {
    return card(
      src.url,
      tick === undefined ? 'Looking up the link' : `Looking up the link ${pulse(tick)}`,
    )
  }
  // What the link still needs, and its download, are said in the field
  // beside ↵ install (transcribeNeed), not crowded into the card.
  if (src.phase === 'needs-yt-dlp' || src.phase === 'installing') return card(src.url, '')
  return card(src.facts.title, `${src.facts.uploader} · ${clock(src.facts.seconds)}`)
}

export function transcribeView(src: TranscribeSource, tick?: number): StagedView {
  const file = transcribeCard(src, tick)
  return { files: [file], headline: file.name, total: file.size, fresh: 0 }
}

/**
 * What the field says in its placeholder's place while a link waits for
 * yt-dlp (mockups/own-tools-2026-10-round5.html, F2): the need and its
 * size, then the download, in real bytes.
 */
export type TranscribeNeed =
  | { kind: 'needs'; size: string }
  | { kind: 'installing'; got: string; of: string; done: number; total: number }

export function transcribeNeed(src: TranscribeSource | undefined): TranscribeNeed | undefined {
  if (src?.kind !== 'link') return undefined
  if (src.phase === 'needs-yt-dlp') return { kind: 'needs', size: formatBytes(src.bytes) }
  if (src.phase === 'installing') {
    const { got, of } = bytesOf(src.done, src.total)
    return { kind: 'installing', got, of, done: src.done, total: src.total }
  }
  return undefined
}

/** ↵'s word on home, or null while there is nothing for ↵ to do yet. */
export function transcribeVerb(src: TranscribeSource): 'transcribe' | 'install' | null {
  if (src.kind === 'file' || src.kind === 'page') return 'transcribe'
  if (src.phase === 'ready') return 'transcribe'
  if (src.phase === 'needs-yt-dlp') return 'install'
  return null
}
