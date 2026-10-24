/**
 * Which probed files transcribe reads the text of (spec
 * 2026-10-23-extract-text-design §3, §5.4): a picture or a PDF, by what
 * Forge's own probe found in the bytes (invariant 3). Pure.
 */
import { encryptedSource, untranscribable } from '../errors.js'
import type { FormatId, SourceInfo } from '../types.js'

export type PageSource =
  | { what: 'image'; path: string; format: FormatId; bytes: number; width: number; height: number }
  | { what: 'pdf'; path: string; bytes: number; pages: number }

/**
 * The picture or PDF to read, or undefined for video and sound, which the
 * speech recogniser takes. A locked PDF and a Word document are refused.
 */
export function pageSource(info: SourceInfo): PageSource | undefined {
  if (info.kind === 'media') return undefined
  if (info.kind === 'image') {
    const { path, format, bytes, width, height } = info
    return { what: 'image', path, format, bytes, width, height }
  }
  if (info.format !== 'pdf') throw untranscribable(info.path)
  if (info.encrypted) throw encryptedSource(info.path)
  return { what: 'pdf', path: info.path, bytes: info.bytes, pages: info.pages }
}
