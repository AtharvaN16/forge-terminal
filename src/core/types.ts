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
  /**
   * Quality Forge encodes at when the user has not chosen one. Present only
   * for lossy formats. Lives here rather than in an engine because more than
   * one engine encodes to these formats and they must not disagree.
   */
  defaultQuality?: number
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
  /**
   * What the document holds that `/compress` could act on, counted at probe
   * time so the flow can refuse before promising anything.
   *
   * `compressible` and `skipped` are deliberately separate: "this PDF has no
   * images" and "this PDF's images are a kind Forge cannot re-encode" are
   * different answers, and collapsing them into one number would force a
   * message that is wrong for one of the two.
   */
  images?: { compressible: number; skipped: number }
}

export type SourceInfo = ImageInfo | DocumentInfo

export interface ConvertOptions {
  /** 1-100. Ignored for lossless targets. */
  quality?: number
  /** CSS colour used when flattening alpha into a format that cannot carry it. */
  background: string
  keepMetadata: boolean
  /** Rasterisation resolution, relative to 72dpi (`scale = dpi / 72`). 36-600. Only meaningful for a PDF source. */
  dpi?: number
  /** 0-based page indices, ascending and deduped by `core/pages.ts`'s `normalisePages`. Only meaningful for a PDF source. */
  pages?: number[]
  /**
   * For an ENCRYPTED source only. Never logged, never returned, never
   * attached to an error (invariant 8). There is no `--password` flag; this
   * arrives from a prompt or `--password-stdin`.
   */
  password?: string
}

/**
 * One unit of work.
 *
 * A union rather than a widened `{sources[], outputs[]}` because arity is part
 * of what each operation means: only `merge` takes several sources, only
 * `split` and `extract` produce several outputs. Tuple types make that a
 * compile error rather than a convention.
 *
 * `convert`'s `outputs` is `[string, ...string[]]` rather than a plain
 * `string[]` so every existing single-output caller (`job.outputs[0]`) keeps
 * a `string`, never a `string | undefined`, under `noUncheckedIndexedAccess`.
 * A convert job stays exactly one *source* — a multi-page PDF rasterisation
 * is one PDF in, many images out, not several sources — but can produce many
 * *outputs* when that source is a paged document: `pdfium.ts` writes
 * `outputs[i]` from `options.pages[i]`, one file per selected page.
 *
 * `cuts` are 0-based indices of the page *after which* a cut falls. `pages`
 * are 0-based page indices. Both are 1-based only in what the user sees.
 */
export type Job =
  | {
      op: 'convert'
      sources: [SourceInfo]
      outputs: [string, ...string[]]
      target: FormatId
      options: ConvertOptions
    }
  | { op: 'merge'; sources: SourceInfo[]; outputs: [string] }
  | { op: 'split'; sources: [DocumentInfo]; outputs: string[]; cuts: number[] }
  | {
      op: 'extract'
      sources: [DocumentInfo]
      outputs: string[]
      pages: number[]
      separate: boolean
    }
  | { op: 'delete'; sources: [DocumentInfo]; outputs: [string]; pages: number[] }
  | { op: 'rotate'; sources: [DocumentInfo]; outputs: [string]; turns: 1 | 2 | 3 }

export interface Warning {
  code:
    | 'animation-flattened'
    /** A PDF held nothing this could re-encode, so its size barely moved. */
    | 'pdf-no-images'
    /** Some images were re-encoded and some were left alone. */
    | 'pdf-images-skipped'
  message: string
}

export interface Result {
  job: Job
  outputBytes: number
  warnings: Warning[]
}

/**
 * Where a job has got to.
 *
 * The `page` variant may only be emitted where the total is genuinely known
 * in advance. Spec §12 forbids fabricated progress, and a page count is real.
 */
export type Progress =
  | { phase: 'reading' | 'decoding' | 'encoding' | 'writing' }
  | { phase: 'page'; done: number; total: number }

/** Kept as an alias so existing render code compiles — it is now Progress's first variant. */
export type Phase = 'reading' | 'decoding' | 'encoding' | 'writing'
