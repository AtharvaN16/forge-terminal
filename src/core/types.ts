export type FormatId = 'jpeg' | 'png' | 'webp' | 'avif' | 'heic' | 'gif' | 'tiff' | 'pdf'

export interface FormatSpec {
  id: FormatId
  /** Human-facing name, e.g. "WebP". */
  label: string
  /** Primary extension first. */
  extensions: string[]
  hasAlpha: boolean
  animatable: boolean
  /** Drives whether the quality option applies. */
  lossy: boolean
  /** One short phrase shown beside the format in a picker. */
  hint: string
}

/** What a file actually is, determined by reading it — never by its extension. */
export interface ImageInfo {
  kind: 'image'
  path: string
  format: FormatId
  bytes: number
  width: number
  height: number
  hasAlpha: boolean
  /** 1 for a still image, >1 for an animation. */
  frames: number
}

/** A paged document. Pages are what it has instead of pixels. */
export interface DocumentInfo {
  kind: 'document'
  path: string
  format: FormatId
  bytes: number
  pages: number
  /** True when the file is password-protected. Probing never prompts. */
  encrypted: boolean
}

export type SourceInfo = ImageInfo | DocumentInfo

export interface ConvertOptions {
  /** 1-100. Ignored for lossless targets. */
  quality?: number
  /** CSS colour used when flattening alpha into a format that cannot carry it. */
  background: string
  keepMetadata: boolean
}

export interface Job {
  source: SourceInfo
  target: FormatId
  output: string
  options: ConvertOptions
}

export interface Warning {
  code: 'animation-flattened'
  message: string
}

export interface Result {
  job: Job
  outputBytes: number
  warnings: Warning[]
}

export type Phase = 'reading' | 'decoding' | 'encoding' | 'writing'
