import { existsSync } from 'node:fs'
import { open, readdir, stat } from 'node:fs/promises'
import { extname, join, resolve } from 'node:path'
import { probe } from '../engines/registry.js'
import { convertAction } from './actions/convert.js'
import { targetIdsFor } from './capabilities.js'
import { isForgeError } from './errors.js'
import { FORMATS } from './formats.js'
import type { InputFailure } from './resolve.js'
import type { FormatId, Job, SourceInfo } from './types.js'

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
  const kinds: FolderKind[] = []
  for (const id of KIND_ORDER) {
    const of = sources.filter((s) => kindOf(s) === id)
    if (of.length > 0) {
      kinds.push({ id, count: of.length, bytes: of.reduce((n, s) => n + s.bytes, 0), sources: of })
    }
  }
  // The kinds Forge converts first, the largest first; then the rest, as found.
  kinds.sort((a, b) => b.count - a.count)
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

/**
 * One folder file's job, or why it is left alone. `claimed` holds the
 * outputs this run has already planned, so two files that would take one
 * name keep both (`hero (1).webp`) — nobody is there to ask. A file whose
 * output is already on disk was converted before (the folder dropped
 * again), and is left alone rather than converted twice.
 */
export function planFolderFile(
  source: SourceInfo,
  answer: KindAnswer,
  claimed: Set<string>,
  destination?: string,
): { job: Job } | { left: string } {
  if (source.format === answer.target) return { left: `already ${FORMATS[answer.target].label}` }
  if (!targetIdsFor(source).includes(answer.target)) {
    return { left: `can’t become ${FORMATS[answer.target].label}` }
  }
  const [job] = convertAction.plan([source], {
    target: answer.target,
    ...(answer.quality === undefined ? {} : { quality: answer.quality }),
    ...(answer.dpi === undefined ? {} : { dpi: String(answer.dpi) }),
    pages: 'all',
    ...(destination === undefined ? {} : { destination }),
  })
  if (job?.op !== 'convert') return { left: 'not supported' }
  if (job.outputs.some((o) => existsSync(o) && !claimed.has(o)))
    return { left: 'already converted' }
  job.outputs = job.outputs.map((o) => keepBoth(o, claimed)) as typeof job.outputs
  for (const o of job.outputs) claimed.add(o)
  return { job }
}

/** `o`, or `o` numbered (`hero (1).webp`) past every name this run or the disk already holds. */
function keepBoth(o: string, claimed: Set<string>): string {
  if (!claimed.has(o)) return o
  const ext = extname(o)
  const stem = o.slice(0, o.length - ext.length)
  for (let n = 1; ; n++) {
    const candidate = `${stem} (${n})${ext}`
    if (!claimed.has(candidate) && !existsSync(candidate)) return candidate
  }
}
