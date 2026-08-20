import { readFile, rm, stat } from 'node:fs/promises'
import { basename } from 'node:path'
import { degrees, PDFDocument } from 'pdf-lib'
import sharp from 'sharp'
import { writeAtomic } from '../core/atomic.js'
import { emptySelection, encryptedSource } from '../core/errors.js'
import { FORMATS } from '../core/formats.js'
import { cutsToRanges, normalisePages } from '../core/pages.js'
import type {
  DocumentInfo,
  FormatId,
  ImageInfo,
  Job,
  Progress,
  Result,
  Warning,
} from '../core/types.js'
import type { Engine } from './types.js'

const READS: ReadonlySet<FormatId> = new Set<FormatId>([
  'pdf',
  'jpeg',
  'png',
  'webp',
  'avif',
  'gif',
  'tiff',
])
const WRITES: ReadonlySet<FormatId> = new Set<FormatId>(['pdf'])

/**
 * Load a document for inspection.
 *
 * `ignoreEncryption` is deliberate: an encrypted PDF must probe successfully
 * and report `encrypted: true`, so the flow can refuse it with a message that
 * names the fix. Failing here instead would surface as "not a format Forge
 * reads", which is both wrong and unactionable.
 */
async function load(path: string): Promise<PDFDocument> {
  return PDFDocument.load(await readFile(path), { ignoreEncryption: true })
}

async function probe(path: string): Promise<DocumentInfo> {
  const doc = await load(path)
  const { size } = await stat(path)
  return {
    kind: 'document',
    path,
    format: 'pdf',
    bytes: size,
    pages: doc.getPageCount(),
    encrypted: doc.isEncrypted,
  }
}

/**
 * Refuses a password-protected source before any page operation touches it.
 * `probe` reports `encrypted` with `ignoreEncryption: true`, so this is the
 * one place that turns "known to be locked" into a refusal that names the
 * fix, rather than letting pdf-lib fail opaquely partway through a merge,
 * split, extract, delete or rotate.
 */
function assertUnencrypted(sources: readonly { path: string; encrypted?: boolean }[]): void {
  for (const s of sources) {
    if (s.encrypted) throw encryptedSource(s.path)
  }
}

/**
 * pdf-lib embeds JPEG and PNG and nothing else. Anything else is decoded to
 * PNG first, the same two-step `heic.ts` uses — one extra decode, no new
 * dependency, and the alternative is refusing formats the capability graph
 * has already offered.
 *
 * Invariant 4: `.rotate()` before anything else. pdf-lib does not read EXIF
 * orientation itself, so embedding raw JPEG/PNG bytes unconditionally would
 * ship every phone photo sideways — the exact bug `image.ts`'s Rule 1 exists
 * to prevent, reintroduced here in a new file.
 *
 * The fix is deliberately not "always decode through Sharp": that would cost
 * every JPEG a lossy re-encode generation (and PNG a size change) to correct
 * a minority of files. Instead only a source that genuinely carries a
 * non-trivial orientation tag pays for the decode. When it does, the result
 * is re-encoded as PNG rather than back to JPEG — this is a forced
 * intermediate the user never agreed to lose quality on twice, the same
 * reasoning `heic.ts` gives for decoding to PNG rather than JPEG.
 *
 * Every other source format was already being decoded through Sharp to
 * become PNG regardless, so folding `.rotate()` into that same call is free
 * — `.rotate()` with no arguments is sharp's EXIF auto-orient and is a
 * no-op when there is no orientation to apply.
 */
async function embedBytes(doc: PDFDocument, source: ImageInfo, raw: Buffer) {
  const embeddable = source.format === 'jpeg' || source.format === 'png'
  const orientation = embeddable ? (await sharp(raw).metadata()).orientation : undefined

  if (embeddable && (orientation === undefined || orientation === 1)) {
    return source.format === 'jpeg' ? doc.embedJpg(raw) : doc.embedPng(raw)
  }

  return doc.embedPng(await sharp(raw).rotate().png().toBuffer())
}

/**
 * One page, sized to the image, holding the whole image at its native
 * resolution — the inbound half of phase 4a. `outputs`/`sources` are single
 * because `convert` is defined that way (see `core/types.ts`); a multi-image
 * PDF is a `merge` of several single-image PDFs, not a variant of this.
 *
 * `job.options` (background, keepMetadata) is accepted by the job shape but
 * never consulted here: `embedPng`'s SMask already carries alpha, so there
 * is nothing to flatten (unlike `image.ts`'s Rule 2), and pdf-lib strips
 * source metadata by construction, so "keep metadata" has nothing to act on.
 */
