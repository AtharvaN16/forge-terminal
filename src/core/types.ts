export type FormatId =
  | 'jpeg'
  | 'png'
  | 'webp'
  | 'avif'
  | 'heic'
  // Camera RAW, every maker's: read on macOS, never written.
  | 'raw'
  | 'gif'
  | 'tiff'
  | 'pdf'
  | 'docx'
  | 'doc'
  // Video (video spec §2). `hevc` is a codec written into an .mp4; never a source.
  | 'mp4'
  | 'mov'
  | 'hevc'
  | 'webm'
  | 'mkv'
  | 'avi'
  // Sound.
  | 'mp3'
  | 'm4a'
  | 'opus'
  | 'flac'
  | 'aiff'
  | 'wav'
  | 'ogg'

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
  /**
   * Lossless as `/convert` writes it, but `/compress` may cut it to a palette
   * of at most 256 colours, and an animation's frames may differ a little
   * from what they were. PNG and GIF.
   */
  quantisable?: true
  /**
   * What a video or sound format holds, which groups it in the picker:
   * `video` (pictures, perhaps sound) or `sound` (sound only).
   */
  media?: 'video' | 'sound'
  /**
   * Written only so a file can keep its own format (compress, trim); never
   * offered as something else's target. MOV, Matroska.
   */
  keepsOnly?: true
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
  images?: {
    compressible: number
    skipped: number
    /** Highest resolution any compressible image is drawn at, when measurable. */
    maxDpi?: number
  }
}

export interface VideoFacts {
  codec: string
  /** Upright pixels: a phone video stored sideways reports its real shape. */
  width: number
  height: number
  fps: number
  /** Degrees clockwise to show it upright: 0, 90, 180 or 270. */
  rotation: number
  /** HLG or PQ: needs tone-mapping for a format that can't carry it. */
  hdr: boolean
}

export interface AudioFacts {
  codec: string
  channels: number
  sampleRate: number
}

export interface MediaFacts {
  /** Seconds. */
  duration: number
  /** Absent for a sound file (cover art does not count). */
  video?: VideoFacts
  /** Absent for a silent video. */
  audio?: AudioFacts
}

/**
 * A video or a sound file. `facts` is what ffprobe read; absent until ffmpeg
 * is on this Mac, when only the bytes say what the file is.
 */
export interface MediaInfo {
  kind: 'media'
  path: string
  format: FormatId
  bytes: number
  facts?: MediaFacts
}

export type SourceInfo = ImageInfo | DocumentInfo | MediaInfo

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
  /** Trim transparent or solid-colour edges, after EXIF rotation. */
  trim?: boolean
  /** The output size, of the upright (and trimmed or cropped) image. */
  resize?: ResizeSpec
  /** Cut to a shape, after EXIF rotation and before any resize. Never with `trim`. */
  crop?: CropSpec
  /** Clockwise quarter turns, after the crop and resize. Never on an animation. */
  rotate?: Turn
  /**
   * Set by `/compress`. The result must come out smaller than the source, or
   * nothing is written. A quantisable format (PNG, GIF) is cut to a palette
   * at `quality`, in flat colours unless `dither`.
   */
  compress?: { dither: boolean }
  /** Video and sound only. */
  media?: MediaOptions
}

/** Rotate's three turns, in degrees clockwise: 90 is to the right, 270 to the left. */
export type Turn = 90 | 180 | 270

/** A shape as a ratio of two whole numbers: 16:9 is `{ w: 16, h: 9 }`. */
export interface Aspect {
  w: number
  h: number
}

/** A crop rectangle in upright pixels (after EXIF rotation). */
export interface Box {
  left: number
  top: number
  width: number
  height: number
}

/** Crop to shape: the shape, and where. No `box` → the engine places the largest box by attention. */
export interface CropSpec {
  aspect: Aspect
  box?: Box
}

/** How big Resize makes the image: a percentage of its size, or one exact side (the other follows). */
export type ResizeSpec = { percent: number } | { width: number } | { height: number }

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
  /**
   * The two extension jobs (spec §5). Both take one image and write one file
   * in `target`; the extension itself only ever sees and writes PNG.
   */
  | {
      op: 'boost'
      sources: [ImageInfo]
      outputs: [string]
      /** 1 is Sharpen: the model at the source's own size. */
      scale: 1 | 2 | 3 | 4
      target: FormatId
      options: ConvertOptions
    }
  | {
      op: 'remove-background'
      sources: [ImageInfo]
      outputs: [string]
      target: FormatId
      options: ConvertOptions
    }

/**
 * What `/edit` and the CLI-only flags ask of a video or sound file (video
 * spec §2, §3.4). Everything else about the encode is Forge's choice.
 */
export interface MediaOptions {
  /** Seconds kept: from `start` to `end` (the end of the file when absent). */
  cut?: { start: number; end?: number | undefined }
  /** The sound taken out; the picture copied as it is. */
  mute?: boolean
  /** CLI only. 0.25–4. */
  speed?: number
  /** CLI only. */
  fps?: number
  /** CLI only, kbps: the sound's bitrate. Also sound convert's quality. */
  bitrate?: number
  /** Loudness evened out to this, in LUFS (−16 for podcasts). */
  loudness?: number
  /**
   * The bytes to fit, set by `runPlan` once the engine's arithmetic says it
   * can be reached (video spec §3.3). The encode hits it in two passes.
   */
  targetBytes?: number
}

/**
 * Every warning's stable identifier. --json and the MCP server print it, so a
 * consumer can act on a warning without parsing its prose. A code is never
 * renamed or removed in a minor version (spec §3.2).
 */
export type WarningCode =
  | 'animation-flattened'
  /** A PDF held nothing this could re-encode, so its size barely moved. */
  | 'pdf-no-images'
  /** Some images were re-encoded and some were left alone. */
  | 'pdf-images-skipped'
  /** Image resolution was reduced, which is the loss worth naming. */
  | 'pdf-downsampled'
  /** The npm fallback ran instead of LibreOffice — tables, images and layout were not preserved. */
  | 'word-basic-fidelity'
  /** `forge config` could not read its settings file and fell back to defaults. */
  | 'config-unreadable'
  /** Trim found no empty edges, so only the resize was applied. */
  | 'nothing-trimmed'
  /** The image already had the crop's shape, so only the resize was applied. */
  | 'nothing-cropped'
  /** A cut copied rather than re-encoded starts on the keyframe at or before the asked start. */
  | 'media-cut-keyframe'
  /** A size was hit by making the picture smaller or the frame rate lower. */
  | 'media-fitted'

export interface Warning {
  code: WarningCode
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
  | { phase: Phase }
  | { phase: 'page'; done: number; total: number }
  /**
   * Seconds of the output encoded of the seconds it will have: a video's or a
   * sound file's true total (video spec §3.6). `pass` while a size is being
   * hit in two passes.
   */
  | { phase: 'time'; done: number; total: number; pass?: { at: 1 | 2; of: 2 } }

/**
 * Progress's first variant. `waiting`: queued behind another forge using the
 * same extension (its lock, extensions/lock.ts), nothing of this job begun.
 */
export type Phase = 'reading' | 'decoding' | 'waiting' | 'encoding' | 'writing'
