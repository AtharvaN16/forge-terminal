import { targetIdsFor } from './capabilities.js'
import type { FormatId, SourceInfo } from './types.js'

/** Below this the sentence is not worth the line it costs. */
const WORTH_SAYING = 0.25

/**
 * What to propose for a given source, and nothing for a source already there.
 *
 * WebP rather than AVIF for most sources on purpose: this is a suggestion
 * someone has to live with afterwards, and WebP is supported everywhere that
 * matters while AVIF still is not. A WebP source gets AVIF, because that is
 * the only step up left. An AVIF source gets nothing — there is no honest
 * sentence to write about converting AVIF to WebP.
 *
 * The naming here is a judgement about formats, not a capability list: the
 * candidate is checked against `targetIdsFor` before being returned, so a
 * format the engine cannot actually write is never proposed (invariant 2).
 */
export function candidateFor(source: SourceInfo): FormatId | undefined {
  if (source.format === 'avif') return undefined
  const wanted: FormatId = source.format === 'webp' ? 'avif' : 'webp'
  return targetIdsFor(source).includes(wanted) ? wanted : undefined
}

export interface Suggestion {
  target: FormatId
  bytes: number
  /** Fraction smaller than the result it is compared against, 0-1. */
  saving: number
}

/**
 * Whether another format would do meaningfully better, answered by encoding
 * one candidate and measuring it.
 *
 * `encode` is a parameter so this module stays free of Sharp, and so the
 * measurement is the caller's to make — but it *is* a measurement. Estimating
 * would mean quoting a number nobody computed, which is the same offence as
 * the fabricated progress spec §12 forbids.
 */
export async function suggestFormat(args: {
  source: SourceInfo
  resultBytes: number
  quality: number
  encode: (target: FormatId, quality: number) => Promise<number>
}): Promise<Suggestion | undefined> {
  const target = candidateFor(args.source)
  if (target === undefined) return undefined

  let bytes: number
  try {
    bytes = await args.encode(target, args.quality)
  } catch {
    // The conversion the user asked for has already succeeded. An extra
    // encode failing is not a reason to take that away from them.
    return undefined
  }

  const saving = (args.resultBytes - bytes) / args.resultBytes
  if (saving < WORTH_SAYING) return undefined

  return { target, bytes, saving }
}
