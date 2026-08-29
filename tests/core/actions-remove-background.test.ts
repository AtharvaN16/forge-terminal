import { basename } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DEFAULT_PREFERENCES } from '../../src/config/preferences.js'
import {
  backgroundTargetsFor,
  removeBackgroundAction,
} from '../../src/core/actions/remove-background.js'
import type { DocumentInfo, ImageInfo } from '../../src/core/types.js'

const image = (over: Partial<ImageInfo> = {}): ImageInfo => ({
  kind: 'image',
  path: '/Users/me/Pictures/photo.jpg',
  format: 'jpeg',
  bytes: 1_000,
  width: 100,
  height: 80,
  hasAlpha: false,
  frames: 1,
  ...over,
})

const document: DocumentInfo = {
  kind: 'document',
  path: '/Users/me/report.pdf',
  format: 'pdf',
  bytes: 1_000,
  pages: 2,
  encrypted: false,
}

describe('remove-background action', () => {
  it('only applies to one still image', () => {
    expect(removeBackgroundAction.appliesTo([image()])).toBe(true)
    expect(removeBackgroundAction.appliesTo([image({ frames: 2 })])).toBe(false)
    expect(removeBackgroundAction.appliesTo([document])).toBe(false)
    expect(removeBackgroundAction.appliesTo([image(), image()])).toBe(false)
  })

  it('derives alpha-capable targets from the capability graph', () => {
    const targets = backgroundTargetsFor(image())

    expect(targets.length).toBeGreaterThan(0)
    expect(targets.map((target) => target.id)).toContain('png')
    expect(targets.map((target) => target.id)).not.toContain('jpeg')
    expect(targets.map((target) => target.id)).not.toContain('pdf')
  })

  it('keeps the source format available when it carries alpha', () => {
    expect(backgroundTargetsFor(image({ format: 'png' })).map((target) => target.id)).toContain(
      'png',
    )
  })

  it('offers target, quality when relevant, and destination options', () => {
    const first = removeBackgroundAction.options([image()], {}, DEFAULT_PREFERENCES)
    const target = first.find((spec) => spec.id === 'target')
    if (target?.kind !== 'select') throw new Error('expected a target select')

    expect(target.default).toBe(backgroundTargetsFor(image())[0]?.id)
    expect(
      removeBackgroundAction
        .options([image()], { target: 'webp' }, DEFAULT_PREFERENCES)
        .map((spec) => spec.id),
    ).toEqual(['target', 'quality', 'destination'])
  })

  it('plans a semantic job with a safe suffixed output', () => {
    const [job] = removeBackgroundAction.plan([image()], {
      target: 'png',
      destination: '/Users/me/Desktop',
    })

    expect(job?.op).toBe('remove-background')
    expect(job?.outputs[0]).toBe('/Users/me/Desktop/photo-no-bg.png')
    expect(job && 'target' in job ? job.target : undefined).toBe('png')
  })

  it('honours an explicit CLI output filename', () => {
    const [job] = removeBackgroundAction.plan([image()], {
      target: 'webp',
      output: '/tmp/product-cutout.webp',
    })

    expect(job?.outputs[0]).toBe('/tmp/product-cutout.webp')
  })

  it('recreates a recursive source tree under an output directory', () => {
    const [job] = removeBackgroundAction.plan(
      [image({ path: '/Users/me/Pictures/nested/photo.jpg' })],
      {
        target: 'png',
        output: '/tmp/cutouts/',
        sourceRoot: '/Users/me/Pictures',
      },
    )

    expect(job?.outputs[0]).toBe('/tmp/cutouts/nested/photo-no-bg.png')
  })

  it('rejects a target that would put an opaque background back', () => {
    expect(() => removeBackgroundAction.plan([image()], { target: 'jpeg' })).toThrow(
      /transparency|alpha/i,
    )
  })

  it('uses a useful default output name', () => {
    const target = backgroundTargetsFor(image())[0]
    if (!target) throw new Error('expected an alpha target')
    const [job] = removeBackgroundAction.plan([image()], { target: target.id })
    expect(basename(job?.outputs[0] ?? '')).toMatch(/^photo-no-bg\./)
  })
})
