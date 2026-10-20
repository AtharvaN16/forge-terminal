/**
 * What transcribe holds on home (spec 2026-10-17-transcribe-design §4.4): a
 * video or sound file, or a YouTube link on its way to being one. Home draws
 * it as its ordinary staged card; ↵ takes it on.
 */
import { stat } from 'node:fs/promises'
import { basename, extname } from 'node:path'
import { fileNotFound, transcribeUnavailable, untranscribable } from '../core/errors.js'
import { sniffKind } from '../core/folder.js'
import { clock } from '../core/transcribe/markdown.js'
import { formatBytes } from '../core/units.js'
import { probeSound, transcribeStatus } from '../engines/transcribe.js'
import type { VideoFacts } from '../engines/youtube.js'
import { bytesOf } from './components/EditPicker.js'
import type { StagedFile, StagedView } from './stage.js'

export type TranscribeSource =
  | { kind: 'file'; path: string; seconds: number; bytes: number }
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
 * then the helper's own probe, which knows whether it has sound at all.
 */
export async function readTranscribeFile(path: string): Promise<TranscribeSource> {
  const info = await stat(path).catch(() => undefined)
  if (!info?.isFile()) throw fileNotFound(path)
  const kind = await sniffKind(path)
  if (kind !== 'video' && kind !== 'audio') throw untranscribable(path)
  const status = await transcribeStatus()
  if (!status?.speech) {
    throw transcribeUnavailable('Transcribe needs macOS 26 or later on Apple silicon.')
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
  if (src.phase === 'needs-yt-dlp') {
    return card(
      src.url,
      `YouTube links need yt-dlp · ${formatBytes(src.bytes)} download · ↵ installs`,
    )
  }
  if (src.phase === 'installing') {
    const { got, of } = bytesOf(src.done, src.total)
    return card(src.url, `Installing yt-dlp · ${got} of ${of}`)
  }
  return card(src.facts.title, `${src.facts.uploader} · ${clock(src.facts.seconds)}`)
}

export function transcribeView(src: TranscribeSource, tick?: number): StagedView {
  const file = transcribeCard(src, tick)
  return { files: [file], headline: file.name, total: file.size, fresh: 0 }
}

/** ↵'s word on home, or null while there is nothing for ↵ to do yet. */
export function transcribeVerb(src: TranscribeSource): 'transcribe' | 'install' | null {
  if (src.kind === 'file') return 'transcribe'
  if (src.phase === 'ready') return 'transcribe'
  if (src.phase === 'needs-yt-dlp') return 'install'
  return null
}
