import { homedir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ACTIONS, actionsFor, convertAction } from '../../src/core/actions.js'
import { isForgeError } from '../../src/core/errors.js'
import type { SourceInfo } from '../../src/core/types.js'

function source(over: Partial<SourceInfo> = {}): SourceInfo {
  return {
    path: '/Users/me/Desktop/photo.jpg',
    format: 'jpeg',
    width: 3024,
    height: 4032,
    bytes: 4_200_000,
    hasAlpha: false,
    frames: 1,
    ...over,
  }
}

describe('action registry', () => {
  it('registers exactly one action in this version', () => {
    expect(ACTIONS).toHaveLength(1)
    expect(ACTIONS[0]?.id).toBe('convert')
  })

  it('offers convert for any image', () => {
    expect(actionsFor(source()).map((a) => a.id)).toEqual(['convert'])
  })
})

describe('convert action options', () => {
  it('offers a target select derived from the capability graph, never a fixed list', () => {
    const specs = convertAction.options(source(), {})
    const target = specs.find((s) => s.id === 'target')
    expect(target?.kind).toBe('select')
    if (target?.kind !== 'select') throw new Error('expected select')
    expect(target.choices.map((c) => c.value)).toEqual(['png', 'webp', 'avif', 'gif', 'tiff'])
    expect(target.choices.every((c) => c.label.length > 0 && c.hint !== undefined)).toBe(true)
  })

  it('never offers heic, which sharp cannot encode', () => {
    const target = convertAction.options(source(), {}).find((s) => s.id === 'target')
    if (target?.kind !== 'select') throw new Error('expected select')
    expect(target.choices.map((c) => c.value)).not.toContain('heic')
  })

  it('never offers the source its own format as a target, since nothing would change', () => {
    const jpegTarget = convertAction
      .options(source({ format: 'jpeg' }), {})
      .find((s) => s.id === 'target')
    if (jpegTarget?.kind !== 'select') throw new Error('expected select')
    expect(jpegTarget.choices.map((c) => c.value)).not.toContain('jpeg')

    const pngTarget = convertAction
      .options(source({ format: 'png' }), {})
      .find((s) => s.id === 'target')
    if (pngTarget?.kind !== 'select') throw new Error('expected select')
    expect(pngTarget.choices.map((c) => c.value)).not.toContain('png')
  })

  it('names the source format in the label, so its absence from the list reads as intentional', () => {
    const target = convertAction
      .options(source({ format: 'jpeg' }), {})
      .find((s) => s.id === 'target')
    if (target?.kind !== 'select') throw new Error('expected select')
    expect(target.label).toBe('Convert JPEG to')
  })

  it('adds a quality slider once a lossy target is chosen', () => {
    const specs = convertAction.options(source(), { target: 'webp' })
    const quality = specs.find((s) => s.id === 'quality')
    expect(quality?.kind).toBe('slider')
    if (quality?.kind !== 'slider') throw new Error('expected slider')
    expect(quality.min).toBe(1)
    expect(quality.max).toBe(100)
    expect(quality.default).toBe(80)
  })

  it('omits the quality slider for a lossless target', () => {
    const specs = convertAction.options(source(), { target: 'png' })
    expect(specs.find((s) => s.id === 'quality')).toBeUndefined()
  })

  it('offers a destination path with presets once a target is chosen', () => {
    const specs = convertAction.options(source(), { target: 'webp' })
    const dest = specs.find((s) => s.id === 'destination')
    expect(dest?.kind).toBe('path')
    if (dest?.kind !== 'path') throw new Error('expected path')
    expect(dest.default).toBe('/Users/me/Desktop')
    expect(dest.presets.map((p) => p.label)).toEqual(['Same folder', 'New subfolder', 'Downloads'])
    expect(dest.presets[2]?.path).toBe(join(homedir(), 'Downloads'))
  })

  it('drops the Downloads preset rather than duplicating it when the source already lives there', () => {
    const inDownloads = source({ path: join(homedir(), 'Downloads', 'photo.jpg') })
    const specs = convertAction.options(inDownloads, { target: 'webp' })
    const dest = specs.find((s) => s.id === 'destination')
    if (dest?.kind !== 'path') throw new Error('expected path')

    const paths = dest.presets.map((p) => p.path)
    expect(new Set(paths).size).toBe(paths.length) // no two presets share a path
    expect(dest.presets.map((p) => p.label)).toEqual(['Same folder', 'New subfolder'])
  })
})

describe('convert action plan', () => {
  it('builds one job with the chosen values', () => {
    const s = source()
    const jobs = convertAction.plan(s, {
      target: 'webp',
      quality: 70,
      destination: '/Users/me/out',
    })
    expect(jobs).toHaveLength(1)
    expect(jobs[0]?.target).toBe('webp')
    expect(jobs[0]?.output).toBe('/Users/me/out/photo.webp')
    expect(jobs[0]?.options.quality).toBe(70)
  })

  it('omits quality for a lossless target rather than passing a meaningless number', () => {
    const jobs = convertAction.plan(source(), { target: 'png', destination: '/Users/me/out' })
    expect(jobs[0]?.options.quality).toBeUndefined()
  })

  it('defaults the background to white so transparency does not become black', () => {
    const jobs = convertAction.plan(source({ format: 'png' }), {
      target: 'jpeg',
      destination: '/out',
    })
    expect(jobs[0]?.options.background).toBe('#ffffff')
  })
})

describe('convert action plan target validation', () => {
  function planCode(values: Record<string, unknown>): string {
    try {
      convertAction.plan(source(), values)
    } catch (e) {
      return isForgeError(e) ? e.code : `unexpected:${String(e)}`
    }
    return 'no-error'
  }

  it('throws a ForgeError, not a TypeError, when target is missing', () => {
    expect(planCode({})).toBe('invalid-arguments')
  })

  it('throws a ForgeError when target is the empty string', () => {
    expect(planCode({ target: '' })).toBe('invalid-arguments')
  })

  it('throws a ForgeError when target is not a format Forge knows', () => {
    expect(planCode({ target: 'mp4' })).toBe('invalid-arguments')
  })
})
