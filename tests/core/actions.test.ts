import { homedir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DEFAULT_PREFERENCES, type Preferences } from '../../src/config/preferences.js'
import { ACTIONS, actionsFor, convertAction } from '../../src/core/actions/index.js'
import { isForgeError } from '../../src/core/errors.js'
import type { ImageInfo, SourceInfo } from '../../src/core/types.js'

function source(over: Partial<ImageInfo> = {}): SourceInfo {
  return {
    kind: 'image',
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
  it('registers convert and compress', () => {
    expect(ACTIONS.map((a) => a.id)).toEqual(['convert', 'compress'])
  })

  it('offers convert for any image', () => {
    expect(actionsFor(source()).map((a) => a.id)).toContain('convert')
  })
})

describe('convert action options', () => {
  it('offers a target select derived from the capability graph, never a fixed list', () => {
    const specs = convertAction.options(source(), {}, DEFAULT_PREFERENCES)
    const target = specs.find((s) => s.id === 'target')
    expect(target?.kind).toBe('select')
    if (target?.kind !== 'select') throw new Error('expected select')
    expect(target.choices.map((c) => c.value)).toEqual(['png', 'webp', 'avif', 'gif', 'tiff'])
    expect(target.choices.every((c) => c.label.length > 0 && c.hint !== undefined)).toBe(true)
  })

  it('never offers heic, which sharp cannot encode', () => {
    const target = convertAction
      .options(source(), {}, DEFAULT_PREFERENCES)
      .find((s) => s.id === 'target')
    if (target?.kind !== 'select') throw new Error('expected select')
    expect(target.choices.map((c) => c.value)).not.toContain('heic')
  })

  it('never offers the source its own format as a target, since nothing would change', () => {
    const jpegTarget = convertAction
      .options(source({ format: 'jpeg' }), {}, DEFAULT_PREFERENCES)
      .find((s) => s.id === 'target')
    if (jpegTarget?.kind !== 'select') throw new Error('expected select')
    expect(jpegTarget.choices.map((c) => c.value)).not.toContain('jpeg')

    const pngTarget = convertAction
      .options(source({ format: 'png' }), {}, DEFAULT_PREFERENCES)
      .find((s) => s.id === 'target')
    if (pngTarget?.kind !== 'select') throw new Error('expected select')
    expect(pngTarget.choices.map((c) => c.value)).not.toContain('png')
  })

  it('names the source format in the label, so its absence from the list reads as intentional', () => {
    const target = convertAction
      .options(source({ format: 'jpeg' }), {}, DEFAULT_PREFERENCES)
      .find((s) => s.id === 'target')
    if (target?.kind !== 'select') throw new Error('expected select')
    expect(target.label).toBe('Convert JPEG to')
  })

  it('adds a quality slider once a lossy target is chosen', () => {
    const specs = convertAction.options(source(), { target: 'webp' }, DEFAULT_PREFERENCES)
    const quality = specs.find((s) => s.id === 'quality')
    expect(quality?.kind).toBe('slider')
    if (quality?.kind !== 'slider') throw new Error('expected slider')
    expect(quality.min).toBe(1)
    expect(quality.max).toBe(100)
    expect(quality.default).toBe(80)
  })

  it('omits the quality slider for a lossless target', () => {
    const specs = convertAction.options(source(), { target: 'png' }, DEFAULT_PREFERENCES)
    expect(specs.find((s) => s.id === 'quality')).toBeUndefined()
  })

  it('offers a destination path with presets once a target is chosen', () => {
    const specs = convertAction.options(source(), { target: 'webp' }, DEFAULT_PREFERENCES)
    const dest = specs.find((s) => s.id === 'destination')
    expect(dest?.kind).toBe('path')
    if (dest?.kind !== 'path') throw new Error('expected path')
    // The configured default leads and is preselected — it is the whole point
    // of the setting. The source's own folder is still offered, just not first.
    expect(dest.default).toBe(join(homedir(), 'Desktop'))
    expect(dest.presets[0]?.label).toBe('Desktop')
    expect(dest.presets.map((p) => p.label)).toContain('Same folder')
    expect(dest.presets.map((p) => p.label)).toContain('New subfolder')
    expect(dest.presets.find((p) => p.label === 'Downloads')?.path).toBe(
      join(homedir(), 'Downloads'),
    )
  })

  it('drops the Downloads preset rather than duplicating it when the source already lives there', () => {
    const inDownloads = source({ path: join(homedir(), 'Downloads', 'photo.jpg') })
    const specs = convertAction.options(inDownloads, { target: 'webp' }, DEFAULT_PREFERENCES)
    const dest = specs.find((s) => s.id === 'destination')
    if (dest?.kind !== 'path') throw new Error('expected path')

    const paths = dest.presets.map((p) => p.path)
    expect(new Set(paths).size).toBe(paths.length) // no two presets share a path
    // "Downloads" and "Same folder" resolve to one folder here, and the more
    // specific label survives.
    expect(dest.presets.map((p) => p.label)).toContain('Same folder')
    expect(dest.presets.filter((p) => p.path === join(homedir(), 'Downloads'))).toHaveLength(1)
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
    expect(jobs[0]?.outputs[0]).toBe('/Users/me/out/photo.webp')
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

describe('destination presets', () => {
  const source: SourceInfo = {
    kind: 'image',
    path: '/Users/x/Pictures/diagram.png',
    format: 'png',
    width: 10,
    height: 10,
    bytes: 100,
    hasAlpha: false,
    frames: 1,
  }

  const destination = (p: Preferences = DEFAULT_PREFERENCES) => {
    const spec = convertAction
      .options(source, { target: 'webp' }, p)
      .find((s) => s.id === 'destination')
    if (spec?.kind !== 'path') throw new Error('no destination spec')
    return spec
  }

  it('offers Desktop', () => {
    expect(destination().presets.map((x) => x.label)).toContain('Desktop')
    expect(destination().presets.find((x) => x.label === 'Desktop')?.path).toBe(
      join(homedir(), 'Desktop'),
    )
  })

  it('hoists the configured default to the top', () => {
    const p = { ...DEFAULT_PREFERENCES, defaultOutput: '~/Downloads' }
    expect(destination(p).presets[0]?.path).toBe(join(homedir(), 'Downloads'))
  })

  it('labels a hoisted built-in by its name, not its bare path', () => {
    const p = { ...DEFAULT_PREFERENCES, defaultOutput: '~/Downloads' }
    expect(destination(p).presets[0]?.label).toBe('Downloads')
  })

  it('preselects the configured default', () => {
    const p = { ...DEFAULT_PREFERENCES, defaultOutput: '~/Downloads' }
    expect(destination(p).default).toBe(join(homedir(), 'Downloads'))
  })

  it('adds a default that is not one of the built-in presets', () => {
    const p = { ...DEFAULT_PREFERENCES, defaultOutput: '/tmp/somewhere' }
    expect(destination(p).presets[0]?.path).toBe('/tmp/somewhere')
  })

  it('never lists the same folder twice, even when the source lives in the default', () => {
    const onDesktop = { ...source, path: join(homedir(), 'Desktop', 'diagram.png') }
    const spec = convertAction
      .options(onDesktop, { target: 'webp' }, DEFAULT_PREFERENCES)
      .find((s) => s.id === 'destination')
    if (spec?.kind !== 'path') throw new Error('no destination spec')
    const paths = spec.presets.map((x) => x.path)
    expect(new Set(paths).size).toBe(paths.length)
  })

  it('still offers the other presets alongside the default', () => {
    const labels = destination().presets.map((x) => x.label)
    expect(labels).toContain('Same folder')
    expect(labels).toContain('Downloads')
    expect(labels).toContain('New subfolder')
  })
})

describe('quality default', () => {
  const source: SourceInfo = {
    kind: 'image',
    path: '/tmp/a.png',
    format: 'png',
    width: 10,
    height: 10,
    bytes: 100,
    hasAlpha: false,
    frames: 1,
  }

  it('opens the slider on the configured quality, not a hardcoded 80', () => {
    const p = { ...DEFAULT_PREFERENCES, quality: 55 }
    const spec = convertAction
      .options(source, { target: 'webp' }, p)
      .find((s) => s.id === 'quality')
    if (spec?.kind !== 'slider') throw new Error('no quality spec')
    expect(spec.default).toBe(55)
  })
})
