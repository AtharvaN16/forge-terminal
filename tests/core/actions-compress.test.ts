import { homedir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DEFAULT_PREFERENCES } from '../../src/config/preferences.js'
import { compressAction } from '../../src/core/actions/index.js'
import type { DocumentInfo, ImageInfo, SourceInfo } from '../../src/core/types.js'

const source = (over: Partial<ImageInfo> = {}): SourceInfo => ({
  kind: 'image',
  path: '/Users/me/Pictures/photo.jpg',
  format: 'jpeg',
  width: 4032,
  height: 3024,
  bytes: 4_400_000,
  hasAlpha: false,
  frames: 1,
  ...over,
})

const spec = (values: Record<string, unknown>, id: string) =>
  compressAction.options([source()], values, DEFAULT_PREFERENCES).find((s) => s.id === id)

describe('compress action', () => {
  it('applies to a lossy source, where quality is a dial that exists', () => {
    expect(compressAction.appliesTo([source({ format: 'jpeg' })])).toBe(true)
    expect(compressAction.appliesTo([source({ format: 'webp' })])).toBe(true)
  })

  it('does not apply to a lossless source — there is no quality to trade', () => {
    // Compressing a PNG by quality is not a thing the encoder can do;
    // formats.ts declares it lossless and image.ts encodes it losslessly on
    // purpose. Making a PNG smaller means changing its format.
    expect(compressAction.appliesTo([source({ format: 'png' })])).toBe(false)
    expect(compressAction.appliesTo([source({ format: 'tiff' })])).toBe(false)
  })

  it('asks how to compress before anything else', () => {
    const first = compressAction.options([source()], {}, DEFAULT_PREFERENCES)[0]
    expect(first?.id).toBe('mode')
    if (first?.kind !== 'select') throw new Error('expected a select')
    expect(first.choices.map((c) => c.value)).toEqual(['quality', 'size'])
  })

  it('offers a slider once quality is chosen', () => {
    const s = spec({ mode: 'quality' }, 'quality')
    if (s?.kind !== 'slider') throw new Error('expected a slider')
    expect(s.default).toBe(DEFAULT_PREFERENCES.quality)
    expect(s.min).toBe(1)
    expect(s.max).toBe(100)
  })

  it('offers a text field once target size is chosen', () => {
    const s = spec({ mode: 'size' }, 'size')
    if (s?.kind !== 'text') throw new Error('expected a text field')
    expect(s.placeholder.toLowerCase()).toContain('kb')
  })

  it('asks nothing further until a mode is chosen', () => {
    expect(compressAction.options([source()], {}, DEFAULT_PREFERENCES)).toHaveLength(1)
  })

  it('asks for a destination in both modes', () => {
    expect(spec({ mode: 'quality', quality: 70 }, 'destination')?.kind).toBe('path')
    expect(spec({ mode: 'size', size: '500kb' }, 'destination')?.kind).toBe('path')
  })

  it('plans a job in the same format as the source', () => {
    const [job] = compressAction.plan([source()], {
      mode: 'quality',
      quality: 60,
      destination: '/tmp/out',
    })
    if (job?.op !== 'convert') throw new Error('expected convert')
    expect(job.target).toBe('jpeg')
    expect(job.options.quality).toBe(60)
  })

  it('suffixes the output so it cannot collide with the input', () => {
    const [job] = compressAction.plan([source()], {
      mode: 'quality',
      quality: 60,
      destination: '/Users/me/Pictures',
    })
    // Same folder, same extension — without a suffix this is the input, and
    // buildPlan would refuse every run.
    expect(job?.outputs[0]).not.toBe(source().path)
    expect(job?.outputs[0]).toContain('photo-small')
    expect(job?.outputs[0]?.endsWith('.jpg')).toBe(true)
  })

  it('carries no quality when searching for a size — the search decides it', () => {
    const [job] = compressAction.plan([source()], {
      mode: 'size',
      size: '500kb',
      destination: '/tmp/out',
    })
    if (job?.op !== 'convert') throw new Error('expected convert')
    expect(job.options.quality).toBeUndefined()
  })

  it('preselects the configured default destination', () => {
    const s = spec({ mode: 'quality', quality: 70 }, 'destination')
    if (s?.kind !== 'path') throw new Error('expected a path')
    expect(s.default).toBe(join(homedir(), 'Desktop'))
  })

  it('rejects a plan with no usable mode rather than guessing', () => {
    expect(() => compressAction.plan([source()], { destination: '/tmp' })).toThrow()
  })
})

describe('/compress and PDFs', () => {
  const pdf = (images: { compressible: number; skipped: number }): DocumentInfo => ({
    kind: 'document',
    path: '/tmp/brochure.pdf',
    format: 'pdf',
    bytes: 1_400_000,
    pages: 7,
    encrypted: false,
    images,
  })

  it('accepts a PDF that has JPEG images to re-encode', () => {
    expect(compressAction.appliesTo([pdf({ compressible: 3, skipped: 0 })])).toBe(true)
  })

  it('refuses a PDF with no images at all', () => {
    // Nothing to trade away here, so offering the flow would promise a
    // saving that cannot happen.
    expect(compressAction.appliesTo([pdf({ compressible: 0, skipped: 0 })])).toBe(false)
  })

  it('refuses a PDF whose images are all a kind it cannot re-encode', () => {
    expect(compressAction.appliesTo([pdf({ compressible: 0, skipped: 4 })])).toBe(false)
  })

  it('accepts a mixed PDF, where some images can be re-encoded', () => {
    expect(compressAction.appliesTo([pdf({ compressible: 2, skipped: 1 })])).toBe(true)
  })

  it('refuses a PDF probed before this field existed, rather than crashing', () => {
    // `images` is optional on DocumentInfo. A source built without it must
    // read as "nothing known to compress", not throw.
    const legacy = { ...pdf({ compressible: 1, skipped: 0 }) }
    delete (legacy as { images?: unknown }).images
    expect(compressAction.appliesTo([legacy])).toBe(false)
  })

  it('plans a PDF job that keeps the format and targets a -small name', () => {
    const [job] = compressAction.plan([pdf({ compressible: 2, skipped: 0 })], {
      mode: 'quality',
      quality: 40,
    })
    if (job?.op !== 'convert') throw new Error('expected a convert job')
    expect(job.target).toBe('pdf')
    expect(job.outputs[0]).toMatch(/brochure-small\.pdf$/)
    expect(job.options.quality).toBe(40)
  })
})
