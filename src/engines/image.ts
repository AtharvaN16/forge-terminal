import { constants } from 'node:fs'
import { access, stat } from 'node:fs/promises'
import type { Metadata } from 'sharp'
import sharp from 'sharp'
import {
  corruptSource,
  fileNotFound,
  notAFile,
  permissionDenied,
  unsupportedSource,
} from '../core/errors.js'
import type { FormatId, Job, Phase, Result, SourceInfo } from '../core/types.js'
import type { Engine } from './types.js'

const READS: ReadonlySet<FormatId> = new Set<FormatId>([
  'jpeg',
  'png',
  'webp',
  'avif',
  'heic',
  'gif',
  'tiff',
])

/** heic is absent deliberately: sharp cannot encode HEVC. */
const WRITES: ReadonlySet<FormatId> = new Set<FormatId>([
  'jpeg',
  'png',
  'webp',
  'avif',
  'gif',
  'tiff',
])

const DIRECT: Record<string, FormatId> = {
  jpeg: 'jpeg',
  png: 'png',
  webp: 'webp',
  gif: 'gif',
  tiff: 'tiff',
}

/**
 * Sharp reports HEIC and AVIF with the same format string. The compression
 * field is the only thing separating them, and getting it wrong would offer
 * HEIC as a writable target — which fails at encode time.
 */
function identify(path: string, meta: Metadata): FormatId {
  if (meta.format === 'heif') return meta.compression === 'av1' ? 'avif' : 'heic'
  const id = DIRECT[meta.format ?? '']
  if (!id) throw unsupportedSource(path, meta.format ?? 'an unknown format')
  return id
}

async function probe(path: string): Promise<SourceInfo> {
  let stats: Awaited<ReturnType<typeof stat>>
  try {
    stats = await stat(path)
  } catch (cause) {
    const code = (cause as NodeJS.ErrnoException).code
    if (code === 'ENOENT') throw fileNotFound(path)
    if (code === 'EACCES' || code === 'EPERM') throw permissionDenied(path)
    throw cause
  }

  if (!stats.isFile()) throw notAFile(path)

  // Sharp gives an unreadable file the same message as a corrupt one and never
  // sets error.code, so readability has to be established before it is involved.
  try {
    await access(path, constants.R_OK)
  } catch {
    throw permissionDenied(path)
  }

  let meta: Metadata
  try {
    meta = await sharp(path).metadata()
  } catch (cause) {
    throw corruptSource(path, cause)
  }

  return {
    path,
    format: identify(path, meta),
    width: meta.width ?? 0,
    height: meta.height ?? 0,
    bytes: stats.size,
    hasAlpha: meta.hasAlpha ?? false,
    frames: meta.pages ?? 1,
  }
}

async function convert(_job: Job, _onPhase: (phase: Phase) => void): Promise<Result> {
  throw new Error('not implemented until Task 7')
}

export const imageEngine: Engine = {
  id: 'image',
  reads: READS,
  writes: WRITES,
  probe,
  convert,
}