async function imageToPdf(
  job: Extract<Job, { op: 'convert' }>,
  onPhase: (p: Progress) => void,
): Promise<Result> {
  const source = job.sources[0]
  // Same reasoning as `image.ts`'s analogous guard: the registry routes a
  // job to this engine by `reads`/`writes`, but `pdf` is offered as a
  // same-format target for a PDF source the way any format is offered for
  // itself (recompression) — and unlike an image, a PDF source has no
  // pixels to embed. Without this, it reaches `embedBytes` and fails as an
  // opaque Sharp decode error instead of a named one.
  if (source.kind !== 'image') {
    throw new Error('the pdf engine cannot embed a document source')
  }

  const warnings: Warning[] = []
  // Rule 4 (spec): never drop frames silently. A PDF page has no concept of
  // animation, so any source with more than one frame loses everything past
  // the first — the same warning `image.ts` raises for a lossless target
  // that cannot animate either, reusing its code rather than inventing one.
  if (source.frames > 1) {
    warnings.push({
      code: 'animation-flattened',
      message:
        `${basename(source.path)} has ${source.frames} frames, and ` +
        `${FORMATS.pdf.label} cannot animate. Only the first frame was converted.`,
    })
  }

  onPhase({ phase: 'reading' })
  const raw = await readFile(source.path)

  onPhase({ phase: 'encoding' })
  const doc = await PDFDocument.create()
  const embedded = await embedBytes(doc, source, raw)
  const page = doc.addPage([embedded.width, embedded.height])
  page.drawImage(embedded, { x: 0, y: 0, width: embedded.width, height: embedded.height })

  onPhase({ phase: 'writing' })
  const outputBytes = await writeAtomic(job.outputs[0], await doc.save())
  return { job, outputBytes, warnings }
}

async function merge(
  job: Extract<Job, { op: 'merge' }>,
  onPhase: (p: Progress) => void,
): Promise<Result> {
  assertUnencrypted(job.sources.filter((s) => s.kind === 'document'))
  const out = await PDFDocument.create()

  for (const source of job.sources) {
    onPhase({ phase: 'reading' })
    const src = await load(source.path)
    const pages = await out.copyPages(src, src.getPageIndices())
    for (const page of pages) out.addPage(page)
  }

  onPhase({ phase: 'writing' })
  const bytes = await out.save()
  const outputBytes = await writeAtomic(job.outputs[0], bytes)
  return { job, outputBytes, warnings: [] }
}

/**
 * `cutsToRanges` silently normalises its input (dedupes, sorts, drops
 * out-of-range cuts) rather than validating it, so a `cuts` list that arrived
 * unsorted or with duplicates still produces a correct partition here.
 *
 * Every output is written before any is kept. A split that fails half way
 * through must not leave a folder of partial results (invariant 6).
 */
async function split(
  job: Extract<Job, { op: 'split' }>,
  onPhase: (p: Progress) => void,
): Promise<Result> {
  const source = job.sources[0]
  assertUnencrypted([source])

  onPhase({ phase: 'reading' })
  const src = await load(source.path)
  const ranges = cutsToRanges(job.cuts, src.getPageCount())

  const written: string[] = []
  let outputBytes = 0
  try {
    for (const [i, range] of ranges.entries()) {
      const out = await PDFDocument.create()
      const indices = Array.from({ length: range.to - range.from + 1 }, (_, n) => range.from + n)
      const pages = await out.copyPages(src, indices)
      for (const page of pages) out.addPage(page)

      const path = job.outputs[i]
      if (path === undefined) {
        throw new Error(
          `split produced ${ranges.length} parts but was given ${job.outputs.length} outputs`,
        )
      }
      outputBytes += await writeAtomic(path, await out.save())
      written.push(path)
      onPhase({ phase: 'page', done: i + 1, total: ranges.length })
    }
  } catch (e) {
    await Promise.all(written.map((p) => rm(p, { force: true })))
    throw e
  }

  return { job, outputBytes, warnings: [] }
}

