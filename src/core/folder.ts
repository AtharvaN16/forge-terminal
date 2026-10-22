import { open, readdir, stat } from 'node:fs/promises'
import { extname, join, resolve } from 'node:path'
import { probe } from '../engines/registry.js'
import { targetIdsFor } from './capabilities.js'
import { isForgeError } from './errors.js'
import { FORMATS } from './formats.js'
import type { InputFailure } from './resolve.js'
import type { FormatId, SourceInfo } from './types.js'

/**
 * A folder as `forge watch` and the shell's folder card see it: every file
 * in it (one level, as a folder drop always reads), each probed by its
 * content and grouped into kinds. A kind is what gets one answer — "the
 * images become WebP at 80", "the PDFs PNG at 150 dpi" — so a mixed folder
 * is asked once per kind, never once per file.
 */
export type KindId = 'images' | 'pdfs' | 'documents' | 'videos' | 'audio' | 'other'

export interface FolderKind {
  id: KindId
  count: number
  bytes: number
  /** The files Forge can convert; empty for a kind it cannot. */
  sources: SourceInfo[]
  /** Why nothing of this kind is converted; absent for a kind Forge converts. */
  why?: string
}

export interface FolderScan {
  dir: string
  sources: SourceInfo[]
  /** Files whose name says a format Forge reads, which then would not open. */
  failures: InputFailure[]
  kinds: FolderKind[]
  /** Every file in it together, converted or not. */
  bytes: number
  /** Every file it looked at: what was there before watching began. */
  paths: string[]
}

/** What a kind is converted with: the target, then its own setting. */
export interface KindAnswer {
  target: FormatId
  /** Lossy targets only. */
  quality?: number
  /** A PDF rendered to an image only. */
  dpi?: number
}

/** A file not to read yet or at all: hidden, a temp file, an unfinished download. */
export function isIgnoredName(name: string): boolean {
  return name.startsWith('.') || /\.(crdownload|part|download|tmp)$/i.test(name)
}

/** The kind a probed file belongs to. */
export function kindOf(source: SourceInfo): KindId {
  if (source.kind === 'image') return 'images'
  return source.format === 'pdf' ? 'pdfs' : 'documents'
}

const READ_EXTENSIONS = new Set(Object.values(FORMATS).flatMap((f) => f.extensions))

/** A media file Forge cannot read yet, told apart by its first bytes, never its name. */
export type Sniffed = 'video' | 'audio' | 'text' | 'other'

export async function sniffKind(path: string): Promise<Sniffed> {
  const handle = await open(path, 'r')
  const head = Buffer.alloc(4096)
  let n = 0
  try {
    n = (await handle.read(head, 0, head.length, 0)).bytesRead
  } finally {
    await handle.close()
  }
  const b = head.subarray(0, n)
  const ascii = (at: number, len: number) => b.subarray(at, at + len).toString('latin1')
  if (ascii(4, 4) === 'ftyp') return /^(M4A |M4B |M4P )$/.test(ascii(8, 4)) ? 'audio' : 'video'
  if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return 'video'
  if (ascii(0, 4) === 'RIFF')
    return ascii(8, 4) === 'WAVE' ? 'audio' : ascii(8, 3) === 'AVI' ? 'video' : 'other'
  if (b[0] === 0 && b[1] === 0 && b[2] === 1 && (b[3] === 0xba || b[3] === 0xb3)) return 'video'
  if (ascii(0, 3) === 'ID3' || ascii(0, 4) === 'fLaC' || ascii(0, 4) === 'OggS') return 'audio'
  if (ascii(0, 4) === 'FORM' && /^AIF[FC]$/.test(ascii(8, 4))) return 'audio'
  if (b[0] === 0xff && b[1] !== undefined && (b[1] & 0xe0) === 0xe0) return 'audio'
  if (n > 0 && !b.includes(0) && isUtf8(b)) return 'text'
  return 'other'
}

/** Whether `b` reads as UTF-8, allowing a character cut off by the end of the read. */
function isUtf8(b: Buffer): boolean {
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(b, { stream: true })
    return true
  } catch {
    return false
  }
}

const KIND_ORDER: KindId[] = ['images', 'pdfs', 'documents', 'videos', 'audio', 'other']

/** Why a kind of file is not converted, as its row says it. */
function whyNot(id: KindId, sniffed: Sniffed[]): string | undefined {
  if (id === 'videos' || id === 'audio') return 'not yet supported'
  if (id !== 'other') return undefined
  if (sniffed.every((s) => s === 'text')) return sniffed.length === 1 ? 'a text file' : 'text files'
  return 'not supported'
}

export async function scanFolder(dir: string): Promise<FolderScan> {
  const abs = resolve(dir)
  const entries = await readdir(abs, { withFileTypes: true })
  const sources: SourceInfo[] = []
  const failures: InputFailure[] = []
  const unread = new Map<KindId, { bytes: number; sniffed: Sniffed[] }>()
  const paths: string[] = []
  let bytes = 0
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isFile() || isIgnoredName(entry.name)) continue
    const path = join(abs, entry.name)
    paths.push(path)
    const read = await readFolderFile(path)
    if (read.kind === 'source') {
      sources.push(read.source)
      bytes += read.source.bytes
    } else if (read.kind === 'failed') {
      failures.push(read.failure)
      bytes += read.bytes
    } else {
      const id = read.kind
      const held = unread.get(id) ?? { bytes: 0, sniffed: [] }
      held.bytes += read.bytes
      held.sniffed.push(read.sniffed)
      unread.set(id, held)
      bytes += read.bytes
    }
  }
  const kinds = kindsOf(sources)
  for (const id of KIND_ORDER) {
    const held = unread.get(id)
    if (!held) continue
    const why = whyNot(id, held.sniffed)
    kinds.push({
      id,
      count: held.sniffed.length,
      bytes: held.bytes,
      sources: [],
      ...(why === undefined ? {} : { why }),
    })
  }
  return { dir: abs, sources, failures, kinds, bytes, paths }
}