/** Copy an explicit page list into a new document, in the order given. */
async function pagesInto(src: PDFDocument, indices: number[]): Promise<Uint8Array> {
  const out = await PDFDocument.create()
  const pages = await out.copyPages(src, indices)
  for (const page of pages) out.addPage(page)
  return out.save()
}

async function extract(
  job: Extract<Job, { op: 'extract' }>,
  onPhase: (p: Progress) => void,
): Promise<Result> {
  const source = job.sources[0]
  assertUnencrypted([source])
  if (job.pages.length === 0) {
    throw emptySelection('That extract selects no pages.')
  }

  onPhase({ phase: 'reading' })
  const src = await load(source.path)
  // The same function `extractAction.plan` names the outputs from, so
  // `outputs[i]` is always the file named for `wanted[i]` (see
  // `core/pages.ts`'s `normalisePages`).
  const wanted = normalisePages(job.pages)

  const written: string[] = []
  let outputBytes = 0
  try {
    if (!job.separate) {
      onPhase({ phase: 'writing' })
      const path = job.outputs[0] as string
      outputBytes = await writeAtomic(path, await pagesInto(src, wanted))
      written.push(path)
    } else {
      for (const [i, page] of wanted.entries()) {
        const path = job.outputs[i] as string
        outputBytes += await writeAtomic(path, await pagesInto(src, [page]))
        written.push(path)
        onPhase({ phase: 'page', done: i + 1, total: wanted.length })
      }
    }
  } catch (e) {
    await Promise.all(written.map((p) => rm(p, { force: true })))
    throw e
  }

  return { job, outputBytes, warnings: [] }
}

/**
 * Exact inverse of `extract`: the kept set is everything not in `job.pages`.
 * Refuses to write an empty document, the same way `extract` refuses an
 * empty selection — deleting every page is the delete-side of that case.
 */
async function deletePages(
  job: Extract<Job, { op: 'delete' }>,
  onPhase: (p: Progress) => void,
): Promise<Result> {
  const source = job.sources[0]
  assertUnencrypted([source])

  onPhase({ phase: 'reading' })
  const src = await load(source.path)
  const drop = new Set(job.pages)
  const keep = src.getPageIndices().filter((i) => !drop.has(i))
  if (keep.length === 0) {
    throw emptySelection('That would delete every page.')
  }

  onPhase({ phase: 'writing' })
  const outputBytes = await writeAtomic(job.outputs[0], await pagesInto(src, keep))
  return { job, outputBytes, warnings: [] }
}

/**
 * Rotation is *additive*.
 *
 * A page already at 90° rotated by another quarter turn must land at 180°.
 * Setting the angle absolutely would silently discard a rotation the
 * document already carried — the same class of bug as ignoring EXIF
 * orientation, which this project treats as load-bearing (invariant 4).
 */
async function rotate(
  job: Extract<Job, { op: 'rotate' }>,
  onPhase: (p: Progress) => void,
): Promise<Result> {
  const source = job.sources[0]
  assertUnencrypted([source])

  onPhase({ phase: 'reading' })
  const doc = await load(source.path)
  for (const page of doc.getPages()) {
    // Twice-modulo, because JS `%` keeps the sign: a page stored at -270
    // rotated by a quarter turn would otherwise land at -180. Every value is
    // right modulo 360 and viewers render either correctly, which is exactly
    // why spec §6 pins the stored form to 0–270 rather than trusting it.
    const turned = page.getRotation().angle + job.turns * 90
    const next = ((turned % 360) + 360) % 360
    page.setRotation(degrees(next))
  }

  onPhase({ phase: 'writing' })
  const outputBytes = await writeAtomic(job.outputs[0], await doc.save())
  return { job, outputBytes, warnings: [] }
}

export const pdfEngine: Engine = {
  id: 'pdf',
  reads: READS,
  writes: WRITES,
  ops: new Set<Job['op']>(['convert', 'merge', 'split', 'extract', 'delete', 'rotate']),
  probe,
  async run(job: Job, onPhase: (p: Progress) => void): Promise<Result> {
    switch (job.op) {
      case 'convert':
        if (job.target !== 'pdf') throw new Error('the pdf engine only converts to pdf')
        return imageToPdf(job, onPhase)
      case 'merge':
        return merge(job, onPhase)
      case 'split':
        return split(job, onPhase)
      case 'extract':
        return extract(job, onPhase)
      case 'delete':
        return deletePages(job, onPhase)
      case 'rotate':
        return rotate(job, onPhase)
    }
  },
}