/** The kinds Forge converts, the largest first. */
function kindsOf(sources: SourceInfo[]): FolderKind[] {
  const kinds: FolderKind[] = []
  for (const id of KIND_ORDER) {
    const of = sources.filter((s) => kindOf(s) === id)
    if (of.length > 0) {
      kinds.push({ id, count: of.length, bytes: of.reduce((n, s) => n + s.bytes, 0), sources: of })
    }
  }
  return kinds.sort((a, b) => b.count - a.count)
}

/**
 * Several files dropped together, read as a folder is read: grouped into
 * kinds, so the steps ask once per kind. Not a folder: `dir` is empty, and
 * nothing is watched. Video and sound go one at a time, so they are a kind
 * of their own that the batch leaves alone.
 */
export function scanOfFiles(sources: SourceInfo[], failures: InputFailure[] = []): FolderScan {
  const media = sources.filter((s) => s.kind === 'media')
  const read = sources.filter((s) => s.kind !== 'media')
  const kinds = kindsOf(read)
  for (const id of ['videos', 'audio'] as const) {
    const of = media.filter((s) => (FORMATS[s.format].media === 'video') === (id === 'videos'))
    if (of.length > 0) {
      const bytes = of.reduce((n, s) => n + s.bytes, 0)
      kinds.push({ id, count: of.length, bytes, sources: [], why: 'one at a time' })
    }
  }
  return {
    dir: '',
    sources: read,
    failures,
    kinds,
    bytes: sources.reduce((n, s) => n + s.bytes, 0),
    paths: sources.map((s) => s.path),
  }
}

export type FolderFileRead =
  | { kind: 'source'; source: SourceInfo }
  | { kind: 'failed'; failure: InputFailure; bytes: number }
  | { kind: 'videos' | 'audio' | 'other'; sniffed: Sniffed; bytes: number }

/**
 * One file of a folder, read the way the scan reads it: probed by content;
 * a file Forge cannot read is sniffed for what it is instead. Only a file
 * whose name claims a format Forge reads, and which then would not open, is
 * a failure — the name is used to word the outcome, never to decide the format.
 */
export async function readFolderFile(path: string): Promise<FolderFileRead> {
  const size = () =>
    stat(path).then(
      (s) => s.size,
      () => 0,
    )
  try {
    const source = await probe(path)
    // Video and sound convert one file at a time; a folder of them is not
    // offered yet (video spec §4), so they stay their own kind, left alone.
    if (source.kind === 'media') {
      const video = FORMATS[source.format].media === 'video'
      return {
        kind: video ? 'videos' : 'audio',
        sniffed: video ? 'video' : 'audio',
        bytes: source.bytes,
      }
    }
    return { kind: 'source', source }
  } catch (e) {
    const bytes = await size()
    const sniffed = await sniffKind(path).catch((): Sniffed => 'other')
    if (sniffed === 'video' || sniffed === 'audio') {
      return { kind: sniffed === 'video' ? 'videos' : 'audio', sniffed, bytes }
    }
    if (READ_EXTENSIONS.has(extname(path).toLowerCase())) {
      const error = isForgeError(e) ? e : undefined
      if (error) return { kind: 'failed', failure: { path, error }, bytes }
    }
    return { kind: 'other', sniffed, bytes }
  }
}

/**
 * Every format some file of the kind can become, in the formats' own order.
 * The union, not the intersection: a folder that already holds WebPs must
 * still offer WebP for its JPEGs; the WebPs are left alone as "already WebP".
 */
export function kindTargets(sources: SourceInfo[]): FormatId[] {
  const can = new Set(sources.flatMap((s) => targetIdsFor(s).filter((t) => t !== s.format)))
  return (Object.keys(FORMATS) as FormatId[]).filter((id) => can.has(id))
}

/** The answer a kind starts with: WebP for images, PNG at 150 dpi for PDFs, else the first. */
export function defaultAnswer(sources: SourceInfo[], quality: number): KindAnswer | undefined {
  const targets = kindTargets(sources)
  const first = sources[0]
  const preferred: FormatId | undefined =
    first?.kind === 'image' ? 'webp' : first?.format === 'pdf' ? 'png' : undefined
  const target = preferred && targets.includes(preferred) ? preferred : targets[0]
  if (!target) return undefined
  return answerFor(sources, target, quality)
}

/** The answer for `target`, with the setting that target asks for at its default. */
export function answerFor(sources: SourceInfo[], target: FormatId, quality: number): KindAnswer {
  const answer: KindAnswer = { target }
  if (FORMATS[target].lossy) answer.quality = quality
  if (
    sources.some((s) => s.kind === 'document' && s.format === 'pdf') &&
    (target === 'png' || target === 'jpeg')
  ) {
    answer.dpi = 150
  }
  return answer
}
